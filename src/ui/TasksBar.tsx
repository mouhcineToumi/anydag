import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpNarrowWide,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarMinus,
  CalendarRange,
  CalendarX2,
  CaseSensitive,
  CircleSlash,
  Folder,
  History,
  ListChecks,
  ListFilter,
  Rows3,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";

import { STATUS_LABEL, STATUSES, PRIORITY_LABEL, type Priority, type TaskStatus } from "@/note/task";

import { Button, IconButton } from "./controls";
import { ProjectGlyph } from "./ProjectBar";
import { PriorityMark, TaskGlyph } from "./TaskGlyph";
import type { ProjectChoice } from "./taskMenus";
import type { MenuRow } from "./TasksMenu";
import {
  COLUMN_LABEL,
  COLUMNS,
  DIRECTION_LABEL,
  DUE_BUCKET_LABEL,
  DUE_BUCKETS,
  FILTER_FIELDS,
  FILTER_LABEL,
  GROUP_KEYS,
  GROUP_LABEL,
  ORDER_KEYS,
  ORDER_LABEL,
  type DueBucket,
  type FilterField,
  type GroupKey,
  type OrderKey,
  type OrderSpec,
  type TaskColumn,
  type TaskDisplay,
  type TaskFilters,
} from "./taskView";

/**
 * The Tasks page's filter line and its menus (#311): the Filter button and a chip for each field
 * in use, the Order button and the Display button — one quiet 24px button each — and the bar that
 * floats over the list while tasks are selected. The rules they change are `taskView.ts`'s; the
 * menu they open is `TasksMenu`, and every field and value in it carries its icon.
 */

const icon = (C: typeof Calendar) => <C size={14} strokeWidth={2} aria-hidden="true" />;

const DUE_ICON: Readonly<Record<DueBucket, typeof Calendar>> = {
  overdue: CalendarX2,
  today: CalendarCheck,
  week: CalendarRange,
  later: CalendarClock,
  earlier: CalendarMinus,
  none: CircleSlash,
};

/** The mark each filter field is drawn with, in the Filter menu and on its chip. */
function fieldIcon(field: FilterField): ReactNode {
  switch (field) {
    case "status":
      return <TaskGlyph status="in-progress" />;
    case "priority":
      return <PriorityMark priority="high" size={14} />;
    case "project":
      return icon(Folder);
    case "due":
      return icon(Calendar);
  }
}

/** One value of a field, as a menu row and a chip name it: its words and its mark. */
export function filterValue(
  field: FilterField,
  value: string,
  projects: readonly ProjectChoice[],
): { label: string; mark: ReactNode } {
  switch (field) {
    case "status":
      return { label: STATUS_LABEL[value as TaskStatus], mark: <TaskGlyph status={value as TaskStatus} /> };
    case "priority":
      return value === "none"
        ? { label: "No priority", mark: <PriorityMark size={14} /> }
        : { label: PRIORITY_LABEL[value as Priority], mark: <PriorityMark priority={value as Priority} size={14} /> };
    case "project": {
      const p = projects.find((c) => c.name === value);
      return p
        ? { label: p.title, mark: <ProjectGlyph project={p.project} /> }
        : { label: "No project", mark: icon(CircleSlash) };
    }
    case "due":
      return { label: DUE_BUCKET_LABEL[value as DueBucket], mark: icon(DUE_ICON[value as DueBucket]) };
  }
}

/** Every value a field offers, in the order the list reads them. */
function valuesOf(field: FilterField, projects: readonly ProjectChoice[]): string[] {
  switch (field) {
    case "status":
      return [...STATUSES];
    case "priority":
      return ["urgent", "high", "medium", "low", "none"];
    case "project":
      return [...projects.map((p) => p.name), ""];
    case "due":
      return [...DUE_BUCKETS];
  }
}

/** The Filter menu: the four fields, each opening its values. */
export const filterFieldRows = (filters: TaskFilters, open: (field: FilterField) => void): MenuRow[] =>
  FILTER_FIELDS.map((f) => ({
    key: f,
    label: FILTER_LABEL[f],
    icon: fieldIcon(f),
    hint: filters[f].length ? String(filters[f].length) : undefined,
    data: { "data-dag-tasks-filter-field": f },
    onPick: () => open(f),
    stay: true,
  }));

