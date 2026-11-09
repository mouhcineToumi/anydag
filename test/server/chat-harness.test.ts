import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  claudeHarness,
  claudeMcpConfig,
  claudeRunArgs,
  newClaudeState,
  parseClaudeLine,
  resultText,
} from "../../server/chat/claude";
import type { HarnessEvent, RunOptions } from "../../server/chat/harness";
import {
  newOpencodeState,
  offeredNoTools,
  opencodeHarness,
  opencodeRunArgs,
  opencodeRunConfig,
  parseOpencodeLine,
} from "../../server/chat/opencode";

/*
 * Every line below is one the real tools' event streams hold — Claude Code 2.1.319 and OpenCode
 * 2.2.5, trimmed of fields nothing here reads and of the length of a tool's answer. The two marked
 * *made up* are shapes neither stream produced: a failed `result`, and a tool call still running.
 */

const INIT = {
  type: "system",
  subtype: "init",
  session_id: "53901487-be01-4a2e-8bd4-b73691ca3143",
  mcp_servers: [{ name: "anydag", status: "connected", source: "dynamic" }],
  tools: ["mcp__anydag__doc_create", "mcp__anydag__doc_list", "mcp__anydag__change_block", "Read"],
  model: "claude-opus-5-5",
};
/** The same line when the chat's MCP server is missing, failed, or connected with no tools of ours. */
const INIT_NO_SERVER = { ...INIT, mcp_servers: [] };
const INIT_FAILED = { ...INIT, mcp_servers: [{ name: "anydag", status: "failed", source: "dynamic" }] };
const INIT_NO_TOOLS = { ...INIT, tools: ["Read", "Bash"] };
const TEXT_DELTA = {
  type: "stream_event",
  event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The vault has two notes." } },
  session_id: "53901487-be01-4a2e-8bd4-b73691ca3143",
  parent_tool_use_id: null,
};
const JSON_DELTA = {
  type: "stream_event",
  event: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"name": "Meeting-' } },
  parent_tool_use_id: null,
};
const ASSISTANT_TOOL = {
  type: "assistant",
  message: {
    model: "claude-opus-5-5",
    id: "msg_011CgnVS6Jhhc5dbmYgMrgWi",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_01Tpc4G5y4nqmnQacJxnjuv1",
        name: "mcp__anydag__note_read",
        input: { name: "Meeting-notes" },
        caller: { type: "direct" },
      },
    ],
  },
  parent_tool_use_id: null,
};
const USER_RESULT = {
  type: "user",
  message: {
    role: "user",
    content: [
      {
        tool_use_id: "toolu_01Tpc4G5y4nqmnQacJxnjuv1",
        type: "tool_result",
        content: [{ type: "text", text: '{\n  "name": "Meeting-notes",\n  "id": "dm4rzbqm0g"' }],
      },
    ],
  },
};
const USER_STRING_ERR = {
  type: "user",
  message: {
    role: "user",
    content: [
      { type: "tool_result", content: "Connection closed", is_error: true, tool_use_id: "toolu_01MXC25TRtHrjt2RFJZrdRs9" },
    ],
  },
};
const ASSISTANT_TEXT = {
  type: "assistant",
  message: {
    content: [
      {
        type: "text",
        text: "The vault has two notes. Neither one is a task, project or event.\n\n1. **Meeting notes** (`Meeting-notes`)",
      },
    ],
  },
};
const ASSISTANT_THINKING = { type: "assistant", message: { content: [{ type: "thinking", thinking: "", signature: "x" }] } };
const RESULT = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "The vault has two notes.",
  session_id: "53901487-be01-4a2e-8bd4-b73691ca3143",
  total_cost_usd: 0.2528235,
  usage: { input_tokens: 6, cache_creation_input_tokens: 29462, cache_read_input_tokens: 58188, output_tokens: 267 },
};
/** Made up: the shape `is_error` has on a `result`, which no real stream held. */
const RESULT_ERROR = {
  type: "result",
  subtype: "error_during_execution",
  is_error: true,
  result: "API Error: 529 overloaded",
  usage: { input_tokens: 2, output_tokens: 0 },
};

