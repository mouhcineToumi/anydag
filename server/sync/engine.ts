/**
 * The sync engine: one linked vault kept in step with
 * one remote vault. It pushes what changed here as a commit against the heads it last agreed with,
 * and pulls what changed elsewhere, deciding each path against its base — apply, merge, or keep
 * both. The loop that calls it (`loop.ts`) decides *when*; this decides *what*.
 *
 * Load-bearing:
 * - **The base decides.** A path whose disk sha1 is its state row's is clean here, so a remote change
 *   is applied over it; anything else was changed here, and a remote change is merged with it or
 *   written beside it. A conflict copy is the only way two versions survive, and nothing anybody
 *   wrote is dropped.
 * - **Every write is a compare-and-set** (`SyncFs.writeIf`/`removeIf`) against the bytes the decision
 *   was made on. The page or an agent writing in between wins; the engine reads again and decides
 *   again.
 * - **No echo.** After applying, the state holds the new sha1, so the watcher's event for that path
 *   finds the disk equal to its base and pushes nothing; and a pull skips a log entry whose key's
 *   state is already at or past it, which is how the device's own commits are not applied twice.
 * - **A commit is all or nothing, so a rename never lands half**: a delete and a create pushed
 *   together. On the way in, a page that deletes `P` and creates `Q` with `P`'s old blob, while `P`
 *   was edited here, is a rename: the edit follows the file to `Q`.
 * - **An empty-folder marker is present with the empty blob**, so a non-null blob always means
 *   present and `null` always means deleted.
 * - **Never the trash.** A delete is `removeIf`: the other device's delete already moved the file
 *   into `.anydag/trash/`, and that move syncs too.
 * - **One name, one kind.** `ideas.md` made on one device and `ideas.board.md` on another are two
 *   keys and both land, but the vault lists one document per name. `settleKinds` moves every one but
 *   the oldest to a numbered name — by created, then path, which every device reads alike — so each
 *   device moves the same file to the same name, and the moves agree when they meet.
 */

import { classify, unique } from "../names";
import { blobId, keyOf, keysOf, normalise, openBlob, sealBlob, type VaultKeys } from "../../api/protocol/crypto";
import { openMeta, sealMeta, type Meta } from "../../api/protocol/meta";
import { MAX_CHANGES, MAX_PAGE, type Change, type Head } from "../../api/protocol/wire";
import { Bases, sha1Of } from "./bases";
import { isSyncError, type SyncApi } from "./client";
import { conflictName, freshCopy, mergeContent } from "./merge";
import { dirSyncs, syncs } from "./scope";
import type { PathEntry, SyncState } from "./state";
import type { SyncFs } from "./types";

export interface EngineOptions {
  fs: SyncFs;
  api: SyncApi;
  state: SyncState;
  bases: Bases;
  vk: Uint8Array;
  /** The remote vault's id. */
  remote: string;
  device: { id: string; name: string };
  /** The attachment extensions this vault lists. */
  types: ReadonlySet<string>;
  now?: () => Date;
}

/** A remote version of one key: a log entry, or a head read during a resync. */
interface Incoming {
  seq: number;
  key: string;
  blob: string | null;
  meta: string;
}

/** A delete of `P` and a create of `Q` carrying `P`'s base, while `P` was edited here. */
interface Rename {
  del: Incoming;
  create: Incoming;
  from: PathEntry;
  ours: Uint8Array;
  oursSha: string;
}

/** What a dirty path is on disk now. */
type Local = { key: string; rel: string; kind: "file" | "dir"; bytes: Uint8Array } | { key: string; rel: string; absent: true };

/** One change a push is about to commit, and what to record when it lands. */
interface Pending {
  change: Change;
  rel: string;
  kind: "file" | "dir";
  bytes: Uint8Array | null;
  sha1: string | null;
}

const EMPTY = new Uint8Array(0);
/** How many times a push meets `ES_STALE`, pulls and tries again before leaving the rest for later. */
const STALE_ROUNDS = 5;
/** How many times one decision is made again because the disk moved under it. */
const CAS_ROUNDS = 8;
/** How old an mtime must be before a scan takes it as proof a file has not changed. */
const RACY_MS = 2000;

