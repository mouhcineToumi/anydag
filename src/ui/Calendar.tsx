import {
  ArrowUpRight,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  ListFilter,
  Lock,
  Sun,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useSyncExternalStore,
} from "react";

import { blankEventText, createNote, setEvent, setTask, type BoardTree } from "@/board/useBoard";
import {
  CAL_KINDS,
  CAL_LABEL,
  DAY_MINUTES,
  MAX_DAYS,
  VIEWS,
  addMonths,
  blocks,
  calendarDate,
  clock,
  clockOf,
  dayWords,
  daysBetween,
  daysFrom,
  fieldsOf,
  itemsOf,
  lanes,
  minutesAt,
  momentAt,
  monthDays,
  placeEvent,
  rangeOf,
  asAllDay,
  asTimed,
  placeTask,
  shiftEvent,
  shiftTask,
  snapMinute,
  startOfMonth,
  taskEdge,
  withEdge,
  withAllDay,
  withEnd,
  withStart,
  step,
  whenWords,
  type Bar,
  type CalItem,
  type CalKind,
  type CalView,
} from "@/calendar/model";
import { menuKey, menuWithin } from "@/calendar/menu";
import { useZone } from "@/calendar/usePrefs";
import { dayOf, momentOf, timeOf, type NoteEvent } from "@/note/event";
import { currentZone, wallOf, zoneName } from "@/note/zone";
import { folderOf, projectFolders, projectFor, within, type Project } from "@/note/project";
import { titleStem, type Task, type TaskChange } from "@/note/task";
import { LOCK_HINT, refuseLocked, setLocked } from "@/settings/lock";
import { withVault } from "@/vault/current";

import { startDrag } from "./pointerDrag";
import { TaskGlyph } from "./TaskGlyph";
import { IconButton, Switch } from "./controls";
import { NO_PROJECT, type ProjectFilter } from "./projectFilter";
import { tagMatches, type TagFilter } from "./tagFilter";
import { TagSelect } from "./tags/TagFilter";
import { collation } from "@/locale";

/**
 * The Calendar page: tasks, events and notes on one timeline, as a
 * month, a week (down its columns, or as rows with the hours across), or a run of days — `?calendar=1`.
 *
 * Nothing here is a copy of anything. The items are `/__board/list`'s `tasks`, `events` and
 * `created`, kept current by the change feed, placed by `src/calendar/model.ts` in the viewer's zone;
 * a click on one opens its note; and the one thing the page writes is a new event, made the way the
 * Tasks page makes a task — a note named after what was typed, in the project's folder when the page
 * is showing one project.
 *
 * **A drag on empty time makes an event**: in the hour grid a time, snapped to a quarter of an hour;
 * in the all-day row or a month's cell, days. The drag paints a ghost and nothing else, and a card
 * at the pointer then asks for its details — title, start and end, all day, description — with the
 * title ready to type, so Enter makes it.
 *
 * **A drag on an event or a task moves it**, keeping how long it is: by days in a month and
 * the all-day row, by quarter hours and days in the hour grid. A press that does not move is still a
 * click that opens it. A note does not move — its day is the store's, the day it was made, and no
 * line of its file says it. Escape during the drag puts it back; a finger scrolls, as it always did.
 *
 * **A week or a run of days keeps a small month beside it** (`MiniMonth`): the month the view is on,
 * today marked and the view's days tinted, a click that takes the view to a day, and arrows that move
 * the small month alone.
 */

/** How many lanes of bars a month's week shows before the rest are a count. */
const MONTH_LANES = 4;
/** How many lanes a week's all-day row shows before it says how many more. */
const ALLDAY_LANES = 3;
/** A drag in the hour grid lands on quarters of an hour; a click makes an hour on the half hour. */
const SNAP = 15;
const CLICK = 30;
/** Under this many minutes a block has room for one line, so its time and title share it. */
const SHORT_BLOCK = 45;
/** Where the hour grid opens, scrolled to: a working morning rather than midnight. */
const FIRST_HOUR = 7.5;

/** What each view is called in the switch. `Rows` is the week turned: a day to a row, its hours across. */
const VIEW_LABEL: Readonly<Record<CalView, string>> = { month: "Month", week: "Week", rows: "Rows", days: "Days" };

/* Days are calendar squares (`calendarDate`), read in UTC whatever zone the page shows times in. */
const WEEKDAY = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const SHORT_YEAR = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const DAY_TITLE = new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** What a view is called at the top of the page: `October 2026`, or `Sep 28 – Oct 4, 2026`. */
function titleOf(view: CalView, day: string, first: string, last: string): string {
  if (view === "month") return MONTH.format(calendarDate(startOfMonth(day)));
  if (first === last) return SHORT_YEAR.format(calendarDate(first));
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return `${(sameYear ? SHORT : SHORT_YEAR).format(calendarDate(first))} – ${SHORT_YEAR.format(calendarDate(last))}`;
}

/** Where a click on an item goes: its note, in this tab's workspace, as a link a modifier can open in a tab. */
const hrefOf = (name: string) => withVault(`?note=${encodeURIComponent(name)}`);

/** What an item moved by this page is now, until the list says so too. */
interface Moved {
  task?: Task;
  event?: NoteEvent;
}
const sameTask = (a: Task | undefined, b: Task): boolean =>
  !!a && a.status === b.status && a.due === b.due && a.start === b.start;
const sameEvent = (a: NoteEvent | undefined, b: NoteEvent | undefined): boolean =>
  !!a && !!b && a.start === b.start && a.end === b.end;

/** Whether an item moves when it is dragged: an event or a task, never a note, whose day is the store's. */
const movable = (item: CalItem): boolean => item.kind === "event" || item.kind === "task";

/** Which end of a bar or a block a press was on: its start (left, or top) or its end (right, or bottom). */
type Edge = "start" | "end";

/**
 * How a bar or a block is picked up: the press, what to call once it has become a drag — so the
 * click the release would send does not also open what was only being moved — and, when the press
 * was on one of its ends, which. `axis` says which way that end runs, so the cursor during a pull
 * follows the item rather than the cell it sits in.
 */
type Grab = (item: CalItem, e: ReactPointerEvent<HTMLElement>, dragged: () => void, edge?: Edge, axis?: "x" | "y") => void;

/** Open an item's menu at a point on the glass, having been asked by that item. */
type AskMenu = (item: CalItem, at: { x: number; y: number }, source: HTMLElement) => void;

/** What a right-click on a calendar item offers. */
type MenuAction = "open" | "new-tab" | "duplicate" | "trash";

/** An item's menu, open at the point it was asked for. */
interface OpenMenu {
  item: CalItem;
  at: { x: number; y: number };
}

/** What a drag writes: an event's two lines, or a task's dates. */
type Write = { event: { start: string; end: string | null } } | { task: Pick<TaskChange, "start" | "due"> };

/** An event's lines as the list holds them: an absent end is no key. */
const asEvent = (e: { start: string; end: string | null }): NoteEvent => ({ start: e.start, ...(e.end ? { end: e.end } : {}) });

/** A task with a change applied, as the list will hold it: `null` takes a date away. */
function applied(task: Task, change: Pick<TaskChange, "start" | "due">): Task {
  const out: Task = { ...task };
  for (const k of ["start", "due"] as const) {
    if (!(k in change)) continue;
    const v = change[k];
    if (v) out[k] = v;
    else delete out[k];
  }
  return out;
}

/** Whether a write would change nothing — a drop back where it was picked up from. */
function idle(item: CalItem, next: Write): boolean {
  if ("event" in next)
    return !!item.event && next.event.start === item.event.start && (next.event.end ?? undefined) === item.event.end;
  return !!item.task && sameTask(applied(item.task, next.task), item.task);
}

/** A range somebody drew, waiting for its details. */
interface Making {
  start: string;
  end: string | null;
  /** Where the card goes, on the glass. */
  x: number;
  y: number;
}

