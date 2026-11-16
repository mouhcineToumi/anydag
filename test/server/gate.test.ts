/**
 * The gate (`server/app.ts`): the `Host`, the token, and where a browser's cookie counts.
 *
 * A cookie is not bound to a port, and every `127.0.0.1` port is the same site, so the
 * `anydag_token` cookie `anydag serve` used to set on `/` was sent to whoever listened on any other
 * port of this machine, who could replay it (#339). Now the cookie's `Path` is a secret minted per
 * launch, `/s/<secret>/`, the API answers there with the cookie and at the root with the header only,
 * and the page learns the secret from the fragment of the address `/?token=` redirects to. A write the
 * cookie alone vouches for must still come from the page's own origin (#10, #336). These are the
 * request shapes Chromium sends.
 */
import "./sqlite-shim";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { makeEnv, sweepTemps, type Env } from "./helpers";

const HOST = "127.0.0.1:41000";
const TOKEN = "tttt";

let env: Env;
let session: Session;
let page: string;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  env = makeEnv();
  page = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-gate-page-"));
  fs.writeFileSync(path.join(page, "index.html"), "<!doctype html><title>AnyDag</title>");
  fs.mkdirSync(path.join(page, "assets"));
  fs.writeFileSync(path.join(page, "assets", "main.js"), "console.log(1)");
  session = new Session(env.home, env.vault, "test", { ANYDAG_CLOUD: "on" });
  app = createApp({ session, token: TOKEN, page });
});
afterEach(async () => {
  fs.rmSync(page, { recursive: true, force: true });
  await env.cleanup();
  sweepTemps();
});

const get = (route: string, headers: Record<string, string> = {}) =>
  app.request(`http://${HOST}${route}`, { headers: { host: HOST, ...headers } });

/** Open the address `anydag serve` printed: the redirect, its secret and its cookie. */
async function enter(route = "/?board=plan") {
  const join = route.includes("?") ? "&" : "?";
  const res = await get(`${route}${join}token=${TOKEN}`);
  const location = res.headers.get("location") ?? "";
  const secret = /#s=([A-Za-z0-9_-]+)$/.exec(location)?.[1] ?? "";
  const cookies = res.headers.getSetCookie();
  return { res, location, secret, cookies };
}

const create = (route: string, headers: Record<string, string>, name = "probe") =>
  app.request(`http://${HOST}${route}`, {
    method: "POST",
    headers: { host: HOST, "content-type": "text/plain;charset=UTF-8", ...headers },
    body: JSON.stringify({ name, kind: "note", text: `# ${name}\n` }),
  });
const written = (name = "probe") => fs.existsSync(path.join(env.root, `${name}.md`));