const OC_STEP_START = {
  type: "step_start",
  timestamp: 1794005969217,
  sessionID: "ses_e4ce95bc4ffeIB1FWrHM56YMPD",
  part: { id: "prt_1b316a941001TJPONQAoTKVK5P", type: "step-start" },
};
const OC_TOOL = {
  type: "tool_use",
  timestamp: 1794005969442,
  sessionID: "ses_e4ce95bc4ffeIB1FWrHM56YMPD",
  part: {
    partID: "prt_1b316a9b1002pAZjCkoQRWNJtD",
    type: "tool",
    id: "chatcmpl-tool-86207df1a487d872",
    tool: "anydag_note_list",
    state: {
      status: "completed",
      input: {},
      output: '{\n  "notes": [\n    "Meeting-notes"',
      time: { start: 1794005969329, end: 1794005969442 },
    },
  },
};
const OC_STEP_FINISH_TOOLS = {
  type: "step_finish",
  sessionID: "ses_e4ce95bc4ffeIB1FWrHM56YMPD",
  part: {
    type: "step-finish",
    reason: "tool-calls",
    cost: 0,
    tokens: { input: 19950, output: 8, reasoning: 11, cache: { read: 0, write: 0 } },
  },
};
const OC_TEXT = {
  type: "text",
  sessionID: "ses_e4ce95bc4ffeIB1FWrHM56YMPD",
  part: {
    id: "prt_1b316bfd7001HDM4tOCbEGi3ED_text-0",
    type: "text",
    text: 'Done — created the note **"Spike test OC"** with one paragraph.',
  },
};
const OC_STEP_FINISH_STOP = {
  type: "step_finish",
  sessionID: "ses_e4ce95bc4ffeIB1FWrHM56YMPD",
  part: {
    type: "step-finish",
    reason: "stop",
    cost: 0,
    tokens: { input: 1050, output: 69, reasoning: 0, cache: { read: 19584, write: 0 } },
  },
};
/** The model reached for `skill`, the one tool a run that started before the MCP server attached has. */
const OC_SKILL = {
  type: "tool_use",
  sessionID: "ses_e4ce2ce47ffe2zTQoW41hLNLs0",
  part: {
    partID: "prt_1b31d4143001WIMsD1np7dJrQB",
    type: "tool",
    id: "chatcmpl-tool-877d9f995cc3d1a6",
    tool: "skill",
    state: { status: "error", input: { id: "slow_approve_and_write" }, error: "Unable to load skill slow_approve_and_write" },
  },
};
const OC_ERROR = {
  type: "error",
  timestamp: 1794006438629,
  sessionID: "ses_e4ce23b9fffewRHlnT42ZA4dO5",
  error: { type: "unknown", message: "Transport: ECONNRESET: The socket connection was closed unexpectedly." },
};
/** Made up: a call that has started and not finished, which 2.2.5 does not send. */
const OC_RUNNING = {
  type: "tool_use",
  sessionID: "ses_x",
  part: { id: "t1", type: "tool", tool: "anydag_note_read", state: { status: "running", input: {} } },
};

const line = (o: unknown) => JSON.stringify(o);
const claudeEvents = (...ls: unknown[]) => {
  const st = newClaudeState();
  return { events: ls.flatMap((l) => parseClaudeLine(line(l), st)), st };
};
const ocEvents = (...ls: unknown[]) => {
  const st = newOpencodeState();
  return { events: ls.flatMap((l) => parseOpencodeLine(line(l), st)), st };
};

describe("Claude Code's stream", () => {
  it("opens a session on init, and says nothing of the other system lines", () => {
    expect(claudeEvents(INIT).events).toEqual([{ kind: "session", id: INIT.session_id }]);
    expect(claudeEvents({ type: "system", subtype: "status", status: "requesting", session_id: "x" }).events).toEqual([]);
  });

  it("fails the turn from init when anydag is missing, not connected, or has no tool", () => {
    const absent = claudeEvents(INIT_NO_SERVER);
    expect(absent.events).toEqual([
      { kind: "session", id: INIT.session_id },
      { kind: "error", text: expect.stringContaining("without the anydag MCP server") },
    ]);
    expect(absent.st.failed).toContain("Nothing was changed");

    const failed = claudeEvents(INIT_FAILED);
    expect(failed.events.at(-1)).toEqual({ kind: "error", text: expect.stringContaining("did not connect (failed)") });
    expect(failed.st.failed).toContain("no tools");

    const toolLess = claudeEvents(INIT_NO_TOOLS);
    expect(toolLess.events.at(-1)).toEqual({ kind: "error", text: expect.stringContaining("listed no tools") });
    expect(toolLess.st.failed).toContain("Nothing was changed");

    expect(claudeEvents(INIT).st.failed).toBeUndefined();
  });

  it("turns text deltas into deltas and ignores a tool input arriving in pieces", () => {
    expect(claudeEvents(TEXT_DELTA, JSON_DELTA).events).toEqual([{ kind: "delta", text: "The vault has two notes." }]);
  });

  it("names a tool call once it is whole, without the server's prefix", () => {
    const { events, st } = claudeEvents(ASSISTANT_TOOL);
    expect(events).toEqual([
      { kind: "tool", id: "toolu_01Tpc4G5y4nqmnQacJxnjuv1", name: "note_read", input: { name: "Meeting-notes" } },
    ]);
    expect(st.tools.has("toolu_01Tpc4G5y4nqmnQacJxnjuv1")).toBe(true);
    /* a message that repeats a block cannot call it twice */
    expect(parseClaudeLine(line(ASSISTANT_TOOL), st)).toEqual([]);
  });

  it("closes a text run with a text event and skips thinking", () => {
    expect(claudeEvents(ASSISTANT_TEXT).events).toEqual([{ kind: "text", text: ASSISTANT_TEXT.message.content[0]!.text }]);
    expect(claudeEvents(ASSISTANT_THINKING).events).toEqual([]);
  });

  it("reads a tool result as an array of parts or as a string, and carries is_error", () => {
    expect(claudeEvents(USER_RESULT).events).toEqual([
      {
        kind: "result",
        id: "toolu_01Tpc4G5y4nqmnQacJxnjuv1",
        output: '{\n  "name": "Meeting-notes",\n  "id": "dm4rzbqm0g"',
        error: false,
      },
    ]);
    expect(claudeEvents(USER_STRING_ERR).events).toEqual([
      { kind: "result", id: "toolu_01MXC25TRtHrjt2RFJZrdRs9", output: "Connection closed", error: true },
    ]);
    expect(resultText([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }])).toBe("ab");
  });

  it("ends on the result line: usage as the turn's total, and its cost", () => {
    const { events, st } = claudeEvents(RESULT);
    expect(events).toEqual([]);
    expect(st.end).toEqual({ usage: { input: 6 + 29462, output: 267, cached: 58188, cost: 0.2528235 } });
  });

  it("makes a failed result the turn's error, with the words it gave", () => {
    expect(claudeEvents(RESULT_ERROR).st.end?.error).toBe("API Error: 529 overloaded");
    expect(claudeEvents({ ...RESULT_ERROR, result: "" }).st.end?.error).toBe("Claude Code failed (error_during_execution)");
  });

  it("takes a line that is not JSON for nothing", () => {
    expect(parseClaudeLine("Warning: no stdin data received in 3s", newClaudeState())).toEqual([]);
    expect(parseClaudeLine("[1,2]", newClaudeState())).toEqual([]);
  });
});

