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
  defaultProvider,
  describeProviders,
  findClaude,
  findOpencode,
  namedProvider,
  opencodeEnv,
  resolveProvider,
  RETIRED_PROVIDERS,
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
    const f = fakeFetch(200, { choices: [{ message: { content: '```arch\nservice a "A"\n```' } }] });
    const complete = httpComplete({
      baseURL: "https://example.test/v1",
      key: KEY,
      model: "m-1",
      extra: { temperature: 0.2 },
      fetchImpl: f.fetchImpl,
    });
    expect(await complete(TALK)).toContain("service a");
    expect(f.seen[0]!.url).toBe("https://example.test/v1/chat/completions");
    expect((f.seen[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(f.seen[0]!.init.body as string)).toEqual({ model: "m-1", messages: TALK, temperature: 0.2 });
  });

  it("reads content that arrives as an array of parts", async () => {
    const f = fakeFetch(200, {
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "a" },
              { type: "text", text: "b" },
            ],
          },
        },
      ],
    });
    expect(await httpComplete({ baseURL: "https://x.test", model: "m", fetchImpl: f.fetchImpl })(TALK)).toBe("ab");
  });

  it("says what the provider said, and never the key, when it refuses", async () => {
    const f = fakeFetch(401, [{ error: { message: `API key ${KEY} not valid` } }]);
    const err = await httpComplete({ baseURL: "https://x.test", key: KEY, model: "m", fetchImpl: f.fetchImpl })(TALK).catch(
      (e: unknown) => e,
    );
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
    expect(parseOpencodeEvents([ev("m1", "thinking out loud"), ev("m2", "```arch"), ev("m2", "\n```")].join("\n"))).toBe(
      "```arch\n```",
    );
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
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => void;
    };
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
  const answer = JSON.stringify({
    type: "text",
    sessionID: "ses_abc",
    part: { messageID: "m", text: '```arch\nservice a "A"\n```' },
  });

  it("runs a tool-less agent on a private server in an empty directory, and deletes its session", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dag-cli-test-"));
    try {
      const fake = fakeSpawn(answer);
      const env = { PATH: "/bin", ANYDAG_TOKEN: "t", OPENCODE_CONFIG: "/elsewhere.json" };
      const text = await opencodeComplete({
        model: "opencode-go/glm-5.3-flash",
        variant: "high",
        env,
        bin: "/x/opencode",
        spawnImpl: fake.spawnImpl,
        tmpRoot,
      })(TALK);
      expect(text).toContain("service a");

      const { bin, args, opts, stdin } = fake.started[0]!;
      expect(bin).toBe("/x/opencode");
      expect(args).toEqual([
        "run",
        "--standalone",
        "-m",
        "opencode-go/glm-5.3-flash#high",
        "--agent",
        "dag-diagram",
        "--title",
        "dag-generate",
        "--format",
        "json",
      ]);
      expect(args).not.toContain("--auto");
      /* The request goes in on stdin, never as an argument. */
      expect(stdin()).toBe(TALK[1]!.content);

      expect(opts.env.XDG_CONFIG_HOME.startsWith(opts.cwd)).toBe(true);
      expect(opts.env.ANYDAG_TOKEN).toBeUndefined();
      expect(opts.env.OPENCODE_CONFIG).toBeUndefined();
      const config = JSON.parse(opts.env.OPENCODE_CONFIG_CONTENT) as {
        agent: { "dag-diagram": { prompt: string; permission: Record<string, string> } };
      };
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
    await expect(opencodeComplete({ model: "m", env: {}, spawnImpl: fake.spawnImpl })(TALK)).rejects.toThrow(
      "Variant unavailable",
    );
  });

  it("reports a run that printed nothing with its exit code, and an empty answer as such", async () => {
    await expect(opencodeComplete({ model: "m", env: {}, spawnImpl: fakeSpawn("", 1).spawnImpl })(TALK)).rejects.toThrow(
      "opencode exited 1",
    );
    await expect(opencodeComplete({ model: "m", env: {}, spawnImpl: fakeSpawn("", 0).spawnImpl })(TALK)).rejects.toThrow(
      "no text",
    );
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
    await expect(opencodeComplete({ model: "m", env: {}, timeout: 10, spawnImpl: slow.spawnImpl })(TALK)).rejects.toThrow(
      "did not answer in",
    );
    expect(slow.killed()).toBe(true);
  });

  it("writes the variant after a #, unless the model already names one", () => {
    expect(opencodeModel("opencode-go/glm-5.3-flash", "low")).toBe("opencode-go/glm-5.3-flash#low");
    expect(opencodeModel("opencode-go/kimi-k3#max", "low")).toBe("opencode-go/kimi-k3#max");
    expect(opencodeModel("opencode-go/glm-5.3-flash")).toBe("opencode-go/glm-5.3-flash");
  });
});

