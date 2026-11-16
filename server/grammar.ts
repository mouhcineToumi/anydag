/**
 * The grammar, as function calls (decision 2). `server/handle.ts` is the whole of what was the
 * local server but its HTTP listener; this wraps it so a route reads `await grammar.patch(text, ops)`
 * and a refusal is the `Http` it would have been across the wire — the same status, the same words.
 *
 * And the parse caches for `/index` and `/corpus` (`Parsed`): what the grammar made of each text,
 * against the sha1 of the text it came from, so one document changed is one parsed — read and kept
 * on the worker (`server/parsing.ts`), so no text crosses to this thread (#287), and kept on disk in
 * the app's home (`server/parse-store.ts`), so the worker can end when it is idle (#279). A vault's
 * corpus and search are answered on the worker whole (`server/searching.ts`).
 */

import { type ChildProcess, fork } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setImmediate as yieldNow } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { handle, type DslResponse } from "./handle";
import { err } from "./http";
import { paced } from "./pace";
import { Shelf } from "./parse-store";
import {
  type Doc,
  ENTRIES_PART,
  type Entry,
  type FileMeta,
  type Meta,
  type Parse,
  type Question,
  type Read,
  type ReadAsk,
  type ReadPart,
  Reader,
  type Want,
} from "./parsing";
import { caughtUp, corpusParts, searchOver } from "./searching";

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

/**
 * How long one question may take before the worker is ended and the next question starts another.
 * A whole vault's index is seconds; a minute is a grammar stuck on something it was handed — a
 * pattern gone quadratic on somebody else's file — and a worker that is never answering holds every
 * index, backlink and search question behind it for as long as the server runs (#9). A question
 * answered in parts has the minute for each part.
 */
const DEADLINE_MS = 60_000;

/** How long a worker with nothing to answer and no search to keep stays up. */
const IDLE_MS = Number(process.env.ANYDAG_GRAMMAR_IDLE_MS) || 30_000;

/**
 * What the worker is not given of this process's environment: the token, the home's secret and any
 * key. It parses text and keeps a cache; it never needs to be anyone.
 */
const SECRET = /TOKEN|SECRET|KEY|PASSWORD/i;

interface Waiting {
  /** The worker the question is out with. */
  c: ChildProcess;
  route: string;
  ok: (a: never) => void;
  no: (e: Error) => void;
  timer: NodeJS.Timeout;
  /** A read's docs as its parts come in. */
  fresh?: [string, Doc | null][];
  /** A corpus's parts, handed on as they come in. */
  part?: (json: string) => void;
}

/**
 * The worker: **a process of its own**, started when a question needs it and **ended when it has
 * been idle** — `idleMs` after its last answer — and the next question starts another. A search
 * holds nothing it would have to build again (#267), so it keeps the worker up no longer than any
 * other question.
 *
 * A process and not a thread, because ending it is how its memory comes back. V8 keeps the pages a
 * heap grew into after the garbage in them is collected, and keeps a worker thread's after the
 * thread ends (measured, #279: a thread that grew to 590 MB and was terminated left the process
 * 490 MB bigger, on Node 22, 24 and 26 alike); a process that exits gives every page back. It is run
 * by this process's own binary — Node, or Electron's as Node, `ELECTRON_RUN_AS_NODE` inherited —
 * and ends itself when this process goes, its channel closing.
 */
export class WorkerProcess {
  private child: ChildProcess | null = null;
  private next = 1;
  private waiting = new Map<number, Waiting>();
  private timer: NodeJS.Timeout | null = null;
  private exits = new WeakMap<ChildProcess, Promise<void>>();

  constructor(
    private readonly file: string,
    private readonly deadlineMs = DEADLINE_MS,
    private readonly idleMs = IDLE_MS,
  ) {}

