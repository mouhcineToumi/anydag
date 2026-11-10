import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";

/**
 * `npm run dev` is a page on this machine, and its proxy holds the vault's token.
 *
 * The dev server serves its own root, and the app home (`.dev-home/`), each vault's `.anydag/`
 * and the repository's credential dot-folders all sit inside it. The proxy adds the token the
 * server asks for, so an origin that is not this page must be refused before that header is made.
 * The test starts the real config on a fixture root — nothing under this repository is read or
 * written — and asks for the files and the requests the audit used.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.resolve(HERE, "..", "vite.config.ts");
const SECRET = "home-secret-do-not-serve";

interface Answer {
  status: number;
  body: string;
}

/** A request with every header written by hand: `fetch` will not let a test spell `Host`. */
function ask(port: number, url: string, headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: url, method: "GET", headers, setHost: !("Host" in headers) },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("the dev server", () => {
  let root = "";
  let vite: ViteDevServer;
  let port = 0;
  let api: http.Server;
  const seen: Array<{ url: string; token: string | undefined }> = [];
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-dev-server-"));
    const write = (name: string, text: string) => {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    };
    write(".dev-home/home.secret", SECRET);
    write(".dev-home/server.json", JSON.stringify({ port: 3601, token: "a-running-server" }));
    write(".dev-home/sync/vault/pair.json", JSON.stringify({ device: "do-not-serve" }));
    write("boards/local/.anydag/chats/c1/chat.json", JSON.stringify({ title: "do-not-serve" }));
    write(".git/config", "[remote]\n\turl = do-not-serve\n");
    write(".claude/settings.local.json", JSON.stringify({ token: "do-not-serve" }));
    write("index.html", "<!doctype html><title>fixture</title>");

    /* The proxy's target: a fake API that records the token it was handed. The real config reads
       both variables when it is loaded, which is why they are set before `createServer()`. */
    api = http.createServer((req, res) => {
      seen.push({ url: req.url ?? "", token: req.headers["x-anydag-token"] as string | undefined });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, from: "fixture" }));
    });
    const apiPort = await listen(api);

    for (const key of ["ANYDAG_DEV_HOST", "ANYDAG_PORT", "ANYDAG_API_PORT", "ANYDAG_TOKEN"]) saved[key] = process.env[key];
    delete process.env.ANYDAG_DEV_HOST;
    delete process.env.ANYDAG_PORT;
    process.env.ANYDAG_API_PORT = String(apiPort);
    process.env.ANYDAG_TOKEN = "test-run-token";

    vite = await createServer({
      configFile: CONFIG,
      root,
      cacheDir: path.join(root, ".vite"),
      logLevel: "silent",
      /* Nothing is imported from the fixture, so the dependency scan has nothing to find. */
      optimizeDeps: { noDiscovery: true },
      /* 0 asks the system for a free port; the config's host is left alone, which is the point. */
      server: { port: 0 },
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    port = typeof address === "object" && address ? address.port : 0;
  }, 60_000);

  afterAll(async () => {
    await vite?.close();
    if (api) await close(api);
    if (root) fs.rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("listens on loopback unless ANYDAG_DEV_HOST says otherwise", () => {
    const address = vite.httpServer?.address();
    expect(typeof address).toBe("object");
    expect(address && typeof address === "object" ? address.address : "").toBe("127.0.0.1");
    expect(vite.config.server.host).toBe("127.0.0.1");
  });

  it("does not serve the app home", async () => {
    for (const url of [
      "/.dev-home/home.secret",
      "/.dev-home/home.secret?raw",
      "/%2Edev-home/home.secret",
      `/@fs${path.join(root, ".dev-home/home.secret")}`,
      "/.dev-home/sync/vault/pair.json",
    ]) {
      const got = await ask(port, url, { Host: `localhost:${port}` });
      expect(got.status, url).toBe(403);
      expect(got.body, url).not.toContain(SECRET);
    }
  });

  it("does not serve a vault's .anydag state or the repository's dot-folders", async () => {
    for (const url of [
      "/boards/local/.anydag/chats/c1/chat.json",
      "/boards/local/%2Eanydag/chats/c1/chat.json",
      "/.git/config",
      "/.claude/settings.local.json",
    ]) {
      const got = await ask(port, url, { Host: `localhost:${port}` });
      expect(got.status, url).toBe(403);
      expect(got.body, url).not.toContain("do-not-serve");
    }
  });

  it("adds the token to this page's own request", async () => {
    seen.length = 0;
    const got = await ask(port, "/api/health", {
      Host: `localhost:${port}`,
      Origin: `http://localhost:${port}`,
      "Sec-Fetch-Site": "same-origin",
    });
    expect(got.status).toBe(200);
    expect(got.body).toContain("fixture");
    expect(seen).toEqual([{ url: "/api/health", token: "test-run-token" }]);
  });

  it("refuses a foreign origin before the token is attached", async () => {
    seen.length = 0;
    for (const origin of [`http://127.0.0.1:${port}`, "https://evil.example", "null"]) {
      const got = await ask(port, "/api/health", {
        Host: `localhost:${port}`,
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
      });
      expect(got.status, origin).toBe(403);
    }
    expect(seen).toEqual([]);
  });

  it("refuses a cross-site or same-site request before the token is attached", async () => {
    seen.length = 0;
    for (const site of ["cross-site", "same-site"]) {
      const got = await ask(port, "/__board/list", {
        Host: `localhost:${port}`,
        Origin: `http://localhost:${port}`,
        "Sec-Fetch-Site": site,
      });
      expect(got.status, site).toBe(403);
    }
    expect(seen).toEqual([]);
  });

  it("refuses a Host that is not this machine's", async () => {
    seen.length = 0;
    for (const host of ["192.168.1.50:" + port, "rebind.evil.example:" + port, ""]) {
      const got = await ask(port, "/api/health", host ? { Host: host } : { Host: "" });
      expect(got.status, host || "no host").toBe(403);
    }
    expect(seen).toEqual([]);
  });
});