describe("Claude Code's flags", () => {
  const base: RunOptions = {
    chat: "c",
    model: "claude-haiku-5-5",
    system: "s",
    prompt: "p",
    mcp: { command: "node", args: ["cli.mjs", "mcp", "--chat", "c"], env: { A: "1" } },
    scratch: "/tmp/x",
  };
  const files = { system: "/tmp/x/system.md", mcp: "/tmp/x/mcp.json" };

  it("gives a new session the argv it is meant to run with", () => {
    expect(claudeRunArgs({ ...base, fresh: "uuid-1" }, files)).toEqual([
      "-p",
      "--model",
      "claude-haiku-5-5",
      "--session-id",
      "uuid-1",
      "--strict-mcp-config",
      "--mcp-config",
      "/tmp/x/mcp.json",
      "--tools",
      "",
      "--allowedTools",
      "mcp__anydag__*",
      "--setting-sources",
      "",
      "--disable-slash-commands",
      "--system-prompt-file",
      "/tmp/x/system.md",
      "--system-prompt-snapshot",
      "off",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ]);
  });

  it("resumes with --resume and never also names a new id; adds --effort only when asked", () => {
    const a = claudeRunArgs({ ...base, resume: "old", fresh: "new", effort: "high" }, files);
    expect(a).toContain("--resume");
    expect(a[a.indexOf("--resume") + 1]).toBe("old");
    expect(a).not.toContain("--session-id");
    expect(a.slice(a.indexOf("--effort"), a.indexOf("--effort") + 2)).toEqual(["--effort", "high"]);
    expect(claudeRunArgs({ ...base, fresh: "n" }, files)).not.toContain("--effort");
  });

  it("makes up an id when neither was given, and never uses --safe-mode, which turns MCP off", () => {
    const a = claudeRunArgs(base, files);
    expect(a[a.indexOf("--session-id") + 1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toContain("--safe-mode");
  });

  it("writes the one server in the shape --mcp-config reads", () => {
    expect(claudeMcpConfig(base.mcp)).toEqual({
      mcpServers: { anydag: { type: "stdio", command: "node", args: ["cli.mjs", "mcp", "--chat", "c"], env: { A: "1" } } },
    });
  });
});

/* ---- a fake process ---- */

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  stdinText = "";
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  signals: string[] = [];
  /** Which signals end it; none means it ignores them until something else closes it. */
  dies: string[] = ["SIGTERM", "SIGKILL"];
  constructor() {
    super();
    this.stdin.on("data", (b: Buffer) => (this.stdinText += b.toString()));
  }
  kill(sig: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(sig);
    if (this.dies.includes(sig)) setImmediate(() => this.end(null, sig));
    return true;
  }
  end(code: number | null, sig: NodeJS.Signals | null = null) {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = sig;
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("close", code, sig));
  }
}

type Spawned = { bin: string; args: string[]; opts: { cwd?: string; env?: NodeJS.ProcessEnv }; child: FakeChild };
const fakeSpawn = (script: (s: Spawned) => void) => {
  const calls: Spawned[] = [];
  const impl = ((bin: string, args: string[], opts: Spawned["opts"]) => {
    const s = { bin, args, opts, child: new FakeChild() };
    calls.push(s);
    setImmediate(() => script(s));
    return s.child;
  }) as never;
  return { impl, calls };
};
const emit = (c: FakeChild, ...ls: unknown[]) =>
  c.stdout.write(ls.map((l) => (typeof l === "string" ? l : line(l)) + "\n").join(""));

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chat-harness-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const runOptions = (over: Partial<RunOptions> = {}): RunOptions => ({
  chat: "c1",
  model: "claude-haiku-5-5",
  system: "You are the Assistant.",
  prompt: "List my notes — please",
  fresh: "11111111-1111-1111-1111-111111111111",
  mcp: { command: "node", args: ["cli.mjs", "mcp", "--chat", "c1"], env: { ANYDAG_HOME: "/h" } },
  scratch: path.join(tmp, "scratch"),
  ...over,
});