  /** The worker's pid while one is up — for the tests. */
  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  private start(): ChildProcess {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET.test(k)));
    const c = fork(this.file, [], {
      env,
      execArgv: [],
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      windowsHide: true,
    });
    this.exits.set(c, new Promise((done) => c.once("exit", () => done())));
    c.on("message", (m: { id: number; answer?: DslResponse; error?: string } | ReadPart) => {
      const at = this.waiting.get(m.id);
      if (!at || at.c !== c) return;
      if ("fresh" in m || "json" in m || "alive" in m) {
        clearTimeout(at.timer);
        at.timer = this.deadline(c, at.route);
        if ("alive" in m) return;
        if ("fresh" in m) {
          for (const f of m.fresh) at.fresh!.push(f);
          // The next part once whatever else is waiting on this thread has had its turn.
          setImmediate(() => this.post(c, { next: m.id } satisfies ReadAsk));
        } else at.part!(m.json); // the next part is asked for when this one has been taken
        return;
      }
      this.waiting.delete(m.id);
      clearTimeout(at.timer);
      this.settle(c);
      if ("error" in m && m.error !== undefined) at.no(new Error(m.error));
      else if ("done" in m) (at.ok as (r: Read) => void)({ ...m.done, fresh: at.fresh! });
      else if ("end" in m) (at.ok as () => void)();
      else (at.ok as (a: DslResponse) => void)((m as { answer: DslResponse }).answer);
    });
    // A worker that died takes its questions with it; the next one starts a new worker.
    c.on("error", (e) => this.gone(c, e));
    c.on("exit", (code, signal) => this.gone(c, new Error(`the grammar's worker stopped (${signal ?? code})`)));
    this.hold(c, false);
    return c;
  }

  /** `c` is gone: its questions fail, and the next question starts another worker. */
  private gone(c: ChildProcess, e: Error): void {
    if (this.child === c) {
      this.child = null;
      this.unrest();
    }
    for (const [id, at] of this.waiting) {
      if (at.c !== c) continue;
      this.waiting.delete(id);
      clearTimeout(at.timer);
      at.no(e);
    }
  }

  private outWith(c: ChildProcess): boolean {
    for (const at of this.waiting.values()) if (at.c === c) return true;
    return false;
  }

  /** A question answered: with nothing else out, `c` stops holding this process open, and rests — or ends, retired. */
  private settle(c: ChildProcess): void {
    if (this.outWith(c)) return;
    this.hold(c, false);
    if (this.child === c) this.rest(c);
    else this.end(c);
  }

  /** Its channel closing is what ends a worker (`grammar-worker.ts`); a kill would end it mid-write. */
  private end(c: ChildProcess): void {
    if (this.child === c) {
      this.child = null;
      this.unrest();
    }
    if (c.connected) c.disconnect();
  }

  private unrest(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Nothing outstanding: end the worker once it has been idle long enough. */
  private rest(c: ChildProcess): void {
    this.unrest();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.child === c && !this.outWith(c)) this.end(c);
    }, this.idleMs);
    this.timer.unref();
  }

  /** An idle worker does not hold this process open; one with a question out does. */
  private hold(c: ChildProcess, on: boolean): void {
    const channel = c.channel as { ref?: () => void; unref?: () => void } | null | undefined;
    if (on) {
      c.ref();
      channel?.ref?.();
    } else {
      c.unref();
      channel?.unref?.();
    }
  }

  /* Past the deadline the worker is ended, not waited on: a process stuck in a loop never reads
     another message, so the only way to get the grammar back is a new one. */
  private deadline(c: ChildProcess, route: string): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.gone(
        c,
        new Error(`the grammar took longer than ${Math.round(this.deadlineMs / 1000)} s on ${route}, and was restarted`),
      );
      c.kill("SIGKILL");
    }, this.deadlineMs);
    timer.unref();
    return timer;
  }

  private post(c: ChildProcess, m: unknown): void {
    if (!c.connected) return; // gone, and its going has failed what was out with it
    c.send(m as never, (e) => {
      if (e) this.gone(c, e);
    });
  }

  /** A question to the current worker, started if there is none: its id, and the answer to come. */
  private open<T>(route: string, more: Partial<Waiting> = {}): { c: ChildProcess; id: number; answer: Promise<T> } {
    const c = (this.child ??= this.start());
    this.unrest();
    const id = this.next++;
    const answer = new Promise<T>((ok, no) => {
      this.waiting.set(id, { c, route, ok: ok as (a: never) => void, no, timer: this.deadline(c, route), ...more });
    });
    // An idle worker does not hold the process open; one with a question out does.
    this.hold(c, true);
    return { c, id, answer };
  }

  ask(method: "GET" | "POST", route: string, query: URLSearchParams, body: unknown): Promise<DslResponse> {
    const { c, id, answer } = this.open<DslResponse>(route);
    this.post(c, { id, method, route, query: [...query], body });
    return answer;
  }

  /**
   * The entries of a read, in parts of `ENTRIES_PART` with the thread handed back between them, each
   * with its `Meta` when it has some; the files and what the read is for go with the last.
   */
  private async sendEntries(
    c: ChildProcess,
    head: Omit<Extract<ReadAsk, { read: number }>, "entries" | "meta" | "last" | "files" | "want">,
    entries: readonly Entry[],
    extra?: { meta: readonly Meta[]; files: readonly FileMeta[]; want: Want },
  ): Promise<void> {
    for (let i = 0; ; i += ENTRIES_PART) {
      const last = i + ENTRIES_PART >= entries.length;
      if (!this.waiting.has(head.read)) break; // it died, and took the question with it
      this.post(c, {
        ...head,
        entries: entries.slice(i, i + ENTRIES_PART),
        ...(extra ? { meta: extra.meta.slice(i, i + ENTRIES_PART) } : {}),
        last,
        ...(last && extra ? { files: [...extra.files], want: extra.want } : {}),
      } satisfies ReadAsk);
      if (last) break;
      await yieldNow();
    }
  }

  /** A `Reader`'s answer, on the worker: the entries go in parts, and the answer comes back in parts (`readParts`). */
  async read(
    parsed: number,
    home: string | null,
    root: string,
    question: Question,
    since: number | null,
    entries: readonly Entry[],
  ): Promise<Read> {
    const { c, id, answer } = this.open<Read>(`/${question}`, { fresh: [] });
    // A worker that dies while the entries go is a rejection before anything awaits it.
    answer.catch(() => undefined);
    await this.sendEntries(c, { read: id, parsed, home, root, question, since }, entries);
    return answer;
  }

  /** A query over the corpus `parsed` reads, answered on the worker (`searchOver`). */
  async search(
    parsed: number,
    home: string | null,
    root: string,
    entries: readonly Entry[],
    meta: readonly Meta[],
    files: readonly FileMeta[],
    q: string,
    limit?: number,
    only?: readonly string[],
  ): Promise<DslResponse> {
    const { c, id, answer } = this.open<DslResponse>("/search");
    answer.catch(() => undefined);
    const want: Want = {
      search: q,
      ...(limit !== undefined ? { limit } : {}),
      ...(only ? { only: [...only] } : {}),
    };
    await this.sendEntries(c, { read: id, parsed, home, root, question: "corpus", since: null }, entries, { meta, files, want });
    return answer;
  }

  /** The corpus `parsed` reads brought up to date in the background, nothing answered (`Want`'s `warm`). */
  async warm(parsed: number, home: string | null, root: string, entries: readonly Entry[]): Promise<void> {
    const { c, id, answer } = this.open<DslResponse>("/corpus");
    answer.catch(() => undefined);
    await this.sendEntries(c, { read: id, parsed, home, root, question: "corpus", since: null }, entries, {
      meta: [],
      files: [],
      want: { warm: true },
    });
    await answer;
  }

  /**
   * The corpus `parsed` reads, as the JSON of its docs a part at a time, each part asked for once the
   * last has been taken: nothing of it is held on this thread longer than it takes to send it on.
   */
  async *corpus(
    parsed: number,
    home: string | null,
    root: string,
    entries: readonly Entry[],
    meta: readonly Meta[],
    files: readonly FileMeta[],
  ): AsyncGenerator<string> {
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    let failed: Error | null = null;
    const nudge = () => {
      const w = wake;
      wake = null;
      w?.();
    };
    const { c, id, answer } = this.open<void>("/corpus", {
      part: (json) => {
        queue.push(json);
        nudge();
      },
    });
    answer.then(
      () => {
        finished = true;
        nudge();
      },
      (e: Error) => {
        failed = e;
        nudge();
      },
    );
    await this.sendEntries(c, { read: id, parsed, home, root, question: "corpus", since: null }, entries, {
      meta,
      files,
      want: { corpus: true },
    });
    try {
      for (;;) {
        if (queue.length) {
          yield queue.shift()!;
          if (!finished && !failed) this.post(c, { next: id } satisfies ReadAsk);
          continue;
        }
        if (failed) throw failed;
        if (finished) return;
        await new Promise<void>((r) => (wake = r));
      }
    } finally {
      // Abandoned half way — the asker went: what is out is not waited on.
      const at = this.waiting.get(id);
      if (at) {
        this.waiting.delete(id);
        clearTimeout(at.timer);
        this.post(c, { abandon: id } satisfies ReadAsk);
        this.settle(c);
      }
    }
  }

  forget(parsed: number): void {
    if (this.child) this.post(this.child, { forget: parsed } satisfies ReadAsk);
  }

  /** The next question goes to a new worker; this one ends once it has answered what is out with it. */
  retire(): void {
    const c = this.child;
    if (!c) return;
    this.child = null;
    this.unrest();
    if (!this.outWith(c)) this.end(c);
  }

  /** End the worker, and every question still out with it. The next question starts another. */
  async close(): Promise<void> {
    const c = this.child;
    if (!c) return;
    this.gone(c, new Error("the grammar's worker was closed"));
    c.kill();
    await this.exits.get(c);
  }

  stop(): void {
    const c = this.child;
    if (!c) return;
    this.gone(c, new Error("the grammar's worker was stopped"));
    c.kill();
  }
}

