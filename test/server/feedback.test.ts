/**
 * Feedback on the app's side: `/api/feedback` forwards to the relay, and the relay here is the real
 * one (`sync/server/app.ts`) with a fake GitHub behind it — so what this route sends is what the
 * relay reads, and what it answers is what the page gets, which `test/fixtures/feedback.json`
 * records for the browser suite to stand in with.
 */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { feedbackDestination, feedbackEndpoint } from "../../server/feedback";
import { harness, type Harness } from "../../sync/test/helpers";
import { BOARD, makeEnv, NOTE, sweepTemps, write, type Env } from "./helpers";

const FIXTURE = path.join(import.meta.dirname, "..", "fixtures", "feedback.json");
const recorded = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as {
  get: unknown;
  post: unknown;
  failed: { status: number; body: unknown };
};

const ISSUE = "https://github.com/mouhcineToumi/anydag/issues/4242";
const RELAY = "https://relay.test";

let env: Env;
let relay: Harness | null = null;
let issues: { title: string; body: string; labels: string[] }[] = [];
let uploads: string[] = [];

/** GitHub as the relay sees it: the repository, an upload, an issue. */
const github = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/repos/mouhcineToumi/anydag")) return Response.json({ id: 1 });
  if (url.startsWith("https://uploads.github.com/")) {
    if (url.includes("name=broken")) return Response.json({ message: "Server Error" }, { status: 500 });
    uploads.push(new URL(url).searchParams.get("name")!);
    return Response.json({ href: `https://github.com/user-attachments/assets/${uploads.length}` }, { status: 201 });
  }
  if (url.endsWith("/issues")) {
    issues.push(JSON.parse(String(init?.body)));
    return Response.json({ html_url: ISSUE }, { status: 201 });
  }
  return Response.json({}, { status: 404 });
}) as typeof fetch;

/** The app's server reaching the relay: its own `fetch`, answered by the relay app in this process. */
const toRelay = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  expect(url.origin).toBe(RELAY);
  return relay!.app.request(url.pathname, init);
}) as typeof fetch;

beforeEach(async () => {
  env = makeEnv();
  issues = [];
  uploads = [];
});
afterEach(async () => {
  await relay?.close();
  relay = null;
  await env.cleanup();
  sweepTemps();
});

async function appOf(vars: NodeJS.ProcessEnv) {
  const session = new Session(env.home, env.vault, "0.3.0", vars);
  const app = createApp({ session, token: "t", page: null, fetch: toRelay });
  return async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(`http://127.0.0.1${url}`, {
      method,
      headers: { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
}

describe("/api/feedback", () => {
  it("says where it goes and what it carries about this machine", async () => {
    const call = await appOf({ ANYDAG_FEEDBACK_URL: RELAY });
    const got = await call("GET", "/api/feedback");
    expect(got.body).toEqual({ destination: "relay.test", env: { version: "0.3.0", os: process.platform, arch: process.arch } });
    /* The browser suite's stand-in has this answer's shape. */
    expect(Object.keys(recorded.get as object).sort()).toEqual(Object.keys(got.body).sort());
    expect((await (await appOf({}))("GET", "/api/feedback")).body.destination).toBeNull();
  });

  it("sends the text, the files and each ticked board and note through the relay, and answers the issue", async () => {
    relay = await harness("pglite", { ANYDAG_FEEDBACK_GITHUB_TOKEN: "github_pat_test" }, { fetch: github });
    write(env.root, "work/plan.board.md", BOARD);
    write(env.root, "diary.md", NOTE);
    const call = await appOf({ ANYDAG_FEEDBACK_URL: RELAY });
    const got = await call("POST", "/api/feedback", {
      kind: "bug",
      text: "Tidy loses the arrows",
      boards: ["work/plan"],
      notes: ["diary"],
      files: [{ name: "shot.png", type: "image/png", data: Buffer.from("png").toString("base64") }],
    });
    expect(got).toEqual({ status: 201, body: recorded.post });
    expect(uploads).toEqual(["shot.png"]);
    expect(issues).toHaveLength(1);
    const body = issues[0]!.body;
    expect(issues[0]!.labels).toEqual(["status: triage", "type: bug", "feedback"]);
    expect(body).toContain("![shot.png](https://github.com/user-attachments/assets/1)");
    /* The board by its own name, not the folder it is in, and its whole text. */
    expect(body).toContain("<summary>Board: plan.board.md</summary>");
    expect(body).not.toContain("work/plan");
    expect(body).toContain(BOARD.trimEnd());
    expect(body).toContain("<summary>Note: diary.note.md</summary>");
    expect(body).toContain(`AnyDag 0.3.0 · ${process.platform} · ${process.arch}`);
  });

  it("answers a failed upload with the relay's sentence, and makes no issue", async () => {
    relay = await harness("pglite", { ANYDAG_FEEDBACK_GITHUB_TOKEN: "github_pat_test" }, { fetch: github });
    const call = await appOf({ ANYDAG_FEEDBACK_URL: RELAY });
    const got = await call("POST", "/api/feedback", {
      kind: "bug",
      text: "x",
      files: [{ name: "broken.png", type: "image/png", data: Buffer.from("png").toString("base64") }],
    });
    /* What the browser suite stands in with when it checks that a failed send keeps the draft. */
    expect(got).toEqual(recorded.failed);
    expect(issues).toEqual([]);
  });

  it("hands back the relay's refusal, and refuses itself what it cannot read", async () => {
    relay = await harness("pglite", {}, { fetch: github });
    const call = await appOf({ ANYDAG_FEEDBACK_URL: RELAY });
    const no = await call("POST", "/api/feedback", { kind: "bug", text: "x" });
    expect(no.status).toBe(503);
    expect(no.body).toMatchObject({ code: "ES_UNAVAILABLE", error: expect.stringContaining("feedback not available") });
    expect((await call("POST", "/api/feedback", { kind: "bug", text: "x", boards: ["nowhere"] })).status).toBe(404);
    expect((await call("POST", "/api/feedback", { kind: "rant", text: "x" })).status).toBe(400);
    const exe = await call("POST", "/api/feedback", {
      kind: "bug",
      text: "x",
      files: [{ name: "a.exe", type: "application/x-msdownload", data: "" }],
    });
    expect(exe.status).toBe(400);
    expect(String(exe.body.error)).toContain("`a.exe` is not");
    expect(issues).toEqual([]);
  });

  it("is not available with no relay set", async () => {
    const call = await appOf({});
    expect((await call("POST", "/api/feedback", { kind: "idea", text: "x" })).body).toMatchObject({ code: "ES_UNAVAILABLE" });
  });
});

describe("where feedback goes", () => {
  it("is the address set, else nowhere — never a paired sync server", () => {
    expect(feedbackEndpoint("https://sync.example/")).toBe("https://sync.example/v1/feedback");
    expect(feedbackEndpoint("https://sync.example/v1/feedback")).toBe("https://sync.example/v1/feedback");
    expect(feedbackEndpoint("sync.example")).toBeNull();
    expect(feedbackDestination({ ANYDAG_FEEDBACK_URL: "off" })).toBeNull();
    expect(feedbackDestination({})).toBeNull();
  });
});
