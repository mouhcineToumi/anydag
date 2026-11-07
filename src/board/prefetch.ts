/**
 * A document's text asked for before the click that opens it.
 *
 * Opening a file from the sidebar is one round trip — `GET /__board/get` — and on a deployment that
 * round trip is most of the wait: the page has nothing to draw until it lands, so the file that was
 * open stays on the screen and the click reads as one that did not register. A person's pointer
 * rests on a row before it presses, and a press is a tenth of a second before the click; asked
 * then, the answer is usually in hand by the time the page wants it.
 *
 * Three rules keep it honest:
 *
 * - **Only the read that opens a page.** `openDoc` is what a page's first load calls; the change
 *   feed's refetch and every other read go straight to the server, exactly as before.
 * - **Short-lived.** An answer older than `FRESH_MS` is not served — a pointer that rested on a row
 *   and wandered off has not asked for anything to be kept — and one a page has taken is gone
 *   `TAKEN_MS` later. Not at once, because a page mounted twice in a row (React's development
 *   check does exactly that) would otherwise open on a second round trip and never on the first.
 * - **Dropped the moment the file changes.** A change on the feed for a name held here takes the
 *   held answer away, so a page never opens on text the server has already replaced.
 *
 * What is held is the answer's status and bytes rather than the `Response`, whose body can be read
 * only once; `openDoc` hands each caller a `Response` of its own, so it is a drop-in for the `fetch`
 * each page made.
 */

import { concerns, onBoard, onNote, onQuiz, onTable, type BoardChange } from "./events";
import type { TextKind } from "./useBoard";

/** How long an answer asked for ahead of time is good for. */
const FRESH_MS = 10_000;
/** How long an answer a page has taken stays, for the same page mounted again at once. */
const TAKEN_MS = 1_000;

interface Answer {
  status: number;
  body: string;
}

interface Held {
  /** When it stops being served. */
  until: number;
  got: Promise<Answer | null>;
  off: () => void;
}

const held = new Map<string, Held>();

const keyOf = (kind: TextKind, name: string) => `${kind}:${name}`;

/** The route a page reads a document's text through — a board is the one asked for with no kind. */
export const docUrl = (kind: TextKind, name: string) =>
  `/__board/get?name=${encodeURIComponent(name)}${kind === "board" ? "" : `&kind=${kind}`}`;

const LISTEN: Record<TextKind, (listen: (c: BoardChange) => void) => () => void> = {
  board: onBoard,
  note: onNote,
  quiz: onQuiz,
  table: onTable,
};

function drop(key: string): void {
  const h = held.get(key);
  if (!h) return;
  held.delete(key);
  h.off();
}

function fresh(key: string): Held | undefined {
  const h = held.get(key);
  if (h && Date.now() < h.until) return h;
  drop(key);
  return undefined;
}

/** Ask for a document's text now, for a page that may open it in a moment. Does nothing while one is held. */
export function prefetchDoc(kind: TextKind, name: string): void {
  const key = keyOf(kind, name);
  if (fresh(key)) return;
  /* A request that failed is not kept: the page then asks for itself and says what went wrong. */
  const got = fetch(docUrl(kind, name))
    .then(async (r): Promise<Answer> => ({ status: r.status, body: await r.text() }))
    .catch(() => null);
  const off = LISTEN[kind]((change) => {
    if (concerns(change, name)) drop(key);
  });
  held.set(key, { until: Date.now() + FRESH_MS, got, off });
}

/** `fetch(docUrl(kind, name))` for the read that opens a page — answered from a prefetch when one is held. */
export async function openDoc(kind: TextKind, name: string): Promise<Response> {
  const key = keyOf(kind, name);
  const h = fresh(key);
  if (h) {
    h.until = Math.min(h.until, Date.now() + TAKEN_MS);
    const got = await h.got;
    /* A server that failed may not fail again: that answer is asked for afresh, not served. */
    if (got && got.status < 500) return new Response(got.body, { status: got.status, headers: { "content-type": "application/json" } });
  }
  return fetch(docUrl(kind, name));
}

/** Let go of everything held, and of the feed with it — for a test, which shares this module with the next. */
export function forgetPrefetched(): void {
  for (const key of [...held.keys()]) drop(key);
}
