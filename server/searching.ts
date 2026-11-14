/**
 * A vault's corpus and its search, **answered where its docs are** (#279): on the grammar's worker
 * when there is one, inline when there is none — the same code. The server's thread names the texts,
 * as it does for `/index` (`Entry`, with each one's id and listed title beside it); a `Reader` reads
 * and parses what moved (`server/parsing.ts`), keeping what it made on disk (`server/parse-store.ts`);
 * and what goes back is the corpus as the JSON `/__board/corpus` streams, or a query's hits. Neither
 * the units nor the engine cross to the server's thread, which held both for as long as it ran: the
 * corpus of 10,000 files twice over, and an engine five times its size.
 *
 * - **The engine keeps where each unit is, not its words.** A hit's snippet is cut from the row its
 *   document is kept in, read when the hit is answered — forty rows at most.
 * - **The engine is kept while somebody is searching**, named by every text's sha1 and how the vault
 *   lists it, and built again only when that moves; `SEARCH_IDLE_MS` after the last search it is let
 *   go here, and whole by `server/grammar.ts` ending the worker that holds it.
 * - **A worker that has just parsed many texts does not build it** (`{ again }`): the heap their
 *   garbage grew is never given back (see *Things that will bite*), so a fresh worker builds it from
 *   the rows instead.
 *
 * Plain Node and pure `src/` imports only: it is bundled into the worker.
 */

import { createHash } from "node:crypto";

import type MiniSearch from "minisearch";

import type { CorpusDoc, Unit } from "../src/search/corpus";
import { LIMIT, newIndex, rank, type Row, type SearchDoc } from "../src/search/engine";
import { foundOf } from "./handle";
import { leafOf } from "./names";
import { type Entry, type FileMeta, type Meta, parsedSinceStart, type Read, type ReadPart, type Reader } from "./parsing";

/** How long an engine nobody searches stays built. */
export const SEARCH_IDLE_MS = Number(process.env.ANYDAG_SEARCH_IDLE_MS) || 5 * 60_000;

/**
 * How many texts a worker may have parsed — for any question — and still build an engine in its own
 * heap; past it, it asks to be replaced first.
 */
const FRESH_AFTER = 500;

/** About how much JSON one part of the corpus holds. */
const PART_BYTES = 512 * 1024;

/** A document as the engine holds it: its names, and — for an attachment, whose units are its names — its units. */
interface Placed {
  entry: Entry | null;
  id: string;
  name: string;
  kind: SearchDoc["kind"];
  title?: string;
  units?: Unit[];
}

interface Held {
  version: string;
  mini: MiniSearch<Row>;
  docs: Placed[];
  /** Unit `k` is unit `at[2k + 1]` of document `at[2k]`. */
  at: number[];
  used: number;
}

const engines = new Map<Reader, Held>();

/** Let go of the engines nobody has searched for `SEARCH_IDLE_MS`, and of a reader's whatever its age. */
export function forgetEngines(now = Date.now(), reader?: Reader): void {
  if (reader) engines.delete(reader);
  for (const [r, held] of engines) if (now - held.used > SEARCH_IDLE_MS) engines.delete(r);
}

/** An attachment's units: its title when it has one, and its file name. */
const fileUnits = (name: string, title: string | null): Unit[] => [
  ...(title ? [{ what: "title" as const, text: title }] : []),
  { what: "file" as const, text: leafOf(name) },
];

/** The title a document is answered with: its text's, else its listing's, else its name's last part. */
const titleOf = (doc: CorpusDoc | null, listed: string | null, name: string): string => doc?.title ?? listed ?? leafOf(name);

/**
 * `reader` brought up to date with `entries`, its docs left on the shelf: a step at a time, for the
 * worker to drive (`Reader.steps`), or all at once.
 */
export const catchUp = (reader: Reader, entries: readonly Entry[]): Generator<void, Read> =>
  reader.steps(entries, reader.current, false);

