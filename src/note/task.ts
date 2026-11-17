/**
 * A task: a note whose frontmatter has a `status:`.
 *
 * Nothing else marks one, so the file is a note in every other respect — the block editor, the
 * references in its description, search, share, export — and a note becomes a task by gaining a
 * status and stops being one by losing it. `due:` is an optional calendar date beside it.
 *
 * **One parser reads a task**, this one: the local server's list route, the page, the CLI and the
 * MCP tools all import it, with `test/fixtures/tasks.json` as the list of cases.
 *
 * No browser, no React, no `@/` aliases: the local server imports this through `src/refs/extract.ts`.
 */
import { parse as parseYaml } from "yaml";
import { collation } from "../locale";

import { frontBlock } from "./front";
import { QUIET } from "./quiet";

/** The three a task can be, in the order work moves through them — the Tasks page's columns. */
export const STATUSES = ["todo", "in-progress", "done"] as const;
export type TaskStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Readonly<Record<TaskStatus, string>> = { todo: "To do", "in-progress": "In progress", done: "Done" };

/**
 * How much a task matters, most first (#311). No `priority:` line is none — the default, and what
 * most tasks are — so there is no fifth word for it in the file.
 */
export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABEL: Readonly<Record<Priority, string>> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * What a task is, off its frontmatter. `due` is `YYYY-MM-DD`, and absent when there is none; so is
 * `start`, the day it begins — a task with both spans the days between on the calendar.
 */
export interface Task extends TaskFacts {
  status: TaskStatus;
  due?: string;
  start?: string;
  priority?: Priority;
}

/**
 * What the listing knows of a task beside its frontmatter, **and never a line in the file** (#311):
 * how many check items its body ticks of how many it has, whether it has a body at all, and when
 * the file last changed. The first two are counted from the text by {@link taskFactsOf}; `changed`
 * is the file's own modified time, in ms, which only the server's stat knows. Each is absent when
 * there is nothing to say — no check items, no body, a task the page made a moment ago — so a quick
 * task is `{status, due}` and nothing more, and `withTask` never writes any of them.
 */
export interface TaskFacts {
  items?: { done: number; total: number };
  body?: true;
  changed?: number;
}

/** What a write asks for: a key left out stays as it is, `null` takes its line out. */
export interface TaskChange {
  status?: TaskStatus | null;
  due?: string | null;
  start?: string | null;
  priority?: Priority | null;
}

/**
 * A `status:` value, or `undefined` when it is not one of the three.
 *
 * Lenient in spelling only — case, and a space or an underscore where the hyphen goes, so `In
 * progress` and `to_do` are what they look like. Not in meaning: `doing` or `closed` would be a
 * table of synonyms two parsers had to agree on for ever, and a note that says `blocked` is saying
 * something the three columns cannot hold.
 */
export function statusOf(raw: unknown): TaskStatus | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (s === "to-do") return "todo";
  return (STATUSES as readonly string[]).includes(s) ? (s as TaskStatus) : undefined;
}

/**
 * A `priority:` value, or `undefined` for none — which is what any other value is read as, and the
 * line is left as it is in the file: a note saying `priority: P1` or `priority: 3` is not refused,
 * only drawn with none until someone picks one. Lenient in case and surrounding space only, as
 * {@link statusOf} is.
 */
export function priorityOf(raw: unknown): Priority | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase();
  return (PRIORITIES as readonly string[]).includes(s) ? (s as Priority) : undefined;
}

/**
 * A `due:` value, or `undefined` when it is not a real calendar date written `YYYY-MM-DD`.
 *
 * `setUTCFullYear` rather than `Date.UTC`, which reads a year below 100 as 1900-something and would
 * disagree with Python's `date` about `0026-10-03`. Year 0 is refused, which is Python's floor.
 */
export function dueOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1) return undefined;
  const at = new Date(0);
  at.setUTCFullYear(y, mo - 1, d);
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d ? s : undefined;
}

