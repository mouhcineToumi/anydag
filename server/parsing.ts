/**
 * What the grammar made of each text of a vault, **read and kept where it is parsed** (#287): on the
 * grammar's worker (`server/grammar-worker.ts`) when there is one, inline when there is none — the
 * same code. The server's thread sends the names it wants answered for and gets back what changed;
 * no text crosses between the two.
 *
 * On 50,000 files, reading every text on the server's thread for `/__board/index` and posting the
 * whole map to the worker held every other request for 1.7 s cold and 1.9 s warm. Here a `Reader`
 * stats each file and reads only those whose stat moved since it last read them, so a warm question
 * reads nothing; a text read again whose sha1 is the one already parsed is not parsed again.
 *
 * Plain Node and pure `src/` imports only: it is bundled into the worker.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { indexTexts } from "../src/refs/extract";
import { corpusTexts } from "../src/search/corpus";
import { COMPONENT_PREFIX, refusal, type TextKind, textFile } from "./names";
import { Shelf, type Stamp } from "./parse-store";

/** Which of the grammar's whole-vault questions a cache answers: `/index`'s, or `/corpus`'s. */
export type Question = "index" | "corpus";

/** What the grammar made of one text. */
export type Doc = Record<string, unknown>;

/**
 * One text to answer for: its key (`textKey`), its name and its kind — and, while a kept listing
 * knows it (#280), the stamp it last read the text at, which says the text has not moved without
 * a look at the disk.
 */
export type Entry = [key: string, name: string, kind: TextKind, listed?: string];

/** The texts parsed, by key, into what the question asks of each. */
export type Parse = (texts: Record<string, string>) => Record<string, Doc>;

const PARSE: Record<Question, Parse> = {
  index: (texts) => indexTexts(texts) as unknown as Record<string, Doc>,
  corpus: (texts) => corpusTexts(texts) as unknown as Record<string, Doc>,
};

/**
 * What a `Reader` answers: the docs of every text parsed again (or, when the asker does not hold the
 * reader's last answer, of every text), the keys of the texts that could not be read, and whether
 * anything was parsed. `turn` names this answer, for the asker to send back as `since` next time.
 */
export interface Read {
  turn: number;
  fresh: [string, Doc | null][];
  missing: string[];
  parsed: boolean;
  /** `fresh` is every doc, not only those parsed again: the asker held another answer than the last. */
  whole: boolean;
}

interface Kept extends Stamp {
  /** What was parsed of it — here only when there is no shelf to keep it on. */
  doc?: Doc | null;
}

const sha1 = (text: string): string => createHash("sha1").update(text).digest("hex");

/** How many texts, or how much of them, are parsed between two looks at the clock and the shelf. */
const CHUNK_TEXTS = 500;
const CHUNK_BYTES = 2 * 1024 * 1024;

let parsedHere = 0;

/** How many texts this process has parsed since it started, every question's: what its heap has grown by. */
export const parsedSinceStart = (): number => parsedHere;

/** A name for an answer: random, so one kept on disk is never taken for another process's of the same number. */
const newTurn = (): number => Math.floor(Math.random() * 2 ** 48);

/**
 * One cache of one question over one vault folder, on whichever thread parses. A text is read when
 * its stat moved — modified time, change time, size and inode, so a save that kept the size is
 * still seen — and parsed when its sha1 did. An entry that carries the kept listing's stamp, the
 * same as when the text was last read, is not looked at at all (#280).
 *
 * **What it made of each text is kept on a `Shelf`** (`server/parse-store.ts`, `<home>/parse.sqlite`)
 * when it has one (#279): in memory only the stamps, a few dozen bytes a text, and on disk the docs,
 * read back when an answer needs one. A reader started again — the worker ends when it has been idle —
 * takes its stamps and its last answer's name from there, so a warm question after the worker ended
 * parses nothing that did not move, and answers "nothing changed" to the server that holds that answer.
 */
export class Reader {
  private kept = new Map<string, Kept>();
  private turn = newTurn();
  private loaded = false;
  private realRoot: string | null = null;
  /** How many texts the last `read` parsed. */
  lastParsed = 0;

