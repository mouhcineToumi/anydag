/**
 * `anydag-api serve` — the server on a socket, and `openStore`, which
 * the CLI shares: the database (Postgres, or PGlite in the data folder), migrated, and the blob
 * directory.
 *
 * Load-bearing:
 * - **Migrations run on every start, under the advisory lock `PgMeta.migrate` takes**, so two
 *   servers starting against one Postgres agree on the schema, and a new version's migration is
 *   applied by simply starting it.
 * - **`single` mode makes the account `owner` on first boot and, while it has no live device,
 *   prints a pairing code and the URL** — the whole of a self-hoster's setup is reading two lines
 *   off the log. This is the only branch in the server that knows the mode.
 * - **PGlite is one process's**: two processes opening one PGlite folder corrupt it. `openStore`
 *   writes `<data>/pg.lock` holding its pid and refuses a folder another live process holds, so a
 *   CLI command run beside a PGlite server says so instead of breaking the database. Against
 *   Postgres there is no lock: Postgres is made for many clients.
 * - **SIGTERM and SIGINT close the socket, every poke stream and the database**, in that order,
 *   and the collector's 24-hour timer is `unref`'d so it never holds the process up.
 */

import fs from "node:fs";
import path from "node:path";

import { serve as listen } from "@hono/node-server";

import { DiskBlobs } from "./blobs/disk";
import type { Blobs } from "./blobs/types";
import { createApp, VERSION } from "./app";
import { configFrom, describe, type Config } from "./config";
import { collect, diskAge } from "./gc";
import { pgDb, pgliteDb } from "./meta/db";
import { PgMeta } from "./meta/pg";
import type { Meta } from "./meta/types";
import { PokeHub } from "./routes/poke";
import { live, mintPairCode } from "./routes/pair";

export interface Store {
  meta: Meta;
  blobs: Blobs;
  blobRoot: string;
  close(): Promise<void>;
}

export class StoreBusy extends Error {}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The database, migrated, and the blob store — as `serve` and every CLI command open them. */
export async function openStore(config: Config): Promise<Store> {
  const blobRoot = path.join(config.data, "blobs");
  fs.mkdirSync(blobRoot, { recursive: true });
  let unlock = (): void => {};
  let db;
  if (config.databaseUrl) db = pgDb(config.databaseUrl);
  else {
    const dir = path.join(config.data, "pg");
    const lock = path.join(config.data, "pg.lock");
    try {
      const held = Number(fs.readFileSync(lock, "utf8").trim());
      if (held && held !== process.pid && alive(held)) {
        throw new StoreBusy(
          `the PGlite database in ${dir} is open in process ${held}: stop it first, or use the admin routes of the running server`,
        );
      }
    } catch (e) {
      if (e instanceof StoreBusy) throw e;
    }
    fs.writeFileSync(lock, String(process.pid));
    unlock = () => {
      try {
        if (fs.readFileSync(lock, "utf8").trim() === String(process.pid)) fs.rmSync(lock);
      } catch {
        /* already gone */
      }
    };
    try {
      db = await pgliteDb(dir);
    } catch (e) {
      unlock();
      throw e;
    }
  }
  const meta = new PgMeta(db);
  try {
    await meta.migrate();
  } catch (e) {
    await meta.close().catch(() => {});
    unlock();
    throw e;
  }
  return {
    meta,
    blobs: new DiskBlobs(blobRoot),
    blobRoot,
    async close() {
      await meta.close();
      unlock();
    },
  };
}

/** `single` mode's first boot: the account `owner`, and a pairing code while it has no device. */
export async function bootstrap(meta: Meta, config: Config, now: Date): Promise<{ account: string; code?: string } | null> {
  if (config.mode !== "single") return null;
  const owner = (await meta.accountByName("owner")) ?? (await meta.createAccount("owner"));
  if (live(await meta.devices(owner.id)) > 0) return { account: owner.id };
  const { code } = await mintPairCode(meta, owner.id, now);
  return { account: owner.id, code };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function serve(config: Config = configFrom()): Promise<() => Promise<void>> {
  const store = await openStore(config);
  const hub = new PokeHub();
  const ageOf = diskAge(store.blobRoot);
  const app = createApp({ meta: store.meta, blobs: store.blobs, config, hub, ageOf });

  const first = await bootstrap(store.meta, config, new Date());
  const server = listen({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    console.log(`anydag-api ${VERSION}: ${config.mode} mode, listening on ${config.host}:${info.port}`);
    for (const row of describe(config)) console.log(`  ${row}`);
    console.log(`  blobs: ${store.blobRoot}`);
    if (first?.code) {
      console.log(`  pair a device with this code (valid 15 minutes, once):`);
      console.log(`    server: ${config.publicUrl}`);
      console.log(`    code:   ${first.code}`);
    }
  });

  const gc = async () => {
    try {
      const r = await collect(store.meta, store.blobs, { historyDays: config.historyDays, now: new Date(), ageOf });
      console.log(`anydag-api: collected — ${r.compacted} log rows compacted, ${r.blobs} blobs (${r.bytes} bytes) removed`);
    } catch (e) {
      console.error(`anydag-api: the collector failed: ${(e as Error).message}`);
    }
  };
  void gc();
  const timer = setInterval(() => void gc(), DAY_MS);
  timer.unref();

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      clearInterval(timer);
      hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.close();
    })());
  const quit = () => {
    void close().then(
      () => process.exit(0),
      (e) => {
        console.error(`anydag-api: closing failed: ${(e as Error).message}`);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", quit);
  process.once("SIGTERM", quit);
  return close;
}
