import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { portOfClaim, serverHasStarted } from "../desktop/launch";

/**
 * The shell's half of C2: a port is only ever adopted — and so only ever sent the live token —
 * when it is proven to be the child this launch spawned. `server.json` is shared with `anydag
 * serve`, so the stale file below is exactly what a closed terminal leaves behind.
 */

interface Watcher {
  port: number;
  /** The `x-anydag-token` of every request the listener saw. */
  tokens: (string | undefined)[];
  close(): Promise<void>;
}

const homes: string[] = [];
const watchers: Watcher[] = [];

afterEach(async () => {
  for (const watcher of watchers.splice(0)) await watcher.close();
  for (const dir of homes.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A loopback listener that answers 200 and remembers the token it was sent. */
async function watch(): Promise<Watcher> {
  const tokens: (string | undefined)[] = [];
  const server = http.createServer((req, res) => {
    tokens.push(req.headers["x-anydag-token"] as string | undefined);
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const watcher: Watcher = {
    port: (server.address() as AddressInfo).port,
    tokens,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  watchers.push(watcher);
  return watcher;
}

function homeWith(serverJson: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-launch-"));
  homes.push(dir);
  fs.writeFileSync(path.join(dir, "server.json"), JSON.stringify(serverJson));
  return dir;
}

const live = { pid: process.pid, token: "live-launch-token" };

describe("serverHasStarted", () => {
  it("ignores server.json from another pid, port and token — and sends that port nothing", async () => {
    const stale = await watch();
    const home = homeWith({ port: stale.port, pid: live.pid + 1, token: "stale-token" });
    const found = await serverHasStarted(new PassThrough(), { ...live, home, timeoutMs: 300, everyMs: 25 });
    expect(found).toBeNull();
    expect(stale.tokens).toEqual([]);
  });

  it("believes server.json when the pid and token are this launch's", async () => {
    const mine = await watch();
    const home = homeWith({ port: mine.port, pid: live.pid, token: live.token });
    const found = await serverHasStarted(new PassThrough(), { ...live, home, timeoutMs: 2_000, everyMs: 25 });
    expect(found).toBe(mine.port);
    expect(mine.tokens).toEqual([live.token]);
  });

  it("takes the port the child prints on stdout, whatever server.json says", async () => {
    const mine = await watch();
    const home = homeWith({ port: 1, pid: 1, token: "not-this-launch" });
    const stdout = new PassThrough();
    stdout.write(`open http://127.0.0.1:${mine.port}/?token=whatever\n`);
    const found = await serverHasStarted(stdout, { ...live, home, timeoutMs: 2_000, everyMs: 25 });
    expect(found).toBe(mine.port);
    expect(mine.tokens).toEqual([live.token]);
  });
});

describe("portOfClaim", () => {
  it("refuses anything that is not a positive integer port", () => {
    for (const port of ["1", 0, -1, 1.5, null]) {
      expect(portOfClaim(JSON.stringify({ port, pid: live.pid, token: live.token }), { ...live, home: "" })).toBeNull();
    }
    expect(portOfClaim("not json", { ...live, home: "" })).toBeNull();
  });

  it("refuses a file when the child has no pid", () => {
    expect(
      portOfClaim(JSON.stringify({ port: 47311, pid: 1, token: live.token }), { ...live, pid: undefined, home: "" }),
    ).toBeNull();
  });
});
