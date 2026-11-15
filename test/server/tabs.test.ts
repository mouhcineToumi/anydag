/** The window's document tabs are `/api/tabs`: the app home's, per vault, never the vault's (#264). */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { makeEnv, sweepTemps, type Env } from "./helpers";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

const SAVED = { list: [{ id: "t0123456789ab", place: "note=ideas", doc: "abc123" }], active: "t0123456789ab" };

describe("/api/tabs", () => {
  const call = (method: string, body?: unknown) => {
    const app = createApp({ session: new Session(env.home, env.vault, "test"), token: "t", page: null });
    return app.request(`http://127.0.0.1/api/tabs?vault=${env.vault.id}`, {
      method,
      headers: { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };

  it("is null until written, gives back what was written, and forgets on null", async () => {
    expect(await (await call("GET")).json()).toEqual({ tabs: null });
    expect((await call("PUT", { tabs: SAVED })).status).toBe(200);
    expect(await (await call("GET")).json()).toEqual({ tabs: SAVED });
    expect((await call("PUT", { tabs: null })).status).toBe(200);
    expect(await (await call("GET")).json()).toEqual({ tabs: null });
  });

  it("is kept in the app's home, and writes not a byte of the vault", async () => {
    const before = fs.readdirSync(env.vault.root, { recursive: true }).sort();
    await call("PUT", { tabs: SAVED });
    expect(fs.readdirSync(env.vault.root, { recursive: true }).sort()).toEqual(before);
    expect(env.home.get(`tabs:${env.vault.id}`)).toBe(JSON.stringify(SAVED));
    expect(fs.existsSync(path.join(env.vault.root, ".anydag", "tabs.json"))).toBe(false);
  });

  it("refuses what is not an object, and a set too large to be tabs", async () => {
    expect((await call("PUT", { tabs: [] })).status).toBe(400);
    expect((await call("PUT", { tabs: "x" })).status).toBe(400);
    expect((await call("PUT", { tabs: { list: [], pad: "x".repeat(70_000) } })).status).toBe(413);
  });

  it("follows the vault when it takes another id", async () => {
    await call("PUT", { tabs: SAVED });
    env.home.rekeyVault(env.vault.id, "v-new");
    expect(env.home.get(`tabs:${env.vault.id}`)).toBeUndefined();
    expect(env.home.get("tabs:v-new")).toBe(JSON.stringify(SAVED));
  });
});