  constructor(
    readonly root: string,
    private readonly parse: Parse,
    readonly question: Question | null = null,
    private shelf: Shelf | null = null,
  ) {}

  static of(root: string, question: Question, home?: string | null): Reader {
    return new Reader(root, PARSE[question], question, Shelf.at(home));
  }

  /** The name of the answer this reader last gave. */
  get current(): number {
    this.load();
    return this.turn;
  }

  /** The stamps, and the name of the answer they are, kept on the shelf — once. */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.shelf || !this.question) return;
    try {
      const { turn, stamps } = this.shelf.load(this.root, this.question);
      this.kept = stamps;
      if (turn !== null) this.turn = turn;
    } catch (e) {
      this.unshelve(e);
    }
  }

  /** The shelf failed: keep everything in memory from here, starting from nothing. */
  private unshelve(e: unknown): void {
    console.warn(`anydag: keeping what was parsed of ${this.root} in memory only: ${(e as Error)?.message ?? e}`);
    this.shelf = null;
    this.kept = new Map();
    this.turn = newTurn();
  }

  /**
   * Every entry's doc that changed since the answer `since` named — all of them when that is not
   * this reader's last answer (a server started again, or an answer lost on the way) — and what is gone.
   */
  read(entries: readonly Entry[], since: number | null): Read {
    const steps = this.steps(entries, since);
    for (;;) {
      const r = steps.next();
      if (r.done) return r.value;
    }
  }

  /**
   * `read`, a chunk of texts at a time: it yields after parsing each `CHUNK_TEXTS` texts (or
   * `CHUNK_BYTES` of them), with what they made already on the shelf. The worker hands its thread back
   * between chunks and says it is still alive, so a cold vault of 50,000 notes — minutes of parsing —
   * is not taken for a grammar stuck on one file (the deadline is per chunk), and a worker ended half
   * way leaves what it parsed for the next. With `answer` false the docs are not gathered: a corpus or
   * a search reads them from the shelf as it needs them.
   */
  *steps(entries: readonly Entry[], since: number | null, answer = true): Generator<void, Read> {
    this.load();
    const now = new Map<string, Kept>();
    const missing: string[] = [];
    const fresh: [string, Doc | null][] = [];
    /* What moved, for the shelf: texts parsed again, and texts whose stamps alone did. */
    let put: [string, Stamp, Doc | null][] = [];
    const touch: [string, Stamp][] = [];
    let parsed = 0;
    let saved = false;
    let batch: Record<string, string> = {};
    let batchStamps = new Map<string, Kept>();
    let batchBytes = 0;
    const flush = (): void => {
      const keys = Object.keys(batch);
      if (!keys.length) return;
      const docs = this.parse(batch);
      for (const key of keys) {
        const k = batchStamps.get(key)!;
        const doc = docs[key] ?? null;
        if (!this.shelf) k.doc = doc;
        now.set(key, k);
        put.push([key, k, doc]);
        if (answer) fresh.push([key, doc]);
      }
      parsed += keys.length;
      parsedHere += keys.length;
      batch = {};
      batchStamps = new Map();
      batchBytes = 0;
    };
    const restamp = (key: string, k: Kept) => {
      now.set(key, k);
      touch.push([key, k]);
    };
    for (const [key, name, kind, listed] of entries) {
      const had = this.kept.get(key);
      if (listed !== undefined && had?.listed === listed) {
        now.set(key, had);
        continue;
      }
      const got = this.load1(name, kind, had);
      if (got === null) missing.push(key);
      else if ("kept" in got) {
        if (got.kept.listed === (listed ?? null)) now.set(key, got.kept);
        else restamp(key, { ...got.kept, listed: listed ?? null });
      } else if (had?.sha === got.sha) restamp(key, { ...had, stat: got.stat, listed: listed ?? null, bytes: got.text.length });
      else {
        batch[key] = got.text;
        batchStamps.set(key, { stat: got.stat, listed: listed ?? null, sha: got.sha, bytes: got.text.length });
        batchBytes += got.text.length;
        if (batchStamps.size >= CHUNK_TEXTS || batchBytes >= CHUNK_BYTES) {
          flush();
          // Kept as it goes, under no answer's name until the last part is down.
          if (this.shelf && this.question && !this.save(put, [], [], null)) return this.read(entries, null);
          saved = this.shelf !== null;
          put = [];
          yield;
        }
      }
    }
    flush();
    const drop: string[] = [];
    for (const key of this.kept.keys()) if (!now.has(key)) drop.push(key);
    const whole = since !== this.turn;
    // Nothing moved, not even a stamp: the same answer, under the same name.
    if (saved || put.length || touch.length || drop.length) {
      const turn = newTurn();
      if (this.shelf && this.question && !this.save(put, touch, drop, turn)) return this.read(entries, null);
      this.turn = turn;
    }
    this.kept = now;
    this.lastParsed = parsed;
    let out = fresh;
    if (answer && whole) {
      const parsedNow = new Map(fresh);
      const byKey = new Map(entries.map((e) => [e[0], e]));
      out = [...now.keys()].map((k) => [k, parsedNow.has(k) ? parsedNow.get(k)! : this.docOf(byKey.get(k)!)]);
    }
    return { turn: this.turn, fresh: out, missing, parsed: parsed > 0, whole };
  }

  /** Rows to the shelf; `false`, and this reader in memory only from here, when that failed. */
  private save(
    put: readonly [string, Stamp, Doc | null][],
    touch: readonly [string, Stamp][],
    drop: readonly string[],
    turn: number | null,
  ): boolean {
    try {
      this.shelf!.save(this.root, this.question!, put, touch, drop, turn);
      return true;
    } catch (e) {
      this.unshelve(e);
      return false;
    }
  }

  /** The sha1 of the text as last read, for an entry this reader holds. */
  shaOf(key: string): string | undefined {
    return this.kept.get(key)?.sha;
  }

  /**
   * What was parsed of an entry this reader holds: from memory, or from its row on the shelf. A row
   * that is not there — the file deleted under a running worker, another build sharing the home — is
   * read and parsed again, and kept: the shelf is only a cache.
   */
  docOf(entry: Entry): Doc | null {
    const [key, name, kind] = entry;
    const k = this.kept.get(key);
    if (k && "doc" in k) return k.doc ?? null;
    if (k && this.shelf && this.question) {
      try {
        const doc = this.shelf.doc(this.root, this.question, key);
        if (doc !== undefined) return doc;
      } catch (e) {
        console.warn(`anydag: a row of ${this.root} could not be read: ${(e as Error)?.message ?? e}`);
      }
    }
    const got = this.load1(name, kind, undefined);
    if (got === null || "kept" in got) return null;
    const doc = this.parse({ [key]: got.text })[key] ?? null;
    const again: Kept = { stat: got.stat, listed: null, sha: got.sha, bytes: got.text.length };
    if (this.shelf && this.question) {
      try {
        this.shelf.save(this.root, this.question, [[key, again, doc]], [], [], (this.turn = newTurn()));
      } catch {
        /* a cache that cannot be written is a cache that is not kept */
      }
    } else again.doc = doc;
    this.kept.set(key, again);
    return doc;
  }

  /** The text's length as last read, `0` for one not kept — what sizes the parts an answer goes in. */
  bytes(key: string): number {
    return this.kept.get(key)?.bytes ?? 0;
  }

  /**
   * One text: what was kept of it when its stat has not moved, else its text, read — or `null` when
   * it cannot be: a refused name, a file gone, a link, or a path that leads out of the vault (a
   * folder swapped for a link). `Vault.abs` refuses the same, and the listing never follows one.
   */
  private load1(
    name: string,
    kind: TextKind,
    had: Kept | undefined,
  ): { kept: Kept } | { stat: string; sha: string; text: string } | null {
    const comp = kind === "board" && name.startsWith(COMPONENT_PREFIX) ? name.slice(COMPONENT_PREFIX.length) : null;
    if (refusal(comp ?? name)) return null;
    const abs = (rel: string) => path.join(this.root, ...rel.split("/"));
    const file = abs(textFile(name, kind, (rel) => !!fs.lstatSync(abs(rel), { throwIfNoEntry: false })));
    try {
      const st = fs.lstatSync(file, { throwIfNoEntry: false });
      if (!st?.isFile() || !this.inside(file)) return null;
      const stat = `${st.mtimeMs}:${st.ctimeMs}:${st.size}:${st.ino}`;
      if (had?.stat === stat) return { kept: had };
      const text = fs.readFileSync(file, "utf8");
      return { stat, sha: sha1(text), text };
    } catch {
      return null; // gone between the stat and the read: the disk's other writer
    }
  }

  private inside(abs: string): boolean {
    const real = (this.realRoot ??= fs.realpathSync(this.root));
    return fs.realpathSync(abs).startsWith(real + path.sep);
  }
}

