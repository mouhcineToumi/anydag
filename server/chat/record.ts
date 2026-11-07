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
const IMAGE_CAP = 8 * 1024 * 1024;

/** What a path held before an op touched it. Bytes are base64, so a turn file is plain JSON. */
type Before =
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

/** `abs` relative to the vault, with `/` — or null for the root itself, anything outside it, or a path `ignored`. */
function vaultRel(root: string, abs: string): string | null {
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const posix = rel.split(path.sep).join("/");
  return ignored(posix) ? null : posix;
}

function relOf(r: Recording, p: unknown): string | null {
  if (typeof p !== "string") return null;
  return vaultRel(r.root, path.resolve(p));
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

const BEFORE = new Set(["absent", "file", "dir", "moved", "big"]);

/** Whether `x` has an op's shape, as a turn or an undo file read back from a vault must. Its paths are `undo`'s to check. */
export function isOp(x: unknown): x is Op {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.what !== "string" || typeof o.vault !== "string" || typeof o.undoable !== "boolean" || !Array.isArray(o.images)) return false;
  return o.images.every((i: unknown) => {
    if (!i || typeof i !== "object") return false;
    const { rel, before, after } = i as Record<string, unknown>;
    return typeof rel === "string" && typeof after === "string" && !!before && typeof before === "object" && BEFORE.has((before as { t?: unknown }).t as string);
  });
}

export interface Undone {
  /** The ops the undo itself made — reversed by a redo. */
  ops: Op[];
  /** What was left alone, and why. */
  conflicts: Conflict[];
}

/** An op left alone: a path changed since, a vault not open, an op too large, or one undo may not touch. */
export interface Conflict {
  what: string;
  vault: string;
  paths: string[];
  why: "changed" | "closed" | "big" | "refused";
}

/*
 * An op is read back from the vault (`<vault>/.anydag/chats/`), and anybody who can write the vault — a
 * synced device, a shared or downloaded folder — can write one. So nothing in it is trusted: every path
 * an undo uses is confined again here, by the rule `relOf` records with, and an op holding one path
 * that fails is left alone whole.
 */

/** `rel` joined onto `base`, if it stays strictly inside it and inside the vault by `vaultRel`'s rule. */
function confined(root: string, base: string, rel: unknown): string | null {
  if (typeof rel !== "string" || !rel || rel.includes("\0") || path.isAbsolute(rel) || path.win32.isAbsolute(rel)) return null;
  const abs = path.resolve(base, rel);
  const inBase = path.relative(base, abs);
  if (!inBase || inBase.startsWith("..") || path.isAbsolute(inBase)) return null;
  return vaultRel(root, abs) === null ? null : abs;
}

/**
 * Whether the folder `abs` would be written in is really in the vault: the nearest one that exists,
 * with its links resolved. A link inside the vault to a folder outside it is lexically inside.
 */
