/**
 * The grammar's heavy half in a process of its own: `/index`, `/corpus` and `/search` over a whole
 * vault are seconds of parsing on a cold one — 12 s for 5,000 notes — and on the server's only thread
 * that was every other request waiting, a save and `/api/auth/me` included. `server/grammar.ts`
 * sends them here and keeps everything else, which is quick, where it was.
 *
 * `/index` and `/corpus` are asked as a `Reader` (`server/parsing.ts`): the names of the texts come
 * in parts, the texts are read here, and what changed goes back in parts, each sent once the last
 * was read — so no text crosses to the server's thread, and no message is long to read there (#287).
 * A vault's corpus and search are answered here whole (`server/searching.ts`), so neither its units
 * nor its engine cross either (#279).
 *
 * **A process rather than a thread, so that ending it gives its memory back** (#279): the server
 * ends it when it has been idle by closing its channel, and it ends itself then — and when the
 * server goes without saying so, its channel closing all the same. What it parsed is kept in the
 * app's home (`server/parse-store.ts`), so the next one starts from there.
 *
 * Built beside each bundle that serves (`server/build.mjs`, `cli/build.mjs`); where there is no
 * built worker — the unit suite, which runs the TypeScript — the calls are made inline instead.
 */

import { setImmediate as yieldNow } from "node:timers/promises";

import { handle } from "./handle";
import { type Entry, type FileMeta, type Meta, type ReadAsk, type ReadPart, Reader, readParts } from "./parsing";
import { catchUp, corpusParts, forgetEngines, searchSteps } from "./searching";

interface Ask {
  id: number;
  method: "GET" | "POST";
  route: string;
  query: [string, string][];
  body: unknown;
}

const post = (m: unknown): void => {
  if (process.connected) process.send!(m);
};

/** One `Reader` per cache the server's thread holds, by its number. */
const readers = new Map<number, Reader>();
/** The entries (and their `Meta`) of each read still coming in, by its id. */
const coming = new Map<number, { entries: Entry[]; meta: Meta[] }>();
/** The rest of each answer being sent, by its id. */
const sending = new Map<number, Generator<ReadPart>>();

function send(id: number): void {
  const rest = sending.get(id);
  if (!rest) return;
  let part: IteratorResult<ReadPart>;
  try {
    part = rest.next();
  } catch (e) {
    sending.delete(id);
    post({ id, error: (e as Error)?.stack ?? String(e) } satisfies ReadPart);
    return;
  }
  if (part.done) return;
  if (!("fresh" in part.value) && !("json" in part.value)) sending.delete(id);
  post(part.value);
}

function readerOf(m: Extract<ReadAsk, { read: number }>): Reader {
  let reader = readers.get(m.parsed);
  if (!reader || reader.root !== m.root) {
    if (reader) forgetEngines(Date.now(), reader);
    readers.set(m.parsed, (reader = Reader.of(m.root, m.question, m.home)));
  }
  return reader;
}

/* A reader answers one read at a time: a read hands the thread back between chunks, and a second
   one started then would find the first's work half done. */
const turns = new Map<Reader, Promise<unknown>>();

function inTurn<T>(reader: Reader, run: () => Promise<T>): Promise<T> {
  const next = (turns.get(reader) ?? Promise.resolve()).then(run);
  turns.set(
    reader,
    next.catch(() => undefined),
  );
  return next;
}

/** A read driven a chunk at a time, the thread handed back between, and the server told it is still going. */
async function drive<T>(id: number, steps: Generator<void, T>): Promise<T> {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    post({ id, alive: true } satisfies ReadPart);
    await yieldNow();
  }
}

async function read(m: Extract<ReadAsk, { read: number }>): Promise<void> {
  const got = coming.get(m.read) ?? { entries: [], meta: [] };
  for (const e of m.entries) got.entries.push(e);
  for (const x of m.meta ?? []) got.meta.push(x);
  if (!m.last) {
    coming.set(m.read, got);
    return;
  }
  coming.delete(m.read);
  const files: FileMeta[] = m.files ?? [];
  const id = m.read;
  try {
    const reader = readerOf(m);
    const want = m.want;
    await inTurn(reader, async () => {
      if (!want) {
        const done = await drive(id, reader.steps(got.entries, m.since));
        sending.set(
          id,
          readParts(id, done, (k) => reader.bytes(k)),
        );
        return;
      }
      const done = await drive(id, catchUp(reader, got.entries));
      if ("corpus" in want) {
        sending.set(id, corpusParts(id, reader, done, got.entries, got.meta, files));
        return;
      }
      const steps = searchSteps(
        reader,
        done,
        got.entries,
        got.meta,
        files,
        want.search,
        want.limit,
        want.retire === true,
        want.only,
      );
      post({ id, answer: await drive(id, steps) } satisfies ReadPart);
    });
  } catch (e) {
    post({ id, error: (e as Error)?.stack ?? String(e) } satisfies ReadPart);
    return;
  }
  send(id);
}

/* The body is one try/catch whose handler only sends a string, so this listener cannot reject. */
// eslint-disable-next-line @typescript-eslint/no-misused-promises
process.on("message", async (m: Ask | ReadAsk) => {
  if ("read" in m) return read(m);
  if ("next" in m) return send(m.next);
  if ("forget" in m) {
    const reader = readers.get(m.forget);
    if (reader) forgetEngines(Date.now(), reader);
    readers.delete(m.forget);
    return;
  }
  const { id, method, route, query, body } = m;
  try {
    const answer = await handle({ method, route, query: new URLSearchParams(query), body });
    post({ id, answer });
  } catch (e) {
    post({ id, error: (e as Error)?.stack ?? String(e) });
  }
});

process.on("disconnect", () => process.exit(0));
