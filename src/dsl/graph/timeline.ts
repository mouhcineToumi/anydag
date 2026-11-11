import { CODES } from "../codes";
import { suggestHue } from "../suggest";
import { emptyGraph, HUE_ORDER, type Graph, type Node } from "../ir";

/**
 * `timeline` — what happens when, on a real date scale.
 *
 *     section "2026 H2"
 *       2026-09 "Design system"
 *       2026-10 .. 2026-11 "AnyDag v1"
 *     section "2027"
 *       2027-01 "Public beta"
 *
 * Its own parser for the same reason as the mindmap: the grammar here is a *date*, and a date is
 * awkward to express in a tokenizer built for identifiers. It reuses `Graph`, though — an entry is
 * a node, a section is a group — so sizing, the renderer and every status treatment come free.
 * Only the placement is special, and placement is what a timeline is.
 */

/** `2026`, `2026-09`, `2026-09-06` — resolved to a day so the scale is linear in real time. */
function parseDate(text: string): number | null {
  const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1));
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A day, written at the precision the author was writing at.
 *
 * A drag along the axis lands on a day, and writing `2027-03-14` back onto a line that said `2027`
 * is the tool changing what the author claimed to know. So the day is *rounded to the boundary*
 * the sample's precision names — nearest month for `YYYY-MM`, nearest year for `YYYY` — and
 * written in that shape. Truncating instead would have been simpler and worse: half a month of
 * travel would write the same text back and the card would spring home with nothing to show for it.
 */
export function dateLike(sample: string, ms: number): string {
  const parts = sample.split("-").length;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (parts >= 3) return `${y}-${pad(m + 1)}-${pad(d.getUTCDate())}`;
  if (parts === 2) {
    const up = d.getUTCDate() >= 16;
    const at = new Date(Date.UTC(y, m + (up ? 1 : 0), 1));
    return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}`;
  }
  return String(m >= 6 ? y + 1 : y);
}

/** The date, or the two dates, at the head of an entry — and where they sit on the line. */
const HEAD = /^(\s*)(\d{4}(?:-\d{1,2}){0,2})(\s*\.\.\s*)?(\d{4}(?:-\d{1,2}){0,2})?(?=\s)/;

/**
 * Rewrite an entry's date so it starts on `to`, keeping however long it lasts.
 *
 * The dates are the whole of a timeline's grammar, so this is where a drag along the axis is
 * turned back into text — the `restate.ts` argument one dialect over: one span in, one span out,
 * and the label, the flags and the author's spacing come through untouched.
 *
 * A range moves rather than stretches. Dragging the *body* of a bar is asking to reschedule the
 * thing, not to change how long it takes; there is no gesture for an end date yet, and inventing
 * one out of the same drag would make the same pull mean two things.
 */
export function redate(line: string, to: number): string | null {
  const m = HEAD.exec(line);
  if (!m) return null;
  const start = parseDate(m[2]!);
  if (start === null) return null;
  const head = `${m[1]}${dateLike(m[2]!, to)}`;
  if (!m[3] || !m[4]) return head + line.slice(m[0].length);
  const end = parseDate(m[4]);
  if (end === null) return null;
  return `${head}${m[3]}${dateLike(m[4], end + (to - start))}${line.slice(m[0].length)}`;
}

/* ----------------------------------------------------------------------------- typing a date */

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_NAMES = MONTHS.map((m) => m[0]!.toUpperCase() + m.slice(1));

/** `mar`, `march`, `sept` — three letters at least, and a prefix of exactly one month's name. */
function monthOf(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return null;
  const hits = MONTHS.map((m, i) => (m.startsWith(w) || (w === "sept" && i === 8) ? i : -1)).filter((i) => i >= 0);
  return hits.length === 1 ? hits[0]! : null;
}

/** A date as the grammar writes it — and the precision it was typed at. */
interface Typed {
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`: exactly what lands in the file. */
  text: string;
  /** What it says in words, for the echo under the field. */
  words: string;
  ms: number;
}

