import { Api, ApiError, EXIT } from "./api";
import { UsageError, parseArgs, type FlagSpec } from "./args";
import { COMMANDS, GROUPS } from "./commands";
import { nodeIo, type Command, type Ctx, type Io } from "./context";
import type { connect as Connect } from "../server/connect";
import { pathToFileURL } from "node:url";

/**
 * `anydag` — the canvas from a terminal.
 *
 * This file is the dispatch and nothing else: which command the words name, the three flags every
 * command takes, and turning a failure into a sentence and an exit code. What each command *does*
 * is in `commands/`, one file per group, and every one of them goes through `api.ts`.
 *
 * **Run when the file itself is the entry** — the desktop shim execs the bundle directly, and
 * `cli/anydag.mjs` in the repository imports and calls `main`, so the
 * bundle must be exactly one of: a library to the wrapper, or the program itself. The server bundle
 * (`server/main.ts`) is the other half of the same shape.
 */

declare const __ANYDAG_VERSION__: string;
const VERSION = typeof __ANYDAG_VERSION__ === "string" ? __ANYDAG_VERSION__ : "dev";

/** Taken by every command, wherever it is written on the line. */
export const GLOBAL_FLAGS: FlagSpec[] = [
  {
    name: "vault",
    type: "string",
    value: "<path>",
    help: "the vault to act in: a folder, or an id from `anydag vault ls` (default: $ANYDAG_VAULT, then the vault opened last). With the app running it is opened there; with none, this process serves it",
  },
  { name: "json", type: "boolean", help: "print the route's own answer as JSON" },
  { name: "help", short: "h", type: "boolean", help: "what this command does" },
];

export interface Found {
  command: Command;
  rest: string[];
}

/** Flags every command takes, which may come before the words that name it. */
const LEADING = new Set(["--json", "--help", "-h"]);

/** The command the leading words name — the longest match wins, so `item ls` beats `item`. */
export function find(argv: readonly string[]): Found | { group: string } | null {
  const at: number[] = [];
  for (let i = 0; i < argv.length && at.length < 3; i++) {
    const tok = argv[i]!;
    if (tok === "--vault") {
      i++;
      continue;
    }
    if (tok.startsWith("--vault=") || LEADING.has(tok)) continue;
    if (tok.startsWith("-")) break;
    at.push(i);
  }
  const words = at.map((i) => argv[i]!);
  for (let n = words.length; n > 0; n--) {
    const want = words.slice(0, n).join(" ");
    const command = COMMANDS.find((c) => c.name.join(" ") === want);
    if (command) {
      const skip = new Set(at.slice(0, n));
      return { command, rest: argv.filter((_, i) => !skip.has(i)) };
    }
  }
  if (words[0] && COMMANDS.some((c) => c.name.length > 1 && c.name[0] === words[0])) return { group: words[0] };
  return null;
}

/** How a command reaches the routes — `server/connect.ts`; a test hands in a stand-in with no socket. */
export type Reach = typeof Connect;

/** The real one, loaded when a command needs a server: `help` and `--json` help never open the home's database. */
const connect: Reach = async (o) => (await import("../server/connect")).connect(o);

