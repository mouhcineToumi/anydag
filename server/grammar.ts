/**
 * The grammar, as function calls (decision 2). `server/handle.ts` is the whole of what was the
 * local server but its HTTP listener; this wraps it so a route reads `await grammar.patch(text, ops)`
 * and a refusal is the `Http` it would have been across the wire — the same status, the same words.
 *
 * And the parse caches for `/index` and `/corpus` (`Parsed`): what the grammar made of each text,
 * against the sha1 of the text it came from, so one document changed is one parsed — read and kept
 * on the worker (`server/parsing.ts`), so no text crosses to this thread (#287).
 */

import fs from "node:fs";
import path from "node:path";
import { setImmediate as yieldNow } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { handle, type DslResponse } from "./handle";
import { err } from "./http";
import { paced } from "./pace";
import {
  type Doc,
  ENTRIES_PART,
  type Entry,
  type Parse,
  type Question,
  type Read,
  type ReadAsk,
  type ReadPart,
  Reader,
} from "./parsing";

/* -- the worker ---------------------------------------------------------------------------- */

/** What goes to the worker: the questions about a whole vault. Everything else is quick, and stays. */
const HEAVY = new Set(["/index", "/corpus", "/search"]);

let workerOverride: string | null | undefined;

/** Point the grammar at a built worker, or `null` for inline — for a test that builds one. */
export function useGrammarWorker(file: string | null | undefined): void {
  workerOverride = file;
  thread?.stop();
  thread = undefined;
}

/** The built worker beside this bundle, or none — the unit suite runs the TypeScript, and asks inline. */
function workerFile(): string | null {
  if (workerOverride !== undefined) return workerOverride;
  if (process.env.ANYDAG_GRAMMAR_INLINE === "1") return null;
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "grammar-worker.mjs");
    return fs.existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

interface Waiting {
  ok: (a: never) => void;
  no: (e: Error) => void;
  /** A read's docs as its parts come in. */
  fresh?: [string, Doc | null][];
}

class Thread {
  private worker: Worker | null = null;
  private next = 1;
  private waiting = new Map<number, Waiting>();

  constructor(private readonly file: string) {}

  private start(): Worker {
    const w = new Worker(this.file);
    w.on("message", (m: { id: number; answer?: DslResponse; error?: string } | ReadPart) => {
      const at = this.waiting.get(m.id);
      if (!at) return;
      if ("fresh" in m) {
        for (const f of m.fresh) at.fresh!.push(f);
        // The next part once whatever else is waiting on this thread has had its turn.
        setImmediate(() => w.postMessage({ next: m.id } satisfies ReadAsk));
        return;
      }
      this.waiting.delete(m.id);
      if (!this.waiting.size) w.unref();
      if ("error" in m && m.error !== undefined) at.no(new Error(m.error));
      else if ("done" in m) (at.ok as (r: Read) => void)({ ...m.done, fresh: at.fresh! });
      else (at.ok as (a: DslResponse) => void)((m as { answer: DslResponse }).answer);
    });
    // A worker that died takes its questions with it; the next one starts a new worker.
    const gone = (e: Error) => {
      if (this.worker !== w) return;
      this.worker = null;
      for (const at of this.waiting.values()) at.no(e);
      this.waiting.clear();
    };
    w.on("error", gone);
    w.on("exit", (code) => gone(new Error(`the grammar's worker stopped (${code})`)));
    w.unref();
    return w;
  }

  ask(method: "GET" | "POST", route: string, query: URLSearchParams, body: unknown): Promise<DslResponse> {
    const w = (this.worker ??= this.start());
    const id = this.next++;
    return new Promise((ok, no) => {
      this.waiting.set(id, { ok, no });
      // An idle worker does not hold the process open; one with a question out does.
      w.ref();
      w.postMessage({ id, method, route, query: [...query], body });
    });
  }

