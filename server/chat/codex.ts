/**
 * Codex as the Assistant's harness.
 *
 * One `codex exec --json` process per turn, as Claude Code's is: a cancel is a SIGTERM and a provider
 * switch is the next turn on another binary. A later turn is `codex exec resume <id>`, which reads the
 * system prompt file again, so a new grant reaches a resumed session. Codex mints the session id
 * (`thread.started`), so `fresh` is not used.
 *
 * Fenced off by `codexIsolation` in `plugins/generate/llm.ts`, the prompt card's flags, plus the one
 * MCP server. Three things a run found, against Codex 0.169:
 *
 * - **`required = true`** on the server makes Codex refuse to start the turn when `anydag` does not
 *   come up — exit 1, "required MCP servers failed to initialize" — so a turn with no tools never
 *   reaches the model. Codex has no init line to read that from, and this is the stand-in.
 * - **The token goes by name**: `env_vars` forwards variables from Codex's own environment to the
 *   server, and `env` would put their values on the command line, where any process can read them.
 * - **`default_tools_approval_mode = "approve"`**, or an MCP call waits on an approval that a run
 *   with no terminal cannot give. Our own approval card is the one that asks.
 *
 * The stream is `parseCodexLine`'s: `thread.started`, `item.started` / `item.completed` carrying an
 * `mcp_tool_call` or an `agent_message`, `turn.completed` with the usage, `error` and `turn.failed`.
 */

import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { forgetCodex, lines, tail, terminate } from "../../plugins/generate/cli";
import { codexCatalog, codexIsolation, codexMessage, codexModelArgs, codexSet } from "../../plugins/generate/llm";
import { codexEnv, codexModels, findCodex } from "../../plugins/generate/providers";
import {
  bareTool,
  type Harness,
  type HarnessEvent,
  type McpCommand,
  type RunEnd,
  type RunOptions,
  type Running,
} from "./harness";
import type { Usage } from "./types";

/** `tool_timeout_sec`: above the five-minute approval a write tool blocks on. */
const MCP_TOOL_TIMEOUT_S = 600;
/** `startup_timeout_sec`: the desktop app's Electron-as-Node child is slow to start, and Codex's default is 10 s. */
const MCP_START_TIMEOUT_S = 60;

/** What Codex says when the chat's MCP server did not start, and what the person is told instead. */
const MCP_FAILED = /required MCP servers? failed to initialize/i;
export const NO_TOOLS_ERROR = "The anydag MCP server did not start, so the Assistant had no tools. Nothing was changed.";

/** The one MCP server, as `-c` pairs. Its environment is named, not written: Codex passes it on from its own. */
export function codexMcpArgs(mcp: McpCommand): string[] {
  return [
    ...codexSet("mcp_servers.anydag.command", mcp.command),
    ...codexSet("mcp_servers.anydag.args", mcp.args),
    ...codexSet("mcp_servers.anydag.env_vars", Object.keys(mcp.env)),
    ...codexSet("mcp_servers.anydag.required", true),
    ...codexSet("mcp_servers.anydag.startup_timeout_sec", MCP_START_TIMEOUT_S),
    ...codexSet("mcp_servers.anydag.tool_timeout_sec", MCP_TOOL_TIMEOUT_S),
    ...codexSet("mcp_servers.anydag.default_tools_approval_mode", "approve"),
  ];
}

/** The flags of one turn: a new session, or `resume <id>` of the one the chat already has. */
export function codexRunArgs(o: RunOptions, files: { system: string; catalog: string }): string[] {
  return [
    "exec",
    ...(o.resume ? ["resume", o.resume] : []),
    ...codexIsolation(files),
    ...codexMcpArgs(o.mcp),
    ...codexModelArgs(o.model, o.effort),
    "-",
  ];
}

/** What the lines so far have said that is not an event. */
export interface CodexState {
  /** Tool calls already announced, so the `item.completed` of one cannot call it twice. */
  tools: Set<string>;
  usage?: Usage;
  /** Set by `turn.failed`, or an `error` line before it. */
  error?: string;
  /** Set by `turn.completed`. */
  done: boolean;
}

export const newCodexState = (): CodexState => ({ tools: new Set(), done: false });

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** An MCP result's text parts, which are the answer; anything else is JSON. */
function resultText(result: unknown): string {
  const content = obj(result)?.content;
  if (!Array.isArray(content)) return result === undefined || result === null ? "" : JSON.stringify(result);
  return content.map((p) => str(obj(p)?.text) ?? "").join("");
}

/**
 * `turn.completed`'s usage. OpenAI counts cached input inside `input_tokens`, so the new input is
 * the difference, as Claude's is; reasoning is inside `output_tokens` already.
 */
function usageOf(u: Obj): Usage {
  const cached = num(u.cached_input_tokens);
  return { input: Math.max(0, num(u.input_tokens) - cached), output: num(u.output_tokens), cached };
}

