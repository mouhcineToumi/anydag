/**
 * The build's `cloud` switch (`server/features.ts`), at every edge it gates: what the build
 * answers (`/api/health`), what it stops (`/api/sync/*`, `/api/telemetry*`, the sync loop, a log
 * batch and its destination, the MCP tool list), and the one line the CLI answers for a command it
 * does not carry. The page's half is `e2e/cloud.spec.ts`; the pair together are the acceptance's
 * two halfs, and neither alone would say the feature is not merely hidden but *gone*.
 *
 * **The suite runs with the switch on** (`vitest.config.ts`'s define says so, since a test run has
 * no build): everything here that wants off passes `ANYDAG_CLOUD=off` in the environment it hands
 * to the code under test — the override `server/features.ts` reads per call. No test touches
 * `process.env` directly; the override is the caller's env, never a global.
 */
import "./server/sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXIT } from "../cli/api";
import type { Io } from "../cli/context";
import { CLOUD_OFF_LINE, main } from "../cli/main";
import { createApp } from "../server/app";
import { Session } from "../server/context";
import { cloudOn, features } from "../server/features";
import { makeEnv, sweepTemps, type Env } from "./server/helpers";
import { SyncLinks } from "../server/sync/link";
import { chatTools } from "../server/mcp/chat";
import { listTools, TOOLS } from "../server/mcp/tools";
import { Telemetry } from "../server/telemetry";

/** The override every test here answers with: the run-time half of the switch. */
const CLOUD_OFF = { ANYDAG_CLOUD: "off" } as const;

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

