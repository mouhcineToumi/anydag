/**
 * Claude Code as the Assistant's harness.
 *
 * One `claude -p` process per turn: it costs half a second and makes a cancel and a provider switch
 * the same act, where a process held open per chat would need both to be told apart. Every switch
 * below was found by running it; the short version is that the
 * person's own setup (their `CLAUDE.md`, their hooks, every built-in tool, every other MCP server)
 * must not reach the model, and the one MCP server we hand it must be allowed to write.
 *
 * `parseClaudeLine` is the stream's whole meaning with no process in it, so it is a unit test; the
 * harness around it is a spawn, a line splitter and a SIGTERM.
 *
 * `claudeArgs` in `plugins/generate/llm.ts` is *not* reused: it passes `--safe-mode`, which turns MCP
 * off, and a prompt card wants exactly that.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { lines, tail, terminate } from "../../plugins/generate/cli";
import { claudeEnv, findClaude } from "../../plugins/generate/providers";
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

/** `MCP_TOOL_TIMEOUT`: above chat mode's five-minute approval, which a write tool blocks on. */
const MCP_TOOL_TIMEOUT_MS = 600_000;

/** The MCP config file's content: the one server, spelled the way `--mcp-config` reads it. */
export function claudeMcpConfig(mcp: McpCommand): object {
  return { mcpServers: { anydag: { type: "stdio", command: mcp.command, args: mcp.args, env: mcp.env } } };
}

/**
 * The flags of one turn. `--tools ""` is what leaves nothing but our tools, `--allowedTools` is what
 * lets a write run under `-p`, `--setting-sources ""` keeps the person's setup out, and
 * `--system-prompt-snapshot off` stops a resumed turn keeping the system prompt it started with.
 * The model is always named: the default is Opus, and one three-request turn on it cost $0.25.
 */
export function claudeRunArgs(o: RunOptions, files: { system: string; mcp: string }): string[] {
  return [
    "-p",
    "--model",
    o.model,
    ...(o.effort ? ["--effort", o.effort] : []),
    ...(o.resume ? ["--resume", o.resume] : ["--session-id", o.fresh ?? randomUUID()]),
    "--strict-mcp-config",
    "--mcp-config",
    files.mcp,
    "--tools",
    "",
    "--allowedTools",
    "mcp__anydag__*",
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--system-prompt-file",
    files.system,
    "--system-prompt-snapshot",
    "off",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];
}

/** What the lines so far have said that is not an event: the end, and which tool calls were announced. */
export interface ClaudeState {
  /** Tool calls already announced, so an `assistant` message that repeats a block cannot call it twice. */
  tools: Set<string>;
  /** Set by the closing `result` line. */
  end?: RunEnd;
  /** Set by `system/init` when the chat's MCP server is not usable: no turn can succeed. */
  failed?: string;
}

export const newClaudeState = (): ClaudeState => ({ tools: new Set() });

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A tool result's content: a string, or an array of parts of which the text ones are the answer. */
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content === undefined || content === null ? "" : JSON.stringify(content);
  return content
    .map((p) => (typeof p === "string" ? p : typeof obj(p)?.text === "string" ? (obj(p)!.text as string) : ""))
    .join("");
}

/**
 * The closing `result` line. Its `usage` adds every request of the turn up, so the turn's tokens are
 * read off it and not summed from the messages: new input is what was read fresh or written to the
 * cache, and `cached` what was read back from it.
 */
function endOf(d: Obj): RunEnd {
  const u = obj(d.usage);
  const usage: Usage | undefined = u
    ? {
        input: num(u.input_tokens) + num(u.cache_creation_input_tokens),
        output: num(u.output_tokens),
        cached: num(u.cache_read_input_tokens),
        ...(typeof d.total_cost_usd === "number" ? { cost: d.total_cost_usd } : {}),
      }
    : undefined;
  if (d.is_error !== true) return { usage };
  const said = typeof d.result === "string" && d.result.trim() ? d.result.trim() : "";
  return { usage, error: said || `Claude Code failed (${String(d.subtype ?? "error")})` };
}

/**
 * Why `system/init` says this turn cannot reach the vault: the `anydag` MCP server is missing,
 * failed, or listed no `mcp__anydag__*` tool. `undefined` when it is usable.
 *
 * The line is Claude Code's own account of what it was handed before it thought: a server that is
 * not `connected`, or a tool list without ours, means the model can only guess the tool names — which
 * is the turn that wrote `<invoke name=…>` as text and made no document.
 */
function initFailure(d: Obj): string | undefined {
  const servers = Array.isArray(d.mcp_servers) ? d.mcp_servers.map(obj).filter((s): s is Obj => s !== undefined) : [];
  const anydag = servers.find((s) => s.name === "anydag");
  if (!anydag) return "Claude Code started without the anydag MCP server, so the Assistant had no tools. Nothing was changed.";
  if (anydag.status !== "connected") {
    const status = typeof anydag.status === "string" && anydag.status ? anydag.status : "not connected";
    return `The anydag MCP server did not connect (${status}), so the Assistant had no tools. Nothing was changed.`;
  }
  const tools = Array.isArray(d.tools) ? d.tools : [];
  if (!tools.some((t) => typeof t === "string" && t.startsWith("mcp__anydag__")))
    return "The anydag MCP server connected but listed no tools, so the Assistant could not act. Nothing was changed.";
  return undefined;
}