/** One line of `codex exec --json`, as the events it means. A line that is not JSON is nothing. */
export function parseCodexLine(line: string, st: CodexState): HarnessEvent[] {
  let d: Obj | undefined;
  try {
    d = obj(JSON.parse(line));
  } catch {
    return [];
  }
  if (!d) return [];
  switch (d.type) {
    case "thread.started": {
      const id = str(d.thread_id);
      return id ? [{ kind: "session", id }] : [];
    }
    case "item.started":
    case "item.completed":
      return itemEvents(obj(d.item), d.type === "item.completed", st);
    case "turn.completed":
      st.done = true;
      st.usage = usageOf(obj(d.usage) ?? {});
      return [];
    case "turn.failed": {
      const said = codexMessage(obj(d.error)?.message) || st.error || "Codex failed";
      const fresh = said !== st.error;
      st.error = said;
      return fresh ? [{ kind: "error", text: said }] : [];
    }
    case "error": {
      const said = codexMessage(d.message);
      if (!said || st.error) return [];
      st.error = said;
      return [{ kind: "error", text: said }];
    }
    default:
      return [];
  }
}

function itemEvents(item: Obj | undefined, completed: boolean, st: CodexState): HarnessEvent[] {
  const id = str(item?.id);
  if (!item || !id) return [];
  switch (item.type) {
    case "agent_message":
      return completed && str(item.text) ? [{ kind: "text", text: item.text as string }] : [];
    case "mcp_tool_call": {
      const out: HarnessEvent[] = [];
      /* Announced when it starts, so the page draws a call that waits on an approval card. */
      if (!st.tools.has(id) && typeof item.tool === "string") {
        st.tools.add(id);
        out.push({ kind: "tool", id, name: bareTool(item.tool), input: item.arguments ?? {} });
      }
      if (completed) {
        const failed = item.status === "failed" || item.error != null;
        const output = failed ? (str(obj(item.error)?.message) ?? resultText(item.result)) : resultText(item.result);
        out.push({ kind: "result", id, output, error: failed || obj(item.result)?.isError === true });
      }
      return out;
    }
    default:
      /* A warning item ("Model metadata … not found") and anything newer: not a step of the turn. */
      return [];
  }
}

export interface CodexOptions {
  /** `codex`, found where `findCodex` looks — `ANYDAG_CODEX_BIN`, the `PATH`, the installers' places — unless told. */
  bin?: string;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: typeof nodeSpawn;
  /** Codex's catalog; `codexModels` asks the binary when it is not given. */
  catalog?: () => { models: Record<string, unknown>[] } | undefined;
}

export function codexHarness(o: CodexOptions = {}): Harness {
  const spawn = o.spawnImpl ?? nodeSpawn;
  const baseEnv = (): NodeJS.ProcessEnv => o.env ?? process.env;
  const binOf = (): string => {
    const found = findCodex(baseEnv());
    return o.bin ?? (found.ok ? found.bin : "codex");
  };

  function run(r: RunOptions, on: (e: HarnessEvent) => void): Running {
    const bin = binOf();
    const raw = o.catalog ? o.catalog() : codexModels(bin, baseEnv())?.raw;
    /* No catalog, no run: Codex's own would hand the model a shell (`codexCatalog`). */
    if (!raw) {
      const why = "Codex did not list its models (`codex debug models`), so the turn was not run. Nothing was changed.";
      on({ kind: "error", text: why });
      return { done: Promise.resolve({ error: why }), stop: async () => undefined };
    }
    fs.mkdirSync(r.scratch, { recursive: true });
    const files = { system: path.join(r.scratch, "system.md"), catalog: path.join(r.scratch, "catalog.json") };
    fs.writeFileSync(files.system, r.system);
    fs.writeFileSync(files.catalog, JSON.stringify(codexCatalog(raw)));

    /* The MCP server's environment rides in Codex's own, and `env_vars` names it. */
    const env = { ...codexEnv(baseEnv()), ...r.mcp.env } as NodeJS.ProcessEnv;
    const st = newCodexState();
    let stopped = false;
    let killer: ReturnType<typeof setTimeout> | undefined;
    let stderr = "";
    let stopChild: () => void = () => undefined;

    const done = new Promise<RunEnd>((resolve) => {
      const child = spawn(bin, codexRunArgs(r, files), { cwd: r.scratch, env, stdio: ["pipe", "pipe", "pipe"] });
      let settled = false;
      const settle = (end: RunEnd) => {
        if (settled) return;
        settled = true;
        clearTimeout(killer);
        resolve(end);
      };
      const reader = lines((line) => {
        for (const e of parseCodexLine(line, st)) on(e);
      });
      child.stdout?.on("data", (b: Buffer | string) => reader.push(b));
      child.stderr?.on("data", (b: Buffer | string) => (stderr += b.toString()));
      child.on("error", (e) => {
        on({ kind: "error", text: `could not start Codex: ${e.message}` });
        settle({ error: `could not start Codex: ${e.message}` });
      });
      child.on("close", (code) => {
        reader.flush();
        if (st.error) return settle({ usage: st.usage, error: st.error });
        if (st.done) return settle({ usage: st.usage });
        /* Stopped on purpose: the person asked, so it is not a failure however the process ended. */
        if (stopped) return settle({ usage: st.usage });
        const why = MCP_FAILED.test(stderr) ? NO_TOOLS_ERROR : `Codex exited ${code}${stderr.trim() ? `: ${tail(stderr)}` : ""}`;
        on({ kind: "error", text: why });
        settle({ error: why });
      });
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(r.prompt);
      stopChild = () => {
        if (child.exitCode !== null || child.signalCode !== null || settled) return;
        killer = terminate(child);
      };
    });

    return {
      done,
      async stop() {
        stopped = true;
        stopChild();
        await done;
      },
    };
  }

  return {
    provider: "codex",
    run,
    forget: (session) => forgetCodex(binOf(), session, baseEnv(), { spawnImpl: spawn }),
    close: async () => undefined,
  };
}
