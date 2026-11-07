/**
 * How the MCP server reaches the routes: **every tool calls a route**,
 * and a route is reached one of two ways — in this process, on a `Session` it opened itself, or in
 * the app's server over loopback with the token from `server.json`. Both answer `Backend.call` the
 * same, so a tool cannot tell which it has, and neither restates a rule a route already keeps.
 */

import fs from "node:fs";
import path from "node:path";

import type { Hono } from "hono";

export interface CallOptions {
  /** Query parameters; `undefined` and `null` are left out. */
  query?: Record<string, string | number | boolean | null | undefined>;
  /** A JSON body. */
  body?: unknown;
  /** A raw body (an upload's bytes). */
  bytes?: Uint8Array;
  /** Hand the answer back as bytes even if it says it is JSON. */
  raw?: boolean;
}

export interface Answer {
  status: number;
  /** The parsed body, when it was JSON (and `raw` was not asked for). */
  json?: any;
  /** The body, when it was anything else. */
  bytes?: Uint8Array;
  headers: Record<string, string>;
}

export interface Backend {
  call(method: string, path: string, opts?: CallOptions): Promise<Answer>;
  /** Where the answers come from, for `whoami`: `in-process` or `app (port)`. */
  readonly via: string;
}

function target(route: string, query: CallOptions["query"]): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `${route}${route.includes("?") ? "&" : "?"}${s}` : route;
}

function init(
  method: string,
  token: string,
  opts: CallOptions,
  extra: Record<string, string> = {},
): RequestInit & { headers: Record<string, string> } {
  const headers: Record<string, string> = { "x-anydag-token": token, ...extra };
  let body: BodyInit | undefined;
  if (opts.bytes) {
    headers["content-type"] = "application/octet-stream";
    body = opts.bytes as unknown as BodyInit;
  } else if (opts.body !== undefined && method !== "GET") {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return { method, headers, body };
}

async function answer(res: Response, raw: boolean | undefined): Promise<Answer> {
  const headers = Object.fromEntries(res.headers.entries());
  if (!raw && (headers["content-type"] ?? "").includes("json")) {
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, headers };
  }
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers };
}

/** The routes of an app made over a `Session` in this process, with no socket between. */
export function inProcess(app: Hono, token: string): Backend {
  return {
    via: "in-process",
    async call(method, route, opts = {}) {
      // `Host` is part of the gate (DNS rebinding); a request made in memory states the one it means.
      const req = init(method, token, opts);
      req.headers.host = "127.0.0.1";
      const res = await app.request(`http://127.0.0.1${target(route, opts.query)}`, req);
      return answer(res, opts.raw);
    },
  };
}

/** The running app's server, on loopback, behind its per-launch token — and, for a chat's own MCP
 *  server, the `X-AnyDag-Chat` header every request carries (`server/chat/live.ts`). */
export function remote(port: number, token: string, headers: Record<string, string> = {}): Backend {
  return {
    via: `app (127.0.0.1:${port})`,
    async call(method, route, opts = {}) {
      const res = await fetch(`http://127.0.0.1:${port}${target(route, opts.query)}`, init(method, token, opts, headers));
      return answer(res, opts.raw);
    },
  };
}

export interface Running {
  port: number;
  token: string;
  pid: number;
  /** The root of the vault the server had open when it started, if any. */
  vault: string | null;
}

/**
 * The app's server, if `server.json` names one that is alive: the pid exists and `/api/health`
 * answers to the token in the file. A stale file — a crash leaves one — is `null`, never an error.
 */
export async function findRunning(home: string): Promise<Running | null> {
  let said: Partial<Running>;
  try {
    said = JSON.parse(fs.readFileSync(path.join(home, "server.json"), "utf8")) as Partial<Running>;
  } catch {
    return null;
  }
  const { port, token, pid } = said;
  if (typeof port !== "number" || typeof token !== "string" || typeof pid !== "number") return null;
  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }
  try {
    const res = await remote(port, token).call("GET", "/api/health");
    if (res.status !== 200 || !res.json?.ok) return null;
  } catch {
    return null;
  }
  return { port, token, pid, vault: said.vault ?? null };
}
