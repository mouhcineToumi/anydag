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

interface Kept {
  /** The file's stat when it was last read. */
  stat: string;
  /** The kept listing's stamp for it then, when the entry carried one. */
  listed: string | null;
  sha: string;
  doc: Doc | null;
  /** The text's length, so the answer can be sent in parts of about the same size. */
  bytes: number;
}

const sha1 = (text: string): string => createHash("sha1").update(text).digest("hex");

/**
 * One cache of one question over one vault folder, on whichever thread parses. A text is read when
 * its stat moved — modified time, change time, size and inode, so a save that kept the size is
 * still seen — and parsed when its sha1 did. An entry that carries the kept listing's stamp, the
 * same as when the text was last read, is not looked at at all (#280).
 */
export class Reader {
  private kept = new Map<string, Kept>();
  private turn = 0;
  private realRoot: string | null = null;

  constructor(
    readonly root: string,
    private readonly parse: Parse,
  ) {}

  static of(root: string, question: Question): Reader {
    return new Reader(root, PARSE[question]);
  }

  /**
   * Every entry's doc that changed since the answer `since` named — all of them when that is not
   * this reader's last answer (a worker restarted, or an answer lost on the way) — and what is gone.
   */
  read(entries: readonly Entry[], since: number | null): Read {
    const now = new Map<string, Kept>();
    const stale: Record<string, string> = {};
    const stats = new Map<string, [string, string, number]>();
    const missing: string[] = [];
    const listedAt = new Map<string, string | null>();
    for (const [key, name, kind, listed] of entries) {
      const had = this.kept.get(key);
      if (listed !== undefined && had?.listed === listed) {
        now.set(key, had);
        continue;
      }
      const got = this.load(name, kind, had);
      if (got === null) missing.push(key);
      else if ("kept" in got)
        now.set(key, got.kept.listed === (listed ?? null) ? got.kept : { ...got.kept, listed: listed ?? null });
      else if (had?.sha === got.sha) now.set(key, { ...had, stat: got.stat, listed: listed ?? null, bytes: got.text.length });
      else {
        stale[key] = got.text;
        stats.set(key, [got.stat, got.sha, got.text.length]);
        listedAt.set(key, listed ?? null);
      }
    }
    const keys = Object.keys(stale);
    const docs = keys.length ? this.parse(stale) : {};
    const fresh: [string, Doc | null][] = [];
    for (const key of keys) {
      const [stat, sha, bytes] = stats.get(key)!;
      const doc = docs[key] ?? null;
      now.set(key, { stat, listed: listedAt.get(key) ?? null, sha, doc, bytes });
      fresh.push([key, doc]);
    }
    const whole = since !== this.turn;
    this.kept = now;
    this.turn++;
    return {
      turn: this.turn,
      fresh: whole ? [...now].map(([k, v]) => [k, v.doc]) : fresh,
      missing,
      parsed: keys.length > 0,
      whole,
    };
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
  private load(
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

/** What the server's thread sends the worker: the entries of a question in parts, the next part of an answer, a cache dropped. */
export type ReadAsk =
  | { read: number; parsed: number; root: string; question: Question; since: number | null; entries: Entry[]; last: boolean }
  | { next: number }
  | { forget: number };
