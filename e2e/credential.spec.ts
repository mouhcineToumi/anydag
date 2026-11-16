import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "./fixture";

/**
 * #339, in a real browser: the credential `anydag serve` hands a browser must never reach another
 * port of `127.0.0.1`.
 *
 * Browsers do not isolate cookies by port, and every `http://127.0.0.1:<port>` is the same site, so
 * the cookie `anydag serve` used to set on `/` was sent to whoever listened on any other port — another
 * OS user on this machine — who could replay it as `x-anydag-token` and read and write every open
 * vault. The issue's table is reproduced here against a real `anydag serve` on a throwaway vault and
 * a listener on a second loopback port:
 *
 * 1. the address the server printed is opened, then the person types the listener's address;
 * 2. a page on another site (`localhost`) sends the tab to a landing page on the listener, which
 *    loads `<img src="/p.gif">` from itself — the request that *is* same-site, and carried the cookie.
 *
 * The listener must never see `anydag_token`. It **does** see a cookie the page sets on `/` in the
 * same run, so the check is one that would catch the leak, not one that passes because no cookie
 * travels at all. And the cookie still works where it is meant to: under the secret path.
 *
 * The page here is a stand-in — the suite builds no `dist/` — so this holds the server and the
 * browser to the contract; `test/secret.test.ts` holds the page's half (`src/vault/secret.ts`).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* Built by `npm run dev` (`scripts/dev.sh`), which the suite's web server runs. */
const SERVER = path.join(ROOT, "server", "dist", "anydag-server.mjs");

let tmp = "";
let serve: ChildProcess | null = null;
let printed = "";
let listener: http.Server | null = null;
let elsewhere: http.Server | null = null;
/** Every request the listener on the other port was sent: its path and its `Cookie` header. */
const seen: { path: string; cookie: string }[] = [];
let other = "";
let crossSite = "";

const listen = (server: http.Server, host: string) =>
  new Promise<number>((resolve) => server.listen(0, host, () => resolve((server.address() as AddressInfo).port)));

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-credential-"));
  const vault = path.join(tmp, "vault");
  const page = path.join(tmp, "page");
  fs.mkdirSync(vault);
  fs.mkdirSync(page);
  fs.writeFileSync(path.join(vault, "secret.md"), "# Secret\n\nNobody else reads this.\n");
  /* What the real page does at boot, and a cookie on `/` to prove a cookie can cross ports here. */
  fs.writeFileSync(
    path.join(page, "index.html"),
    `<!doctype html><title>stand-in</title><script>
      document.cookie = "probe=crosses; path=/; SameSite=Strict";
      const s = new URLSearchParams(location.hash.slice(1)).get("s");
      if (s) { localStorage.setItem("dag:path", s); history.replaceState(null, "", location.pathname + location.search); }
    </script>`,
  );

  /* The server, on its own home, so the dev server's `server.json` is never touched. */
  const { ANYDAG_TOKEN: _theDevServers, ...env } = process.env;
  serve = spawn(process.execPath, [SERVER, vault, "--page", page, "--port", "0"], {
    env: { ...env, ANYDAG_HOME: path.join(tmp, "home"), ANYDAG_CLOUD: "off" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  printed = await new Promise<string>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`anydag serve printed no address: ${out}`)), 30_000);
    serve!.stdout!.on("data", (b: Buffer) => {
      out += b.toString();
      const got = /open (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/.exec(out)?.[1];
      if (got) {
        clearTimeout(timer);
        resolve(got);
      }
    });
    serve!.on("exit", (code) => reject(new Error(`anydag serve exited ${code}: ${out}`)));
  });

  /* Another local user's listener, on a second loopback port. */
  listener = http.createServer((req, res) => {
    seen.push({ path: req.url ?? "", cookie: req.headers.cookie ?? "" });
    if (req.url?.startsWith("/landing")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<!doctype html><title>landing</title><img src="/p.gif" alt="">');
    } else if (req.url?.startsWith("/p.gif")) {
      res.writeHead(200, { "content-type": "image/gif" });
      res.end(Buffer.from("R0lGODlhAQABAAAAACw=", "base64"));
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>typed</title>");
    }
  });
  other = `http://127.0.0.1:${await listen(listener, "127.0.0.1")}`;

  /* A page on another site that sends the tab to the listener: any link on any website could. */
  elsewhere = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><title>elsewhere</title><script>location.href = ${JSON.stringify(`${other}/landing`)};</script>`);
  });
  crossSite = `http://localhost:${await listen(elsewhere, "127.0.0.1")}`;
});

test.afterAll(async () => {
  serve?.kill();
  await new Promise<void>((resolve) => (listener ? listener.close(() => resolve()) : resolve()));
  await new Promise<void>((resolve) => (elsewhere ? elsewhere.close(() => resolve()) : resolve()));
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test("the anydag serve cookie never reaches another loopback port", async ({ page }) => {
  const origin = new URL(printed).origin;
  const token = new URL(printed).searchParams.get("token") ?? "";
  expect(token).not.toBe("");

  /* The address the server printed: a redirect, the cookie, and the secret path in the fragment. */
  await page.goto(printed);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dag:path"))).not.toBeNull();
  const secret = (await page.evaluate(() => localStorage.getItem("dag:path"))) ?? "";
  expect(page.url()).not.toContain(token);
  expect(page.url()).not.toContain(secret);

  /* The cookie is the page's credential under the secret path, and nothing at the root. */
  const asked = await page.evaluate(
    async ([s]) => ({
      under: (await fetch(`/s/${s}/__board/get?name=secret&kind=note`)).status,
      root: (await fetch("/__board/get?name=secret&kind=note")).status,
    }),
    [secret],
  );
  expect(asked).toEqual({ under: 200, root: 401 });

  /* 1. The person types another port's address. */
  await page.goto(`${other}/typed`);
  /* 2. A page on another site sends the tab to a landing page on that port, which loads an image from itself. */
  await page.goto(crossSite);
  await page.waitForURL(`${other}/landing`);
  await expect.poll(() => seen.some((r) => r.path.startsWith("/p.gif"))).toBe(true);

  const typed = seen.find((r) => r.path.startsWith("/typed"));
  const image = seen.find((r) => r.path.startsWith("/p.gif"));
  expect(typed).toBeDefined();
  /* The check can see a leak: a cookie on `/` of the other port does cross. */
  expect(typed!.cookie).toContain("probe=crosses");
  expect(image!.cookie).toContain("probe=crosses");
  for (const r of seen) {
    expect(r.cookie, `${r.path} was sent the token`).not.toContain("anydag_token");
    expect(r.cookie).not.toContain(token);
    expect(r.path).not.toContain(secret);
  }

  /* And what a listener could replay, it could not use: the cookie it would have needed is not the
     root's credential, and the header it would have replayed it as was never sent to it. */
  const replay = await fetch(`${origin}/__board/get?name=secret&kind=note`, { headers: { cookie: `anydag_token=${token}` } });
  expect(replay.status).toBe(401);
});
