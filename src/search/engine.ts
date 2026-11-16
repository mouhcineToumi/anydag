/**
 * What a search folds, splits, limits and marks — the rules every asker is answered by.
 *
 * The matching itself is the local server's: an SQLite FTS5 index kept on disk beside what the grammar
 * parsed (`server/words.ts`, #267), asked by `GET /__board/search` per query. The search card asks
 * per query (`useSearch`) and never holds the units. This file is what the index, the query and the
 * snippet must agree on — how a text is cut into words and folded — and the snippet itself. The page
 * does not import it, so none of it is in the page's bundle.
 *
 * No DOM and no React, so the folding and the snippet are unit tests rather than a browser.
 */
import type { FileKind } from "@/board/useBoard";

import type { Unit } from "./corpus";

/** One document as `/__board/corpus` answers it. */
export interface SearchDoc {
  id: string;
  name: string;
  kind: FileKind;
  title?: string;
  units: Unit[];
}

/** A run of the snippet: marked when it is a word the query matched. */
export interface Run {
  text: string;
  hit: boolean;
}

/**
 * Where a word ends: space, punctuation, symbols and control characters — so `api-gateway` is two
 * words, `·` between a diagram's labels is nothing, and a title's `→` does not glue two words into
 * one. The index, the query and the snippet split on this one class, which is what lets the snippet
 * mark exactly the words that matched.
 */
const SPLIT = /[\p{Z}\p{P}\p{S}\p{Cc}\s]+/u;

/** Accents off and lower case, so `café` finds `cafe` and `Cafe` alike. */
export const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** A text's words, folded, in order: what the index holds of it and what a query asks for. */
export const wordsOf = (s: string): string[] => fold(s).split(SPLIT).filter(Boolean);

/** At most this many hits in one document, so a long note that says a word forty times leaves room for the rest. */
export const PER_DOC = 3;
/** And this many in all: a result list is read, not scrolled. */
export const LIMIT = 40;

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
  const words = [...text.matchAll(/[^\p{Z}\p{P}\p{S}\p{Cc}\s]+/gu)];
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
