import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import {
  claudeComplete,
  effortFor,
  extraFor,
  flatten,
  httpComplete,
  LlmError,
  opencodeComplete,
  opencodeModel,
  opencodeSession,
  parseClaudeResult,
  parseOpencodeEvents,
  variantFor,
  type Message,
} from "../plugins/generate/llm";
import {
  claudeEnv,
  describeProviders,
  findClaude,
  findOpencode,
  opencodeEnv,
  resolveProvider,
} from "../plugins/generate/providers";

/**
 * The three ways a prompt card reaches a model, held to what each was found to need.
 *
 * The opencode fixtures are real `opencode run --format json` streams from OpenCode 2.2.5, recorded
 * against `opencode-go/glm-5.3-flash` with the isolation `opencodeComplete` applies — one answer, and
 * one refusal of a variant the model does not have. If OpenCode changes its event shape, these are
 * the tests that should fail first.
 */

const KEY = "sk-test-0123456789abcdef";
const TALK: Message[] = [
  { role: "system", content: "S" },
  { role: "user", content: "Draw this:\n\na web app" },
];

function fakeFetch(status: number, body: unknown): { fetchImpl: typeof fetch; seen: { url: string; init: RequestInit }[] } {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

describe("httpComplete", () => {
  it("posts an OpenAI chat completion with the key as a bearer token", async () => {
    const f = fakeFetch(200, { choices: [{ message: { content: "```arch\nservice a \"A\"\n```" } }] });
    const complete = httpComplete({ baseURL: "https://example.test/v1", key: KEY, model: "m-1", extra: { temperature: 0.2 }, fetchImpl: f.fetchImpl });
    expect(await complete(TALK)).toContain("service a");
    expect(f.seen[0]!.url).toBe("https://example.test/v1/chat/completions");
    expect((f.seen[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(f.seen[0]!.init.body as string)).toEqual({ model: "m-1", messages: TALK, temperature: 0.2 });
  });

  it("reads content that arrives as an array of parts", async () => {
    const f = fakeFetch(200, { choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] });
    expect(await httpComplete({ baseURL: "https://x.test", model: "m", fetchImpl: f.fetchImpl })(TALK)).toBe("ab");
  });

  it("says what the provider said, and never the key, when it refuses", async () => {
    const f = fakeFetch(401, [{ error: { message: `API key ${KEY} not valid` } }]);
    const err = await httpComplete({ baseURL: "https://x.test", key: KEY, model: "m", fetchImpl: f.fetchImpl })(TALK).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).status).toBe(401);
    expect((err as LlmError).message).toContain("not valid");
    expect((err as LlmError).message).not.toContain(KEY);
  });
});

describe("parseOpencodeEvents", () => {
  it("reads the answer out of a recorded run", () => {
    const jsonl = fs.readFileSync(path.join(__dirname, "fixtures/opencode-run.jsonl"), "utf8");
    expect(parseOpencodeEvents(jsonl)).toBe("pong");
  });

  it("takes the last message's text when a run spoke more than once", () => {
    const ev = (id: string, text: string) => JSON.stringify({ type: "text", part: { messageID: id, text } });
    expect(parseOpencodeEvents([ev("m1", "thinking out loud"), ev("m2", "```arch"), ev("m2", "\n```")].join("\n"))).toBe("```arch\n```");
  });

  it("throws an error event rather than returning nothing", () => {
    expect(() => parseOpencodeEvents(JSON.stringify({ type: "error", error: { data: { message: "quota" } } }))).toThrow("quota");
    const refused = fs.readFileSync(path.join(__dirname, "fixtures/opencode-error.jsonl"), "utf8");
    expect(() => parseOpencodeEvents(refused)).toThrow("Variant unavailable for opencode-go/glm-5.3-flash: minimal");
  });

  it("finds the session a run made, so it can be deleted", () => {
    const jsonl = fs.readFileSync(path.join(__dirname, "fixtures/opencode-run.jsonl"), "utf8");
    expect(opencodeSession(jsonl)).toMatch(/^ses_/);
    expect(opencodeSession("")).toBeUndefined();
  });
});

