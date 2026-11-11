/**
 * Asking the server again for something the page keeps a copy of — the file list, the reference
 * index — on every change the feed reports, **and again on its own after an answer that did not
 * come** (#123).
 *
 * Both used to wait for the feed's next change after a failure ("the feed will say when something
 * changes, and that is the next attempt"). Under an agent at work that is the next second; after
 * the Assistant's last write it is never, and the sidebar went on missing the board it had just
 * made while every link to it said *Nothing has this id any more*. So a failure is tried again
 * after a wait that doubles, and the first answer that arrives puts the wait back.
 *
 * And **one request out at a time, and one more behind it at most**: however many changes arrive
 * while one is out, the one queued answers them all — a list asked once per change fills the
 * browser's six connections under a burst. No browser API here, so `test/refresher.test.ts` holds it
 * in Node with fake timers.
 */

/** How long after a failure the first retry waits; each one after it doubles, up to `last`. */
const FIRST_MS = 1_000;
const LAST_MS = 30_000;

export interface Refresher {
  /**
   * Ask now — or, while a request is out, once more when it lands. Resolves when the request out
   * (or the one this started) has landed, whatever it said.
   */
  ask(): Promise<void>;
  /** A request out was asked before something changed: ask once more when it lands. Nothing when none is out. */
  stale(): void;
  /** Forget a retry that is waiting. A request already out still lands; nothing follows it. */
  cancel(): void;
}

/**
 * `once` makes one request and says whether it got an answer: `false`, or a throw, is a failure
 * worth asking again about later.
 */
export function refresher(once: () => Promise<boolean>, { first = FIRST_MS, last = LAST_MS } = {}): Refresher {
  let out: Promise<void> | null = null;
  let again = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let wait = first;
  /* Bumped by `cancel`, so a request out when it was called does not schedule anything after it. */
  let era = 0;

  const ask = (): Promise<void> => {
    if (out) {
      again = true;
      return out;
    }
    if (retry) {
      clearTimeout(retry);
      retry = null;
    }
    const mine = era;
    const landed = once()
      .catch(() => false)
      .then((ok) => {
        out = null;
        if (ok) wait = first;
        /* A change arrived while this was out, so what it brought back may already be old. */
        if (again) {
          again = false;
          void ask();
          return;
        }
        if (ok || mine !== era) return;
        retry = setTimeout(() => {
          retry = null;
          void ask();
        }, wait);
        wait = Math.min(wait * 2, last);
      });
    out = landed;
    return landed;
  };

  return {
    ask,
    stale() {
      if (out) again = true;
    },
    cancel() {
      era++;
      again = false;
      if (retry) clearTimeout(retry);
      retry = null;
    },
  };
}