/** One field's values, each a box with how many tasks it would leave. */
export const filterValueRows = (
  field: FilterField,
  filters: TaskFilters,
  counts: ReadonlyMap<string, number>,
  projects: readonly ProjectChoice[],
  toggle: (value: string) => void,
): MenuRow[] => [
  { kind: "heading", key: "head", label: FILTER_LABEL[field] },
  ...valuesOf(field, projects)
    /* A due-date group nothing is in, and a done task's *Earlier*, are only offered when they hold something. */
    .filter((v) => field !== "due" || (counts.get(v) ?? 0) > 0 || (filters.due as string[]).includes(v))
    .map((v): MenuRow => {
      const { label, mark } = filterValue(field, v, projects);
      return {
        key: v || "none",
        label,
        icon: mark,
        box: true,
        checked: (filters[field] as string[]).includes(v),
        hint: String(counts.get(v) ?? 0),
        data: { "data-dag-tasks-filter-value": `${field}:${v}` },
        onPick: () => toggle(v),
        stay: true,
      };
    }),
];

const ORDER_ICON: Readonly<Record<OrderKey, ReactNode>> = {
  priority: <PriorityMark priority="high" size={14} />,
  due: icon(Calendar),
  start: icon(CalendarDays),
  project: icon(Folder),
  changed: icon(History),
  title: icon(CaseSensitive),
};

/** The Order menu: what first, which way, and what breaks a tie. Each pick leaves it open for the next. */
export function orderRows(
  order: OrderSpec,
  then: OrderSpec | null,
  set: (order: OrderSpec, then: OrderSpec | null) => void,
): MenuRow[] {
  const keys = (now: OrderKey | null, pick: (by: OrderKey) => void, hook: string, except?: OrderKey): MenuRow[] =>
    ORDER_KEYS.filter((k) => k !== except).map((k) => ({
      key: `${hook}-${k}`,
      label: ORDER_LABEL[k],
      icon: ORDER_ICON[k],
      checked: now === k,
      data: { [`data-dag-tasks-${hook}`]: k } as Record<`data-${string}`, string>,
      onPick: () => pick(k),
      stay: true,
    }));
  const dirs = (spec: OrderSpec, pick: (s: OrderSpec) => void, hook: string): MenuRow[] =>
    (["first", "last"] as const).map((dir) => ({
      key: `${hook}-${dir}`,
      label: DIRECTION_LABEL[spec.by][dir],
      icon: icon(dir === "first" ? ArrowDownWideNarrow : ArrowUpNarrowWide),
      checked: spec.dir === dir,
      data: { [`data-dag-tasks-${hook}`]: dir } as Record<`data-${string}`, string>,
      onPick: () => pick({ ...spec, dir }),
      stay: true,
    }));
  return [
    { kind: "heading", key: "h-order", label: "Order by" },
    ...keys(order.by, (by) => set({ by, dir: "first" }, then?.by === by ? null : then), "order", undefined),
    { kind: "rule", key: "r1" },
    ...dirs(order, (o) => set(o, then), "order-dir"),
    { kind: "rule", key: "r2" },
    { kind: "heading", key: "h-then", label: "Then by" },
    {
      key: "then-none",
      label: "Nothing",
      icon: icon(CircleSlash),
      checked: then === null,
      data: { "data-dag-tasks-then": "none" },
      onPick: () => set(order, null),
      stay: true,
    },
    ...keys(then?.by ?? null, (by) => set(order, { by, dir: "first" }), "then", order.by),
    ...(then ? [{ kind: "rule", key: "r3" } as MenuRow, ...dirs(then, (t) => set(order, t), "then-dir")] : []),
  ];
}

const GROUP_ICON: Readonly<Record<GroupKey, ReactNode>> = {
  status: <TaskGlyph status="in-progress" />,
  priority: <PriorityMark priority="high" size={14} />,
  due: icon(Calendar),
  project: icon(Folder),
  none: icon(Rows3),
};

const COLUMN_ICON: Readonly<Record<TaskColumn, ReactNode>> = {
  priority: <PriorityMark priority="high" size={14} />,
  items: icon(ListChecks),
  project: icon(Folder),
  changed: icon(History),
};

