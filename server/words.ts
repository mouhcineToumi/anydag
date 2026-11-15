/**
 * A vault's words, **indexed on disk** (#267): an SQLite FTS5 table per vault in `<home>/parse.sqlite`,
 * beside the corpus rows it is made from (`server/parse-store.ts`) and written in the same
 * transactions, so the two cannot disagree. A query is a lookup in it: nothing is built in memory
 * first, and a worker started again — after an idle, or after the app was restarted — answers its
 * first search as fast as its hundredth. It replaces MiniSearch, which held every unit's words in the
 * worker's memory (146 MB at 10,000 files) and was built again after each idle (4 s at 10,000).
 *
 * The rules a search keeps are the ones `src/search/engine.ts` states, and this file is how FTS5 is
 * made to keep them:
 *
 * - **Words are cut and folded here, not by SQLite.** A unit goes into the index as its words, folded
 *   (`wordsOf`) and joined by spaces, under the `ascii` tokenizer, which splits on nothing else those
 *   words hold. So the index, the query and the snippet's marks split and fold one way.
 * - **Every word must match, and every word is a prefix**: `("w" OR "w" OR "w"* …) AND (…)`. The
 *   exact term is named twice and the prefix once, so a whole-word match ranks about three times a
 *   prefix match under `bm25` — the weight MiniSearch gave them (1 against 0.375).
 * - **A word of five letters or more forgives a typo in five**: the terms of the vault within that
 *   many edits of it (`within`) are added to its alternatives. They come from `terms_<set>`, every
 *   word the index was ever given, kept in this process's memory once read. A term no unit holds any
 *   more is harmless there — an alternative that matches nothing — so the table is only added to,
 *   and emptied with the rest when another build takes the set.
 * - **A unit's rowid says where it is**: unit `i` of the text whose row is `r` is `r * SPAN + i`, and
 *   an attachment's names are below zero. The words themselves are not kept (the table is
 *   contentless): a hit's snippet is cut from its document's row, read when the hit is answered.
 *
 * Plain Node only: it is bundled into the grammar's worker.
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";

import type { Unit } from "../src/search/corpus";
import { LIMIT, PER_DOC, type SearchDoc, wordsOf } from "../src/search/engine";

/** Room for a text's units in a rowid: unit `i` of the text whose row is `r` is `r * SPAN + i`. */
export const SPAN = 2 ** 20;

/** How many typos a word of `len` letters forgives: one in five from five letters on, none below, six at most. */
export const typosFor = (len: number): number => (len < 5 ? 0 : Math.min(6, Math.round(len * 0.2)));

/** Whether `a` is within `max` edits of `b` (Levenshtein), given up as soon as it cannot be. */
export function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let least = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
      row.push(v);
      if (v < least) least = v;
    }
    if (least > max) return false;
    prev = row;
  }
  return prev[b.length]! <= max;
}

const quote = (t: string): string => `"${t.replaceAll('"', '""')}"`;

/** A query word and what it may match: itself, as a whole word and as a prefix, and the terms a typo away. */
export interface Asked {
  word: string;
  fuzzy: string[];
}

/** The FTS5 expression for a query's words: every word, each as itself, its prefix or a typo of it. */
function expressionOf(asked: readonly Asked[]): string {
  return asked
    .map(({ word, fuzzy }) => `(${[quote(word), quote(word), `${quote(word)}*`, ...fuzzy.map(quote)].join(" OR ")})`)
    .join(" AND ");
}

/** Which of a unit's words the query matched, folded — what the snippet marks. */
function termsOf(text: string, asked: readonly Asked[]): string[] {
  const out = new Set<string>();
  for (const w of wordsOf(text)) if (asked.some((a) => w.startsWith(a.word) || a.fuzzy.includes(w))) out.add(w);
  return [...out];
}

/** One unit the index matched, best first: where it is, and its score (higher is better). */
export interface Match {
  rowid: number;
  score: number;
}

/** What a matched unit is: its document, and the unit — read only once the document has room for it. */
export interface Located<D> {
  doc: D;
  unit: () => Unit | undefined;
}

/** One hit, as `foundOf` (`server/handle.ts`) makes the answer of it. */
export interface Hit<D> {
  doc: D;
  unit: Unit;
  score: number;
  terms: string[];
}

/**
 * The best `limit` units holding every word of `q`, at most `PER_DOC` from one document: `at` says
 * where a rowid is, and `keep` which documents may be answered — a search filtered to a tag's — before
 * `limit` counts them. A unit `at` cannot find any more is passed over.
 */
export function hitsOf<D extends { id: string }>(
  index: WordIndex,
  q: string,
  limit: number,
  at: (rowid: number) => Located<D> | undefined,
  keep?: (doc: D) => boolean,
): Hit<D>[] {
  const asked = index.ask(q);
  const perDoc = new Map<string, number>();
  const out: Hit<D>[] = [];
  if (!asked.length || limit <= 0) return out;
  for (const m of index.match(asked)) {
    const got = at(m.rowid);
    if (!got || (keep && !keep(got.doc))) continue;
    const n = perDoc.get(got.doc.id) ?? 0;
    if (n >= PER_DOC) continue;
    const unit = got.unit();
    if (!unit) continue;
    perDoc.set(got.doc.id, n + 1);
    out.push({ doc: got.doc, unit, score: m.score, terms: termsOf(unit.text, asked) });
    if (out.length >= limit) break;
  }
  return out;
}

/** The words of every term the index holds, by length, for the typo search. */
type Vocabulary = Map<number, string[]>;

