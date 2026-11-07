/**
 * The change recorder: what a chat's writes replaced, so a
 * block of them can be undone.
 *
 * **It records at the filesystem, not at the routes.** Every write the server makes into a vault is
 * a synchronous `fs` call — a document, its images, an attachment's id file, a trash entry, a folder —
 * so wrapping the eight `fs` functions that change a disk catches every one of them, and no route had
 * to learn that a chat exists. The wrappers do nothing unless a recording is running in this async
 * context (`AsyncLocalStorage`), and nothing for a path outside that recording's vault.
 *
 * A recording is one **op**: one request a chat's agent made. The first time an op touches a path,
 * what was there is kept — the bytes, a folder's whole tree, the fact that nothing was, or, for a
 * folder renamed, where it went. When the op ends, a hash of what each path then holds is kept beside
 * it. Undo restores an op only if **every** path it touched still holds what the op left; otherwise
 * the op is a conflict and is left alone, so a person's later edit is never overwritten.
 *
 * An undo runs inside a recording of its own, so it is itself a set of ops a redo can reverse.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Past this, a file or a folder is not kept, and the op it is in cannot be undone. */
export const IMAGE_CAP = 8 * 1024 * 1024;

/** What a path held before an op touched it. Bytes are base64, so a turn file is plain JSON. */
export type Before =
  | { t: "absent" }
  | { t: "file"; b64: string }
  | { t: "dir"; files: Record<string, string>; dirs: string[] }
  /** A folder (or a file too large to keep) renamed: it is at `to` now, relative to the vault. */
  | { t: "moved"; to: string }
  | { t: "big"; size: number };

export interface Image {
  /** Relative to the vault, with `/`. */
  rel: string;
  before: Before;
  /** What the op left there: `-` for nothing, `f:<sha1>` for a file, `d:<sha1>` for a folder. */
  after: string;
}

export interface Op {
  /** The route that made it, `POST /__board/patch`, so a block can say what happened. */
  what: string;
  vault: string;
  at: string;
  /** In the order they were first touched; undo restores them in reverse. */
  images: Image[];
  /** False when an image is `big`: the op is shown, never undone. */
  undoable: boolean;
}

interface Recording {
  root: string;
  vault: string;
  what: string;
  order: string[];
  before: Map<string, Before>;
  closed: boolean;
}

const als = new AsyncLocalStorage<Recording>();
let busy = false;

/** `.anydag/chats/` is the chat's own record, and a temp file beside a target is `writeAtomic`'s. */
function ignored(rel: string): boolean {
  if (rel === ".anydag/chats" || rel.startsWith(".anydag/chats/")) return true;
  return /^\..+\.\d+\.tmp$/.test(path.posix.basename(rel));
}

function relOf(r: Recording, p: unknown): string | null {
  if (typeof p !== "string") return null;
  const rel = path.relative(r.root, path.resolve(p));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const posix = rel.split(path.sep).join("/");
  return ignored(posix) ? null : posix;
}

function sizeOf(abs: string, st: fs.Stats): number {
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const sub = path.join(abs, e.name);
    n += e.isDirectory() ? sizeOf(sub, fs.statSync(sub)) : fs.statSync(sub).size;
    if (n > IMAGE_CAP) return n;
  }
  return n;
}

function capture(abs: string): Before {
  const st = fs.lstatSync(abs, { throwIfNoEntry: false });
  if (!st) return { t: "absent" };
  const size = sizeOf(abs, st);
  if (size > IMAGE_CAP) return { t: "big", size };
  if (!st.isDirectory()) return { t: "file", b64: fs.readFileSync(abs).toString("base64") };
  const files: Record<string, string> = {};
  const dirs: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const sub = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        dirs.push(r);
        walk(sub, r);
      } else files[r] = fs.readFileSync(sub).toString("base64");
    }
  };
  walk(abs, "");
  return { t: "dir", files, dirs };
}

function touch(r: Recording, rel: string, before?: Before): void {
  if (r.before.has(rel)) return;
  r.before.set(rel, before ?? capture(path.join(r.root, rel)));
  r.order.push(rel);
}

/** What a path holds now, as an `Image.after` compares it. */
export function hashOf(abs: string): string {
  const st = fs.lstatSync(abs, { throwIfNoEntry: false });
  if (!st) return "-";
  if (!st.isDirectory()) return `f:${createHash("sha1").update(fs.readFileSync(abs)).digest("hex")}`;
  const h = createHash("sha1");
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const sub = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        h.update(`d ${r}\n`);
        walk(sub, r);
      } else h.update(`f ${r} ${createHash("sha1").update(fs.readFileSync(sub)).digest("hex")}\n`);
    }
  };
  walk(abs, "");
  return `d:${h.digest("hex")}`;
}

/* -- the hooks ------------------------------------------------------------------------------- */

type AnyFn = (...args: any[]) => any;
let installed = false;