export function CalendarView({
  list,
  view,
  day,
  count,
  weekStart,
  hidden,
  onHidden,
  scope,
  onScope,
  tagFilter = { kind: "all" },
  onTagFilter,
  onGo,
  onOpen,
  onDuplicate,
  onTrash,
  locked = false,
}: {
  list: BoardTree;
  view: CalView;
  /** The day the view is around — the address's `date`, today when it has none. */
  day: string;
  /** How many days a run of days is. */
  count: number;
  /** The day a week starts on, `0` for Sunday — the account's (`WEEK_START`). */
  weekStart: number;
  /** The kinds switched off — the account's (`CALENDAR_HIDE`). */
  hidden: ReadonlySet<CalKind>;
  onHidden(kind: CalKind, hide: boolean): void;
  /** Which project's things to show — the address's `project=`, resolved to a name by the page. */
  scope: ProjectFilter;
  onScope(next: ProjectFilter): void;
  /** Which tag's things to show — the address's `tag=`, over tasks, events and notes alike. */
  tagFilter?: TagFilter;
  onTagFilter?(next: TagFilter): void;
  /** Go somewhere else: another view, another day, another count. `day: null` is today. */
  onGo(next: { view?: CalView; day?: string | null; count?: number }): void;
  onOpen(name: string): void;
  /** A copy of the item's file, beside it, opening nothing — `Shell`'s duplicate. */
  onDuplicate(name: string): void;
  /** Into the trash, with the notice whose Undo puts it back — `Shell`'s Delete. */
  onTrash(name: string): void;
  /** Read only: nothing is made by a drag or a click on empty time, and nothing is moved. */
  locked?: boolean;
}) {
  const today = useToday();
  const phone = usePhone();
  /* Every moment is placed in the account's zone, so a change of zone places them again. */
  const [zone] = useZone();
  const { first, last } = rangeOf(view, day, weekStart, count);
  const [making, setMaking] = useState<Making | null>(null);

  /* The project filter is the Tasks page's: everything, one project's folder, or no project. */
  const owners = useMemo(() => projectFolders(list.projects), [list.projects]);
  const projects = useMemo(
    () =>
      [...owners.values()]
        .map((name) => ({
          name,
          project: list.projects[name]!,
          title: list.titles[name] ?? name.slice(name.lastIndexOf("/") + 1),
        }))
        .sort(
          (a, b) =>
            Number(a.project.status === "done") - Number(b.project.status === "done") ||
            collation({ numeric: true }).compare(a.title, b.title),
        ),
    [owners, list.projects, list.titles],
  );
  const scoped = scope.kind === "project" ? folderOf(scope.name) : scope.kind === "none" ? null : undefined;
  const inScope = useCallback(
    (name: string) =>
      (scoped === undefined ? true : scoped === null ? projectFor(name, owners) === undefined : within(name, scoped)) &&
      tagMatches(tagFilter, list.tags[name]),
    [scoped, owners, tagFilter, list.tags],
  );

  /* What this page has moved and the list does not say yet, by name — the Tasks page's
     `pending`: the change feed is a wait behind the write, and an item that sat where it was dragged
     from for most of a second would read as a drop that did not land. */
  const [pending, setPending] = useState<Readonly<Record<string, Moved>>>({});
  useEffect(() => {
    setPending((had) => {
      const left = Object.entries(had).filter(([name, m]) =>
        m.task ? !sameTask(list.tasks[name], m.task) : !sameEvent(list.events[name], m.event),
      );
      return left.length === Object.keys(had).length ? had : Object.fromEntries(left);
    });
  }, [list.tasks, list.events]);
  const listing = useMemo(() => {
    const names = Object.keys(pending);
    if (!names.length) return list;
    const tasks = { ...list.tasks };
    const events = { ...list.events };
    for (const name of names) {
      const m = pending[name]!;
      if (m.task) tasks[name] = m.task;
      if (m.event) events[name] = m.event;
    }
    return { ...list, tasks, events };
  }, [list, pending]);

  const shown = useMemo(() => new Set(CAL_KINDS.filter((k) => !hidden.has(k))), [hidden]);
  /* `zone` is not an argument: `itemsOf` reads it through `src/note/zone.ts`. */
  const items = useMemo(() => itemsOf(listing, shown, first, last, inScope), [listing, shown, first, last, inScope, zone]);

  /* An item dropped somewhere else, or with an edge pulled: what it becomes is shown at once, and
     what the server wrote — or what the list says, when it refused — once it answers. */
  const write = useCallback(async (item: CalItem, next: Write) => {
    const settle = (got: Moved | null) =>
      setPending((had) => {
        const out = { ...had };
        if (got) out[item.name] = got;
        else delete out[item.name];
        return out;
      });
    if ("event" in next && item.event) {
      settle({ event: asEvent(next.event) });
      const got = await setEvent(item.name, next.event);
      settle(got ? { event: got } : null);
    } else if ("task" in next && item.task) {
      settle({ task: applied(item.task, next.task) });
      const got = await setTask(item.name, next.task);
      settle(got ? { task: got } : null);
    }
  }, []);
  /* The page hands the grid a handler that returns nothing: what a drop writes is the page's to
     settle, and a refused one is already told through `pending`. */
  const onWrite = useCallback(
    (item: CalItem, next: Write) => {
      void write(item, next);
    },
    [write],
  );

  /* A new event is made in the folder of the project the page is showing, as a task typed into the
     Tasks page is. The card hands over the event it settled on — its times already written in the
     viewer's zone — and the words typed under them. */
  const into = scoped ?? "";
  const make = useCallback(
    async (title: string, when: NoteEvent, description: string) => {
      if (locked) return void refuseLocked();
      const t = title.trim() || "Untitled";
      const stem = titleStem(t) || "untitled";
      const body = description.trim();
      await createNote(into ? `${into}/${stem}` : stem, blankEventText(when.start, when.end, t, body ? `${body}\n` : ""));
    },
    [into, locked],
  );

  const ask = useCallback((start: string, end: string | null, x: number, y: number) => setMaking({ start, end, x, y }), []);
  const open = useCallback((name: string) => onOpen(name), [onOpen]);

  /* The item menu: where the pointer or the keyboard asked for it, and what it is about. The
     element that asked keeps the focus to come back to — a keyboard's menu that closed onto nothing
     would leave the page's next Tab starting from the top. */
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const askedBy = useRef<HTMLElement | null>(null);
  const openMenu = useCallback<AskMenu>((item, at, source) => {
    askedBy.current = source;
    setMenu({ item, at });
  }, []);
  const closeMenu = useCallback((back: boolean) => {
    setMenu(null);
    const source = askedBy.current;
    askedBy.current = null;
    if (back && source?.isConnected) source.focus();
  }, []);
  const pick = useCallback(
    (what: MenuAction) => {
      if (!menu) return;
      const name = menu.item.name;
      /* The menu shuts before the action runs, as every menu here does — and only Duplicate leaves
         the item it was asked about on the glass to put the focus back on. */
      closeMenu(what === "duplicate");
      if (what === "open") onOpen(name);
      else if (what === "new-tab") window.open(hrefOf(name), "_blank", "noopener,noreferrer");
      else if (what === "duplicate") onDuplicate(name);
      else onTrash(name);
    },
    [menu, closeMenu, onOpen, onDuplicate, onTrash],
  );

  const scopeValue = scope.kind === "project" ? scope.name : scope.kind === "none" ? NO_PROJECT : "";

  return (
    <main className="dag-calendar" data-dag-calendar={view} data-dag-calendar-first={first} data-dag-calendar-last={last}>
      {/* The title on the left and every control in one cluster on the right: the day's
          arrows were on the left, the views in the middle and the filters on the right, so moving a
          week and changing what showed were three trips across the page. */}
      <div className="dag-calendar__bar">
        <h1 className="dag-calendar__title" data-dag-calendar-title="">
          {titleOf(view, day, first, last)}
        </h1>
        <div className="dag-calendar__cluster">
          <span className="dag-calendar__move">
            <button type="button" className="dag-calendar__today" data-dag-calendar-today="" onClick={() => onGo({ day: null })}>
              Today
            </button>
            <span className="dag-calendar__step">
              <button
                type="button"
                className="dag-icon"
                aria-label="Earlier"
                title="Earlier"
                data-dag-calendar-prev=""
                onClick={() => onGo({ day: stepTo(view, day, -1, count) })}
              >
                <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="dag-icon"
                aria-label="Later"
                title="Later"
                data-dag-calendar-next=""
                onClick={() => onGo({ day: stepTo(view, day, 1, count) })}
              >
                <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          </span>
          <span className="dag-calendar__look">
            <div className="dag-calendar__views" role="radiogroup" aria-label="Show">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  className="dag-tasks__layout-choice"
                  data-dag-calendar-view={v}
                  onClick={() => onGo({ view: v })}
                >
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </div>
            {view === "days" ? (
              <label className="dag-calendar__count">
                <input
                  type="number"
                  min={1}
                  max={MAX_DAYS}
                  value={count}
                  aria-label="How many days"
                  data-dag-calendar-count=""
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (Number.isFinite(n) && n >= 1) onGo({ count: Math.min(MAX_DAYS, n) });
                  }}
                />
                <span>days</span>
              </label>
            ) : null}
            <ShowMenu
              hidden={hidden}
              onHidden={onHidden}
              projects={projects}
              scope={scope}
              scopeValue={scopeValue}
              onScope={onScope}
              list={list}
              tagFilter={tagFilter}
              onTagFilter={(next) => onTagFilter?.(next)}
            />
          </span>
        </div>
      </div>
      {view === "month" && phone ? (
        <DotMonth
          first={first}
          last={last}
          month={day.slice(0, 7)}
          around={day}
          today={today}
          items={items}
          onOpen={open}
          onMenu={openMenu}
        />
      ) : view === "month" ? (
        <Month
          first={first}
          last={last}
          month={day.slice(0, 7)}
          today={today}
          items={items}
          onOpen={open}
          onMenu={openMenu}
          onAsk={ask}
          onWrite={locked ? undefined : onWrite}
          onDay={(d) => onGo({ view: "days", day: d, count: 1 })}
        />
      ) : (
        /* The week — down its columns, or across the rows view — or the run of days, with a small
           month beside it: the whole month is what a week does not say, and it stays while the grid
           scrolls. */
        <div className="dag-calendar__body">
          {view === "rows" ? (
            <Rows
              days={daysFrom(first, last)}
              today={today}
              items={items}
              onOpen={open}
              onMenu={openMenu}
              onAsk={ask}
              onWrite={locked ? undefined : onWrite}
            />
          ) : (
            <Columns
              days={daysFrom(first, last)}
              today={today}
              items={items}
              onOpen={open}
              onMenu={openMenu}
              onAsk={ask}
              onWrite={locked ? undefined : onWrite}
            />
          )}
          <MiniMonth day={day} first={first} last={last} today={today} weekStart={weekStart} onGo={(d) => onGo({ day: d })} />
        </div>
      )}
      {making ? <NewEvent making={making} locked={locked} onMake={make} onClose={() => setMaking(null)} /> : null}
      {menu ? <ItemMenu menu={menu} locked={locked} onPick={pick} onClose={() => closeMenu(true)} /> : null}
    </main>
  );
}

