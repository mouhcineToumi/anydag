/**
 * Linking and the sync loop (`server/sync/loop.ts`, `link.ts`, `server/routes/sync.ts`): two and
 * three app sessions — each its own home and vault folder — against one real sync server on a real
 * port (`sync/test/helpers.ts`, PGlite), every step through the app's own `/api/sync` routes.
 */

import "./sqlite-shim";

import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { Home } from "../../server/home";
import { TUNE } from "../../server/sync/loop";
import type { SyncDevices, SyncLinked, SyncPaired, SyncRemotes, SyncStatus } from "../../server/sync/types";
import type { Change } from "../../server/vault";
import { harness, type Harness } from "../../sync/test/helpers";
import { mintPairCode } from "../../sync/server/routes/pair";
import { makeEnv, NOTE, readText, write, type Env } from "./helpers";

const PASS = "correct horse battery";
const TUNED = { ...TUNE, pollMs: 60_000, quietMs: 60, maxMs: 400, backoffMs: 50, backoffMaxMs: 200, poke: false, retries: 0 };

interface App {
  env: Env;
  s: Session;
  call(method: string, route: string, body?: unknown): Promise<{ status: number; json: any }>;
}

let h: Harness;
let server: ServerType;
let url = "";
let account = "";
const apps: App[] = [];

