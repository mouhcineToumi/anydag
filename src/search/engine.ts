/**
 * Matching a query against the corpus, on the server.
 *
 * **MiniSearch**, taken for what this stack already is: there is no database with a text index
 * behind it — the vault is a folder of plain files. The server cuts the texts into units
 * (`/__board/corpus`, where the grammar is), builds this over them once per corpus version, and
 * answers every query with `GET /__board/search`; the search card asks per query (`useSearch`) and
 * never holds the units. MiniSearch rather than FlexSearch because it ranks (BM25), does prefixes and
 * typos, is one small MIT file with no dependencies, and states its behaviour in options this file
 * can read. The page does not import this file, so none of it is in the page's bundle.
 *
 * No DOM and no React, so the ranking and the snippet are unit tests rather than a browser.
 */
import MiniSearch from "minisearch";

import type { FileKind } from "@/board/useBoard";

import type { Unit } from "./corpus";

/** One document as `/__board/corpus` answers it, and as the engine holds it. */
export interface SearchDoc {
  id: string;
  name: string;
  kind: FileKind;
  title?: string;
  units: Unit[];
}

export interface Hit {
  doc: SearchDoc;
  unit: Unit;
  score: number;
  /** The words of the unit that matched, folded — what the snippet marks. */
  terms: string[];
}

/** A run of the snippet: marked when it is a word the query matched. */
export interface Run {
  text: string;
  hit: boolean;
}

/**
 * Where a word ends: space, punctuation and symbols — so `api-gateway` is two words, `·` between a
 * diagram's labels is nothing, and a title's `→` does not glue two words into one. The snippet
 * splits on the same class, which is what lets it mark exactly the words that matched.
 */
const SPLIT = /[\p{Z}\p{P}\p{S}\s]+/u;

/** Accents off and lower case, so `café` finds `cafe` and `Cafe` alike. */
export const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

interface Row {
  k: number;
  text: string;
}

export interface Engine {
  mini: MiniSearch<Row>;
  units: { doc: SearchDoc; unit: Unit }[];
}

export function buildEngine(docs: SearchDoc[]): Engine {
  const units = docs.flatMap((doc) => doc.units.map((unit) => ({ doc, unit })));
  const mini = new MiniSearch<Row>({
    idField: "k",
    fields: ["text"],
    tokenize: (s) => s.split(SPLIT).filter(Boolean),
    processTerm: (t) => fold(t) || null,
  });
  mini.addAll(units.map((u, k) => ({ k, text: u.unit.text })));
  return { mini, units };
}

/** At most this many hits in one document, so a long note that says a word forty times leaves room for the rest. */
const PER_DOC = 3;
/** And this many in all: a result list is read, not scrolled. */
const LIMIT = 40;

/**
 * The units that hold every word of the query, best first.
 *
 * Every word must match (`AND`) — a search narrows as it is typed, which is what the name filter
 * above it already does. The last word is a prefix of something, because it is the one still being
 * typed; the others are prefixes too, which is what lets `pay sett` find "payments settle". A word
 * of five letters or more forgives one typo in five, and a shorter one none: a two-letter word
 * with a typo in it matches half the corpus.
 */
export function search(engine: Engine, query: string, limit = LIMIT): Hit[] {
  if (!query.trim()) return [];
  const found = engine.mini.search(query, {
    combineWith: "AND",
    prefix: true,
    fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
  });
  const perDoc = new Map<string, number>();
  const out: Hit[] = [];
  for (const r of found) {
    const at = engine.units[r.id as number];
    if (!at) continue;
    const n = perDoc.get(at.doc.id) ?? 0;
    if (n >= PER_DOC) continue;
    perDoc.set(at.doc.id, n + 1);
    out.push({ ...at, score: r.score, terms: r.terms });
    if (out.length >= limit) break;
  }
  return out;
}

/** How much of a long unit the snippet shows around the first match, in characters. */
const BEFORE = 48;
const WIDTH = 180;

/**
 * The unit's words around the first match, the matched words marked.
 *
 * A diagram's unit is every label it draws and a note's paragraph can be a page long, so the
 * snippet is a window: it starts a little before the first matched word — on a word boundary, with
 * an ellipsis when it cut something — and runs for a line or two after. Marking is by word, folded
 * the way the index folds them, so what is marked is exactly what matched.
 */
export function snippet(text: string, terms: readonly string[]): Run[] {
  const want = new Set(terms);
  const words = [...text.matchAll(/[^\p{Z}\p{P}\p{S}\s]+/gu)];
  const first = words.find((w) => want.has(fold(w[0])));
  let start = 0;
  if (first && first.index! > BEFORE) {
    const cut = text.lastIndexOf(" ", first.index! - BEFORE);
    start = cut === -1 ? 0 : cut + 1;
  }
  let end = Math.min(text.length, start + WIDTH);
  if (end < text.length) {
    const cut = text.lastIndexOf(" ", end);
    if (cut > start) end = cut;
  }
  const runs: Run[] = [];
  const push = (s: string, hit: boolean) => {
    if (!s) return;
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += s;
    else runs.push({ text: s, hit });
  };
  if (start > 0) push("…", false);
  let at = start;
  for (const w of words) {
    const from = w.index!;
    const to = from + w[0].length;
    if (to <= start) continue;
    if (from >= end) break;
    push(text.slice(at, from), false);
    push(w[0], want.has(fold(w[0])));
    at = to;
  }
  push(text.slice(at, end), false);
  if (end < text.length) push("…", false);
  return runs;
}
