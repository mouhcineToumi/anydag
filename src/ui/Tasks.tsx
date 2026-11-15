import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Circle,
  FileText,
  History,
  List,
  ListChecks,
  MoreHorizontal,
  Plus,
  Search,
  SquareKanban,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { createNote, deleteBoard, moveBoard, setTask, type BoardTree, type TrashEntry } from "@/board/useBoard";
import type { Spot } from "@/calendar/menu";
import { collation } from "@/locale";
import { folderOf, projectFolders, projectFor, type Project } from "@/note/project";
import {
  overdue,
  PRIORITY_LABEL,
  STATUS_LABEL,
  STATUSES,
  titleStem,
  today,
  toggledStatus,
  type Priority,
  type Task,
  type TaskChange,
  type TaskStatus,
} from "@/note/task";
import { withTags } from "@/note/tags";
import { LOCK_HINT, refuseLocked } from "@/settings/lock";
import { TASKS_DISPLAY, writePref } from "@/settings/prefs";
import { usePref } from "@/settings/usePref";

import { Button, IconButton } from "./controls";
import { startDrag } from "./pointerDrag";
import type { ProjectFilter } from "./projectFilter";
import { ProjectChip } from "./ProjectBar";
import { tagMatches, type TagFilter } from "./tagFilter";
import { TagChips, TagSelect } from "./tags/TagFilter";
import { dueRows, priorityRows, projectRows, showDatePicker, statusRows } from "./taskMenus";
import {
  BulkBar,
  displayRows,
  filterFieldRows,
  filterValueRows,
  FilterChip,
  LineButton,
  orderRows,
  filterValue,
} from "./TasksBar";
import { DueLabel, PriorityMark, StatusButton, TaskGlyph } from "./TaskGlyph";
import { countLine, onTab, rememberOrder, sinceText, TAB_LABEL, TABS, type TaskTab } from "./taskModel";
import { restoreFromTrash } from "./trashApi";
import {
  compareRows,
  displayOf,
  displayText,
  FILTER_LABEL,
  filtersInUse,
  groupRows,
  NO_FILTERS,
  passes,
  toggleFilter,
  valueCounts,
  type FilterField,
  type RowGroup,
  type TaskDisplay,
  type TaskFilters,
  type ViewRow,
} from "./taskView";
import { TasksMenu, under, type MenuRow } from "./TasksMenu";
import { blankDraft, NewTaskDialog, NewTaskRow, type NewTaskDraft } from "./NewTask";
import { Toast, ToastName, ToastWords } from "./Toast";
import { middle } from "./tabs/intent";

/**
 * The Tasks page: every note that is a task, as a list or as a board.
 *
 * A task is a note whose frontmatter has a `status:`, so nothing here is a copy of anything: the
 * rows are `/__board/list`'s `tasks` and `titles`, kept current by the change feed, and every change
 * made here is one `POST /__board/task` — the status and due lines of that file and nothing else.
 * A change shows at once and is let go of when the list agrees, or put back if the write was
 * refused; the file is the truth and this page is one round trip behind it, like the sidebar.
 *
 * **The status mark is the row's checkbox** (#311): one click marks a task done, or a done one to do
 * again, and the row stays where it was — struck through — until the toast that says so goes, so a
 * mis-click is undone where it happened. The three statuses are in the row's menu.
 */

export type TasksLayout = "list" | "board";

/** How long a row that was just checked stays where it was, and its toast with it. */
const SETTLE_MS = 5000;
/** How long a task just made is tinted where it landed. */
const FRESH_MS = 1600;

/** A key the Tasks page answers, `N` or `C`: bare, not typed into a field, and not the leader's next key. */
const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

interface Row {
  name: string;
  task: Task;
  /** Where the row is placed: the task as it was before a check whose toast is still up. */
  place: Task;
  title: string;
  /** The folder it is in, which is what tells two tasks with one title apart. */
  folder: string;
  /** The project it is in, innermost first: its note's name, status and title. */
  project?: { name: string; project: Project; title: string };
  /** Its frontmatter's tags, drawn as chips. */
  tags: readonly string[];
}

const leaf = (name: string) => name.slice(name.lastIndexOf("/") + 1);
const NO_TAGS: readonly string[] = [];
const ALL_TAGS: TagFilter = { kind: "all" };

/** Where a task typed into the page goes: the folder of the project shown, and the tag shown. */
interface Into {
  folder: string;
  tag?: string;
}
const same = (a: Task | undefined, b: Task | undefined) =>
  a?.status === b?.status && a?.due === b?.due && a?.priority === b?.priority;

