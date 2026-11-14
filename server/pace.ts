/**
 * A loop over a whole vault, handing the server's one thread back now and then: on 50,000 documents
 * a loop that does a little for each is tens to hundreds of milliseconds, which is every other
 * request waiting (#287). `SLICE_MS` is well under what a request notices.
 */

import { setImmediate as yieldNow } from "node:timers/promises";

/** How long a loop holds the thread before it hands it back. */
const SLICE_MS = 8;

/** `each` over every item in order, the thread handed back whenever a slice has run `SLICE_MS`. */
export async function paced<T>(items: Iterable<T>, each: (item: T) => void): Promise<void> {
  let until = performance.now() + SLICE_MS;
  let i = 0;
  for (const item of items) {
    each(item);
    if (++i % 64 === 0 && performance.now() > until) {
      await yieldNow();
      until = performance.now() + SLICE_MS;
    }
  }
}