function typed(y: number, m?: number, d?: number): Typed | null {
  if (y < 1000 || y > 9999) return null;
  if (m !== undefined && (m < 1 || m > 12)) return null;
  if (d !== undefined && (m === undefined || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate())) return null;
  const text = `${y}${m === undefined ? "" : `-${pad(m)}`}${d === undefined ? "" : `-${pad(d)}`}`;
  const month = m === undefined ? "" : `${MONTH_NAMES[m - 1]} `;
  return { text, words: `${d === undefined ? "" : `${d} `}${month}${y}`, ms: Date.UTC(y, (m ?? 1) - 1, d ?? 1) };
}

/**
 * One date, typed the way a person types one.
 *
 * `2026`, `2026-03`, `2026-03-01` (and `/` or `.` for the dashes), `Mar 2026`, `March 2026`,
 * `1 Mar 2026`, `Mar 1, 2026`. The result is the *grammar's* spelling at the precision that was
 * typed — `Mar 2026` is `2026-03`, never `2026-03-01` — because a day nobody typed is a claim
 * nobody made, which is the argument `dateLike` already makes for a drag.
 */
function typedDate(raw: string): Typed | null {
  const t = raw.trim().replace(/\s+/g, " ");
  const iso = /^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?$/.exec(t);
  if (iso) return typed(Number(iso[1]), iso[2] ? Number(iso[2]) : undefined, iso[3] ? Number(iso[3]) : undefined);
  const my = /^([A-Za-z]{3,9}\.?),? (\d{4})$/.exec(t);
  if (my) {
    const m = monthOf(my[1]!);
    return m === null ? null : typed(Number(my[2]), m + 1);
  }
  const dmy = /^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9}\.?),? (\d{4})$/.exec(t);
  if (dmy) {
    const m = monthOf(dmy[2]!);
    return m === null ? null : typed(Number(dmy[3]), m + 1, Number(dmy[1]));
  }
  const mdy = /^([A-Za-z]{3,9}\.?) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(t);
  if (mdy) {
    const m = monthOf(mdy[1]!);
    return m === null ? null : typed(Number(mdy[3]), m + 1, Number(mdy[2]));
  }
  return null;
}

/** What the When field made of its text: the two spans for the file, or why not. */
export type When = { ok: true; start: string; end: string | null; echo: string } | { ok: false; why: string };

/** `–`, `—`, `→`, `..` and the word `to` are unambiguous; a hyphen with spaces round it is too. */
const RANGE = /\s*(?:–|—|→|\.\.|->)\s*|\s+to\s+|\s+-\s+/i;

/**
 * Read the text of the When field.
 *
 * A single date is a point; two joined by `–`, `-`, `→` or `to` are a range. The bare hyphen is
 * the only separator that is also *inside* a date (`2026-03`), so it is tried last and only where
 * both halves are dates on their own: `2026-2027` splits, `2026-03` does not, and `2026-03-2026-06`
 * finds the one hyphen that leaves two dates.
 */
export function readWhen(text: string): When {
  const t = text.trim();
  if (t === "") return { ok: false, why: "type a date" };
  let parts: string[] | null = null;
  if (typedDate(t)) parts = [t];
  else {
    const split = t.split(RANGE);
    if (split.length === 2) parts = split;
    else if (split.length === 1) {
      for (let i = t.indexOf("-"); i !== -1; i = t.indexOf("-", i + 1)) {
        if (typedDate(t.slice(0, i)) && typedDate(t.slice(i + 1))) {
          parts = [t.slice(0, i), t.slice(i + 1)];
          break;
        }
      }
    }
  }
  if (!parts) return { ok: false, why: "could not read that as a date" };
  const [a, b] = parts.map((p) => typedDate(p));
  if (!a) return { ok: false, why: `could not read “${parts[0]!.trim()}” as a date` };
  if (parts.length === 1) return { ok: true, start: a.text, end: null, echo: a.words };
  if (!b) return { ok: false, why: `could not read “${parts[1]!.trim()}” as a date` };
  if (b.ms < a.ms) return { ok: false, why: "the end is before the start" };
  return { ok: true, start: a.text, end: b.text, echo: `${a.words} → ${b.words}` };
}

