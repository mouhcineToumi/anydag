/**
 * `anydag serve <folder>` — a vault, served to a browser on this machine, with no account.
 *
 * It binds `127.0.0.1` on a port the system picks (or `--port`), mints a per-launch token, writes
 * `server.json` into the app's home so the CLI and the shell can find it, and prints the one URL that
 * carries the token to a browser.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { defaultHarnesses } from "./chat/harnesses";
import { Assistant } from "./chat/live";
import { Session } from "./context";
import { Home, homeDir } from "./home";
import { connect } from "./connect";
import { parseTypes } from "./uploads";

declare const __ANYDAG_VERSION__: string;
const VERSION = typeof __ANYDAG_VERSION__ === "string" ? __ANYDAG_VERSION__ : "dev";

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

// One request that went wrong must not take every open vault with it: said, and survived — and
// logged, once somebody said yes (`server/telemetry.ts`).
let logged: ((e: unknown) => void) | null = null;
process.on("unhandledRejection", (e) => {
  console.error("anydag: unhandled", e);
  logged?.(e);
});

async function main(): Promise<void> {
  const takes = new Set(["--port", "--page", "--token"]);
  const folder =
    process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && !takes.has(all[i - 1] ?? "")) ?? process.env.ANYDAG_VAULT;
  const home = new Home(homeDir());
  const session = new Session(home, null, VERSION, process.env, { types: parseTypes(process.env.ANYDAG_UPLOAD_TYPES) });
  // The folder named, or else the vault opened last — and with neither, none: the page offers to
  // open or make one.
  try {
    if (folder) session.openFolder(folder);
    else {
      const last = session.recent().find((r) => !r.missing);
      if (last) session.openFolder(last.path);
    }
  } catch (e) {
    console.error(`anydag: ${(e as Error).message}`);
    process.exit(2);
  }
  // A fixed token for a test harness that has to know it before the server starts; otherwise minted.
  const token = arg("token") ?? process.env.ANYDAG_TOKEN ?? randomBytes(32).toString("base64url");
  const here = path.dirname(new URL(import.meta.url).pathname);
  const page = process.argv.includes("--no-page") ? null : path.resolve(arg("page") ?? path.join(here, "..", "..", "dist"));
  if (page && !fs.existsSync(path.join(page, "index.html"))) {
    console.error(`no built page at ${page} — run \`npm run build\` first, or pass --no-page`);
    process.exit(2);
  }
  const assistant = new Assistant({ session, token, harnesses: defaultHarnesses(process.env) });
  const app = createApp({ session, token, page, assistant });
  // A server that stays up sends its logs; the CLI's in-process one never starts this.
  session.telemetry.start();
  logged = (e) => session.telemetry.fail(e);
  const runtime = path.join(home.dir, "server.json");
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: Number(arg("port") ?? 0) }, (info) => {
    assistant.listening(info.port);
    fs.writeFileSync(
      runtime,
      JSON.stringify(
        { port: info.port, pid: process.pid, token, vault: session.any ? session.vault.root : null, version: VERSION },
        null,
        2,
      ),
      {
        mode: 0o600,
      },
    );
    console.log(`anydag: ${session.any ? session.vault.root : "no vault open"}`);
    console.log(`open http://127.0.0.1:${info.port}/?token=${token}`);
  });
  const quit = () => {
    try {
      const said = JSON.parse(fs.readFileSync(runtime, "utf8")) as { pid?: number };
      if (said.pid === process.pid) fs.rmSync(runtime);
    } catch {
      /* already gone */
    }
    void assistant.close();
    void session.telemetry.stop();
    void session.closeAll();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  /* A terminal closing is a SIGHUP, not a SIGTERM: without this, `server.json` stayed behind and
     named a port that the desktop shell then had no way to tell from its own child's. */
  process.on("SIGHUP", quit);
  /* Started by the desktop app, which holds an IPC channel to this process: the channel closing —
     the app asking, or the app gone — is the stop. Windows has no SIGTERM to send, only a hard kill. */
  if (process.send) process.on("disconnect", quit);
}

/**
 * `anydag-server mcp [--vault <path>] [--read-only]` — the MCP server over stdio.
 * Stdout belongs to the protocol, so everything said here goes to stderr.
 *
 * With the app's server running (and serving the vault asked for, or none asked) the tools reach it
 * over loopback; otherwise this process opens the vault itself and answers from the same routes.
 */
async function mcp(): Promise<void> {
  const readOnly = process.argv.includes("--read-only");
  const { startMcp } = await import("./mcp/server");
  const chat = arg("chat");
  if (chat) return chatMcp(chat, startMcp);
  let connection;
  try {
    connection = await connect({ vault: arg("vault"), version: VERSION, adopt: false, loops: true });
  } catch (e) {
    console.error(`anydag mcp: ${(e as Error).message}`);
    process.exit(2);
  }
  const server = await startMcp(connection.backend, { readOnly, version: VERSION });
  console.error(`anydag mcp: ${connection.via}${readOnly ? ", read-only" : ""}`);
  server.server.onclose = () => {
    void connection.close().finally(() => process.exit(0));
  };
}

/**
 * `mcp --chat <id>`: the MCP server a chat's harness runs. It only ever reaches the
 * app's running server — the Assistant lives there — on the port and token the app put in its
 * environment, with the chat's header on every request.
 */
async function chatMcp(chat: string, startMcp: typeof import("./mcp/server").startMcp): Promise<void> {
  const { remote } = await import("./mcp/backend");
  const port = Number(process.env.ANYDAG_CHAT_PORT);
  const token = process.env.ANYDAG_TOKEN ?? "";
  if (!port || !token) {
    console.error("anydag mcp --chat: ANYDAG_CHAT_PORT and ANYDAG_TOKEN come from the app that started this");
    process.exit(2);
  }
  const backend = remote(port, token, { "x-anydag-chat": chat });
  let home: string | undefined;
  try {
    const got = await backend.call("GET", "/__board/chat", { query: { id: chat } });
    home = got.json?.chat?.home;
  } catch {
    /* the server says so on the first tool call */
  }
  const server = await startMcp(backend, {
    readOnly: false,
    version: VERSION,
    chat: { id: chat, ...(home ? { home } : {}) },
  });
  console.error(`anydag mcp: chat ${chat}`);
  server.server.onclose = () => process.exit(0);
}

void (process.argv[2] === "mcp" ? mcp() : main());
