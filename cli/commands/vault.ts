import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UsageError, bool } from "../args";
import { confirm, emit, table, type Command, type Ctx } from "../context";

/**
 * Vaults from a terminal. A vault is a folder; the server serves several at once and every other
 * command acts in one — `--vault`, else `ANYDAG_VAULT`, else the one
 * opened last. These are the commands about the vaults themselves: which there are, opening and
 * making one, putting one away, and moving a file or a folder from one to another.
 *
 * **Nothing here removes a folder from disk.** `close` stops serving a vault and `--forget` takes it
 * off the recent list; the files stay, because they were never the app's to delete.
 */

interface Vault {
  id: string;
  name: string;
  path: string;
  opened: string;
  open: boolean;
  default: boolean;
  missing: boolean;
}

interface Removed {
  folder?: string;
  folders?: string[];
  [plural: string]: unknown;
}

async function listed(ctx: Ctx): Promise<{ vaults: Vault[]; home: string }> {
  return ctx.api.get<{ vaults: Vault[]; home: string }>("/api/vaults");
}

/** A vault named by id, by its folder, or by its name — whichever the person has to hand. */
function find(all: Vault[], what: string): Vault {
  const abs = path.resolve(what);
  const found =
    all.find((v) => v.id === what) ?? all.find((v) => path.resolve(v.path) === abs) ?? all.filter((v) => v.name === what).at(0);
  if (!found) throw new UsageError(`no vault \`${what}\` — \`anydag vault ls\` lists them`);
  return found;
}

/**
 * `anydag mcp [--vault <path>] [--read-only]` — the MCP server over stdio, which is the server's own
 * entry (`server/main.ts`, `anydag-server mcp`): this runs it with the terminal's stdio so a client's
 * `command: "anydag", args: ["mcp", "--vault", …]` works. Stdout belongs to the protocol.
 *
 * It is found next to the CLI's bundle (`server/dist/`), or at `$ANYDAG_SERVER_BIN`; a checkout that
 * has not built it yet is built here, once.
 */
export function runMcp(args: readonly string[]): Promise<number> {
  return runServer("mcp", ["mcp", ...args]);
}

/**
 * `anydag serve [<folder>] [--port <n>]` — the server with the built page, for a browser on this
 * machine: what the desktop app runs inside itself, without the app. It prints the address once,
 * `/?token=…`, which the page swaps for a cookie. The page is found next to the CLI's bundle
 * (`dist/`), or at `$ANYDAG_PAGE`.
 */
export function runServe(args: readonly string[]): Promise<number> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const page = process.env.ANYDAG_PAGE ? path.resolve(process.env.ANYDAG_PAGE) : path.resolve(here, "..", "..", "dist");
  const named = args.includes("--page") || args.includes("--no-page");
  return runServer("serve", named ? [...args] : [...args, "--page", page]);
}

async function runServer(what: string, argv: readonly string[]): Promise<number> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let bin = process.env.ANYDAG_SERVER_BIN;
  if (!bin) {
    for (const up of ["..", "../.."]) {
      const at = path.resolve(here, up, "server", "dist", "anydag-server.mjs");
      if (fs.existsSync(at)) {
        bin = at;
        break;
      }
    }
  }
  if (!bin) {
    try {
      const root = path.resolve(here, "..", "..");
      bin = await (await import(/* @vite-ignore */ path.join(root, "server", "build.mjs"))).build();
    } catch (e) {
      process.stderr.write(
        `anydag ${what}: the server is not built (${e instanceof Error ? e.message : String(e)}) — run \`node server/build.mjs\`\n`,
      );
      return 2;
    }
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin!, ...argv], { stdio: "inherit" });
    child.on("error", (e) => {
      process.stderr.write(`anydag ${what}: ${e.message}\n`);
      resolve(2);
    });
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

