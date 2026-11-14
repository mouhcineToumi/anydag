/**
 * What the grammar made of each text of a vault, **kept on disk in the app's home** (#279):
 * `<home>/parse.sqlite`, a row per text per question (`/index`'s, `/corpus`'s) holding the stat and
 * the kept listing's stamp it was read at, the sha1 of what it said, and what was parsed of it.
 *
 * It is what lets the grammar's worker be a process that ends when it has been idle — the only way
 * its memory comes back (see *Things that will bite*) — without the next question reading and
 * parsing the whole vault again: a `Reader` started again (`server/parsing.ts`) takes its stamps
 * from here and parses only what moved. And it is what lets the worker keep a search's units out of
 * its memory: a hit's words are read from the one row they are in.
 *
 * **A cache, and only that.** Nothing in it is needed to be right: a row cut by another build is not
 * trusted (`code`), a row that is missing is parsed again, and with the file deleted the next
 * question parses the vault again. It is never in the vault, so opening a vault still writes nothing
 * to it.
 *
 * Plain Node only: it is bundled into the worker.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

/** What one text was when it was last read: its stat, the kept listing's stamp for it then, its sha1 and its length. */
export interface Stamp {
  stat: string;
  listed: string | null;
  sha: string;
  bytes: number;
}

/** What the grammar made of one text. */
type Doc = Record<string, unknown>;

/**
 * The code that parses: the file this is bundled into — the worker in a build — hashed. A row cut by
 * other code is not trusted, so a new build parses again rather than answering with an old one's units.
 */
let code: string | undefined;
function codeHash(): string {
  if (code === undefined) {
    try {
      code = createHash("sha1")
        .update(fs.readFileSync(fileURLToPath(import.meta.url)))
        .digest("hex")
        .slice(0, 16);
    } catch {
      code = "unknown";
    }
  }
  return code;
}

/** Rows written in one transaction: a cold vault is many, and the log is checkpointed between them, so it stays small. */
const BATCH = 500;

const pack = (doc: Doc | null): Uint8Array | null => (doc === null ? null : zlib.deflateRawSync(JSON.stringify(doc)));
const unpack = (bytes: Uint8Array | null): Doc | null =>
  bytes === null ? null : (JSON.parse(zlib.inflateRawSync(bytes).toString("utf8")) as Doc);

/** One per home, for as long as the process runs. */
const shelves = new Map<string, Shelf | null>();

/** How many homes' databases stay open at once; the one used longest ago is closed, and opened again when asked. */
const OPEN = 4;
const open: Shelf[] = [];

/** The shape of the file this code writes; a file of any other is emptied and made again — it is a cache. */
const SCHEMA = 1;

export class Shelf {
  private handle: DatabaseSync | null = null;
  private readonly statements = new Map<string, StatementSync>();

  private constructor(private readonly dir: string) {
    void this.db; // opened now, so a home that cannot hold it is known at once
  }

  private get db(): DatabaseSync {
    const at = open.indexOf(this);
    if (at >= 0) open.splice(at, 1);
    open.push(this);
    if (open.length > OPEN) open.shift()!.close();
    if (this.handle) return this.handle;
    const db = new DatabaseSync(path.join(this.dir, "parse.sqlite"));
    db.exec(
      "pragma journal_mode = wal; pragma busy_timeout = 5000; pragma synchronous = normal; pragma journal_size_limit = 8388608;",
    );
    db.exec("begin immediate");
    try {
      if (Number((db.prepare("pragma user_version").get() as { user_version: number }).user_version) !== SCHEMA) {
        db.exec("drop table if exists texts; drop table if exists sets;");
        /* One set of rows per question over one folder, cut by one build (`code`), and the answer the
           rows are (`turn`): the server's thread holds the docs of one answer and asks for what changed
           since it (`Reader.read`'s `since`). `null` while a read is being written, so an answer cut
           short is never taken for one the server holds. */
        db.exec(`create table sets (
          id integer primary key,
          root text not null,
          question text not null,
          code text not null,
          turn integer,
          unique (root, question)
        )`);
        /* A row per text: its stat and listed stamp when read, its sha1, and the doc, deflated. A
           rowid table, the rows being a kilobyte or so: appended in order, its pages stay full. */
        db.exec(`create table texts (
          set_id integer not null,
          key text not null,
          stat text not null,
          listed text,
          sha1 text not null,
          bytes integer not null,
          doc blob
        )`);
        db.exec("create unique index texts_key on texts (set_id, key)");
        db.exec(`pragma user_version = ${SCHEMA}`);
      }
      db.exec("commit");
    } catch (e) {
      db.exec("rollback");
      db.close();
      throw e;
    }
    return (this.handle = db);
  }

  private close(): void {
    this.statements.clear();
    try {
      this.handle?.close();
    } catch {
      /* closed already */
    }
    this.handle = null;
  }