export class SyncEngine {
  private readonly fs: SyncFs;
  private readonly api: SyncApi;
  private readonly state: SyncState;
  private readonly bases: Bases;
  private readonly k: VaultKeys;
  private readonly remote: string;
  private readonly device: { id: string; name: string };
  private readonly types: ReadonlySet<string>;
  private readonly now: () => Date;
  /** Paths changed here and not yet committed: key → the path as spelled. */
  private readonly dirty = new Map<string, string>();
  private counts = { copied: 0, merged: 0 };
  /** One pull, push or resync at a time. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Files a pull wrote, for `settleKinds` once the page is applied. */
  private arrived = new Set<string>();

  constructor(o: EngineOptions) {
    this.fs = o.fs;
    this.api = o.api;
    this.state = o.state;
    this.bases = o.bases;
    this.k = keysOf(o.vk);
    this.remote = o.remote;
    this.device = o.device;
    this.types = o.types;
    this.now = o.now ?? (() => new Date());
  }

  // -- public -------------------------------------------------------------------------------------

  /** Paths changed here and not yet committed. */
  pending(): number {
    return this.dirty.size;
  }

  /** Conflict copies this device wrote, as far as the last scan knows still on disk. */
  conflicts(): string[] {
    return this.state.conflicts().map((c) => c.rel);
  }

  /** The vault against the state: every path whose disk differs from its base is marked. */
  scan(): Promise<void> {
    return this.locked(() => this.scanInner());
  }

  /** The watcher's paths: each one that syncs, could be a folder, or has a base, is marked. */
  touch(rels: string[]): void {
    for (const raw of rels) {
      let rel: string;
      try {
        rel = normalise(raw);
      } catch {
        continue;
      }
      const key = this.keyOf(rel);
      if (syncs(rel, this.types) || dirSyncs(rel) || this.state.entry(key)) this.dirty.set(key, rel);
      // A file arriving in a folder that was a marker ends the marker.
      this.markAncestors(rel, (st) => st.kind === "dir" && st.blob !== null);
    }
  }

  pull(): Promise<void> {
    return this.locked(() => this.pullInner());
  }

  push(): Promise<void> {
    return this.locked(() => this.pushInner());
  }

  /** Pull, then push (which pulls and pushes again on `ES_STALE`). */
  syncOnce(): Promise<void> {
    return this.locked(async () => {
      await this.pullInner();
      await this.pushInner();
      this.trimBases();
      this.state.set("last", this.now().toISOString());
    });
  }

  /** Every head against the state: how a device links, and what a `410` falls back to. */
  resync(): Promise<void> {
    return this.locked(() => this.resyncInner());
  }

  // -- plumbing -----------------------------------------------------------------------------------

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private keyOf(rel: string): string {
    return keyOf(this.k.path, rel);
  }

  private mark(key: string, rel: string): void {
    this.dirty.set(key, rel);
  }

  private markAncestors(rel: string, want: (st: PathEntry) => boolean): void {
    const parts = rel.split("/");
    for (let i = parts.length - 1; i > 0; i--) {
      const dir = parts.slice(0, i).join("/");
      const key = this.keyOf(dir);
      const st = this.state.entry(key);
      if (st && want(st)) this.dirty.set(key, st.rel);
    }
  }

  private async fetchBlob(id: string): Promise<Uint8Array> {
    return openBlob(this.k.enc, id, await this.api.getBlob(this.remote, id));
  }

  /** The plaintext of a state row's base: kept here, else fetched from the server. */
  private async baseOf(st: PathEntry): Promise<Uint8Array | null> {
    if (st.blob === null) return null;
    if (st.sha1) {
      const kept = this.bases.get(st.sha1);
      if (kept) return kept;
    }
    const bytes = await this.fetchBlob(st.blob);
    this.bases.put(bytes);
    return bytes;
  }

  private trimBases(): void {
    const keep = new Set<string>();
    for (const st of this.state.entries()) if (st.sha1) keep.add(st.sha1);
    this.bases.trim(keep);
  }

  private async flushReport(): Promise<void> {
    const { copied, merged } = this.counts;
    this.counts = { copied: 0, merged: 0 };
    if (!copied && !merged) return;
    await this.api.report(this.remote, { copied, merged }).catch(() => undefined);
  }