function appOf(vars: NodeJS.ProcessEnv = {}) {
  const session = new Session(env.home, env.vault, "0.3.0", vars);
  const app = createApp({ session, token: "t", page: null });
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.request(`http://127.0.0.1${url}`, {
      method,
      headers: { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
  };
  return { session, app, call };
}

describe("the read", () => {
  it("is on by default, and ANYDAG_CLOUD=off says off", () => {
    expect(cloudOn({})).toBe(true);
    expect(cloudOn({ ANYDAG_CLOUD: "off" })).toBe(false);
    expect(cloudOn({ ANYDAG_CLOUD: " off " })).toBe(false);
    expect(cloudOn({ ANYDAG_CLOUD: "on" })).toBe(true);
    /* An unknown word is unset, the way every preference here falls back rather than guessing. */
    expect(cloudOn({ ANYDAG_CLOUD: "maybe" })).toBe(true);
    expect(features({})).toEqual({ cloud: true });
  });
});

describe("the routes it gates", () => {
  it("answers 404 for sync, telemetry and feedback, and says it on health", async () => {
    const { call } = appOf(CLOUD_OFF);
    expect((await call("GET", "/api/health")).body).toMatchObject({ ok: true, features: { cloud: false } });
    expect((await call("GET", "/api/sync")).status).toBe(404);
    expect((await call("POST", "/api/sync/pair", { server: "https://sync.example", code: "x" })).status).toBe(404);
    expect((await call("POST", "/api/sync/now", {})).status).toBe(404);
    expect((await call("GET", "/api/telemetry")).status).toBe(404);
    expect((await call("PUT", "/api/telemetry", { enabled: true })).status).toBe(404);
    expect((await call("POST", "/api/telemetry/events", { events: [] })).status).toBe(404);
    expect((await call("GET", "/api/feedback")).status).toBe(404);
    expect((await call("POST", "/api/feedback", { kind: "bug", text: "x" })).status).toBe(404);
    /* The routes that are not about a server answer as before. */
    expect((await call("GET", "/api/vaults")).status).toBe(200);
  });

  it("says on for a build that says on, and brings the routes back", async () => {
    const { call } = appOf({});
    expect((await call("GET", "/api/health")).body).toMatchObject({ features: { cloud: true } });
    expect((await call("GET", "/api/telemetry")).status).toBe(200);
    expect((await call("PUT", "/api/telemetry", { enabled: null })).status).toBe(200);
    expect((await call("GET", "/api/feedback")).status).toBe(200);
  });

  it("records no route.timing and holds nothing while it is off", async () => {
    const on = new Telemetry(env.home, "0.3.0", {});
    on.setConsent(true);
    expect(on.consent()).toBe(true);
    /* An answer somebody gave is the install's, in the home — nothing under the switch deletes it. */
    const { call, session } = appOf(CLOUD_OFF);
    expect(session.telemetry.consent()).toBe(true);
    await call("GET", `/__board/list?vault=${env.vault.id}`);
    await call("POST", `/api/telemetry/events?vault=${env.vault.id}`, {
      events: [{ name: "feature.use", props: { what: "x" } }],
    });
    expect(session.telemetry.take()).toBeNull();
    expect(session.telemetry.destination()).toBeNull();
  });
});

describe("where a batch goes", () => {
  it("is nowhere when the switch is off, whatever an address or a pairing says", () => {
    /* The address a release bakes in for logs and feedback is `ANYDAG_LOGS_URL`'s own half of the
       resolver: a build that baked one and says the switch off must never read it. */
    const dir = path.join(env.homeDir, "sync", env.vault.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, "pair.json"), JSON.stringify({ server: "https://sync.example", token: "x" }));
    const t = new Telemetry(env.home, "0.3.0", { ...CLOUD_OFF, ANYDAG_LOGS_URL: "https://logs.example/v1/logs" });
    expect(t.destination()).toBeNull();
    /* The override says on: the same build contacts only what the environment then names. */
    expect(new Telemetry(env.home, "0.3.0", { ANYDAG_CLOUD: "on" }).destination()).toBe("https://sync.example/v1/logs");
    expect(new Telemetry(env.home, "0.3.0", {}).destination()).toBe("https://sync.example/v1/logs");
  });

  it("sends nothing while it is off, whatever the stored answer says", async () => {
    const first = new Telemetry(env.home, "0.3.0", {});
    first.setConsent(true);
    const sent: string[] = [];
    const fake = (async (to: string) => {
      sent.push(to);
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch;
    const off = new Telemetry(env.home, "0.3.0", { ...CLOUD_OFF, ANYDAG_LOGS_URL: "https://logs.example" }, fake);
    off.event("feature.use", { what: "search" });
    off.routeDone("GET /__board/list", 200, 1);
    off.fail(new Error("boom"));
    await off.flush();
    off.start();
    expect(sent).toEqual([]);
    expect(off.take()).toBeNull();
    /* And on, by the same hand, the batch goes. */
    const back = new Telemetry(env.home, "0.3.0", { ANYDAG_CLOUD: "on", ANYDAG_LOGS_URL: "https://logs.example" }, fake);
    back.event("feature.use", { what: "search" });
    await back.flush();
    expect(sent).toEqual(["https://logs.example/v1/logs"]);
  });
});

describe("the sync loop", () => {
  it("starts none for a vault that is linked, whatever it is linked with", async () => {
    const dir = path.join(env.homeDir, "sync", env.vault.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, "key"), "a key nobody should read");
    fs.writeFileSync(path.join(dir, "pair.json"), JSON.stringify({ server: "https://sync.example", token: "x" }));
    const links = new SyncLinks(env.homeDir, CLOUD_OFF);
    const start = vi.spyOn(links, "start").mockResolvedValue(null);
    links.opened(env.vault);
    expect(start).not.toHaveBeenCalled();
    expect(links.get(env.vault.id)).toBeUndefined();
    /* The link is untouched: the files it stays linked by are all there. */
    expect(links.linked(env.vault.id)).toBe(true);
  });

  it("starts on when the override says on", async () => {
    const dir = path.join(env.homeDir, "sync", env.vault.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, "key"), "a key nobody should read");
    fs.writeFileSync(path.join(dir, "pair.json"), JSON.stringify({ server: "https://sync.example", token: "x" }));
    const links = new SyncLinks(env.homeDir, { ANYDAG_CLOUD: "on" });
    const start = vi.spyOn(links, "start").mockResolvedValue(null);
    links.opened(env.vault);
    /* The loop's own start is the loop tests'. What the contrast pins is that the switch is the only
       difference: off above, an attempt here. */
    expect(start).toHaveBeenCalledWith(env.vault);
  });
});

describe("the MCP tool list", () => {
  it("leaves out the sync and feedback tools when the switch is off, and lists no more when it is on", () => {
    const on = listTools(true).map((t) => t.name);
    const off = listTools(false).map((t) => t.name);
    expect(on).toEqual(TOOLS.map((t) => t.name));
    expect(on).toContain("sync_status");
    expect(on).toContain("sync_now");
    expect(off).not.toContain("sync_status");
    expect(off).not.toContain("sync_now");
    expect(on).toContain("feedback");
    expect(off).not.toContain("feedback");
    expect(off).toContain("board_read");
  });

  it("holds a chat's tools to the same switch", () => {
    expect(chatTools(true).map((t) => t.name)).toContain("feedback");
    expect(chatTools(false).map((t) => t.name)).not.toContain("feedback");
  });
});

describe("the CLI", () => {
  function io(): { io: Io; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: {
        out: (l) => out.push(l),
        err: (l) => err.push(l),
        write: () => {},
        stdinIsTTY: false,
        stdoutIsTTY: false,
        readStdin: async () => "",
        ask: async () => "",
      },
    };
  }
  const never = (async () => {
    throw new Error("a gated command must not reach a server");
  }) as never;

  it("answers a gated command with the one line, and leaves it out of help, when the switch is off", async () => {
    const r = io();
    expect(await main(["sync", "status"], r.io, CLOUD_OFF, never)).toBe(EXIT.failed);
    expect(r.err).toEqual([`anydag sync: ${CLOUD_OFF_LINE}`]);
    expect(await main(["--vault", "/tmp/x", "telemetry"], r.io, CLOUD_OFF, never)).toBe(EXIT.failed);
    const help = io();
    expect(await main(["--help"], help.io, CLOUD_OFF, never)).toBe(EXIT.ok);
    expect(help.out.join("\n")).not.toMatch(/\bsync status\b|\btelemetry\b/);
  });

  it("lists them when it is on", async () => {
    const help = io();
    expect(await main(["--help"], help.io, { ANYDAG_CLOUD: "on" }, never)).toBe(EXIT.ok);
    expect(help.out.join("\n")).toMatch(/\bsync status\b/);
  });
});