/** `catchUp` all at once, where there is no worker. */
export function caughtUp(reader: Reader, entries: readonly Entry[]): Read {
  const steps = catchUp(reader, entries);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** The entries a read could read, each with its `Meta`. */
function present(read: Read, entries: readonly Entry[], meta: readonly Meta[]): [Entry, Meta][] {
  const missing = new Set(read.missing);
  const out: [Entry, Meta][] = [];
  entries.forEach((e, i) => {
    if (!missing.has(e[0])) out.push([e, meta[i]!]);
  });
  return out;
}

/** `/__board/corpus`: every document's units, as JSON in parts of about `PART_BYTES`, the docs joined by commas. */
export function* corpusParts(
  id: number,
  reader: Reader,
  read: Read,
  entries: readonly Entry[],
  meta: readonly Meta[],
  files: readonly FileMeta[],
): Generator<ReadPart> {
  let part = "";
  const add = (doc: unknown) => {
    part += (part ? "," : "") + JSON.stringify(doc);
  };
  for (const [entry, [docId, listed]] of present(read, entries, meta)) {
    const [, name, kind] = entry;
    const doc = reader.docOf(entry) as CorpusDoc | null;
    add({ id: docId, name, kind, title: titleOf(doc, listed, name), units: doc?.units ?? [] });
    if (part.length >= PART_BYTES) {
      yield { id, json: part };
      part = "";
    }
  }
  for (const [fileId, name, title] of files) add({ id: fileId, name, kind: "file", title, units: fileUnits(name, title) });
  if (part) yield { id, json: part };
  yield { id, end: true };
}

/** What names an engine: every text's sha1 and how it is listed, and every attachment. */
function versionOf(reader: Reader, docs: readonly [Entry, Meta][], files: readonly FileMeta[]): string {
  const hash = createHash("sha1");
  for (const [[key, name, kind], [docId, title]] of docs)
    hash.update(`${key}\0${reader.shaOf(key) ?? ""}\0${docId}\0${name}\0${kind}\0${title ?? ""}\n`);
  hash.update(JSON.stringify(files));
  return hash.digest("hex");
}

/** How many documents go into an engine between two looks at the clock. */
const BUILD_STEP = 1000;

/** An engine over `docs`, built a step of `BUILD_STEP` documents at a time (see `Reader.steps`). */
function* build(
  reader: Reader,
  version: string,
  docs: readonly [Entry, Meta][],
  files: readonly FileMeta[],
): Generator<void, Held> {
  const mini = newIndex();
  const placed: Placed[] = [];
  const at: number[] = [];
  const place = (p: Placed, units: readonly Unit[]) => {
    const d = placed.push(p) - 1;
    const rows: Row[] = [];
    units.forEach((u, i) => {
      rows.push({ k: at.length / 2, text: u.text });
      at.push(d, i);
    });
    mini.addAll(rows);
  };
  for (const [entry, [docId, listed]] of docs) {
    const [, name, kind] = entry;
    const doc = reader.docOf(entry) as CorpusDoc | null;
    place({ entry, id: docId, name, kind, title: titleOf(doc, listed, name) }, doc?.units ?? []);
    if (placed.length % BUILD_STEP === 0) yield;
  }
  for (const [fileId, name, title] of files) {
    const units = fileUnits(name, title);
    place({ entry: null, id: fileId, name, kind: "file", ...(title ? { title } : {}), units }, units);
  }
  return { version, mini, docs: placed, at, used: Date.now() };
}

/**
 * A query's hits over the vault `reader` has just read (`read`, from `catchUp`) — or `{ again: true }`
 * when it would build an engine in a process that has parsed many texts, and `canAgain`: the worker is a
 * process another can replace.
 */
export function searchOver(...args: Parameters<typeof searchSteps>): { status: number; body: unknown } {
  const steps = searchSteps(...args);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** `searchOver` a step at a time, for the worker to drive: the engine is built in steps. */
export function* searchSteps(
  reader: Reader,
  read: Read,
  entries: readonly Entry[],
  meta: readonly Meta[],
  files: readonly FileMeta[],
  q: string,
  limit: number = LIMIT,
  canAgain = false,
): Generator<void, { status: number; body: unknown }> {
  forgetEngines(Date.now());
  if (!q.trim()) return { status: 200, body: { query: q, hits: [] } };
  const docs = present(read, entries, meta);
  const version = versionOf(reader, docs, files);
  if (canAgain && engines.get(reader)?.version !== version && parsedSinceStart() >= FRESH_AFTER) {
    engines.delete(reader);
    return { status: 200, body: { again: true } };
  }
  for (let attempt = 0; ; attempt++) {
    let held = engines.get(reader);
    if (held?.version !== version) {
      engines.delete(reader); // the old engine goes before the new one is built, not after
      engines.set(reader, (held = yield* build(reader, version, docs, files)));
    }
    const hits = rank(held.mini, q, limit, (k) => {
      const doc = held.docs[held.at[2 * k]!];
      return doc ? { doc, i: held.at[2 * k + 1]! } : undefined;
    });
    let stale = false;
    const found = [];
    for (const h of hits) {
      const unit = h.doc.units ? h.doc.units[h.i] : (reader.docOf(h.doc.entry!) as CorpusDoc | null)?.units[h.i];
      if (unit) found.push(foundOf(h.doc, unit, h.score, h.terms));
      else stale = true;
    }
    held.used = Date.now();
    // A text that moved under the engine since it was built: built again, once.
    if (stale && attempt === 0) {
      engines.delete(reader);
      continue;
    }
    return { status: 200, body: { query: q, hits: found } };
  }
}
