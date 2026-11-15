import { collation } from "@/locale";
import { PRIORITIES, today, type Priority, type Task, type TaskStatus } from "@/note/task";

/**
 * How the Tasks page's list is ordered, grouped and narrowed (#311), with no drawing in it: the
 * Order, Display and Filter buttons each change one part of a {@link TaskDisplay} or a
 * {@link TaskFilters}, and the list is whatever these functions make of the rows.
 * `test/task-view.test.ts` holds them.
 *
 * The display is a preference — the person's, in every vault (`TASKS_DISPLAY` in `prefs.ts`),
 * read leniently by {@link displayOf} so a value written by a later build is never a broken page.
 * Nothing here is ever written to a vault file.
 */

/** What a row is to these rules: a task, what it is called, and the project it is in. */
export interface ViewRow {
  name: string;
  task: Task;
  title: string;
  project?: { name: string; title: string };
}

export const ORDER_KEYS = ["priority", "due", "start", "project", "changed", "title"] as const;
export type OrderKey = (typeof ORDER_KEYS)[number];

export const ORDER_LABEL: Readonly<Record<OrderKey, string>> = {
  priority: "Priority",
  due: "Due date",
  start: "Start date",
  project: "Project",
  changed: "Last changed",
  title: "Title",
};

/** `first` is what comes first: the highest priority, the soonest date, A, the newest change. */
export type Direction = "first" | "last";

/** The two directions in each key's own words: what *highest first* means for a date or a title. */
export const DIRECTION_LABEL: Readonly<Record<OrderKey, Readonly<Record<Direction, string>>>> = {
  priority: { first: "Highest first", last: "Lowest first" },
  due: { first: "Soonest first", last: "Latest first" },
  start: { first: "Soonest first", last: "Latest first" },
  project: { first: "A to Z", last: "Z to A" },
  changed: { first: "Newest first", last: "Oldest first" },
  title: { first: "A to Z", last: "Z to A" },
};

export interface OrderSpec {
  by: OrderKey;
  dir: Direction;
}

export const GROUP_KEYS = ["status", "priority", "due", "project", "none"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const GROUP_LABEL: Readonly<Record<GroupKey, string>> = {
  status: "Status",
  priority: "Priority",
  due: "Due date",
  project: "Project",
  none: "No grouping",
};

/** The columns a row can leave out; the due date is always drawn. */
export const COLUMNS = ["priority", "items", "project", "changed"] as const;
export type TaskColumn = (typeof COLUMNS)[number];

export const COLUMN_LABEL: Readonly<Record<TaskColumn, string>> = {
  priority: "Priority",
  items: "Check items",
  project: "Project",
  changed: "Last changed",
};

export interface TaskDisplay {
  group: GroupKey;
  /** The order of the Open and All tabs, and what breaks its ties. */
  order: OrderSpec;
  tie: OrderSpec | null;
  /** The Done tab's: what was finished most recently first, until somebody says otherwise. */
  done: OrderSpec;
  doneTie: OrderSpec | null;
  /** The columns switched off. */
  hidden: TaskColumn[];
}

export const DEFAULT_DISPLAY: TaskDisplay = {
  group: "status",
  order: { by: "due", dir: "first" },
  tie: { by: "priority", dir: "first" },
  done: { by: "changed", dir: "first" },
  doneTie: null,
  hidden: [],
};

const isIn = <T extends string>(all: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (all as readonly string[]).includes(v);

function specOf(raw: unknown): OrderSpec | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const { by, dir } = raw as { by?: unknown; dir?: unknown };
  return isIn(ORDER_KEYS, by) ? { by, dir: dir === "last" ? "last" : "first" } : undefined;
}

/** A stored display, or the default for whatever part of it is missing or unreadable. */
export function displayOf(raw: string | null | undefined): TaskDisplay {
  let v: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) v = parsed as Record<string, unknown>;
  } catch {
    /* A value nobody can read is the default, not a broken page. */
  }
  const pick = (key: "order" | "tie" | "done" | "doneTie") => {
    const s = specOf(v[key]);
    return s === undefined ? DEFAULT_DISPLAY[key] : s;
  };
  return {
    group: isIn(GROUP_KEYS, v.group) ? v.group : DEFAULT_DISPLAY.group,
    order: pick("order") ?? DEFAULT_DISPLAY.order,
    tie: pick("tie"),
    done: pick("done") ?? DEFAULT_DISPLAY.done,
    doneTie: pick("doneTie"),
    hidden: Array.isArray(v.hidden) ? COLUMNS.filter((c) => (v.hidden as unknown[]).includes(c)) : [],
  };
}

