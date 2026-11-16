import { collation } from "@/locale";
import { today, type Task, type TaskStatus } from "@/note/task";

/**
 * The Tasks page's rules with no drawing in them (#311): which tab a task is on, how its date and
 * its last change are said, and what the count line says. `test/task-model.test.ts` holds them.
 */

/** The three tabs in the top bar: what is still to do, what is finished, and both. */
export const TABS = ["open", "done", "all"] as const;
export type TaskTab = (typeof TABS)[number];

export const TAB_LABEL: Readonly<Record<TaskTab, string>> = { open: "Open", done: "Done", all: "All" };

/** Whether a task in `status` is listed on `tab`. */
export const onTab = (status: TaskStatus, tab: TaskTab): boolean =>
  tab === "all" ? true : tab === "done" ? status === "done" : status !== "done";

/** A stored tab, or the open one for anything else. */
export const tabOf = (raw: string | null | undefined): TaskTab =>
  (TABS as readonly string[]).includes(raw ?? "") ? (raw as TaskTab) : "open";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * When a task last changed, as few characters as a column can hold: *now*, *5m*, *2h*, *3d*,
 * *2w*, *4mo*, *1y*. A time in the future — a clock that disagrees with the disk's — is *now*.
 */
export function sinceText(changed: number, now: number = Date.now()): string {
  const d = Math.max(0, now - changed);
  if (d < MINUTE) return "now";
  if (d < HOUR) return `${Math.floor(d / MINUTE)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d`;
  if (d < 35 * DAY) return `${Math.floor(d / (7 * DAY))}w`;
  if (d < 365 * DAY) return `${Math.max(1, Math.floor(d / (30 * DAY)))}mo`;
  return `${Math.floor(d / (365 * DAY))}y`;
}

/** What the count line under the top bar says, off the tasks the tab and the scope keep. */
export interface Counted {
  /** Every task the tab lists, before the words in the filter field narrow them. */
  all: number;
  /** How many of them the words leave. */
  shown: number;
  /** Of those, how many are past their date and not done. */
  late: number;
}

/**
 * *13 open, 2 overdue*; *3 done*; *16 tasks, 2 overdue*. With words in the filter field, how many of
 * the tab's they leave: *3 of 13 open*.
 */
export function countLine(tab: TaskTab, c: Counted, filtered: boolean): string {
  const noun = tab === "open" ? "open" : tab === "done" ? "done" : c.all === 1 ? "task" : "tasks";
  const head = filtered ? `${c.shown} of ${c.all} ${noun}` : `${c.all} ${noun}`;
  return c.late && tab !== "done" ? `${head}, ${c.late} overdue` : head;
}

/** The Done tab's order: what was finished most recently first, then by title. */
export function compareRecent(a: { task: Task; title: string }, b: { task: Task; title: string }): number {
  return (b.task.changed ?? 0) - (a.task.changed ?? 0) || collation({ numeric: true }).compare(a.title, b.title);
}

/**
 * How far a due date is, in words, for a task's page: *Due today*, *1 day left*, *7 days left*,
 * *2 days late*. Nothing for a done task — its date says when and nothing more, as on the row.
 */
export function dueDistance(due: string, status: TaskStatus, now: string = today()): string {
  if (status === "done") return "";
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const diff = Math.round((day(due) - day(now)) / 86_400_000);
  if (diff === 0) return "Due today";
  const n = Math.abs(diff);
  return `${n} ${n === 1 ? "day" : "days"} ${diff > 0 ? "left" : "late"}`;
}

/** When a task last changed, in words, for its page: *just now*, *5 minutes ago*, *3 days ago*. */
export function changedWords(changed: number, now: number = Date.now()): string {
  const s = Math.max(0, (now - changed) / 1000);
  const say = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (s < 60) return "just now";
  if (s < 3600) return say(Math.floor(s / 60), "minute");
  if (s < 86_400) return say(Math.floor(s / 3600), "hour");
  if (s < 30 * 86_400) return say(Math.floor(s / 86_400), "day");
  if (s < 365 * 86_400) return say(Math.floor(s / (30 * 86_400)), "month");
  return say(Math.floor(s / (365 * 86_400)), "year");
}

/*
 * The order the Tasks page last drew its rows in — the tab, the filter, the grouping and the order
 * as they were — so a task's page can step to the one before and after it ("2 of 13"). Kept in this
 * module rather than in storage: it is what this tab was just looking at, and a reload that lost it
 * falls back to the page's default order.
 */
let lastOrder: readonly string[] | null = null;

export function rememberOrder(names: readonly string[]): void {
  lastOrder = names;
}

/** The order to step through: the Tasks page's last one when it holds `name`, else `fallback`. */
export function stepOrder(name: string, fallback: () => readonly string[]): readonly string[] {
  return lastOrder?.includes(name) ? lastOrder : fallback();
}
