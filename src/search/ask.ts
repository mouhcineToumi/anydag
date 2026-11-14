/**
 * Asking the server one query at a time: debounced, and cancelled when something newer replaces it.
 *
 * No React, so the two rules are a unit test (`test/search-ask.test.ts`) rather than a browser;
 * `useSearch` is the hook that drives it.
 */
import type { Found } from "./wire";

/** How long typing must pause before a query is sent. */
export const DEBOUNCE = 120;

export interface Asker {
  /** Send `query` once typing has paused, replacing whatever was waiting or in flight. */
  ask(query: string): void;
  /** Drop what is waiting and abort what is in flight; the asker can be used again. */
  stop(): void;
}

/**
 * `answered` is called with the hits of the **latest** query only: a request a newer `ask` or a
 * `stop` has replaced is aborted, and an answer that still arrives is dropped, so a slow answer to
 * `pay` can never land over the one to `payments`. A refused or failed request calls nothing — the
 * next key, or the next change, is the next attempt.
 */
export function asker(answered: (query: string, hits: Found[]) => void, wait = DEBOUNCE): Asker {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ctl: AbortController | null = null;

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    ctl?.abort();
    ctl = null;
  };

  return {
    stop,
    ask(query) {
      stop();
      timer = setTimeout(async () => {
        timer = null;
        const mine = new AbortController();
        ctl = mine;
        try {
          const r = await fetch(`/__board/search?q=${encodeURIComponent(query)}`, { signal: mine.signal });
          if (!r.ok) return;
          const { hits } = (await r.json()) as { hits: Found[] };
          if (!mine.signal.aborted) answered(query, hits);
        } catch {
          /* Aborted, or the server is not there. */
        }
      }, wait);
    },
  };
}