  // -- scan ---------------------------------------------------------------------------------------

  private async scanInner(): Promise<void> {
    const found = await this.fs.scan();
    const seen = new Set<string>();
    const files = new Set<string>();
    for (const e of found) {
      const rel = normalise(e.rel);
      const key = this.keyOf(rel);
      seen.add(key);
      const st = this.state.entry(key);
      if (e.kind === "dir") {
        if (!st || st.blob === null || st.kind !== "dir" || st.rel !== rel) this.mark(key, rel);
        continue;
      }
      files.add(rel.toLowerCase());
      if (!st || st.blob === null || st.kind !== "file" || st.rel !== rel || st.size !== e.size) {
        this.mark(key, rel);
        continue;
      }
      const mtime = Math.floor(e.mtime);
      if (st.mtime !== 0 && st.mtime === mtime) continue;
      const bytes = await this.fs.read(rel);
      if (!bytes || sha1Of(bytes) !== st.sha1) this.mark(key, rel);
      // An mtime is trusted only once it is older than the clock's grain: a write in the same tick
      // as this read would otherwise keep the mtime and the size, and never be read again.
      else if (Date.now() - e.mtime > RACY_MS) this.state.put({ ...st, mtime });
    }
    for (const st of this.state.entries()) if (st.blob !== null && !seen.has(st.key)) this.mark(st.key, st.rel);
    for (const c of this.state.conflicts()) if (!files.has(c.rel.toLowerCase())) this.state.dropConflict(c.rel);
  }

  // -- push ---------------------------------------------------------------------------------------

  private async pushInner(): Promise<void> {
    // A file made here beside another kind of the same name (a file manager can) is settled before
    // it is pushed, by the rule every device applies.
    await this.settleKinds([...this.dirty.values()]);
    for (let round = 0; round < STALE_ROUNDS; round++) {
      if ((await this.pushRound()) === "done") return;
      await this.pullInner();
    }
  }

  /** What every dirty path is on disk now. A folder needs a scan to be told from nothing at all. */
  private async locals(work: Map<string, string>): Promise<{ locals: Local[]; skipped: Set<string> }> {
    const locals: Local[] = [];
    const skipped = new Set<string>();
    const maybe = new Map<string, string>();
    const parentsOf = (rel: string): void => {
      const parts = rel.split("/");
      for (let i = parts.length - 1; i > 0; i--) {
        const dir = parts.slice(0, i).join("/");
        const key = this.keyOf(dir);
        if (!work.has(key) && !maybe.has(key) && dirSyncs(dir)) maybe.set(key, dir);
      }
    };
    for (const [key, rel] of work) {
      const st = this.state.entry(key);
      if (syncs(rel, this.types)) {
        const bytes = await this.fs.read(rel);
        if (bytes) locals.push({ key, rel, kind: "file", bytes });
        else {
          maybe.set(key, rel);
          parentsOf(rel);
        }
        continue;
      }
      if (st && st.kind === "file" && st.blob !== null) {
        // A file whose name no longer syncs — the vault's types changed. Present, it is left alone.
        if (await this.fs.read(rel)) {
          skipped.add(key);
          continue;
        }
        maybe.set(key, rel);
        parentsOf(rel);
        continue;
      }
      maybe.set(key, rel);
    }
    if (maybe.size) {
      const dirs = new Map<string, string>();
      for (const e of await this.fs.scan()) {
        if (e.kind !== "dir") continue;
        const rel = normalise(e.rel);
        dirs.set(this.keyOf(rel), rel);
      }
      for (const [key, rel] of maybe) {
        const dir = dirs.get(key);
        locals.push(dir ? { key, rel: dir, kind: "dir", bytes: EMPTY } : { key, rel, absent: true });
      }
    }
    return { locals, skipped };
  }

