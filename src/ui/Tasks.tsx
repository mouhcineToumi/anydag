import { ChevronDown, List, Plus, SquareKanban } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { createNote, setTask, type BoardTree } from "@/board/useBoard";
import { folderOf, projectFolders, projectFor, within, type Project } from "@/note/project";
import { compareTasks, STATUS_LABEL, STATUSES, titleStem, type Task, type TaskChange, type TaskStatus } from "@/note/task";

import { startDrag } from "./pointerDrag";
import { ProjectChip } from "./ProjectBar";
import { DueLabel, StatusButton, TaskGlyph } from "./TaskGlyph";

/**
 * The Tasks page: every note that is a task, as a list or as a board.
 *
 * A task is a note whose frontmatter has a `status:`, so nothing here is a copy of anything: the
 * rows are `/__board/list`'s `tasks` and `titles`, kept current by the change feed, and every change
 * made here is one `POST /__board/task` — the status and due lines of that file and nothing else.
 * A change shows at once and is let go of when the list agrees, or put back if the write was
 * refused; the file is the truth and this page is one round trip behind it, like the sidebar.
 */

export type TasksLayout = "list" | "board";

/**
 * The list reads what is being worked on first; the board's columns run left to right the way work
 * moves. The same three statuses in two orders, each the one its layout is read in.
 */
const LIST_ORDER: readonly TaskStatus[] = ["in-progress", "todo", "done"];

interface Row {
  name: string;
  task: Task;
  title: string;
  /** The folder it is in, which is what tells two tasks with one title apart. */
  folder: string;
  /** The project it is in, innermost first: its note's name, status and title. */
  project?: { name: string; project: Project; title: string };
}

/**
 * What the Tasks page shows: every task, the tasks under one project's folder — its note's
 * name — or the tasks in no project at all.
 */
export type ProjectFilter = { kind: "all" } | { kind: "none" } | { kind: "project"; name: string };

/** The URL's word for "in no project": not an id, which is ten characters of Crockford base32. */
export const NO_PROJECT = "none";

const leaf = (name: string) => name.slice(name.lastIndexOf("/") + 1);
const same = (a: Task | undefined, b: Task | undefined) => a?.status === b?.status && a?.due === b?.due;

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

/** A task's text when it is typed into the Tasks page: its title, and the column it was typed into. */
const taskText = (title: string, status: TaskStatus): string => `---\ntitle: ${JSON.stringify(title)}\nstatus: ${status}\n---\n`;

