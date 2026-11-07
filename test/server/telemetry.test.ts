/** Logs on the app's server: the answer, the routes, what is held and where it goes. */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { endpointOf, Telemetry } from "../../server/telemetry";
import { makeEnv, sweepTemps, type Env } from "./helpers";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

const at = new Date().toISOString();

function appOf(vars: NodeJS.ProcessEnv = {}) {
  const session = new Session(env.home, env.vault, "0.1.0", vars);
  const app = createApp({ session, token: "t", page: null });
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app.request(`http://127.0.0.1${url}`, {
      method,
      headers: { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { session, call };
}

describe("/api/telemetry", () => {
  it("is never asked until somebody answers, and the answer is the home's", async () => {
    const { call } = appOf({ ANYDAG_LOGS_URL: "https://logs.example/" });
    expect((await call("GET", "/api/telemetry")).body).toEqual({ consent: null, destination: "logs.example" });
    expect((await call("PUT", "/api/telemetry", { enabled: true })).body.consent).toBe(true);
    expect(env.home.get("telemetry.install")).toMatch(/^[0-9a-f-]{36}$/);
    /* A new server on the same home reads it back. */
    expect((await appOf().call("GET", "/api/telemetry")).body.consent).toBe(true);
    expect((await call("PUT", "/api/telemetry", { enabled: false })).body.consent).toBe(false);
    expect(env.home.get("telemetry.install")).toBeUndefined();
    expect((await call("PUT", "/api/telemetry", { enabled: null })).body.consent).toBeNull();
    expect((await call("PUT", "/api/telemetry", { enabled: "yes" })).status).toBe(400);
  });

  it("keeps the page's events only on yes, each cleaned", async () => {
    const { session, call } = appOf();
    const events = [
      { name: "feature.use", at, props: { what: "tidy" } },
      { name: "feature.use", at, props: { what: "My secret board" } },
      { name: "note.text", at, props: { text: "hello" } },
    ];
    expect((await call("POST", "/api/telemetry/events", { events })).body).toEqual({ accepted: 0 });
    await call("PUT", "/api/telemetry", { enabled: true });
    expect((await call("POST", "/api/telemetry/events", { events })).body).toEqual({ accepted: 1 });
    const batch = session.telemetry.take();
    expect(batch?.events.map((e) => e.name)).toContain("feature.use");
    expect(JSON.stringify(batch)).not.toContain("secret");
    expect(batch?.env.install).toBe(env.home.get("telemetry.install"));
  });

  it("sums how each route answered, by its template and never its query", async () => {
    const { session, call } = appOf();
    await call("PUT", "/api/telemetry", { enabled: true });
    await call("GET", `/__board/list?vault=${env.vault.id}`);
    await call("GET", `/__board/get?name=Private%20diary&vault=${env.vault.id}`);
    const timing = session.telemetry.take()?.events.filter((e) => e.name === "route.timing") ?? [];
    const routes = timing.map((e) => e.props.route);
    expect(routes).toContain("GET /__board/list");
    expect(routes).toContain("GET /__board/get");
    expect(JSON.stringify(timing)).not.toContain("diary");
  });

  it("measures nothing for an install that said no", async () => {
    const { session, call } = appOf();
    await call("PUT", "/api/telemetry", { enabled: false });
    await call("GET", `/__board/list?vault=${env.vault.id}`);
    session.telemetry.fail(new Error("boom"));
    expect(session.telemetry.take()).toBeNull();
  });
});

describe("where logs go", () => {
  it("is ANYDAG_LOGS_URL, else a paired sync server, else nowhere", () => {
    const t = (vars: NodeJS.ProcessEnv) => new Telemetry(env.home, "0.1.0", vars);
    expect(t({}).destination()).toBeNull();
    const dir = path.join(env.homeDir, "sync", "v1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pair.json"), JSON.stringify({ server: "https://sync.example:8790", token: "x" }));
    expect(t({}).destination()).toBe("https://sync.example:8790/v1/logs");
    expect(t({ ANYDAG_LOGS_URL: "http://127.0.0.1:9/v1/logs" }).destination()).toBe("http://127.0.0.1:9/v1/logs");
    expect(t({ ANYDAG_LOGS_URL: "off" }).destination()).toBeNull();
    expect(endpointOf("not a url")).toBeNull();
  });

  it("posts one batch with the install's env, and drops it when there is nowhere to send", async () => {
    const sent: { url: string; body: unknown }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch;
    const t = new Telemetry(env.home, "0.1.0", { ANYDAG_LOGS_URL: "https://logs.example" }, fake);
    t.setConsent(true);
    t.event("feature.use", { what: "search" });
    await t.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://logs.example/v1/logs");
    expect(sent[0]!.body).toMatchObject({
      v: 1,
      env: { version: "0.1.0", install: env.home.get("telemetry.install") },
      events: [{ name: "feature.use" }],
    });

    const nowhere = new Telemetry(env.home, "0.1.0", { ANYDAG_LOGS_URL: "off" }, fake);
    nowhere.event("feature.use", { what: "search" });
    await nowhere.flush();
    expect(sent).toHaveLength(1);
    expect(nowhere.take()).toBeNull();
  });
});