  /** The change a path needs, or `null` when its disk is its base. */
  private changeFor(l: Local): Pending | null {
    const st = this.state.entry(l.key);
    const now = this.now().getTime();
    if ("absent" in l) {
      if (!st || st.blob === null) return null;
      const meta: Meta = { path: st.rel, kind: st.kind, created: null, mtime: now, size: 0 };
      return {
        change: { key: l.key, parent: st.seq, blob: null, meta: sealMeta(this.k.enc, l.key, meta) },
        rel: st.rel,
        kind: st.kind,
        bytes: null,
        sha1: null,
      };
    }
    const sha1 = sha1Of(l.bytes);
    if (st && st.blob !== null && st.sha1 === sha1 && st.kind === l.kind && st.rel === l.rel) return null;
    const blob = blobId(this.k.blob, l.bytes);
    const meta: Meta = {
      path: l.rel,
      kind: l.kind,
      created: l.kind === "file" ? this.fs.createdOf(l.rel) : null,
      mtime: now,
      size: l.bytes.byteLength,
    };
    // A delete's head is a head: `null` only for a key this device has never seen a head for.
    const parent = st ? st.seq : null;
    return {
      change: { key: l.key, parent, blob, meta: sealMeta(this.k.enc, l.key, meta) },
      rel: l.rel,
      kind: l.kind,
      bytes: l.bytes,
      sha1,
    };
  }

  private async upload(ids: Iterable<string>, plain: Map<string, Uint8Array>, force = false): Promise<void> {
    for (const id of ids) {
      const bytes = plain.get(id);
      if (!bytes) continue;
      if (!force && (await this.api.hasBlob(this.remote, id)) !== null) continue;
      await this.api.putBlob(this.remote, id, sealBlob(this.k.enc, id, bytes));
    }
  }

  private async commit(changes: Change[], plain: Map<string, Uint8Array>): Promise<number[]> {
    try {
      return (await this.api.commit(this.remote, changes)).seqs;
    } catch (e) {
      if (!isSyncError(e, "ES_NO_BLOB")) throw e;
      await this.upload(e.body?.missing ?? changes.flatMap((c) => (c.blob ? [c.blob] : [])), plain, true);
      return (await this.api.commit(this.remote, changes)).seqs;
    }
  }

  private async pushRound(): Promise<"done" | "stale"> {
    if (!this.dirty.size) return "done";
    const work = new Map(this.dirty);
    this.dirty.clear();
    /* Everything this round may change: the dirty paths, and a folder a delete may have emptied. */
    const tracked = new Map(work);
    const settled = new Set<string>();
    try {
      const { locals, skipped } = await this.locals(work);
      for (const key of skipped) settled.add(key);
      const pending: Pending[] = [];
      const seen = new Set<string>();
      for (const l of locals) {
        if (seen.has(l.key)) continue;
        seen.add(l.key);
        if (!tracked.has(l.key)) tracked.set(l.key, l.rel);
        const p = this.changeFor(l);
        if (p) pending.push(p);
        else settled.add(l.key);
      }
      if (!pending.length) return "done";

      const plain = new Map<string, Uint8Array>();
      for (const p of pending) if (p.change.blob && p.bytes) plain.set(p.change.blob, p.bytes);
      await this.upload(plain.keys(), plain);

      for (let i = 0; i < pending.length; i += MAX_CHANGES) {
        const chunk = pending.slice(i, i + MAX_CHANGES);
        let seqs: number[];
        try {
          seqs = await this.commit(
            chunk.map((p) => p.change),
            plain,
          );
        } catch (e) {
          if (isSyncError(e, "ES_STALE")) return "stale";
          throw e;
        }
        for (let j = 0; j < chunk.length; j++) await this.landed(chunk[j]!, seqs[j]!, settled);
      }
      return "done";
    } finally {
      for (const [key, rel] of tracked) if (!settled.has(key) && !this.dirty.has(key)) this.dirty.set(key, rel);
    }
  }

  /** A committed change becomes the base; a disk that moved since it was read stays dirty. */
  private async landed(p: Pending, seq: number, settled: Set<string>): Promise<void> {
    const key = p.change.key;
    if (p.bytes) this.bases.put(p.bytes);
    this.state.put({
      key,
      rel: p.rel,
      kind: p.kind,
      seq,
      blob: p.change.blob,
      sha1: p.sha1,
      size: p.bytes?.byteLength ?? 0,
      mtime: 0,
    });
    settled.add(key);
    if (p.kind === "dir") return;
    const now = await this.fs.read(p.rel);
    const nowSha = now ? sha1Of(now) : null;
    if (nowSha !== p.sha1) this.mark(key, p.rel);
  }

