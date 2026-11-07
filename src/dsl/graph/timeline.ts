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