/** List or board, at the end of the top bar: a radiogroup of two, because it is one choice. */
export function LayoutToggle({ layout, onLayout }: { layout: TasksLayout; onLayout(next: TasksLayout): void }) {
  const choices = [
    { value: "list" as const, label: "List", Icon: List },
    { value: "board" as const, label: "Board", Icon: SquareKanban },
  ];
  return (
    <div className="dag-tasks__layout" role="radiogroup" aria-label="Show tasks as">
      {choices.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={layout === value}
          className="dag-tasks__layout-choice"
          data-dag-tasks-layout={value}
          onClick={() => onLayout(value)}
        >
          <Icon size={14} strokeWidth={2} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * How many tasks each tab holds, off every task the vault lists — the tabs say how many there are,
 * whatever the filter line narrows the list to, so a filter never makes the tabs look emptier.
 */
function tabCounts(list: BoardTree): Record<TaskTab, number> {
  const listed = new Set(list.notes);
  const out: Record<TaskTab, number> = { open: 0, done: 0, all: 0 };
  for (const [name, task] of Object.entries(list.tasks)) {
    if (!listed.has(name)) continue;
    out.all++;
    out[task.status === "done" ? "done" : "open"]++;
  }
  return out;
}

/**
 * Open, Done and All, in the top bar after the page's title, each with how many it holds. The board
 * shows every status in its columns, so there none is pressed and a press goes back to the list on
 * that tab.
 */
export function TaskTabs({
  tab,
  list,
  board,
  onTab: choose,
}: {
  tab: TaskTab;
  list: BoardTree;
  board: boolean;
  onTab(next: TaskTab): void;
}) {
  const counts = useMemo(() => tabCounts(list), [list]);
  return (
    <div className="dag-tasks__tabs" role="tablist" aria-label="Which tasks">
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={!board && tab === t}
          className="dag-tasks__tab"
          data-dag-tasks-tab={t}
          onClick={() => choose(t)}
        >
          <span>{TAB_LABEL[t]}</span>
          {t === "all" ? null : <span className="dag-tasks__tab-n">{counts[t]}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * A task's text when it is typed into the Tasks page: its title, the column it was typed into, and
 * the tag the page is showing, if it shows one — a task typed in there stays in view.
 */
const taskText = (title: string, status: TaskStatus, tag?: string): string => {
  const text = `---\ntitle: ${JSON.stringify(title)}\nstatus: ${status}\n---\n`;
  return tag ? withTags(text, { add: [tag] }) : text;
};

/** A row that was just checked: where it was, until its toast goes. */
interface Settling {
  name: string;
  title: string;
  was: Task;
  to: TaskStatus;
}

/** What a menu on the page is for: one property of some tasks, the filter, or how the list is drawn. */
type MenuFor =
  | { of: "status" | "priority" | "due" | "project"; rows: Row[]; at: Spot }
  | { of: "filter"; at: Spot }
  | { of: "filter-values"; field: FilterField; at: Spot }
  | { of: "order" | "display"; at: Spot };

/** A message at the foot of the window: what a change to several tasks did, and its Undo. */
interface Notice {
  text: string;
  undo?: () => void;
}

/** The project filter a URL's `project=` asks for, and the URL a project filter is. */
const projectsOf = (scope: ProjectFilter): string[] =>
  scope.kind === "project" ? [scope.name] : scope.kind === "none" ? [""] : [];
const scopeOf = (projects: readonly string[]): ProjectFilter =>
  projects.length !== 1 ? { kind: "all" } : projects[0] ? { kind: "project", name: projects[0] } : { kind: "none" };
const sameScope = (a: ProjectFilter, b: ProjectFilter) =>
  a.kind === b.kind && (a.kind !== "project" || (b.kind === "project" && a.name === b.name));

/** A row as the order, the groups and the filter read it: where it is placed, not where it is going. */
type Placed = ViewRow & { row: Row };
const placed = (r: Row): Placed => ({ name: r.name, title: r.title, project: r.project, task: r.place, row: r });

export function TasksView({
  list,
  layout,
  onOpen,
  scope = { kind: "all" },
  onScope,
  tagFilter = ALL_TAGS,
  onTagFilter,
  locked = false,
  tab = "open",
  onTab: chooseTab,
  asking = false,
  onAsk,
}: {
  list: BoardTree;
  layout: TasksLayout;
  onOpen(name: string): void;
  /** Read only: a status is shown and not pressed, a card is opened and not dragged, and no task is made here. */
  locked?: boolean;
  /** Which project's tasks to show — the URL's `project=`, resolved to a name by the page. */
  scope?: ProjectFilter;
  onScope?(next: ProjectFilter): void;
  /** Which tab of the top bar is pressed: the list's statuses. */
  tab?: TaskTab;
  onTab?(next: TaskTab): void;
  /** Whether the New task dialog is up — the top bar's button opens it, and `C` here. */
  asking?: boolean;
  onAsk?(open: boolean): void;
  /** Which tag's tasks to show — the URL's `tag=`. */
  tagFilter?: TagFilter;
  onTagFilter?(next: TagFilter): void;
}) {
  /* What this page has asked for and the list does not say yet, by name. */
  const [pending, setPending] = useState<Record<string, Task>>({});
  const [words_, setWords] = useState("");
  const [filters, setFilters] = useState<TaskFilters>(() => ({ ...NO_FILTERS, project: projectsOf(scope) }));
  const [settling, setSettling] = useState<Settling | null>(null);
  const [menu, setMenu] = useState<MenuFor | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /* The selected tasks, by name, and the one a Shift-click runs from. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  /* Which groups are folded against their default: Done starts shut, the rest open. */
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());
  /* The task the New task row is making, and the one just made, tinted where it landed. */
  const [draft, setDraft] = useState<NewTaskDraft>(() => blankDraft(scope.kind === "project" ? scope.name : null));
  const [fresh, setFresh] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  /* *Pick a date…* for several tasks: the browser's own picker, and the tasks it is for. */
  const picker = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState<Row[]>([]);
  const display = displayOf(usePref(TASKS_DISPLAY));
  const setDisplay = useCallback((next: TaskDisplay) => writePref(TASKS_DISPLAY, displayText(next)), []);

  /* A link to one project's tasks is a project filter; a filter on one project is a link to it. */
  useEffect(() => {
    setFilters((f) => (scope.kind === "all" || sameScope(scopeOf(f.project), scope) ? f : { ...f, project: projectsOf(scope) }));
  }, [scope]);
  const changeFilters = useCallback(
    (next: TaskFilters) => {
      setFilters(next);
      const s = scopeOf(next.project);
      if (!sameScope(s, scope)) onScope?.(s);
    },
    [scope, onScope],
  );
  /* A project filter on one project is where a new task goes, until the person picks another. */
  const scopedProject = filters.project.length === 1 && filters.project[0] ? filters.project[0] : null;
  useEffect(() => setDraft((d) => ({ ...d, project: scopedProject })), [scopedProject]);
  /* So is a tag filter: a task made while one tag is showing carries it, and stays in view. */
  const shownTag = tagFilter.kind === "tag" ? tagFilter.name : null;
  useEffect(() => setDraft((d) => ({ ...d, tags: shownTag ? [shownTag] : undefined })), [shownTag]);
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), FRESH_MS);
    return () => clearTimeout(t);
  }, [fresh]);

  useEffect(() => {
    setPending((had) => {
      const left = Object.entries(had).filter(([name, task]) => !same(list.tasks[name], task));
      return left.length === Object.keys(had).length ? had : Object.fromEntries(left);
    });
  }, [list.tasks]);

  /* Which folders are projects, and what each is called — the filter's values and the rows' chips. */
  const owners = useMemo(() => projectFolders(list.projects), [list.projects]);
  const projects = useMemo(
    () =>
      [...owners.values()]
        .map((name) => ({ name, project: list.projects[name]!, title: list.titles[name] ?? leaf(name) }))
        /* What is being worked on first, and done last, as the tasks are read. */
        .sort(
          (a, b) =>
            Number(a.project.status === "done") - Number(b.project.status === "done") ||
            collation({ numeric: true }).compare(a.title, b.title),
        ),
    [owners, list.projects, list.titles],
  );
  const taskNames = useMemo(() => Object.keys(list.tasks), [list.tasks]);

  const words = useMemo(() => words_.trim().toLowerCase().split(/\s+/).filter(Boolean), [words_]);
  /* Every task the tag filter keeps, before the tab, the filter and the words: what the counts count from. */
  const allRows = useMemo(() => {
    const listed = new Set(list.notes);
    return Object.entries({ ...list.tasks, ...pending })
      .filter(([name]) => listed.has(name) && tagMatches(tagFilter, list.tags[name]))
      .map(([name, mine]): Row => {
        /* A pending write knows the status the page asked for; the list knows the rest. */
        const task: Task = { ...list.tasks[name], ...mine };
        const owner = projectFor(name, owners);
        const project =
          owner && list.projects[owner]
            ? { name: owner, project: list.projects[owner]!, title: list.titles[owner] ?? leaf(owner) }
            : undefined;
        const place = settling?.name === name ? settling.was : task;
        const tags = list.tags[name] ?? NO_TAGS;
        return { name, task, place, title: list.titles[name] ?? leaf(name), folder: folderOf(name), project, tags };
      });
  }, [list.notes, list.tasks, list.titles, list.projects, list.tags, owners, tagFilter, pending, settling]);
  const matches = useCallback(
    (r: Row) => words.every((w) => `${r.title} ${r.folder} ${r.project?.title ?? ""}`.toLowerCase().includes(w)),
    [words],
  );
  /* The board shows every status; the list, the tab's. A row just checked keeps the tab it was on. */
  const tabbed = useMemo(
    () => (layout === "board" ? allRows : allRows.filter((r) => onTab(r.place.status, tab))),
    [allRows, layout, tab],
  );
  const now = today();
  const rows = useMemo(
    () => tabbed.filter((r) => matches(r) && passes(filters, placed(r), now)),
    [tabbed, matches, filters, now],
  );
  const inUse = filtersInUse(filters);
  const filtered = words.length > 0 || inUse.length > 0;

  /* The list's order and its headings: the Done tab keeps its own order, most recently finished first. */
  const doneOrder = layout === "list" && tab === "done";
  const order = doneOrder ? display.done : display.order;
  const then = doneOrder ? display.doneTie : display.tie;
  const groups = useMemo(() => {
    const all = groupRows(rows.map(placed), display.group, compareRows(order, then), now);
    const onIt = display.group === "status" ? all.filter((g) => onTab(g.key as TaskStatus, tab)) : all;
    /* An empty group is where its `+` is, so it stays — unless the filter on the same field leaves it out. */
    const field = display.group === "status" || display.group === "priority" ? display.group : null;
    const kept = field ? (filters[field] as string[]) : [];
    return kept.length ? onIt.filter((g) => kept.includes(g.key)) : onIt;
  }, [rows, display.group, order, then, now, tab, filters]);
  /* One group with nothing to tell it from another — no grouping, or the Done tab by status — has no heading. */
  const flat = display.group === "none" || (display.group === "status" && tab === "done");
  const groupId = (key: string) => `${display.group}:${key}`;
  const isOpen = (key: string) => (display.group === "status" && key === "done" && !flat) === flipped.has(groupId(key));
  /* The rows the keys walk: the open groups', in the order they are drawn. */
  const walk = useMemo(
    () => groups.filter((g) => flat || isOpen(g.key)).flatMap((g) => g.rows.map((p) => p.row.name)),
    [groups, flat, flipped, display.group],
  );
  const byName = useMemo(() => new Map(allRows.map((r) => [r.name, r])), [allRows]);
  /* A task that left the list leaves the selection. */
  useEffect(() => {
    setSelected((had) => {
      const left = [...had].filter((n) => rows.some((r) => r.name === n));
      return left.length === had.size ? had : new Set(left);
    });
  }, [rows]);

  const change = useCallback(async (row: Row, next: TaskChange) => {
    /* Built rather than spread: a `due: null` in the change is a task with no date, and an object
         holding `null` would never compare equal to the list's and never be let go of. */
    const status = next.status ?? row.task.status;
    const due = next.due === undefined ? row.task.due : (next.due ?? undefined);
    const priority = next.priority === undefined ? row.task.priority : (next.priority ?? undefined);
    /* And a start date, which nothing here changes and nothing here may drop. */
    const want: Task = {
      status,
      ...(due ? { due } : {}),
      ...(row.task.start ? { start: row.task.start } : {}),
      ...(priority ? { priority } : {}),
    };
    setPending((had) => ({ ...had, [row.name]: want }));
    const got = await setTask(row.name, next);
    setPending((had) => {
      const out = { ...had };
      /* Refused: what the list says is what is true. Accepted: what the server wrote, until the list says so too. */
      if (got) out[row.name] = got;
      else delete out[row.name];
      return out;
    });
    return got;
  }, []);
  /* The columns and the groups take a handler that returns nothing; the answer arrives through `pending`. */
  const onChange = useCallback(
    (row: Row, next: TaskChange) => {
      void change(row, next);
    },
    [change],
  );
  /* A click on the mark: done, or to do again — and the row stays put until the toast goes. */
  const onCheck = useCallback(
    (row: Row, to: TaskStatus) => {
      setSettling((had) => ({ name: row.name, title: row.title, was: had?.name === row.name ? had.was : row.task, to }));
      void change(row, { status: to }).then((got) => {
        /* Refused: there is nothing to undo, and the row goes back by itself. */
        if (got === undefined) setSettling((had) => (had?.name === row.name ? null : had));
      });
    },
    [change],
  );
  const undo = useCallback(() => {
    if (!settling) return;
    const row = allRows.find((r) => r.name === settling.name);
    setSettling(null);
    if (row) onChange(row, { status: settling.was.status });
  }, [settling, allRows, onChange]);

  /* One change to several tasks: a write each, and a word at the foot for the ones refused. */
  const changeAll = useCallback(
    async (targets: Row[], next: TaskChange) => {
      if (targets.length === 1) return void change(targets[0]!, next);
      const got = await Promise.all(targets.map((r) => change(r, next)));
      const refused = got.filter((g) => !g).length;
      if (refused) setNotice({ text: `${refused} of ${targets.length} tasks could not be changed. Try again.` });
    },
    [change],
  );
  /* A project is a folder, so putting tasks in one moves their files there. */
  const moveAll = useCallback(async (targets: Row[], project: string | null) => {
    const folder = project ? folderOf(project) : "";
    const moving = targets.filter((r) => (r.project?.name ?? null) !== project);
    const got = await Promise.all(moving.map((r) => moveBoard(r.name, folder, "note")));
    const refused = got.filter((g) => !g).length;
    if (refused)
      setNotice({
        text:
          refused === 1 && moving.length === 1
            ? "The task could not be moved: a file with its name is already there."
            : `${refused} of ${moving.length} tasks could not be moved: a file with the same name is already there.`,
      });
  }, []);
  const trashAll = useCallback(async (targets: Row[]) => {
    const got = await Promise.all(targets.map((r) => deleteBoard(r.name, "note")));
    const gone = got.filter((g): g is TrashEntry => !!g);
    setSelected(new Set());
    setNotice({
      text:
        gone.length === targets.length
          ? `Moved ${gone.length === 1 ? "1 task" : `${gone.length} tasks`} to the trash`
          : `Moved ${gone.length} of ${targets.length} tasks to the trash; the rest were refused`,
      undo: gone.length ? () => void Promise.all(gone.map((e) => restoreFromTrash(e.id))) : undefined,
    });
  }, []);

  /* What a key or the bar acts on: the selection, or else the row that has the focus. */
  const targetsFor = useCallback(
    (at: string | null): Row[] =>
      selected.size
        ? [...selected].map((n) => byName.get(n)).filter((r): r is Row => !!r)
        : at && byName.get(at)
          ? [byName.get(at)!]
          : [],
    [selected, byName],
  );
  const openMenu = useCallback(
    (row: Row, at: Spot, of: "status" | "priority" = "status") => {
      if (!locked) setMenu({ of, rows: [row], at });
    },
    [locked],
  );
  const menuFor = (of: "status" | "priority" | "due" | "project", targets: Row[], el: Element | null) => {
    if (locked) return void refuseLocked();
    if (targets.length && el) setMenu({ of, rows: targets, at: under(el) });
  };

  const counted = useMemo(() => {
    const shown = rows;
    return { all: tabbed.length, shown: shown.length, late: shown.filter((r) => overdue(r.task)).length };
  }, [rows, tabbed]);
  const total = Object.keys(list.tasks).length;
  /* A board column is in the Order button's order, as a group of the list is (#311). */
  const boardOrder = compareRows(order, then);
  const by = (status: TaskStatus) =>
    rows
      .filter((r) => r.place.status === status)
      .map(placed)
      .sort(boardOrder)
      .map((p) => p.row);
  /* The order the rows are drawn in, which a task's page steps through ("2 of 13"). */
  useEffect(() => {
    const drawn =
      layout === "board"
        ? STATUSES.flatMap((s) => by(s).map((r) => r.name))
        : groups.flatMap((g) => g.rows.map((p) => p.row.name));
    rememberOrder(drawn);
  }, [rows, groups, layout]);
  /* A task typed in while one project is showing is made in that project's folder. */
  const into = { folder: scopedProject ? folderOf(scopedProject) : "", tag: shownTag ?? undefined };
  /* A row names its project, unless the page is already showing only that project's. */
  const chip = (r: Row) => (r.project && scopedProject !== r.project.name ? r.project : undefined);
  const live = locked ? undefined : onCheck;

  const onMade = useCallback(
    (name: string, open: boolean) => {
      if (open) return onOpen(name);
      setFresh(name);
    },
    [onOpen],
  );
  /* The New task row is the list's, on the tabs a new task lands on. */
  const newRow = layout === "list" && tab !== "done";
  /* A group's `+`: the New task row, with that group's value already chosen. */
  const addTo = useCallback((preset: Partial<NewTaskDraft>) => {
    setDraft((d) => ({ ...d, ...preset }));
    requestAnimationFrame(() => field.current?.focus());
  }, []);
  const ask = useCallback(() => {
    if (locked) return void refuseLocked();
    onAsk?.(true);
  }, [locked, onAsk]);

  const focusRow = (name: string | undefined) => {
    if (name) document.querySelector<HTMLElement>(`[data-dag-task-open="${CSS.escape(name)}"]`)?.focus();
  };
  /* Escape: the selection first, then the filter and the words. */
  const letGo = useCallback((): boolean => {
    if (selected.size) {
      setSelected(new Set());
      return true;
    }
    if (filtered) {
      setWords("");
      changeFilters(NO_FILTERS);
      return true;
    }
    return false;
  }, [selected, filtered, changeFilters]);
  /* Ctrl/Cmd-click adds a row to the selection or takes it out; Shift-click selects the run from the last one. */
  const pick = useCallback(
    (name: string, range: boolean) => {
      if (locked) return;
      setSelected((had) => {
        const next = new Set(had);
        const from = anchor.current ? walk.indexOf(anchor.current) : -1;
        const to = walk.indexOf(name);
        if (range && from >= 0 && to >= 0) {
          for (const n of walk.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(n);
        } else if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
      if (!range) anchor.current = name;
    },
    [locked, walk],
  );

  /*
   * The list's keys, while one of its rows holds the focus: J/K or the arrows walk it (with Shift,
   * selecting as they go), X selects, Ctrl+Enter checks, S, P, D and M open the row's status,
   * priority, date and project menus — whose own keys (`1`–`3`, `1`–`4` and `0`) pick — and Escape
   * lets go of the selection, then of the filter. Enter is the title's own: it opens. Space is the
   * leader's, and nothing here hears it or the key after it.
   */
  const leader = useRef(false);
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.altKey || e.metaKey || isTyping(e.target)) return;
    if (e.key === " ") {
      leader.current = !leader.current;
      return;
    }
    const was = leader.current;
    leader.current = false;
    if (was) return;
    const at = (e.target as Element).closest?.("[data-dag-task-row]")?.getAttribute("data-dag-task-row") ?? null;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const step = key === "ArrowDown" || key === "j" ? 1 : key === "ArrowUp" || key === "k" ? -1 : 0;
    if (step && !e.ctrlKey) {
      e.preventDefault();
      const i = at ? walk.indexOf(at) : -1;
      const next = walk[i < 0 ? (step > 0 ? 0 : walk.length - 1) : Math.max(0, Math.min(walk.length - 1, i + step))];
      if (e.shiftKey && next && !locked)
        setSelected((had) => {
          const out = new Set(had);
          if (at) out.add(at);
          out.add(next);
          return out;
        });
      if (!e.shiftKey) anchor.current = next ?? null;
      focusRow(next);
      return;
    }
    if (key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      if (locked) return void refuseLocked();
      const targets = targetsFor(at);
      if (targets.length === 1) onCheck(targets[0]!, toggledStatus(targets[0]!.task.status));
      else if (targets.length)
        void changeAll(targets, { status: targets.every((r) => r.task.status === "done") ? "todo" : "done" });
      return;
    }
    if (e.ctrlKey || e.shiftKey || e.repeat) return;
    if (key === "Escape") {
      if (letGo()) e.preventDefault();
      return;
    }
    const row = at ? document.querySelector(`[data-dag-task-row="${CSS.escape(at)}"]`) : null;
    const of = ({ s: "status", p: "priority", d: "due", m: "project" } as const)[key as "s" | "p" | "d" | "m"];
    if (of) {
      e.preventDefault();
      menuFor(
        of,
        targetsFor(at),
        row?.querySelector(of === "priority" ? "[data-dag-task-priority]" : "[data-dag-task-open]") ?? row,
      );
    } else if (key === "x" && at) {
      e.preventDefault();
      pick(at, false);
    }
  };

  /* `N` puts the caret in the New task row, `C` opens the dialog, and J or K from nowhere in
     particular goes to the first row: bare keys, never one typed into a field, aimed at a menu
     or a dialog, or after the leader. */
  useEffect(() => {
    let leaderOn = false;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || (e.target as Element | null)?.closest?.("[role=menu], [data-dag-dialog]")) {
        leaderOn = false;
        return;
      }
      if (e.key === " ") {
        leaderOn = !leaderOn;
        return;
      }
      const was = leaderOn;
      leaderOn = false;
      if (was || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const key = e.key.toLowerCase();
      const loose = e.target === document.body || e.target === document.documentElement;
      if (key === "n" && newRow) {
        e.preventDefault();
        field.current?.focus();
      } else if (key === "c" || (key === "n" && !newRow)) {
        e.preventDefault();
        ask();
      } else if (loose && (key === "j" || key === "k") && layout === "list") {
        e.preventDefault();
        focusRow(walk[0]);
      } else if (loose && key === "escape" && letGo()) {
        e.preventDefault();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [newRow, ask, walk, layout, letGo]);
  /* A vault with no task yet: the caret is where the first one is typed. */
  useEffect(() => {
    if (total === 0 && newRow && !locked) field.current?.focus();
  }, [total === 0, newRow, locked]);

  const at = (el: HTMLElement): Spot => under(el);
  const menuRows = (m: MenuFor): MenuRow[] => {
    switch (m.of) {
      case "status": {
        const one = m.rows.length === 1 ? m.rows[0]!.task.status : null;
        return statusRows(one, (status) => {
          const targets = m.rows.filter((r) => r.task.status !== status);
          if (targets.length) void changeAll(targets, { status });
        });
      }
      case "priority": {
        const one = m.rows.length === 1 ? (m.rows[0]!.task.priority ?? null) : undefined;
        return priorityRows(one === undefined ? ("\u0000" as Priority) : one, (priority) => {
          const targets = m.rows.filter((r) => (r.task.priority ?? null) !== priority);
          if (targets.length) void changeAll(targets, { priority });
        });
      }
      case "due": {
        const one = m.rows.length === 1 ? (m.rows[0]!.task.due ?? null) : null;
        return dueRows(
          one,
          (due) => void changeAll(m.rows, { due }),
          () => {
            setPicking(m.rows);
            showDatePicker(picker.current);
          },
        );
      }
      case "project": {
        const one = m.rows.length === 1 ? (m.rows[0]!.project?.name ?? null) : undefined;
        return projectRows(projects, one === undefined ? "\u0000" : one, (name) => void moveAll(m.rows, name));
      }
      case "filter":
        return filterFieldRows(filters, (f) => setMenu({ of: "filter-values", field: f, at: { ...m.at } }));
      case "filter-values":
        return filterValueRows(
          m.field,
          filters,
          valueCounts(tabbed.filter(matches).map(placed), filters, m.field, now),
          projects,
          (v) => changeFilters(toggleFilter(filters, m.field, v)),
        );
      case "order":
        return orderRows(order, then, (o, t) =>
          setDisplay(doneOrder ? { ...display, done: o, doneTie: t } : { ...display, order: o, tie: t }),
        );
      case "display":
        return displayRows(
          display,
          (group) => setDisplay({ ...display, group }),
          (c) =>
            setDisplay({
              ...display,
              hidden: display.hidden.includes(c) ? display.hidden.filter((h) => h !== c) : [...display.hidden, c],
            }),
        );
    }
  };
  const menuLabel = (m: MenuFor): string => {
    switch (m.of) {
      case "status":
      case "priority":
      case "due":
      case "project": {
        const what = { status: "status", priority: "priority", due: "due date", project: "project" }[m.of];
        return m.rows.length === 1 ? `${m.rows[0]!.title}: ${what}` : `${m.rows.length} tasks: ${what}`;
      }
      case "filter":
        return "Filter by";
      case "filter-values":
        return `Filter: ${FILTER_LABEL[m.field]}`;
      case "order":
        return "Order";
      case "display":
        return "Display";
    }
  };
  /* What a group's `+` makes: a task with that group's value. A group with no single value has none. */
  const preset = (g: RowGroup<Placed>): Partial<NewTaskDraft> | null => {
    switch (g.by) {
      case "status":
        return { status: g.key as TaskStatus };
      case "priority":
        return { priority: g.key === "none" ? null : (g.key as Priority) };
      case "project":
        return { project: g.key || null };
      case "due":
        return g.key === "today" ? { due: now } : null;
      case "none":
        return null;
    }
  };
  const drawRow = (r: Row) => (
    <TaskRow
      key={r.name}
      row={r}
      chip={chip(r)}
      onOpen={onOpen}
      onCheck={live}
      onMenu={openMenu}
      onPick={locked ? undefined : pick}
      selected={selected.has(r.name)}
      fresh={fresh === r.name}
    />
  );
  const hidden = Object.fromEntries(display.hidden.map((c) => [`data-hide-${c}`, ""]));

  return (
    <main
      className="dag-tasks"
      data-dag-tasks={layout}
      data-dag-tasks-showing={layout === "list" ? tab : undefined}
      data-dag-tasks-grouped={layout === "list" ? display.group : undefined}
      {...hidden}
    >
      <div className="dag-tasks__bar">
        <label className="dag-tasks__find">
          <Search size={14} strokeWidth={2} aria-hidden="true" />
          <input
            className="dag-tasks__filter"
            type="search"
            placeholder="Filter tasks"
            aria-label="Filter tasks"
            value={words_}
            data-dag-tasks-filter=""
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && words_) {
                e.preventDefault();
                setWords("");
              }
            }}
          />
        </label>
        {inUse.map((f) => (
          <FilterChip
            key={f}
            field={f}
            filters={filters}
            projects={projects}
            onOpen={(el) => setMenu({ of: "filter-values", field: f, at: at(el) })}
            onClear={() => changeFilters({ ...filters, [f]: [] })}
          />
        ))}
        <LineButton kind="filter" label="Filter" onOpen={(el) => setMenu({ of: "filter", at: at(el) })} />
        {inUse.length >= 2 ? (
          <Button variant="quiet" size="sm" data-dag-tasks-clear-all="" onClick={() => changeFilters(NO_FILTERS)}>
            Clear all
          </Button>
        ) : null}
        <TagSelect
          list={list}
          names={taskNames}
          filter={tagFilter}
          onFilter={(next) => onTagFilter?.(next)}
          label="Show the tasks tagged"
          hook={{ "data-dag-tasks-tag": "" }}
        />
        <span className="dag-tasks__spacer" />
        <span className="dag-tasks__count" data-dag-tasks-count="" aria-live="polite">
          {total === 0 ? "No tasks yet" : countLine(layout === "board" ? "all" : tab, counted, filtered)}
        </span>
        <LineButton kind="order" label="Order" onOpen={(el) => setMenu({ of: "order", at: at(el) })} />
        {layout === "list" ? (
          <LineButton kind="display" label="Display" onOpen={(el) => setMenu({ of: "display", at: at(el) })} />
        ) : null}
      </div>
      {newRow ? (
        <NewTaskRow draft={draft} onDraft={setDraft} projects={projects} locked={locked} field={field} onMade={onMade} />
      ) : null}
      {total === 0 ? (
        <p className="dag-tasks__intro" data-dag-tasks-empty="">
          No tasks yet. Type a title above and press Enter, or press <kbd className="dag-tasks-kbd">C</kbd> for one with a
          description. Any note becomes a task when it is given a status on its own page.
        </p>
      ) : null}
      {layout === "board" ? (
        <Columns
          by={by}
          onOpen={onOpen}
          onChange={locked ? undefined : onChange}
          onCheck={live}
          chip={chip}
          into={into}
          locked={locked}
        />
      ) : total > 0 && rows.length === 0 && tabbed.length > 0 ? (
        <NoMatch
          words={words_}
          tab={tab}
          onClear={() => {
            setWords("");
            changeFilters(NO_FILTERS);
          }}
          onAll={tab === "open" ? () => chooseTab?.("all") : undefined}
        />
      ) : (
        <div className="dag-tasks__groups" onKeyDown={onListKey}>
          {flat ? (
            <div
              className="dag-tasks__rows"
              role="list"
              aria-label={groups[0]?.label ?? "Tasks"}
              data-dag-tasks-group={groups[0]?.key || "none"}
            >
              {groups.flatMap((g) => g.rows.map((p) => drawRow(p.row)))}
            </div>
          ) : (
            groups.map((g) => {
              const p = locked ? null : preset(g);
              const { mark } = g.by === "none" ? { mark: null } : filterValue(g.by, g.key, projects);
              return (
                <Group
                  key={g.key || "none"}
                  id={g.key || "none"}
                  label={g.label}
                  mark={mark}
                  count={g.rows.length}
                  open={isOpen(g.key)}
                  onToggle={() =>
                    setFlipped((had) => {
                      const out = new Set(had);
                      if (out.has(groupId(g.key))) out.delete(groupId(g.key));
                      else out.add(groupId(g.key));
                      return out;
                    })
                  }
                  onAdd={p ? () => addTo(p) : undefined}
                >
                  {g.rows.map((x) => drawRow(x.row))}
                </Group>
              );
            })
          )}
        </div>
      )}
      {selected.size && layout === "list" && !locked ? (
        <BulkBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          onAction={(a, el) => {
            const targets = targetsFor(null);
            if (a === "trash") void trashAll(targets);
            else menuFor(a, targets, el);
          }}
        />
      ) : null}
      {menu ? (
        <TasksMenu
          at={menu.at}
          label={menuLabel(menu)}
          data={{ "data-dag-task-menu": "rows" in menu && menu.rows.length === 1 ? menu.rows[0]!.name : menu.of }}
          onClose={() => setMenu(null)}
          rows={menuRows(menu)}
        />
      ) : null}
      <input
        ref={picker}
        type="date"
        className="dag-tasks-pills__date"
        tabIndex={-1}
        aria-hidden="true"
        value=""
        onChange={(e) => {
          if (e.target.value && picking.length) void changeAll(picking, { due: e.target.value });
          setPicking([]);
        }}
      />
      {asking ? (
        <NewTaskDialog initial={{ ...draft, title: "" }} projects={projects} onClose={() => onAsk?.(false)} onMade={onMade} />
      ) : null}
      {settling ? (
        <Toast
          icon={settling.to === "done" ? CircleCheck : Circle}
          timeout={SETTLE_MS}
          renew={settling}
          onTimeout={() => setSettling(null)}
          onDismiss={() => setSettling(null)}
          title={`${STATUS_LABEL[settling.to]}: ${settling.title}`}
          data-dag-task-toast={settling.name}
          actions={
            <Button size="sm" data-dag-task-undo="" onClick={undo}>
              Undo
            </Button>
          }
        >
          <ToastWords>{`${STATUS_LABEL[settling.to]}: `}</ToastWords>
          <ToastName text={settling.title} />
        </Toast>
      ) : notice ? (
        <Toast
          icon={notice.undo ? Trash2 : CircleAlert}
          timeout={SETTLE_MS}
          renew={notice}
          onTimeout={() => setNotice(null)}
          onDismiss={() => setNotice(null)}
          title={notice.text}
          data-dag-tasks-notice=""
          actions={
            notice.undo ? (
              <Button
                size="sm"
                data-dag-tasks-notice-undo=""
                onClick={() => {
                  notice.undo?.();
                  setNotice(null);
                }}
              >
                Undo
              </Button>
            ) : undefined
          }
        >
          <ToastWords>{notice.text}</ToastWords>
        </Toast>
      ) : null}
    </main>
  );
}

/** A filter that matches nothing: what it searched, and the two ways out. */
function NoMatch({ words, tab, onClear, onAll }: { words: string; tab: TaskTab; onClear(): void; onAll?(): void }) {
  const what = tab === "open" ? "open task" : tab === "done" ? "done task" : "task";
  return (
    <div className="dag-tasks__none" data-dag-tasks-none="">
      <h2 className="dag-tasks__none-title">
        {words.trim() ? `No ${what} matches “${words.trim()}”` : `No ${what} matches the filter`}
      </h2>
      <p className="dag-tasks__none-text">
        The filter reads titles, folders and projects.{tab === "open" ? " Done tasks are on their own tab." : ""}
      </p>
      <div className="dag-tasks__none-acts">
        <Button data-dag-tasks-clear-filter="" onClick={onClear}>
          Clear the filter
        </Button>
        {onAll ? (
          <Button data-dag-tasks-look-done="" onClick={onAll}>
            Look in Done too
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One task on the list: its status mark (the checkbox), its title (which opens it), a page mark when
 * it has a body, then its columns — check items, project, due date and when it last changed — each
 * in a column of its own so they line up down the list. The last column gives way to the row's menu
 * under the pointer or the keyboard. A narrow window drops the columns in that order, last changed
 * first; the due date stays (`chrome.css`, the container query on `.dag-tasks`), and the Display
 * menu can switch any of them but the date off.
 */
function TaskRow({
  row: r,
  chip,
  onOpen,
  onCheck,
  onMenu,
  onPick,
  selected = false,
  fresh = false,
}: {
  row: Row;
  chip: Row["project"];
  onOpen(name: string): void;
  /** Absent while the app is locked. */
  onCheck?(row: Row, to: TaskStatus): void;
  onMenu(row: Row, at: Spot, of?: "status" | "priority"): void;
  /** Ctrl/Cmd- or Shift-click: into the selection or out of it. Absent while the app is locked. */
  onPick?(name: string, range: boolean): void;
  selected?: boolean;
  /** Just made here: tinted for a moment, and brought into view. */
  fresh?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fresh) ref.current?.scrollIntoView({ block: "nearest" });
  }, [fresh]);
  const items = r.task.items;
  const changed = r.task.changed;
  return (
    <div
      ref={ref}
      className="dag-tasks__row"
      role="listitem"
      data-dag-task-row={r.name}
      data-fresh={fresh ? "" : undefined}
      data-selected={selected ? "" : undefined}
      data-done={r.task.status === "done" ? "" : undefined}
      onClickCapture={(e: ReactMouseEvent) => {
        if (!onPick || !(e.ctrlKey || e.metaKey || e.shiftKey)) return;
        e.preventDefault();
        e.stopPropagation();
        onPick(r.name, e.shiftKey);
      }}
      onContextMenu={(e: ReactMouseEvent) => {
        if (!onCheck) return;
        e.preventDefault();
        onMenu(r, { x: e.clientX, y: e.clientY });
      }}
    >
      {onCheck ? (
        <button
          type="button"
          className="dag-task-pri dag-tasks__pri"
          data-dag-task-priority={r.task.priority ?? "none"}
          aria-label={`${r.title}: priority, ${r.task.priority ? PRIORITY_LABEL[r.task.priority].toLowerCase() : "none"}`}
          aria-haspopup="menu"
          title={r.task.priority ? `Priority: ${PRIORITY_LABEL[r.task.priority]}` : "Set a priority"}
          onClick={(e) => onMenu(r, under(e.currentTarget), "priority")}
        >
          <PriorityMark priority={r.task.priority} />
        </button>
      ) : (
        <span
          className="dag-task-pri dag-tasks__pri"
          data-dag-task-priority={r.task.priority ?? "none"}
          title={r.task.priority ? `Priority: ${PRIORITY_LABEL[r.task.priority]}` : undefined}
        >
          <PriorityMark priority={r.task.priority} />
        </span>
      )}
      <StatusButton status={r.task.status} label={r.title} onStatus={onCheck ? (next) => onCheck(r, next) : undefined} />
      <button
        type="button"
        className="dag-tasks__title"
        data-dag-task-open={r.name}
        title={r.name}
        onClick={() => onOpen(r.name)}
        onAuxClick={middle(() => onOpen(r.name))}
      >
        {r.title}
      </button>
      {r.task.body ? (
        <span className="dag-tasks__page" data-dag-task-page="" title="Has a description">
          <FileText size={14} strokeWidth={2} aria-hidden="true" />
        </span>
      ) : null}
      <TagChips tags={r.tags} />
      <span className="dag-tasks__spacer" />
      <span className="dag-tasks__cell dag-tasks__cell--items">
        {items ? (
          <span
            className="dag-tasks__items"
            data-dag-task-items={`${items.done}/${items.total}`}
            title={`${items.done} of ${items.total} check items ticked`}
          >
            <span className="dag-tasks__bar-track" aria-hidden="true">
              <span className="dag-tasks__bar-fill" style={{ width: `${(items.done / items.total) * 100}%` }} />
            </span>
            {items.done}/{items.total}
          </span>
        ) : null}
      </span>
      <span className="dag-tasks__cell dag-tasks__cell--project">
        {chip ? <ProjectChip project={chip.project} title={chip.title} /> : null}
      </span>
      <span className="dag-tasks__cell dag-tasks__cell--due">
        <DueLabel task={r.task} />
      </span>
      <span className="dag-tasks__cell dag-tasks__cell--changed">
        {changed ? (
          <span className="dag-tasks__changed" data-dag-task-changed="" title={`Changed ${new Date(changed).toLocaleString()}`}>
            <History size={12} strokeWidth={2} aria-hidden="true" />
            {sinceText(changed)}
          </span>
        ) : null}
        {onCheck ? (
          <span className="dag-tasks__more">
            <IconButton
              size="sm"
              aria-label={`${r.title}: more`}
              tip="Status"
              data-dag-task-more={r.name}
              onClick={(e) => onMenu(r, under(e.currentTarget))}
            >
              <MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * One group of the list, under a heading of what it is grouped by: a status, a priority, a due
 * date, a project. Done starts shut — it only grows, and it is what nobody is looking for — and a
 * heading's `+` makes a task with the group's value, where the group has one.
 */
function Group({
  id,
  label,
  mark,
  count,
  open,
  onToggle,
  onAdd,
  children,
}: {
  id: string;
  label: string;
  mark: ReactNode;
  count: number;
  open: boolean;
  onToggle(): void;
  /** The heading's `+`. Absent while the app is locked, and for a group with no one value. */
  onAdd?(): void;
  children: ReactNode;
}) {
  return (
    <section className="dag-tasks__group" data-dag-tasks-group={id}>
      <h2 className="dag-tasks__head">
        <button type="button" className="dag-tasks__twisty" aria-expanded={open} onClick={onToggle} data-dag-tasks-twisty={id}>
          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
          {mark}
          <span>{label}</span>
          <span className="dag-tasks__n">{count}</span>
        </button>
        {onAdd ? (
          <IconButton
            size="sm"
            className="dag-tasks__head-add"
            aria-label={`New task in ${label}`}
            data-dag-tasks-group-add={id}
            onClick={onAdd}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        ) : null}
      </h2>
      {open ? (
        <div className="dag-tasks__rows" role="list">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** What the New task box asks for, in the placeholder and to a screen reader. */
const NEW_TASK_HINT = "New task — type a title and press Enter";

/** What the New task box holds after one Enter, and what it has to say about it. */
export interface QuickAddState {
  title: string;
  problem: string | null;
}

/** How one Enter ended: made, refused with a reason, or refused because the app is read only. */
export type QuickAddAnswer = { name: string } | { error: string } | { locked: true };

/**
 * One attempt's effect on the box: a success empties it, and a refusal keeps what was typed so it
 * can be tried again. The lock's refusal is answered by the top bar's *Read only* pill shaking, so
 * nothing is repeated here; a server's refusal is said in the box.
 */
export function afterQuickAdd(state: QuickAddState, answer: QuickAddAnswer): QuickAddState {
  if ("name" in answer) return { title: "", problem: null };
  if ("locked" in answer) return { title: state.title, problem: null };
  return { title: state.title, problem: answer.error };
}

/**
 * A title typed where the task belongs, and Enter makes it: a note named after the title, in that
 * status, at the top level — or in the folder of the project the page is showing. The page
 * stays where it is — typing five tasks in a row is the point.
 *
 * The whole row is a `<label>`, so the `+` and the space around the box focus it; the placeholder
 * says what Enter does. A create that did not land keeps the title and says why — the server's own
 * words, or the top bar's *Read only* pill shaking when the app is locked.
 */
export function QuickAdd({ status, into, locked }: { status: TaskStatus; into: Into; locked: boolean }) {
  const [state, setState] = useState<QuickAddState>({ title: "", problem: null });
  const [busy, setBusy] = useState(false);
  const make = async () => {
    const t = state.title.trim();
    if (!t || busy) return;
    if (locked) {
      refuseLocked();
      setState((had) => afterQuickAdd(had, { locked: true }));
      return;
    }
    setBusy(true);
    setState((had) => ({ ...had, problem: null }));
    const stem = titleStem(t) || "untitled";
    const made = await createNote(into.folder ? `${into.folder}/${stem}` : stem, taskText(t, status, into.tag));
    setBusy(false);
    setState((had) => afterQuickAdd(had, made));
  };
  return (
    <div className="dag-tasks__add">
      <label
        className="dag-tasks__add-row"
        data-dag-task-add-row={status}
        /* Read only: the row looks unavailable and says why on hover, but the box still takes a
           title, and Enter shakes the top bar's pill rather than doing nothing. */
        data-dag-readonly-blocked={locked ? "" : undefined}
        title={locked ? LOCK_HINT : undefined}
      >
        <Plus size={14} strokeWidth={2} aria-hidden="true" />
        <input
          type="text"
          placeholder={NEW_TASK_HINT}
          aria-label={`New task in ${STATUS_LABEL[status]} — type a title and press Enter`}
          value={state.title}
          disabled={busy}
          data-dag-task-add={status}
          onChange={(e) => setState((had) => ({ ...had, title: e.target.value }))}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void make();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setState({ title: "", problem: null });
            }
          }}
        />
      </label>
      {state.problem ? (
        <p className="dag-tasks__add-problem" role="alert" data-dag-task-add-problem={status}>
          {state.problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The board: a column per status, and a card dragged into another column takes that status.
 *
 * The card is the ghost, moved by `translate` and made `pointer-events: none` for the length of the
 * drag, so `elementFromPoint` finds the column under it rather than the card in the hand — the rule
 * `docs/architecture/things-that-will-bite.md` records for the page tabs. A press that never moves far enough is a click, and opens.
 */
function Columns({
  by,
  onOpen,
  onChange,
  onCheck,
  chip,
  into,
  locked,
}: {
  by(status: TaskStatus): Row[];
  onOpen(name: string): void;
  /** Absent while the app is locked. */
  onChange?(row: Row, next: TaskChange): void;
  onCheck?(row: Row, to: TaskStatus): void;
  chip(row: Row): Row["project"];
  into: Into;
  locked: boolean;
}) {
  const board = useRef<HTMLDivElement>(null);

  const onPress = (row: Row) => (e: ReactPointerEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    const sx = e.clientX;
    const sy = e.clientY;
    let to: TaskStatus | null = null;
    const clear = () => {
      for (const el of board.current?.querySelectorAll<HTMLElement>("[data-dag-tasks-over]") ?? [])
        delete el.dataset.dagTasksOver;
    };
    startDrag(e, {
      onMove(ev, first) {
        if (first) card.dataset.dagTaskDragging = "";
        card.style.translate = `${ev.clientX - sx}px ${ev.clientY - sy}px`;
        clear();
        const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-dag-tasks-column]");
        const status = col?.dataset.dagTasksColumn as TaskStatus | undefined;
        to = status && status !== row.task.status ? status : null;
        if (to && col) col.dataset.dagTasksOver = "";
      },
      onDrop() {
        if (to) onChange?.(row, { status: to });
      },
      onClick() {
        onOpen(row.name);
      },
      onEnd() {
        clear();
        card.style.translate = "";
        delete card.dataset.dagTaskDragging;
      },
    });
  };

  return (
    <div className="dag-tasks__columns" ref={board}>
      {STATUSES.map((status) => {
        const rows = by(status);
        return (
          <section key={status} className="dag-tasks__column" data-dag-tasks-column={status} aria-label={STATUS_LABEL[status]}>
            <h2 className="dag-tasks__head">
              <TaskGlyph status={status} />
              <span>{STATUS_LABEL[status]}</span>
              <span className="dag-tasks__n">{rows.length}</span>
            </h2>
            <div className="dag-tasks__cards" role="list">
              {rows.map((r) => (
                <div
                  key={r.name}
                  className="dag-tasks__card"
                  role="listitem"
                  tabIndex={0}
                  data-dag-task-card={r.name}
                  onPointerDown={onChange ? onPress(r) : undefined}
                  onClick={onChange ? undefined : () => onOpen(r.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(r.name);
                    }
                  }}
                >
                  <div className="dag-tasks__card-top">
                    <StatusButton
                      status={r.task.status}
                      label={r.title}
                      onStatus={onCheck ? (next) => onCheck(r, next) : undefined}
                    />
                    <span className="dag-tasks__card-title">{r.title}</span>
                  </div>
                  {r.task.due || r.task.priority || r.task.items || chip(r) || r.tags.length ? (
                    <div className="dag-tasks__card-meta">
                      {r.task.priority ? (
                        <span
                          className="dag-task-pri"
                          data-dag-task-priority={r.task.priority}
                          title={`Priority: ${PRIORITY_LABEL[r.task.priority]}`}
                        >
                          <PriorityMark priority={r.task.priority} />
                        </span>
                      ) : null}
                      <TagChips tags={r.tags} />
                      {chip(r) ? <ProjectChip project={chip(r)!.project} title={chip(r)!.title} /> : null}
                      {r.task.items ? (
                        <span
                          className="dag-tasks__items"
                          data-dag-task-items={`${r.task.items.done}/${r.task.items.total}`}
                          title={`${r.task.items.done} of ${r.task.items.total} check items ticked`}
                        >
                          <ListChecks size={12} strokeWidth={2} aria-hidden="true" />
                          {r.task.items.done}/{r.task.items.total}
                        </span>
                      ) : null}
                      <span className="dag-tasks__card-due">
                        <DueLabel task={r.task} />
                      </span>
                    </div>
                  ) : null}
                </div>
              ))}
              <QuickAdd status={status} into={into} locked={locked} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