/** Wrap `fs`'s eight mutating functions, once per process. Inert outside a recording. */
export function installFsHooks(): void {
  if (installed) return;
  installed = true;
  const f = fs as unknown as Record<string, AnyFn>;
  const wrap = (name: string, before: (r: Recording, args: unknown[]) => void) => {
    const orig = f[name]!;
    f[name] = function (this: unknown, ...args: unknown[]) {
      const r = als.getStore();
      if (r && !r.closed && !busy) {
        busy = true;
        try {
          before(r, args);
        } catch (e) {
          console.error("anydag: chat recorder:", e);
        } finally {
          busy = false;
        }
      }
      return orig.apply(this, args);
    };
  };
  const one = (i: number) => (r: Recording, args: unknown[]) => {
    const rel = relOf(r, args[i]);
    if (rel) touch(r, rel);
  };
  wrap("writeFileSync", one(0));
  wrap("rmSync", one(0));
  wrap("rmdirSync", one(0));
  wrap("unlinkSync", one(0));
  wrap("cpSync", one(1));
  wrap("copyFileSync", one(1));
  wrap("mkdirSync", (r, args) => {
    // A recursive mkdir makes every missing folder up the chain: the topmost one is what appeared.
    let rel = relOf(r, args[0]);
    if (!rel) return;
    let top: string | null = null;
    while (rel && rel !== "." && !fs.existsSync(path.join(r.root, rel))) {
      top = rel;
      const up = path.posix.dirname(rel);
      if (up === rel || up === ".") break;
      rel = up;
    }
    if (top) touch(r, top);
  });
  wrap("renameSync", (r, args) => {
    const from = relOf(r, args[0]);
    const to = relOf(r, args[1]);
    if (to) touch(r, to);
    if (!from) return;
    const abs = path.join(r.root, from);
    const st = fs.lstatSync(abs, { throwIfNoEntry: false });
    // A folder, or a file too large to keep, is followed rather than copied: it is wherever it went.
    if (st && to && (st.isDirectory() || st.size > IMAGE_CAP)) touch(r, from, { t: "moved", to });
    else touch(r, from);
  });
}

/* -- recording ------------------------------------------------------------------------------- */

/**
 * Run `fn` as one op on `vault`, and hand back what it changed — `null` when it touched nothing.
 * The op is closed when `fn` settles: a timer `fn` left behind cannot add to it later.
 */
export async function record<T>(vault: { id: string; root: string }, what: string, fn: () => Promise<T>): Promise<{ value: T; op: Op | null }> {
  installFsHooks();
  const r: Recording = { root: vault.root, vault: vault.id, what, order: [], before: new Map(), closed: false };
  try {
    const value = await als.run(r, fn);
    return { value, op: close(r) };
  } catch (e) {
    // A route that threw part-way still changed what it changed.
    const op = close(r);
    throw Object.assign(e as object, { op });
  }
}

function close(r: Recording): Op | null {
  r.closed = true;
  if (!r.order.length) return null;
  const images: Image[] = r.order.map((rel) => ({ rel, before: r.before.get(rel)!, after: hashOf(path.join(r.root, rel)) }));
  // A path written and put back as it was is no change at all.
  const real = images.filter((i) => !(i.before.t === "absent" && i.after === "-"));
  if (!real.length) return null;
  return { what: r.what, vault: r.vault, at: new Date().toISOString(), images: real, undoable: real.every((i) => i.before.t !== "big") };
}

/* -- undo ------------------------------------------------------------------------------------ */

export interface Undone {
  /** The ops the undo itself made — reversed by a redo. */
  ops: Op[];
  /** What was left alone, and why: a path changed since, a vault not open, an op too large. */
  conflicts: { what: string; vault: string; paths: string[]; why: "changed" | "closed" | "big" }[];
}

function restore(root: string, img: Image): void {
  const abs = path.join(root, img.rel);
  const b = img.before;
  switch (b.t) {
    case "absent":
      fs.rmSync(abs, { recursive: true, force: true });
      return;
    case "file": {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (fs.lstatSync(abs, { throwIfNoEntry: false })?.isDirectory()) fs.rmSync(abs, { recursive: true, force: true });
      const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`);
      fs.writeFileSync(tmp, Buffer.from(b.b64, "base64"));
      fs.renameSync(tmp, abs);
      return;
    }
    case "dir":
      fs.rmSync(abs, { recursive: true, force: true });
      fs.mkdirSync(abs, { recursive: true });
      for (const d of b.dirs) fs.mkdirSync(path.join(abs, d), { recursive: true });
      for (const [rel, b64] of Object.entries(b.files)) {
        fs.mkdirSync(path.dirname(path.join(abs, rel)), { recursive: true });
        fs.writeFileSync(path.join(abs, rel), Buffer.from(b64, "base64"));
      }
      return;
    case "moved": {
      const from = path.join(root, b.to);
      if (!fs.existsSync(from)) return;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.renameSync(from, abs);
      return;
    }
    case "big":
      throw new Error(`\`${img.rel}\` is too large to have been kept`);
  }
}

/**
 * Put back what `ops` replaced, newest op first, each only if every path it touched still holds what
 * it left. `roots` finds a vault's folder by id; a vault that is not open is a conflict.
 */
export async function undo(ops: readonly Op[], roots: (vault: string) => string | null): Promise<Undone> {
  const out: Undone = { ops: [], conflicts: [] };
  for (const op of [...ops].reverse()) {
    const root = roots(op.vault);
    if (!root) {
      out.conflicts.push({ what: op.what, vault: op.vault, paths: op.images.map((i) => i.rel), why: "closed" });
      continue;
    }
    if (!op.undoable) {
      out.conflicts.push({ what: op.what, vault: op.vault, paths: op.images.filter((i) => i.before.t === "big").map((i) => i.rel), why: "big" });
      continue;
    }
    const moved = op.images.filter((i) => hashOf(path.join(root, i.rel)) !== i.after).map((i) => i.rel);
    if (moved.length) {
      out.conflicts.push({ what: op.what, vault: op.vault, paths: moved, why: "changed" });
      continue;
    }
    const { op: made } = await record({ id: op.vault, root }, `undo ${op.what}`, async () => {
      for (const img of [...op.images].reverse()) restore(root, img);
    });
    if (made) out.ops.push(made);
  }
  // `out.ops` is in the order the undo made them, which is what a redo reverses.
  return out;
}
