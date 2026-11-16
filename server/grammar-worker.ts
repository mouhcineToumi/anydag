/**
 * The grammar's heavy half in a process of its own: `/index`, `/corpus` and `/search` over a whole
 * vault are seconds of parsing on a cold one — 12 s for 5,000 notes — and on the server's only thread
 * that was every other request waiting, a save and `/api/auth/me` included. `server/grammar.ts`
 * sends them here and keeps everything else, which is quick, where it was.
 *
 * `/index` and `/corpus` are asked as a `Reader` (`server/parsing.ts`): the names of the texts come
 * in parts, the texts are read here, and what changed goes back in parts, each sent once the last
 * was read — so no text crosses to the server's thread, and no message is long to read there (#287).
 * A vault's corpus and search are answered here whole (`server/searching.ts`), so its units do not
 * cross either (#279); a search is a lookup in the words index kept beside them (#267).
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
import { catchUp, corpusParts, searchOver } from "./searching";

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

/** An answer whose parts are all out: its question stops counting as running (`runningOn`). */
function sent(id: number): void {
  sending.delete(id);
  const reader = answering.get(id);
  answering.delete(id);
  if (reader) runningOn(reader, -1);
}

function send(id: number): void {
  const rest = sending.get(id);
  if (!rest) return;
  let part: IteratorResult<ReadPart>;
  try {
    part = rest.next();
  } catch (e) {
    sent(id);
    post({ id, error: (e as Error)?.stack ?? String(e) } satisfies ReadPart);
    return;
  }
  if (part.done) {
    sent(id);
    return;
  }
  if (!("fresh" in part.value) && !("json" in part.value)) sent(id);
  post(part.value);
}

function readerOf(m: Extract<ReadAsk, { read: number }>): Reader {
  let reader = readers.get(m.parsed);
  if (!reader || reader.root !== m.root) {
    readers.set(m.parsed, (reader = Reader.of(m.root, m.question, m.home)));
  }
  return reader;
}

/* A reader answers one read at a time: a read hands the thread back between chunks, and a second
   one started then would find the first's work half done. */
const turns = new Map<Reader, Promise<unknown>>();
/** How many reads are waiting for each reader's turn: a read in the background stops for one. */
const queued = new Map<Reader, number>();

function inTurn<T>(reader: Reader, run: () => Promise<T>): Promise<T> {
  queued.set(reader, (queued.get(reader) ?? 0) + 1);
  wakeBackground();
  const next = (turns.get(reader) ?? Promise.resolve()).then(() => {
    const n = (queued.get(reader) ?? 1) - 1;
    if (n > 0) queued.set(reader, n);
    else queued.delete(reader);
    return run();
  });
  turns.set(
    reader,
    next.catch(() => undefined),
  );
  return next;
}

/**
 * The questions being answered now, by the reader each is on: a read in the background waits while
 * any of them is on another reader. Counted only once a question has its reader's turn, so one waiting
 * for the reader a background read holds is not waited for — it needs that read done anyway.
 */
const running = new Map<Reader, number>();
let freed: (() => void)[] = [];

function runningOn(reader: Reader, by: number): void {
  const n = (running.get(reader) ?? 0) + by;
  if (n > 0) running.set(reader, n);
  else running.delete(reader);
  if (by < 0) wakeBackground();
}

function wakeBackground(): void {
  const wake = freed;
  freed = [];
  for (const w of wake) w();
}

/**
 * Whether a read in the background on `reader` waits: while a question runs on another reader, and
 * while the entries of any read are still coming in — they are read off the channel only between two
 * chunks, so a few hundred kilobytes of them took one chunk a part (#267).
 */
const givesWay = (reader: Reader): boolean => coming.size > 0 || [...running.keys()].some((r) => r !== reader);

/** The reader of each answer still being sent in parts, which runs until its last part is out. */
const answering = new Map<number, Reader>();

/** How many texts a background read parses between two looks for a question to give way to. */
const BACKGROUND_CHUNK = 8;
/** How often a background read that is giving way tells the server it is still there. */
const ALIVE_MS = 5_000;

/**
 * A read driven a chunk at a time, the thread handed back between, and the server told it is still
 * going. In the `background` of a reader, it first gives way (`givesWay`), chunk by chunk, so the
 * references index the page is waiting for is never slowed by a search index nobody has asked for
 * yet (#267); and it stops — `undefined` — once a question waits for the same reader, which goes on
 * from the rows the chunks already kept, at a question's pace.
 */
async function drive<T>(id: number, steps: Generator<void, T>): Promise<T>;
async function drive<T>(id: number, steps: Generator<void, T>, background: Reader): Promise<T | undefined>;
async function drive<T>(id: number, steps: Generator<void, T>, background: Reader | null = null): Promise<T | undefined> {
  for (;;) {
    while (background) {
      if (queued.has(background)) {
        steps.return(undefined as never);
        return undefined;
      }
      if (!givesWay(background)) break;
      post({ id, alive: true } satisfies ReadPart);
      await new Promise<void>((done) => {
        const timer = setTimeout(done, ALIVE_MS);
        freed.push(() => {
          clearTimeout(timer);
          done();
        });
      });
    }
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
  if (!coming.size) wakeBackground();
  const files: FileMeta[] = m.files ?? [];
  const id = m.read;
  try {
    const reader = readerOf(m);
    const want = m.want;
    await inTurn(reader, async () => {
      if (want && "warm" in want) {
        await drive(id, catchUp(reader, got.entries, BACKGROUND_CHUNK), reader);
        post({ id, answer: { status: 200, body: null } } satisfies ReadPart);
        return;
      }
      runningOn(reader, 1);
      let streamed = false;
      try {
        if (!want) {
          const done = await drive(id, reader.steps(got.entries, m.since));
          sending.set(
            id,
            readParts(id, done, (k) => reader.bytes(k)),
          );
          answering.set(id, reader);
          streamed = true;
          return;
        }
        const done = await drive(id, catchUp(reader, got.entries));
        if ("corpus" in want) {
          sending.set(id, corpusParts(id, reader, done, got.entries, got.meta, files));
          answering.set(id, reader);
          streamed = true;
          return;
        }
        post({
          id,
          answer: searchOver(reader, done, got.entries, got.meta, files, want.search, want.limit, want.only),
        } satisfies ReadPart);
      } finally {
        // An answer sent in parts runs until its last part is out (`sent`).
        if (!streamed) runningOn(reader, -1);
      }
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
  if ("abandon" in m) return sent(m.abandon);
  if ("forget" in m) {
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