/** Whether the window is a phone's — under 720px, where the chrome folds. */
function usePhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia("(max-width: 719px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => matchMedia("(max-width: 719px)").matches,
  );
}

/**
 * What the calendar shows, behind one button: the three kinds and the project. They were
 * five controls across the bar, switched rarely and read never; the button says when anything is
 * held back, so a calendar with notes switched off does not pass for an empty one.
 */
function ShowMenu({
  hidden,
  onHidden,
  projects,
  scope,
  scopeValue,
  onScope,
  list,
  tagFilter,
  onTagFilter,
}: {
  hidden: ReadonlySet<CalKind>;
  onHidden(kind: CalKind, hide: boolean): void;
  projects: { name: string; project: Project; title: string }[];
  scope: ProjectFilter;
  scopeValue: string;
  onScope(next: ProjectFilter): void;
  list: BoardTree;
  tagFilter: TagFilter;
  onTagFilter(next: TagFilter): void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      toggle.current?.focus();
    };
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc, true);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", esc, true);
    };
  }, [open]);
  const held = hidden.size + (scope.kind === "all" ? 0 : 1) + (tagFilter.kind === "all" ? 0 : 1);
  /* The tags of what the calendar can draw: tasks, events and notes, whichever are on. */
  const tagged = useMemo(() => list.notes.filter((n) => list.tags[n]?.length), [list.notes, list.tags]);
  return (
    <div className="dag-calendar__show" ref={box}>
      <button
        ref={toggle}
        type="button"
        className="dag-calendar__today dag-calendar__show-toggle"
        data-dag-calendar-show=""
        aria-haspopup="dialog"
        aria-expanded={open}
        title={held ? "Some of the calendar is hidden" : "What the calendar shows"}
        onClick={() => setOpen((v) => !v)}
      >
        <ListFilter size={15} strokeWidth={2} aria-hidden="true" />
        <span>Show</span>
        {held ? <span className="dag-calendar__held" aria-label={`${held} filters on`} /> : null}
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className="dag-calendar__chev" />
      </button>
      {open ? (
        <div
          className="dag-calendar__show-menu"
          role="dialog"
          aria-label="What the calendar shows"
          data-dag-calendar-show-menu=""
        >
          <p className="dag-calendar__show-head">Show</p>
          {CAL_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="checkbox"
              aria-checked={!hidden.has(k)}
              aria-pressed={!hidden.has(k)}
              className="dag-calendar__kind"
              data-dag-calendar-kind={k}
              onClick={() => onHidden(k, !hidden.has(k))}
            >
              <span className="dag-calendar__tick" aria-hidden="true">
                {hidden.has(k) ? null : <Check size={12} strokeWidth={2.5} />}
              </span>
              <KindMark kind={k} />
              <span>{CAL_LABEL[k]}</span>
            </button>
          ))}
          {projects.length || scope.kind !== "all" ? (
            <>
              <p className="dag-calendar__show-head">Project</p>
              <select
                className="dag-select dag-tasks__project"
                aria-label="Show the calendar of"
                value={scopeValue}
                data-dag-calendar-project=""
                onChange={(e) => {
                  const v = e.target.value;
                  onScope(v === "" ? { kind: "all" } : v === NO_PROJECT ? { kind: "none" } : { kind: "project", name: v });
                }}
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.project.status === "done"
                      ? `${p.title} (done)`
                      : p.project.status === "paused"
                        ? `${p.title} (paused)`
                        : p.title}
                  </option>
                ))}
                <option value={NO_PROJECT}>No project</option>
              </select>
            </>
          ) : null}
          {tagged.length || tagFilter.kind !== "all" ? (
            <>
              <p className="dag-calendar__show-head">Tag</p>
              <TagSelect
                list={list}
                names={tagged}
                filter={tagFilter}
                onFilter={onTagFilter}
                label="Show the calendar tagged"
                hook={{ "data-dag-calendar-tag": "" }}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Where the arrows go — the model's `step`, with a month landing on its first rather than on a 31st that is not there. */
const stepTo = (view: CalView, day: string, by: number, count: number): string =>
  step(view, view === "month" ? startOfMonth(day) : day, by, count);

/** Today here, which moves at midnight while the page is open — and the minute, for the line that marks now. */
function useToday(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return dayOf(now);
}

/**
 * A small month beside a week or a run of days: the month the view is on, today marked, the days the
 * view shows tinted, and a click on a day that takes the view to it. **Its arrows move the month on
 * its own** — the view and the address stay where they are until a day is picked, so looking three
 * weeks ahead costs the week being read nothing.
 *
 * It opens on the view's month and follows it when the view moves to another; a month its arrows
 * chose is kept while the view stays on the day it was asked from. It draws no events — out of the
 * issue's scope — and does no date arithmetic of its own: the weeks are `monthDays`, the month view's
 * own range, so *Weeks start on* reaches this grid as it reaches the one above, and today is the
 * page's `useToday`, which reads the viewer's zone. Under 720px it is not drawn: a week's seven
 * columns already have the phone's whole width.
 */
function MiniMonth({
  day,
  first,
  last,
  today,
  weekStart,
  onGo,
}: {
  /** The day the view is around: the month shown is its own, until the arrows say otherwise. */
  day: string;
  /** The days the view shows, which are tinted. */
  first: string;
  last: string;
  today: string;
  /** The day a week starts on, `0` for Sunday — the account's (`WEEK_START`). */
  weekStart: number;
  onGo(day: string): void;
}) {
  const here = startOfMonth(day);
  /* The month the arrows chose, and the day the view was on when they did: a view that moves to
     another day follows itself again. */
  const [moved, setMoved] = useState<{ month: string; from: string } | null>(null);
  const month = moved?.from === day ? moved.month : here;
  const days = monthDays(month, weekStart);
  const move = (by: number) => setMoved({ month: addMonths(month, by), from: day });
  return (
    <aside className="dag-cal-mini" data-dag-cal-mini={month.slice(0, 7)} aria-label="Month overview">
      <div className="dag-cal-mini__head">
        <h2 className="dag-cal-mini__title" data-dag-cal-mini-title="">
          {MONTH.format(calendarDate(month))}
        </h2>
        <span className="dag-cal-mini__step">
          <IconButton
            size="sm"
            aria-label="Previous month"
            title="Previous month"
            data-dag-cal-mini-prev=""
            onClick={() => move(-1)}
          >
            <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
          </IconButton>
          <IconButton size="sm" aria-label="Next month" title="Next month" data-dag-cal-mini-next="" onClick={() => move(1)}>
            <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </span>
      </div>
      <div className="dag-cal-mini__grid">
        {days.slice(0, 7).map((d) => (
          <span key={`name-${d}`} className="dag-cal-mini__name" aria-hidden="true">
            {WEEKDAY.format(calendarDate(d)).slice(0, 2)}
          </span>
        ))}
        {days.map((d) => (
          <button
            key={d}
            type="button"
            className="dag-cal-mini__day"
            data-dag-cal-mini-day={d}
            data-out={d.slice(0, 7) === month.slice(0, 7) ? undefined : ""}
            data-today={d === today ? "" : undefined}
            data-in-view={d >= first && d <= last ? "" : undefined}
            aria-current={d === today ? "date" : undefined}
            aria-label={d === today ? `${dayWords(d)}, today` : dayWords(d)}
            onClick={() => onGo(d)}
          >
            {Number(d.slice(8, 10))}
          </button>
        ))}
      </div>
    </aside>
  );
}

/** Each kind's mark: a clock for an event, a page for a note, and a task's own status. */
function KindMark({ kind, item }: { kind: CalKind; item?: CalItem }) {
  if (kind === "task") return <TaskGlyph status={item?.task?.status ?? "todo"} size={12} />;
  const Icon = kind === "event" ? CalendarClock : FileText;
  return <Icon size={12} strokeWidth={2} aria-hidden="true" className="dag-calendar__mark" />;
}

/**
 * One thing on the calendar, as a link to its note: its mark, a timed event's hour, and its title.
 * The press is stopped, so it is never the start of a range somebody meant to draw. A right-click,
 * and `shift+F10` or the context-menu key on its focus, ask the page for its menu.
 */
function ItemLink({
  item,
  style,
  before,
  after,
  short,
  grab,
  axis,
  onOpen,
  onMenu,
}: {
  item: CalItem;
  style?: CSSProperties;
  before?: boolean;
  after?: boolean;
  /** A block in the hour grid too short for its title under its time: both go on one line. */
  short?: boolean;
  /** Where it can be moved from: absent on a phone's list, and for a note. */
  grab?: Grab;
  /** Which way its ends run, so they can be pulled: across for a bar, down for a block in the grid. */
  axis?: "x" | "y";
  onOpen(name: string): void;
  /** The item's menu, at the pointer or under it. Absent where there is none to offer. */
  onMenu?: AskMenu;
}) {
  /* Set when the press became a drag, and cleared when the next press starts — never in `onClick`,
     which a drop that ends somewhere else never sends (the sidebar's lesson). */
  const moved = useRef(false);
  const canMove = !!grab && movable(item);
  const time = item.at && !item.allDay ? clock(item.at.start) : null;
  const words = item.event
    ? whenWords(item.event)
    : item.task
      ? `${item.first === item.last ? item.last : `${item.first} – ${item.last}`}`
      : "Made that day";
  return (
    <a
      href={hrefOf(item.name)}
      className="dag-calendar__item"
      data-dag-cal-item={item.name}
      data-kind={item.kind}
      data-done={item.task?.status === "done" ? "" : undefined}
      data-before={before ? "" : undefined}
      data-after={after ? "" : undefined}
      data-short={short ? "" : undefined}
      data-movable={canMove ? "" : undefined}
      style={style}
      title={canMove ? `${item.title} — ${words}. Drag to move it, or pull an end.` : `${item.title} — ${words}`}
      /* A link the browser would otherwise drag as a URL, which ends the pointer's gesture. */
      draggable={canMove ? false : undefined}
      onPointerDown={(e) => {
        e.stopPropagation();
        moved.current = false;
        /* A finger scrolls the calendar, as it did before anything here could move. */
        if (!canMove || e.button !== 0 || e.pointerType === "touch") return;
        const edge = (e.target as HTMLElement).closest<HTMLElement>("[data-dag-cal-edge]")?.dataset.dagCalEdge as
          | Edge
          | undefined;
        grab!(item, e, () => (moved.current = true), edge, axis);
      }}
      onClick={(e: ReactMouseEvent) => {
        if (moved.current) {
          e.preventDefault();
          moved.current = false;
          return;
        }
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(item.name);
      }}
      /* The browser's own menu off an item, and ours in its place. On empty time neither the
         calendar nor this answers one, so a right-drag there is still nothing at all. */
      onContextMenu={(e: ReactMouseEvent<HTMLAnchorElement>) => {
        if (!onMenu) return;
        e.preventDefault();
        e.stopPropagation();
        onMenu(item, { x: e.clientX, y: e.clientY }, e.currentTarget);
      }}
      onKeyDown={(e: ReactKeyboardEvent<HTMLAnchorElement>) => {
        if (!onMenu || !menuKey(e.key, e.shiftKey)) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        /* Under the item rather than at an imaginary pointer: the keyboard has none, and the item
           is where the person is looking. */
        onMenu(item, { x: r.left, y: r.bottom }, e.currentTarget);
      }}
    >
      <KindMark kind={item.kind} item={item} />
      {time ? <span className="dag-calendar__time">{time}</span> : null}
      <span className="dag-calendar__name">{item.title}</span>
      {/* Its ends, to pull — not an end that is off the page or cut at midnight, which is
          not where it ends. */}
      {canMove && axis && !before ? (
        <span className="dag-calendar__edge" data-dag-cal-edge="start" data-axis={axis} aria-hidden="true" />
      ) : null}
      {canMove && axis && !after ? (
        <span className="dag-calendar__edge" data-dag-cal-edge="end" data-axis={axis} aria-hidden="true" />
      ) : null}
    </a>
  );
}

/** What right-clicking a calendar item offers: open it here or in a tab, copy it, or trash it. */
const MENU_ROWS: { what: MenuAction; label: string; icon: LucideIcon; changes?: boolean; danger?: boolean }[] = [
  { what: "open", label: "Open", icon: ArrowUpRight },
  { what: "new-tab", label: "Open in new tab", icon: ExternalLink },
  { what: "duplicate", label: "Duplicate", icon: Copy, changes: true },
  { what: "trash", label: "Move to trash", icon: Trash2, changes: true, danger: true },
];

const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * An item's menu — its right-click, the context-menu key or `shift+F10` — at the point that asked
 * for it, or under the item when the keyboard did. **The sidebar's menu control**: `role="menu"`,
 * rows of `dag-more__item` walked by the arrow keys, a `card` surface on the popover layer, a press
 * elsewhere or Escape shutting it. Read only, the two rows that change a file give way to the
 * lock's sentence, as a row's menu in the column does.
 */
function ItemMenu({
  menu,
  locked = false,
  onPick,
  onClose,
}: {
  menu: OpenMenu;
  /** Read only: what only reads a file is left, and the menu says why the rest is not. */
  locked?: boolean;
  onPick(what: MenuAction): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(menu.at);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(menuWithin(menu.at, r, { width: innerWidth, height: innerHeight }));
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [menu]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [onClose]);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return onClose();
    }
    /* Tab leaves the menu, as it does the column's row menu: a menu is entered and left by Escape,
       and Tab would otherwise land nowhere once its row is gone. */
    if (e.key === "Tab") {
      e.preventDefault();
      return onClose();
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const at = rows.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    rows[(at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus();
  };

  return (
    <div
      ref={ref}
      className="dag-cal-menu"
      data-dag-cal-menu=""
      role="menu"
      aria-label={`${menu.item.title}: actions`}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKey}
    >
      {MENU_ROWS.map(({ what, label, icon: Icon, changes, danger }) =>
        locked && changes ? null : (
          <button
            key={what}
            type="button"
            role="menuitem"
            className={danger ? "dag-more__item dag-cal-menu__danger" : "dag-more__item"}
            data-dag-cal-menu-item={what}
            onClick={() => onPick(what)}
          >
            <Icon {...ICON} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ),
      )}
      {locked ? <p className="dag-cal-menu__locked">Read only: unlock to change it.</p> : null}
    </div>
  );
}

/* -- the month ------------------------------------------------------------------------------- */

function Month({
  first,
  last,
  month,
  today,
  items,
  onOpen,
  onMenu,
  onAsk,
  onWrite,
  onDay,
}: {
  first: string;
  last: string;
  month: string;
  today: string;
  items: CalItem[];
  onOpen(name: string): void;
  onMenu: AskMenu;
  /** Absent while the app is locked, and with them the drags that make and move. */
  onAsk?(start: string, end: string | null, x: number, y: number): void;
  onWrite?(item: CalItem, next: Write): void;
  onDay(day: string): void;
}) {
  const days = daysFrom(first, last);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const grid = useRef<HTMLDivElement>(null);
  const drawRange = useDayRange(grid, (from, to, x, y) => onAsk?.(from, to === from ? null : to, x, y));
  const grab = useGrab(grid, (item, next) => onWrite?.(item, next));
  return (
    <div
      className="dag-cal-month"
      ref={grid}
      role="grid"
      aria-label="Month"
      style={{ "--weeks": weeks.length } as CSSProperties}
      onPointerDown={onAsk ? drawRange : undefined}
    >
      <div className="dag-cal-names" role="row">
        {weeks[0]!.map((d) => (
          <div key={d} role="columnheader" className="dag-cal-names__day">
            {WEEKDAY.format(calendarDate(d))}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <MonthWeek
          key={week[0]}
          days={week}
          month={month}
          today={today}
          bars={lanes(items, week)}
          grab={onWrite ? grab : undefined}
          onOpen={onOpen}
          onMenu={onMenu}
          onDay={onDay}
        />
      ))}
    </div>
  );
}

/**
 * A month on a phone: a week is 390px, so the bars a desktop month draws are seven letters
 * wide. Each day is its number and a dot per kind it holds; a tap on a day lists what it holds under
 * the grid, where the titles have the whole width. The day starts as the one the view is around — the
 * address's `date`, which is today when it has none — or the month's first when that is another month.
 */
function DotMonth({
  first,
  last,
  month,
  around,
  today,
  items,
  onOpen,
  onMenu,
}: {
  first: string;
  last: string;
  month: string;
  around: string;
  today: string;
  items: CalItem[];
  onOpen(name: string): void;
  onMenu: AskMenu;
}) {
  const days = daysFrom(first, last);
  const [picked, setPicked] = useState<string | null>(null);
  const on = picked && picked >= first && picked <= last ? picked : around.startsWith(month) ? around : `${month}-01`;
  const held = (d: string) => items.filter((it) => it.first <= d && d <= it.last);
  const list = held(on);
  return (
    <div className="dag-cal-dots" data-dag-cal-dots="">
      <div className="dag-cal-dots__grid" role="grid" aria-label="Month">
        {days.slice(0, 7).map((d) => (
          <div key={`n-${d}`} role="columnheader" className="dag-cal-dots__name">
            {WEEKDAY.format(calendarDate(d)).slice(0, 1)}
          </div>
        ))}
        {days.map((d) => {
          const kinds = [...new Set(held(d).map((it) => it.kind))];
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              className="dag-cal-dots__day"
              data-dag-cal-day={d}
              data-out={d.startsWith(month) ? undefined : ""}
              data-today={d === today ? "" : undefined}
              aria-selected={d === on}
              aria-label={`${d}${kinds.length ? `, ${held(d).length} things` : ""}`}
              onClick={() => setPicked(d)}
            >
              <span className="dag-cal-dots__num">{Number(d.slice(8))}</span>
              <span className="dag-cal-dots__marks" aria-hidden="true">
                {kinds.map((k) => (
                  <i key={k} data-kind={k} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <section className="dag-cal-dots__list" aria-label={on} data-dag-cal-dots-list={on}>
        <h2>{DAY_TITLE.format(calendarDate(on))}</h2>
        {list.length ? (
          list.map((it) => <ItemLink key={it.name} item={it} onOpen={onOpen} onMenu={onMenu} />)
        ) : (
          <p className="dag-cal-dots__none">Nothing on this day.</p>
        )}
      </section>
    </div>
  );
}

function MonthWeek({
  days,
  month,
  today,
  bars,
  grab,
  onOpen,
  onMenu,
  onDay,
}: {
  days: string[];
  month: string;
  today: string;
  bars: Bar[];
  grab?: Grab;
  onOpen(name: string): void;
  onMenu: AskMenu;
  onDay(day: string): void;
}) {
  const kept = bars.filter((b) => b.lane < MONTH_LANES);
  /* What each day holds past the lanes shown: a count, which opens that day on its own. */
  const more = days.map((_, i) => bars.filter((b) => b.lane >= MONTH_LANES && b.col <= i && i < b.col + b.span).length);
  return (
    <div className="dag-cal-week" role="row" style={{ "--lanes": MONTH_LANES } as CSSProperties}>
      {days.map((d, i) => (
        <div
          key={d}
          role="gridcell"
          className="dag-cal-day"
          data-dag-cal-day={d}
          data-today={d === today ? "" : undefined}
          data-other={d.slice(0, 7) !== month ? "" : undefined}
          style={{ gridColumn: i + 1 }}
        >
          <button
            type="button"
            className="dag-cal-day__n"
            data-dag-cal-day-open={d}
            aria-label={`Open ${d} on its own`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onDay(d)}
          >
            {d.slice(8, 10) === "01" ? `${SHORT.format(calendarDate(d))}` : Number(d.slice(8, 10))}
          </button>
        </div>
      ))}
      {kept.map((b) => (
        <ItemLink
          key={`${b.item.kind}:${b.item.name}`}
          item={b.item}
          before={b.before}
          after={b.after}
          style={{ gridColumn: `${b.col + 1} / span ${b.span}`, gridRow: b.lane + 2 }}
          grab={grab}
          axis="x"
          onOpen={onOpen}
          onMenu={onMenu}
        />
      ))}
      {more.map((n, i) =>
        n ? (
          <button
            key={days[i]}
            type="button"
            className="dag-cal-more"
            data-dag-cal-more={days[i]}
            style={{ gridColumn: i + 1, gridRow: MONTH_LANES + 2 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onDay(days[i]!)}
          >
            {n} more
          </button>
        ) : null,
      )}
    </div>
  );
}

/**
 * A drag across days — a month's cells, or a week's all-day row — that asks for an all-day event
 * over them. The cells under the pointer are read out of the DOM (`data-dag-cal-day`), the way a
 * drop target is everywhere on this app, and marked while the drag lasts; a click is one day.
 */
function useDayRange(host: RefObject<HTMLElement | null>, ask: (from: string, to: string, x: number, y: number) => void) {
  return useCallback(
    (e: ReactPointerEvent) => {
      const at = (x: number, y: number) =>
        document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-dag-cal-day]")?.dataset.dagCalDay;
      const from = at(e.clientX, e.clientY);
      if (!from || e.button !== 0) return;
      e.preventDefault();
      let to = from;
      const paint = () => {
        const [a, b] = from <= to ? [from, to] : [to, from];
        for (const cell of host.current?.querySelectorAll<HTMLElement>("[data-dag-cal-day]") ?? []) {
          const d = cell.dataset.dagCalDay!;
          if (d >= a && d <= b) cell.dataset.dagCalPicked = "";
          else delete cell.dataset.dagCalPicked;
        }
      };
      paint();
      let x = e.clientX;
      let y = e.clientY;
      const done = () => {
        const [a, b] = from <= to ? [from, to] : [to, from];
        ask(a, b, x, y);
      };
      startDrag(e, {
        onMove(ev) {
          x = ev.clientX;
          y = ev.clientY;
          const d = at(ev.clientX, ev.clientY);
          if (d && d !== to) {
            to = d;
            paint();
          }
        },
        onDrop: done,
        onClick: done,
        onEnd() {
          for (const cell of host.current?.querySelectorAll<HTMLElement>("[data-dag-cal-picked]") ?? [])
            delete cell.dataset.dagCalPicked;
        },
      });
    },
    [host, ask],
  );
}

/** Where the pointer is on a calendar: a day's cell — a month's, or a row's all-day start — or a minute of a day in an hour track. */
interface Spot {
  day: string;
  minute?: number;
  /** Which way the hour track the minute was read from runs; absent on a day cell, whose ends run across. */
  axis?: "x" | "y";
}

/**
 * The spot under a point on the page, in `host` — read through whatever is drawn on top, a bar or a
 * block included, because the cells and the tracks are under them. A day's column in the week runs
 * its hours down, and a row's track runs them across; `minutesAt` is the one reading of either.
 */
function spotAt(host: HTMLElement | null, x: number, y: number): Spot | undefined {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!(el instanceof HTMLElement) || !host?.contains(el)) continue;
    if (el.dataset.dagCalDay) return { day: el.dataset.dagCalDay };
    const column = el.dataset.dagCalColumn;
    if (column) return { day: column, minute: minutesAt(el.getBoundingClientRect(), { x, y }, "y"), axis: "y" };
    const row = el.dataset.dagCalRow;
    if (row) return { day: row, minute: minutesAt(el.getBoundingClientRect(), { x, y }, "x"), axis: "x" };
  }
  return undefined;
}

/** A grid minute as the clock says it, snapped to the quarter hour below. */
const quarter = (minute: number): string => clockOf(snapMinute(minute, SNAP));

/** Minutes since midnight of a `HH:MM`. */
const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/**
 * An event or a task picked up — the whole of what a drag on one can mean, with no pointer
 * arithmetic past where the pointer is:
 *
 * - **Moved** along the days in a month and the all-day row, and along the clock by quarter hours and
 *   across the columns in the hour grid, measured from where it was pressed, so it keeps its place
 *   under the pointer.
 * - **Across the two**, in a week or a run of days: a timed event let go on the all-day row is all day
 *   there, over the days it touched (`asAllDay`); an all-day event let go in the grid is an hour at
 *   that time (`asTimed`). A task is dates, and only follows the day.
 * - **An end pulled**: its start or its end, the other kept (`withEdge`, `taskEdge`).
 *
 * What it would become is drawn while it is held — the days marked, the way drawing a range marks
 * them, or a ghost in the hour grid — and that is exactly what is written when it is let go. The item
 * it was picked up from is dimmed. Escape puts it back.
 */
function useGrab(
  host: RefObject<HTMLElement | null>,
  onWrite: (item: CalItem, next: Write) => void,
  onGhost?: (g: Ghost | null) => void,
): Grab {
  return useCallback(
    (item, e, dragged, edge, axis) => {
      const from = spotAt(host.current, e.clientX, e.clientY);
      if (!from) return;
      const el = e.currentTarget;
      e.preventDefault();
      const inGrid = from.minute !== undefined;
      let next: Write | null = null;
      let off = false;

      const at = (s: Spot): Write | null => {
        const ev = item.event;
        const task = item.task;
        if (task) return { task: edge ? taskEdge(task, edge, s.day) : shiftTask(task, daysBetween(from.day, s.day)) };
        if (!ev) return null;
        if (edge) {
          /* A block's end follows the clock, and only while the pointer is in the grid; a bar's, the day. */
          if (!inGrid) return { event: withEdge(ev, edge, s.day) };
          return s.minute === undefined ? next : { event: withEdge(ev, edge, s.day, quarter(s.minute + SNAP / 2), SNAP) };
        }
        if (s.minute !== undefined)
          return {
            event: inGrid
              ? shiftEvent(ev, daysBetween(from.day, s.day), s.minute - from.minute!, SNAP)
              : asTimed(ev, s.day, quarter(s.minute)),
          };
        return { event: inGrid ? asAllDay(ev, s.day) : shiftEvent(ev, daysBetween(from.day, s.day)) };
      };

      const clearDays = () => {
        for (const cell of host.current?.querySelectorAll<HTMLElement>("[data-dag-cal-picked]") ?? [])
          delete cell.dataset.dagCalPicked;
      };
      const paintDays = (a: string, b: string) => {
        for (const cell of host.current?.querySelectorAll<HTMLElement>("[data-dag-cal-day]") ?? []) {
          const d = cell.dataset.dagCalDay!;
          if (d >= a && d <= b) cell.dataset.dagCalPicked = "";
          else delete cell.dataset.dagCalPicked;
        }
      };
      /* A timed event under a day long is drawn where the grid would draw it; everything else as the days it covers. */
      const show = (w: Write) => {
        if ("task" in w) {
          const span = item.task ? placeTask(applied(item.task, w.task)) : undefined;
          onGhost?.(null);
          return span ? paintDays(span.first, span.last) : clearDays();
        }
        const placed = placeEvent(asEvent(w.event));
        if (onGhost && !placed.allDay && placed.at) {
          clearDays();
          const f = fieldsOf(asEvent(w.event));
          const top = minutesOf(f.startTime);
          const long = (placed.at.end - placed.at.start) / 60_000;
          return onGhost({
            day: f.startDay,
            top,
            len: Math.max(SNAP, Math.min(long, DAY_MINUTES - top)),
            label: f.startTime,
            end: f.endTime,
            title: item.title,
          });
        }
        onGhost?.(null);
        paintDays(placed.first, placed.last);
      };
      const stop = () => {
        clearDays();
        onGhost?.(null);
        delete el.dataset.dagCalMoving;
        delete document.documentElement.dataset.dagCalPulling;
      };
      const esc = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        off = true;
        stop();
      };
      startDrag(e, {
        onMove(ev, first) {
          if (first) {
            dragged();
            el.dataset.dagCalMoving = edge ?? "";
            /* The resize cursor for as long as an end is held, wherever the pointer goes: the
               item's own axis, which is the days of a bar and the clock of a block on either grid. */
            if (edge) document.documentElement.dataset.dagCalPulling = (axis ?? from.axis) === "y" ? "y" : "x";
            addEventListener("keydown", esc, true);
          }
          if (off) return;
          const s = spotAt(host.current, ev.clientX, ev.clientY);
          if (!s) return;
          next = at(s);
          if (next) show(next);
        },
        onDrop() {
          if (!off && next && !idle(item, next)) onWrite(item, next);
        },
        onEnd() {
          stop();
          removeEventListener("keydown", esc, true);
        },
      });
    },
    [host, onWrite, onGhost],
  );
}

/* -- a week, or a run of days --------------------------------------------------------------- */

function Columns({
  days,
  today,
  items,
  onOpen,
  onMenu,
  onAsk,
  onWrite,
}: {
  days: string[];
  today: string;
  items: CalItem[];
  onOpen(name: string): void;
  onMenu: AskMenu;
  /** Absent while the app is locked, and with them the drags that make and move. */
  onAsk?(start: string, end: string | null, x: number, y: number): void;
  onWrite?(item: CalItem, next: Write): void;
}) {
  const bars = lanes(
    items.filter((i) => i.allDay),
    days,
  );
  /* Three lanes, then how many more each day holds, which unfolds the row: a week with a
     trip, two tasks and four notes on a Monday pushed the hours below the fold, and a row that
     scrolled on its own hid them from anyone who did not think to scroll it. */
  const [unfolded, setUnfolded] = useState(false);
  const deep = Math.max(1, ...bars.map((b) => b.lane + 1));
  const folded = !unfolded && deep > ALLDAY_LANES;
  const kept = folded ? bars.filter((b) => b.lane < ALLDAY_LANES) : bars;
  const more = folded
    ? days.map((_, i) => bars.filter((b) => b.lane >= ALLDAY_LANES && b.col <= i && i < b.col + b.span).length)
    : [];
  const count = folded ? ALLDAY_LANES + 1 : deep;
  const top = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const drawDays = useDayRange(top, (from, to, x, y) => onAsk?.(from, to === from ? null : to, x, y));
  /* Where a block being moved would land: the day, its top and length in the grid's minutes, and the
     time it would start — drawn as a ghost in that day's column while the pointer is held. One
     gesture for the all-day row and the grid, so a thing can be taken from one to the other. */
  const [moving, setMoving] = useState<Ghost | null>(null);
  const cols = useRef<HTMLDivElement>(null);
  const grab = useGrab(cols, (item, next) => onWrite?.(item, next), setMoving);

  /* Opened on the working day rather than on midnight — once, when the grid first has a height. */
  useLayoutEffect(() => {
    const el = scroller.current;
    const grid = el?.querySelector<HTMLElement>(".dag-cal-grid");
    if (el && grid) el.scrollTop = (grid.scrollHeight * FIRST_HOUR) / 24;
  }, []);

  return (
    <div className="dag-cal-cols" ref={cols} style={{ "--days": days.length } as CSSProperties}>
      <div className="dag-cal-cols__head" role="row">
        <span className="dag-cal-gutter" aria-hidden="true" />
        {days.map((d) => (
          <div key={d} role="columnheader" className="dag-cal-cols__day" data-today={d === today ? "" : undefined}>
            <span className="dag-cal-cols__weekday">{WEEKDAY.format(calendarDate(d))}</span>
            <span className="dag-cal-cols__n">{Number(d.slice(8, 10))}</span>
          </div>
        ))}
      </div>
      <div
        className="dag-cal-allday"
        ref={top}
        style={{ "--lanes": count } as CSSProperties}
        onPointerDown={onAsk ? drawDays : undefined}
        data-dag-cal-allday=""
      >
        <span className="dag-cal-gutter dag-cal-allday__label">
          All day
          {unfolded && deep > ALLDAY_LANES ? (
            <button
              type="button"
              className="dag-cal-more dag-cal-allday__less"
              data-dag-cal-allday-less=""
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setUnfolded(false)}
            >
              Less
            </button>
          ) : null}
        </span>
        {days.map((d, i) => (
          <div key={d} className="dag-cal-allday__cell" data-dag-cal-day={d} style={{ gridColumn: i + 2 }} />
        ))}
        {more.map((n, i) =>
          n ? (
            <button
              key={`more-${days[i]}`}
              type="button"
              className="dag-cal-more"
              data-dag-cal-allday-more={days[i]}
              style={{ gridColumn: i + 2, gridRow: ALLDAY_LANES + 1 }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setUnfolded(true)}
            >
              {n} more
            </button>
          ) : null,
        )}
        {kept.map((b) => (
          <ItemLink
            key={`${b.item.kind}:${b.item.name}`}
            item={b.item}
            before={b.before}
            after={b.after}
            style={{ gridColumn: `${b.col + 2} / span ${b.span}`, gridRow: b.lane + 1 }}
            grab={onWrite ? grab : undefined}
            axis="x"
            onOpen={onOpen}
            onMenu={onMenu}
          />
        ))}
      </div>
      <div className="dag-cal-scroll" ref={scroller}>
        <div className="dag-cal-grid">
          <div className="dag-cal-hours" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="dag-cal-hours__h" style={{ "--at": h * 60 } as CSSProperties}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <DayColumn
              key={d}
              day={d}
              today={d === today}
              items={items}
              moving={moving?.day === d ? moving : null}
              grab={onWrite ? grab : undefined}
              onOpen={onOpen}
              onMenu={onMenu}
              onAsk={onAsk}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Where a block being moved or pulled would land, in one day's column of the hour grid. */
interface Ghost {
  day: string;
  top: number;
  len: number;
  /** The time it would start, and end. */
  label: string;
  end: string;
  title: string;
}

/** A range a drag on empty time is drawing, in minutes from the day's midnight. */
interface Range {
  from: number;
  to: number;
}

/** What a drag on empty time paints on a day's hour track. */
function RangeGhost({ range }: { range: Range | null }) {
  return range ? (
    <div className="dag-cal-ghost" style={{ "--at": range.from, "--len": range.to - range.from } as CSSProperties} />
  ) : null;
}

/** The ghost of an item being moved or pulled, saying the time it would start and end. */
function MovingGhost({ moving }: { moving: Ghost | null }) {
  return moving ? (
    <div
      className="dag-cal-ghost dag-cal-ghost--move"
      data-dag-cal-moving-to={moving.label}
      data-dag-cal-moving-end={moving.end}
      style={{ "--at": moving.top, "--len": moving.len } as CSSProperties}
    >
      <span className="dag-calendar__time">
        {moving.label} – {moving.end}
      </span>{" "}
      <span className="dag-calendar__name">{moving.title}</span>
    </div>
  ) : null;
}

/**
 * The press that draws a new event on one day's hour track — down its column in the week, across
 * its row in the rows view. **The arithmetic is the model's** (`minutesAt`, `snapMinute`,
 * `clockOf`), so a drag lands on the same quarter hour whichever way the hours run, and a click
 * makes the same hour on the half hour in both.
 */
function useTimeDraw(day: string, axis: "x" | "y", onAsk?: (start: string, end: string | null, x: number, y: number) => void) {
  const [range, setRange] = useState<Range | null>(null);
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || !onAsk) return;
      const box = e.currentTarget.getBoundingClientRect();
      const minute = (x: number, y: number) => minutesAt(box, { x, y }, axis);
      const from = snapMinute(minute(e.clientX, e.clientY), SNAP);
      let span: Range = { from, to: from + SNAP };
      let x = e.clientX;
      let y = e.clientY;
      /* A grid minute is a wall-clock reading here, so the drag writes the time its label says. */
      const at = (m: number) => timeOf(momentAt(day, clockOf(m)));
      e.preventDefault();
      startDrag(e, {
        onMove(ev) {
          x = ev.clientX;
          y = ev.clientY;
          const m = snapMinute(minute(ev.clientX, ev.clientY), SNAP);
          span = { from: Math.min(from, m), to: Math.max(from, m) + SNAP };
          setRange(span);
        },
        onDrop() {
          onAsk(at(span.from), at(Math.min(DAY_MINUTES, span.to)), x, y);
        },
        onClick() {
          const start = snapMinute(minute(x, y), CLICK);
          const to = Math.min(DAY_MINUTES, start + 60);
          setRange({ from: start, to });
          onAsk(at(start), at(to), x, y);
        },
        onEnd() {
          /* Held for a moment after a click so the hour it made is seen, then let go. */
          setTimeout(() => setRange(null), 150);
        },
      });
    },
    [day, axis, onAsk],
  );
  return { range, onPointerDown: onAsk ? onPointerDown : undefined };
}

/**
 * One day's hour grid: its timed events side by side where they overlap, the line that marks now,
 * and the drag that draws a new one — snapped to a quarter of an hour, and an hour on the half hour
 * for a click.
 */

function DayColumn({
  day,
  today,
  items,
  moving,
  grab,
  onOpen,
  onMenu,
  onAsk,
}: {
  day: string;
  today: boolean;
  items: CalItem[];
  moving: Ghost | null;
  grab?: Grab;
  onOpen(name: string): void;
  onMenu: AskMenu;
  onAsk?(start: string, end: string | null, x: number, y: number): void;
}) {
  const placed = useMemo(() => blocks(items, day), [items, day]);
  const { range, onPointerDown } = useTimeDraw(day, "y", onAsk);
  const now = today
    ? (() => {
        const at = wallOf(Date.now());
        return at.hour * 60 + at.minute;
      })()
    : null;

  return (
    <div className="dag-cal-column" data-dag-cal-column={day} data-today={today ? "" : undefined} onPointerDown={onPointerDown}>
      <RangeGhost range={range} />
      {placed.map((b) => (
        <ItemLink
          key={`${b.item.kind}:${b.item.name}`}
          item={b.item}
          before={b.before}
          after={b.after}
          style={{ "--at": b.top, "--len": b.length, "--col": b.col, "--of": b.of } as CSSProperties}
          short={b.length < SHORT_BLOCK}
          grab={grab}
          axis="y"
          onOpen={onOpen}
          onMenu={onMenu}
        />
      ))}
      <MovingGhost moving={moving} />
      {now !== null ? <div className="dag-cal-now" style={{ "--at": now } as CSSProperties} aria-hidden="true" /> : null}
    </div>
  );
}

/* -- a week as rows --------------------------------------------------------------------------- */

/**
 * The week turned on its side: **one row to a day**, the day and its all-day things at the start of
 * the row, and the hours of the day across it. It is the same seven days and the same items as
 * `Columns`; only the drawing turns. A timed event is `blocks`' `top` and `length` — minutes into the
 * day — read as a left edge and a width, and *side by side where they overlap* becomes lanes down the
 * row, so an event is never shorter than the 24px floor.
 *
 * The gestures are the page's, not this file's second copy: `useTimeDraw` draws a new event, `useGrab`
 * moves one and pulls its ends (the same `spotAt`, the same `minutesAt`), and `useDayRange` makes an
 * all-day event across the days at the start of the rows.
 */
function Rows({
  days,
  today,
  items,
  onOpen,
  onMenu,
  onAsk,
  onWrite,
}: {
  days: string[];
  today: string;
  items: CalItem[];
  onOpen(name: string): void;
  onMenu: AskMenu;
  /** Absent while the app is locked, and with them the drags that make and move. */
  onAsk?(start: string, end: string | null, x: number, y: number): void;
  onWrite?(item: CalItem, next: Write): void;
}) {
  const cols = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState<Ghost | null>(null);
  const grab = useGrab(cols, (item, next) => onWrite?.(item, next), setMoving);
  return (
    <div className="dag-cal-rows" ref={cols} data-dag-cal-rows="">
      <div className="dag-cal-rows__head">
        <span className="dag-cal-rows__corner" aria-hidden="true" />
        <span className="dag-cal-rows__allday" aria-hidden="true">
          All day
        </span>
        <div className="dag-cal-rows__hours" aria-hidden="true">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="dag-cal-rows__hour" style={{ "--at": h * 60 } as CSSProperties}>
              {h % 2 === 0 && h > 0 ? `${String(h).padStart(2, "0")}:00` : ""}
            </span>
          ))}
        </div>
      </div>
      {days.map((d) => (
        <DayRow
          key={d}
          day={d}
          today={d === today}
          items={items}
          host={cols}
          moving={moving?.day === d ? moving : null}
          grab={onWrite ? grab : undefined}
          onOpen={onOpen}
          onMenu={onMenu}
          onAsk={onAsk}
        />
      ))}
    </div>
  );
}