export function TasksView({
  list,
  layout,
  onOpen,
  scope = { kind: "all" },
  onScope,
  locked = false,
}: {
  list: BoardTree;
  layout: TasksLayout;
  onOpen(name: string): void;
  /** Read only: a status is shown and not pressed, a card is opened and not dragged, and no task is made here. */
  locked?: boolean;
  /** Which project's tasks to show — the URL's `project=`, resolved to a name by the page. */
  scope?: ProjectFilter;
  onScope?(next: ProjectFilter): void;
}) {
  /* What this page has asked for and the list does not say yet, by name. */
  const [pending, setPending] = useState<Record<string, Task>>({});
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setPending((had) => {
      const left = Object.entries(had).filter(([name, task]) => !same(list.tasks[name], task));
      return left.length === Object.keys(had).length ? had : Object.fromEntries(left);
    });
  }, [list.tasks]);

  /* Which folders are projects, and what each is called — the filter's options and the rows' chips. */
  const owners = useMemo(() => projectFolders(list.projects), [list.projects]);
  const projects = useMemo(
    () =>
      [...owners.values()]
        .map((name) => ({ name, project: list.projects[name]!, title: list.titles[name] ?? leaf(name) }))
        /* What is being worked on first, and done last, as the tasks are read. */
        .sort((a, b) => Number(a.project.status === "done") - Number(b.project.status === "done") || a.title.localeCompare(b.title, undefined, { numeric: true })),
    [owners, list.projects, list.titles],
  );
  /* The folder the page is scoped to: `undefined` for every task, `null` for the tasks in no project. */
  const scoped = scope.kind === "project" ? folderOf(scope.name) : scope.kind === "none" ? null : undefined;
  const inScope = useCallback(
    (name: string) => (scoped === undefined ? true : scoped === null ? projectFor(name, owners) === undefined : within(name, scoped)),
    [scoped, owners],
  );

  const rows = useMemo(() => {
    const listed = new Set(list.notes);
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return Object.entries({ ...list.tasks, ...pending })
      .filter(([name]) => listed.has(name) && inScope(name))
      .map(([name, task]): Row => {
        const owner = projectFor(name, owners);
        const project = owner && list.projects[owner] ? { name: owner, project: list.projects[owner]!, title: list.titles[owner] ?? leaf(owner) } : undefined;
        return { name, task, title: list.titles[name] ?? leaf(name), folder: folderOf(name), project };
      })
      .filter((r) => words.every((w) => `${r.title} ${r.folder} ${r.project?.title ?? ""}`.toLowerCase().includes(w)))
      .sort(compareTasks);
  }, [list.notes, list.tasks, list.titles, list.projects, owners, inScope, pending, filter]);

  const change = useCallback(
    async (row: Row, next: TaskChange) => {
      /* Built rather than spread: a `due: null` in the change is a task with no date, and an object
         holding `null` would never compare equal to the list's and never be let go of. */
      const status = next.status ?? row.task.status;
      const due = next.due === undefined ? row.task.due : (next.due ?? undefined);
      /* And a start date, which nothing here changes and nothing here may drop. */
      const want: Task = { status, ...(due ? { due } : {}), ...(row.task.start ? { start: row.task.start } : {}) };
      setPending((had) => ({ ...had, [row.name]: want }));
      const got = await setTask(row.name, next);
      setPending((had) => {
        const out = { ...had };
        /* Refused: what the list says is what is true. Accepted: what the server wrote, until the list says so too. */
        if (got) out[row.name] = got;
        else delete out[row.name];
        return out;
      });
    },
    [],
  );
  /* The columns and the groups take a handler that returns nothing; the status button's answer
     arrives through `pending`. */
  const onChange = useCallback(
    (row: Row, next: TaskChange) => {
      void change(row, next);
    },
    [change],
  );

  const total = Object.keys(list.tasks).length;
  /* The count says what is in the scope, before the words filter it. */
  const counted = Object.entries(list.tasks).filter(([name]) => inScope(name));
  const by = (status: TaskStatus) => rows.filter((r) => r.task.status === status);
  /* A task typed in while one project is showing is made in that project's folder. */
  const into = scoped ?? "";
  /* A row names its project, unless the page is already showing only that project's. */
  const chip = (r: Row) => (r.project && !(scope.kind === "project" && scope.name === r.project.name) ? r.project : undefined);
  const scopeValue = scope.kind === "project" ? scope.name : scope.kind === "none" ? NO_PROJECT : "";

  return (
    <main className="dag-tasks" data-dag-tasks={layout}>
      <div className="dag-tasks__bar">
        <input
          className="dag-tasks__filter"
          type="search"
          placeholder="Filter tasks"
          aria-label="Filter tasks"
          value={filter}
          data-dag-tasks-filter=""
          onChange={(e) => setFilter(e.target.value)}
        />
        {projects.length || scope.kind !== "all" ? (
          <select
            className="dag-select dag-tasks__project"
            aria-label="Show the tasks of"
            value={scopeValue}
            data-dag-tasks-project=""
            onChange={(e) => {
              const v = e.target.value;
              onScope?.(v === "" ? { kind: "all" } : v === NO_PROJECT ? { kind: "none" } : { kind: "project", name: v });
            }}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.project.status === "done" ? `${p.title} (done)` : p.project.status === "paused" ? `${p.title} (paused)` : p.title}
              </option>
            ))}
            <option value={NO_PROJECT}>No project</option>
          </select>
        ) : null}
        <span className="dag-tasks__count" data-dag-tasks-count="">
          {total === 0 ? "No tasks yet" : `${counted.filter(([, t]) => t.status !== "done").length} open of ${counted.length}`}
        </span>
      </div>
      {total === 0 ? (
        <p className="dag-tasks__intro" data-dag-tasks-empty="">
          A task is a note with a status. Type one under <strong>To do</strong>, or give any note a status from its own page.
        </p>
      ) : null}
      {layout === "board" ? (
        <Columns by={by} onOpen={onOpen} onChange={locked ? undefined : onChange} chip={chip} into={into} />
      ) : (
        <div className="dag-tasks__groups">
          {LIST_ORDER.map((status) => (
            <Group key={status} status={status} rows={by(status)} onOpen={onOpen} onChange={locked ? undefined : onChange} chip={chip} into={into} />
          ))}
        </div>
      )}
    </main>
  );
}