describe("/?token=", () => {
  it("redirects to the same address without the token, with the secret in the fragment", async () => {
    const { res, location, secret } = await enter("/?board=plan&view=1");
    expect(res.status).toBe(302);
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(location).toBe(`/?board=plan&view=1#s=${secret}`);
    expect(location).not.toContain(TOKEN);
  });

  it("sets the cookie on the secret path only, and takes an older one off /", async () => {
    const { secret, cookies } = await enter();
    const mine = cookies.find((c) => c.startsWith(`anydag_token=${TOKEN}`));
    expect(mine).toBeDefined();
    expect(mine).toContain(`Path=/s/${secret}/`);
    expect(mine).toContain("HttpOnly");
    expect(mine).toContain("SameSite=Strict");
    expect(cookies.some((c) => c.startsWith("anydag_token=;") && /Path=\/(;|$)/.test(c) && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.filter((c) => c.includes(`anydag_token=${TOKEN}`) && /Path=\/(;|$)/.test(c))).toEqual([]);
  });

  it("is refused with a wrong token, and hands out no secret", async () => {
    const res = await get("/?token=nope");
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("mints a secret per server", async () => {
    const first = (await enter()).secret;
    const other = createApp({ session, token: TOKEN, page });
    const res = await other.request(`http://${HOST}/?token=${TOKEN}`, { headers: { host: HOST } });
    expect(res.headers.get("location")).not.toContain(first);
  });
});

describe("the cookie", () => {
  it("is taken under the secret path", async () => {
    const { secret } = await enter();
    const res = await get(`/s/${secret}/__board/list`, { cookie: `anydag_token=${TOKEN}` });
    expect(res.status).toBe(200);
    const me = await get(`/s/${secret}/api/auth/me`, { cookie: `anydag_token=${TOKEN}` });
    expect(me.status).toBe(200);
  });

  it("is refused at the root, where only the header counts", async () => {
    for (const route of ["/__board/list", "/api/auth/me", "/api/health"]) {
      const res = await get(route, { cookie: `anydag_token=${TOKEN}` });
      expect(res.status).toBe(401);
      expect(((await res.json()) as { code: string }).code).toBe("token");
    }
  });

  it("is refused under the secret path with the wrong token", async () => {
    const { secret } = await enter();
    expect((await get(`/s/${secret}/__board/list`, { cookie: "anydag_token=wrong" })).status).toBe(401);
    expect((await get(`/s/${secret}/__board/list`)).status).toBe(401);
  });

  it("is refused under a wrong secret, with an answer that does not name the right one", async () => {
    const { secret } = await enter();
    for (const wrong of ["nope", secret.slice(0, -1), `${secret}x`, ""]) {
      const res = await get(`/s/${wrong}/__board/list`, { cookie: `anydag_token=${TOKEN}` });
      expect(res.status).toBe(401);
      expect(await res.text()).not.toContain(secret);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it("reaches only the API under the secret path, never the page", async () => {
    const { secret } = await enter();
    expect((await get(`/s/${secret}/`, { cookie: `anydag_token=${TOKEN}` })).status).toBe(401);
    expect((await get(`/s/${secret}/assets/main.js`, { cookie: `anydag_token=${TOKEN}` })).status).toBe(401);
  });
});

describe("a write with the cookie, under the secret path", () => {
  let at = "";
  beforeEach(async () => {
    at = `/s/${(await enter()).secret}/__board/create`;
  });

  it("is refused from a page on another 127.0.0.1 port", async () => {
    const res = await create(at, {
      cookie: `anydag_token=${TOKEN}`,
      origin: "http://127.0.0.1:8000",
      "sec-fetch-site": "same-site",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("origin");
    expect(written()).toBe(false);
  });

  it("is refused from another origin when the browser sends no Sec-Fetch-Site", async () => {
    const res = await create(at, { cookie: `anydag_token=${TOKEN}`, origin: "http://127.0.0.1:8000" });
    expect(res.status).toBe(403);
    expect(written()).toBe(false);
  });

  it("is refused when Sec-Fetch-Site says cross-site, whatever Origin says", async () => {
    const res = await create(at, { cookie: `anydag_token=${TOKEN}`, origin: `http://${HOST}`, "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
  });

  it("is taken from the page's own origin, and lands where the routes put it", async () => {
    const res = await create(at, { cookie: `anydag_token=${TOKEN}`, origin: `http://${HOST}`, "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(200);
    expect(written()).toBe(true);
  });

  it("is refused at the root, whatever origin it says it came from", async () => {
    const res = await create("/__board/create", {
      cookie: `anydag_token=${TOKEN}`,
      origin: `http://${HOST}`,
      "sec-fetch-site": "same-origin",
    });
    expect(res.status).toBe(401);
    expect(written()).toBe(false);
  });
});

describe("the header", () => {
  it("is taken at the root, and needs no origin: no page can send it", async () => {
    expect((await get("/__board/list", { "x-anydag-token": TOKEN })).status).toBe(200);
    const res = await create("/__board/create", {
      "x-anydag-token": TOKEN,
      origin: "http://127.0.0.1:8000",
      "sec-fetch-site": "same-site",
    });
    expect(res.status).toBe(200);
    expect(written()).toBe(true);
  });

  it("is refused at the root when it is wrong", async () => {
    expect((await get("/__board/list", { "x-anydag-token": "wrong" })).status).toBe(401);
  });
});

describe("the page", () => {
  it("is public: the shell and its assets hold nothing", async () => {
    const shell = await get("/?board=plan");
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("<title>AnyDag</title>");
    expect((await get("/assets/main.js")).status).toBe(200);
  });

  it("is never the API: every route still needs a credential", async () => {
    for (const route of [
      "/__board/list",
      "/__board/get?name=plan&kind=note",
      "/api/auth/me",
      "/api/vaults",
      "/__boardx",
      "/apix",
    ]) {
      expect((await get(route)).status).toBe(401);
    }
  });

  it("checks the Host before anything else", async () => {
    const res = await app.request("http://evil.example/?token=" + TOKEN, { headers: { host: "evil.example" } });
    expect(res.status).toBe(421);
    expect(res.headers.get("location")).toBeNull();
  });

  it("says no-referrer on every answer, so an address under the secret is never a Referer", async () => {
    const { secret } = await enter();
    const answers = [
      await get("/?board=plan"),
      await get(`/?token=${TOKEN}`),
      await get(`/s/${secret}/__board/list`, { cookie: `anydag_token=${TOKEN}` }),
      await get("/__board/list"),
    ];
    for (const res of answers) expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("the secret", () => {
  it("is in no answer's body, under the prefix or at the root", async () => {
    const { secret } = await enter();
    const cookie = `anydag_token=${TOKEN}`;
    const bodies = await Promise.all(
      [
        get(`/s/${secret}/__board/list`, { cookie }),
        get(`/s/${secret}/__board/nope`, { cookie }),
        get(`/s/${secret}/api/nope`, { cookie }),
        get(`/s/${secret}/__board/get?name=missing&kind=note`, { cookie }),
        get(`/s/${secret}/api/health`, { cookie }),
        get(`/s/${secret}/api/vaults`, { cookie }),
        get("/__board/list", { "x-anydag-token": TOKEN }),
      ].map(async (r) => (await r).text()),
    );
    for (const body of bodies) expect(body).not.toContain(secret);
    /* The routes saw the path they know, not the prefix. */
    expect(bodies[1]).toContain("no route GET /__board/nope");
  });

  it("is in no route the logs record", async () => {
    /* With no page, as behind Vite: the page's own `GET *` would be the last route matched. */
    app = createApp({ session, token: TOKEN, page: null });
    const { secret } = await enter();
    const cookie = `anydag_token=${TOKEN}`;
    const put = await app.request(`http://${HOST}/s/${secret}/api/telemetry`, {
      method: "PUT",
      headers: {
        host: HOST,
        cookie,
        "content-type": "application/json",
        origin: `http://${HOST}`,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ enabled: true }),
    });
    expect(put.status).toBe(200);
    await get(`/s/${secret}/__board/list?vault=${env.vault.id}`, { cookie });
    await get(`/s/${secret}/__board/nope`, { cookie });
    const batch = session.telemetry.take();
    const routes = (batch?.events ?? []).filter((e) => e.name === "route.timing").map((e) => e.props.route);
    expect(routes).toContain("GET /__board/list");
    expect(JSON.stringify(batch)).not.toContain(secret);
    expect(JSON.stringify(batch)).not.toContain("/s/");
  });
});
