/**
 * `~/.anydag/` — everything the app keeps that is not the person's documents (decision 6).
 *
 * `anydag.sqlite` holds the id index, the recent vaults, practice records and the rebuildable
 * caches; `settings.json` the person's own preferences. **Nothing here is needed for a vault to be
 * correct**: the ids are in the files and every row of `docs` can be rebuilt by walking a vault, so
 * deleting this folder costs a rescan and a practice history, never a document or a link.
 *
 * `node:sqlite`, so there is no native module to rebuild for Electron. WAL and a busy timeout,
 * because the CLI running the server in-process and the app may both have it open.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

/** Where the home is: `ANYDAG_HOME`, else the platform's place for an app's data. */
export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ANYDAG_HOME) return path.resolve(env.ANYDAG_HOME);
  if (process.platform === "win32" && env.APPDATA) return path.join(env.APPDATA, "AnyDag");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "AnyDag");
  return path.join(env.XDG_DATA_HOME ? path.join(env.XDG_DATA_HOME, "anydag") : path.join(os.homedir(), ".anydag"));
}

/** One document's row: where it is, what it is, when it was made, and whether its id is in its file. */
export interface DocRow {
  vault: string;
  id: string;
  /** The stored file, vault-relative, `/`-separated, suffix and all: `work/plan.board.md`. */
  path: string;
  kind: string;
  created: string;
  /** `1` when the id is written into the file (a text's frontmatter, an attachment's `.anydag/files/`). */
  minted: number;
  /** An attachment's title; a text's is its frontmatter's and is not kept here. */
  title: string | null;
}

const SCHEMA = `
create table if not exists docs (
  vault text not null,
  id text not null,
  path text not null,
  kind text not null,
  created text not null,
  minted integer not null default 0,
  title text,
  primary key (vault, id)
);
create unique index if not exists docs_path on docs (vault, path collate nocase);
create table if not exists vaults (
  id text primary key,
  path text not null,
  name text not null,
  opened text not null
);
create table if not exists practice (
  vault text not null,
  quiz text not null,
  question text not null,
  record text not null,
  primary key (vault, quiz, question)
);
create table if not exists kv (key text primary key, value text not null);
`;

export class Home {
  readonly dir: string;
  readonly db: DatabaseSync;
  private readonly cache = new Map<string, StatementSync>();

  constructor(dir: string = homeDir()) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "anydag.sqlite"));
    this.db.exec("pragma journal_mode = wal; pragma busy_timeout = 5000; pragma synchronous = normal;");
    this.db.exec(SCHEMA);
  }

  /** A prepared statement, prepared once. */
  sql(text: string): StatementSync {
    let s = this.cache.get(text);
    if (!s) {
      s = this.db.prepare(text);
      this.cache.set(text, s);
    }
    return s;
  }

  /** `fn` in one transaction: a scan's hundred row changes are one write to disk, not a hundred. */
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

  docs(vault: string): DocRow[] {
    return this.sql("select * from docs where vault = ?").all(vault) as unknown as DocRow[];
  }

  /** `docs`, a page at a time: up to `limit` rows whose id is after `after`, in id order. */
  docsAfter(vault: string, after: string, limit: number): DocRow[] {
    return this.sql("select * from docs where vault = ? and id > ? order by id limit ?").all(
      vault,
      after,
      limit,
    ) as unknown as DocRow[];
  }

  docById(vault: string, id: string): DocRow | undefined {
    return this.sql("select * from docs where vault = ? and id = ?").get(vault, id) as unknown as DocRow | undefined;
  }

  docByPath(vault: string, file: string): DocRow | undefined {
    return this.sql("select * from docs where vault = ? and path = ? collate nocase").get(vault, file) as unknown as
      | DocRow
      | undefined;
  }

  putDoc(row: DocRow): void {
    // A row already on this path under another id is the same file under a new name for itself.
    this.sql("delete from docs where vault = ? and path = ? collate nocase and id <> ?").run(row.vault, row.path, row.id);
    this.sql(
      `insert into docs (vault, id, path, kind, created, minted, title) values (?, ?, ?, ?, ?, ?, ?)
       on conflict (vault, id) do update set path = excluded.path, kind = excluded.kind,
         created = excluded.created, minted = excluded.minted, title = excluded.title`,
    ).run(row.vault, row.id, row.path, row.kind, row.created, row.minted, row.title);
  }

  dropDoc(vault: string, id: string): void {
    this.sql("delete from docs where vault = ? and id = ?").run(vault, id);
  }

  dropVaultDocs(vault: string): void {
    this.sql("delete from docs where vault = ?").run(vault);
  }

  get(key: string): string | undefined {
    return (this.sql("select value from kv where key = ?").get(key) as { value: string } | undefined)?.value;
  }

  set(key: string, value: string | null): void {
    if (value === null) this.sql("delete from kv where key = ?").run(key);
    else
      this.sql("insert into kv (key, value) values (?, ?) on conflict (key) do update set value = excluded.value").run(
        key,
        value,
      );
  }

  /**
   * A vault takes another id (it linked to a remote vault, and adopts that one): every row and every
   * key that names the old id names the new one, in one transaction. A row already under the new id
   * is somebody's stale leftover and goes.
   */
  rekeyVault(oldId: string, newId: string): void {
    if (oldId === newId) return;
    this.tx(() => {
      this.sql("delete from docs where vault = ?").run(newId);
      this.sql("delete from practice where vault = ?").run(newId);
      this.sql("delete from vaults where id = ?").run(newId);
      this.sql("update docs set vault = ? where vault = ?").run(newId, oldId);
      this.sql("update practice set vault = ? where vault = ?").run(newId, oldId);
      this.sql("update vaults set id = ? where id = ?").run(newId, oldId);
      // `digest:<vault>:<doc>` is the only kv key that embeds a vault id (`Vault.digestKey`).
      const keys = this.sql("select key from kv where key like ?").all(`digest:${oldId}:%`) as { key: string }[];
      for (const { key } of keys) {
        this.sql("update or replace kv set key = ? where key = ?").run(
          `digest:${newId}:${key.slice(`digest:${oldId}:`.length)}`,
          key,
        );
      }
    });
  }

  close(): void {
    this.db.close();
  }
}