/* -- the parts an answer goes in ------------------------------------------------------------ */

/**
 * An answer crosses between the threads in parts, each asked for after the last was read (the
 * listing's way, `server/listing.ts`): a thread reads every message waiting for it in one go, and a
 * cold corpus of 50,000 notes is its text again, cut into units.
 */
export type ReadPart =
  | { id: number; fresh: [string, Doc | null][] }
  | { id: number; done: Omit<Read, "fresh"> }
  /** A part of the corpus, as the JSON of its docs joined by commas (`server/searching.ts`), and its end. */
  | { id: number; json: string }
  | { id: number; end: true }
  /** A search's answer. */
  | { id: number; answer: { status: number; body: unknown } }
  /** A chunk of a long read parsed: the worker is not stuck, whatever the clock says. */
  | { id: number; alive: true }
  | { id: number; error: string };

/** About how much text the docs of one part came from, and at most how many docs it holds. */
const PART_BYTES = 512 * 1024;
const PART_DOCS = 1000;

/** `read` as the messages that carry it. */
export function* readParts(id: number, read: Read, bytes: (key: string) => number): Generator<ReadPart> {
  let part: [string, Doc | null][] = [];
  let size = 0;
  for (const f of read.fresh) {
    part.push(f);
    size += bytes(f[0]);
    if (part.length >= PART_DOCS || size >= PART_BYTES) {
      yield { id, fresh: part };
      part = [];
      size = 0;
    }
  }
  if (part.length) yield { id, fresh: part };
  yield { id, done: { turn: read.turn, missing: read.missing, parsed: read.parsed, whole: read.whole } };
}

