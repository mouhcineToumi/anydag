/**
 * The grammar, as function calls (decision 2). `server/handle.ts` is the whole of what was the
 * local server but its HTTP listener; this wraps it so a route reads `await grammar.patch(text, ops)`
 * and a refusal is the `Http` it would have been across the wire — the same status, the same words.
 *
 * And the parse cache `main.py` kept for `/index` and `/corpus` (`parsed()`): what the grammar made
 * of each text, against the sha1 of the text it came from, so one document changed is one parsed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { handle, type DslResponse } from "./handle";
import { err } from "./http";
import { sha1 } from "./vault";

/* -- the worker ---------------------------------------------------------------------------- */

/** What goes to the worker: the questions about a whole vault. Everything else is quick, and stays. */
const HEAVY = new Set(["/index", "/corpus", "/search"]);

/** The built worker beside this bundle, or none — the unit suite runs the TypeScript, and asks inline. */
function workerFile(): string | null {
  if (process.env.ANYDAG_GRAMMAR_INLINE === "1") return null;
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "grammar-worker.mjs");
    return fs.existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

class Thread {
  private worker: Worker | null = null;
  private next = 1;
  private waiting = new Map<number, { ok: (a: DslResponse) => void; no: (e: Error) => void }>();

  constructor(private readonly file: string) {}

  private start(): Worker {
    const w = new Worker(this.file);
    w.on("message", (m: { id: number; answer?: DslResponse; error?: string }) => {
      const at = this.waiting.get(m.id);
      if (!at) return;
      this.waiting.delete(m.id);
      if (!this.waiting.size) w.unref();
      if (m.error !== undefined) at.no(new Error(m.error));
      else at.ok(m.answer!);
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
}

let thread: Thread | null | undefined;

async function answer(method: "GET" | "POST", route: string, query: URLSearchParams, body: unknown): Promise<DslResponse> {
  if (HEAVY.has(route)) {
    if (thread === undefined) {
      const file = workerFile();
      thread = file ? new Thread(file) : null;
    }
    if (thread) return thread.ask(method, route, query, body);
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

export type Doc = Record<string, unknown>;

export const grammar = {
  patch: (text: string, ops: unknown[]) => call<{ text: string; changed: boolean }>("POST", "/patch", { text, ops }),
  stamp: async (text: string) => (await call<{ text: string }>("POST", "/stamp", { text })).text,
  index: async (texts: Record<string, string>) => (await call<{ docs: Record<string, Doc> }>("POST", "/index", { texts })).docs,
  corpus: async (texts: Record<string, string>) => (await call<{ docs: Record<string, Doc> }>("POST", "/corpus", { texts })).docs,
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
  system: async (as: string | undefined, mode: "draw" | "rewrite") =>
    (await call<{ system: string }>("GET", "/system", undefined, { as, mode })).system,
  library: (query: { id?: string; type?: string; q?: string }) => call<Doc>("GET", "/library", undefined, query),
  icons: (query: { q?: string; mode?: string }) => call<Doc>("GET", "/icons", undefined, query),
  dsl: (type?: string) => call<Doc>("GET", "/dsl", undefined, { type }),
};

/**
 * What the grammar last made of each text, by key, against its sha1 — one cache per question
 * (`/index` and `/corpus` ask different ones of the same text). Pruned to what the vault holds on
 * every call, so a deleted document does not stay cached.
 */
export class Parsed {
  private had = new Map<string, [string, Doc]>();
  private turn: Promise<unknown> = Promise.resolve();
  /** Moves whenever what `of` answers does — a text parsed again, or one gone — and never otherwise. */
  generation = 0;

  constructor(private readonly ask: (texts: Record<string, string>) => Promise<Record<string, Doc>>) {}

  /* One at a time: two cold asks at once would each parse the whole vault, where the second, waiting,
     finds the first's answer cached and parses nothing. */
  of(texts: Record<string, string>): Promise<Record<string, Doc>> {
    const run = this.turn.then(() => this.parse(texts));
    this.turn = run.catch(() => undefined);
    return run;
  }

  private async parse(texts: Record<string, string>): Promise<Record<string, Doc>> {
    const stamps = new Map(Object.entries(texts).map(([k, t]) => [k, sha1(t)]));
    const stale: Record<string, string> = {};
    for (const [k, s] of stamps) if (this.had.get(k)?.[0] !== s) stale[k] = texts[k]!;
    const fresh = Object.keys(stale).length ? await this.ask(stale) : {};
    const now = new Map<string, [string, Doc]>();
    for (const [k, s] of stamps) {
      const doc = k in stale ? fresh[k] : this.had.get(k)?.[1];
      if (doc) now.set(k, [s, doc]);
    }
    if (Object.keys(stale).length || now.size !== this.had.size) this.generation++;
    this.had = now;
    return Object.fromEntries([...now].map(([k, [, d]]) => [k, d]));
  }
}