/**
 * One day of the rows: its date and every all-day thing it holds at the start, then the day's track
 * with the hours across. Overlapping timed events take a lane each, 26px apart, so each one is 24px
 * tall; the row grows to hold them — and any all-day things — and the track fills it.
 */
function DayRow({
  day,
  today,
  items,
  host,
  moving,
  grab,
  onOpen,
  onMenu,
  onAsk,
}: {
  day: string;
  today: boolean;
  items: CalItem[];
  /** The rows view, which holds every day's start cell: a drag across days paints them all. */
  host: RefObject<HTMLElement | null>;
  moving: Ghost | null;
  grab?: Grab;
  onOpen(name: string): void;
  onMenu: AskMenu;
  onAsk?(start: string, end: string | null, x: number, y: number): void;
}) {
  const placed = useMemo(() => blocks(items, day), [items, day]);
  /* Everything all day on this day — a trip shows on each day of it, as a day reads it. */
  const allDay = useMemo(() => items.filter((i) => i.allDay && i.first <= day && day <= i.last), [items, day]);
  const lanes = Math.max(1, ...placed.map((b) => b.col + 1));
  const drawDays = useDayRange(host, (from, to, x, y) => onAsk?.(from, to === from ? null : to, x, y));
  const { range, onPointerDown } = useTimeDraw(day, "x", onAsk);
  const now = today
    ? (() => {
        const at = wallOf(Date.now());
        return at.hour * 60 + at.minute;
      })()
    : null;
  return (
    <div className="dag-cal-row" data-today={today ? "" : undefined}>
      <div className="dag-cal-row__day">
        <span className="dag-cal-row__weekday">{WEEKDAY.format(calendarDate(day))}</span>
        <span className="dag-cal-row__n">{Number(day.slice(8, 10))}</span>
      </div>
      <div
        className="dag-cal-row__start"
        data-dag-cal-day={day}
        data-dag-cal-start={day}
        onPointerDown={onAsk ? drawDays : undefined}
      >
        {allDay.map((item) => (
          <ItemLink key={`${item.kind}:${item.name}`} item={item} grab={grab} axis="y" onOpen={onOpen} onMenu={onMenu} />
        ))}
      </div>
      <div
        className="dag-cal-row__track"
        data-dag-cal-row={day}
        style={{ "--lanes": lanes } as CSSProperties}
        onPointerDown={onPointerDown}
      >
        <RangeGhost range={range} />
        {placed.map((b) => (
          <ItemLink
            key={`${b.item.kind}:${b.item.name}`}
            item={b.item}
            before={b.before}
            after={b.after}
            style={{ "--at": b.top, "--len": b.length, "--lane": b.col } as CSSProperties}
            grab={grab}
            axis="x"
            onOpen={onOpen}
            onMenu={onMenu}
          />
        ))}
        <MovingGhost moving={moving} />
        {now !== null ? <div className="dag-cal-now" style={{ "--at": now } as CSSProperties} aria-hidden="true" /> : null}
      </div>
    </div>
  );
}

