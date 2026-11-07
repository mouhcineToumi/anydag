import { parseChart } from "./chart";
import { parseDiagram } from "./parse";
import { parseSequence } from "./sequence";
import { tokenize } from "./tokenizer";

/**
 * Renaming the ids a diagram declares, so a copy of it can join another one.
 *
 * A component a person saved off a board is stored as the literal source they selected — it has to
 * be, because a component is a board file and a board file that does not parse is one nobody can
 * open. So the ids are real ids, and the day that fragment is dropped onto a diagram that already
 * has an `api`, something has to give. This is that something: find what the fragment declares,
 * find which of those the target already uses, and rename only those.
 *
 * **Three dialects are deliberately left alone.** `mindmap` declares no ids at all (`m1`, `m2` are
 * the parser's, and appear nowhere in the text), `timeline` declares none either, and `gitgraph`'s
 * are its branch names — including `main`, which the parser seeds whether or not anyone wrote it,
 * and renaming which turns `checkout main` into an error about a branch that does not exist. A
 * whitelist says so in one place rather than leaving it to an emergent property of the ids' shape.
 *
 * **The rename is surgical, at token offsets.** Tokens cannot rebuild the file — the tokenizer
 * drops comments outright and collapses runs of separators — so this splices the source rather
 * than re-emitting it. A word token is `api.content` whole (the tokenizer's word charset includes
 * `.`), so a dotted reference is renamed by its head, which is the same rule `resolveRefs` uses.
 */

/** The dialects whose ids are the author's, and can be renamed. */
const REBINDABLE = new Set(["arch", "erd", "state", "flow", "activity", "class", "usecase", "c4", "sequence", "chart"]);

/** Absolute offsets of the start of each 1-based line. */
function lineStarts(src: string): number[] {
  const out = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") out.push(i + 1);
  return out;
}

/** The head of a reference: `api.content` is declared as `api`. */
const head = (word: string): string => {
  const dot = word.lastIndexOf(".");
  return dot === -1 ? word : word.slice(0, dot);
};

/**
 * The ids this source declares, as it spells them.
 *
 * Intersected with the words actually present, because the IR carries ids the parser invented —
 * `[*]` becomes `__start-1`, a sequence gives a column to any id it has not been introduced to.
 * Nothing that is not written down can be renamed, and nothing that is not renamed can collide.
 */
export function declaredIds(type: string, src: string): string[] {
  if (!REBINDABLE.has(type)) return [];

  const declared = new Set<string>();
  if (type === "sequence") {
    for (const p of parseSequence(src).participants) declared.add(p.id);
  } else if (type === "chart") {
    /* A chart's ids are its series and its slices, and they share one namespace — both are things a
       board link can end on, so both have to be unique on the item they land in. The categories are
       *not* ids: `x Q1 Q2` is data, and two charts on one board both having a `Q1` is not a clash. */
    const model = parseChart(src);
    for (const s of [...model.series, ...model.slices]) declared.add(s.id);
  } else {
    const graph = parseDiagram(type, src);
    if (!graph) return [];
    for (const n of graph.nodes) declared.add(n.id);
    for (const g of graph.groups) declared.add(g.id);
    for (const l of graph.lanes) declared.add(l.id);
  }

  const written = new Set<string>();
  for (const tok of tokenize(src, [])) if (tok.kind === "word") written.add(head(tok.value));

  return [...declared].filter((id) => !id.startsWith("__") && written.has(id));
}

/** `src` with every id named in `map` renamed — its declaration and every reference to it. */
export function renameIds(src: string, map: Map<string, string>): string {
  if (map.size === 0) return src;
  const starts = lineStarts(src);
  const edits: { at: number; len: number; text: string }[] = [];

  for (const tok of tokenize(src, [])) {
    if (tok.kind !== "word") continue;
    const name = head(tok.value);
    const to = map.get(name);
    if (to === undefined) continue;
    const at = (starts[tok.line - 1] ?? 0) + tok.col - 1;
    edits.push({ at, len: name.length, text: to });
  }

  let out = src;
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at + e.len);
  return out;
}

/**
 * `fragment`, ready to be appended to `existing`: every id it declares that is already taken there
 * renamed to one that is not.
 *
 * Numbering follows the library's: `api` becomes `api2`, then `api3`. An id the target does not use
 * is left exactly as the person wrote it, which is most of them — a component keeps its own names
 * wherever it can.
 */
export function rebind(type: string, fragment: string, existing: string): string {
  const taken = new Set(declaredIds(type, existing));
  if (taken.size === 0) return fragment;

  const map = new Map<string, string>();
  for (const id of declaredIds(type, fragment)) {
    if (!taken.has(id)) continue;
    let next = "";
    for (let n = 2; ; n++) {
      next = `${id}${n}`;
      if (!taken.has(next) && !map.has(next)) break;
    }
    map.set(id, next);
    taken.add(next);
  }
  return renameIds(fragment, map);
}
