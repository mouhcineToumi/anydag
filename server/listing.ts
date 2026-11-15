/**
 * The vault's listing as the disk gives it: every document and folder, and what each text's
 * frontmatter says. Nothing here knows the index, ids or the watcher — `Vault.tree()` brings the
 * index into line with what this returns.
 *
 * **It runs on a thread of its own** (`server/list-worker.ts`): on 50,000 files the walk and the
 * frontmatter reads are 4 s of reading and YAML, and on the server's one thread that was every
 * request waiting behind the first listing, the board the person opened included (#283). Where no
 * worker is built beside the bundle — the unit suite runs the TypeScript — or
 * `ANYDAG_LIST_INLINE=1`, it runs inline, the same code.
 *
 * Plain Node and pure `src/` imports only: it is bundled into the worker on its own.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { eventOf, type NoteEvent } from "../src/note/event";
import { projectOf, type Project } from "../src/note/project";
import { indexedTask, type Task } from "../src/note/task";
import { parseQuiz } from "../src/quiz/parse";
import { titleOf } from "../src/refs/extract";
import { frontId } from "./ids";
import { classify, ignored, type Kind, refusal, type TextKind } from "./names";

export interface Listed {
  kind: Kind;
  name: string;
  /** The stored file, vault-relative and `/`-separated. */
  file: string;
}

/** What one text's frontmatter says, against the stat it was read at. */
export interface Front {
  stamp: string;
  id: string | null | false;
  title: string | undefined;
  task: Task | undefined;
  project: Project | undefined;
  event: NoteEvent | undefined;
  asks: (string | null)[] | undefined;
}

/** What the listing read of one document: a text's frontmatter, a file's size, and when it was born. */
export interface Found {
  front: Front | null;
  size: number | null;
  /** Birth time, else modification time, in ms; `null` when the file went between the walk and the stat. */
  born: number | null;
}

export interface Listing extends Walked {
  /** One per doc, in `docs`' order. */
  found: Found[];
}

/**
 * What one text's frontmatter says. `changed` is the file's modified time, in ms, when the caller
 * has stat it — a task carries it as when it last changed, which is the file's and never a line in it.
 */
export function frontOf(kind: TextKind, text: string, stamp: string, changed: number | null = null): Front {
  let asks: (string | null)[] | undefined;
  if (kind === "quiz") {
    try {
      asks = parseQuiz(text).questions.map((q) => q.id ?? null);
    } catch {
      asks = [];
    }
  }
  return {
    stamp,
    id: frontId(text),
    title: titleOf(text),
    task: kind === "note" ? indexedTask(text, changed) : undefined,
    project: kind === "note" ? projectOf(text) : undefined,
    event: kind === "note" ? eventOf(text) : undefined,
    asks,
  };
}

/** One folder's own documents and folders, and its mtime read before them — `null` when it is gone. */
export interface Scanned {
  docs: Listed[];
  folders: string[];
  /** Both, in the folder's sorted order: a folder is a string. */
  order: (Listed | string)[];
  mark: number | null;
}

/**
 * What one folder holds directly, by the walk's rules: sorted, nothing ignored or refused, no link
 * followed, and `plan.md` beside `plan.note.md` listed once. Its mtime is read **before** its entries,
 * so a change landing between the two moves it again and is not missed by whoever compares it.
 */
