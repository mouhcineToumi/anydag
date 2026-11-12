import { useSyncExternalStore } from "react";

/** Below this the Settings modal is the whole window: a list of tabs, and one tab at a time. */
const NARROW = "(max-width: 719px)";

export const narrow = (): boolean => {
  try {
    return matchMedia(NARROW).matches;
  } catch {
    return false;
  }
};

const listen = (tell: () => void): (() => void) => {
  try {
    const query = matchMedia(NARROW);
    query.addEventListener("change", tell);
    return () => query.removeEventListener("change", tell);
  } catch {
    return () => undefined;
  }
};

/**
 * The same breakpoint as a value React re-renders on.
 *
 * `narrow()` is enough for a layout decided once, when the modal opens. A pane that shows one shape
 * at phone width and the wide form above it has to hear a resize, or dragging the window narrower
 * leaves the phone shape half-drawn until the tab is reopened.
 */
export function useNarrow(): boolean {
  return useSyncExternalStore(listen, narrow, () => false);
}