/** The task a note's text describes, or `undefined` for a note that is not one. */
export function taskOf(text: string): Task | undefined {
  const m = frontBlock(text);
  if (!m) return undefined;
  let data: unknown;
  try {
    data = parseYaml(m[1]!, QUIET);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const fields = data as { status?: unknown; due?: unknown; start?: unknown; priority?: unknown };
  const status = statusOf(fields.status);
  if (!status) return undefined;
  /* A task's start is a day, as its due date is: a timed `start:` is no start date. */
  const due = dueOf(fields.due);
  const start = dueOf(fields.start);
  const priority = priorityOf(fields.priority);
  return { status, ...(due ? { due } : {}), ...(start ? { start } : {}), ...(priority ? { priority } : {}) };
}

/** A Markdown check item, `- [ ]` or `1. [x]`, as remark's GFM reads one: the box and the space after it. */
const CHECK_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\[([ xX])\](?:\s|$)/;
/** A code fence's opening line: what it opens with is what closes it. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * What a task's text says beside its frontmatter: its check items, ticked of all, and whether it
 * has a body. Counted, never stored — the Tasks page's progress bar and page mark, and the task
 * page's *Check items*. A check item inside a code fence is an example, not a step, and is not counted.
 */
export function taskFactsOf(text: string): Pick<TaskFacts, "items" | "body"> {
  const m = frontBlock(text);
  const body = m ? text.slice(m[0].length) : text;
  if (body.trim() === "") return {};
  let done = 0;
  let total = 0;
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1]!;
      else if (f[1]!.startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const c = CHECK_ITEM.exec(line);
    if (!c) continue;
    total++;
    if (c[1] !== " ") done++;
  }
  return { body: true, ...(total ? { items: { done, total } } : {}) };
}

/**
 * A task as the listing carries it: {@link taskOf} and {@link taskFactsOf} together, with the time
 * the file last changed when the caller knows it. `undefined` for a note that is not a task.
 */
export function indexedTask(text: string, changed?: number | null): Task | undefined {
  const task = taskOf(text);
  if (!task) return undefined;
  return { ...task, ...taskFactsOf(text), ...(changed ? { changed: Math.round(changed) } : {}) };
}

/**
 * The Tasks page's order, and `anydag task ls`'s: in progress, then to do, then done — within each,
 * the soonest due first and a task with no date after every one that has one, then by title.
 */
/** Where each status sorts: what is being worked on first, what is finished last. */
const RANK: Readonly<Record<TaskStatus, number>> = { "in-progress": 0, todo: 1, done: 2 };

export function compareTasks(a: { task: Task; title: string }, b: { task: Task; title: string }): number {
  return (
    RANK[a.task.status] - RANK[b.task.status] ||
    (a.task.due ?? "9999-99-99").localeCompare(b.task.due ?? "9999-99-99") ||
    collation({ numeric: true }).compare(a.title, b.title)
  );
}

/** Today, here, as a `due:` is written — which is what "overdue" is measured against. */
export function today(at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(at.getFullYear()).padStart(4, "0")}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** A task past its date and not done. Dates compare as strings because they are written `YYYY-MM-DD`. */
export function overdue(task: Task, now: string = today()): boolean {
  return task.status !== "done" && task.due !== undefined && task.due < now;
}

/**
 * What a click on a task's status mark does (#311): the mark is the task's checkbox, so a task that
 * is not done is done, and a done one is to do again. In progress is one step further away — a
 * row's menu, `S` on the Tasks page, the task's own page — because a click that meant three things
 * in turn was a click nobody could make without looking.
 */
export function toggledStatus(status: TaskStatus): TaskStatus {
  return status === "done" ? "todo" : "done";
}