  // -- pull ---------------------------------------------------------------------------------------

  private async pullInner(): Promise<void> {
    let cursor = this.state.cursor();
    for (;;) {
      let page;
      try {
        page = await this.api.changes(this.remote, cursor, MAX_PAGE);
      } catch (e) {
        if (isSyncError(e, "ES_HORIZON")) {
          await this.resyncInner();
          return;
        }
        throw e;
      }
      await this.applyPage(page.changes.map((c) => ({ seq: c.seq, key: c.key, blob: c.blob, meta: c.meta })));
      cursor = page.next;
      this.state.setCursor(cursor);
      if (!page.more) break;
    }
    await this.flushReport();
  }

  private async resyncInner(): Promise<void> {
    const heads: Head[] = [];
    let after = "";
    let first: number | null = null;
    for (;;) {
      const page = await this.api.heads(this.remote, after, MAX_PAGE);
      if (first === null) first = page.seq;
      heads.push(...page.heads);
      if (page.next === null) break;
      after = page.next;
    }
    await this.applyPage(heads.map((h) => ({ seq: h.seq, key: h.key, blob: h.blob, meta: h.meta })));
    const named = new Set(heads.map((h) => h.key));
    for (const st of this.state.entries()) if (!named.has(st.key)) await this.forget(st);
    this.state.setCursor(first ?? 0);
    await this.flushReport();
  }

  /** A key the server no longer names: deleted here if it was clean, ours alone (and pushed) if not. */
  private async forget(st: PathEntry): Promise<void> {
    this.state.drop(st.key);
    if (st.blob === null) return;
    if (st.kind === "dir") {
      if (await this.fs.rmdirIfEmpty(st.rel)) await this.pruneUp(st.rel);
      return;
    }
    const disk = await this.fs.read(st.rel);
    if (!disk) return;
    if (sha1Of(disk) === st.sha1 && (await this.fs.removeIf(st.rel, st.sha1))) {
      this.dirty.delete(st.key);
      await this.pruneUp(st.rel);
      return;
    }
    this.mark(st.key, st.rel);
  }

  private async applyPage(entries: Incoming[]): Promise<void> {
    const todo = entries.filter((e) => {
      const st = this.state.entry(e.key);
      return !st || st.seq < e.seq;
    });
    const renames = await this.findRenames(todo);
    const done = new Set<Incoming>();
    for (const e of todo) {
      if (done.has(e)) continue;
      const r = renames.get(e);
      if (r) {
        done.add(r.del);
        done.add(r.create);
        await this.applyRename(r);
        continue;
      }
      await this.apply(e);
    }
    const arrived = [...this.arrived];
    this.arrived.clear();
    await this.settleKinds(arrived);
  }

  /** In one page: a delete of a path edited here, and a create carrying that path's base. */
  private async findRenames(todo: Incoming[]): Promise<Map<Incoming, Rename>> {
    const out = new Map<Incoming, Rename>();
    for (const del of todo) {
      if (del.blob !== null) continue;
      const from = this.state.entry(del.key);
      if (!from || from.blob === null || from.kind !== "file" || !from.sha1) continue;
      const ours = await this.fs.read(from.rel);
      if (!ours) continue;
      const oursSha = sha1Of(ours);
      if (oursSha === from.sha1) continue;
      const create = todo.find((c) => {
        if (c.blob !== from.blob || c.key === del.key || out.has(c)) return false;
        const at = this.state.entry(c.key);
        return !at || at.blob === null;
      });
      if (!create) continue;
      const r: Rename = { del, create, from, ours, oursSha };
      out.set(del, r);
      out.set(create, r);
    }
    return out;
  }

