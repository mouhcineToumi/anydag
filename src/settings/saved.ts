/**
 * One write, one tick.
 *
 * Every control in Settings saves as it changes, and the row that changed says so: `markSaved` is
 * called by the two places a preference is written — `store.ts`'s `writeSettings` and `prefs.ts`'s
 * `writePref` — after the write has landed. The key names the row rather than the storage key:
 * `paste.width` for a field of the settings object, `dag:week-start` for a single preference, and
 * `dag:calendar-hide:note` for one row of a preference several rows share. `Field` subscribes to the
 * one it draws, and the modal keeps a single polite live region for all of them.
 *
 * No React here: `store.ts` is deliberately plain arithmetic so it can be held in Node.
 */

/** Dispatched on `window` after a setting's write settles; the detail is the row's key. */
export const SAVED = "dag:settings-saved";

export interface SavedDetail {
  key: string;
}

/**
 * How many resets are suppressing confirmations right now.
 *
 * A reset changes a dozen values at once and answers with its own toast; a tick per row under it
 * would be noise, and the Undo that follows is the change worth confirming. `Reset` wraps its action
 * in {@link quietly}, and Undo runs outside it, so putting the values back does show its ticks.
 */
let quiet = 0;

/** Say that the setting keyed `key` was written. */
export function markSaved(key: string): void {
  if (quiet > 0) return;
  try {
    dispatchEvent(new CustomEvent<SavedDetail>(SAVED, { detail: { key } }));
  } catch {
    /* No `window` — Node, a worker. Nothing is drawing a tick either. */
  }
}

/** Run `act` without letting the writes inside it raise a Saved tick. */
export function quietly<T>(act: () => T): T {
  quiet += 1;
  try {
    return act();
  } finally {
    quiet -= 1;
  }
}
