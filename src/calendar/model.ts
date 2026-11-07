/**
 * What the calendar shows, and where.
 *
 * Tasks, events and notes on one timeline: a task from its start date to its due date, an event from
 * its start to its end, a note on the day it was made. This file turns the listing into those spans
 * and lays them out — the days a view covers, the lanes a run of days packs its bars into, the
 * columns an hour grid splits overlapping events across — and draws nothing. The page
 * (`src/ui/Calendar.tsx`) is the drawing, and `anydag event ls` narrows by the same spans, which is
 * why this reads no DOM and imports no React.
 *
 * **A day is a string, `YYYY-MM-DD`, in the zone of whoever is looking.** Every event time is placed
 * in that zone — a time carries its offset and is shown in the viewer's —
 * and every piece of arithmetic on days is on the calendar itself — a day's number, in UTC, where
 * no clock ever changes — never twenty-four hours added to a moment, because a day with a clock
 * change in it is twenty-three or twenty-five.
 *
 * "The viewer's zone" is `src/note/zone.ts`'s: the person's choice, or the machine's.
 * So nothing here reads a `Date`'s local getters, which only ever know the machine's.
 */
import { dayOf, isDay, momentOf, timeOf, type NoteEvent } from "../note/event";
import type { Task } from "../note/task";
import { currentZone, instantOf, utc, wallOf } from "../note/zone";

/** The three things a calendar holds, in the order the toggles read. */
export const CAL_KINDS = ["task", "event", "note"] as const;
export type CalKind = (typeof CAL_KINDS)[number];

export const CAL_LABEL: Readonly<Record<CalKind, string>> = { task: "Tasks", event: "Events", note: "Notes" };

/** How long an event with no end lasts on the calendar — the length a calendar gives a new one. */
export const HOUR = 3_600_000;
const DAY = 86_400_000;

/** One thing on the calendar. */
export interface CalItem {
  kind: CalKind;
  /** The file, which is what opening it opens. */
  name: string;
  title: string;
  /** The first and the last day it touches, here, inclusive. */
  first: string;
  last: string;
  /**
   * Whether it sits in a day's all-day row rather than in the hour grid: everything but a timed
   * event, and a timed event that lasts a day or more, which is how every calendar draws a trip.
   */
  allDay: boolean;
  /** A timed event's start and end, in milliseconds. */
  at?: { start: number; end: number };
  task?: Task;
  event?: NoteEvent;
}

/** What the calendar reads off `/__board/list` — the page's `BoardTree` and the CLI's listing both have it. */
export interface Listing {
  notes: readonly string[];
  titles?: Readonly<Record<string, string>>;
  tasks?: Readonly<Record<string, Task>>;
  events?: Readonly<Record<string, NoteEvent>>;
  created?: Readonly<Record<string, string>>;
}

/* -- days ------------------------------------------------------------------------------------- */

/** A day as a `Date` at noon UTC — a calendar square, not a moment: read it with UTC getters or a formatter in `UTC`. */
export function calendarDate(day: string): Date {
  return new Date(utc(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), 12));
}

const utcDay = (at: Date): string =>
  `${String(at.getUTCFullYear()).padStart(4, "0")}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-${String(at.getUTCDate()).padStart(2, "0")}`;

/** `day` moved by `n` days along the calendar. */
export function addDays(day: string, n: number): string {
  const at = calendarDate(day);
  at.setUTCDate(at.getUTCDate() + n);
  return utcDay(at);
}