export async function main(argv: readonly string[], io: Io = nodeIo(), env: NodeJS.ProcessEnv = process.env, reach: Reach = connect): Promise<number> {
  if (argv[0] === "help" && argv.includes("--json")) {
    /* The command table as data — what `check-skill.mjs` holds the skill against, and how an agent
       learns the whole surface in one call rather than one `--help` at a time. */
    io.out(JSON.stringify(COMMANDS.map(({ run: _run, ...c }) => ({ ...c, name: c.name.join(" "), flags: [...(c.flags ?? []), ...GLOBAL_FLAGS] })), null, 2));
    return EXIT.ok;
  }
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    const topic = argv[0] === "help" ? argv.slice(1) : [];
    const found = topic.length ? find(topic) : null;
    if (found && "command" in found) io.out(commandHelp(found.command));
    else if (found && "group" in found) io.out(groupHelp(found.group));
    else io.out(overview());
    return EXIT.ok;
  }
  if (argv[0] === "--version" || argv[0] === "version") {
    io.out(`anydag ${VERSION}`);
    return EXIT.ok;
  }

  const found = find(argv);
  if (!found) {
    io.err(`anydag: no command \`${argv.filter((a) => !a.startsWith("-")).slice(0, 2).join(" ")}\` — \`anydag help\` lists them`);
    return EXIT.usage;
  }
  if ("group" in found) {
    io.out(groupHelp(found.group));
    return EXIT.ok;
  }

  const { command } = found;
  if (command.name.join(" ") === "mcp" && !found.rest.some((a) => a === "--help" || a === "-h")) {
    /* The MCP server connects for itself and speaks on stdout: no connection of ours, no `--json`. */
    return (await import("./commands/vault")).runMcp(found.rest);
  }
  if (command.name.join(" ") === "serve" && !found.rest.some((a) => a === "--help" || a === "-h")) {
    /* The server itself, in the foreground: nothing to connect to, it is what others connect to. */
    return (await import("./commands/vault")).runServe(found.rest);
  }
  try {
    const p = parseArgs(found.rest, [...GLOBAL_FLAGS, ...(command.flags ?? [])]);
    if (p.flags.help) {
      io.out(commandHelp(command));
      return EXIT.ok;
    }
    if (p.pos.length < (command.min ?? 0)) throw new UsageError(`usage: ${synopsis(command)}`);

    const flag = typeof p.flags.vault === "string" ? p.flags.vault : undefined;
    let conn;
    try {
      conn = await reach({ vault: flag, version: VERSION, env });
    } catch (e) {
      if (e instanceof Error && e.name === "NoVault") throw new ApiError(e.message, EXIT.noVault);
      throw e;
    }
    try {
      const api = new Api({ origin: conn.origin, token: conn.token, vault: conn.vault, fetch: conn.fetch });
      const ctx: Ctx = { api, conn, vault: conn.vault, json: p.flags.json === true, env, io };
      return (await command.run(ctx, p)) ?? EXIT.ok;
    } finally {
      /* An in-process server holds the vault's watcher and the home's database open: without
         closing them the process would never exit. */
      await conn.close();
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`anydag ${command.name.join(" ")}: ${e.message}`);
      return EXIT.usage;
    }
    if (e instanceof ApiError) {
      io.err(`anydag ${command.name.join(" ")}: ${e.message}`);
      return e.exit;
    }
    io.err(`anydag ${command.name.join(" ")}: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT.failed;
  }
}

/* ---- help ------------------------------------------------------------------------------------- */

const synopsis = (c: Command): string => `anydag ${c.name.join(" ")}${c.args ? ` ${c.args}` : ""}`;

const groupOf = (c: Command): string => c.group ?? c.name[0]!;

function rowsOf(commands: readonly Command[]): string[] {
  const rows = commands.map((c) => [`  ${c.name.join(" ")}${c.args ? ` ${c.args}` : ""}`, c.summary] as const);
  const width = Math.max(...rows.map((r) => r[0].length));
  return rows.map(([a, b]) => `${a.padEnd(width)}  ${b}`);
}

function overview(): string {
  const lines = [
    `anydag ${VERSION} — the AnyDag canvas from a terminal`,
    "",
    "usage: anydag <command> [arguments] [--vault <path>] [--json]",
    "",
  ];
  for (const g of GROUPS) {
    const mine = COMMANDS.filter((c) => groupOf(c) === g.name);
    if (mine.length === 0) continue;
    lines.push(`${g.title} — ${g.blurb}`, ...rowsOf(mine), "");
  }
  lines.push(
    "`anydag <command> --help` says more about one. With the app open it is used; with none, `--vault <path>` serves that folder from this process.",
    "exit: 0 done · 1 refused · 2 usage · 3 conflict · 4 errors · 5 not ready · 6 no server · 7 no vault",
  );
  return lines.join("\n");
}

function groupHelp(group: string): string {
  const g = GROUPS.find((x) => x.name === group);
  const mine = COMMANDS.filter((c) => c.name[0] === group);
  return [g ? `${g.title} — ${g.blurb}` : group, "", ...rowsOf(mine)].join("\n");
}

export function commandHelp(c: Command): string {
  const lines = [`usage: ${synopsis(c)}`, "", c.summary];
  if (c.help) lines.push("", c.help);
  const flags = [...(c.flags ?? []), ...GLOBAL_FLAGS];
  const rows = flags.map((f) => [`  --${f.name}${f.short ? `, -${f.short}` : ""}${f.value ? ` ${f.value}` : ""}`, f.help]);
  const width = Math.max(...rows.map((r) => r[0]!.length));
  lines.push("", "flags:", ...rows.map(([a, b]) => `${a!.padEnd(width)}  ${b}`));
  return lines.join("\n");
}

/* When the bundle itself is what Node was asked to run — the desktop shim's `exec`, `anydag` on the
   PATH in an install — there is no wrapper to call `main`; the file is the program. As a library
   (`cli/anydag.mjs`, the repository one) nothing here runs and the wrapper calls `main` itself. */
const here = pathToFileURL(process.argv[1] ?? "").href;
if (here === import.meta.url) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