/**
 * `text` with its frontmatter's `status:`, `due:`, `start:` and `priority:` set as `change` asks — one line each,
 * and every other byte as it was.
 *
 * `with_title`'s rule, because a frontmatter is carried byte for byte by the note editor
 * and may hold keys and comments an agent wrote: a key's line, and any continuation lines indented
 * under it, is replaced where it is, or added at the end of the block, or taken out. A text with no
 * frontmatter grows one — with nothing after it, because everything after the block is the
 * Markdown the editor holds and a blank line there would be a change to the body nobody made. A
 * block that a removal leaves with nothing in it goes altogether: `---` twice with nothing between
 * is not a frontmatter to any reader here, and would draw as two rules.
 */
export function withTask(text: string, change: TaskChange): string {
  return withKeys(text, change, ["status", "priority", "due", "start"]);
}

/**
 * Where the key on `lines[at]` ends: the line after its last. A key's lines are its own, the lines
 * indented under it (a folded title, an indented list), and — when the key's line holds no value —
 * the `- ` lines at column 0 after it, which is a block list as Obsidian writes one (`tags:\n- a`).
 * Taking only the indented lines left such a list behind as YAML no reader parses (*Things that will
 * bite*).
 */
export function keyEnd(lines: readonly string[], at: number): number {
  const bare = /^[^:]*:\s*(#.*)?$/.test(lines[at]!);
  let end = at + 1;
  while (end < lines.length && (/^[ \t]/.test(lines[end]!) || (bare && /^-(\s|$)/.test(lines[end]!)))) end++;
  return end;
}

/**
 * `text` with the frontmatter lines `keys` names set as `change` asks — `withTask`'s rule for any
 * set of keys, and the one place it is written. A project's `project:` and `hue:` are the second
 * caller, and both fixtures hold it.
 */
export function withKeys(text: string, change: object, keys: readonly string[]): string {
  const m = frontBlock(text);
  const block = m ? m[1]! : "";
  /* Read off the whole block, fences included: a one-line block has no line end of its own to say. */
  const nl = m?.[0].includes("\r\n") ? "\r\n" : "\n";
  const lines = block === "" ? [] : block.split(nl);
  let removed = false;
  for (const key of keys) {
    if (!(key in change)) continue;
    /* An object rather than a record, so an interface — `TaskChange`, `ProjectChange` — is one. */
    const value = (change as Record<string, string | null | undefined>)[key];
    const at = lines.findIndex((raw) => new RegExp(`^${key}\\s*:`).test(raw));
    const end = at >= 0 ? keyEnd(lines, at) : at + 1;
    if (value === null || value === undefined) {
      if (at >= 0) {
        lines.splice(at, end - at);
        removed = true;
      }
    } else if (at >= 0) {
      lines.splice(at, end - at, `${key}: ${value}`);
    } else {
      /* After the last line with anything on it, so a blank line an author left at the end of the
         block stays at the end. */
      let last = lines.length;
      while (last > 0 && lines[last - 1]!.trim() === "") last--;
      lines.splice(last, 0, `${key}: ${value}`);
    }
  }
  if (!m) return lines.length ? `---\n${lines.join("\n")}\n---\n${text}` : text;
  if (removed && lines.every((l) => l.trim() === "")) return text.slice(m[0].length);
  const start = m[0].startsWith("---\r\n") ? 5 : 4;
  return text.slice(0, start) + lines.join(nl) + text.slice(start + block.length);
}

/**
 * The file name a title reads as — `Ship the pricing page` → `ship-the-pricing-page` — or `""` when
 * nothing in it can be spelled in a name. What a task typed into the Tasks page, or made with
 * `anydag task new`, is filed under.
 *
 * The stem a typed task is filed under (a local `/retitle` names a file by its title verbatim),
 * held to the `stems` cases in `test/fixtures/tasks.json` beside it: accents folded rather than dropped,
 * a `/` a character of the title and never a folder, and capped so a long title is not a long path.
 */
export function titleStem(title: string): string {
  const folded = title.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
  return folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}