/** What is stored: the display, or nothing when it is the default. */
export function displayText(d: TaskDisplay): string | null {
  const text = JSON.stringify(d);
  return text === JSON.stringify(DEFAULT_DISPLAY) ? null : text;
}

/** Urgent 0 … low 3; a task with no priority after low, whichever way the list runs. */
const PRIORITY_RANK: Readonly<Record<Priority, number>> = { urgent: 0, high: 1, medium: 2, low: 3 };

/**
 * One key's comparison, `first` direction: a task with no value for it — no priority, no date, no
 * project — goes last in **both** directions, because *lowest first* means low before high, not
 * nothing before everything.
 */
function compareOn(by: OrderKey, dir: Direction, a: ViewRow, b: ViewRow): number {
  const words = collation({ numeric: true });
  const value = (r: ViewRow): number | string | undefined => {
    switch (by) {
      case "priority":
        return r.task.priority ? PRIORITY_RANK[r.task.priority] : undefined;
      case "due":
        return r.task.due;
      case "start":
        return r.task.start;
      case "project":
        return r.project?.title;
      case "changed":
        /* Newest first is the larger number first. */
        return r.task.changed === undefined ? undefined : -r.task.changed;
      case "title":
        return r.title;
    }
  };
  const x = value(a);
  const y = value(b);
  if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
  const n = typeof x === "number" && typeof y === "number" ? x - y : words.compare(String(x), String(y));
  return dir === "first" ? n : -n;
}

/** A comparator for an order and its tie-break, ending on the title and then the name so it is total. */
export function compareRows(order: OrderSpec, then: OrderSpec | null): (a: ViewRow, b: ViewRow) => number {
  const words = collation({ numeric: true });
  return (a, b) =>
    compareOn(order.by, order.dir, a, b) ||
    (then ? compareOn(then.by, then.dir, a, b) : 0) ||
    words.compare(a.title, b.title) ||
    words.compare(a.name, b.name);
}

/** The due-date groups, in the order they are read. `earlier` holds the done tasks whose date has passed. */
export const DUE_BUCKETS = ["overdue", "today", "week", "later", "earlier", "none"] as const;
export type DueBucket = (typeof DUE_BUCKETS)[number];

export const DUE_BUCKET_LABEL: Readonly<Record<DueBucket, string>> = {
  overdue: "Overdue",
  today: "Today",
  week: "Next 7 days",
  later: "Later",
  earlier: "Earlier",
  none: "No date",
};

/** `YYYY-MM-DD` plus `days`, counted on the calendar rather than in hours. */
function plusDays(iso: string, days: number): string {
  const at = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days));
  return at.toISOString().slice(0, 10);
}

/** Which due-date group a task is in. A done task is never overdue: its passed date is *Earlier*. */
export function dueBucket(task: Task, now: string = today()): DueBucket {
  if (!task.due) return "none";
  if (task.due < now) return task.status === "done" ? "earlier" : "overdue";
  if (task.due === now) return "today";
  return task.due <= plusDays(now, 7) ? "week" : "later";
}

/** One heading of the list: what it is called, and the rows under it, already in order. */
export interface RowGroup<R extends ViewRow> {
  key: string;
  label: string;
  /** What the group is by, for the heading's mark: a status, a priority, a project's name. */
  by: GroupKey;
  rows: R[];
}

/** The status groups' reading order: what is being worked on first. */
const STATUS_ORDER: readonly TaskStatus[] = ["in-progress", "todo", "done"];
const STATUS_WORDS: Readonly<Record<TaskStatus, string>> = { todo: "To do", "in-progress": "In progress", done: "Done" };
const PRIORITY_WORDS: Readonly<Record<Priority, string>> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };

/**
 * The rows under their headings, each group in the order given. A status is always given its three
 * groups and a priority its five, empty or not, so a `+` can make the first task of one; the due
 * dates and the projects show only the groups something is in. `none` is one group with no heading.
 */