  private async applyRename(r: Rename): Promise<void> {
    const meta = openMeta(this.k.enc, r.create.key, r.create.meta);
    const rel = normalise(meta.path);
    const theirs = await this.fetchBlob(r.create.blob!);
    const base = (await this.baseOf(r.from)) ?? theirs;
    const res = mergeContent(rel, base, r.ours, theirs);
    const fallback = async (): Promise<void> => {
      await this.apply(r.del);
      await this.apply(r.create);
    };
    if (!("merged" in res) || meta.kind !== "file" || (await this.fs.read(rel))) return fallback();
    if (meta.created) this.fs.adoptCreated(rel, meta.created);
    if (!(await this.fs.writeIf(rel, res.merged, null))) return fallback();

    // Our edit now lives at the new path; the old one goes, unless it moved again meanwhile.
    const removed = await this.fs.removeIf(r.from.rel, r.oursSha);
    this.record(r.del, r.from.rel, r.from.kind, null);
    if (removed) {
      this.dirty.delete(r.del.key);
      await this.pruneUp(r.from.rel);
    } else this.mark(r.del.key, r.from.rel);

    this.record(r.create, rel, "file", theirs);
    if (sha1Of(res.merged) === sha1Of(theirs)) this.dirty.delete(r.create.key);
    else this.mark(r.create.key, rel);
  }

  /** A state row for a remote version this device now agrees with as its base. */
  private record(e: Incoming, rel: string, kind: "file" | "dir", theirs: Uint8Array | null): void {
    if (theirs) this.bases.put(theirs);
    if (theirs && kind === "file") this.arrived.add(rel);
    this.state.put({
      key: e.key,
      rel,
      kind,
      seq: e.seq,
      blob: e.blob,
      sha1: theirs ? sha1Of(theirs) : null,
      size: theirs?.byteLength ?? 0,
      mtime: 0,
    });
  }

  private async apply(e: Incoming): Promise<void> {
    const st = this.state.entry(e.key);
    if (st && st.seq >= e.seq) return;
    const meta = openMeta(this.k.enc, e.key, e.meta);
    const rel = normalise(meta.path);
    if (meta.kind === "dir") return this.applyDir(e, rel);
    const theirs = e.blob ? await this.fetchBlob(e.blob) : null;
    if (st && st.rel !== rel && st.blob !== null) await this.moveCase(st, rel);
    const here = await this.spelledHere(e.key, rel);
    for (let i = 0; i < CAS_ROUNDS; i++) {
      if (!(await this.decide(e, meta, here, theirs))) continue;
      if (here !== rel) {
        // The state keeps the remote's spelling and the key stays dirty, so the push commits ours.
        const now = this.state.entry(e.key);
        if (now) this.state.put({ ...now, rel });
        this.mark(e.key, here);
      }
      return;
    }
    throw new Error(`sync: ${rel} kept changing while it was being written`);
  }

  private async applyDir(e: Incoming, rel: string): Promise<void> {
    if (e.blob !== null) {
      await this.fs.mkdir(rel);
      this.record(e, rel, "dir", EMPTY);
    } else {
      // Recorded first, so the folder it leaves is no entry when the prune asks.
      this.record(e, rel, "dir", null);
      if (await this.fs.rmdirIfEmpty(rel)) await this.pruneUp(rel);
    }
    this.dirty.delete(e.key);
  }

  /**
   * A removal from another device emptied the folders above `rel`: each that now holds nothing and is
   * no entry of its own goes too. It was there only because of what was in it — an empty folder syncs
   * as a `dir` entry of its own — and the device that emptied it pushed it as one, in the same commit,
   * if it kept it: then it is in the state already, or arrives later in the page and is made again.
   * Left, it was an empty folder on this device and none on that one (seed 1656). A folder with
   * anything waiting to be pushed is kept.
   */
  private async pruneUp(rel: string): Promise<void> {
    const parts = rel.split("/");
    for (let i = parts.length - 1; i > 0; i--) {
      const dir = parts.slice(0, i).join("/");
      const key = this.keyOf(dir);
      const st = this.state.entry(key);
      if (!dirSyncs(dir) || this.dirty.has(key) || (st && st.blob !== null && st.kind === "dir")) return;
      if (!(await this.fs.rmdirIfEmpty(dir))) return;
    }
  }

  /**
   * One key, a new spelling: the same file under a name differing only by case. Moved when the old
   * name is there and the new one is not; on a file system that folds case they are one file, and
   * only the state's spelling changes.
   */
  private async moveCase(st: PathEntry, rel: string): Promise<void> {
    const atNew = await this.fs.read(rel);
    const atOld = await this.fs.read(st.rel);
    if (atOld && !atNew && (await this.fs.writeIf(rel, atOld, null))) await this.fs.removeIf(st.rel, sha1Of(atOld));
    this.state.put({ ...st, rel });
    if (this.dirty.has(st.key)) this.dirty.set(st.key, rel);
  }