  /**
   * A `Reader`'s answer, on the worker: the entries go in parts of `ENTRIES_PART`, the thread handed
   * back between them, and the answer comes back in parts (`readParts`).
   */
  async read(parsed: number, root: string, question: Question, since: number | null, entries: readonly Entry[]): Promise<Read> {
    const w = (this.worker ??= this.start());
    const id = this.next++;
    const answer = new Promise<Read>((ok, no) => {
      this.waiting.set(id, { ok, no, fresh: [] });
    });
    // A worker that dies while the entries go is a rejection before anything awaits it.
    answer.catch(() => undefined);
    w.ref();
    for (let i = 0; ; i += ENTRIES_PART) {
      const last = i + ENTRIES_PART >= entries.length;
      if (this.worker !== w) break; // it died, and took the question with it
      w.postMessage({
        read: id,
        parsed,
        root,
        question,
        since,
        entries: entries.slice(i, i + ENTRIES_PART),
        last,
      } satisfies ReadAsk);
      if (last) break;
      await yieldNow();
    }
    return answer;
  }

  forget(parsed: number): void {
    this.worker?.postMessage({ forget: parsed } satisfies ReadAsk);
  }

  stop(): void {
    const w = this.worker;
    this.worker = null;
    for (const at of this.waiting.values()) at.no(new Error("the grammar's worker was stopped"));
    this.waiting.clear();
    void w?.terminate();
  }
}

let thread: Thread | null | undefined;

function theThread(): Thread | null {
  if (thread === undefined) {
    const file = workerFile();
    thread = file ? new Thread(file) : null;
  }
  return thread;
}

async function answer(method: "GET" | "POST", route: string, query: URLSearchParams, body: unknown): Promise<DslResponse> {
  if (HEAVY.has(route)) {
    const t = theThread();
    if (t) return t.ask(method, route, query, body);
  }
  return handle({ method, route, query, body });
}

async function call<T>(
  method: "GET" | "POST",
  route: string,
  body?: unknown,
  query?: Record<string, string | undefined>,
): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") q.set(k, v);
  const got = await answer(method, route, q, body);
  if (got.status !== 200) {
    const said = (got.body as { error?: unknown } | null)?.error;
    throw err(got.status, typeof said === "string" ? said : `the grammar refused ${route}`);
  }
  return got.body as T;
}

/** The versions the grammar has been sent the docs of, so a search names one rather than sending it again. */
const sent = new Set<string>();

/**
 * A query over a corpus. Named by a `version` — which changes whenever the corpus does — the docs go
 * once, and the engine built from them answers every query after; a grammar that no longer holds
 * that engine (a worker restarted) says so with a 412, and is sent them.
 */
async function searchIn(docs: unknown[], q: string, limit?: number, version?: string) {
  const ask = (withDocs: boolean) =>
    call<Doc>("POST", "/search", {
      ...(withDocs ? { docs } : {}),
      q,
      ...(limit !== undefined ? { limit } : {}),
      ...(version ? { version } : {}),
    });
  if (!version) return ask(true);
  if (sent.has(version)) {
    try {
      return await ask(false);
    } catch (e) {
      if ((e as { status?: number }).status !== 412) throw e;
    }
  }
  const got = await ask(true);
  sent.add(version);
  if (sent.size > 16) sent.delete(sent.values().next().value!);
  return got;
}

export type { Doc };