function reallyIn(realRoot: string, abs: string): boolean {
  let dir = path.dirname(abs);
  while (!fs.existsSync(dir)) {
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
  let real: string;
  try {
    real = fs.realpathSync(dir);
  } catch {
    return false;
  }
  const rel = path.relative(realRoot, real);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** An image as undo will use it: every path it touches, already confined. */
interface Plan {
  img: Image;
  /** The vault's folder with its links resolved, to check again as each path is written. */
  realRoot: string;
  abs: string;
  /** A folder's entries, joined onto `abs`. */
  dirs?: string[];
  files?: [string, Buffer][];
  /** Where a `moved` image is now. */
  from?: string;
}

const isStr = (v: unknown): v is string => typeof v === "string";

/** Plan every image of `op`, or null if any one path in it is not one undo may touch. */
function planOf(root: string, op: Op): Plan[] | null {
  if (!Array.isArray(op.images)) return null;
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return null;
  }
  const plans: Plan[] = [];
  const real = (abs: string) => reallyIn(realRoot, abs);
  for (const img of op.images as unknown[]) {
    if (!img || typeof img !== "object") return null;
    const { rel, before: b, after } = img as Image;
    if (!isStr(after) || !b || typeof b !== "object") return null;
    const abs = confined(root, root, rel);
    if (!abs || !real(abs)) return null;
    const plan: Plan = { img: img as Image, realRoot, abs };
    switch (b.t) {
      case "absent":
      case "big":
        break;
      case "file":
        if (!isStr(b.b64)) return null;
        break;
      case "dir": {
        if (!Array.isArray(b.dirs) || !b.files || typeof b.files !== "object" || Array.isArray(b.files)) return null;
        plan.dirs = [];
        for (const d of b.dirs as unknown[]) {
          const at = confined(root, abs, d);
          if (!at) return null;
          plan.dirs.push(at);
        }
        plan.files = [];
        for (const [k, b64] of Object.entries(b.files as Record<string, unknown>)) {
          const at = confined(root, abs, k);
          if (!at || !isStr(b64)) return null;
          plan.files.push([at, Buffer.from(b64, "base64")]);
        }
        break;
      }
      case "moved": {
        const from = confined(root, root, b.to);
        // The recorder follows only a folder or a large file it saw renamed, never a link.
        if (!from || !real(from) || fs.lstatSync(from, { throwIfNoEntry: false })?.isSymbolicLink()) return null;
        plan.from = from;
        break;
      }
      default:
        return null;
    }
    plans.push(plan);
  }
  return plans;
}

function restore(plan: Plan): void {
  const { img, abs } = plan;
  const b = img.before;
  // Checked again as it is written: an image restored before this one may have put a folder where it was not.
  const check = (at: string) => {
    if (!reallyIn(plan.realRoot, at)) throw new Error(`\`${img.rel}\` is not in the vault`);
  };
  check(abs);
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
      for (const d of plan.dirs!) {
        check(d);
        fs.mkdirSync(d, { recursive: true });
      }
      for (const [at, bytes] of plan.files!) {
        check(at);
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, bytes);
      }
      return;
    case "moved": {
      const from = plan.from!;
      check(from);
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
 * it left. `roots` finds a vault's folder by id; a vault that is not open is a conflict, and so is
 * one `reaches` says the ops' owner may not touch.
 */
export async function undo(ops: readonly Op[], roots: (vault: string) => string | null, reaches: (vault: string) => boolean = () => true): Promise<Undone> {
  const out: Undone = { ops: [], conflicts: [] };
  const pathsOf = (op: Op): string[] => (Array.isArray(op.images) ? op.images.map((i) => String(i?.rel)) : []);
  for (const op of [...ops].reverse()) {
    if (!op || typeof op !== "object") {
      out.conflicts.push({ what: "", vault: "", paths: [], why: "refused" });
      continue;
    }
    const what = String(op.what);
    if (!isStr(op.vault) || !reaches(op.vault)) {
      out.conflicts.push({ what, vault: String(op.vault), paths: pathsOf(op), why: "refused" });
      continue;
    }
    const root = roots(op.vault);
    if (!root) {
      out.conflicts.push({ what, vault: op.vault, paths: pathsOf(op), why: "closed" });
      continue;
    }
    // Every path in the op is checked before any of it is restored: an op is put back whole or not at all.
    const plans = planOf(root, op);
    if (!plans) {
      out.conflicts.push({ what, vault: op.vault, paths: pathsOf(op), why: "refused" });
      continue;
    }
    // `undoable` is the file's word; a big image is never restored whatever it says.
    if (op.undoable !== true || plans.some((p) => p.img.before.t === "big")) {
      out.conflicts.push({ what, vault: op.vault, paths: op.images.filter((i) => i.before.t === "big").map((i) => i.rel), why: "big" });
      continue;
    }
    const moved = plans.filter((p) => hashOf(p.abs) !== p.img.after).map((p) => p.img.rel);
    if (moved.length) {
      out.conflicts.push({ what, vault: op.vault, paths: moved, why: "changed" });
      continue;
    }
    const { op: made } = await record({ id: op.vault, root }, `undo ${what}`, async () => {
      for (const p of [...plans].reverse()) restore(p);
    });
    if (made) out.ops.push(made);
  }
  // `out.ops` is in the order the undo made them, which is what a redo reverses.
  return out;
}