  /**
   * Where this key's file is on this disk: `rel`, unless nothing is there and the same file is under
   * another case here — renamed by case on this device and not yet pushed, or made under another
   * case before either side synced. Deciding at `rel` would read "deleted here" and write a second
   * spelling beside the first; deciding at the local spelling merges into it, and the push then
   * commits that spelling.
   */
  private async spelledHere(key: string, rel: string): Promise<string> {
    if ((await this.fs.read(rel)) !== null) return rel;
    const lower = rel.toLowerCase();
    const st = this.state.entry(key);
    const named = [this.dirty.get(key), st?.rel].filter((r): r is string => !!r && r !== rel && r.toLowerCase() === lower);
    for (const r of named) if ((await this.fs.read(r)) !== null) return r;
    // Only a file this device had is looked for on the whole disk: a new file arriving is the common
    // case, and must not cost a scan each. It costs one listing of its folder, which finds a file
    // made here under another case that no event reported (seeds 1288, 1837, 2038): written beside
    // it, the key had two spellings on a disk that tells case apart, and the scans took turns.
    if (!st || st.blob === null) {
      const other = await this.fs.spelled(rel);
      if (other) this.mark(key, other);
      return other ?? rel;
    }
    for (const f of await this.fs.scan()) {
      if (f.kind === "file" && f.rel !== rel && f.rel.toLowerCase() === lower) {
        this.mark(key, f.rel);
        return f.rel;
      }
    }
    return rel;
  }

  /** One decision for one remote version. `false` when a compare-and-set lost and it must be made again. */
  private async decide(e: Incoming, meta: Meta, rel: string, theirs: Uint8Array | null): Promise<boolean> {
    const st = this.state.entry(e.key);
    const disk = await this.fs.read(rel);
    const diskSha = disk ? sha1Of(disk) : null;
    const baseSha = st && st.blob !== null ? st.sha1 : null;
    const theirSha = theirs ? sha1Of(theirs) : null;

    // Clean here: theirs wins.
    if (diskSha === baseSha) {
      if (theirs === null) {
        if (disk && !(await this.fs.removeIf(rel, diskSha!))) return false;
        if (disk) await this.pruneUp(rel);
      } else {
        // Theirs is what is here now, so its created is too — the path may have held another
        // document, and even the same bytes may have been born here in another second.
        if (meta.created) this.fs.adoptCreated(rel, meta.created);
        if (diskSha !== theirSha && !(await this.fs.writeIf(rel, theirs, diskSha))) return false;
      }
      this.record(e, rel, "file", theirs);
      this.dirty.delete(e.key);
      return true;
    }

    // Changed here.
    if (theirs === null) {
      this.record(e, rel, "file", null);
      // Deleted on both sides is nothing; an edit against a delete wins, and is pushed again.
      if (disk) this.mark(e.key, rel);
      else this.dirty.delete(e.key);
      return true;
    }
    if (!disk) {
      // Deleted here, edited there: the edit wins and the file comes back.
      if (meta.created) this.fs.adoptCreated(rel, meta.created);
      if (!(await this.fs.writeIf(rel, theirs, null))) return false;
      this.record(e, rel, "file", theirs);
      this.dirty.delete(e.key);
      return true;
    }
    if (diskSha === theirSha) {
      // Theirs is what is here and nothing is pushed: the created committed is the one to keep.
      if (meta.created) this.fs.adoptCreated(rel, meta.created);
      this.record(e, rel, "file", theirs);
      this.dirty.delete(e.key);
      return true;
    }

    const base = st && st.blob !== null ? await this.baseOf(st) : null;
    const res = base !== null ? mergeContent(rel, base, disk, theirs) : ({ conflict: true } as const);
    if ("merged" in res) {
      const mergedSha = sha1Of(res.merged);
      if (mergedSha !== diskSha && !(await this.fs.writeIf(rel, res.merged, diskSha))) return false;
      this.record(e, rel, "file", theirs);
      if (mergedSha === theirSha) {
        if (meta.created) this.fs.adoptCreated(rel, meta.created);
        this.dirty.delete(e.key);
      } else {
        this.mark(e.key, rel);
        this.counts.merged++;
      }
      return true;
    }

    // Neither merges: ours stays at the path, theirs is written beside it.
    await this.writeCopy(rel, theirs, disk, meta.created);
    this.record(e, rel, "file", theirs);
    this.mark(e.key, rel);
    return true;
  }