export const grammar = {
  patch: (text: string, ops: unknown[]) => call<{ text: string; changed: boolean }>("POST", "/patch", { text, ops }),
  stamp: async (text: string) => (await call<{ text: string }>("POST", "/stamp", { text })).text,
  diagnose: (name: string, text: string, kind: string) => call<Doc>("POST", "/diagnose", { name, text, kind }),
  quiz: (text: string, stamp = false, ops?: unknown[]) =>
    call<Doc & { text: string; changed: boolean; ids?: string[]; diagnostics: unknown[] }>("POST", "/quiz", {
      text,
      stamp,
      ...(ops ? { ops } : {}),
    }),
  table: (text: string, opts: { ops?: unknown[]; stamp?: boolean; tab?: string; view?: boolean } = {}) =>
    call<{ text: string; changed: boolean; minted?: unknown; table: Doc & { tabs: unknown[]; diagnostics: unknown[] } }>(
      "POST",
      "/table",
      {
        text,
        ...opts,
      },
    ),
  search: searchIn,
  fences: (text: string) => call<Doc>("POST", "/fences", { text }),
  system: async (as: string | undefined, mode: "draw" | "rewrite" | "flashcards") =>
    (await call<{ system: string }>("GET", "/system", undefined, { as, mode })).system,
  library: (query: { id?: string; type?: string; q?: string }) => call<Doc>("GET", "/library", undefined, query),
  icons: (query: { q?: string; mode?: string }) => call<Doc>("GET", "/icons", undefined, query),
  dsl: (type?: string) => call<Doc>("GET", "/dsl", undefined, { type }),
};

let parsedCount = 0;

/**
 * What the grammar last made of each text of one vault, by key — one cache per question (`/index`
 * and `/corpus` ask different ones of the same text). The texts are read and parsed where the
 * grammar runs (a `Reader`, `server/parsing.ts`): this thread names them, and holds what came back.
 * Pruned to what it is asked about on every call, so a deleted document does not stay cached.
 */
export class Parsed {
  private had = new Map<string, Doc | null>();
  /**
   * The `Reader`'s answer `had` is, so it sends only what changed since — and which reader, the
   * worker's or this thread's, since each counts its own; `null` before the first.
   */
  private since: { on: "worker" | "inline"; turn: number } | null = null;
  private turn: Promise<unknown> = Promise.resolve();
  /** Its `Reader` when there is no worker, or when it was given its own parse. */
  private inline: Reader | null = null;
  private readonly number = ++parsedCount;
  /** Moves whenever what `of` answers does — a text parsed again, or one gone — and never otherwise. */
  generation = 0;

  /** `parse` is for a test: it reads and parses inline with it. */
  constructor(
    readonly question: Question,
    readonly root: string,
    private readonly parse?: Parse,
  ) {}

  /**
   * Each entry's doc — `null` when the grammar made nothing of it — and no key for a text that could
   * not be read. One call at a time: two cold asks at once would each parse the whole vault, where
   * the second, waiting, finds the first's answer cached and parses nothing.
   */
  of(entries: readonly Entry[]): Promise<ReadonlyMap<string, Doc | null>> {
    const run = this.turn.then(() => this.ask(entries));
    this.turn = run.catch(() => undefined);
    return run;
  }

  /** The vault closed: let the worker drop what it kept. */
  forget(): void {
    thread?.forget(this.number);
  }

  private async ask(entries: readonly Entry[]): Promise<ReadonlyMap<string, Doc | null>> {
    const since = (on: "worker" | "inline") => (this.since?.on === on ? this.since.turn : null);
    const t = this.parse ? null : theThread();
    if (t) {
      try {
        return await this.take(entries, await t.read(this.number, this.root, this.question, since("worker"), entries), "worker");
      } catch (e) {
        // A worker that failed answers inline instead, and says so.
        console.warn(`anydag: reading ${this.root} for /${this.question} inline: ${(e as Error)?.message ?? e}`);
      }
    }
    this.inline ??= this.parse ? new Reader(this.root, this.parse) : Reader.of(this.root, this.question);
    return this.take(entries, this.inline.read(entries, since("inline")), "inline");
  }

  private async take(entries: readonly Entry[], got: Read, on: "worker" | "inline"): Promise<ReadonlyMap<string, Doc | null>> {
    const fresh = new Map(got.fresh);
    const missing = new Set(got.missing);
    const now = new Map<string, Doc | null>();
    await paced(entries, ([key]) => {
      if (!missing.has(key)) now.set(key, fresh.has(key) ? fresh.get(key)! : (this.had.get(key) ?? null));
    });
    if (got.parsed || got.whole || now.size !== this.had.size) this.generation++;
    this.had = now;
    this.since = { on, turn: got.turn };
    return now;
  }
}
