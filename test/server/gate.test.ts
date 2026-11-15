/**
 * The gate (`server/app.ts`): the `Host`, the token, and — for a write the `anydag serve` cookie alone
 * vouches for — the page it came from. A cookie is not bound to a port, and every `127.0.0.1` port
 * is the same site, so `SameSite=Strict` let a page on another local port write into the vault with
 * a `text/plain` POST that needs no preflight (#10). These are the request shapes Chromium sends.
 */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { makeEnv, sweepTemps, type Env } from "./helpers";

let env: Env;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  env = makeEnv();
  app = createApp({ session: new Session(env.home, env.vault, "test", {}), token: "t", page: null });
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

const HOST = "127.0.0.1:41000";
const create = (headers: Record<string, string>, name = "probe") =>
  app.request(`http://${HOST}/__board/create`, {
    method: "POST",
    headers: { host: HOST, "content-type": "text/plain;charset=UTF-8", ...headers },
    body: JSON.stringify({ name, kind: "note", text: `# ${name}\n` }),
  });
const written = (name = "probe") => fs.existsSync(path.join(env.root, `${name}.md`));

describe("a write with the cookie", () => {
  it("is refused from a page on another 127.0.0.1 port", async () => {
    const res = await create({ cookie: "anydag_token=t", origin: "http://127.0.0.1:8000", "sec-fetch-site": "same-site" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("origin");
    expect(written()).toBe(false);
  });

  it("is refused from another origin when the browser sends no Sec-Fetch-Site", async () => {
    const res = await create({ cookie: "anydag_token=t", origin: "http://127.0.0.1:8000" });
    expect(res.status).toBe(403);
    expect(written()).toBe(false);
  });

  it("is refused when Sec-Fetch-Site says cross-site, whatever Origin says", async () => {
    const res = await create({ cookie: "anydag_token=t", origin: `http://${HOST}`, "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
  });

  it("is taken from the page's own origin", async () => {
    const res = await create({ cookie: "anydag_token=t", origin: `http://${HOST}`, "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(200);
    expect(written()).toBe(true);
  });

  it("is taken from a client that is not a browser on a page", async () => {
    expect((await create({ cookie: "anydag_token=t" })).status).toBe(200);
  });

  it("still needs the right token", async () => {
    const res = await create({ cookie: "anydag_token=wrong", origin: `http://${HOST}`, "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(401);
  });
});

describe("the header", () => {
  it("is a credential no page can send, so it needs no origin", async () => {
    const res = await create({ "x-anydag-token": "t", origin: "http://127.0.0.1:8000", "sec-fetch-site": "same-site" });
    expect(res.status).toBe(200);
  });
});

describe("a read with the cookie", () => {
  it("is taken from another port: the page that sent it cannot read the answer", async () => {
    const res = await app.request(`http://${HOST}/__board/list`, {
      headers: { host: HOST, cookie: "anydag_token=t", "sec-fetch-site": "same-site" },
    });
    expect(res.status).toBe(200);
  });
});