/** An entry's date as the When field first shows it: the grammar's own spelling, `→` for a range. */
export function whenOf(line: string): string {
  const m = HEAD.exec(line);
  if (!m) return "";
  return m[4] && m[3] ? `${m[2]} → ${m[4]}` : m[2]!;
}

/**
 * Write a typed date, or range, over the date at the head of an entry.
 *
 * `redate`'s argument for the dialect: the head is one span, so the label, the flags and the
 * author's spacing come through untouched — and an author's own `..` spacing is kept when the
 * entry was a range already. `null` for a line that does not start with a date at all.
 */
export function setWhen(line: string, start: string, end: string | null): string | null {
  const m = HEAD.exec(line);
  if (!m) return null;
  const sep = m[3] ?? " .. ";
  return `${m[1]}${start}${end === null ? "" : `${sep}${end}`}${line.slice(m[0].length)}`;
}

/**
 * An entry's label, read where `parseTimeline` reads it: the first quoted string after the date or
 * the range. Not `textSlots` — the tokenizer reads a range's `..` as an arrow, so to it a ranged
 * entry is an edge with no title at all. A section line is matched by the same pattern (its
 * `section` is the "date"), and its name is its label.
 */
const LABEL = /^(\s*\S+(?:\s*\.\.\s*\S+)?\s+)"([^"]*)"/;

/** The label, or `null` for a line that has none to read. */
export function labelOf(line: string): string | null {
  return LABEL.exec(line)?.[2] ?? null;
}

/**
 * Write an entry's (or a section's) label, one span in and one out.
 *
 * The label is required — `2026` alone is `E_BAD_DATE` — so clearing it writes `""` rather than
 * taking the string off. The parser reads the label up to the next `"` with no escapes, so a `"`
 * typed into it is written as `'`: a `\"` would end the label at the backslash. `null` for a line
 * with no label to rewrite.
 */
export function setLabel(line: string, text: string): string | null {
  const m = LABEL.exec(line);
  if (!m) return null;
  return `${m[1]}"${text.replace(/"/g, "'")}"${line.slice(m[0].length)}`;
}

/* ------------------------------------------------------------------------- choosing a section */

const SECTION = /^\s*section\s+"([^"]*)"/;
const quiet = (line: string) => line.trim() === "" || /^\s*(?:%%|\/\/)/.test(line);

/** Every section of a body: its 1-based line and its name. */
export function sectionsOf(body: string): { line: number; label: string }[] {
  const out: { line: number; label: string }[] = [];
  body.split("\n").forEach((l, i) => {
    const m = SECTION.exec(l);
    if (m) out.push({ line: i + 1, label: m[1]! });
  });
  return out;
}

/** The section an entry sits under — the nearest `section` line above it — or `null` for none. */
export function sectionOfLine(body: string, line: number): number | null {
  const lines = body.split("\n");
  for (let i = line - 2; i >= 0; i--) if (SECTION.test(lines[i]!)) return i + 1;
  return null;
}

/**
 * Move one entry to the end of a section (`to` is that section's line), or above the first one
 * (`null`: no section). Returns the new body and the entry's new 1-based line.
 *
 * An entry belongs to the nearest `section` above it, so choosing a section is moving the line:
 * the same cut-and-paste a drag of the statement would make, without needing a drag. It lands
 * after the section's last entry — a comment or a blank line trailing it stays where it was, so
 * the gap before the next section is not carried along — and takes that entry's indentation.
 */
export function moveEntry(body: string, line: number, to: number | null): { body: string; line: number } | null {
  const lines = body.split("\n");
  const entry = lines[line - 1];
  if (entry === undefined || quiet(entry) || SECTION.test(entry)) return null;
  if (to !== null && !SECTION.test(lines[to - 1] ?? "")) return null;
  if (sectionOfLine(body, line) === to) return null;

  const rest = lines.filter((_, i) => i !== line - 1);
  /* `to` and every line below `line` shift up by one once the entry is cut out. */
  const at = (n: number) => (n > line ? n - 1 : n);
  const first = to === null ? 0 : at(to);
  let last = first;
  let indent: string | null = null;
  for (let i = first; i < rest.length && !SECTION.test(rest[i]!); i++) {
    if (!quiet(rest[i]!)) {
      last = i + 1;
      indent = /^[ \t]*/.exec(rest[i]!)![0]!;
    }
  }
  const lead = indent ?? (to === null ? "" : `${/^[ \t]*/.exec(rest[first - 1]!)![0]!}  `);
  rest.splice(last, 0, `${lead}${entry.trimStart()}`);
  return { body: rest.join("\n"), line: last + 1 };
}