describe("flatten", () => {
  it("passes a single request through untouched", () => {
    expect(flatten(TALK)).toBe(TALK[1]!.content);
  });

  it("names the roles of a fix-loop transcript", () => {
    const text = flatten([...TALK, { role: "assistant", content: "A1" }, { role: "user", content: "fix it" }]);
    expect(text).toMatch(/## User[\s\S]*## Your earlier answer\n\nA1[\s\S]*## User\n\nfix it/);
  });
});

/** A child process that prints `stdout` and exits `code`, recording how it was started. */
function fakeSpawn(stdout: string, code = 0, hang = false) {
  const started: { bin: string; args: string[]; opts: { cwd: string; env: Record<string, string> }; stdin: () => string }[] = [];
  let killed = false;
  const spawnImpl = ((bin: string, args: string[], opts: { cwd: string; env: Record<string, string> }) => {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => void };
    child.stdin = new PassThrough();
    let input = "";
    child.stdin.on("data", (b: Buffer) => (input += b.toString("utf8")));
    started.push({ bin, args, opts, stdin: () => input });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      killed = true;
      child.emit("close", null);
    };
    if (!hang)
      setTimeout(() => {
        child.stdout.write(stdout);
        child.emit("close", code);
      }, 1);
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
  return { spawnImpl, started, killed: () => killed };
}

describe("opencodeComplete", () => {
  const answer = JSON.stringify({ type: "text", sessionID: "ses_abc", part: { messageID: "m", text: "```arch\nservice a \"A\"\n```" } });

  it("runs a tool-less agent on a private server in an empty directory, and deletes its session", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dag-cli-test-"));
    try {
      const fake = fakeSpawn(answer);
      const env = { PATH: "/bin", ANYDAG_TOKEN: "t", OPENCODE_CONFIG: "/elsewhere.json" };
      const text = await opencodeComplete({ model: "opencode-go/glm-5.3-flash", variant: "high", env, bin: "/x/opencode", spawnImpl: fake.spawnImpl, tmpRoot })(TALK);
      expect(text).toContain("service a");

      const { bin, args, opts, stdin } = fake.started[0]!;
      expect(bin).toBe("/x/opencode");
      expect(args).toEqual(["run", "--standalone", "-m", "opencode-go/glm-5.3-flash#high", "--agent", "dag-diagram", "--title", "dag-generate", "--format", "json"]);
      expect(args).not.toContain("--auto");
      /* The request goes in on stdin, never as an argument. */
      expect(stdin()).toBe(TALK[1]!.content);

      expect(opts.env.XDG_CONFIG_HOME.startsWith(opts.cwd)).toBe(true);
      expect(opts.env.ANYDAG_TOKEN).toBeUndefined();
      expect(opts.env.OPENCODE_CONFIG).toBeUndefined();
      const config = JSON.parse(opts.env.OPENCODE_CONFIG_CONTENT) as { agent: { "dag-diagram": { prompt: string; permission: Record<string, string> } } };
      const agent = config.agent["dag-diagram"];
      expect(agent.prompt).toMatch(/^\{file:.*system\.md\}$/);
      expect(agent.permission).toEqual({ "*": "deny" });

      /* Its session is deleted by id, so a prompt card leaves nothing in the person's OpenCode history. */
      expect(fake.started[1]).toMatchObject({ bin: "/x/opencode", args: ["session", "delete", "--standalone", "ses_abc"] });
      /* And the throwaway directory is gone once the answer is in. */
      expect(fs.existsSync(opts.cwd)).toBe(false);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("says what OpenCode said when it refuses, ahead of the exit code", async () => {
    const refused = fs.readFileSync(path.join(__dirname, "fixtures/opencode-error.jsonl"), "utf8");
    const fake = fakeSpawn(refused, 1);
    await expect(opencodeComplete({ model: "m", env: {}, spawnImpl: fake.spawnImpl })(TALK)).rejects.toThrow("Variant unavailable");
  });

  it("reports a run that printed nothing with its exit code, and an empty answer as such", async () => {
    await expect(opencodeComplete({ model: "m", env: {}, spawnImpl: fakeSpawn("", 1).spawnImpl })(TALK)).rejects.toThrow("opencode exited 1");
    await expect(opencodeComplete({ model: "m", env: {}, spawnImpl: fakeSpawn("", 0).spawnImpl })(TALK)).rejects.toThrow("no text");
  });

  it("kills the child when the request is cancelled, or when it takes too long", async () => {
    const fake = fakeSpawn("", 0, true);
    const cancel = new AbortController();
    const run = opencodeComplete({ model: "m", env: {}, spawnImpl: fake.spawnImpl })(TALK, cancel.signal);
    await new Promise((r) => setTimeout(r, 5));
    cancel.abort();
    await expect(run).rejects.toThrow("cancelled");
    expect(fake.killed()).toBe(true);

    const slow = fakeSpawn("", 0, true);
    await expect(opencodeComplete({ model: "m", env: {}, timeout: 10, spawnImpl: slow.spawnImpl })(TALK)).rejects.toThrow("did not answer in");
    expect(slow.killed()).toBe(true);
  });

  it("writes the variant after a #, unless the model already names one", () => {
    expect(opencodeModel("opencode-go/glm-5.3-flash", "low")).toBe("opencode-go/glm-5.3-flash#low");
    expect(opencodeModel("opencode-go/kimi-k3#max", "low")).toBe("opencode-go/kimi-k3#max");
    expect(opencodeModel("opencode-go/glm-5.3-flash")).toBe("opencode-go/glm-5.3-flash");
  });
});

describe("resolveProvider", () => {
  it("defaults to Gemini, and needs its key", () => {
    expect(resolveProvider({})).toMatchObject({ ok: false, error: expect.stringContaining("GEMINI_API_KEY") });
    const r = resolveProvider({ GEMINI_API_KEY: KEY });
    expect(r.ok && r.value).toMatchObject({ model: "gemini-3.8-flash", key: KEY, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai" });
  });

  it("lets the environment choose the default provider and its model", () => {
    const r = resolveProvider({ ANYDAG_LLM_PROVIDER: "zai", ANYDAG_LLM_MODEL: "glm-5.3", ZHIPU_API_KEY: KEY });
    expect(r.ok && r.value.spec.id).toBe("zai");
    expect(r.ok && r.value.model).toBe("glm-5.3");
  });

  it("does not hand the default provider's model name to a provider somebody picked", () => {
    const r = resolveProvider({ ANYDAG_LLM_MODEL: "gemini-3.7-flash", ZHIPU_API_KEY: KEY }, { provider: "zai" });
    expect(r.ok && r.value.model).toBe("glm-5.3-flash");
  });

  it("takes a custom endpoint entirely from the environment, key optional", () => {
    const r = resolveProvider({ ANYDAG_LLM_BASE_URL: "http://localhost:11434/v1/", ANYDAG_LLM_MODEL: "qwen" }, { provider: "custom" });
    expect(r.ok && r.value).toMatchObject({ baseURL: "http://localhost:11434/v1", model: "qwen", key: undefined });
  });

  it("refuses a provider it has never heard of", () => {
    expect(resolveProvider({}, { provider: "openai-direct" })).toMatchObject({ ok: false });
  });
});

describe("describeProviders", () => {
  it("says which could run, and never carries a key", () => {
    const d = describeProviders({ GEMINI_API_KEY: KEY, PATH: "", HOME: "/nonexistent-home" });
    expect(JSON.stringify(d)).not.toContain(KEY);
    expect(d.default).toBe("gemini");
    expect(d.providers.find((p) => p.id === "gemini")!.ready).toBe(true);
    expect(d.providers.find((p) => p.id === "opencode")).toMatchObject({ ready: false, reason: expect.stringContaining("not installed") });
  });
});

describe("extraFor", () => {
  const gemini = () => {
    const r = resolveProvider({ GEMINI_API_KEY: KEY });
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  it("asks Gemini to think little, which is most of the wait on a diagram", () => {
    expect(extraFor(gemini(), {})).toEqual({ reasoning_effort: "low" });
  });

  it("lets the environment choose, or ask for the model's own default", () => {
    expect(extraFor(gemini(), { ANYDAG_LLM_REASONING: "high", ANYDAG_LLM_TEMPERATURE: "0.3" })).toEqual({ reasoning_effort: "high", temperature: 0.3 });
    expect(extraFor(gemini(), { ANYDAG_LLM_REASONING: "default" })).toEqual({});
  });

  it("lets the person in the settings card outrank the machine's setting", () => {
    expect(extraFor(gemini(), { ANYDAG_LLM_REASONING: "high" }, { reasoning: "none" })).toEqual({ reasoning_effort: "none" });
    expect(extraFor(gemini(), {}, { reasoning: "default" })).toEqual({});
    /* Nothing chosen is nothing said: the provider's own measured default stands. */
    expect(extraFor(gemini(), {}, { reasoning: null })).toEqual({ reasoning_effort: "low" });
  });
});

describe("variantFor", () => {
  it("maps the card's levels onto OpenCode's own words", () => {
    /* A variant is the model's word: GLM 5.3 Flash and DeepSeek 4.1 Flash take `low`, `high` and `max`
       and refuse `none`, `minimal` and `medium`. So the bottom of the range is `low`, and the middle
       is "say nothing" — the model's own default. */
    expect(variantFor({}, { reasoning: "high" })).toBe("high");
    expect(variantFor({}, { reasoning: "none" })).toBe("low");
    expect(variantFor({}, { reasoning: "low" })).toBe("low");
    expect(variantFor({}, { reasoning: "medium" })).toBeUndefined();
  });

  it("falls back to the machine's variant when nothing was chosen", () => {
    expect(variantFor({ ANYDAG_LLM_VARIANT: "max" }, {})).toBe("max");
    expect(variantFor({ ANYDAG_LLM_VARIANT: "max" }, { reasoning: null })).toBe("max");
    /* And `default` is a choice: the model's own, not this machine's flag. */
    expect(variantFor({ ANYDAG_LLM_VARIANT: "max" }, { reasoning: "default" })).toBeUndefined();
  });
});


/* ---- Claude Code ---- */

const claudeSaid = (result: string, isError = false) =>
  JSON.stringify({ type: "result", subtype: "success", is_error: isError, result, session_id: "s" });

describe("claudeComplete", () => {
  it("runs `claude -p` answer-only, with the system prompt as a file and the request on stdin", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dag-claude-test-"));
    try {
      const fake = fakeSpawn(claudeSaid("```arch\nservice a \"A\"\n```"));
      const env = { PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: KEY, ELECTRON_RUN_AS_NODE: "1", ANYDAG_TOKEN: "t", CLAUDECODE: "1" };
      const text = await claudeComplete({ model: "sonnet", effort: "low", env, bin: "/opt/claude", spawnImpl: fake.spawnImpl, tmpRoot })(TALK);
      expect(text).toContain("service a");

      const { bin, args, opts, stdin } = fake.started[0]!;
      expect(bin).toBe("/opt/claude");
      expect(args.slice(0, 2)).toEqual(["-p", "--safe-mode"]);
      expect(args).toEqual(expect.arrayContaining(["--strict-mcp-config", "--no-session-persistence", "--model", "sonnet", "--effort", "low"]));
      /* No tool at all: the empty list, not the default set. */
      expect(args[args.indexOf("--tools") + 1]).toBe("");
      expect(args[args.indexOf("--output-format") + 1]).toBe("json");
      /* `--bare` would ignore the subscription's login, and nothing may grant a permission. */
      expect(args).not.toContain("--bare");
      expect(args.some((a) => /skip-permissions|bypassPermissions/.test(a))).toBe(false);
      expect(args[args.indexOf("--system-prompt-file") + 1]).toBe(path.join(opts.cwd, "system.md"));
      expect(stdin()).toBe(TALK[1]!.content);

      /* The subscription answers, not a key that happens to be in the server's environment. */
      expect(opts.env).toMatchObject({ PATH: "/bin", HOME: "/h" });
      for (const k of ["ANTHROPIC_API_KEY", "ELECTRON_RUN_AS_NODE", "ANYDAG_TOKEN", "CLAUDECODE"]) expect(opts.env[k]).toBeUndefined();
      expect(fs.existsSync(opts.cwd)).toBe(false);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("asks for no effort when the card did not", async () => {
    const fake = fakeSpawn(claudeSaid("x"));
    await claudeComplete({ model: "opus", env: {}, spawnImpl: fake.spawnImpl })(TALK);
    expect(fake.started[0]!.args).not.toContain("--effort");
  });

  it("says Claude Code's own refusal, which arrives as JSON and an exit of 1", async () => {
    const fake = fakeSpawn(claudeSaid("Not logged in · Please run /login", true), 1);
    await expect(claudeComplete({ model: "m", env: {}, spawnImpl: fake.spawnImpl })(TALK)).rejects.toThrow("Claude Code: Not logged in");
  });

  it("reports a run that printed no answer with its exit code", async () => {
    const fake = fakeSpawn("boom", 2);
    await expect(claudeComplete({ model: "m", env: {}, spawnImpl: fake.spawnImpl })(TALK)).rejects.toThrow("claude exited 2: boom");
    await expect(claudeComplete({ model: "m", env: {}, spawnImpl: fakeSpawn(claudeSaid("")).spawnImpl })(TALK)).rejects.toThrow("no text");
  });

  it("kills the child when the request is cancelled, or when it takes too long", async () => {
    const fake = fakeSpawn("", 0, true);
    const cancel = new AbortController();
    const run = claudeComplete({ model: "m", env: {}, spawnImpl: fake.spawnImpl })(TALK, cancel.signal);
    await new Promise((r) => setTimeout(r, 5));
    cancel.abort();
    await expect(run).rejects.toThrow("cancelled");
    expect(fake.killed()).toBe(true);

    const slow = fakeSpawn("", 0, true);
    await expect(claudeComplete({ model: "m", env: {}, timeout: 10, spawnImpl: slow.spawnImpl })(TALK)).rejects.toThrow("did not answer");
    expect(slow.killed()).toBe(true);
  });
});

describe("parseClaudeResult", () => {
  it("reads the answer, the refusal, and nothing out of something that is not JSON", () => {
    expect(parseClaudeResult(claudeSaid("hi"))).toEqual({ text: "hi" });
    expect(parseClaudeResult(claudeSaid("nope", true))).toEqual({ error: "nope" });
    expect(parseClaudeResult("Error: unknown option")).toBeNull();
  });
});

describe("effortFor", () => {
  it("maps the card's levels onto Claude Code's, which has no none", () => {
    expect(effortFor({ reasoning: "none" })).toBe("low");
    expect(effortFor({ reasoning: "medium" })).toBe("medium");
    expect(effortFor({ reasoning: "high" })).toBe("high");
    expect(effortFor({ reasoning: "default" })).toBeUndefined();
    expect(effortFor({})).toBeUndefined();
  });
});

describe.skipIf(process.platform === "win32")("finding Claude Code", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
  });
  /** A home with a `claude` at `rel` that answers `auth status` as signed in or not. */
  const home = (rel: string | null, loggedIn = true): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dag-claude-home-"));
    roots.push(root);
    if (rel) {
      const bin = path.join(root, rel);
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      fs.writeFileSync(bin, `#!/bin/sh\necho '{"loggedIn": ${loggedIn}}'\n${loggedIn ? "" : "exit 1\n"}`, { mode: 0o755 });
    }
    return root;
  };

  it("looks where the installers put it when the PATH does not have it, as from a desktop launcher", () => {
    const h = home(".local/bin/claude");
    expect(findClaude({ PATH: "/usr/bin-nothing", HOME: h })).toEqual({ ok: true, bin: path.join(h, ".local/bin/claude") });
    const r = resolveProvider({ PATH: "", HOME: h }, { provider: "claude" });
    expect(r.ok && r.value).toMatchObject({ model: "sonnet", bin: path.join(h, ".local/bin/claude") });
  });

  it("takes the PATH first, and ANYDAG_CLAUDE_BIN before either", () => {
    const h = home("bin/claude");
    expect(findClaude({ PATH: path.join(h, "bin"), HOME: "/nonexistent-home" })).toMatchObject({ bin: path.join(h, "bin/claude") });
    expect(findClaude({ ANYDAG_CLAUDE_BIN: path.join(h, "nope"), PATH: path.join(h, "bin") })).toMatchObject({
      ok: false,
      error: expect.stringContaining("ANYDAG_CLAUDE_BIN"),
    });
  });

  it("says why not: not installed, or not signed in", () => {
    expect(resolveProvider({ PATH: "", HOME: home(null) }, { provider: "claude" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("not installed"),
    });
    expect(resolveProvider({ PATH: "", HOME: home(".local/bin/claude", false) }, { provider: "claude" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("not signed in"),
    });
  });

  it("is the desktop app's default when it can answer, and never takes a Gemini model name from the environment", () => {
    const h = home(".claude/local/claude");
    expect(describeProviders({ PATH: "", HOME: h }).default).toBe("gemini");
    const desk = { PATH: "", HOME: h, ANYDAG_DESKTOP: "1", ANYDAG_LLM_MODEL: "gemini-3.7-flash" };
    expect(describeProviders(desk).default).toBe("claude");
    const r = resolveProvider(desk);
    expect(r.ok && r.value).toMatchObject({ spec: { id: "claude" }, model: "sonnet" });
    expect(describeProviders({ PATH: "", HOME: home(null), ANYDAG_DESKTOP: "1" }).default).toBe("gemini");
    expect(describeProviders({ ...desk, ANYDAG_LLM_PROVIDER: "zai" }).default).toBe("zai");
  });

  it("strips what would make somebody else's account answer", () => {
    expect(claudeEnv({ ANTHROPIC_API_KEY: KEY, HOME: "/h" })).toEqual({ HOME: "/h" });
  });
});

describe.skipIf(process.platform === "win32")("finding OpenCode", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
  });
  /** A home with an `opencode` at `rel` of the given version, signed in to `logins`. */
  const home = (rel: string | null, version = "2.2.5", logins: string[] = ["opencode-go"]): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dag-opencode-home-"));
    roots.push(root);
    if (rel) {
      const bin = path.join(root, rel);
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      const list = JSON.stringify(logins.map((id) => ({ id, connections: [{ type: "credential" }] })));
      fs.writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "opencode v${version}"; exit 0; fi\necho '${list}'\n`, { mode: 0o755 });
    }
    return root;
  };

  it("looks where its install script puts it when the PATH does not have it", () => {
    const h = home(".opencode/bin/opencode");
    expect(findOpencode({ PATH: "", HOME: h })).toEqual({ ok: true, bin: path.join(h, ".opencode/bin/opencode") });
    const r = resolveProvider({ PATH: "", HOME: h }, { provider: "opencode" });
    expect(r.ok && r.value).toMatchObject({ model: "opencode-go/glm-5.3-flash", bin: path.join(h, ".opencode/bin/opencode") });
  });

  it("takes the PATH first, and ANYDAG_OPENCODE_BIN before either", () => {
    const h = home("bin/opencode");
    expect(findOpencode({ PATH: path.join(h, "bin"), HOME: "/nonexistent-home" })).toMatchObject({ bin: path.join(h, "bin/opencode") });
    expect(findOpencode({ ANYDAG_OPENCODE_BIN: path.join(h, "nope"), PATH: path.join(h, "bin") })).toMatchObject({
      ok: false,
      error: expect.stringContaining("ANYDAG_OPENCODE_BIN"),
    });
  });

  it("says why not: not installed, too old, or not signed in to the model's provider", () => {
    const want = { provider: "opencode" };
    expect(resolveProvider({ PATH: "", HOME: home(null) }, want)).toMatchObject({ ok: false, error: expect.stringContaining("not installed") });
    expect(resolveProvider({ PATH: "", HOME: home(".opencode/bin/opencode", "1.18.3") }, want)).toMatchObject({
      ok: false,
      error: expect.stringContaining("too old"),
    });
    expect(resolveProvider({ PATH: "", HOME: home(".opencode/bin/opencode", "2.2.5", []) }, want)).toMatchObject({
      ok: false,
      error: expect.stringContaining("not signed in"),
    });
    /* Signed in to OpenCode Go, asked for a model of a provider it holds no login for. */
    const h = home(".opencode/bin/opencode");
    expect(resolveProvider({ PATH: "", HOME: h }, { provider: "opencode", model: "anthropic/claude-sonnet-5-5" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("not signed in to anthropic"),
    });
  });

  it("is the desktop app's default after Claude Code, and only when it can answer", () => {
    const h = home(".opencode/bin/opencode");
    expect(describeProviders({ PATH: "", HOME: h }).default).toBe("gemini");
    expect(describeProviders({ PATH: "", HOME: h, ANYDAG_DESKTOP: "1" }).default).toBe("opencode");
    expect(describeProviders({ PATH: "", HOME: home(".opencode/bin/opencode", "2.2.5", []), ANYDAG_DESKTOP: "1" }).default).toBe("gemini");
    /* With Claude Code there too, Claude goes first. */
    const both = home(".opencode/bin/opencode");
    fs.mkdirSync(path.join(both, ".local/bin"), { recursive: true });
    fs.writeFileSync(path.join(both, ".local/bin/claude"), `#!/bin/sh\necho '{"loggedIn": true}'\n`, { mode: 0o755 });
    expect(describeProviders({ PATH: "", HOME: both, ANYDAG_DESKTOP: "1" }).default).toBe("claude");
  });

  it("does not let the server's own config or token reach the run", () => {
    expect(opencodeEnv({ OPENCODE_CONFIG: "/c.json", OPENCODE_CONFIG_DIR: "/d", ANYDAG_TOKEN: "t", HOME: "/h" })).toEqual({ HOME: "/h" });
  });
});
