/**
 * What one linked vault's sync client remembers between runs:
 * `~/.anydag/sync/<vault>/state.sqlite`, `node:sqlite` as `home.ts` opens one.
 *
 * - `kv`: the server's URL, the remote vault, this device's id, name and token, the cursor, the last
 *   sync.
 * - `paths`: per key, the head this device last agreed with — its `seq`, its blob (`null` when the
 *   head is a delete), the sha1 of its plaintext (which `bases.ts` holds) — and the path as spelled.
 * - `conflicts`: the conflict copies this device wrote.
 *
 * Load-bearing: **a `paths` row is the base**. A disk whose sha1 is the row's is clean, anything
 * else was changed here; that comparison is how a push finds work and how a pull tells "apply
 * theirs" from "merge". It is an index of decisions, never of content: deleting the file costs a
 * resync, never a byte of the vault.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

export interface PathEntry {
  key: string;
  rel: string;
  kind: "file" | "dir";
  seq: number;
  /** `null`: the head is a delete. */
  blob: string | null;
  /** sha1 hex of the plaintext base; `null` for a delete. */
  sha1: string | null;
  size: number;
  /** The disk's mtime when the base was last seen there, `0` when unknown. */
  mtime: number;
}

export interface ConflictEntry {
  rel: string;
  at: string;
}

/** The `kv` names this file knows. Anything else is a caller's own. */
export type StateKey = "server" | "remote" | "device" | "deviceName" | "token" | "cursor" | "last";

const SCHEMA = `
create table if not exists kv (name text primary key, value text not null);
create table if not exists paths (
  key text primary key,
  rel text not null,
  kind text not null,
  seq integer not null,
  blob text,
  sha1 text,
  size integer not null default 0,
  mtime integer not null default 0
);
create index if not exists paths_rel on paths (rel collate nocase);
create table if not exists conflicts (rel text primary key, at text not null);
`;

interface Row {
  key: string;
  rel: string;
  kind: string;
  seq: number;
  blob: string | null;
  sha1: string | null;
  size: number;
  mtime: number;
}

const entryOf = (r: Row): PathEntry => ({
  key: r.key,
  rel: r.rel,
  kind: r.kind === "dir" ? "dir" : "file",
  seq: Number(r.seq),
  blob: r.blob,
  sha1: r.sha1,
  size: Number(r.size),
  mtime: Number(r.mtime),
});

export class SyncState {
  readonly dir: string;
  private readonly db: DatabaseSync;
  private readonly cache = new Map<string, StatementSync>();

  constructor(dir: string) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "state.sqlite"));
    this.db.exec("pragma journal_mode = wal; pragma busy_timeout = 5000; pragma synchronous = normal;");
    this.db.exec(SCHEMA);
  }

  private sql(text: string): StatementSync {
    let s = this.cache.get(text);
    if (!s) {
      s = this.db.prepare(text);
      this.cache.set(text, s);
    }
    return s;
  }

  close(): void {
    this.db.close();
  }

  /** `fn` in one transaction. */
  tx<T>(fn: () => T): T {
    this.db.exec("begin immediate");
    try {
      const out = fn();
      this.db.exec("commit");
      return out;
    } catch (e) {
      this.db.exec("rollback");
      throw e;
    }
  }

  // -- kv

  get(name: StateKey | string): string | null {
    const r = this.sql("select value from kv where name = ?").get(name) as { value: string } | undefined;
    return r ? r.value : null;
  }

  set(name: StateKey | string, value: string | null): void {
    if (value === null) this.sql("delete from kv where name = ?").run(name);
    else this.sql("insert into kv (name, value) values (?, ?) on conflict (name) do update set value = excluded.value").run(name, value);
  }

  cursor(): number {
    const v = Number(this.get("cursor") ?? 0);
    return Number.isFinite(v) ? v : 0;
  }

  setCursor(seq: number): void {
    this.set("cursor", String(seq));
  }

  // -- paths

  entry(key: string): PathEntry | undefined {
    const r = this.sql("select * from paths where key = ?").get(key) as Row | undefined;
    return r ? entryOf(r) : undefined;
  }

  /** The entry spelled `rel`, case-insensitively; a live one before a delete. */
  entryAt(rel: string): PathEntry | undefined {
    const r = this.sql("select * from paths where rel = ? collate nocase order by (blob is null) limit 1").get(rel) as Row | undefined;
    return r ? entryOf(r) : undefined;
  }

  put(e: PathEntry): void {
    this.sql(
      `insert into paths (key, rel, kind, seq, blob, sha1, size, mtime) values (?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (key) do update set rel = excluded.rel, kind = excluded.kind, seq = excluded.seq, blob = excluded.blob,
         sha1 = excluded.sha1, size = excluded.size, mtime = excluded.mtime`,
    ).run(e.key, e.rel, e.kind, e.seq, e.blob, e.sha1, Math.floor(e.size), Math.floor(e.mtime));
  }

  drop(key: string): void {
    this.sql("delete from paths where key = ?").run(key);
  }

  dropAt(rel: string): void {
    this.sql("delete from paths where rel = ? collate nocase").run(rel);
  }

  entries(): PathEntry[] {
    return (this.sql("select * from paths order by rel").all() as unknown as Row[]).map(entryOf);
  }

  // -- conflicts

  conflicts(): ConflictEntry[] {
    return this.sql("select rel, at from conflicts order by at, rel").all() as unknown as ConflictEntry[];
  }

  addConflict(rel: string, at: string): void {
    this.sql("insert into conflicts (rel, at) values (?, ?) on conflict (rel) do update set at = excluded.at").run(rel, at);
  }

  dropConflict(rel: string): void {
    this.sql("delete from conflicts where rel = ?").run(rel);
  }
}
