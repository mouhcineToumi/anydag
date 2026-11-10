import fs from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { call, harness, type Harness } from "./helpers";

/**
 * The routes every kind of caller needs: `GET /v1`, `GET /v1/ready`, what an `off` feature answers,
 * and the client address the rate limiter reads — the proxy's word only when configured to.
 */

const INSTALL = "0f8fad5b-d9cb-469f-a165-70867728950e";
const env = { version: "0.1.0", shell: "browser", os: "linux", arch: "x64", locale: "en", install: INSTALL };
const batch = { v: 1, env, events: [{ name: "feature.use", at: "2026-11-06T11:59:00Z", props: { what: "tidy" } }] };

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const accepted = async (headers: Record<string, string> = {}): Promise<number> => {
  const res = await call(h!, "POST", "/v1/logs", { json: batch, headers });
  if (res.status !== 202) return -1;
  return ((await res.json()) as { accepted: number }).accepted;
};

describe("GET /v1", () => {
  it("tells what runs: name, version and the three features", async () => {
    h = await harness("pglite", { ANYDAG_API_FEEDBACK: "on" });
    const res = await call(h, "GET", "/v1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "anydag-api",
      version: "test",
      features: { sync: true, logs: true, feedback: false },
    });
  });

  it("reports a feature it is not configured for as absent, not merely switched on", async () => {
    h = await harness("pglite", {
      ANYDAG_API_FEEDBACK: "on",
      ANYDAG_API_FEEDBACK_GITHUB_TOKEN: "a-fake-feedback-token-value",
      ANYDAG_API_FEEDBACK_REPO: "owner/repo",
    });
    expect(((await (await call(h, "GET", "/v1")).json()) as { features: object }).features).toEqual({
      sync: true,
      logs: true,
      feedback: true,
    });
  });

  it("answers 404 for a feature that is off, before any token, and says so in /v1", async () => {
    h = await harness("pglite", { ANYDAG_API_SYNC: "off", ANYDAG_API_LOGS: "off", ANYDAG_API_FEEDBACK: "off" });
    const info = (await (await call(h, "GET", "/v1")).json()) as {
      features: { sync: boolean; logs: boolean; feedback: boolean };
    };
    expect(info.features).toEqual({ sync: false, logs: false, feedback: false });
    /* Sync is off: pairing, the device routes, the admin routes and their metrics do not exist,
       and none of them starts a discovery with a 401. */
    expect((await call(h, "POST", "/v1/pair", { json: { code: "no", device: { name: "x", platform: "x" } } })).status).toBe(404);
    expect((await call(h, "GET", "/v1/vaults")).status).toBe(404);
    expect((await call(h, "GET", "/v1/admin/accounts")).status).toBe(404);
    expect((await call(h, "GET", "/metrics")).status).toBe(404);
    expect((await call(h, "POST", "/v1/logs", { json: batch })).status).toBe(404);
    /* What is not a feature of the server is still the server. */
    expect((await call(h, "GET", "/v1/health")).status).toBe(200);
  });

  it("leaves one feature alive while another is off", async () => {
    /* Sync off, logs on: a log-only server runs with no sync surface at all. */
    h = await harness("pglite", { ANYDAG_API_SYNC: "off" });
    expect(await accepted()).toBe(1);
    expect(((await (await call(h, "GET", "/v1")).json()) as { features: object }).features).toEqual({
      sync: false,
      logs: true,
      feedback: false,
    });
  });

  it("keeps feedback when sync is off: the relay is its own feature, open and token-free", async () => {
    h = await harness("pglite", {
      ANYDAG_API_SYNC: "off",
      ANYDAG_API_FEEDBACK_GITHUB_TOKEN: "github_pat_for_the_tests",
      ANYDAG_API_FEEDBACK_REPO: "owner/repo",
    });
    /* A body the relay refuses before it asks GitHub: a 400 is the route answering, not sync's 404 or a 401. */
    const res = await call(h, "POST", "/v1/feedback", { protocol: null, json: {} });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("ES_BAD_REQUEST");
  });
});

describe("/v1/ready", () => {
  it("confirms the database answers", async () => {
    h = await harness("pglite");
    const res = await call(h, "GET", "/v1/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers a probe and a discovery that say no sync protocol", async () => {
    h = await harness("pglite");
    expect((await call(h, "GET", "/v1/ready", { protocol: null })).status).toBe(200);
    expect((await call(h, "GET", "/v1", { protocol: null })).status).toBe(200);
  });

  it("answers 503, and nothing of the database's own words, when it does not", async () => {
    const t = await harness("pglite");
    try {
      await t.meta.close();
      const res = await call(t, "GET", "/v1/ready");
      expect(res.status).toBe(503);
      const body = await res.text();
      expect(JSON.parse(body)).toEqual({ ok: false });
      expect(body.toLowerCase()).not.toContain("postgres");
      expect(body.toLowerCase()).not.toContain("password");
    } finally {
      await t.close().catch(() => {});
      fs.rmSync(t.root, { recursive: true, force: true });
      h = null;
    }
  });
});

describe("the client address", () => {
  it("is the socket's, and a forged X-Forwarded-For opens no bucket, when no proxy is trusted", async () => {
    h = await harness("pglite");
    for (let i = 0; i < 30; i++) expect(await accepted()).toBe(1);
    /* The forgery would have been a first request in its own bucket, had the header been trusted. */
    expect(await accepted({ "x-forwarded-for": "203.0.113.77" })).toBe(0);
    expect(await accepted({ "x-forwarded-for": "203.0.113.77, 198.51.100.99" })).toBe(0);
    h.clock.advance(60_000);
    expect(await accepted()).toBe(1);
  });

  it("reads the last hop the trusted proxy added", async () => {
    h = await harness("pglite", { ANYDAG_API_TRUST_PROXY: "1" });
    /* The proxy appended the client's real address to whatever the sender claimed: the rightmost
       entry is who asked, so the same forged start is as many buckets as the proxy saw clients. */
    for (let i = 0; i < 30; i++) expect(await accepted({ "x-forwarded-for": "9.9.9.9, 198.51.100.7" })).toBe(1);
    expect(await accepted({ "x-forwarded-for": "9.9.9.9, 198.51.100.8" })).toBe(1);
    expect(await accepted({ "x-forwarded-for": "203.0.113.10" })).toBe(1);
  });

  it("answers from the socket when the header has fewer entries than the hops promise", async () => {
    h = await harness("pglite", { ANYDAG_API_TRUST_PROXY: "3" });
    for (let i = 0; i < 30; i++) expect(await accepted({ "x-forwarded-for": "9.9.9.9" })).toBe(1);
    /* One entry cannot name three hops: the header says nothing, the socket decides — so the
       31st request, forged or not, is over the same address's rate. */
    expect(await accepted()).toBe(0);
    expect(await accepted({ "x-forwarded-for": "9.9.9.9, 198.51.100.7" })).toBe(0);
  });
});