describe("resolveProvider", () => {
  it("falls back to Claude Code when nothing can answer, and says why it is not ready", () => {
    /* No PATH and a home with nothing in it: a Claude Code on the machine running the suite must not answer. */
    expect(resolveProvider({ PATH: "", HOME: "/nonexistent-home" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("Claude Code is not installed"),
      reason: { code: "not-installed", provider: "claude" },
    });
    expect(defaultProvider({ PATH: "", HOME: "/nonexistent-home" })).toBe("claude");
    expect(defaultProvider({ PATH: "", HOME: "/nonexistent-home", ANYDAG_DESKTOP: "1" })).toBe("claude");
  });

  it("lets the environment choose the default provider and its model", () => {
    const r = resolveProvider({
      ANYDAG_LLM_PROVIDER: "custom",
      ANYDAG_LLM_MODEL: "glm-5.3",
      ANYDAG_LLM_BASE_URL: "https://api.z.ai/api/paas/v4",
      ANYDAG_LLM_API_KEY: KEY,
    });
    expect(r.ok && r.value.spec.id).toBe("custom");
    expect(r.ok && r.value.model).toBe("glm-5.3");
  });

  it("reads a retired provider id as if no provider were named", () => {
    expect(RETIRED_PROVIDERS).toEqual(["gemini", "zai"]);
    for (const id of RETIRED_PROVIDERS) {
      expect(namedProvider(id)).toBeUndefined();
      expect(namedProvider(` ${id} `)).toBeUndefined();
    }
    expect(namedProvider("custom")).toBe("custom");

    const custom = {
      PATH: "",
      HOME: "/nonexistent-home",
      ANYDAG_LLM_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
      ANYDAG_LLM_MODEL: "gemini-3.8-flash",
      ANYDAG_LLM_API_KEY: KEY,
    };
    /* A request naming one gets the default, not `unknown-provider`. */
    for (const id of RETIRED_PROVIDERS) {
      const r = resolveProvider({ ...custom, ANYDAG_LLM_PROVIDER: "custom" }, { provider: id });
      expect(r.ok && r.value.spec.id).toBe("custom");
      expect(r.ok && r.value.model).toBe("gemini-3.8-flash");
    }
    /* A model named with a retired provider goes with it, rather than reaching the default. */
    const withModel = resolveProvider({ ...custom, ANYDAG_LLM_PROVIDER: "custom" }, { provider: "zai", model: "glm-5.3" });
    expect(withModel.ok && withModel.value.model).toBe("gemini-3.8-flash");
    /* The environment naming one is the same as naming none: the first provider that can answer. */
    const r = resolveProvider({ ...custom, ANYDAG_LLM_PROVIDER: "gemini" });
    expect(r.ok && r.value.spec.id).toBe("custom");
  });

  it("takes a custom endpoint entirely from the environment, key optional", () => {
    const r = resolveProvider(
      { ANYDAG_LLM_BASE_URL: "http://localhost:11434/v1/", ANYDAG_LLM_MODEL: "qwen" },
      { provider: "custom" },
    );
    expect(r.ok && r.value).toMatchObject({ baseURL: "http://localhost:11434/v1", model: "qwen", key: undefined });
  });

  it("refuses a provider it has never heard of", () => {
    expect(resolveProvider({}, { provider: "openai-direct" })).toMatchObject({
      ok: false,
      reason: { code: "unknown-provider", provider: "openai-direct" },
    });
  });

  it("says which setup a provider is missing, beside the sentence a developer reads", () => {
    expect(resolveProvider({}, { provider: "custom" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("needs a model"),
      reason: { code: "needs-model", provider: "custom" },
    });
    expect(resolveProvider({ ANYDAG_LLM_MODEL: "qwen" }, { provider: "custom" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("ANYDAG_LLM_BASE_URL"),
      reason: { code: "needs-base-url", provider: "custom" },
    });
  });
});

describe("describeProviders", () => {
  const CUSTOM = {
    ANYDAG_LLM_BASE_URL: "http://localhost:11434/v1",
    ANYDAG_LLM_MODEL: "qwen3:32b",
    ANYDAG_LLM_API_KEY: KEY,
    PATH: "",
    HOME: "/nonexistent-home",
  };

  it("says which could run, and never carries a key", () => {
    const d = describeProviders(CUSTOM);
    expect(JSON.stringify(d)).not.toContain(KEY);
    expect(d.default).toBe("custom");
    expect(d.providers.find((p) => p.id === "custom")!.ready).toBe(true);
    expect(d.providers.find((p) => p.id === "opencode")).toMatchObject({
      ready: false,
      error: expect.stringContaining("not installed"),
      reason: { code: "not-installed", provider: "opencode" },
    });
  });

  it("names every provider as the app does, and explains in a description beside the name", () => {
    const d = describeProviders(CUSTOM);
    expect(Object.fromEntries(d.providers.map((p) => [p.id, p.label]))).toEqual({
      claude: "Claude Code",
      opencode: "OpenCode",
      custom: "OpenAI-compatible",
    });
    for (const p of d.providers) {
      expect(p.label).not.toContain("(");
      expect(p.description.trim()).not.toBe("");
    }
  });
});

describe("extraFor", () => {
  const custom = () => {
    const r = resolveProvider(
      { ANYDAG_LLM_BASE_URL: "http://localhost:11434/v1", ANYDAG_LLM_MODEL: "qwen3:32b" },
      { provider: "custom" },
    );
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  it("sends nothing the provider did not ask for", () => {
    expect(extraFor(custom(), {})).toEqual({});
  });

  it("lets the environment choose, or ask for the model's own default", () => {
    expect(extraFor(custom(), { ANYDAG_LLM_REASONING: "high", ANYDAG_LLM_TEMPERATURE: "0.3" })).toEqual({
      reasoning_effort: "high",
      temperature: 0.3,
    });
    expect(extraFor(custom(), { ANYDAG_LLM_REASONING: "default" })).toEqual({});
  });

  it("lets the person in the settings card outrank the machine's setting", () => {
    expect(extraFor(custom(), { ANYDAG_LLM_REASONING: "high" }, { reasoning: "none" })).toEqual({
      reasoning_effort: "none",
    });
    expect(extraFor(custom(), {}, { reasoning: "default" })).toEqual({});
    /* Nothing chosen is nothing said: an HTTP provider with no measured default gets no field. */
    expect(extraFor(custom(), {}, { reasoning: null })).toEqual({});
    /* The HTTP scale has no Max, so the app's highest maps to the highest it does have. */
    expect(extraFor(custom(), {}, { reasoning: "max" })).toEqual({ reasoning_effort: "high" });
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
    expect(variantFor({}, { reasoning: "max" })).toBe("max");
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
      const fake = fakeSpawn(claudeSaid('```arch\nservice a "A"\n```'));
      const env = {
        PATH: "/bin",
        HOME: "/h",
        ANTHROPIC_API_KEY: KEY,
        ELECTRON_RUN_AS_NODE: "1",
        ANYDAG_TOKEN: "t",
        CLAUDECODE: "1",
      };
      const text = await claudeComplete({
        model: "sonnet",
        effort: "low",
        env,
        bin: "/opt/claude",
        spawnImpl: fake.spawnImpl,
        tmpRoot,
      })(TALK);
      expect(text).toContain("service a");

      const { bin, args, opts, stdin } = fake.started[0]!;
      expect(bin).toBe("/opt/claude");
      expect(args.slice(0, 2)).toEqual(["-p", "--safe-mode"]);
      expect(args).toEqual(
        expect.arrayContaining(["--strict-mcp-config", "--no-session-persistence", "--model", "sonnet", "--effort", "low"]),
      );
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
      for (const k of ["ANTHROPIC_API_KEY", "ELECTRON_RUN_AS_NODE", "ANYDAG_TOKEN", "CLAUDECODE"])
        expect(opts.env[k]).toBeUndefined();
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
    await expect(claudeComplete({ model: "m", env: {}, spawnImpl: fake.spawnImpl })(TALK)).rejects.toThrow(
      "Claude Code: Not logged in",
    );
  });

  it("reports a run that printed no answer with its exit code", async () => {
    const fake = fakeSpawn("boom", 2);
    await expect(claudeComplete({ model: "m", env: {}, spawnImpl: fake.spawnImpl })(TALK)).rejects.toThrow(
      "claude exited 2: boom",
    );
    await expect(claudeComplete({ model: "m", env: {}, spawnImpl: fakeSpawn(claudeSaid("")).spawnImpl })(TALK)).rejects.toThrow(
      "no text",
    );
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
    await expect(claudeComplete({ model: "m", env: {}, timeout: 10, spawnImpl: slow.spawnImpl })(TALK)).rejects.toThrow(
      "did not answer",
    );
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
  it("maps the one scale onto each provider's own words", () => {
    /* Claude Code's --effort has max but no none: none is its lowest. */
    expect(effortFor("claude", { reasoning: "none" })).toBe("low");
    expect(effortFor("claude", { reasoning: "low" })).toBe("low");
    expect(effortFor("claude", { reasoning: "medium" })).toBe("medium");
    expect(effortFor("claude", { reasoning: "high" })).toBe("high");
    expect(effortFor("claude", { reasoning: "max" })).toBe("max");

    /* OpenCode's variants have max, and its middle asks for the model's own default. */
    expect(effortFor("opencode", { reasoning: "none" })).toBe("low");
    expect(effortFor("opencode", { reasoning: "low" })).toBe("low");
    expect(effortFor("opencode", { reasoning: "medium" })).toBeUndefined();
    expect(effortFor("opencode", { reasoning: "high" })).toBe("high");
    expect(effortFor("opencode", { reasoning: "max" })).toBe("max");

    /* The HTTP provider carries reasoning_effort; max is its highest accepted level. */
    expect(effortFor("custom", { reasoning: "none" })).toBe("none");
    expect(effortFor("custom", { reasoning: "low" })).toBe("low");
    expect(effortFor("custom", { reasoning: "medium" })).toBe("medium");
    expect(effortFor("custom", { reasoning: "high" })).toBe("high");
    expect(effortFor("custom", { reasoning: "max" })).toBe("high");
  });

  it("says nothing for Automatic and for an old `default`", () => {
    for (const provider of ["claude", "opencode", "custom"]) {
      expect(effortFor(provider, { reasoning: "default" })).toBeUndefined();
      expect(effortFor(provider, {})).toBeUndefined();
      expect(effortFor(provider, { reasoning: null })).toBeUndefined();
    }
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
    expect(findClaude({ PATH: path.join(h, "bin"), HOME: "/nonexistent-home" })).toMatchObject({
      bin: path.join(h, "bin/claude"),
    });
    expect(findClaude({ ANYDAG_CLAUDE_BIN: path.join(h, "nope"), PATH: path.join(h, "bin") })).toMatchObject({
      ok: false,
      error: expect.stringContaining("ANYDAG_CLAUDE_BIN"),
    });
  });

  it("says why not: not installed, or not signed in", () => {
    expect(resolveProvider({ PATH: "", HOME: home(null) }, { provider: "claude" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("not installed"),
      reason: { code: "not-installed", provider: "claude" },
    });
    expect(resolveProvider({ PATH: "", HOME: home(".local/bin/claude", false) }, { provider: "claude" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("not signed in"),
      reason: { code: "not-signed-in", provider: "claude" },
    });
  });

  it("is the default when it can answer, and never takes another provider's model from the environment", () => {
    const h = home(".claude/local/claude");
    /* A browser with no keyed provider falls to Claude Code rather than failing its first card (#179). */
    expect(describeProviders({ PATH: "", HOME: h }).default).toBe("claude");
    const custom = {
      PATH: "",
      HOME: h,
      ANYDAG_LLM_BASE_URL: "http://localhost:11434/v1",
      ANYDAG_LLM_MODEL: "qwen3:32b",
    };
    expect(describeProviders(custom).default).toBe("claude");
    expect(describeProviders({ ...custom, ANYDAG_DESKTOP: "1" }).default).toBe("claude");
    const desk = { PATH: "", HOME: h, ANYDAG_DESKTOP: "1", ANYDAG_LLM_MODEL: "qwen3:32b" };
    expect(describeProviders(desk).default).toBe("claude");
    const r = resolveProvider(desk);
    expect(r.ok && r.value).toMatchObject({ spec: { id: "claude" }, model: "sonnet" });
    expect(describeProviders({ PATH: "", HOME: home(null), ANYDAG_DESKTOP: "1" }).default).toBe("claude");
    expect(
      describeProviders({ ...desk, ANYDAG_LLM_PROVIDER: "custom", ANYDAG_LLM_BASE_URL: "http://localhost:11434/v1" }).default,
    ).toBe("custom");

    /* A model named for another provider is not sent to Claude; named for Claude, it is. */
    const other = resolveProvider(
      { ...desk, ANYDAG_LLM_PROVIDER: "custom", ANYDAG_LLM_BASE_URL: "http://localhost:11434/v1" },
      { provider: "claude" },
    );
    expect(other.ok && other.value.model).toBe("sonnet");
    const mine = resolveProvider({ ...desk, ANYDAG_LLM_PROVIDER: "claude" }, { provider: "claude" });
    expect(mine.ok && mine.value.model).toBe("qwen3:32b");
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
      fs.writeFileSync(
        bin,
        `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "opencode v${version}"; exit 0; fi\necho '${list}'\n`,
        { mode: 0o755 },
      );
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
    expect(findOpencode({ PATH: path.join(h, "bin"), HOME: "/nonexistent-home" })).toMatchObject({
      bin: path.join(h, "bin/opencode"),
    });
    expect(findOpencode({ ANYDAG_OPENCODE_BIN: path.join(h, "nope"), PATH: path.join(h, "bin") })).toMatchObject({
      ok: false,
      error: expect.stringContaining("ANYDAG_OPENCODE_BIN"),
    });
  });

  it("says why not: not installed, too old, or not signed in to the model's provider", () => {
    const want = { provider: "opencode" };
    expect(resolveProvider({ PATH: "", HOME: home(null) }, want)).toMatchObject({
      ok: false,
      error: expect.stringContaining("not installed"),
      reason: { code: "not-installed", provider: "opencode" },
    });
    expect(resolveProvider({ PATH: "", HOME: home(".opencode/bin/opencode", "1.18.3") }, want)).toMatchObject({
      ok: false,
      error: expect.stringContaining("too old"),
      reason: { code: "too-old", provider: "opencode" },
    });
    expect(resolveProvider({ PATH: "", HOME: home(".opencode/bin/opencode", "2.2.5", []) }, want)).toMatchObject({
      ok: false,
      error: expect.stringContaining("not signed in"),
      reason: { code: "not-signed-in", provider: "opencode" },
    });
    /* Signed in to OpenCode Go, asked for a model of a provider it holds no login for. */
    const h = home(".opencode/bin/opencode");
    expect(resolveProvider({ PATH: "", HOME: h }, { provider: "opencode", model: "anthropic/claude-sonnet-5-5" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("not signed in to anthropic"),
      reason: { code: "not-signed-in", provider: "opencode" },
    });
  });

  it("is the default after Claude Code, and only when it can answer", () => {
    const h = home(".opencode/bin/opencode");
    expect(describeProviders({ PATH: "", HOME: h }).default).toBe("opencode");
    expect(describeProviders({ PATH: "", HOME: h, ANYDAG_DESKTOP: "1" }).default).toBe("opencode");
    expect(describeProviders({ PATH: "", HOME: home(".opencode/bin/opencode", "2.2.5", []), ANYDAG_DESKTOP: "1" }).default).toBe(
      "claude",
    );
    /* With Claude Code there too, Claude goes first. */
    const both = home(".opencode/bin/opencode");
    fs.mkdirSync(path.join(both, ".local/bin"), { recursive: true });
    fs.writeFileSync(path.join(both, ".local/bin/claude"), `#!/bin/sh\necho '{"loggedIn": true}'\n`, { mode: 0o755 });
    expect(describeProviders({ PATH: "", HOME: both, ANYDAG_DESKTOP: "1" }).default).toBe("claude");
    expect(describeProviders({ PATH: "", HOME: both }).default).toBe("claude");
  });

  it("falls to a keyed provider that can answer, then to Claude Code when none can", () => {
    const none = home(null);
    const custom = {
      PATH: "",
      HOME: none,
      ANYDAG_LLM_BASE_URL: "http://localhost:11434/v1",
      ANYDAG_LLM_MODEL: "qwen3:32b",
      ANYDAG_LLM_API_KEY: KEY,
    };
    expect(describeProviders({ ...custom, ANYDAG_DESKTOP: "1" }).default).toBe("custom");
    expect(describeProviders(custom).default).toBe("custom");
    expect(describeProviders({ PATH: "", HOME: none, ANYDAG_DESKTOP: "1" }).default).toBe("claude");
    expect(describeProviders({ PATH: "", HOME: none }).default).toBe("claude");
  });

  it("does not let the server's own config or token reach the run", () => {
    expect(opencodeEnv({ OPENCODE_CONFIG: "/c.json", OPENCODE_CONFIG_DIR: "/d", ANYDAG_TOKEN: "t", HOME: "/h" })).toEqual({
      HOME: "/h",
    });
  });
});