/** The two tables of one set: the units' words, and every term ever given. */
const tablesOf = (set: number): { words: string; terms: string } => ({ words: `words_${set}`, terms: `terms_${set}` });

export function createTables(db: DatabaseSync, set: number): void {
  const { words, terms } = tablesOf(set);
  db.exec(`create virtual table if not exists ${words} using fts5(text, content='', contentless_delete=1, tokenize='ascii')`);
  db.exec(`create table if not exists ${terms} (term text primary key) without rowid`);
}

export function dropTables(db: DatabaseSync, set: number): void {
  const { words, terms } = tablesOf(set);
  db.exec(`drop table if exists ${words}; drop table if exists ${terms};`);
}

/**
 * One set's index, over a connection the caller owns and writes in its own transactions. Its
 * statements are prepared once; its vocabulary is read once and then added to as this process writes,
 * and read again only when another connection has written (`pragma data_version`).
 */
export class WordIndex {
  private readonly statements = new Map<string, StatementSync>();
  private vocabulary: Vocabulary | null = null;
  private seen = -1;
  private readonly words: string;
  private readonly terms: string;

  constructor(
    private readonly db: DatabaseSync,
    set: number,
  ) {
    ({ words: this.words, terms: this.terms } = tablesOf(set));
  }

  private sql(text: string): StatementSync {
    let s = this.statements.get(text);
    if (!s) {
      s = this.db.prepare(text);
      /* FTS5 numbers the rows of its own tables past 2^53, and `run()` answers the connection's last
         rowid, which as a number throws: integers are read as bigints, and made numbers where read. */
      s.setReadBigInts(true);
      this.statements.set(text, s);
    }
    return s;
  }

  /** The units at `base`, `base + 1`, … — `count` of them — taken out. */
  remove(base: number, count: number): void {
    const del = this.sql(`delete from ${this.words} where rowid = ?`);
    for (let i = 0; i < count; i++) del.run(base + i);
  }

  /** Units in at `base`, `base + 1`, … ; their terms into the vocabulary. At most `SPAN` of them. */
  add(base: number, texts: readonly string[]): void {
    const ins = this.sql(`insert into ${this.words} (rowid, text) values (?, ?)`);
    const term = this.sql(`insert into ${this.terms} (term) values (?) on conflict do nothing`);
    const fresh = new Set<string>();
    texts.slice(0, SPAN).forEach((text, i) => {
      const ws = wordsOf(text);
      ins.run(base + i, ws.join(" "));
      for (const w of ws) fresh.add(w);
    });
    for (const w of fresh) {
      if (term.run(w).changes) this.learn(w);
    }
  }

  /** A term this process wrote, into the vocabulary it holds — once its own write is the last it saw. */
  private learn(w: string): void {
    if (!this.vocabulary) return;
    const list = this.vocabulary.get(w.length);
    if (list) list.push(w);
    else this.vocabulary.set(w.length, [w]);
  }

  /** Every term, read again when another connection wrote since it was last read. */
  private vocab(): Vocabulary {
    const version = Number((this.sql("pragma data_version").get() as { data_version: number }).data_version);
    if (this.vocabulary && version === this.seen) return this.vocabulary;
    const v: Vocabulary = new Map();
    for (const { term } of this.sql(`select term from ${this.terms}`).iterate() as Iterable<{ term: string }>) {
      const list = v.get(term.length);
      if (list) list.push(term);
      else v.set(term.length, [term]);
    }
    this.seen = version;
    return (this.vocabulary = v);
  }

  /** A query's words, each with the terms a typo away from it. */
  ask(q: string): Asked[] {
    const words = [...new Set(wordsOf(q))];
    let vocab: Vocabulary | null = null;
    return words.map((word) => {
      const max = typosFor(word.length);
      const fuzzy: string[] = [];
      if (max > 0) {
        vocab ??= this.vocab();
        for (let len = word.length - max; len <= word.length + max; len++)
          for (const t of vocab.get(len) ?? []) if (t !== word && !t.startsWith(word) && within(word, t, max)) fuzzy.push(t);
      }
      return { word, fuzzy };
    });
  }

  /** The units holding every word asked, best first. */
  *match(asked: readonly Asked[]): Generator<Match> {
    if (!asked.length) return;
    const rows = this.sql(
      `select rowid, bm25(${this.words}) as rank from ${this.words} where ${this.words} match ? order by rank`,
    ).iterate(expressionOf(asked)) as Iterable<{ rowid: number | bigint; rank: number }>;
    for (const r of rows) yield { rowid: Number(r.rowid), score: -r.rank };
  }

  /** Called when the connection closes: what was read of it goes with it. */
  forget(): void {
    this.statements.clear();
    this.vocabulary = null;
    this.seen = -1;
  }
}

/**
 * A query over documents given whole rather than kept: an index made in memory for the one question
 * and closed after it (`POST /search` in `server/handle.ts`, and the tests). The same index, so the
 * same hits in the same order as a vault's.
 */
export function searchDocs(docs: readonly SearchDoc[], q: string, limit = LIMIT): Hit<SearchDoc>[] {
  const db = new DatabaseSync(":memory:");
  try {
    createTables(db, 0);
    const index = new WordIndex(db, 0);
    db.exec("begin");
    docs.forEach((d, k) =>
      index.add(
        (k + 1) * SPAN,
        d.units.map((u) => u.text),
      ),
    );
    db.exec("commit");
    return hitsOf(index, q, limit, (rowid) => {
      const doc = docs[Math.floor(rowid / SPAN) - 1];
      return doc && { doc, unit: () => doc.units[rowid % SPAN] };
    });
  } finally {
    db.close();
  }
}