  /** A text document's name, lower case — what the vault lists one document under — or `null`. */
  private docName(rel: string): string | null {
    if (rel.split("/").some((seg) => seg.startsWith("."))) return null;
    const c = classify(rel, this.types);
    return c && c.kind !== "file" ? c.name.toLowerCase() : null;
  }

  /**
   * Where `rels` name a document another file names under another kind (`ideas.md` beside
   * `ideas.board.md`, or `plan.md` beside `plan.note.md`), every file of that name but the oldest
   * goes to a numbered name of its own — `ideas 2.board.md` — keeping its bytes, its id and its
   * created. Oldest by created, then by path: both travel with every push, so every device that
   * meets the pair moves the same file to the same name; the two moves are then a rename committed
   * twice, and the second meets identical bytes. Nothing is moved that a vault never lists together:
   * case alone is one key, and an attachment's name carries its extension.
   */
  private async settleKinds(rels: Iterable<string>): Promise<void> {
    const wanted = new Set<string>();
    for (const r of rels) {
      const n = this.docName(r);
      if (n) wanted.add(n);
    }
    if (!wanted.size) return;
    const files = (await this.fs.scan()).filter((e) => e.kind === "file").map((e) => normalise(e.rel));
    const names = new Set<string>();
    const groups = new Map<string, string[]>();
    for (const rel of files) {
      const n = this.docName(rel);
      if (!n) continue;
      names.add(n);
      if (!wanted.has(n)) continue;
      const g = groups.get(n) ?? [];
      if (!g.some((r) => r.toLowerCase() === rel.toLowerCase())) g.push(rel);
      groups.set(n, g);
    }
    const when = (rel: string): number => {
      const c = this.fs.createdOf(rel);
      const t = c ? Date.parse(c) : NaN;
      return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
    };
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => when(a) - when(b) || (a < b ? -1 : a > b ? 1 : 0));
      for (const loser of g.slice(1)) {
        const c = classify(loser, this.types)!;
        const suffix = loser.slice(c.name.length);
        const bytes = await this.fs.read(loser);
        if (!bytes) continue;
        const name = unique(c.name, (n) => names.has(n.toLowerCase()));
        const to = name + suffix;
        const created = this.fs.createdOf(loser);
        if (created) this.fs.adoptCreated(to, created);
        if (!(await this.fs.writeIf(to, bytes, null))) continue;
        names.add(name.toLowerCase());
        if (await this.fs.removeIf(loser, sha1Of(bytes))) this.mark(this.keyOf(loser), loser);
        this.mark(this.keyOf(to), to);
      }
    }
  }

  /**
   * Theirs, written beside ours under a conflict name. The copy is the document the other device
   * committed, so it takes that document's created — never its own birth, which is this device's
   * clock and this second, and which the other devices would read as a different document's.
   */
  private async writeCopy(rel: string, theirs: Uint8Array, ours: Uint8Array, created: string | null): Promise<string> {
    const at = this.now();
    const tried = new Set<string>();
    // A name is taken in any case: by a name tried, by a live entry, and by a path waiting to be
    // pushed — an earlier copy of this minute not yet committed is only in `dirty`, and a second
    // copy spelled another way would be one key under two spellings.
    const taken = (r: string): boolean =>
      tried.has(r.toLowerCase()) || this.dirty.has(this.keyOf(r)) || (this.state.entryAt(r)?.blob ?? null) !== null;
    for (let i = 0; i < 100; i++) {
      const name = conflictName(rel, this.device.name, at, taken);
      tried.add(name.toLowerCase());
      if (await this.fs.writeIf(name, freshCopy(name, theirs, ours), null)) {
        if (created) this.fs.adoptCreated(name, created);
        this.mark(this.keyOf(name), name);
        this.state.addConflict(name, at.toISOString());
        this.counts.copied++;
        return name;
      }
    }
    throw new Error(`sync: no free name beside ${rel} for a conflict copy`);
  }
}