export interface TimelineEntry {
  id: string;
  start: number;
  end: number | null;
  label: string;
  section?: string;
}

/** Placement needs the dates, which are not part of `Graph`; they ride alongside it. */
const ENTRIES = new WeakMap<Graph, TimelineEntry[]>();
export const entriesOf = (graph: Graph): TimelineEntry[] => ENTRIES.get(graph) ?? [];

export function parseTimeline(src: string): Graph {
  const graph = emptyGraph("timeline" as Graph["type"], "LR");
  const entries: TimelineEntry[] = [];
  let section: string | undefined;
  let seq = 0;

  src.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || /^(%%|\/\/)/.test(line)) return;

    const sec = /^section\s+"([^"]*)"\s*(?:hue=(\w+))?/.exec(line);
    if (sec) {
      section = `s${seq++}`;
      let hue: string | undefined = sec[2];
      if (hue !== undefined && !(HUE_ORDER as readonly string[]).includes(hue)) {
        /* A section reads its own `hue=` rather than going through `modifiers()`, so it polices
           the same closed set itself; dropped rather than kept, so the section takes the next
           hue in order like one that named none. */
        const guess = suggestHue(hue, HUE_ORDER);
        graph.diagnostics.push({
          line: i + 1,
          code: CODES.W_UNKNOWN_HUE,
          message: guess
            ? `no hue named \`${hue}\`. Did you mean \`${guess}\`? (${HUE_ORDER.join(", ")})`
            : `no hue named \`${hue}\`: expected one of ${HUE_ORDER.join(", ")}`,
          severity: "warn",
        });
        hue = undefined;
      }
      graph.groups.push({
        id: section,
        label: sec[1]!,
        hue,
        level: 0,
        shape: "group",
        line: i + 1,
      });
      return;
    }

    const m = /^(\S+)(?:\s*\.\.\s*(\S+))?\s+"([^"]*)"\s*(.*)$/.exec(line);
    if (!m) {
      graph.diagnostics.push({
        line: i + 1,
        code: CODES.E_BAD_DATE,
        message: `expected \`<date> "label"\`, got \`${line}\``,
        severity: "error",
      });
      return;
    }

    const start = parseDate(m[1]!);
    if (start === null) {
      graph.diagnostics.push({
        line: i + 1,
        code: CODES.E_BAD_DATE,
        message: `\`${m[1]}\` is not a date (YYYY, YYYY-MM or YYYY-MM-DD)`,
        severity: "error",
      });
      return;
    }
    const end = m[2] ? parseDate(m[2]) : null;
    if (m[2] && end === null) {
      graph.diagnostics.push({ line: i + 1, code: CODES.E_BAD_DATE, message: `\`${m[2]}\` is not a date`, severity: "error" });
      return;
    }

    const id = `t${seq++}`;
    const flags = (m[4] ?? "").split(/\s+/).filter(Boolean);
    const node: Node = {
      id,
      kind: "step",
      title: m[3]!,
      meta: m[2] ? `${m[1]} → ${m[2]}` : m[1],
      rows: [],
      status: flags.includes("done") ? "done" : flags.includes("wait") ? "wait" : undefined,
      group: section,
      line: i + 1,
    };
    graph.nodes.push(node);
    entries.push({ id, start, end, label: m[3]!, section });
  });

  graph.groups.forEach((g, i) => {
    if (!g.hue) g.hue = HUE_ORDER[i % HUE_ORDER.length];
  });
  for (const n of graph.nodes) if (!n.hue) n.hue = graph.groups.find((g) => g.id === n.group)?.hue;

  ENTRIES.set(graph, entries);
  return graph;
}
