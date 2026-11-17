/** How the Graph page was left is `/api/graph-view`: the app home's, per vault, never the vault's (#459). */
import "./sqlite-shim";
import fs from "node:fs";

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

const SAVED = {
  colourBy: "tag",
  groupBy: "links",
  rules: [{ field: "kind", hide: ["attachment"] }],
  orphans: false,
  forces: { repel: 0.2, link: 0, pull: 0, centre: 0, tight: 0.5, gap: 0.3 },
};

describe("/api/graph-view", () => {
  const call = (method: string, body?: unknown) => {
    const app = createApp({ session: new Session(env.home, env.vault, "test"), token: "t", page: null });
    return app.request(`http://127.0.0.1/api/graph-view?vault=${env.vault.id}`, {
      method,
      headers: { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };

  it("is null until written, gives back what was written, and forgets on null", async () => {
    expect(await (await call("GET")).json()).toEqual({ view: null });
    expect((await call("PUT", { view: SAVED })).status).toBe(200);
    expect(await (await call("GET")).json()).toEqual({ view: SAVED });
    expect((await call("PUT", { view: null })).status).toBe(200);
    expect(await (await call("GET")).json()).toEqual({ view: null });
  });

  it("is kept in the app's home, and writes not a byte of the vault", async () => {
    const before = fs.readdirSync(env.vault.root, { recursive: true }).sort();
    await call("PUT", { view: SAVED });
    expect(fs.readdirSync(env.vault.root, { recursive: true }).sort()).toEqual(before);
    expect(env.home.get(`graph-view:${env.vault.id}`)).toBe(JSON.stringify(SAVED));
  });

  it("refuses what is not an object, and a view too large to be one", async () => {
    expect((await call("PUT", { view: [] })).status).toBe(400);
    expect((await call("PUT", { view: "x" })).status).toBe(400);
    expect((await call("PUT", { view: { pad: "x".repeat(40_000) } })).status).toBe(413);
  });

  it("follows the vault when it takes another id", async () => {
    await call("PUT", { view: SAVED });
    env.home.rekeyVault(env.vault.id, "v-new");
    expect(env.home.get(`graph-view:${env.vault.id}`)).toBeUndefined();
    expect(env.home.get("graph-view:v-new")).toBe(JSON.stringify(SAVED));
  });
});