export const VAULT: Command[] = [
  {
    name: ["mcp"],
    group: "vault",
    args: "[--read-only]",
    summary: "run the MCP server over stdio for a vault, for Claude Code or Claude Desktop",
    help: "Add it to Claude Code with `claude mcp add anydag -- anydag mcp --vault <path>`. It reaches the running app when there is one, and otherwise serves the folder from its own process. --read-only drops the tools that write.",
    flags: [{ name: "read-only", type: "boolean", help: "offer only the tools that read" }],
    routes: [],
    async run() {
      /* `main` hands `mcp` to {@link runMcp} before it opens a connection of its own — the protocol
         owns stdout, and the server this starts makes the connection. */
      return runMcp([]);
    },
  },
  {
    name: ["serve"],
    group: "vault",
    args: "[<folder>] [--port <n>]",
    summary: "serve a vault and the page to a browser on this machine, printing the address to open",
    help:
      "The desktop app without the app: one server on 127.0.0.1, behind a token it prints once in the address. " +
      "With no folder it serves the vault opened last. Ctrl+C stops it.",
    flags: [{ name: "port", type: "string", help: "the port to listen on; the system picks one by default" }],
    routes: [],
    async run() {
      /* `main` hands `serve` to {@link runServe} before it opens a connection: this *is* the server. */
      return runServe([]);
    },
  },
  {
    name: ["vault", "ls"],
    args: "",
    summary:
      "every vault on the recent list — `*` marks the one served by default, `o` one being served, `!` a folder that is gone",
    routes: ["GET /api/vaults"],
    async run(ctx) {
      const { vaults, home } = await listed(ctx);
      emit(ctx, { vaults, home }, () => {
        for (const line of table(
          vaults.map((v) => [v.default ? "*" : v.open ? "o" : v.missing ? "!" : " ", v.id, v.name, v.path]),
        ))
          ctx.io.out(line);
      });
    },
  },
  {
    name: ["vault", "open"],
    args: "<path>",
    min: 1,
    summary: "serve a folder as a vault, making it the default; its id is printed",
    help:
      "A folder with no `.anydag/` becomes a vault the first time it is opened — that one folder is the only thing " +
      "written, and nothing is moved or rewritten. A folder inside a vault, or holding one, is refused. With the app " +
      "running it opens there; with none, the vault is opened for this command alone and is on the recent list after.",
    routes: ["POST /api/vaults/open"],
    async run(ctx, p) {
      const done = await ctx.api.post<{ vault: { id: string; name: string; path: string } }>("/api/vaults/open", {
        path: p.pos.join(" "),
      });
      emit(ctx, done, () => ctx.io.out(done.vault.id));
    },
  },
  {
    name: ["vault", "create"],
    args: "<parent> <name>",
    min: 2,
    summary: "make a folder <name> inside <parent> and open it as a vault; its id is printed",
    help: "Refused when something is already at that path, so nothing existing is ever adopted by accident — use `vault open` for that.",
    routes: ["POST /api/vaults/create"],
    async run(ctx, p) {
      const done = await ctx.api.post<{ vault: { id: string; name: string; path: string } }>("/api/vaults/create", {
        parent: p.pos[0],
        name: p.pos.slice(1).join(" "),
      });
      emit(ctx, done, () => ctx.io.out(done.vault.id));
    },
  },
  {
    name: ["vault", "close"],
    args: "<id|path>",
    min: 1,
    summary: "stop serving a vault; --forget also takes it off the recent list. The folder is never touched",
    flags: [
      { name: "forget", type: "boolean", help: "also remove it from the recent list" },
      { name: "yes", short: "y", type: "boolean", help: "do not ask before forgetting" },
    ],
    routes: ["POST /api/vaults/close"],
    async run(ctx, p) {
      const v = find((await listed(ctx)).vaults, p.pos.join(" "));
      const forget = bool(p, "forget");
      if (forget) await confirm(ctx, `forget the vault ${v.name} (${v.path})? Its files stay where they are`, bool(p, "yes"));
      const done = await ctx.api.post<{ vaults: Vault[] }>("/api/vaults/close", { id: v.id, forget });
      emit(ctx, done, () => ctx.io.err(`${forget ? "forgot" : "closed"} ${v.name}`));
    },
  },
  {
    name: ["vault", "transfer"],
    args: "<name>",
    summary: "move a board, note, quiz, table or attachment — or with --folder a folder — to another open vault",
    help:
      "From the vault this command acts in (--vault) to the open vault --to names. A file keeps its id, its created " +
      "date and its images, and is numbered if its name is taken there; a folder whose name is taken there is refused " +
      "rather than merged. A reference to it from a file left behind stops resolving: an id resolves within its vault.",
    flags: [
      { name: "to", type: "string", value: "<id|path>", help: "the open vault it goes to" },
      { name: "kind", type: "string", value: "board|note|quiz|table|file", help: "what <name> is (default: board)" },
      { name: "folder", type: "string", value: "<path>", help: "move this folder and everything in it instead of one file" },
    ],
    routes: ["POST /__board/transfer"],
    async run(ctx, p) {
      if (typeof p.flags.to !== "string") throw new UsageError("say where with --to <id|path>");
      const all = (await listed(ctx)).vaults;
      const to = find(all, p.flags.to);
      /* The route moves from the vault the request names to an *open* one. Opening the target makes it
         the server's default, so the source is named explicitly, and brought back to the front after. */
      const from = ctx.vault ?? all.find((v) => v.default)?.id;
      if (!from) throw new UsageError("no vault to move from — name one with --vault");
      if (!to.open) await ctx.api.post("/api/vaults/open", { path: to.path });
      const at = { vault: from };
      const restore = async () => {
        if (!to.open) await ctx.api.post("/api/vaults/open", { path: all.find((v) => v.id === from)?.path });
      };
      const folder = typeof p.flags.folder === "string" ? p.flags.folder.replace(/\/+$/, "") : null;
      if (folder !== null) {
        const done = await ctx.api.post<Removed>("/__board/transfer", { folder, to: to.id }, at).finally(restore);
        emit(ctx, done, () => ctx.io.err(`moved ${done.folder}/ to ${to.name}`));
        return;
      }
      const name = p.pos[0];
      if (!name) throw new UsageError("usage: anydag vault transfer <name> --to <id|path> [--kind board|note|quiz|table|file]");
      const kind = typeof p.flags.kind === "string" ? p.flags.kind : "board";
      if (!["board", "note", "quiz", "table", "file"].includes(kind))
        throw new UsageError("--kind is board, note, quiz, table or file");
      const done = await ctx.api
        .post<{ name: string; kind: string }>("/__board/transfer", { name, kind, to: to.id }, at)
        .finally(restore);
      emit(ctx, done, () => ctx.io.out(done.name));
    },
  },
  {
    name: ["whoami"],
    group: "vault",
    args: "",
    summary: "which server answers and which vault a command acts in",
    help: "There is no account: this says whether the running app answers or this process serves the vault itself, and which folder.",
    routes: ["GET /api/health"],
    async run(ctx) {
      const h = await ctx.api.get<{ version: string; vault: string | null }>("/api/health");
      const here = ctx.vault ? (await listed(ctx)).vaults.find((v) => v.id === ctx.vault) : undefined;
      const root = here?.path ?? h.vault;
      emit(ctx, { via: ctx.conn.via, home: ctx.conn.home, version: h.version, vault: root, id: ctx.vault ?? null }, () =>
        ctx.io.out(`${ctx.conn.via}  version ${h.version}  vault ${root ?? "(none open)"}  home ${ctx.conn.home}`),
      );
    },
  },
];