/** How many entries go to the worker in one message. */
export const ENTRIES_PART = 2000;

/** Beside each entry of a corpus or a search: the text's id, and the title its listing gives it. */
export type Meta = [id: string, title: string | null];

/** An attachment, which a corpus and a search hold by its names: its id, its name and its title. */
export type FileMeta = [id: string, name: string, title: string | null];

/**
 * What a read is for when it is not the docs: the corpus, as the JSON `/__board/corpus` streams, or
 * a query's answer — both made where the docs are (`server/searching.ts`), so neither the units nor
 * the engine cross to the server's thread (#279).
 */
export type Want =
  | { corpus: true }
  /** `retire`: a worker that has parsed many texts may ask to be replaced before it builds the engine (`{ again }`). */
  | { search: string; limit?: number; retire?: boolean; only?: string[] };

/** What the server's thread sends the worker: the entries of a question in parts, the next part of an answer, a cache dropped. */
export type ReadAsk =
  | {
      read: number;
      parsed: number;
      /** The app's home, whose `parse.sqlite` keeps what was parsed; `null` for memory only. */
      home: string | null;
      root: string;
      question: Question;
      since: number | null;
      entries: Entry[];
      /** With a `want`: each entry's `Meta`, in the same parts. */
      meta?: Meta[];
      last: boolean;
      /** With a `want`, on the last part. */
      files?: FileMeta[];
      want?: Want;
    }
  | { next: number }
  | { forget: number };