let thread: WorkerProcess | null | undefined;

function theThread(): WorkerProcess | null {
  if (thread === undefined) {
    const file = workerFile();
    thread = file ? new WorkerProcess(file) : null;
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
  fences: (text: string) => call<Doc>("POST", "/fences", { text }),
  system: async (as: string | undefined, mode: "draw" | "rewrite" | "flashcards") =>
    (await call<{ system: string }>("GET", "/system", undefined, { as, mode })).system,
  library: (query: { id?: string; type?: string; q?: string }) => call<Doc>("GET", "/library", undefined, query),
  icons: (query: { q?: string; mode?: string }) => call<Doc>("GET", "/icons", undefined, query),
  dsl: (type?: string) => call<Doc>("GET", "/dsl", undefined, { type }),
};

let parsedCount = 0;

/** What a corpus and a search are asked over: every listed text, each one's id and listed title, and every attachment. */
export interface Over {
  entries: Entry[];
  meta: Meta[];
  files: FileMeta[];
}

/**
 * What the grammar last made of each text of one vault, by key — one cache per question (`/index`
 * and `/corpus` ask different ones of the same text). The texts are read and parsed where the
 * grammar runs (a `Reader`, `server/parsing.ts`): this thread names them, and holds what came back.
 * Pruned to what it is asked about on every call, so a deleted document does not stay cached.
 *
 * **A text whose stat has not moved is not read** (#280): an entry may carry the stamp — mtime, size,
 * inode — the kept listing gave its text, and a `Reader` holding that text at that stamp answers from
 * what it kept without touching the disk. On 50,000 notes, reading and hashing every text was most of
 * a warm `/index`'s 2.9 s. The same map answers while nothing in it moved.
 *
 * **The corpus is not held here** (#279): `search` and `corpus` are answered where the docs are, and
 * this thread keeps none of them — the corpus of 10,000 files was 37 MB of units held twice.
 */
export class Parsed {
  private had = new Map<string, Doc | null>();
  /**
   * The `Reader`'s answer `had` is, so it sends only what changed since — and which reader, the
   * worker's or this thread's, since each counts its own; `null` before the first.
   */
  private since: { on: "worker" | "inline"; turn: number } | null = null;
  private turn: Promise<unknown> = Promise.resolve();
  /** How many `of` are not answered yet, and when the last one was. */
  private out = 0;
  private answeredAt = 0;
  /** Its `Reader` when there is no worker, or when it was given its own parse. */
  private inline: Reader | null = null;
  private readonly number = ++parsedCount;
  /** Moves whenever what `of` answers does — a text parsed again, or one gone — and never otherwise. */
  generation = 0;

  /** `home` keeps what was parsed on disk (`parse.sqlite`); `parse` is for a test: it reads and parses inline with it. */
  constructor(
    readonly question: Question,
    readonly root: string,
    private readonly opts: { home?: string | null; parse?: Parse } = {},
  ) {}

  private get home(): string | null {
    return this.opts.home ?? null;
  }

  /**
   * Each entry's doc — `null` when the grammar made nothing of it — and no key for a text that could
   * not be read. One call at a time: two cold asks at once would each parse the whole vault, where
   * the second, waiting, finds the first's answer cached and parses nothing.
   */
  of(entries: readonly Entry[]): Promise<ReadonlyMap<string, Doc | null>> {
    this.out++;
    const run = this.turn.then(() => this.ask(entries));
    this.turn = run.catch(() => undefined);
    const done = () => {
      this.out--;
      this.answeredAt = Date.now();
    };
    run.then(done, done);
    return run;
  }

  /** Settles once every `of` asked so far has been answered. */
  settled(): Promise<unknown> {
    return this.turn;
  }

  /** How long nothing has been asked of this cache: 0 while an `of` is out, `Infinity` before the first. */
  idleMs(): number {
    return this.out ? 0 : this.answeredAt ? Date.now() - this.answeredAt : Number.POSITIVE_INFINITY;
  }

  /** The vault closed: let the worker drop what it kept. */
  forget(): void {
    thread?.forget(this.number);
  }

  private reader(): Reader {
    const { parse } = this.opts;
    return (this.inline ??= parse
      ? new Reader(this.root, parse, this.question, Shelf.at(this.home))
      : Reader.of(this.root, this.question, this.home));
  }

  /** The worker, unless this cache parses with its own `parse`. */
  private worker(): WorkerProcess | null {
    return this.opts.parse ? null : theThread();
  }

  private failed(what: string, e: unknown): void {
    // A worker that failed answers inline instead, and says so.
    console.warn(`anydag: ${what} ${this.root} inline: ${(e as Error)?.message ?? e}`);
  }

  private async ask(entries: readonly Entry[]): Promise<ReadonlyMap<string, Doc | null>> {
    const since = (on: "worker" | "inline") => (this.since?.on === on ? this.since.turn : null);
    const t = this.worker();
    if (t) {
      try {
        return await this.take(
          entries,
          await t.read(this.number, this.home, this.root, this.question, since("worker"), entries),
          "worker",
        );
      } catch (e) {
        this.failed(`reading for /${this.question}`, e);
      }
    }
    return this.take(entries, this.reader().read(entries, since("inline")), "inline");
  }

  private async take(entries: readonly Entry[], got: Read, on: "worker" | "inline"): Promise<ReadonlyMap<string, Doc | null>> {
    const fresh = new Map(got.fresh);
    const missing = new Set(got.missing);
    const now = new Map<string, Doc | null>();
    await paced(entries, ([key]) => {
      if (!missing.has(key)) now.set(key, fresh.has(key) ? fresh.get(key)! : (this.had.get(key) ?? null));
    });
    this.since = { on, turn: got.turn };
    // Nothing parsed again and nothing gone: the last map, so what was made of it can be kept (#280).
    if (!got.parsed && !got.whole && now.size === this.had.size) return this.had;
    this.generation++;
    this.had = now;
    return now;
  }

  /**
   * A query's hits over the vault — `{ query, hits }` as `GET /__board/search` answers — matched where
   * the docs are: a lookup in the words index kept beside them (`server/words.ts`).
   */
  async search(over: Over, q: string, limit?: number, only?: readonly string[]): Promise<Doc> {
    const t = this.worker();
    if (t) {
      try {
        const got = await t.search(this.number, this.home, this.root, over.entries, over.meta, over.files, q, limit, only);
        if (got.status === 200) return got.body as Doc;
        throw new Error(`the worker answered ${got.status}`);
      } catch (e) {
        this.failed("searching", e);
      }
    }
    const reader = this.reader();
    return searchOver(reader, caughtUp(reader, over.entries), over.entries, over.meta, over.files, q, limit, only).body as Doc;
  }

  /**
   * The corpus, and its words index with it, brought up to date with the vault, and nothing answered:
   * the read a search starts with, on its own (`server/upkeep.ts`, #267). On the worker it is a read
   * in the background, which gives way to every question on another reader.
   */
  async warm(over: Over): Promise<void> {
    const t = this.worker();
    if (t) {
      try {
        await t.warm(this.number, this.home, this.root, over.entries);
        return;
      } catch (e) {
        this.failed("bringing up to date the search index of", e);
      }
    }
    caughtUp(this.reader(), over.entries);
  }

  /** The corpus, as the JSON of its docs a part at a time — joined by commas, with none between parts. */
  async *corpus(over: Over): AsyncGenerator<string> {
    const t = this.worker();
    if (t) {
      let sent = false;
      try {
        for await (const part of t.corpus(this.number, this.home, this.root, over.entries, over.meta, over.files)) {
          sent = true;
          yield part;
        }
        return;
      } catch (e) {
        // Half of it gone out already cannot be taken back; none of it can be answered inline.
        if (sent) throw e;
        this.failed("cutting the corpus of", e);
      }
    }
    const reader = this.reader();
    const read = caughtUp(reader, over.entries);
    for (const part of corpusParts(0, reader, read, over.entries, over.meta, over.files)) if ("json" in part) yield part.json;
  }
}
