/**
 * An event: a note whose frontmatter has a `start:` and no `status:`.
 *
 * The task decision a second time. A task is a note with a `status:`; an event is a note with a
 * `start:` and, optionally, an `end:` — so it has the block editor for its description, references,
 * backlinks, search, share and export because it is a note, and a note becomes an event by gaining
 * the line and stops being one by losing it.
 *
 * **All day is a date and a time is a time.** `start: 2026-10-12` is an all-day event and there is
 * no `all-day:` key, because a second key that could disagree with the first is a question two
 * parsers would have to answer alike for ever. An all-day `end:` is the last day, inclusive; a timed
 * one is the moment it stops. A time carries its offset — every writer this app owns writes one —
 * and one written by hand without is read as that time in the zone of whoever is viewing.
 *
 * **"Here" is the reader's zone, `zone.ts`'s**: the account's choice in Settings, or the
 * machine's when there is none. Every function below that turns a moment into a day or a clock
 * reading, or back, reads it there — never through `Date`'s local getters, which know only the
 * machine's.
 *
 * **`status:` decides first.** A note with one is a task, and a `start:` on it is the task's start
 * date (`taskOf`); it is never also an event.
 *
 * **One parser reads an event**, this one, imported by the page, the server and the CLI, and held to
 * `test/fixtures/events.json`. It checks the *form* of a value and never the order of two: whether `09:00+02:00` is before `04:00-05:00` is arithmetic the
 * calendar does in the viewer's zone (`src/calendar/`), and a second place deciding it would be a
 * second answer.
 *
 * No browser, no React, no `@/` aliases: the local server imports this through `src/refs/extract.ts`.
 */
import { parse as parseYaml } from "yaml";

import { dueOf, statusOf, withKeys } from "./task";
import { instantOf, offsetOf, wallOf } from "./zone";

/** What an event is, off its frontmatter: `start`, and `end` when it has one in the same form. */
export interface NoteEvent {
  start: string;
  end?: string;
}

/** What a write asks for: a key left out stays as it is, `null` takes its line out. */
export interface EventChange {
  start?: string | null;
  end?: string | null;
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * A time as a person or an agent writes one. The separator may be a `T`, a `t` or one space; the
 * seconds are optional; the offset is `Z` or `±HH:MM`, and `±HHMM` and `±HH` are read as the same.
 */
const TIME = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2}))?([Zz]|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * A `start:` or `end:` value, written the one way both parsers write it — or `undefined` when it is
 * neither a real calendar date nor a real time.
 *
 * Lenient in spelling only, `statusOf`'s rule: the separator and the offset's punctuation. An hour
 * is `00` to `23` (so `24:00` is not a time), an offset at most fourteen hours either way, which is
 * as far from UTC as any place on earth keeps its clocks.
 */
export function whenOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  const day = dueOf(s);
  if (day) return day;
  const m = TIME.exec(s);
  if (!m) return undefined;
  const [, date, hh, mm, ss, zone] = m;
  if (!dueOf(date) || Number(hh) > 23 || Number(mm) > 59 || (ss !== undefined && Number(ss) > 59)) return undefined;
  const time = `${date}T${hh}:${mm}${ss !== undefined ? `:${ss}` : ""}`;
  if (zone === undefined) return time;
  if (zone === "Z" || zone === "z") return `${time}Z`;
  const digits = zone.slice(1).replace(":", "");
  const [oh, om] = [digits.slice(0, 2), digits.length > 2 ? digits.slice(2) : "00"];
  if (Number(oh) > 14 || Number(om) > 59 || (Number(oh) === 14 && Number(om) > 0)) return undefined;
  return `${time}${zone[0]}${oh}:${om}`;
}

/** Whether a value `whenOf` returned is a date — all day — rather than a time. */
export const isDay = (when: string): boolean => when.length === 10;

/** Whether a time says where in the world it was: an offset, or `Z`. */
export const hasOffset = (when: string): boolean => /(?:Z|[+-]\d{2}:\d{2})$/.test(when);

/** Whether an event lasts whole days — its `start:` is a date. */
export const allDay = (event: NoteEvent): boolean => isDay(event.start);

/** The event a note's text describes, or `undefined` for a note that is not one. */
export function eventOf(text: string): NoteEvent | undefined {
  const m = FRONT.exec(text);
  if (!m) return undefined;
  let data: unknown;
  try {
    data = parseYaml(m[1]!);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const fields = data as { status?: unknown; start?: unknown; end?: unknown };
  if (statusOf(fields.status)) return undefined;
  const start = whenOf(fields.start);
  if (!start) return undefined;
  const end = whenOf(fields.end);
  return end && isDay(end) === isDay(start) ? { start, end } : { start };
}

/** `text` with its frontmatter's `start:` and `end:` set as `change` asks — `withTask`'s rule. */
export function withEvent(text: string, change: EventChange): string {
  return withKeys(text, change, ["start", "end"]);
}

/* -- writing a time --------------------------------------------------------------------------- */

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");

/** A day as a `start:` writes it, `YYYY-MM-DD`: the day it is here at `at`. */
export function dayOf(at: Date | number): string {
  const w = wallOf(at);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** The offset clocks here keep at `at` — `+02:00` — which a summer and a winter date differ in. */
export function offsetAt(at: Date | number): string {
  const east = offsetOf(at);
  return `${east < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(east) / 60))}:${pad(Math.abs(east) % 60)}`;
}

/**
 * A moment as every writer here writes a time: the wall clock here at `at`, to the minute, and the
 * offset it keeps then — `2026-10-03T09:00+02:00`. The page, the CLI and the calendar all write
 * through this, which is what "a time carries its offset" means in practice.
 */
export function timeOf(at: Date | number): string {
  const w = wallOf(at);
  return `${dayOf(at)}T${pad(w.hour)}:${pad(w.minute)}${offsetAt(at)}`;
}

/**
 * The moment a value names, as a `Date`. A date is its midnight here; a time with an offset is that
 * instant; a time without one is that wall-clock time here — taken apart by hand, because ECMAScript
 * reads one with no offset in the machine's zone and a date alone as UTC, and neither is "here".
 */
export function momentOf(when: string): Date {
  if (isDay(when)) {
    const [y, m, d] = when.split("-").map(Number) as [number, number, number];
    return new Date(instantOf({ year: y, month: m, day: d }));
  }
  if (hasOffset(when)) return new Date(when);
  const [date, clock] = when.split("T") as [string, string];
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm, ss] = clock.split(":").map(Number) as [number, number, number | undefined];
  return new Date(instantOf({ year: y, month: m, day: d, hour: hh, minute: mm, second: ss ?? 0 }));
}

/**
 * Whatever a person or an agent types for a moment, as a value to write — `whenOf`'s spelling, with
 * the offset here added to a time that has none. `undefined` when it is not a date or a time. The
 * CLI's `--start` and `--end`, and the page's fields, go through this: a writer supplies the offset.
 */
export function withZone(raw: string): string | undefined {
  const when = whenOf(raw);
  if (!when || isDay(when) || hasOffset(when)) return when;
  return `${when}${offsetAt(momentOf(when))}`;
}

/**
 * Where a new event starts when nobody says: the next whole hour on the clock here, an hour long —
 * what New event, *Make it an event* and `anydag event new` with no `--start` all write.
 */
export function nextHourEvent(now: Date = new Date()): { start: string; end: string } {
  const w = wallOf(now);
  const at = instantOf({ year: w.year, month: w.month, day: w.day, hour: w.hour + 1 });
  return { start: timeOf(at), end: timeOf(at + 3_600_000) };
}