export function scanDir(root: string, rel: string, types: ReadonlySet<string>): Scanned {
  const dir = rel ? path.join(root, ...rel.split("/")) : root;
  const prefix = rel ? `${rel}/` : "";
  let mark: number;
  let entries: fs.Dirent[];
  try {
    mark = fs.statSync(dir).mtimeMs;
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { docs: [], folders: [], order: [], mark: null }; // a folder listed a moment ago and gone now: the disk's other writer
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const docs: Listed[] = [];
  const folders: string[] = [];
  const order: (Listed | string)[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (ignored(e.name)) continue;
    const at = prefix + e.name;
    if (e.isDirectory()) {
      if (!refusal(at)) {
        folders.push(at);
        order.push(at);
      }
      continue;
    }
    if (!e.isFile()) continue;
    const found = classify(at, types);
    if (!found || refusal(found.name)) continue;
    // `plan.md` beside `plan.note.md` is one name twice; the `.md` is the note.
    const key = `${found.kind === "file" ? "file" : "text"}:${found.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const d: Listed = { kind: found.kind, name: found.name, file: at };
    docs.push(d);
    order.push(d);
  }
  return { docs, folders, order, mark };
}

/** What a walk found: every document and folder, and each folder's mtime (`""` is the root's). */
export interface Walked {
  docs: Listed[];
  folders: string[];
  marks: Record<string, number>;
}

/** Every document of every kind under `from` (the root when empty), and every folder, sorted. Never follows a link. */
export function walk(root: string, types: ReadonlySet<string>, from = ""): Walked {
  const docs: Listed[] = [];
  const folders: string[] = [];
  const marks: Record<string, number> = {};
  const into = (rel: string): void => {
    const s = scanDir(root, rel, types);
    if (s.mark === null) return;
    marks[rel] = s.mark;
    for (const x of s.order) {
      if (typeof x !== "string") docs.push(x);
      else {
        folders.push(x);
        into(x);
      }
    }
  };
  into(from);
  return { docs, folders, marks };
}

/**
 * One document's stat and, for a text, its frontmatter — `had` again when the stat has not moved,
 * read otherwise. A path that is a link, or that leads out of the vault (a folder swapped for a link
 * after the walk), is not read: the walk never follows one, and neither does this.
 */
export function readFound(root: string, d: Listed, had: Front | undefined, inside: (abs: string) => boolean): Found {
  const none: Found = { front: null, size: null, born: null };
  const abs = path.join(root, ...d.file.split("/"));
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs);
    if (!st.isFile() || !inside(abs)) return none;
  } catch {
    return none;
  }
  const born = st.birthtimeMs || st.mtimeMs;
  if (d.kind === "file") return { front: null, size: st.size, born };
  const stamp = stampOf(st);
  if (had?.stamp === stamp) return { front: had, size: null, born };
  let text: string;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    return { ...none, born };
  }
  return { front: frontOf(d.kind, text, stamp, st.mtimeMs), size: null, born };
}

/** What says a text has not changed since it was read: its mtime, size and inode. */
const stampOf = (st: fs.Stats): string => `${st.mtimeMs}:${st.size}:${st.ino}`;

/**
 * The listing of one folder, keeping each text's frontmatter against the stat it was read at, so a
 * second listing reads only what changed. One per vault, on whichever thread lists it.
 */
export class Lister {
  private fronts = new Map<string, Front>();

  constructor(readonly root: string) {}

  list(types: ReadonlySet<string>): Listing {
    const { docs, folders, marks } = walk(this.root, types);
    const kept = new Map<string, Front>();
    const inside = insideOf(this.root);
    const found = docs.map((d) => {
      const f = readFound(this.root, d, this.fronts.get(d.file), inside);
      if (f.front) kept.set(d.file, f.front);
      return f;
    });
    this.fronts = kept;
    return { docs, folders, marks, found };
  }
}

/**
 * Whether a regular file (`readFound` has `lstat`ed it) is inside `root`: its folder's real path is.
 * A file that is not a link leads nowhere its folder does not, so each folder is resolved once —
 * resolving every file was 250 ms of a listing of 50,000.
 */
export function insideOf(root: string): (abs: string) => boolean {
  let real: string | null = null;
  const dirs = new Map<string, boolean>();
  return (abs) => {
    real ??= fs.realpathSync(root);
    const dir = path.dirname(abs);
    let ok = dirs.get(dir);
    if (ok === undefined) {
      const resolved = fs.realpathSync(dir);
      ok = resolved === real || resolved.startsWith(real + path.sep);
      dirs.set(dir, ok);
    }
    return ok;
  };
}

/* -- the thread ----------------------------------------------------------------------------- */

/** What goes to the worker — a listing, the next part of one, a vault closed — and what comes back. */
export type ListAsk = { id: number; root: string; types: string[]; walkOnly: boolean } | { next: number } | { forget: string };
/**
 * A listing comes back in parts of `PART` documents and then its folders, **each part asked for
 * after the last was read**: one message of 50,000 documents took 120 ms to read on the thread that
 * receives it, and so did 25 small ones sent together, because a thread reads every message waiting
 * for it in one go.
 */
export type ListAnswer =
  | { id: number; docs: Listed[]; found: Found[] }
  | { id: number; folders: string[]; marks: Record<string, number> }
  | { id: number; error: string };

const PART = 2000;

/** A listing as the messages that carry it. */
export function* parts(id: number, l: Listing): Generator<ListAnswer> {
  for (let i = 0; i < l.docs.length; i += PART) yield { id, docs: l.docs.slice(i, i + PART), found: l.found.slice(i, i + PART) };
  yield { id, folders: l.folders, marks: l.marks };
}

let workerOverride: string | null | undefined;

/** Point the listing at a built worker, or `null` for inline — for a test that builds one. */
export function useListWorker(file: string | null | undefined): void {
  workerOverride = file;
  thread?.stop();
  thread = undefined;
}

/** The built worker beside this bundle, or none — the unit suite runs the TypeScript, and lists inline. */
function workerFile(): string | null {
  if (workerOverride !== undefined) return workerOverride;
  if (process.env.ANYDAG_LIST_INLINE === "1") return null;
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "list-worker.mjs");
    return fs.existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

class Thread {
  private worker: Worker | null = null;
  private next = 1;
  private waiting = new Map<number, { ok: (l: Listing) => void; no: (e: Error) => void; docs: Listed[]; found: Found[] }>();

  constructor(private readonly file: string) {}

  private start(): Worker {
    const w = new Worker(this.file);
    w.on("message", (m: ListAnswer) => {
      const at = this.waiting.get(m.id);
      if (!at) return;
      if ("docs" in m) {
        for (const d of m.docs) at.docs.push(d);
        for (const f of m.found) at.found.push(f);
        // The next part once whatever else is waiting on this thread has had its turn.
        setImmediate(() => w.postMessage({ next: m.id } satisfies ListAsk));
        return;
      }
      this.waiting.delete(m.id);
      if (!this.waiting.size) w.unref();
      if ("error" in m) at.no(new Error(m.error));
      else at.ok({ docs: at.docs, folders: m.folders, marks: m.marks, found: at.found });
    });
    // A worker that died takes its questions with it; the next one starts a new worker.
    const gone = (e: Error) => {
      if (this.worker !== w) return;
      this.worker = null;
      for (const at of this.waiting.values()) at.no(e);
      this.waiting.clear();
    };
    w.on("error", gone);
    w.on("exit", (code) => gone(new Error(`the listing's worker stopped (${code})`)));
    w.unref();
    return w;
  }

  ask(root: string, types: ReadonlySet<string>, walkOnly: boolean): Promise<Listing> {
    const w = (this.worker ??= this.start());
    const id = this.next++;
    return new Promise((ok, no) => {
      this.waiting.set(id, { ok, no, docs: [], found: [] });
      // An idle worker does not hold the process open; one with a question out does.
      w.ref();
      w.postMessage({ id, root, types: [...types], walkOnly } satisfies ListAsk);
    });
  }

  forget(root: string): void {
    this.worker?.postMessage({ forget: root } satisfies ListAsk);
  }

  stop(): void {
    const w = this.worker;
    this.worker = null;
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

/**
 * The listing of `lister`'s folder, on the worker when there is one. `walkOnly` leaves `found`
 * empty: the documents and folders, nothing read. A worker that failed lists inline instead.
 */
export async function listVault(lister: Lister, types: ReadonlySet<string>, walkOnly = false): Promise<Listing> {
  const t = theThread();
  if (t) {
    try {
      return await t.ask(lister.root, types, walkOnly);
    } catch (e) {
      console.warn(`anydag: listing ${lister.root} inline: ${(e as Error)?.message ?? e}`);
    }
  }
  return walkOnly ? { ...walk(lister.root, types), found: [] } : lister.list(types);
}

/** A vault closed: let the worker drop what it kept of it. */
export function forgetVault(root: string): void {
  thread?.forget(root);
}
