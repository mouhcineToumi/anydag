/**
 * The sync server under test: `createApp` over a real `PgMeta` — PGlite in memory, or a real
 * Postgres when `ANYDAG_SYNC_TEST_PG` names one, in a schema of its own for the run — and
 * `DiskBlobs` in a temp folder, with a clock the test moves.
 *
 * Load-bearing:
 * - **Nothing is stubbed**: the routes are tested through the same `Meta` adapter the server ships,
 *   so a stub cannot agree with a route about a shape the database never returns (the rule
 *   docs/architecture/things-that-will-bite.md states about the hosted api's stubs).
 * - **The Postgres backend is skipped with a word when no server is named**, and when one is, every
 *   run gets a fresh schema (`search_path` through `pgDb`'s `schema`), dropped at the end, so runs
 *   never see each other's rows.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PROTOCOL, PROTOCOL_HEADER } from "../protocol/wire";
import { createApp } from "../server/app";
import { DiskBlobs } from "../server/blobs/disk";
import { configFrom, type Config } from "../server/config";
import { pgDb, pgliteDb } from "../server/meta/db";
import { PgMeta } from "../server/meta/pg";
import type { Db } from "../server/meta/types";
import { mintPairCode } from "../server/routes/pair";
import { PokeHub } from "../server/routes/poke";

export const ADMIN = "admin-token-for-the-tests-0123456789";
export const PG_URL = process.env.ANYDAG_SYNC_TEST_PG ?? "";

export type Backend = "pglite" | "pg";
export const BACKENDS: { name: Backend; skip: boolean }[] = [
  { name: "pglite", skip: false },
  { name: "pg", skip: !PG_URL },
];

export interface Clock {
  now: Date;
  advance(ms: number): void;
}

export interface Harness {
  app: ReturnType<typeof createApp>;
  meta: PgMeta;
  blobs: DiskBlobs;
  root: string;
  clock: Clock;
  config: Config;
  hub: PokeHub;
  close(): Promise<void>;
}

async function openDb(backend: Backend): Promise<{ db: Db; drop: () => Promise<void> }> {
  if (backend === "pglite") return { db: await pgliteDb(), drop: async () => {} };
  const schema = `sync_test_${process.pid}_${randomBytes(4).toString("hex")}`;
  const admin = pgDb(PG_URL);
  await admin.exec(`create schema ${schema}`);
  const db = pgDb(PG_URL, { schema });
  return {
    db,
    drop: async () => {
      await admin.exec(`drop schema ${schema} cascade`);
      await admin.close();
    },
  };
}

export async function harness(
  backend: Backend = "pglite",
  env: Record<string, string> = {},
  opts: { fetch?: typeof fetch } = {},
): Promise<Harness> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-sync-test-"));
  const config = configFrom({
    ANYDAG_SYNC_DATA: root,
    ANYDAG_SYNC_ADMIN_TOKEN: ADMIN,
    ANYDAG_SYNC_PUBLIC_URL: "http://sync.test",
    ...env,
  });
  const { db, drop } = await openDb(backend);
  const meta = new PgMeta(db);
  await meta.migrate();
  const blobs = new DiskBlobs(path.join(root, "blobs"));
  const clock: Clock = {
    now: new Date("2026-11-06T12:00:00.000Z"),
    advance(ms) {
      this.now = new Date(this.now.getTime() + ms);
    },
  };
  const hub = new PokeHub();
  const app = createApp({ meta, blobs, config, now: () => clock.now, hub, version: "test", pingMs: 50, ...opts });
  return {
    app,
    meta,
    blobs,
    root,
    clock,
    config,
    hub,
    async close() {
      hub.close();
      await meta.close();
      await drop();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export interface CallOptions {
  token?: string;
  /** The protocol the request says it speaks: this build's unless given; `null` says none (0.2.0). */
  protocol?: string | null;
  json?: unknown;
  bytes?: Uint8Array;
  headers?: Record<string, string>;
}

export function call(h: Harness, method: string, route: string, opts: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.protocol !== null) headers[PROTOCOL_HEADER] = opts.protocol ?? String(PROTOCOL);
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.bytes) {
    headers["content-type"] = "application/octet-stream";
    headers["content-length"] ??= String(opts.bytes.byteLength);
    body = opts.bytes as unknown as BodyInit;
  }
  return Promise.resolve(h.app.request(route, { method, headers, body }));
}

/** A 43-character id of the wire's shape, distinct per seed. */
export const wid = (seed: string): string => Buffer.from(seed.padEnd(32, ".").slice(0, 32)).toString("base64url");

let accounts = 0;

/** A fresh account and one device paired into it, through the real `/v1/pair`. */
export async function device(h: Harness, accountName?: string): Promise<{ token: string; account: string; device: string }> {
  const name = accountName ?? `acct${++accounts}${randomBytes(2).toString("hex")}`;
  const a = (await h.meta.accountByName(name)) ?? (await h.meta.createAccount(name));
  const { code } = await mintPairCode(h.meta, a.id, h.clock.now);
  const res = await call(h, "POST", "/v1/pair", { json: { code, device: { name: "laptop", platform: "linux" } } });
  if (res.status !== 200) throw new Error(`pairing failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { token: string; account: { id: string }; device: { id: string } };
  return { token: j.token, account: j.account.id, device: j.device.id };
}

/** A vault for the device's account. */
export async function vault(h: Harness, token: string): Promise<string> {
  const res = await call(h, "POST", "/v1/vaults", { token, json: { name: "c2VhbGVk" } });
  if (res.status !== 201) throw new Error(`vault failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

/** Upload bytes as blob `id`. */
export async function upload(h: Harness, token: string, v: string, id: string, bytes: Uint8Array): Promise<Response> {
  return call(h, "PUT", `/v1/vaults/${v}/blobs/${id}`, { token, bytes });
}
