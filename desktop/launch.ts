/**
 * Finding the port of the server **this launch** spawned.
 *
 * The token is minted per launch and handed to the child in its environment, and it must only ever
 * go to that child. The child says its port on stdout; `server.json` in the app's home is the
 * fallback, and it is believed only when it is this child's own file — the pid and the token both
 * match. The home is shared with `anydag serve`: a file left by an earlier one names a port that
 * anybody on the machine may be listening on now, and that listener must never see the token.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Readable } from "node:stream";

export interface Launch {
  /** The child's pid (`ChildProcess.pid`), or `undefined` when it never started. */
  pid: number | undefined;
  /** The token this launch minted and handed the child. */
  token: string;
  /** The app's home, where the server writes `server.json`. */
  home: string;
}

/**
 * The port a `server.json` claims, if — and only if — the file is this launch's own child's:
 * its pid and its token both match. Anything else is a stale file from another run, and its port
 * belongs to whoever holds it now.
 */
export function portOfClaim(text: string, launch: Launch): number | null {
  if (launch.pid === undefined) return null;
  try {
    const it = JSON.parse(text) as { port?: unknown; pid?: unknown; token?: unknown };
    return typeof it.port === "number" &&
      Number.isInteger(it.port) &&
      it.port > 0 &&
      it.pid === launch.pid &&
      it.token === launch.token
      ? it.port
      : null;
  } catch {
    return null;
  }
}

function portFromJson(launch: Launch): number | null {
  try {
    return portOfClaim(fs.readFileSync(path.join(launch.home, "server.json"), "utf8"), launch);
  } catch {
    return null;
  }
}

export interface WaitForServer extends Launch {
  /** How long the child has to say its port. Twenty seconds covers a cold start. */
  timeoutMs?: number;
  /** How often stdout and `server.json` are asked. */
  everyMs?: number;
}

/**
 * Wait for the server to be up: its own words on stdout —
 * `open http://127.0.0.1:<port>/?token=…` — or `server.json`, when this child wrote it, then one
 * `/api/health` answer with the token. A port is only ever pinged once it is proven to be the
 * child's, because the ping is what carries the token.
 */
export async function serverHasStarted(stdout: Readable | null, launch: WaitForServer): Promise<number | null> {
  const timeoutMs = launch.timeoutMs ?? 20_000;
  const everyMs = launch.everyMs ?? 150;
  let said = "";
  stdout?.setEncoding("utf8");
  stdout?.on("data", (chunk: string) => {
    said += chunk;
    if (said.length > 16_000) said = said.slice(-4_000);
  });
  const fromStdout = (): number | null => {
    const at = said.match(/open http:\/\/127\.0\.0\.1:(\d+)\//);
    return at ? Number(at[1]) : null;
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const port = fromStdout() ?? portFromJson(launch);
    if (port && (await ping(port, launch.token))) return port;
    await new Promise<void>((resolve) => setTimeout(resolve, everyMs));
  }
  return null;
}

/** `/api/health` needs no vault but does need the token, which is the check that matters. */
function ping(port: number, token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/api/health", method: "GET", headers: { "x-anydag-token": token }, timeout: 3_000 },
      (res) => {
        const ok = res.statusCode === 200;
        res.resume();
        req.destroy();
        resolve(ok);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
