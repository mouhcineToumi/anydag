/**
 * A vault's corpus and its search, **answered where its docs are** (#279): on the grammar's worker
 * when there is one, inline when there is none — the same code. The server's thread names the texts,
 * as it does for `/index` (`Entry`, with each one's id and listed title beside it); a `Reader` reads
 * and parses what moved (`server/parsing.ts`), keeping what it made on disk (`server/parse-store.ts`);
 * and what goes back is the corpus as the JSON `/__board/corpus` streams, or a query's hits. The units
 * never cross to the server's thread, which held the corpus of 10,000 files twice over while it ran.
 *
 * - **A search is a lookup in the words index** the `Reader` keeps beside its rows (`server/words.ts`,
 *   #267), brought up to date by the same read that brings the rows up to date: nothing is built in
 *   memory, so a worker started again answers its first search as fast as its last.
 * - **The index keeps where each unit is, not its words.** A hit's snippet is cut from the row its
 *   document is kept in, read when the hit is answered — forty rows at most.
 *
 * Plain Node and pure `src/` imports only: it is bundled into the worker.
 */

import { createHash } from "node:crypto";

import type { CorpusDoc, Unit } from "../src/search/corpus";
import { LIMIT, type SearchDoc } from "../src/search/engine";
import { foundOf } from "./handle";
import { leafOf } from "./names";
import type { Entry, FileMeta, Meta, Read, ReadPart, Reader } from "./parsing";
import { hitsOf, searchDocs, SPAN } from "./words";

/** About how much JSON one part of the corpus holds. */
const PART_BYTES = 512 * 1024;

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
export const catchUp = (reader: Reader, entries: readonly Entry[], chunk?: number): Generator<void, Read> =>
  reader.steps(entries, reader.current, false, chunk);

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

/** What names the list of attachments the index holds: how many there are, and all of them, hashed. */
const sealOf = (files: readonly FileMeta[]): string =>
  `${files.length}:${createHash("sha1").update(JSON.stringify(files)).digest("hex")}`;

/** A document as a hit names it; its title is the text's, read when one of its units is answered. */
interface Placed {
  id: string;
  name: string;
  kind: SearchDoc["kind"];
  title?: string;
}

/**
 * A query's hits over the vault `reader` has just read (`read`, from `catchUp`): a lookup in the words
 * index the reader keeps beside its rows (`server/words.ts`), so nothing is built first. Only the
 * documents a hit is answered from are read off the shelf, for their titles and the words of the unit.
 */
export function searchOver(
  reader: Reader,
  read: Read,
  entries: readonly Entry[],
  meta: readonly Meta[],
  files: readonly FileMeta[],
  q: string,
  limit: number = LIMIT,
  /** The names of the only documents a hit may be in — a search filtered to one tag. */
  only?: readonly string[],
): { status: number; body: unknown } {
  if (!q.trim()) return { status: 200, body: { query: q, hits: [] } };
  const docs = present(read, entries, meta);
  const allowed = only ? new Set(only) : null;
  const keep = allowed ? (d: Placed) => allowed.has(d.name) : undefined;
  const words = reader.words();
  if (!words) {
    // No shelf to keep an index on: one made in memory for the question, over every doc.
    const all: SearchDoc[] = docs.map(([entry, [id, listed]]) => {
      const doc = reader.docOf(entry) as CorpusDoc | null;
      const [, name, kind] = entry;
      return { id, name, kind, title: titleOf(doc, listed, name), units: doc?.units ?? [] };
    });
    for (const [id, name, title] of files)
      all.push({ id, name, kind: "file", ...(title ? { title } : {}), units: fileUnits(name, title) });
    const hits = searchDocs(allowed ? all.filter((d) => allowed.has(d.name)) : all, q, limit);
    return { status: 200, body: { query: q, hits: hits.map((h) => foundOf(h.doc, h.unit, h.score, h.terms)) } };
  }
  reader.files(
    sealOf(files),
    files.map(([, name, title]) => fileUnits(name, title).map((u) => u.text)),
  );
  const byKey = new Map<string, [Entry, Meta]>();
  for (const d of docs) byKey.set(d[0][0], d);
  const placed = new Map<string, { doc: Placed; units: () => Unit[] | undefined }>();
  const at = (rowid: number) => {
    if (rowid < 0) {
      const j = Math.floor((-rowid - 1) / 2);
      const f = files[j];
      if (!f) return undefined;
      const [id, name, title] = f;
      const units = fileUnits(name, title);
      return { doc: { id, name, kind: "file" as const, ...(title ? { title } : {}) }, unit: () => units[rowid + 2 * j + 2] };
    }
    const key = words.keyOf(rowid);
    const got = key === undefined ? undefined : byKey.get(key);
    if (!got) return undefined;
    let p = placed.get(key!);
    if (!p) {
      const [entry, [id, listed]] = got;
      const [, name, kind] = entry;
      const doc: Placed = { id, name, kind };
      let units: Unit[] | undefined;
      let read = false;
      p = {
        doc,
        units: () => {
          if (!read) {
            read = true;
            const kept = reader.shelved(entry) as CorpusDoc | null | undefined;
            if (kept !== undefined) {
              units = kept?.units ?? [];
              doc.title = titleOf(kept, listed, name);
            }
          }
          return units;
        },
      };
      placed.set(key!, p);
    }
    const { doc, units } = p;
    return { doc, unit: () => units()?.[rowid % SPAN] };
  };
  const hits = hitsOf(words.index, q, limit, at, keep);
  return { status: 200, body: { query: q, hits: hits.map((h) => foundOf(h.doc, h.unit, h.score, h.terms)) } };
}
