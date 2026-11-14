/**
 * The page's half of practice: answers going to the server,
 * and Mistakes coming back.
 *
 * **The rule is the server's and this reports events.** Where an answer was given — a run of one quiz,
 * or the Mistakes run — is all this says; `server/practice.ts` decides what that means,
 * `inPool` included. A copy of the threshold here would be the copy that disagrees the day somebody
 * changes it in Settings.
 *
 * **An answer is an event, so the queue is a list and never a map.** "Wrong, then right" on one
 * question is how a retake reads, and folding the two into the last would lose the miss that put the
 * question into Mistakes. The queue flushes on a short debounce, as soon as a run ends, and as the
 * page goes away — with `keepalive` only while the body fits, the note's 64 KB rule.
 *
 * **Every flush that lands says so on the window, `dag:practice`**, and every reader of Mistakes —
 * the sidebar's count, the Quizzes page, a quiz's page, a card on a board — asks again when it hears
 * it. The change feed carries files, and a practice record is not one.
 */
import { useEffect, useState } from "react";

import { registerPendingWrites } from "@/ui/pendingWrites";

type Run = "quiz" | "mistakes";

export interface Answer {
  /** The quiz's permanent id. */
  quiz: string;
  /** The question's `{#id}`. */
  question: string;
  correct: boolean;
  run: Run;
}

interface Stat {
  wrong: number;
  right: number;
  streak: number;
  at: string;
}

interface PoolEntry extends Stat {
  quiz: string;
  question: string;
}

export interface Practice {
  /** How many right in a row, in the Mistakes run, take a question out of it. */
  graduate: number;
  /** Every question in Mistakes, in the order the Mistakes run asks them. */
  pool: PoolEntry[];
  /** How many of those each quiz has, by quiz id. */
  counts: Readonly<Record<string, number>>;
}

/** The window event a landed flush announces, and anything that changes the threshold. */
const PRACTICE_EVENT = "dag:practice";

const told = () => dispatchEvent(new CustomEvent(PRACTICE_EVENT));

/** Mistakes and the threshold, or `null` when the server could not say. */
export async function readPractice(): Promise<Practice | null> {
  try {
    const r = await fetch("/api/practice");
    if (!r.ok) return null;
    const d = (await r.json()) as Partial<Practice>;
    return { graduate: d.graduate ?? 2, pool: d.pool ?? [], counts: d.counts ?? {} };
  } catch {
    return null;
  }
}

/** Set the threshold. Resolves to what the server holds now, or `null` when it refused. */
export async function setGraduate(n: number): Promise<number | null> {
  try {
    const r = await fetch("/api/practice", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graduate: n }),
    });
    if (!r.ok) return null;
    const got = ((await r.json()) as { graduate: number }).graduate;
    told();
    return got;
  } catch {
    return null;
  }
}

/* ---- the queue ------------------------------------------------------------------------------ */

/** A burst of answers is a handful; a run is at most a few dozen. The server takes a hundred at a time. */
const BATCH = 100;
const DEBOUNCE_MS = 400;
const RETRY_FIRST_MS = 1_000;
const RETRY_LAST_MS = 15_000;
/** `keepalive`'s ceiling, the note's (`NoteView.tsx`): a larger one is refused before it is sent. */
const KEEPALIVE_MAX = 60_000;

const queue: Answer[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let backoff = RETRY_FIRST_MS;

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, ms);
}

/** Record one answer. It reaches the server on the next flush, in the order it was given. */
export function answer(a: Answer): void {
  queue.push(a);
  schedule(DEBOUNCE_MS);
}

/**
 * Send what is queued now. A network error or a 5xx goes again on a backoff; a 4xx is an answer
 * about the request — a quiz somebody deleted mid-run — and those answers are dropped rather than
 * sent for ever.
 */
export async function flush(leaving = false): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const sending = queue.splice(0, BATCH);
  try {
    const body = JSON.stringify({ events: sending });
    const r = await fetch("/api/practice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: leaving && new Blob([body]).size < KEEPALIVE_MAX,
    });
    if (r.status >= 500) throw new Error(String(r.status));
    backoff = RETRY_FIRST_MS;
    if (r.ok) told();
  } catch {
    queue.unshift(...sending);
    if (!leaving) {
      schedule(backoff);
      backoff = Math.min(backoff * 2, RETRY_LAST_MS);
    }
  } finally {
    flushing = false;
  }
  if (queue.length && !leaving && !timer) schedule(0);
}

/* Before the app restarts into an update: send every batch, not only the one in flight. Stops when a
   round sends nothing, so a server that is not answering cannot hold the restart for ever. */
registerPendingWrites(async () => {
  for (let rounds = 0; queue.length > 0 && rounds < 20; rounds++) {
    const before = queue.length;
    await flush();
    if (queue.length >= before) break;
  }
});

if (typeof window !== "undefined") addEventListener("pagehide", () => void flush(true));

/* ---- reading it ----------------------------------------------------------------------------- */

/*
 * **One copy per page, however many readers.** The sidebar's count, the gallery, a quiz's page and
 * every quiz card on a board read Mistakes; asked for by each, a board with ten cards would be ten
 * requests at every answer. So the answer is kept here, asked for once when the first reader
 * arrives and once per `dag:practice` however many are listening, and handed to each — the index's
 * rule (`useIndex`), for the same reason.
 */
let held: Practice | null = null;
let asking: Promise<void> | null = null;
let askAgain = false;
const readers = new Set<(p: Practice) => void>();

function refresh(): void {
  if (asking) {
    askAgain = true;
    return;
  }
  asking = readPractice()
    .then((p) => {
      if (!p) return;
      held = p;
      for (const r of [...readers]) r(p);
    })
    .finally(() => {
      asking = null;
      if (askAgain && readers.size) {
        askAgain = false;
        refresh();
      }
    });
}

if (typeof window !== "undefined") addEventListener(PRACTICE_EVENT, () => readers.size && refresh());

/**
 * Mistakes and the threshold, kept current: asked for when the first reader mounts and again
 * whenever a flush lands or the threshold moves. `null` until the first answer, so a count is never
 * drawn from nothing. `enabled: false` asks for nothing at all — a share link's visitor has no
 * account to ask about.
 */
export function usePractice(enabled = true): Practice | null {
  const [practice, setPractice] = useState<Practice | null>(held);
  useEffect(() => {
    if (!enabled) return;
    readers.add(setPractice);
    if (held) setPractice(held);
    refresh();
    return () => {
      readers.delete(setPractice);
    };
  }, [enabled]);
  return enabled ? practice : null;
}