/** The Display menu: what the list is grouped by, and which columns a row draws. */
export const displayRows = (display: TaskDisplay, group: (g: GroupKey) => void, column: (c: TaskColumn) => void): MenuRow[] => [
  { kind: "heading", key: "h-group", label: "Group by" },
  ...GROUP_KEYS.map(
    (g): MenuRow => ({
      key: `group-${g}`,
      label: GROUP_LABEL[g],
      icon: GROUP_ICON[g],
      checked: display.group === g,
      data: { "data-dag-tasks-group-by": g },
      onPick: () => group(g),
      stay: true,
    }),
  ),
  { kind: "rule", key: "r" },
  { kind: "heading", key: "h-cols", label: "Columns" },
  ...COLUMNS.map(
    (c): MenuRow => ({
      key: `col-${c}`,
      label: COLUMN_LABEL[c],
      icon: COLUMN_ICON[c],
      box: true,
      checked: !display.hidden.includes(c),
      data: { "data-dag-tasks-column-toggle": c },
      onPick: () => column(c),
      stay: true,
    }),
  ),
  {
    key: "col-due",
    label: "Due date, always shown",
    icon: icon(Calendar),
    box: true,
    checked: true,
    disabled: true,
    onPick: () => {},
  },
];

/** A quiet 24px button of the filter line: Filter, Order, Display. */
export function LineButton({
  kind,
  label,
  onOpen,
  pressed,
}: {
  kind: "filter" | "order" | "display";
  label: string;
  onOpen(el: HTMLElement): void;
  pressed?: boolean;
}) {
  const Icon = kind === "filter" ? ListFilter : kind === "order" ? ArrowUpDown : SlidersHorizontal;
  return (
    <Button
      variant="quiet"
      size="sm"
      className="dag-tasks__line-button"
      aria-haspopup="menu"
      data-on={pressed ? "" : undefined}
      {...{ [`data-dag-tasks-${kind}-button`]: "" }}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {label}
    </Button>
  );
}

/** A field in use: its mark, its name and values, the menu of its values, and its own clear. */
export function FilterChip({
  field,
  filters,
  projects,
  onOpen,
  onClear,
}: {
  field: FilterField;
  filters: TaskFilters;
  projects: readonly ProjectChoice[];
  onOpen(el: HTMLElement): void;
  onClear(): void;
}) {
  const values = (filters[field] as string[]).map((v) => filterValue(field, v, projects).label);
  const words = values.length > 2 ? `${values.length} chosen` : values.join(", ");
  return (
    <span className="dag-tasks__chip" data-dag-tasks-chip={field}>
      <button
        type="button"
        className="dag-tasks__chip-open"
        aria-haspopup="menu"
        aria-label={`Filter: ${FILTER_LABEL[field]} is ${values.join(" or ")}`}
        onClick={(e) => onOpen(e.currentTarget)}
      >
        <span className="dag-tasks__chip-mark">{fieldIcon(field)}</span>
        <span className="dag-tasks__chip-field">{FILTER_LABEL[field]}:</span>
        <span className="dag-tasks__chip-words">{words}</span>
      </button>
      <button
        type="button"
        className="dag-tasks__chip-clear"
        aria-label={`Clear the ${FILTER_LABEL[field].toLowerCase()} filter`}
        data-dag-tasks-chip-clear={field}
        onClick={onClear}
      >
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    </span>
  );
}

/** What the bar over the list does to every selected task. */
export type BulkAction = "status" | "priority" | "due" | "project" | "trash";

/**
 * The bar that floats over the foot of the list while tasks are selected: how many, a menu for each
 * property, *Move to trash*, and the way out. Every change in it is one write per task, each with
 * its own `base`.
 */
export function BulkBar({
  count,
  onAction,
  onClear,
}: {
  count: number;
  onAction(a: BulkAction, el: HTMLElement): void;
  onClear(): void;
}) {
  const act = (a: Exclude<BulkAction, "trash">, label: string, mark: ReactNode) => (
    <Button
      variant="quiet"
      size="sm"
      aria-haspopup="menu"
      data-dag-tasks-bulk-action={a}
      onClick={(e) => onAction(a, e.currentTarget)}
    >
      {mark}
      {label}
    </Button>
  );
  return (
    <div className="dag-tasks__bulk" role="toolbar" aria-label="Selected tasks" data-dag-tasks-bulk="">
      <span className="dag-tasks__bulk-n" aria-live="polite" data-dag-tasks-bulk-count={count}>
        {count} selected
      </span>
      {act("status", "Status", <TaskGlyph status="in-progress" />)}
      {act("priority", "Priority", <PriorityMark priority="high" size={14} />)}
      {act("due", "Due date", icon(Calendar))}
      {act("project", "Project", icon(Folder))}
      <Button variant="quiet" size="sm" data-dag-tasks-bulk-action="trash" onClick={(e) => onAction("trash", e.currentTarget)}>
        {icon(Trash2)}
        Move to trash
      </Button>
      <IconButton size="sm" aria-label="Clear the selection" shortcut="Esc" data-dag-tasks-bulk-clear="" onClick={onClear}>
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
