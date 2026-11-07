/**
 * The frontmatter writers the routes need and the page has no copy of — `app/frontmatter.py`'s
 * `with_title` and `ends_before_it_starts`, and `app/zones.py`'s `placed`, ported. Everything else a
 * route reads or writes in a frontmatter is the page's own code (`src/note/task.ts`, `project.ts`,
 * `event.ts`), which the hosted api held to fixtures and this one simply imports.
 */

import { titleOf } from "../src/refs/extract";
import { hasOffset, isDay, whenOf, type NoteEvent } from "../src/note/event";
import { instantOf, utc, validZone } from "../src/note/zone";

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** A title that can go into YAML as it is; anything else is written double-quoted (JSON's syntax). */
const PLAIN = /^[A-Za-z][A-Za-z0-9 _.,()'&+-]*$/;
const WORDS = new Set(["true", "false", "null", "yes", "no", "on", "off", "y", "n"]);

export function scalar(title: string): string {
  if (PLAIN.test(title) && !WORDS.has(title.toLowerCase()) && !title.endsWith(" ")) return title;
  return JSON.stringify(title);
}

/**
 * `text` with its frontmatter's `title:` set — one line changed or added. A document with no
 * frontmatter grows one; a board's is followed by a blank line, a note's is not, because everything
 * after the block is the Markdown the editor holds.
 */
export function withTitle(text: string, title: string, kind = "board"): string {
  const line = `title: ${scalar(title)}`;
  const m = FRONT.exec(text);
  /* Saying it already, however it is quoted, is no change: `quiz_create` given a text and
     its own title re-quoted the line, and the base it answered was then not the text it was sent. */
  if (m && titleOf(text) === title) return text;
  if (!m) {
    const gap = kind === "board" && text && !text.startsWith("\n") ? "\n" : "";
    return `---\n${line}\n---\n${gap}${text}`;
  }
  const block = m[1]!;
  const start = m.index + m[0].indexOf(block);
  const nl = block.includes("\r\n") ? "\r\n" : "\n";
  const lines = block.split(nl);
  const at = lines.findIndex((raw) => /^title\s*:/.test(raw));
  if (at < 0) lines.unshift(line);
  else {
    let end = at + 1;
    // A folded or quoted title can run over several lines; each one after the key is indented.
    while (end < lines.length && /^[ \t]/.test(lines[end]!)) end++;
    if (end === at + 1 && lines[at] === line) return text;
    lines.splice(at, end - at, line);
  }
  return text.slice(0, start) + lines.join(nl) + text.slice(start + block.length);
}

/** `text` with no `title:` line in its frontmatter — and no frontmatter left if that was all of it. */
export function withoutTitle(text: string): string {
  const m = FRONT.exec(text);
  if (!m) return text;
  const lines = m[1]!.split(/\r?\n/);
  const at = lines.findIndex((raw) => /^title\s*:/.test(raw));
  if (at < 0) return text;
  let end = at + 1;
  while (end < lines.length && /^[ \t]/.test(lines[end]!)) end++;
  lines.splice(at, end - at);
  if (!lines.some((l) => l.trim())) return text.slice(m[0].length).replace(/^\r?\n/, "");
  const nl = m[1]!.includes("\r\n") ? "\r\n" : "\n";
  return `---${nl}${lines.join(nl)}${nl}---${nl}${text.slice(m[0].length)}`;
}

const instant = (moment: string): number | null => (isDay(moment) || !hasOffset(moment) ? null : Date.parse(moment));

/** Whether an event's `end` comes before its `start` — two dates, or two times that say where they were. */
export function endsBeforeItStarts(event: NoteEvent): boolean {
  const end = event.end;
  if (end === undefined) return false;
  if (isDay(event.start) && isDay(end)) return end < event.start;
  const a = instant(event.start);
  const b = instant(end);
  return a !== null && b !== null && b < a;
}

/** The zone a preference bundle names: the choice, else the browser's, else none. */
export function zoneIn(settings: unknown): string | null {
  if (!settings || typeof settings !== "object") return null;
  const s = settings as Record<string, unknown>;
  for (const key of ["dag:time-zone", "dag:time-zone-seen"]) if (validZone(s[key])) return s[key] as string;
  return null;
}

const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");

/** A time with no offset with `zone`'s offset at that wall-clock time. */
function offsetIn(moment: string, zone: string): string {
  const [date, clock] = moment.split("T") as [string, string];
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi, s] = clock.split(":").map(Number) as [number, number, number | undefined];
  // `instantOf` is `compatible`: the first of two in an overlap, and in a gap the offset from
  // before the change — `zones.offset_in`'s `fold=0`.
  const at = instantOf({ year: y, month: mo, day: d, hour: h, minute: mi, second: s ?? 0 }, zone);
  const east = Math.round((utc(y, mo, d, h, mi, s ?? 0) - at) / 60_000);
  return `${moment}${east < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(east) / 60))}:${pad(Math.abs(east) % 60)}`;
}

/**
 * A `start` or `end` a route was asked to write, as `whenOf` writes it, with a time that has no
 * offset given `zone`'s. Throws a message naming what to send instead.
 */
export function placed(key: string, raw: unknown, zone: string | null): string {
  const moment = whenOf(raw);
  if (moment === undefined) {
    throw new Error(
      `\`${String(raw)}\` is not a ${key}: write a date, YYYY-MM-DD, or a time like 2026-10-03T09:00 — ` +
        "read in the vault's time zone — or with its offset, 2026-10-03T09:00+02:00",
    );
  }
  if (isDay(moment) || hasOffset(moment)) return moment;
  if (zone === null) {
    throw new Error(`\`${String(raw)}\` has no offset: write the time with one, like ${moment}+02:00 or ${moment}Z`);
  }
  return offsetIn(moment, zone);
}
