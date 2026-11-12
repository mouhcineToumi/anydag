/**
 * `POST /__board/llm/test` and `GET /__board/llm?fresh=1` (#182): Settings' *Save and test* and
 * *Check again*. Nothing here reaches a model: the environment has no key and no CLI on its path.
 */
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

/* No PATH and an empty home: a Claude Code on the machine running the suite must not answer. */
const BARE = { PATH: "", HOME: "/nonexistent-home" };

async function call(method: "GET" | "POST", route: string, body?: unknown) {
  const app = createApp({ session: new Session(env.home, env.vault, "test", BARE), token: "t", page: null });
  const res = await app.request(`http://127.0.0.1${route}${route.includes("?") ? "&" : "?"}vault=${env.vault.id}`, {
    method,
    headers: { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("/__board/llm/test", () => {
  it("names the provider it needs", async () => {
    const said = await call("POST", "/__board/llm/test", {});
    expect(said.status).toBe(400);
    expect(said.body.error).toContain("provider");
  });

  it("says why a provider cannot answer, before any call is made", async () => {
    const said = await call("POST", "/__board/llm/test", { provider: "gemini" });
    expect(said.status).toBe(400);
    expect(said.body.reason).toEqual({ code: "no-key", provider: "gemini", keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] });
  });

  it("needs an address before OpenAI-compatible can be tried", async () => {
    /* A model first, then the address: the row asks for them in that order too. */
    const bare = await call("POST", "/__board/llm/test", { provider: "custom" });
    expect((bare.body.reason as { code: string }).code).toBe("needs-model");
    const said = await call("POST", "/__board/llm/test", { provider: "custom", model: "local-model" });
    expect(said.status).toBe(400);
    expect((said.body.reason as { code: string }).code).toBe("needs-base-url");
  });
});

describe("/__board/llm", () => {
  it("lists each provider's key variables by name, and never a value", async () => {
    const said = await call("GET", "/__board/llm?fresh=1");
    expect(said.status).toBe(200);
    const providers = said.body.providers as { id: string; keyEnv: string[] }[];
    expect(providers.find((p) => p.id === "gemini")?.keyEnv).toEqual(["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
    expect(providers.find((p) => p.id === "claude")?.keyEnv).toEqual([]);
  });
});
