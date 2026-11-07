import { useSyncExternalStore } from "react";

import { DEFAULTS, EVENT, readSettings, type Settings } from "./store";

/**
 * The settings, for the two places that *show* one.
 *
 * Everywhere else calls `readSettings()` at the moment of the gesture, which is the whole of
 * decision 4: a paste reads the placement rule when it runs, and nothing about a preference reaches
 * React state where a memoised `Item` could be re-rendered by it. This exists for the dialog's own
 * controls and for the Export menu's caption, which has to say `Board as PNG (3×)` the moment the
 * scale is three.
 *
 * `useSyncExternalStore` wants a snapshot it can compare by identity, and `readSettings()` parses a
 * string into a fresh object every call — so the value is cached here and the cache is dropped when
 * the store says it changed. Without that the comparison never holds and React re-renders forever.
 */
let cache: Settings | null = null;

function subscribe(onChange: () => void): () => void {
  const listener = () => {
    cache = null;
    onChange();
  };
  addEventListener(EVENT, listener);
  /* Another tab of the same board, through the browser's own cross-document event. Cheap, and the
     alternative is one window showing a stale scale for as long as it stays open. */
  addEventListener("storage", listener);
  return () => {
    removeEventListener(EVENT, listener);
    removeEventListener("storage", listener);
  };
}

const snapshot = (): Settings => (cache ??= readSettings());

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULTS);
}