describe("the Claude harness", () => {
  it("finds Claude Code where its installer put it, though the PATH has not got it", async () => {
    /* A desktop app started from a menu has no login shell's PATH, and ~/.local/bin is not on it. */
    const bin = path.join(tmp, ".local", "bin", "claude");
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
    const sp = fakeSpawn(({ child }) => {
      emit(child, RESULT);
      child.end(0);
    });
    await claudeHarness({ env: { PATH: "/nonexistent", HOME: tmp }, spawnImpl: sp.impl }).run(runOptions(), () => undefined).done;
    expect(sp.calls[0]!.bin).toBe(bin);
  });

  it("writes the system prompt and MCP config, sends the prompt on stdin and reads the stream", async () => {
    const sp = fakeSpawn(({ child }) => {
      /* cut a line in two, in the middle of a multi-byte character */
      const buf = Buffer.from(line(ASSISTANT_TEXT).replace("two notes", "deux notés") + "\n");
      emit(child, INIT, TEXT_DELTA, ASSISTANT_TOOL, USER_RESULT);
      child.stdout.write(buf.subarray(0, 60));
      child.stdout.write(buf.subarray(60));
      emit(child, RESULT);
      child.end(0);
    });
    const events: HarnessEvent[] = [];
    const h = claudeHarness({
      bin: "claude",
      env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-no", CLAUDECODE: "1" },
      spawnImpl: sp.impl,
    });
    const r = runOptions({ effort: "low" });
    const end = await h.run(r, (e) => events.push(e)).done;

    expect(events.map((e) => e.kind)).toEqual(["session", "delta", "tool", "result", "text"]);
    expect((events[4] as { text: string }).text).toContain("deux notés");
    expect(end).toEqual({ usage: { input: 29468, output: 267, cached: 58188, cost: 0.2528235 } });

    const call = sp.calls[0]!;
    expect(call.bin).toBe("claude");
    expect(call.opts.cwd).toBe(r.scratch);
    expect(call.child.stdinText).toBe(r.prompt);
    expect(call.opts.env?.MCP_TOOL_TIMEOUT).toBe("600000");
    /* init must not arrive while the anydag server is still pending, or the init check fails a good turn */
    expect(call.opts.env?.MCP_CONNECTION_NONBLOCKING).toBe("0");
    /* the person's subscription, not a key; and not inside another Claude Code's own session */
    expect(call.opts.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(call.opts.env?.CLAUDECODE).toBeUndefined();
    expect(fs.readFileSync(path.join(r.scratch, "system.md"), "utf8")).toBe(r.system);
    expect(JSON.parse(fs.readFileSync(path.join(r.scratch, "mcp.json"), "utf8"))).toEqual(claudeMcpConfig(r.mcp));
    expect(call.args).toContain("--system-prompt-file");
  });

  it("reports a failed result as the turn's error", async () => {
    const sp = fakeSpawn(({ child }) => {
      emit(child, INIT, RESULT_ERROR);
      child.end(1);
    });
    const end = await claudeHarness({ bin: "claude", spawnImpl: sp.impl }).run(runOptions(), () => undefined).done;
    expect(end.error).toBe("API Error: 529 overloaded");
  });

  it("stops a run whose init says the MCP server is not usable, and keeps its guess out of the turn", async () => {
    const sp = fakeSpawn(({ child }) => {
      /* The model goes on and writes the call as text: none of it may reach the page. */
      emit(child, INIT_FAILED, ASSISTANT_TEXT, RESULT);
    });
    const events: HarnessEvent[] = [];
    const end = await claudeHarness({ bin: "claude", spawnImpl: sp.impl }).run(runOptions(), (e) => events.push(e)).done;
    expect(end.error).toContain("did not connect (failed)");
    expect(end.error).toContain("Nothing was changed");
    expect(events.filter((e) => e.kind === "error")).toHaveLength(1);
    expect(events.some((e) => e.kind === "text")).toBe(false);
    expect(sp.calls[0]!.child.signals).toContain("SIGTERM");
  });

  it("reports an exit with no result, with the end of stderr", async () => {
    const sp = fakeSpawn(({ child }) => {
      child.stderr.write("Error: not logged in\nRun claude auth login\n");
      setImmediate(() => child.end(1));
    });
    const events: HarnessEvent[] = [];
    const end = await claudeHarness({ bin: "claude", spawnImpl: sp.impl }).run(runOptions(), (e) => events.push(e)).done;
    expect(end.error).toBe("Claude Code exited 1: Error: not logged in Run claude auth login");
    expect(events).toEqual([{ kind: "error", text: end.error! }]);
  });

  it("reports a binary that will not start, and does not throw", async () => {
    const sp = fakeSpawn(({ child }) => child.emit("error", new Error("spawn claude ENOENT")));
    const end = await claudeHarness({ bin: "claude", spawnImpl: sp.impl }).run(runOptions(), () => undefined).done;
    expect(end.error).toBe("could not start Claude Code: spawn claude ENOENT");
  });

  it("stops with SIGTERM, settles done with no error, and does not leave a SIGKILL behind", async () => {
    const sp = fakeSpawn(({ child }) => emit(child, INIT, TEXT_DELTA));
    const run = claudeHarness({ bin: "claude", spawnImpl: sp.impl }).run(runOptions(), () => undefined);
    await new Promise((r) => setTimeout(r, 20));
    await run.stop();
    expect(await run.done).toEqual({});
    expect(sp.calls[0]!.child.signals).toEqual(["SIGTERM"]);
  });

  it("sends SIGKILL after five seconds to a process that ignores SIGTERM", async () => {
    const sp = fakeSpawn(({ child }) => {
      child.dies = ["SIGKILL"];
      emit(child, INIT);
    });
    const run = claudeHarness({ bin: "claude", spawnImpl: sp.impl }).run(runOptions(), () => undefined);
    await new Promise((r) => setTimeout(r, 20));
    const t0 = Date.now();
    await run.stop();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4_900);
    expect(sp.calls[0]!.child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(await run.done).toEqual({});
  }, 15_000);

  it("keeps a result that arrived before the stop", async () => {
    const sp = fakeSpawn(({ child }) => {
      emit(child, INIT, RESULT);
      child.end(0);
    });
    const run = claudeHarness({ bin: "claude", spawnImpl: sp.impl }).run(runOptions(), () => undefined);
    await run.done;
    await run.stop();
    expect((await run.done).usage?.output).toBe(267);
  });

  it("forgets a session's file and folder in every project, and nothing else", async () => {
    const config = path.join(tmp, "claude");
    const sid = "22222222-2222-2222-2222-222222222222";
    for (const p of ["-a", "-b"]) fs.mkdirSync(path.join(config, "projects", p, sid), { recursive: true });
    fs.writeFileSync(path.join(config, "projects", "-a", `${sid}.jsonl`), "{}");
    fs.writeFileSync(path.join(config, "projects", "-a", "other.jsonl"), "{}");
    const h = claudeHarness({ env: { CLAUDE_CONFIG_DIR: config } });
    await h.forget(sid);
    expect(fs.readdirSync(path.join(config, "projects", "-a"))).toEqual(["other.jsonl"]);
    expect(fs.readdirSync(path.join(config, "projects", "-b"))).toEqual([]);
    /* an id that could climb out is refused, and a missing folder is not an error */
    await h.forget("../other");
    await claudeHarness({ env: { CLAUDE_CONFIG_DIR: path.join(tmp, "none") } }).forget(sid);
    expect(fs.existsSync(path.join(config, "projects", "-a", "other.jsonl"))).toBe(true);
  });
});

/* ---- OpenCode ---- */

describe("OpenCode's stream", () => {
  it("opens the session on the first line that names one, once", () => {
    const { events } = ocEvents(OC_STEP_START, OC_TEXT);
    expect(events.filter((e) => e.kind === "session")).toEqual([{ kind: "session", id: "ses_e4ce95bc4ffeIB1FWrHM56YMPD" }]);
  });

  it("makes a finished tool call a tool and its result, the name without the server's prefix", () => {
    expect(ocEvents(OC_TOOL).events.filter((e) => e.kind !== "session")).toEqual([
      { kind: "tool", id: "chatcmpl-tool-86207df1a487d872", name: "note_list", input: {} },
      { kind: "result", id: "chatcmpl-tool-86207df1a487d872", output: '{\n  "notes": [\n    "Meeting-notes"', error: false },
    ]);
  });

  it("makes a call that failed an error result with its message, and skips one still running", () => {
    const { events } = ocEvents(OC_SKILL, OC_RUNNING);
    expect(events.filter((e) => e.kind !== "session")).toEqual([
      { kind: "tool", id: "chatcmpl-tool-877d9f995cc3d1a6", name: "skill", input: { id: "slow_approve_and_write" } },
      {
        kind: "result",
        id: "chatcmpl-tool-877d9f995cc3d1a6",
        output: "Unable to load skill slow_approve_and_write",
        error: true,
      },
    ]);
  });

  it("hands a whole text over as it is", () => {
    expect(ocEvents(OC_TEXT).events.filter((e) => e.kind === "text")).toEqual([{ kind: "text", text: OC_TEXT.part.text }]);
  });

  it("adds tokens up across steps: reasoning as output, cache reads as cached", () => {
    const { st } = ocEvents(OC_STEP_START, OC_TOOL, OC_STEP_FINISH_TOOLS, OC_TEXT, OC_STEP_FINISH_STOP);
    expect(st.usage).toEqual({ input: 19950 + 1050, output: 8 + 11 + 69, cached: 19584, cost: 0 });
  });

  it("reports an error event in both of the shapes OpenCode has used", () => {
    const a = ocEvents(OC_ERROR);
    expect(a.events.at(-1)).toEqual({
      kind: "error",
      text: "Transport: ECONNRESET: The socket connection was closed unexpectedly.",
    });
    expect(a.st.error).toContain("ECONNRESET");
    expect(ocEvents({ type: "error", error: { data: { message: "no login" } } }).st.error).toBe("no login");
    expect(ocEvents({ type: "error", error: { name: "ProviderAuthError" } }).st.error).toBe("ProviderAuthError");
  });

  it("knows a first step that found no vault tools by the call to skill, and nothing else", () => {
    expect(offeredNoTools(ocEvents(OC_STEP_START, OC_SKILL, OC_STEP_FINISH_TOOLS).st)).toBe(true);
    expect(offeredNoTools(ocEvents(OC_STEP_START, OC_TOOL, OC_STEP_FINISH_TOOLS).st)).toBe(false);
    expect(offeredNoTools(ocEvents(OC_STEP_START, OC_TEXT, OC_STEP_FINISH_STOP).st)).toBe(false);
    /* only the first step counts: a later step reaching for skill is the model's own doing */
    expect(ocEvents(OC_STEP_START, OC_TOOL, OC_STEP_FINISH_TOOLS, OC_SKILL).st.first.tools).toEqual(["anydag_note_list"]);
  });

  it("takes a line that is not JSON for nothing", () => {
    expect(parseOpencodeLine("Performing one time database migration...", newOpencodeState())).toEqual([]);
  });
});

describe("OpenCode's config and flags", () => {
  const mcp = { command: "node", args: ["cli.mjs", "mcp", "--chat", "c1"], env: { ANYDAG_HOME: "/h" } };

  it("is the config a run sends, permissions in the order that makes the last match win", () => {
    const c = opencodeRunConfig(mcp, "/tmp/s/system.md") as Record<string, any>;
    expect(c).toEqual({
      autoupdate: false,
      mcp: {
        anydag: {
          type: "local",
          command: ["node", "cli.mjs", "mcp", "--chat", "c1"],
          environment: { ANYDAG_HOME: "/h" },
          codemode: false,
          timeout: 600000,
          enabled: true,
        },
      },
      agent: {
        "dag-assistant": {
          mode: "primary",
          prompt: "{file:/tmp/s/system.md}",
          permission: { "*": "deny", skill: "deny", "anydag_*": "allow" },
        },
      },
    });
    expect(Object.keys(c.agent["dag-assistant"].permission)).toEqual(["*", "skill", "anydag_*"]);
  });

  it("puts the effort after a # and never writes --variant or --dir", () => {
    const a = opencodeRunArgs({ url: "http://127.0.0.1:4000", model: "opencode-go/glm-5.3-flash", effort: "max" });
    expect(a).toEqual([
      "run",
      "--server",
      "http://127.0.0.1:4000",
      "-m",
      "opencode-go/glm-5.3-flash#max",
      "--agent",
      "dag-assistant",
      "--format",
      "json",
    ]);
    expect(a).not.toContain("--variant");
    expect(a).not.toContain("--dir");
    expect(opencodeRunArgs({ url: "u", model: "m", resume: "ses_1" }).slice(-2)).toEqual(["--session", "ses_1"]);
    expect(opencodeRunArgs({ url: "u", model: "m" })).not.toContain("--session");
  });
});

/* ---- the OpenCode harness, over a fake serve and a fake client ---- */

const SERVE_LOG = "server listening on http://127.0.0.1:4101\nserver password sekret-pw\n";
const turnLines = (session: string, ...mid: unknown[]) => [
  { ...OC_STEP_START, sessionID: session },
  ...mid,
  { ...OC_TEXT, sessionID: session },
  { ...OC_STEP_FINISH_STOP, sessionID: session },
];

/** A spawn that answers `serve` with its banner and each `run` with the next canned turn. */
function opencodeWorld(turns: unknown[][], opts: { onRun?: (s: Spawned) => void } = {}) {
  let n = 0;
  const serves: Spawned[] = [];
  const runs: Spawned[] = [];
  const sp = fakeSpawn((s) => {
    if (s.args[0] === "serve") {
      serves.push(s);
      s.child.stderr.write(SERVE_LOG);
    } else if (s.args[0] === "run") {
      runs.push(s);
      if (opts.onRun) return opts.onRun(s);
      const out = s.child.stdinText === "Reply with OK." ? turnLines("ses_warm") : (turns[n++] ?? turnLines("ses_extra"));
      emit(s.child, ...out);
      s.child.end(0);
    } else if (s.args[0] === "session") {
      runs.push(s);
      setImmediate(() => s.child.end(0));
    }
  });
  const fetched: { method: string; url: string; auth?: string }[] = [];
  const fetchCall = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    fetched.push({ method: init.method, url, auth: init.headers.Authorization });
    if (url.endsWith("/api/mcp")) return { json: async () => ({ data: [{ name: "anydag", status: { status: "connected" } }] }) };
    return { json: async () => ({}) };
  };
  return { sp, serves, runs, fetched, fetchCall, fetchImpl: fetchCall as never };
}

