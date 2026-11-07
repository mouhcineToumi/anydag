/**
 * In the browser, ELK runs in a real Web Worker built by Vite from `elk-worker.min.js?worker`.
 * There is no such thing in Vitest, so the same specifier is aliased here to the *fake* worker
 * elkjs ships for non-worker contexts — same algorithm, same results, on this thread.
 */
import pkg from "elkjs/lib/elk-worker.min.js";

export default (pkg as unknown as { Worker: new (url?: string) => Worker }).Worker;
