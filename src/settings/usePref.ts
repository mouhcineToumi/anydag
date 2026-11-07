import { useSyncExternalStore } from "react";

import { CHANGED, readPref } from "./prefs";

/**
 * One preference, for a component that *shows* it and has to hear it change — the calendar's week
 * start and its toggles, which the Settings card or another tab may move while it is up.
 *
 * `useSettings`' shape for a single key: a string compares by value, so there is nothing to cache.
 * Everything else reads a preference once into its own state, and keeps doing so.
 */
function subscribe(onChange: () => void): () => void {
  addEventListener(CHANGED, onChange);
  addEventListener("storage", onChange);
  return () => {
    removeEventListener(CHANGED, onChange);
    removeEventListener("storage", onChange);
  };
}

export function usePref(key: string, fallback: string | null = null): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readPref(key, fallback),
    () => fallback,
  );
}