describe("the OpenCode harness", () => {
  it("starts a serve for the chat, waits for the MCP server, warms it, and then runs the turn through it", async () => {
    const w = opencodeWorld([turnLines("ses_real", OC_TOOL)]);
    const h = opencodeHarness({
      bin: "opencode",
      env: { PATH: "/usr/bin", OPENCODE_CONFIG_CONTENT: "{}" },
      spawnImpl: w.sp.impl,
      fetchImpl: w.fetchImpl,
      tmpRoot: tmp,
    });
    const events: HarnessEvent[] = [];
    const r = runOptions({ model: "opencode-go/glm-5.3-flash", effort: "max" });
    const end = await h.run(r, (e) => events.push(e)).done;

    expect(w.serves).toHaveLength(1);
    const serve = w.serves[0]!;
    expect(serve.args).toEqual(["serve", "--port", "0", "--hostname", "127.0.0.1"]);
    const xdg = serve.opts.env!.XDG_CONFIG_HOME!;
    expect(fs.readdirSync(xdg)).toEqual([]);
    const cfg = JSON.parse(serve.opts.env!.OPENCODE_CONFIG_CONTENT!);
    expect(cfg.mcp.anydag.command).toEqual(["node", "cli.mjs", "mcp", "--chat", "c1"]);
    const promptFile = /^\{file:(.+)\}$/.exec(cfg.agent["dag-assistant"].prompt)![1]!;
    expect(fs.readFileSync(promptFile, "utf8")).toBe(r.system);

    /* the warm-up first, on its own throwaway session, which is then deleted; the turn second */
    expect(w.runs.map((c) => c.child.stdinText)).toEqual(["Reply with OK.", r.prompt]);
    expect(w.runs[0]!.args).toContain("dag-warm");
    expect(w.runs[1]!.args).toEqual(opencodeRunArgs({ url: "http://127.0.0.1:4101", model: r.model, effort: "max" }));
    expect(w.runs[1]!.opts.env!.OPENCODE_PASSWORD).toBe("sekret-pw");
    expect(w.runs[1]!.opts.env!.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    expect(w.fetched.some((f) => f.method === "DELETE" && f.url.endsWith("/api/session/ses_warm"))).toBe(true);
    expect(w.fetched[0]!.auth).toBe(`Basic ${Buffer.from("opencode:sekret-pw").toString("base64")}`);

    expect(events.map((e) => e.kind)).toEqual(["session", "tool", "result", "text"]);
    expect(end).toEqual({ usage: { input: 1050, output: 69, cached: 19584, cost: 0 } });
    await h.close();
  });

  it("reuses the serve for the next turn, resumes the session, and replaces it when the system prompt changes", async () => {
    const w = opencodeWorld([turnLines("ses_1"), turnLines("ses_1"), turnLines("ses_1")]);
    const h = opencodeHarness({ bin: "opencode", env: {}, spawnImpl: w.sp.impl, fetchImpl: w.fetchImpl, tmpRoot: tmp });
    await h.run(runOptions(), () => undefined).done;
    await h.run(runOptions({ resume: "ses_1" }), () => undefined).done;
    expect(w.serves).toHaveLength(1);
    expect(w.runs.at(-1)!.args.slice(-2)).toEqual(["--session", "ses_1"]);

    /* `{file:}` is read once, so a new system prompt is a new serve */
    await h.run(runOptions({ resume: "ses_1", system: "Edit mode now." }), () => undefined).done;
    expect(w.serves).toHaveLength(2);
    expect(w.serves[0]!.child.signals).toContain("SIGTERM");
    const dirs = fs.readdirSync(tmp).filter((d) => d.startsWith("dag-opencode-"));
    expect(dirs).toHaveLength(1);
    await h.close();
    expect(fs.readdirSync(tmp).filter((d) => d.startsWith("dag-opencode-"))).toEqual([]);
    expect(w.serves[1]!.child.signals).toContain("SIGTERM");
  });

  it("keeps one serve per chat", async () => {
    const w = opencodeWorld([]);
    const h = opencodeHarness({ bin: "opencode", env: {}, spawnImpl: w.sp.impl, fetchImpl: w.fetchImpl, tmpRoot: tmp });
    await Promise.all([
      h.run(runOptions({ chat: "a" }), () => undefined).done,
      h.run(runOptions({ chat: "b" }), () => undefined).done,
    ]);
    expect(w.serves).toHaveLength(2);
    await h.close();
  });

  it("drops a first step that found no vault tools, deletes its session, and runs the turn again", async () => {
    const lost = [
      { ...OC_STEP_START, sessionID: "ses_lost" },
      { ...OC_SKILL, sessionID: "ses_lost" },
      { ...OC_STEP_FINISH_TOOLS, sessionID: "ses_lost" },
      { ...OC_TEXT, sessionID: "ses_lost", part: { ...OC_TEXT.part, text: "I have no tools." } },
    ];
    const w = opencodeWorld([lost, turnLines("ses_good", OC_TOOL)]);
    const h = opencodeHarness({ bin: "opencode", env: {}, spawnImpl: w.sp.impl, fetchImpl: w.fetchImpl, tmpRoot: tmp });
    const events: HarnessEvent[] = [];
    const end = await h.run(runOptions(), (e) => events.push(e)).done;
    /* nothing of the lost attempt reached the caller but its session, and the last session heard is the retry's */
    expect(events.map((e) => e.kind)).toEqual(["session", "session", "tool", "result", "text"]);
    expect(events[1]).toEqual({ kind: "session", id: "ses_good" });
    expect(JSON.stringify(events)).not.toContain("I have no tools");
    expect(w.fetched.some((f) => f.method === "DELETE" && f.url.endsWith("/api/session/ses_lost"))).toBe(true);
    expect(end.error).toBeUndefined();
    expect(w.runs.filter((c) => c.child.stdinText !== "Reply with OK.")).toHaveLength(2);
    await h.close();
  });

  it("reports a client that exits with an error event", async () => {
    const w = opencodeWorld([[{ ...OC_STEP_START }, OC_ERROR]]);
    const h = opencodeHarness({ bin: "opencode", env: {}, spawnImpl: w.sp.impl, fetchImpl: w.fetchImpl, tmpRoot: tmp });
    const events: HarnessEvent[] = [];
    const end = await h.run(runOptions(), (e) => events.push(e)).done;
    expect(end.error).toContain("ECONNRESET");
    expect(events.at(-1)).toMatchObject({ kind: "error" });
    await h.close();
  });

  it("reports a serve that will not start, and does not throw", async () => {
    const sp = fakeSpawn((s) => {
      s.child.stderr.write("Error: port in use\n");
      s.child.end(1);
    });
    const h = opencodeHarness({
      bin: "opencode",
      env: {},
      spawnImpl: sp.impl,
      fetchImpl: (async () => ({ json: async () => ({}) })) as never,
      tmpRoot: tmp,
    });
    const events: HarnessEvent[] = [];
    const end = await h.run(runOptions(), (e) => events.push(e)).done;
    expect(end.error).toBe("opencode serve exited 1: Error: port in use");
    expect(events).toEqual([{ kind: "error", text: end.error! }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(fs.readdirSync(tmp).filter((d) => d.startsWith("dag-opencode-"))).toEqual([]);
  });

  it("fails the turn when OpenCode reports the anydag MCP server failed to start", async () => {
    const w = opencodeWorld([]);
    const fetchImpl = (async (url: string, init: { method: string; headers: Record<string, string> }) => {
      if (url.endsWith("/api/mcp"))
        return { json: async () => ({ data: [{ name: "anydag", status: { status: "failed", error: "boom" } }] }) };
      return w.fetchCall(url, init);
    }) as never;
    const h = opencodeHarness({ bin: "opencode", env: {}, spawnImpl: w.sp.impl, fetchImpl, tmpRoot: tmp });
    const events: HarnessEvent[] = [];
    const end = await h.run(runOptions(), (e) => events.push(e)).done;
    expect(end.error).toContain("the anydag MCP server failed to start: boom");
    expect(events).toEqual([{ kind: "error", text: end.error! }]);
    expect(w.runs).toEqual([]);
    expect(w.serves[0]!.child.signals).toContain("SIGTERM");
    await h.close();
  });

  it("stops by interrupting the session, never by killing the client, and settles done with no error", async () => {
    const live: { client?: Spawned } = {};
    const w = opencodeWorld([], {
      onRun: (s) => {
        if (s.child.stdinText === "Reply with OK.") {
          emit(s.child, ...turnLines("ses_warm"));
          return s.child.end(0);
        }
        live.client = s;
        s.child.dies = [];
        emit(s.child, { ...OC_STEP_START, sessionID: "ses_live" });
      },
    });
    /* the interrupt is what ends the client, as it does on a real serve: it reports a reset and exits */
    const fetchImpl = (async (url: string, init: { method: string; headers: Record<string, string> }) => {
      if (url.endsWith("/interrupt")) {
        emit(live.client!.child, { ...OC_ERROR, sessionID: "ses_live" });
        setImmediate(() => live.client!.child.end(1));
      }
      return w.fetchCall(url, init);
    }) as never;
    const h = opencodeHarness({ bin: "opencode", env: {}, spawnImpl: w.sp.impl, fetchImpl, tmpRoot: tmp });
    const events: HarnessEvent[] = [];
    const run = h.run(runOptions(), (e) => events.push(e));
    while (!events.some((e) => e.kind === "session")) await new Promise((r) => setTimeout(r, 10));
    await run.stop();
    expect(await run.done).toEqual({});
    expect(w.fetched.some((f) => f.method === "POST" && f.url === "http://127.0.0.1:4101/api/session/ses_live/interrupt")).toBe(
      true,
    );
    expect(live.client!.child.signals).toEqual([]);
    expect(events.some((e) => e.kind === "error")).toBe(false);
    await h.close();
  });

  it("stops a turn that is still starting its serve, without running it", async () => {
    const w = opencodeWorld([]);
    const h = opencodeHarness({ bin: "opencode", env: {}, spawnImpl: w.sp.impl, fetchImpl: w.fetchImpl, tmpRoot: tmp });
    const run = h.run(runOptions(), () => undefined);
    await run.stop();
    expect(await run.done).toEqual({});
    expect(w.runs.filter((c) => c.child.stdinText !== "Reply with OK.")).toEqual([]);
    await h.close();
  });

  it("stops a chat's serve after it has been idle, and not before", async () => {
    const w = opencodeWorld([turnLines("ses_1")]);
    const h = opencodeHarness({
      bin: "opencode",
      env: {},
      spawnImpl: w.sp.impl,
      fetchImpl: w.fetchImpl,
      tmpRoot: tmp,
      idleMs: 60,
    });
    await h.run(runOptions(), () => undefined).done;
    expect(w.serves[0]!.child.signals).toEqual([]);
    await new Promise((r) => setTimeout(r, 200));
    expect(w.serves[0]!.child.signals).toEqual(["SIGTERM"]);
    expect(fs.readdirSync(tmp).filter((d) => d.startsWith("dag-opencode-"))).toEqual([]);
  });

  it("forgets a session through `opencode session delete`, on a private server with an empty config", async () => {
    const w = opencodeWorld([]);
    const h = opencodeHarness({ bin: "opencode", env: {}, spawnImpl: w.sp.impl, fetchImpl: w.fetchImpl, tmpRoot: tmp });
    await h.forget("ses_e4cc62576ffe4CjviATfLNGcig");
    expect(w.runs).toHaveLength(1);
    expect(w.runs[0]!.args).toEqual(["session", "delete", "--standalone", "ses_e4cc62576ffe4CjviATfLNGcig"]);
    expect(w.runs[0]!.opts.env!.XDG_CONFIG_HOME).toContain("dag-opencode-forget-");
    await h.forget("not a session; rm -rf");
    expect(w.runs).toHaveLength(1);
  });
});
