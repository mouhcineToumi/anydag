/**
 * The grammar's heavy half on a thread of its own: `/index`, `/corpus` and `/search` over a whole
 * vault are seconds of parsing on a cold one — 12 s for 5,000 notes — and on the server's only thread
 * that was every other request waiting, a save and `/api/auth/me` included. `server/grammar.ts`
 * sends them here and keeps everything else, which is quick, where it was.
 *
 * `/index` and `/corpus` are asked as a `Reader` (`server/parsing.ts`): the names of the texts come
 * in parts, the texts are read here, and what changed goes back in parts, each sent once the last
 * was read — so no text crosses to the server's thread, and no message is long to read there (#287).
 *
 * Built beside each bundle that serves (`server/build.mjs`, `cli/build.mjs`); where there is no
 * built worker — the unit suite, which runs the TypeScript — the calls are made inline instead.
 */

import { parentPort } from "node:worker_threads";

import { handle } from "./handle";
import { type Entry, type ReadAsk, type ReadPart, Reader, readParts } from "./parsing";

interface Ask {
  id: number;
  method: "GET" | "POST";
  route: string;
  query: [string, string][];
  body: unknown;
}

/** One `Reader` per cache the server's thread holds, by its number. */
const readers = new Map<number, Reader>();
/** The entries of each read still coming in, by its id. */
const coming = new Map<number, Entry[]>();
/** The rest of each answer being sent, by its id. */
const sending = new Map<number, Generator<ReadPart>>();

function send(id: number): void {
  const part = sending.get(id)?.next();
  if (!part || part.done) return;
  if (!("fresh" in part.value)) sending.delete(id);
  parentPort!.postMessage(part.value);
}

function read(m: Extract<ReadAsk, { read: number }>): void {
  const entries = coming.get(m.read) ?? [];
  for (const e of m.entries) entries.push(e);
  if (!m.last) {
    coming.set(m.read, entries);
    return;
  }
  coming.delete(m.read);
  try {
    let reader = readers.get(m.parsed);
    if (!reader || reader.root !== m.root) readers.set(m.parsed, (reader = Reader.of(m.root, m.question)));
    sending.set(
      m.read,
      readParts(m.read, reader.read(entries, m.since), (k) => reader.bytes(k)),
    );
  } catch (e) {
    parentPort!.postMessage({ id: m.read, error: (e as Error)?.stack ?? String(e) } satisfies ReadPart);
    return;
  }
  send(m.read);
}

/* The body is one try/catch whose handler only posts a string, so this listener cannot reject. */
// eslint-disable-next-line @typescript-eslint/no-misused-promises
parentPort?.on("message", async (m: Ask | ReadAsk) => {
  if ("read" in m) return read(m);
  if ("next" in m) return send(m.next);
  if ("forget" in m) {
    readers.delete(m.forget);
    return;
  }
  const { id, method, route, query, body } = m;
  try {
    const answer = await handle({ method, route, query: new URLSearchParams(query), body });
    parentPort!.postMessage({ id, answer });
  } catch (e) {
    parentPort!.postMessage({ id, error: (e as Error)?.stack ?? String(e) });
  }
});
