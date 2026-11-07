import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

import type { Api } from "./api";
import { UsageError, type FlagSpec, type Parsed } from "./args";
import type { Connection } from "../server/connect";

/**
 * What every command is handed: where it is talking to, how to talk, and how to speak.
 *
 * `io` is the terminal and nothing else — a test hands in one that records what was printed and
 * answers prompts from a list, which is what lets a command's wording be asserted without a TTY.
 */

export interface Io {
  /** One line of the command's answer, on stdout. */
  out(line: string): void;
  /** One line about what happened, on stderr — never mixed into an answer a script is reading. */
  err(line: string): void;
  /** Raw bytes to stdout, for `cat` and `export`, which must not gain a newline. */
  write(chunk: string | Uint8Array): void;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  readStdin(): Promise<string>;
  ask(question: string, opts?: { hidden?: boolean }): Promise<string>;
}

export interface Ctx {
  api: Api;
  /** How the routes are reached: the running app, or this process (`server/connect.ts`). */
  conn: Connection;
  /** The id of the vault this command acts in, when `--vault` named one the server did not already default to. */
  vault?: string | undefined;
  json: boolean;
  env: NodeJS.ProcessEnv;
  io: Io;
}

export interface Command {
  /** The words that name it: `["board", "cat"]`. */
  name: string[];
  /** Which heading `anydag help` lists it under, when that is not its first word — `whoami` is `vault`. */
  group?: string;
  /** The positional synopsis for help: `<name> [<to>]`. */
  args: string;
  /** How many positionals it cannot run without. */
  min?: number;
  summary: string;
  /** A paragraph for `--help`, written for somebody deciding whether this is the command. */
  help?: string;
  flags?: FlagSpec[];
  /**
   * Every API route this command can reach, as `METHOD /path`. Declared rather than discovered, and
   * held against the API's own list by `test/cli-routes.test.ts` — a route nothing here reaches and
   * nothing refuses is a gap in "everything a person can do", and that test is where it shows.
   */
  routes: string[];
  run(ctx: Ctx, p: Parsed): Promise<number | void>;
}

export function nodeIo(): Io {
  /* `anydag ls | head` closes the pipe before the listing is written, and an unhandled EPIPE is a
     stack trace for doing the ordinary thing. A reader that has stopped reading is a reader that
     has had enough: stop, the way every Unix tool does. */
  process.stdout.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EPIPE") process.exit(0);
    throw e;
  });
  return {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    write: (chunk) => process.stdout.write(chunk),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      return Buffer.concat(chunks).toString("utf8");
    },
    ask: (question, opts) => (opts?.hidden ? askHidden(question) : askPlain(question)),
  };
}

async function askPlain(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/** A prompt that echoes nothing: a password typed into a terminal must not stay on its screen. */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let typed = "";
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") {
          done();
          resolve(typed);
          return;
        }
        if (c === "\u0003" || c === "\u0004") {
          done();
          reject(new UsageError("cancelled"));
          return;
        }
        if (c === "\u007f" || c === "\b") typed = typed.slice(0, -1);
        else typed += c;
      }
    };
    stdin.on("data", onData);
  });
}

/* ---- speaking -------------------------------------------------------------------------------- */

/** The route's own answer under `--json`, and the human sentence otherwise. */
export function emit(ctx: Ctx, value: unknown, human: () => void): void {
  if (ctx.json) ctx.io.out(JSON.stringify(value, null, 2));
  else human();
}

/** Columns lined up, the last one left ragged. */
export function table(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join("  ").trimEnd());
}

/** The first twelve characters of a sha1, which is enough to tell two bases apart by eye. */
export const short = (sha: string | undefined): string => (sha ?? "").slice(0, 12);

/* ---- listening ------------------------------------------------------------------------------- */

/**
 * The text a command was given: a file, or stdin when the file is `-`.
 *
 * **Stdin only when asked for by name.** Reading it whenever it is not a terminal is the usual
 * shortcut and it hangs for ever under anything that starts a command with a pipe it never closes —
 * which is how an agent's shell tool can run one. `--file -` is one more word and never hangs.
 */
export async function readText(ctx: Ctx, file: string | undefined, what = "the text"): Promise<string> {
  if (file === "-") return ctx.io.readStdin();
  if (file) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (e) {
      throw new UsageError(`could not read ${file}: ${(e as Error).message}`);
    }
  }
  throw new UsageError(`give ${what} with --file <path>, or --file - to read it from stdin`);
}

/**
 * Ask before something that cannot be taken back. `--yes` answers for a script; without a terminal
 * and without `--yes` it is refused rather than assumed, because the one thing worse than a prompt
 * a script cannot answer is a deletion nobody agreed to.
 */
export async function confirm(ctx: Ctx, question: string, yes: boolean): Promise<void> {
  if (yes) return;
  if (!ctx.io.stdinIsTTY) throw new UsageError(`${question} — pass --yes to do it without a terminal`);
  const answer = (await ctx.io.ask(`${question} [y/N] `)).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") throw new UsageError("left as it was");
}

/**
 * `$VISUAL`, then `$EDITOR`, then `vi`, over a file named like the thing being edited — so an
 * editor that picks its mode by extension picks Markdown. Returns what the file holds afterwards.
 */
/** A name safe to hand a shell: the editor is run through one, so nothing in it may be read as syntax. */
const safeName = (name: string): string => name.replace(/[^\w.-]+/g, "-");

export function editInEditor(ctx: Ctx, text: string, filename: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-"));
  const file = path.join(dir, safeName(filename));
  fs.writeFileSync(file, text);
  const editor = ctx.env.VISUAL || ctx.env.EDITOR || "vi";
  /* Through a shell, because `EDITOR="code --wait"` is a command line and not a path. */
  const run = spawnSync(`${editor} ${JSON.stringify(file)}`, { stdio: "inherit", shell: true });
  if (run.status !== 0) throw new UsageError(`${editor} exited ${run.status ?? run.signal}; nothing was written`);
  const after = fs.readFileSync(file, "utf8");
  fs.rmSync(dir, { recursive: true, force: true });
  return after;
}

/** Keep somebody's text somewhere they can find it when it could not be written. */
export function keepAside(text: string, filename: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-kept-"));
  const file = path.join(dir, safeName(filename));
  fs.writeFileSync(file, text);
  return file;
}
