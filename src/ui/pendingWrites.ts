/**
 * What has to be written before the app may go away.
 *
 * Whatever holds text that is not on the disk yet — a note being typed in, a quiz or a table, the
 * practice answers waiting to be sent — says so here with a function that writes it now and
 * resolves once the file holds it. The shell restarting into an update (`Update`, in the sidebar's
 * foot) calls {@link flushPending} first and only then asks the shell to quit, so a debounce that has
 * not fired yet is never what an install loses. A page being closed is a different path and already
 * covered: each writer also sends what it holds on `pagehide`.
 */

type Flush = () => Promise<unknown> | unknown;

const writers = new Set<Flush>();

/** Register a writer for as long as it holds something. Returns what takes it away. */
export function registerPendingWrites(flush: Flush): () => void {
  writers.add(flush);
  return () => void writers.delete(flush);
}

/** Write everything that is waiting. A writer that fails does not stop the others; the caller
 *  still goes on, because a failed save is what the file's own conflict and retry UI is for. */
export async function flushPending(): Promise<void> {
  await Promise.allSettled([...writers].map(async (flush) => flush()));
}