/** One status's section of the list. Done starts shut: it only grows, and it is what nobody is looking for. */
function Group({
  status,
  rows,
  onOpen,
  onChange,
  chip,
  into,
}: {
  status: TaskStatus;
  rows: Row[];
  onOpen(name: string): void;
  /** Absent while the app is locked. */
  onChange?(row: Row, next: TaskChange): void;
  chip(row: Row): Row["project"];
  into: string;
}) {
  const [open, setOpen] = useState(status !== "done");
  return (
    <section className="dag-tasks__group" data-dag-tasks-group={status}>
      <h2 className="dag-tasks__head">
        <button type="button" className="dag-tasks__twisty" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-dag-tasks-twisty={status}>
          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
          <TaskGlyph status={status} />
          <span>{STATUS_LABEL[status]}</span>
          <span className="dag-tasks__n">{rows.length}</span>
        </button>
      </h2>
      {open ? (
        <div className="dag-tasks__rows" role="list">
          {rows.map((r) => (
            <div key={r.name} className="dag-tasks__row" role="listitem" data-dag-task-row={r.name}>
              <StatusButton status={r.task.status} onStatus={onChange ? (next) => onChange(r, { status: next }) : undefined} />
              <button type="button" className="dag-tasks__title" data-dag-task-open={r.name} onClick={() => onOpen(r.name)}>
                {r.title}
              </button>
              {/* One box on a phone, where they are the row's second line; nothing on a wider window. */}
              <span className="dag-tasks__meta">
                {chip(r) ? <ProjectChip project={chip(r)!.project} title={chip(r)!.title} /> : null}
                {r.folder && !chip(r) ? <span className="dag-tasks__folder">{r.folder}</span> : null}
                <DueLabel task={r.task} />
              </span>
            </div>
          ))}
          {onChange ? <QuickAdd status={status} into={into} /> : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A title typed where the task belongs, and Enter makes it: a note named after the title, in that
 * status, at the top level — or in the folder of the project the page is showing. The page
 * stays where it is — typing five tasks in a row is the point.
 */
function QuickAdd({ status, into }: { status: TaskStatus; into: string }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const make = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    const stem = titleStem(t) || "untitled";
    const made = await createNote(into ? `${into}/${stem}` : stem, taskText(t, status));
    setBusy(false);
    if (made) setTitle("");
  };
  return (
    <div className="dag-tasks__add">
      <Plus size={14} strokeWidth={2} aria-hidden="true" />
      <input
        type="text"
        placeholder="New task"
        aria-label={`New task in ${STATUS_LABEL[status]}`}
        value={title}
        disabled={busy}
        data-dag-task-add={status}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void make();
          } else if (e.key === "Escape") setTitle("");
        }}
      />
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
  chip,
  into,
}: {
  by(status: TaskStatus): Row[];
  onOpen(name: string): void;
  /** Absent while the app is locked. */
  onChange?(row: Row, next: TaskChange): void;
  chip(row: Row): Row["project"];
  into: string;
}) {
  const board = useRef<HTMLDivElement>(null);

  const onPress = (row: Row) => (e: ReactPointerEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    const sx = e.clientX;
    const sy = e.clientY;
    let to: TaskStatus | null = null;
    const clear = () => {
      for (const el of board.current?.querySelectorAll<HTMLElement>("[data-dag-tasks-over]") ?? []) delete el.dataset.dagTasksOver;
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
                    <StatusButton status={r.task.status} onStatus={onChange ? (next) => onChange(r, { status: next }) : undefined} />
                    <span className="dag-tasks__card-title">{r.title}</span>
                  </div>
                  {r.folder || r.task.due || chip(r) ? (
                    <div className="dag-tasks__card-meta">
                      {chip(r) ? <ProjectChip project={chip(r)!.project} title={chip(r)!.title} /> : null}
                      {r.folder && !chip(r) ? <span className="dag-tasks__folder">{r.folder}</span> : null}
                      <DueLabel task={r.task} />
                    </div>
                  ) : null}
                </div>
              ))}
              {onChange ? <QuickAdd status={status} into={into} /> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