/** One line of `--output-format stream-json`, as the events it means. A line that is not JSON is nothing. */
export function parseClaudeLine(line: string, st: ClaudeState): HarnessEvent[] {
  let d: Obj | undefined;
  try {
    d = obj(JSON.parse(line));
  } catch {
    return [];
  }
  if (!d) return [];
  switch (d.type) {
    case "system": {
      if (d.subtype !== "init") return [];
      const out: HarnessEvent[] = [];
      if (typeof d.session_id === "string") out.push({ kind: "session", id: d.session_id });
      const why = initFailure(d);
      if (why) {
        st.failed = why;
        out.push({ kind: "error", text: why });
      }
      return out;
    }
    case "stream_event": {
      const ev = obj(d.event);
      const delta = obj(ev?.delta);
      return ev?.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string" && delta.text
        ? [{ kind: "delta", text: delta.text }]
        : [];
    }
    case "assistant":
      return assistantEvents(d, st);
    case "user":
      return userEvents(d);
    case "result":
      st.end = endOf(d);
      return [];
    default:
      return [];
  }
}

function assistantEvents(d: Obj, st: ClaudeState): HarnessEvent[] {
  const content = obj(d.message)?.content;
  if (!Array.isArray(content)) return [];
  const out: HarnessEvent[] = [];
  for (const b of content) {
    const block = obj(b);
    if (block?.type === "text" && typeof block.text === "string" && block.text) out.push({ kind: "text", text: block.text });
    else if (
      block?.type === "tool_use" &&
      typeof block.id === "string" &&
      typeof block.name === "string" &&
      !st.tools.has(block.id)
    ) {
      st.tools.add(block.id);
      out.push({ kind: "tool", id: block.id, name: bareTool(block.name), input: block.input ?? {} });
    }
  }
  return out;
}

function userEvents(d: Obj): HarnessEvent[] {
  const content = obj(d.message)?.content;
  if (!Array.isArray(content)) return [];
  const out: HarnessEvent[] = [];
  for (const b of content) {
    const block = obj(b);
    if (block?.type === "tool_result" && typeof block.tool_use_id === "string")
      out.push({ kind: "result", id: block.tool_use_id, output: resultText(block.content), error: block.is_error === true });
  }
  return out;
}

export interface ClaudeOptions {
  /** `claude`, found where `findClaude` looks — `ANYDAG_CLAUDE_BIN`, the `PATH`, the installers' places — unless told. */
  bin?: string;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: typeof nodeSpawn;
}

export function claudeHarness(o: ClaudeOptions = {}): Harness {
  const spawn = o.spawnImpl ?? nodeSpawn;
  const baseEnv = (): NodeJS.ProcessEnv => o.env ?? process.env;

  function run(r: RunOptions, on: (e: HarnessEvent) => void): Running {
    fs.mkdirSync(r.scratch, { recursive: true });
    const files = { system: path.join(r.scratch, "system.md"), mcp: path.join(r.scratch, "mcp.json") };
    fs.writeFileSync(files.system, r.system);
    fs.writeFileSync(files.mcp, JSON.stringify(claudeMcpConfig(r.mcp)));

    const env = { ...claudeEnv(baseEnv()), MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) } as NodeJS.ProcessEnv;
    const found = findClaude(env);
    const bin = o.bin ?? (found.ok ? found.bin : "claude");
    const st = newClaudeState();
    let stopped = false;
    let killer: ReturnType<typeof setTimeout> | undefined;
    let stderr = "";
    let stopChild: () => void = () => undefined;

    const done = new Promise<RunEnd>((resolve) => {
      const child = spawn(bin, claudeRunArgs(r, files), { cwd: r.scratch, env, stdio: ["pipe", "pipe", "pipe"] });
      let settled = false;
      const settle = (end: RunEnd) => {
        if (settled) return;
        settled = true;
        clearTimeout(killer);
        resolve(end);
      };
      const reader = lines((line) => {
        /* An init line that says the MCP server is not usable ends the turn here: nothing the model
           says afterwards may reach the page, because it has no tools and can only guess. */
        if (st.failed) return;
        for (const e of parseClaudeLine(line, st)) on(e);
        if (st.failed) killer = terminate(child);
      });
      child.stdout?.on("data", (b: Buffer | string) => reader.push(b));
      child.stderr?.on("data", (b: Buffer | string) => (stderr += b.toString()));
      child.on("error", (e) => {
        on({ kind: "error", text: `could not start Claude Code: ${e.message}` });
        settle({ error: `could not start Claude Code: ${e.message}` });
      });
      child.on("close", (code) => {
        reader.flush();
        if (st.failed) return settle({ usage: st.end?.usage, error: st.failed });
        if (st.end) return settle(st.end);
        /* Stopped on purpose: the person asked, so it is not a failure however the process ended. */
        if (stopped) return settle({});
        const why = `Claude Code exited ${code}${stderr.trim() ? `: ${tail(stderr)}` : ""}`;
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

  /** The session's file under `<config>/projects/<project>/`, and the folder beside it, if there are any. */
  async function forget(session: string): Promise<void> {
    if (!/^[\w-]+$/.test(session)) return;
    const env = baseEnv();
    const root = path.join(env.CLAUDE_CONFIG_DIR?.trim() || path.join(env.HOME?.trim() || os.homedir(), ".claude"), "projects");
    try {
      for (const project of fs.readdirSync(root)) {
        fs.rmSync(path.join(root, project, `${session}.jsonl`), { force: true });
        fs.rmSync(path.join(root, project, session), { recursive: true, force: true });
      }
    } catch {
      /* no such folder, or one in use: a session file left behind is the person's, and harmless */
    }
  }

  return { provider: "claude", run, forget, close: async () => undefined };
}
