import { useCallback, useSyncExternalStore } from "react";

import { concerns, onTable } from "@/board/events";

/**
 * One table's text, for everything on the page that draws it without editing it — a card on a
 * board, an embed in a note, the read-only view.
 *
 * **One fetch per table, however many show it**, and one listener on the change feed per table
 * while anything is showing it: ten cards of one table on a board are one request, and a change to
 * that table re-renders its cards and nothing else on the canvas. `usePractice`'s shape for the
 * quiz's Mistakes, one kind over.
 *
 * `undefined` while it is being asked for, `null` when the answer is that there is no such table.
 */
interface Held {
  text: string | null | undefined;
  sha1: string | null;
  listeners: Set<() => void>;
  off: () => void;
  asking: boolean;
  again: boolean;
}

const held = new Map<string, Held>();

function read(name: string, h: Held): void {
  if (h.asking) {
    h.again = true;
    return;
  }
  h.asking = true;
  void fetch(`/__board/get?name=${encodeURIComponent(name)}&kind=table`)
    .then(async (r) => (r.ok ? ((await r.json()) as { text: string; base: string }) : null))
    .catch(() => undefined)
    .then((got) => {
      h.asking = false;
      if (held.get(name) !== h) return;
      if (got === undefined) return;
      h.text = got ? got.text : null;
      h.sha1 = got ? got.base : null;
      for (const l of [...h.listeners]) l();
      if (h.again) {
        h.again = false;
        read(name, h);
      }
    });
}

function subscribe(name: string, listen: () => void): () => void {
  let h = held.get(name);
  if (!h) {
    const made: Held = { text: undefined, sha1: null, listeners: new Set(), off: () => undefined, asking: false, again: false };
    made.off = onTable((change) => {
      if (!concerns(change, name)) return;
      if (change.sha1 === null) {
        made.text = null;
        made.sha1 = null;
        for (const l of [...made.listeners]) l();
        return;
      }
      if (change.sha1 !== made.sha1) read(name, made);
    });
    held.set(name, made);
    read(name, made);
    h = made;
  }
  h.listeners.add(listen);
  const mine = h;
  return () => {
    mine.listeners.delete(listen);
    if (mine.listeners.size === 0) {
      mine.off();
      if (held.get(name) === mine) held.delete(name);
    }
  };
}

export function useTableText(name: string | null): string | null | undefined {
  const sub = useCallback((listen: () => void) => (name ? subscribe(name, listen) : () => undefined), [name]);
  const get = useCallback(() => (name ? held.get(name)?.text : null), [name]);
  return useSyncExternalStore(sub, get);
}
