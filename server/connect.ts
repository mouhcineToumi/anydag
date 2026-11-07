/**
 * How a client — the CLI, the MCP server — reaches the routes: the app's own server when
 * `server.json` names one that is alive, else the same server in this
 * process, opened on the vault asked for. Both answer `Backend.call` the same.
 *
 * **One writer per vault.** A vault the running app is not serving is opened *there* (`adopt`) when
 * the client is the CLI, so two processes never watch and write one folder; the MCP server keeps its
 * older rule and opens it in its own process instead, because it has no way to name the vault per call.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { Session } from "./context";
import { Home, homeDir } from "./home";
import { findRunning, inProcess, remote, type Backend, type Running } from "./mcp/backend";
import { parseTypes } from "./uploads";

export interface Connection {
  backend: Backend;
  /** `in-process` or `app (127.0.0.1:port)`. */
  via: string;
  home: string;
  /** The running app's server, when that is what this reaches. */
  running: Running | null;
  /** Where requests go, the token every one carries, and a `fetch` that reaches it (in-process: no socket). */
  origin: string;
  token: string;
  fetch: typeof fetch;
  /** The id of the vault requests are about (`?vault=`); `undefined` for the server's own default. */
  vault: string | undefined;
  /**
   * A server a browser can be pointed at: the running one, or — in-process — a listening one made
   * here, on an ephemeral port, serving the built page at `page`. `null` when there is no page.
   */
  listen(page: string | null): Promise<{ port: number; token: string } | null>;
  /** Let go: close what this process opened. Never closes a vault the running app is serving. */
  close(): Promise<void>;
}

export interface ConnectOptions {
  /** A vault folder (or the id of one the server knows). Else `ANYDAG_VAULT`, else the last opened. */
  vault?: string | undefined;
  version: string;
  env?: NodeJS.ProcessEnv;
  /** Open `vault` on the running server when it is not serving it; else fall back to in-process. */
  adopt?: boolean;
  /**
   * In-process only: whether a linked vault's sync loop runs while this connection is open. A
   * one-shot command leaves it off (`SyncLinks.auto`); a server that stays up, `anydag mcp`, turns it on.
   */
  loops?: boolean;
}

interface Listed {
  id: string;
  path: string;
  open: boolean;
  default: boolean;
}

export class NoVault extends Error {
  override name = "NoVault";
}

export async function connect(opts: ConnectOptions): Promise<Connection> {
  const env = opts.env ?? process.env;
  const home = homeDir(env);
  const wanted = opts.vault ?? (env.ANYDAG_VAULT || undefined);
  const running = await findRunning(home);

  if (running) {
    const there = remote(running.port, running.token);
    let vault: string | undefined;
    let usable = true;
    /* Opening a vault makes it the server's default — what a window with no `?vault=` shows. A client
       passing through must not move that, so the one that was is brought back to the front on close. */
    let putBack: string | null = null;
    if (wanted) {
      const listed = ((await there.call("GET", "/api/vaults")).json?.vaults ?? []) as Listed[];
      const known = listed.find((v) => v.id === wanted) ?? listed.find((v) => path.resolve(v.path) === path.resolve(wanted));
      if (known?.open) vault = known.id;
      else if (opts.adopt !== false) {
        putBack = listed.find((v) => v.default)?.path ?? null;
        const done = await there.call("POST", "/api/vaults/open", { body: { path: known?.path ?? wanted } });
        if (done.status !== 200) throw new NoVault(String(done.json?.error ?? `could not open ${wanted}`));
        vault = String(done.json.vault.id);
      } else usable = false;
    }
    if (usable) {
      return {
        backend: there,
        via: there.via,
        home,
        running,
        origin: `http://127.0.0.1:${running.port}`,
        token: running.token,
        fetch: (input, init) => fetch(input, init),
        vault,
        listen: async () => ({ port: running.port, token: running.token }),
        close: async () => {
          if (putBack) await there.call("POST", "/api/vaults/open", { body: { path: putBack } }).catch(() => {});
        },
      };
    }
  }

  const session = new Session(new Home(home), null, opts.version, env, { types: parseTypes(env.ANYDAG_UPLOAD_TYPES) });
  session.sync.auto = opts.loops === true;
  const folder = wanted ?? session.recent().find((r) => !r.missing)?.path;
  if (folder) {
    try {
      // An id from `vault ls` names a vault on the recent list; anything else is a folder.
      const byId = session.recent().find((r) => r.id === folder);
      session.openFolder(byId ? byId.path : folder);
    } catch (e) {
      await session.closeAll();
      throw new NoVault((e as Error).message);
    }
  }
  // The token gates a socket; with none here it is minted only to be presented to ourselves.
  const token = randomBytes(32).toString("base64url");
  const app = createApp({ session, token, page: null });
  const backend = inProcess(app, token);
  let server: ReturnType<typeof serve> | null = null;
  return {
    backend,
    via: backend.via,
    home,
    running: null,
    origin: "http://127.0.0.1",
    token,
    // `Host` is part of the gate; a request made in memory states the one it means.
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("host", "127.0.0.1");
      return Promise.resolve(app.request(String(input), { ...init, headers }));
    },
    vault: undefined,
    async listen(page) {
      if (!page || !fs.existsSync(path.join(page, "index.html"))) return null;
      const app = createApp({ session, token, page });
      const port = await new Promise<number>((resolve) => {
        server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => resolve(info.port));
      });
      return { port, token };
    },
    async close() {
      const s = server as { close(cb?: () => void): void } | null;
      if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
      await session.closeAll();
    },
  };
}