/* -- the card that sets up what was drawn ----------------------------------------------------- */

/**
 * What a drawn range becomes: a title, its start and end, whether it is all day, and an optional
 * description. Enter still makes the event at once, so the quick path is the one it was; Escape
 * leaves nothing.
 *
 * The fields are the event bar's (`EventBar`): the same writers, so a time is shown and written in
 * the viewer's zone, a start changed keeps how long it is (`withStart`), an end that would come
 * before the start is moved an hour on (`withEnd`), and the switch takes the event to the all-day
 * row and back (`withAllDay`). The title alone keeps its own field, focused, above them.
 *
 * Placed where the drag ended and nudged back inside the window. It owns its own Escape and stops
 * it, the settings card's rule, so the window's handlers never see a key meant for it.
 */
function NewEvent({
  making,
  locked = false,
  onMake,
  onClose,
}: {
  making: Making;
  /** The app is read-only: the card opens to say why, and nothing it offers can write. */
  locked?: boolean;
  onMake(title: string, when: NoteEvent, description: string): Promise<void>;
  onClose(): void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<NoteEvent>(() =>
    making.end ? { start: making.start, end: making.end } : { start: making.start },
  );
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState({ x: making.x, y: making.y });
  /* The zone is read below (`zoneName`), so a change of it draws the card again. */
  useZone();
  const f = fieldsOf(draft);
  const zone = f.allDay ? "" : zoneName(momentOf(draft.start));
  const id = useId();
  const allDayId = `${id}all-day`;
  const startDayId = `${id}start-day`;
  const startTimeId = `${id}start-time`;
  const endDayId = `${id}end-day`;
  const endTimeId = `${id}end-time`;
  const off = locked || busy;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(making.x + 8, innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(making.y + 8, innerHeight - r.height - 8)),
    });
    titleField.current?.focus();
  }, [making]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [onClose]);

  /* The event bar's writers: an end nobody has stays no line, not an empty one (`asEvent`). */
  const setAllDay = (on: boolean) => setDraft((d) => asEvent(withAllDay(d, on)));
  const setStart = (day: string, time?: string) => setDraft((d) => asEvent(withStart(d, day, time)));
  const setEnd = (day: string, time?: string) => setDraft((d) => asEvent(withEnd(d, day, time)));

  const submit = async () => {
    if (locked) return void refuseLocked();
    if (busy) return;
    setBusy(true);
    await onMake(title, draft, description);
    onClose();
  };
  return (
    <form
      ref={ref}
      className="dag-calendar__new"
      data-dag-calendar-new=""
      style={{ left: pos.x, top: pos.y }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e: ReactKeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <input
        ref={titleField}
        type="text"
        className="dag-calendar__new-field dag-calendar__new-title"
        placeholder="New event"
        aria-label="The event's title"
        value={title}
        disabled={busy}
        readOnly={locked}
        aria-disabled={locked || undefined}
        title={locked ? LOCK_HINT : undefined}
        data-dag-calendar-new-title=""
        data-dag-readonly-blocked={locked ? "" : undefined}
        onChange={(e) => setTitle(e.target.value)}
      />
      <p className="dag-calendar__new-when" data-dag-calendar-new-when="">
        <CalendarClock size={14} strokeWidth={2} aria-hidden="true" />
        <span>{whenWords(draft)}</span>
        {zone ? (
          <span
            className="dag-calendar__new-zone"
            title={`Shown in ${currentZone().replace(/_/g, " ")}, and written with its offset. Settings → Calendar changes the time zone.`}
          >
            {zone}
          </span>
        ) : null}
      </p>
      {locked ? (
        <p className="dag-calendar__new-locked" data-dag-calendar-new-locked="" title={LOCK_HINT}>
          <Lock size={14} strokeWidth={2} aria-hidden="true" />
          <span>Read only — unlock to make an event.</span>
          <button
            type="button"
            className="dag-calendar__new-cancel"
            data-dag-calendar-new-unlock=""
            onClick={() => setLocked(false)}
          >
            Unlock
          </button>
        </p>
      ) : null}
      <div className="dag-calendar__new-allday">
        <label htmlFor={allDayId} className="dag-calendar__new-label">
          <Sun size={14} strokeWidth={2} aria-hidden="true" />
          All day
        </label>
        <Switch
          id={allDayId}
          checked={f.allDay}
          disabled={off}
          data-dag-calendar-new-allday=""
          onChange={(e) => setAllDay(e.target.checked)}
        />
      </div>
      <div className="dag-calendar__new-times">
        <label htmlFor={startDayId}>Starts</label>
        <input
          id={startDayId}
          type="date"
          className="dag-calendar__new-field"
          value={f.startDay}
          disabled={off}
          data-dag-calendar-new-start-day=""
          onChange={(e) => e.target.value && setStart(e.target.value)}
        />
        {f.allDay ? (
          <span aria-hidden="true" />
        ) : (
          <input
            id={startTimeId}
            type="time"
            step={900}
            className="dag-calendar__new-field"
            value={f.startTime}
            disabled={off}
            aria-label="Start time"
            data-dag-calendar-new-start-time=""
            onChange={(e) => e.target.value && setStart(f.startDay, e.target.value)}
          />
        )}
        <label htmlFor={endDayId}>Ends</label>
        <input
          id={endDayId}
          type="date"
          className="dag-calendar__new-field"
          value={f.endDay}
          min={f.startDay}
          disabled={off}
          data-dag-calendar-new-end-day=""
          onChange={(e) => e.target.value && setEnd(e.target.value)}
        />
        {f.allDay ? (
          <span aria-hidden="true" />
        ) : (
          <input
            id={endTimeId}
            type="time"
            step={900}
            className="dag-calendar__new-field"
            value={f.endTime}
            disabled={off}
            aria-label="End time"
            data-dag-calendar-new-end-time=""
            onChange={(e) => e.target.value && setEnd(f.endDay, e.target.value)}
          />
        )}
      </div>
      <textarea
        className="dag-calendar__new-field dag-calendar__new-description"
        placeholder="Description (optional)"
        aria-label="The event's description"
        rows={2}
        value={description}
        disabled={off}
        data-dag-calendar-new-description=""
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="dag-calendar__new-acts">
        <button type="button" className="dag-calendar__new-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="dag-calendar__new-make"
          data-dag-calendar-new-make=""
          aria-disabled={locked || undefined}
          title={locked ? LOCK_HINT : undefined}
          disabled={busy}
        >
          Make it
        </button>
      </div>
    </form>
  );
}