/** How many days from `a` to `b` — negative when `b` is earlier. By the calendar, not by the clock. */
export function daysBetween(a: string, b: string): number {
  const utc = (d: string) => {
    const at = new Date(0);
    at.setUTCFullYear(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
    return at.getTime();
  };
  return Math.round((utc(b) - utc(a)) / DAY);
}

/** The day of the week, `0` for Sunday to `6` for Saturday — `Date.getDay`'s numbering. */
export const weekday = (day: string): number => calendarDate(day).getUTCDay();

/** The first day of the week `day` is in, when a week starts on `weekStart` (`1` is Monday). */
export function startOfWeek(day: string, weekStart: number): string {
  return addDays(day, -((weekday(day) - weekStart + 7) % 7));
}

/** The first of `day`'s month. */
export const startOfMonth = (day: string): string => `${day.slice(0, 8)}01`;

/** `day` a number of months on, on the same date or the last of the month when that one is short. */
export function addMonths(day: string, n: number): string {
  const at = calendarDate(startOfMonth(day));
  at.setUTCMonth(at.getUTCMonth() + n);
  const month = utcDay(at);
  const last = addDays(startOfMonth(addDays(month, 32)), -1);
  const want = `${month.slice(0, 8)}${day.slice(8, 10)}`;
  return want > last ? last : want;
}

/** Every day from `first` to `last`, inclusive. */
export function daysFrom(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

/* -- views ------------------------------------------------------------------------------------ */

export const VIEWS = ["month", "week", "days"] as const;
export type CalView = (typeof VIEWS)[number];

/** How many days a run of days may be — enough for a fortnight, few enough that a column stays readable. */
export const MAX_DAYS = 14;

/** The days a view covers around `day`: whole weeks for a month, one week, or `count` days from `day`. */
export function rangeOf(view: CalView, day: string, weekStart: number, count: number): { first: string; last: string } {
  if (view === "month") {
    const first = startOfWeek(startOfMonth(day), weekStart);
    const end = addDays(startOfMonth(addMonths(day, 1)), -1);
    return { first, last: addDays(startOfWeek(end, weekStart), 6) };
  }
  if (view === "week") {
    const first = startOfWeek(day, weekStart);
    return { first, last: addDays(first, 6) };
  }
  return { first: day, last: addDays(day, Math.max(1, Math.min(MAX_DAYS, count)) - 1) };
}

/** Where the arrows go from `day`: a month, a week, or the run's own length either way. */
export function step(view: CalView, day: string, by: number, count: number): string {
  if (view === "month") return addMonths(day, by);
  if (view === "week") return addDays(day, 7 * by);
  return addDays(day, Math.max(1, Math.min(MAX_DAYS, count)) * by);
}

/* -- items ------------------------------------------------------------------------------------ */

/** Where an event sits: its days, and — timed — its moments. An end before the start is none. */
export function placeEvent(event: NoteEvent): Pick<CalItem, "first" | "last" | "allDay" | "at"> {
  if (isDay(event.start)) {
    const last = event.end && isDay(event.end) && event.end >= event.start ? event.end : event.start;
    return { first: event.start, last, allDay: true };
  }
  const start = momentOf(event.start).getTime();
  const said = event.end ? momentOf(event.end).getTime() : Number.NaN;
  const end = said > start ? said : start + HOUR;
  return {
    first: dayOf(new Date(start)),
    last: dayOf(new Date(end - 1)),
    allDay: end - start >= DAY,
    at: { start, end },
  };
}

/** Where a task sits: from its start to its due date, or on whichever of the two it has. */
export function placeTask(task: Task): Pick<CalItem, "first" | "last"> | undefined {
  const last = task.due ?? task.start;
  if (!last) return undefined;
  const first = task.start && task.start <= last ? task.start : last;
  return { first, last };
}

const RANK: Readonly<Record<CalKind, number>> = { event: 0, task: 1, note: 2 };

/**
 * Everything the listing puts on the calendar, of the kinds `show` names, that touches `first` to
 * `last` — in the order a day reads them: what starts earlier, then what lasts longer, then events
 * before tasks before notes, then by time, then by title.
 */
export function itemsOf(listing: Listing, show: ReadonlySet<CalKind>, first: string, last: string, keep: (name: string) => boolean = () => true): CalItem[] {
  const title = (name: string) => listing.titles?.[name] ?? name.slice(name.lastIndexOf("/") + 1);
  const out: CalItem[] = [];
  const add = (item: CalItem) => {
    if (item.last >= first && item.first <= last && keep(item.name)) out.push(item);
  };
  for (const name of listing.notes) {
    const task = listing.tasks?.[name];
    const event = listing.events?.[name];
    if (task) {
      const at = show.has("task") ? placeTask(task) : undefined;
      if (at) add({ kind: "task", name, title: title(name), ...at, allDay: true, task });
    } else if (event) {
      if (show.has("event")) add({ kind: "event", name, title: title(name), ...placeEvent(event), event });
    } else if (show.has("note")) {
      const made = listing.created?.[name];
      if (made) {
        const day = dayOf(new Date(made));
        add({ kind: "note", name, title: title(name), first: day, last: day, allDay: true });
      }
    }
  }
  return out.sort(
    (a, b) =>
      a.first.localeCompare(b.first) ||
      daysBetween(b.first, b.last) - daysBetween(a.first, a.last) ||
      RANK[a.kind] - RANK[b.kind] ||
      (a.at?.start ?? 0) - (b.at?.start ?? 0) ||
      a.title.localeCompare(b.title, undefined, { numeric: true }),
  );
}

/* -- lanes: bars across a run of days --------------------------------------------------------- */

export interface Bar {
  item: CalItem;
  /** The column it starts in and how many it covers, within the run. */
  col: number;
  span: number;
  lane: number;
  /** Whether it goes on before the run's first day, or after its last — drawn open at that end. */
  before: boolean;
  after: boolean;
}

/**
 * The items that touch `days`, packed into lanes so no two overlap — the lowest lane that is free,
 * in `itemsOf`'s order, which puts the long bars at the top where the eye finds them.
 */
export function lanes(items: readonly CalItem[], days: readonly string[]): Bar[] {
  if (!days.length) return [];
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const taken: boolean[][] = [];
  const out: Bar[] = [];
  for (const item of items) {
    if (item.last < first || item.first > last) continue;
    const col = Math.max(0, daysBetween(first, item.first));
    const end = Math.min(days.length - 1, daysBetween(first, item.last));
    let lane = 0;
    while (taken[lane]?.slice(col, end + 1).some(Boolean)) lane++;
    (taken[lane] ??= new Array<boolean>(days.length).fill(false)).fill(true, col, end + 1);
    out.push({ item, col, span: end - col + 1, lane, before: item.first < first, after: item.last > last });
  }
  return out;
}

/* -- the hour grid ---------------------------------------------------------------------------- */

export interface Block {
  item: CalItem;
  /** Minutes from the day's midnight to where it starts in this day, and how many it lasts here. */
  top: number;
  length: number;
  /** Which of `of` columns it takes, where it overlaps others. */
  col: number;
  of: number;
  /** Whether it started before this day, or goes on after it. */
  before: boolean;
  after: boolean;
}

/**
 * The timed items in one day's hour grid, each cut to the day, and side by side where they overlap:
 * a group of events that overlap one another, directly or through a third, shares the day's width,
 * each in the leftmost column free when it starts.
 */
export function blocks(items: readonly CalItem[], day: string): Block[] {
  const open = momentOf(day).getTime();
  const close = momentOf(addDays(day, 1)).getTime();
  const cut = items
    .filter((i) => !i.allDay && i.at && i.at.end > open && i.at.start < close)
    .map((item) => {
      const start = Math.max(item.at!.start, open);
      const end = Math.min(item.at!.end, close);
      return { item, start, end, before: item.at!.start < open, after: item.at!.end > close };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  /* Where a moment is on the day's grid, in wall-clock minutes: the grid is labelled by the clock, and
     a day with a clock change in it is 23 or 25 hours, so minutes since midnight would put every
     block after the change an hour off its label. A cut edge is the grid's own edge. */
  const wall = (t: number): number => {
    if (t <= open) return 0;
    if (t >= close) return 1440;
    const at = wallOf(t);
    return at.hour * 60 + at.minute + at.second / 60;
  };
  const out: Block[] = [];
  let group: (Block & { end: number })[] = [];
  let reach = -Infinity;
  const flush = () => {
    const of = Math.max(1, ...group.map((b) => b.col + 1));
    for (const b of group) out.push({ item: b.item, top: b.top, length: b.length, col: b.col, of, before: b.before, after: b.after });
    group = [];
  };
  for (const c of cut) {
    if (c.start >= reach && group.length) flush();
    const ends: number[] = [];
    for (const b of group) ends[b.col] = Math.max(ends[b.col] ?? -Infinity, b.end);
    let col = 0;
    while (ends[col] !== undefined && ends[col]! > c.start) col++;
    group.push({
      item: c.item,
      top: wall(c.start),
      length: Math.max(1, wall(c.end) - wall(c.start)),
      col,
      of: 1,
      before: c.before,
      after: c.after,
      end: c.end,
    });
    reach = Math.max(reach, c.end);
  }
  if (group.length) flush();
  return out;
}

/* -- words ------------------------------------------------------------------------------------ */

const clocks = new Map<string, Intl.DateTimeFormat>();
/* A day is a calendar square (`calendarDate`), so its words are read in UTC whatever zone is "here". */
const DAY_WORDS = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const DAY_YEAR = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A moment's time of day here — `09:00`. */
export function clock(at: number | Date): string {
  const zone = currentZone();
  let f = clocks.get(zone);
  if (!f) clocks.set(zone, (f = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone })));
  return f.format(at);
}

/** A day as a person reads it — `Sat, Oct 3`, with the year when it is not `thisYear`. */
export function dayWords(day: string, thisYear: string = dayOf(new Date()).slice(0, 4)): string {
  return (day.slice(0, 4) === thisYear ? DAY_WORDS : DAY_YEAR).format(calendarDate(day));
}

/**
 * When an event is, in words, here: `Sat, Oct 3, 09:00 – 17:00`, `Mon, Oct 12 – Wed, Oct 14`, or a
 * day alone. What the event's read-only line, a card on a board and `anydag event ls` say.
 */
export function whenWords(event: NoteEvent, thisYear?: string): string {
  const at = placeEvent(event);
  if (!at.at) return at.first === at.last ? dayWords(at.first, thisYear) : `${dayWords(at.first, thisYear)} – ${dayWords(at.last, thisYear)}`;
  const start = `${dayWords(at.first, thisYear)}, ${clock(at.at.start)}`;
  const endDay = dayOf(new Date(at.at.end));
  if (endDay === at.first || (at.last === at.first && clock(at.at.end) === "00:00")) return `${start} – ${clock(at.at.end)}`;
  return `${start} – ${dayWords(endDay, thisYear)}, ${clock(at.at.end)}`;
}

/* -- changing one: what the event bar writes -------------------------------------------------- */

/** An event as the bar's fields read it, here: whether all day, and each end's day and time of day. */
export interface EventFields {
  allDay: boolean;
  startDay: string;
  /** `HH:MM` here; empty when all day. */
  startTime: string;
  endDay: string;
  endTime: string;
}

const hhmm = (at: Date) => clock(at);

/** The fields a bar shows for an event: its start and its end, in this zone — an absent end as the one the calendar draws. */
export function fieldsOf(event: NoteEvent): EventFields {
  const at = placeEvent(event);
  if (!at.at) return { allDay: true, startDay: at.first, startTime: "", endDay: at.last, endTime: "" };
  const start = new Date(at.at.start);
  const end = new Date(at.at.end);
  return { allDay: false, startDay: dayOf(start), startTime: hhmm(start), endDay: dayOf(end), endTime: hhmm(end) };
}

/** A day and a time of day, here, as a moment. */
export function momentAt(day: string, time: string): Date {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return new Date(instantOf({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), day: Number(day.slice(8, 10)), hour: h || 0, minute: m || 0 }));
}

/**
 * What to write for fields a person set: every time with the offset here (`timeOf`), an end
 * that is not after the start moved to be — an hour on, or the same day — and an all-day end on the
 * start's day left out, because one day is what an event with no end already is.
 */
export function eventFrom(f: EventFields): { start: string; end: string | null } {
  if (f.allDay) {
    const end = f.endDay > f.startDay ? f.endDay : null;
    return { start: f.startDay, end };
  }
  const start = momentAt(f.startDay, f.startTime || "09:00");
  let end = momentAt(f.endDay || f.startDay, f.endTime || f.startTime || "09:00");
  if (end <= start) end = new Date(start.getTime() + HOUR);
  return { start: timeOf(start), end: timeOf(end) };
}

/** The same event all day, or at a time: a day's worth becomes nine to ten, and a time becomes its days. */
export function withAllDay(event: NoteEvent, on: boolean): { start: string; end: string | null } {
  const f = fieldsOf(event);
  if (on === f.allDay) return eventFrom(f);
  if (on) return eventFrom({ ...f, allDay: true, endDay: f.endDay > f.startDay && f.endTime === "00:00" ? addDays(f.endDay, -1) : f.endDay });
  return eventFrom({ ...f, allDay: false, startTime: "09:00", endDay: f.endDay, endTime: f.endDay > f.startDay ? "17:00" : "10:00" });
}

/**
 * The event moved to start at a new day or time, **keeping how long it is** — what every calendar does
 * when the start is changed, so moving a meeting does not stretch it to the old end.
 */
export function withStart(event: NoteEvent, day: string, time?: string): { start: string; end: string | null } {
  const f = fieldsOf(event);
  if (f.allDay) {
    const length = daysBetween(f.startDay, f.endDay);
    return eventFrom({ ...f, startDay: day, endDay: addDays(day, length) });
  }
  const was = momentAt(f.startDay, f.startTime).getTime();
  const long = momentAt(f.endDay, f.endTime).getTime() - was;
  const start = momentAt(day, time ?? f.startTime);
  const end = new Date(start.getTime() + long);
  return eventFrom({ ...f, startDay: day, startTime: time ?? f.startTime, endDay: dayOf(end), endTime: hhmm(end) });
}

/** The event with a new end — a last day, or a day and a time — pulled forward to the start if it would come first. */
export function withEnd(event: NoteEvent, day: string, time?: string): { start: string; end: string | null } {
  const f = fieldsOf(event);
  return eventFrom({ ...f, endDay: day, endTime: time ?? f.endTime });
}

/* -- moving one ---------------------------------------------------------------------- */

/**
 * An event moved by a drag: `days` along the calendar, and — timed — `minutes` along the clock,
 * keeping how long it is, as `withStart` does. A timed start lands on a multiple of `snap` minutes
 * (the grid's quarter hour) and crosses midnight into the next or the last day when it is pulled
 * that far; an all-day event moves by whole days and `minutes` means nothing to it.
 *
 * **An end nobody wrote stays unwritten.** An event with no `end:` is drawn an hour long, or one day,
 * and moving it is not a reason to put a line in its file that says so.
 */
export function shiftEvent(event: NoteEvent, days: number, minutes = 0, snap = 0): { start: string; end: string | null } {
  const f = fieldsOf(event);
  let moved: { start: string; end: string | null };
  if (f.allDay) moved = withStart(event, addDays(f.startDay, days));
  else {
    const [h, m] = f.startTime.split(":").map(Number) as [number, number];
    let at = h * 60 + m + minutes;
    if (snap > 0) at = Math.round(at / snap) * snap;
    const over = Math.floor(at / 1440);
    at -= over * 1440;
    moved = withStart(event, addDays(f.startDay, days + over), `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`);
  }
  return event.end ? moved : { start: moved.start, end: null };
}

/**
 * A task moved by a drag along the calendar: its start and its due date both, by `days` — a task
 * spans the days between, and moving it keeps that span. Only the dates it has are written.
 */
export function shiftTask(task: Task, days: number): { start?: string; due?: string } {
  return { ...(task.start ? { start: addDays(task.start, days) } : {}), ...(task.due ? { due: addDays(task.due, days) } : {}) };
}

/**
 * An event with one edge pulled: its start or its end moved to `day` — and, in
 * the hour grid, `time` — and the other edge left where it is. An edge is never pulled past the
 * other: an all-day event is at least its one day, and a timed one at least `min` minutes.
 */
export function withEdge(event: NoteEvent, edge: "start" | "end", day: string, time?: string, min = 15): { start: string; end: string | null } {
  const f = fieldsOf(event);
  if (f.allDay) {
    if (edge === "end") return eventFrom({ ...f, endDay: day < f.startDay ? f.startDay : day });
    return eventFrom({ ...f, startDay: day > f.endDay ? f.endDay : day });
  }
  const start = momentAt(f.startDay, f.startTime).getTime();
  const end = momentAt(f.endDay, f.endTime).getTime();
  const gap = min * 60_000;
  if (edge === "end") return { start: event.start, end: timeOf(new Date(Math.max(momentAt(day, time ?? f.endTime).getTime(), start + gap))) };
  return { start: timeOf(new Date(Math.min(momentAt(day, time ?? f.startTime).getTime(), end - gap))), end: timeOf(new Date(end)) };
}

/**
 * A task with one edge pulled: its start date or its due date, never past the other. A start pulled
 * onto the due date is no start at all — one day is what a task with only a due date already is.
 */
export function taskEdge(task: Task, edge: "start" | "end", day: string): { start?: string | null; due?: string | null } {
  const at = placeTask(task);
  if (!at) return {};
  if (edge === "end") {
    const due = day < at.first ? at.first : day;
    return { due, ...(task.start && task.start >= due ? { start: null } : {}) };
  }
  const start = day > at.last ? at.last : day;
  if (!task.due) return { start };
  return { start: start === task.due ? null : start };
}

/**
 * An event dropped on a day's all-day row: all day from that day, over as many days as it touched —
 * what a calendar does with a meeting dragged up into the all-day row.
 */
export function asAllDay(event: NoteEvent, day: string): { start: string; end: string | null } {
  const at = placeEvent(event);
  const span = daysBetween(at.first, at.last);
  return { start: day, end: span > 0 ? addDays(day, span) : null };
}

/**
 * An event dropped into the hour grid at `time` on `day`: an all-day one becomes an hour long, as a
 * new one is; a timed one keeps its length, and an end nobody wrote stays unwritten.
 */
export function asTimed(event: NoteEvent, day: string, time: string): { start: string; end: string | null } {
  if (isDay(event.start)) return eventFrom({ allDay: false, startDay: day, startTime: time, endDay: day, endTime: time });
  const moved = withStart(event, day, time);
  return event.end ? moved : { start: moved.start, end: null };
}