export function groupRows<R extends ViewRow>(
  rows: readonly R[],
  group: GroupKey,
  compare: (a: R, b: R) => number,
  now: string = today(),
): RowGroup<R>[] {
  const sorted = [...rows].sort(compare);
  const of = (key: (r: R) => string) => {
    const out = new Map<string, R[]>();
    for (const r of sorted) {
      const k = key(r);
      out.set(k, [...(out.get(k) ?? []), r]);
    }
    return out;
  };
  switch (group) {
    case "none":
      return [{ key: "all", label: "Tasks", by: "none", rows: sorted }];
    case "status": {
      const by = of((r) => r.task.status);
      return STATUS_ORDER.map((s) => ({ key: s, label: STATUS_WORDS[s], by: "status", rows: by.get(s) ?? [] }));
    }
    case "priority": {
      const by = of((r) => r.task.priority ?? "none");
      return [...PRIORITIES, "none" as const].map((p) => ({
        key: p,
        label: p === "none" ? "No priority" : PRIORITY_WORDS[p],
        by: "priority",
        rows: by.get(p) ?? [],
      }));
    }
    case "due": {
      const by = of((r) => dueBucket(r.task, now));
      return DUE_BUCKETS.filter((b) => by.has(b)).map((b) => ({
        key: b,
        label: DUE_BUCKET_LABEL[b],
        by: "due",
        rows: by.get(b)!,
      }));
    }
    case "project": {
      const by = of((r) => r.project?.name ?? "");
      const titles = new Map(sorted.map((r) => [r.project?.name ?? "", r.project?.title ?? "No project"]));
      const words = collation({ numeric: true });
      return [...by.keys()]
        .sort((a, b) => (a === "" ? 1 : b === "" ? -1 : words.compare(titles.get(a)!, titles.get(b)!)))
        .map((k) => ({ key: k, label: titles.get(k)!, by: "project", rows: by.get(k)! }));
    }
  }
}

/** What the Filter button narrows the list by: in each field, the values any of which a row must have. */
export interface TaskFilters {
  status: TaskStatus[];
  /** `none` is a task with no priority. */
  priority: (Priority | "none")[];
  /** A project's note's name, or `""` for the tasks in no project. */
  project: string[];
  due: DueBucket[];
}

export const FILTER_FIELDS = ["status", "priority", "project", "due"] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

export const FILTER_LABEL: Readonly<Record<FilterField, string>> = {
  status: "Status",
  priority: "Priority",
  project: "Project",
  due: "Due date",
};

export const NO_FILTERS: TaskFilters = { status: [], priority: [], project: [], due: [] };

/** A row's value in one field, as the filter names it. */
function valueIn(field: FilterField, r: ViewRow, now: string = today()): string {
  switch (field) {
    case "status":
      return r.task.status;
    case "priority":
      return r.task.priority ?? "none";
    case "project":
      return r.project?.name ?? "";
    case "due":
      return dueBucket(r.task, now);
  }
}

/** Whether a row passes every field in use; a field with no values chosen lets everything through. */
export function passes(filters: TaskFilters, r: ViewRow, now: string = today(), except?: FilterField): boolean {
  return FILTER_FIELDS.every(
    (f) => f === except || filters[f].length === 0 || (filters[f] as readonly string[]).includes(valueIn(f, r, now)),
  );
}

/** How many fields are in use: one chip each. */
export const filtersInUse = (filters: TaskFilters): FilterField[] => FILTER_FIELDS.filter((f) => filters[f].length > 0);

/** One value switched on or off in one field. */
export function toggleFilter(filters: TaskFilters, field: FilterField, value: string): TaskFilters {
  const had = filters[field] as readonly string[];
  const next = had.includes(value) ? had.filter((v) => v !== value) : [...had, value];
  return { ...filters, [field]: next };
}

/**
 * How many rows each value of a field would leave, counted with the other fields' filters on and
 * this field's off — what the submenu's numbers say, so ticking a second value adds what it says.
 */
export function valueCounts(
  rows: readonly ViewRow[],
  filters: TaskFilters,
  field: FilterField,
  now: string = today(),
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!passes(filters, r, now, field)) continue;
    const v = valueIn(field, r, now);
    out.set(v, (out.get(v) ?? 0) + 1);
  }
  return out;
}
