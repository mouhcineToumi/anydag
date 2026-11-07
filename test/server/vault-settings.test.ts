/** A vault's preferences are `/api/vault/settings`, and writing them re-reads what the vault does with them. */
import "./sqlite-shim";
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

describe("/api/vault/settings", () => {
  it("is null until written, is the vault's own file, and moves the attachments folder when it is written", async () => {
    const session = new Session(env.home, env.vault, "test");
    const app = createApp({ session, token: "t", page: null });
    const call = (method: string, body?: unknown) =>
      app.request(`http://127.0.0.1/api/vault/settings?vault=${env.vault.id}`, {
        method,
        headers: { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    expect(await (await call("GET")).json()).toEqual({ settings: null });
    expect(env.vault.attachments).toBe("attachments");

    const put = await call("PUT", { settings: { "dag:attachments": "/files/" } });
    expect(put.status).toBe(200);
    expect(env.vault.attachments).toBe("files");
    expect((await (await call("GET")).json()).settings).toEqual({ "dag:attachments": "/files/" });

    await call("PUT", { settings: {} });
    expect(env.vault.attachments).toBe("attachments");
  });

  it("is gone from the old address", async () => {
    const app = createApp({ session: new Session(env.home, env.vault, "test"), token: "t", page: null });
    for (const at of ["/api/workspaces/settings", "/api/workspaces"]) {
      const res = await app.request(`http://127.0.0.1${at}`, { headers: { "x-anydag-token": "t", host: "127.0.0.1" } });
      expect(res.status).toBe(404);
    }
  });
});
