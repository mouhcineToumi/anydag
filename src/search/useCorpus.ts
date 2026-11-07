/**
 * The page's copy of `GET /__board/corpus`, and the search index built over it.
 *
 * `useIndex`'s shape, one difference apart: **it is read only while somebody is searching.** The
 * references index is read by every page that shows a backlink, so it stays subscribed; this one
 * reads every word of every document, and refreshing it after every drag on a board nobody is
 * searching would be the most expensive thing the page did. So the search card subscribes when it
 * opens and lets go when it closes, and what it had is kept in between — a card opened again shows
 * the last answer at once, and the answer it asks for replaces it a moment later.
 *
 * While the card is open the index follows the change feed, at most one wait after the first change
 * rather than after the last, for the reason `useIndex` gives: a debounce that restarts on every
 * change never fires while an agent keeps writing.
 */
import { useSyncExternalStore } from "react";

import { onBoard, onBoards, onNote, onQuiz, onTable } from "@/board/events";

import { buildEngine, type Engine, type SearchDoc } from "./engine";

export interface Corpus {
  docs: SearchDoc[];
  engine: Engine | null;
  /** Whether an answer has arrived since this page loaded — before it, "no hits" means "not yet". */
  loaded: boolean;
}

const EMPTY: Corpus = { docs: [], engine: null, loaded: false };
let current: Corpus = EMPTY;
const listeners = new Set<() => void>();
let off: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
let stale = false;

/** After a change, how long to wait for more before asking again. */
const SETTLE = 800;

function load(): Promise<void> {
  if (inflight) {
    stale = true;
    return inflight;
  }
  inflight = fetchCorpus().finally(() => {
    inflight = null;
    if (stale && off) {
      stale = false;
      void load();
    }
  });
  return inflight;
}

async function fetchCorpus(): Promise<void> {
  try {
    const r = await fetch("/__board/corpus");
    if (!r.ok) return;
    const { docs } = (await r.json()) as { docs: SearchDoc[] };
    current = { docs, engine: buildEngine(docs), loaded: true };
    for (const l of listeners) l();
  } catch {
    /* The next change, or the next time the card opens, is the next attempt. */
  }
}

function soon() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void load();
  }, SETTLE);
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen);
  if (!off) {
    /* Every open asks again: nothing was listening while the card was shut. */
    void load();
    const a = onBoard(soon);
    const b = onNote(soon);
    /* A quiz's questions are search results too: a question typed in a moment ago is found. */
    const q = onQuiz(soon);
    /* A table's rows are search results too. */
    const t = onTable(soon);
    const c = onBoards(soon);
    off = () => (a(), b(), q(), t(), c());
  }
  return () => {
    listeners.delete(listen);
    if (listeners.size === 0 && off) {
      off();
      off = null;
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

export function useCorpus(): Corpus {
  return useSyncExternalStore(subscribe, () => current);
}