function app(): App {
  const env = makeEnv();
  const s = new Session(env.home, env.vault, "test");
  s.sync.tune = TUNED;
  const hono = createApp({ session: s, token: "t", page: null });
  const a: App = {
    env,
    s,
    async call(method, route, body) {
      const res = await hono.request(route, {
        method,
        headers: { host: "127.0.0.1", "x-anydag-token": "t", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: await res.json() };
    },
  };
  apps.push(a);
  return a;
}

async function code(): Promise<string> {
  return (await mintPairCode(h.meta, account, h.clock.now)).code;
}

async function paired(a: App): Promise<SyncPaired> {
  const got = await a.call("POST", "/api/sync/pair", { server: url, code: await code(), device: `dev-${apps.indexOf(a)}` });
  expect(got.status, JSON.stringify(got.json)).toBe(200);
  return got.json;
}

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const has = (root: string, rel: string): boolean => fs.existsSync(path.join(root, ...rel.split("/")));

beforeAll(async () => {
  h = await harness("pglite");
  account = (await h.meta.createAccount("alice")).id;
  server = serve({ fetch: h.app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((r) => server.once("listening", () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const a of apps) {
    await a.s.closeAll();
    await a.env.cleanup();
  }
  await new Promise((r) => server.close(r));
  await h.close();
});

describe("linking two vaults through /api/sync", () => {
  let A: App;
  let B: App;
  let recovery = "";
  let remote = "";

  it("pairs, and an upload answers the recovery code once", { timeout: 30_000 }, async () => {
    A = app();
    write(A.env.root, "plan.md", NOTE);
    write(A.env.root, "attachments/ref.pdf", "%PDF-1.4\n");
    expect((await A.call("GET", "/api/sync")).json).toMatchObject({ linked: false, state: "unlinked", server: null });
    expect((await A.call("GET", "/api/sync/remotes")).status).toBe(409);

    const p = await paired(A);
    expect(p).toEqual({ server: url, account: "alice", device: "dev-0" });
    const pairFile = path.join(A.env.homeDir, "sync", A.env.vault.id, "pair.json");
    expect(fs.statSync(pairFile).mode & 0o777).toBe(0o600);
    expect((await A.call("GET", "/api/sync")).json).toMatchObject({ linked: false, state: "unlinked", server: url, device: "dev-0" });

    expect((await A.call("POST", "/api/sync/link", { mode: "upload", passphrase: "short" })).status).toBe(400);

    const linked = await A.call("POST", "/api/sync/link", { mode: "upload", passphrase: PASS });
    expect(linked.status, JSON.stringify(linked.json)).toBe(200);
    const got = linked.json as SyncLinked;
    expect(got.recovery).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
    expect(got.vault).toBe(A.env.vault.id);
    expect(got.status).toMatchObject({ linked: true, state: "idle", remote: A.env.vault.id, pending: 0 });
    expect(got.status.last).not.toBeNull();
    recovery = got.recovery!;
    remote = got.vault;

    const status = (await A.call("GET", "/api/sync")).json as SyncStatus;
    expect(status).toMatchObject({ linked: true, state: "idle" });
    expect(JSON.stringify(status)).not.toContain(recovery);
    expect((await A.call("POST", "/api/sync/link", { mode: "upload", passphrase: PASS })).status).toBe(409);
  });

  it("a second vault downloads into an empty folder, with the same files and the remote's id", { timeout: 30_000 }, async () => {
    B = app();
    const old = B.env.vault.id;
    await paired(B);
    const listed = (await B.call("GET", "/api/sync/remotes")).json as SyncRemotes;
    expect(listed.remotes).toEqual([expect.objectContaining({ id: remote, keyed: true, mine: false })]);
    expect(listed.remotes[0]!.seq).toBeGreaterThan(0);

    const wrong = await B.call("POST", "/api/sync/link", { mode: "download", remote, passphrase: "not the passphrase" });
    expect(wrong.status).toBe(400);
    expect(wrong.json.error).toMatch(/passphrase does not open/);

    const got = await B.call("POST", "/api/sync/link", { mode: "download", remote, passphrase: PASS });
    expect(got.status, JSON.stringify(got.json)).toBe(200);
    expect(got.json.vault).toBe(remote);
    expect(got.json.recovery).toBeUndefined();
    expect(B.s.vault.id).toBe(remote);
    expect(JSON.parse(readText(B.env.root, ".anydag/vault.json"))).toEqual({ id: remote });
    expect(readText(B.env.root, "plan.md")).toBe(NOTE);
    expect(readText(B.env.root, "attachments/ref.pdf")).toBe("%PDF-1.4\n");
    expect(fs.existsSync(path.join(B.env.homeDir, "sync", old))).toBe(false);
    expect(fs.existsSync(path.join(B.env.homeDir, "sync", remote, "key"))).toBe(true);
    expect((await B.call("GET", "/api/sync")).json).toMatchObject({ linked: true, state: "idle", remote });
  });

  it("refuses a download into a vault that holds documents, and opens the key with the recovery code", { timeout: 30_000 }, async () => {
    const C = app();
    write(C.env.root, "mine.md", NOTE);
    await paired(C);
    const mistyped = await C.call("POST", "/api/sync/link", { mode: "download", remote, recovery: recovery.replace(/^..../, "ZZZZ") });
    expect(mistyped.status).toBe(400);
    const refused = await C.call("POST", "/api/sync/link", { mode: "download", remote, recovery });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "not-empty" });
    expect(C.s.vault.id).toBe(C.env.vault.id);

    // The same code opens the key for a merge: both vaults' files end up in both.
    const merged = await C.call("POST", "/api/sync/link", { mode: "merge", remote, recovery });
    expect(merged.status, JSON.stringify(merged.json)).toBe(200);
    expect(merged.json.vault).toBe(remote);
    expect(readText(C.env.root, "plan.md")).toBe(NOTE);
    await A.call("POST", "/api/sync/now");
    expect(readText(A.env.root, "mine.md")).toBe(NOTE);
    await C.call("POST", "/api/sync/unlink");
  });

  it("a write in A reaches B through `now`", async () => {
    write(A.env.root, "news.md", "---\ntitle: News\n---\nFrom A.\n");
    const a = (await A.call("POST", "/api/sync/now")).json as SyncStatus;
    expect(a.state).toBe("idle");
    // `pending` counts watcher events not yet pushed, and on a slow machine the event for the
    // write above can land after `now` has already pushed it: a read straight after `now` races
    // the watcher. What is meant is that A has nothing left to push once the loop has heard it.
    await until("A to have nothing pending", async () => ((await A.call("GET", "/api/sync")).json as SyncStatus).pending === 0);
    const b = (await B.call("POST", "/api/sync/now")).json as SyncStatus;
    expect(b.state).toBe("idle");
    expect(readText(B.env.root, "news.md")).toContain("From A.");
  });

  it("a poke pulls a change into B with nobody asking", { timeout: 15_000 }, async () => {
    B.s.sync.tune = { ...TUNED, poke: true };
    await B.s.sync.closed(B.s.vault.id);
    await B.s.sync.start(B.s.vault);
    write(A.env.root, "poked.md", "---\ntitle: Poked\n---\nPoked.\n");
    await A.call("POST", "/api/sync/now");
    await until("the poke to bring poked.md to B", () => has(B.env.root, "poked.md"));
    B.s.sync.tune = TUNED;
  });

  it("a change B's watcher reports is pushed after the debounce, and says so on the feed", { timeout: 15_000 }, async () => {
    const said: SyncStatus[] = [];
    const off = await B.s.vault.subscribe((c: Change) => {
      if (c.type === "sync") said.push(c.status);
    });
    write(B.env.root, "from-b.md", "---\ntitle: From B\n---\nWritten in B.\n");
    await until("B to see the change", () => said.some((s) => s.pending > 0));
    await until("B to push it", () => said.some((s) => s.state === "syncing") && said.at(-1)!.state === "idle" && said.at(-1)!.pending === 0);
    await A.call("POST", "/api/sync/now");
    expect(readText(A.env.root, "from-b.md")).toContain("Written in B.");
    off();
  });

  it("lists the devices, and a revoked device pauses with a reason", { timeout: 15_000 }, async () => {
    const mine = (await B.call("GET", "/api/sync/devices")).json as SyncDevices;
    const me = mine.devices.find((d) => d.me)!;
    expect(me.name).toBe("dev-1");
    const after = await A.call("POST", "/api/sync/devices/revoke", { id: me.id });
    expect(after.status, JSON.stringify(after.json)).toBe(200);
    expect((after.json as SyncDevices).devices.find((d) => d.id === me.id)!.revoked).not.toBeNull();

    const b = (await B.call("POST", "/api/sync/now")).json as SyncStatus;
    expect(b.state).toBe("paused");
    expect(b.reason).toMatch(/revoked/);
    const listed = await B.call("GET", "/api/sync/devices");
    expect(listed.status).toBe(403);
    expect(listed.json.code).toBe("ES_AUTH");
  });

  it("unlink forgets the link and keeps every file", async () => {
    const id = A.s.vault.id;
    const got = (await A.call("POST", "/api/sync/unlink")).json as SyncStatus;
    expect(got).toMatchObject({ linked: false, state: "unlinked", server: null });
    expect(fs.existsSync(path.join(A.env.homeDir, "sync", id))).toBe(false);
    expect(has(A.env.root, "plan.md") && has(A.env.root, "from-b.md") && has(A.env.root, "news.md")).toBe(true);
    expect((await A.call("POST", "/api/sync/now")).status).toBe(409);
    // The remote is still there for anybody else.
    expect((await h.meta.vaults(account)).map((v) => v.id)).toContain(id);
  });
});

describe("what a process that is not the app does with a linked vault", () => {
  it("an in-process session with loops off starts none, says so, and still syncs on `now`", { timeout: 30_000 }, async () => {
    const E = app();
    await paired(E);
    expect((await E.call("POST", "/api/sync/link", { mode: "upload", passphrase: PASS })).status).toBe(200);
    const id = E.s.vault.id;
    await E.s.closeAll();
    write(E.env.root, "resting.md", NOTE);
    const seq = (await h.meta.heads(id, "", 1)).seq;

    // The CLI's connection: `auto` off before the vault is opened.
    const s = new Session(new Home(E.env.homeDir), null, "test");
    s.sync.tune = TUNED;
    s.sync.auto = false;
    const v = s.openFolder(E.env.root);
    expect(v.id).toBe(id);
    expect(s.sync.get(id)).toBeUndefined();
    const hono = createApp({ session: s, token: "t", page: null });
    const call = async (method: string, route: string) => {
      const res = await hono.request(route, { method, headers: { host: "127.0.0.1", "x-anydag-token": "t" } });
      return { status: res.status, json: (await res.json()) as SyncStatus };
    };
    try {
      const rest = (await call("GET", "/api/sync")).json;
      expect(rest).toMatchObject({ linked: true, state: "idle", remote: id });
      expect(rest.reason).toMatch(/anydag sync now/);
      expect(s.sync.get(id)).toBeUndefined();
      // `now` is asked for, so it runs.
      const now = await call("POST", "/api/sync/now");
      expect(now.status, JSON.stringify(now.json)).toBe(200);
      // The file written while nothing ran is on the server now.
      expect((await h.meta.heads(id, "", 1)).seq).toBeGreaterThan(seq);
    } finally {
      await s.closeAll();
    }
  });

  it("a link this process could not keep the key of is refused before the server is asked", async () => {
    const F = app();
    await paired(F);
    await F.s.closeAll();
    fs.writeFileSync(path.join(F.env.homeDir, "keys.json"), JSON.stringify({ keys: { ANYDAG_HOME_SECRET: { scheme: "safeStorage", value: "AAAA" } } }));
    const s = new Session(new Home(F.env.homeDir), null, "test");
    s.sync.tune = TUNED;
    s.openFolder(F.env.root);
    const hono = createApp({ session: s, token: "t", page: null });
    try {
      const before = (await h.meta.vaults(account)).length;
      const res = await hono.request("/api/sync/link", {
        method: "POST",
        headers: { host: "127.0.0.1", "x-anydag-token": "t", "content-type": "application/json" },
        body: JSON.stringify({ mode: "upload", passphrase: PASS }),
      });
      const json = (await res.json()) as { code?: string; error?: string; message?: string };
      expect(res.status).toBe(409);
      expect(json.code).toBe("secret");
      expect((await h.meta.vaults(account)).length).toBe(before);
      expect(fs.existsSync(path.join(F.env.homeDir, "home.secret"))).toBe(false);
    } finally {
      await s.closeAll();
    }
  });
});