  /** The home's shelf, or `null` when its database cannot be opened — then the cache is memory only. */
  static at(home: string | null | undefined): Shelf | null {
    if (!home) return null;
    if (shelves.has(home)) return shelves.get(home)!;
    let shelf: Shelf | null = null;
    try {
      fs.mkdirSync(home, { recursive: true });
      shelf = new Shelf(home);
    } catch (e) {
      console.warn(`anydag: keeping what was parsed in memory only: ${(e as Error)?.message ?? e}`);
    }
    shelves.set(home, shelf);
    return shelf;
  }

  private sql(text: string): StatementSync {
    const db = this.db;
    let s = this.statements.get(text);
    if (!s) this.statements.set(text, (s = db.prepare(text)));
    return s;
  }

  private tx(run: () => void): void {
    this.db.exec("begin");
    try {
      run();
      this.db.exec("commit");
    } catch (e) {
      this.db.exec("rollback");
      throw e;
    }
  }

  /**
   * The set of rows for one question over one folder, made if there is none — and emptied, and taken
   * for this build, when another build cut it: its rows are not trusted.
   */
  private setOf(root: string, question: string): { id: number; turn: number | null } {
    const code = codeHash();
    let row = this.sql("select id, code, turn from sets where root = ? and question = ?").get(root, question) as
      | { id: number; code: string; turn: number | null }
      | undefined;
    if (!row) {
      this.sql("insert into sets (root, question, code, turn) values (?, ?, ?, null) on conflict do nothing").run(
        root,
        question,
        code,
      );
      row = this.sql("select id, code, turn from sets where root = ? and question = ?").get(root, question) as {
        id: number;
        code: string;
        turn: number | null;
      };
    }
    if (row.code !== code) {
      this.tx(() => {
        this.sql("delete from texts where set_id = ?").run(row.id);
        this.sql("update sets set code = ?, turn = null where id = ?").run(code, row.id);
      });
      return { id: Number(row.id), turn: null };
    }
    return { id: Number(row.id), turn: row.turn === null ? null : Number(row.turn) };
  }

  /** Every row's stamp for one question over one folder, and the answer they are — rows another build cut are dropped. */
  load(root: string, question: string): { turn: number | null; stamps: Map<string, Stamp> } {
    const set = this.setOf(root, question);
    const stamps = new Map<string, Stamp>();
    const rows = this.sql("select key, stat, listed, sha1, bytes from texts where set_id = ?").all(set.id) as {
      key: string;
      stat: string;
      listed: string | null;
      sha1: string;
      bytes: number;
    }[];
    for (const r of rows) stamps.set(r.key, { stat: r.stat, listed: r.listed, sha: r.sha1, bytes: Number(r.bytes) });
    return { turn: set.turn, stamps };
  }

  /** What was parsed of one text, `null` when nothing was — or `undefined` when there is no row this build cut. */
  doc(root: string, question: string, key: string): Doc | null | undefined {
    const r = this.sql(
      `select t.doc from texts t join sets s on s.id = t.set_id
       where s.root = ? and s.question = ? and s.code = ? and t.key = ?`,
    ).get(root, question, codeHash(), key) as { doc: Uint8Array | null } | undefined;
    return r ? unpack(r.doc) : undefined;
  }

  /**
   * One read's changes: the texts parsed again (`put`), those whose stamps alone moved (`touch`),
   * those gone (`drop`), then the answer they make (`turn`) — or, with `turn` `null`, a part of a
   * read still going, kept under no answer's name. A cold vault is written a few hundred rows at a time.
   */
  save(
    root: string,
    question: string,
    put: readonly [string, Stamp, Doc | null][],
    touch: readonly [string, Stamp][],
    drop: readonly string[],
    turn: number | null,
  ): void {
    const { id } = this.setOf(root, question);
    const upsert = this.sql(`insert into texts (set_id, key, stat, listed, sha1, bytes, doc) values (?, ?, ?, ?, ?, ?, ?)
      on conflict (set_id, key) do update set stat = excluded.stat, listed = excluded.listed, sha1 = excluded.sha1,
        bytes = excluded.bytes, doc = excluded.doc`);
    const restamp = this.sql("update texts set stat = ?, listed = ?, bytes = ? where set_id = ? and key = ?");
    const remove = this.sql("delete from texts where set_id = ? and key = ?");
    const name = this.sql("update sets set turn = ? where id = ?");
    const work: (() => void)[] = [];
    for (const [key, s, doc] of put) work.push(() => upsert.run(id, key, s.stat, s.listed, s.sha, s.bytes, pack(doc)));
    for (const [key, s] of touch) work.push(() => restamp.run(s.stat, s.listed, s.bytes, id, key));
    for (const key of drop) work.push(() => remove.run(id, key));
    if (work.length <= BATCH) {
      this.tx(() => {
        for (const w of work) w();
        name.run(turn, id);
      });
      return;
    }
    this.tx(() => name.run(null, id));
    for (let i = 0; i < work.length; i += BATCH) this.tx(() => work.slice(i, i + BATCH).forEach((w) => w()));
    if (turn !== null) this.tx(() => name.run(turn, id));
  }
}
