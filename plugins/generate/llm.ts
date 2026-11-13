import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { forgetOpencode } from "./cli";
import { claudeEnv, opencodeEnv, type Env, type Resolved } from "./providers";

/**
 * One way to ask a model something: a transcript in, the text of its answer out.
 *
 * Everything above this — the system prompt, the fix loop, the parser — is written against
 * `Complete` and never knows which provider answered, which is what makes a provider a line in a
 * table rather than a branch through the generator. It is also what lets the tests hand the loop a
 * fake model.
 */

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export type Complete = (messages: Message[], signal?: AbortSignal) => Promise<string>;

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** Whatever a provider says back, minus anything that looks like the key we sent it. */
const scrub = (text: string, key?: string): string => (key ? text.split(key).join("…") : text);

/* ---- OpenAI-compatible HTTP ---- */

interface HttpOptions {
  baseURL: string;
  key?: string;
  model: string;
  /** Extra body fields — `temperature`, `reasoning_effort` — from the environment, when set. */
  extra?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

/**
 * `POST {base}/chat/completions`, and nothing an SDK would add.
 *
 * OpenRouter, Ollama, vLLM and the hosted providers' OpenAI-compatible endpoints all answer this
 * shape, which is the whole reason there is one adapter rather than one per service. `content` may
 * come back as a string or as an array of parts (some gateways do the latter); both are read.
 */
export function httpComplete(o: HttpOptions): Complete {
  const doFetch = o.fetchImpl ?? fetch;
  return async (messages, signal) => {
    const res = await doFetch(`${o.baseURL}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "anydag/1",
        ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}),
      },
      body: JSON.stringify({ model: o.model, messages, ...o.extra }),
    });
    const raw = await res.text();
    if (!res.ok) {
      let detail = raw.slice(0, 400);
      try {
        const j = JSON.parse(raw) as { error?: { message?: string } } | { error?: { message?: string } }[];
        const e = Array.isArray(j) ? j[0]?.error : j.error;
        if (e?.message) detail = e.message;
      } catch {
        /* not JSON: the first few hundred characters will do */
      }
      throw new LlmError(`${res.status} from ${new URL(o.baseURL).host}: ${scrub(detail, o.key)}`, res.status);
    }
    let body: { choices?: { message?: { content?: unknown } }[] };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      throw new LlmError(`the provider answered something that is not JSON: ${scrub(raw.slice(0, 200), o.key)}`);
    }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content))
      return content.map((p) => (typeof p === "string" ? p : ((p as { text?: string }).text ?? ""))).join("");
    throw new LlmError("the provider answered with no message");
  };
}

/* ---- `opencode run` ---- */

/**
 * What the model saw last in an `opencode run --format json` stream.
 *
 * One JSON object per line; the answer arrives as `type: "text"` events carrying `part.text`, one
 * per text part, grouped by `part.messageID`. A run that used a tool would have several messages,
 * so the text of the **last** one that has any is the answer. An `error` event is thrown rather than
 * returned as an empty string, which the generator would read as "no fence" and retry pointlessly.
 */
export function parseOpencodeEvents(jsonl: string): string {
  const byMessage = new Map<string, string[]>();
  let last = "";
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let e: { type?: string; error?: unknown; part?: { messageID?: string; text?: string } };
    try {
      e = JSON.parse(line) as typeof e;
    } catch {
      continue;
    }
    if (e.type === "error") {
      const err = e.error as { data?: { message?: string }; message?: string; name?: string } | undefined;
      throw new LlmError(`opencode: ${err?.data?.message ?? err?.message ?? err?.name ?? JSON.stringify(e.error)}`);
    }
    if (e.type !== "text" || typeof e.part?.text !== "string") continue;
    const id = e.part.messageID ?? "";
    if (!byMessage.has(id)) byMessage.set(id, []);
    byMessage.get(id)!.push(e.part.text);
    last = id;
  }
  return (byMessage.get(last) ?? []).join("");
}

/**
 * A transcript flattened into one message, for a client that takes one.
 *
 * The system turn is not in it — it rides in the agent's own `prompt` — and a single user turn goes
 * through untouched. The fix loop's three-turn shape is written out with its roles named, which a
 * model reads as the conversation it is.
 */
export function flatten(messages: Message[]): string {
  const turns = messages.filter((m) => m.role !== "system");
  if (turns.length === 1) return turns[0]!.content;
  return turns.map((m) => `## ${m.role === "user" ? "User" : "Your earlier answer"}\n\n${m.content}`).join("\n\n");
}

interface OpencodeOptions {
  model: string;
  /** The variant a run asks for — opencode's name for reasoning effort, written `model#variant`. */
  variant?: string;
  env: Env;
  bin?: string;
  /** Milliseconds before the child is killed: `ANYDAG_LLM_TIMEOUT`. */
  timeout?: number;
  spawnImpl?: typeof nodeSpawn;
  /** Where the throwaway directory goes; the OS temp dir unless a test says otherwise. */
  tmpRoot?: string;
}

/** The agent a run is handed: our system prompt, and every permission refused. */
export function opencodeConfig(system: string): object {
  return {
    autoupdate: false,
    agent: {
      "dag-diagram": {
        mode: "primary",
        description: "Writes one AnyDag diagram fence. Text only.",
        prompt: `{file:${system}}`,
        permission: { "*": "deny" },
      },
    },
  };
}

/** `-m`'s value: the model, with the variant after a `#` unless the model already names one. */
export const opencodeModel = (model: string, variant?: string): string =>
  variant && !model.includes("#") ? `${model}#${variant}` : model;

/** The flags of one run, checked against `opencode run --help` (2.2.5) and a real run. */
export function opencodeArgs(model: string, variant?: string): string[] {
  return [
    "run",
    "--standalone",
    "-m",
    opencodeModel(model, variant),
    "--agent",
    "dag-diagram",
    "--title",
    "dag-generate",
    "--format",
    "json",
  ];
}

/** The session a run made, read off its events, so it can be deleted after. */
export function opencodeSession(jsonl: string): string | undefined {
  return /"sessionID":"(ses_[^"]+)"/.exec(jsonl)?.[1];
}

/**
 * `opencode run`, fenced off from everything it could otherwise reach, on whatever OpenCode is
 * signed into — the person's own login, OpenCode Go among them. Written for OpenCode 2, and each of
 * these was found by running it:
 *
 * - **`--standalone`**, a private server for this one run. Without it a run goes through the
 *   person's background OpenCode service, which has its own config — MCP servers, plugins, their
 *   agents — and never sees the environment below.
 * - **An empty directory**, made per call and removed after, is the working directory and so the
 *   run's project, and **`XDG_CONFIG_HOME` points into it**, so the machine's global config is not
 *   loaded. The login is untouched: OpenCode keeps it under `XDG_DATA_HOME`.
 * - **The agent comes in `OPENCODE_CONFIG_CONTENT`** with its prompt as `{file:…}`, because the
 *   system prompt is tens of kilobytes and an environment string has a ceiling of its own.
 * - **`permission: {"*": "deny"}`** offers it no tool: 2.x leaves a denied tool out of the request,
 *   so a one-word answer costs about 500 input tokens where the default agent's tools cost 13,700.
 *   (1.x took `tools` by name and hung on a wildcard; 2.x reads `"*"`.) There is no `--auto`, so
 *   nothing could be granted headless anyway.
 * - **The request goes in on stdin**, so its size and a leading dash are nobody's problem.
 * - **The session is deleted after**, by its id, because a standalone run still writes one into
 *   the person's OpenCode history. About 0.3 s, and a failure to delete is not the card's problem.
 */
export function opencodeComplete(o: OpencodeOptions): Complete {
  const spawn = o.spawnImpl ?? nodeSpawn;
  const bin = o.bin ?? "opencode";
  return async (messages, signal) => {
    const dir = fs.mkdtempSync(path.join(o.tmpRoot ?? os.tmpdir(), "dag-opencode-"));
    let out = "";
    try {
      const system = path.join(dir, "system.md");
      fs.writeFileSync(
        system,
        messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n"),
      );
      fs.mkdirSync(path.join(dir, "config"));
      const env = {
        ...opencodeEnv(o.env),
        XDG_CONFIG_HOME: path.join(dir, "config"),
        OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig(system)),
      };
      return await new Promise<string>((resolve, reject) => {
        const child = spawn(bin, opencodeArgs(o.model, o.variant), { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
        let err = "";
        let timer: ReturnType<typeof setTimeout> | undefined;
        child.stdout?.on("data", (b: Buffer) => (out += b.toString("utf8")));
        child.stderr?.on("data", (b: Buffer) => (err += b.toString("utf8")));
        /* Settled before the kill, so the `close` it causes cannot answer first with an exit code. */
        const stop = (why: string) => {
          reject(new LlmError(why));
          child.kill("SIGTERM");
        };
        const abort = () => stop("cancelled");
        if (signal?.aborted) return abort();
        signal?.addEventListener("abort", abort, { once: true });
        if (o.timeout) timer = setTimeout(() => stop(`OpenCode did not answer in ${Math.round(o.timeout! / 1000)} s`), o.timeout);
        child.on("error", (e) => reject(new LlmError(`could not start OpenCode: ${e.message}`)));
        child.stdin?.on("error", () => undefined);
        child.stdin?.end(flatten(messages));
        child.on("close", (code) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (signal?.aborted) return;
          /* An error event — a model or a variant it does not have, no login for its provider —
             exits 1 too, and says more than the exit code, so the events are read first. */
          let text: string;
          try {
            text = parseOpencodeEvents(out);
          } catch (e) {
            return reject(e);
          }
          if (code !== 0)
            return reject(new LlmError(`opencode exited ${code}: ${(err || out).trim().split("\n").slice(-3).join(" ")}`));
          if (!text) return reject(new LlmError("OpenCode answered with no text"));
          resolve(text);
        });
      });
    } finally {
      const session = opencodeSession(out);
      if (session) await forgetOpencode(bin, session, o.env, { spawnImpl: spawn, tmpRoot: o.tmpRoot, timeout: 5_000 });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

/* ---- `claude -p` ---- */

/**
 * What `claude -p --output-format json` printed: one object, the answer in `result`.
 *
 * A refusal comes back the same way — `is_error: true` with the reason in `result`, "Not logged in
 * · Please run /login" among them — and exits 1, so the object is read before the exit code is.
 */
export function parseClaudeResult(stdout: string): { text: string } | { error: string } | null {
  let j: { is_error?: unknown; result?: unknown; subtype?: unknown };
  try {
    j = JSON.parse(stdout.trim()) as typeof j;
  } catch {
    return null;
  }
  if (j.is_error === true) return { error: typeof j.result === "string" && j.result ? j.result : String(j.subtype ?? "error") };
  return { text: typeof j.result === "string" ? j.result : "" };
}

interface ClaudeOptions {
  model: string;
  /** `--effort`: low · medium · high, when the card asked for one. */
  effort?: string;
  env: Env;
  bin?: string;
  /** Milliseconds before the child is killed: `ANYDAG_LLM_TIMEOUT`. */
  timeout?: number;
  spawnImpl?: typeof nodeSpawn;
  tmpRoot?: string;
}

/**
 * The flags that make Claude Code answer and do nothing else, each one checked against
 * `claude --help` (2.1.318) and a real run:
 *
 * - **`--safe-mode`** turns off every customisation — CLAUDE.md, skills, plugins, hooks, MCP
 *   servers, agents — and leaves the login alone. `--bare` looks like the obvious flag and is the
 *   wrong one: it reads only `ANTHROPIC_API_KEY`, never the subscription's OAuth login.
 * - **`--tools ""`** offers the model no tool at all, and `--strict-mcp-config` with no
 *   `--mcp-config` connects no MCP server, belt to `--safe-mode`'s braces.
 * - **`--no-session-persistence`** writes no transcript under `~/.claude/projects`.
 * - **`--system-prompt-file`** replaces Claude Code's own prompt with ours, from a file because it
 *   is tens of kilobytes; the request goes in on stdin, so its size and a leading dash are nobody's
 *   problem.
 */
export function claudeArgs(model: string, system: string, effort?: string): string[] {
  return [
    "-p",
    "--safe-mode",
    "--output-format",
    "json",
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--system-prompt-file",
    system,
    "--model",
    model,
    ...(effort ? ["--effort", effort] : []),
  ];
}

/**
 * Claude Code in print mode, on whatever account it is signed into — the person's own Claude
 * subscription, with no key anywhere in AnyDag. One call is one `claude -p` in an empty directory
 * made for it and removed after, the way `opencodeComplete` runs OpenCode.
 */
export function claudeComplete(o: ClaudeOptions): Complete {
  const spawn = o.spawnImpl ?? nodeSpawn;
  return async (messages, signal) => {
    const dir = fs.mkdtempSync(path.join(o.tmpRoot ?? os.tmpdir(), "dag-claude-"));
    try {
      const system = path.join(dir, "system.md");
      fs.writeFileSync(
        system,
        messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n"),
      );
      return await new Promise<string>((resolve, reject) => {
        const child = spawn(o.bin ?? "claude", claudeArgs(o.model, system, o.effort), {
          cwd: dir,
          env: claudeEnv(o.env),
          stdio: ["pipe", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        let timer: ReturnType<typeof setTimeout> | undefined;
        child.stdout?.on("data", (b: Buffer) => (out += b.toString("utf8")));
        child.stderr?.on("data", (b: Buffer) => (err += b.toString("utf8")));
        /* Settled before the kill, so the `close` it causes cannot answer first with an exit code. */
        const stop = (why: string) => {
          reject(new LlmError(why));
          child.kill("SIGTERM");
        };
        const abort = () => stop("cancelled");
        if (signal?.aborted) return abort();
        signal?.addEventListener("abort", abort, { once: true });
        if (o.timeout)
          timer = setTimeout(() => stop(`Claude Code did not answer in ${Math.round(o.timeout! / 1000)} s`), o.timeout);
        child.on("error", (e) => reject(new LlmError(`could not start Claude Code: ${e.message}`)));
        child.stdin?.on("error", () => undefined);
        child.stdin?.end(flatten(messages));
        child.on("close", (code) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (signal?.aborted) return;
          const said = parseClaudeResult(out);
          if (said && "error" in said) return reject(new LlmError(`Claude Code: ${said.error}`));
          if (code !== 0 || !said)
            return reject(new LlmError(`claude exited ${code}: ${(err || out).trim().split("\n").slice(-3).join(" ")}`));
          if (!said.text) return reject(new LlmError("Claude Code answered with no text"));
          resolve(said.text);
        });
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

/**
 * What a provider's own vocabulary calls each level of the one effort scale.
 *
 * Claude Code's `--effort` takes low, medium, high, xhigh and max, so the scale passes through. It
 * has no "none", so None — a value stored before the scale changed — is its lowest, low.
 */
function claudeEffort(level: string): string | undefined {
  switch (level) {
    case "none":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "max":
      return "max";
    default:
      return undefined;
  }
}

/**
 * OpenCode's variant, which is not the same vocabulary.
 *
 * A variant is the model's own word, and which exist is the model's business: GLM 5.3 Flash and
 * DeepSeek 4.1 Flash take `low`, `high` and `max` and refuse `none`, `minimal` and `medium`; Kimi K3
 * takes only `max`. So `none` asks for the least that exists widely, `medium` sends nothing — the
 * model's own default — and a model that has no such variant refuses in its own words on the card.
 */
function opencodeEffort(level: string): string | undefined {
  switch (level) {
    case "none":
    case "low":
      return "low";
    case "medium":
      return undefined;
    case "high":
      return "high";
    case "max":
      return "max";
    default:
      return undefined;
  }
}

/**
 * The body field an OpenAI-compatible provider reads. It takes none, low, medium and high; the
 * app's Max is that highest, high.
 */
function httpEffort(level: string): string | undefined {
  switch (level) {
    case "none":
      return "none";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "max":
      return "high";
    default:
      return undefined;
  }
}

/**
 * The one mapping from the app's effort scale to what a provider accepts. `undefined` is the
 * provider's own setting — Automatic, or OpenCode's `medium`, which asks for nothing.
 *
 * It lives beside the three adapters that spell the values: Claude's `--effort`, OpenCode's
 * `#variant`, and the HTTP `reasoning_effort`. The Assistant's turn uses it too, so a Max chosen in
 * the composer cannot be sent to a harness that has no word for it.
 */
export function effortFor(provider: string, want?: Want): string | undefined {
  const level = want?.reasoning?.trim();
  if (!level || level === "default") return undefined;
  switch (provider) {
    case "claude":
      return claudeEffort(level);
    case "opencode":
      return opencodeEffort(level);
    default:
      return httpEffort(level);
  }
}

/** What a request may ask for on top of the provider's own settings. The settings card's half. */
export interface Want {
  /** One of the app's effort levels — `none` from an older preference included — or `default`. */
  reasoning?: string | null;
}

/**
 * The variant a run gets: what the settings card asked for, else how this machine is set up.
 *
 * `default` is a choice like any other and outranks `ANYDAG_LLM_VARIANT`, which is what it means on the
 * HTTP side too — somebody asking for the model's own thinking is not asking for this machine's flag.
 */
export function variantFor(env: Env, want?: Want): string | undefined {
  const asked = want?.reasoning?.trim();
  if (asked === "default") return undefined;
  if (asked) return effortFor("opencode", want);
  return env.ANYDAG_LLM_VARIANT?.trim() || undefined;
}

/** The adapter a resolved provider needs, with the knobs the environment sets. */
export function completeFor(r: Resolved, env: Env, want?: Want): Complete {
  if (r.spec.id === "claude")
    return claudeComplete({
      model: r.model,
      effort: effortFor("claude", want),
      env,
      bin: r.bin,
      timeout: Number(env.ANYDAG_LLM_TIMEOUT) || 120_000,
    });
  if (r.spec.id === "opencode")
    return opencodeComplete({
      model: r.model,
      variant: variantFor(env, want),
      env,
      bin: r.bin,
      timeout: Number(env.ANYDAG_LLM_TIMEOUT) || 120_000,
    });
  return httpComplete({ baseURL: r.baseURL!, key: r.key, model: r.model, extra: extraFor(r, env, want) });
}

/**
 * The body fields beyond `model` and `messages`: the provider's measured defaults, then the
 * environment, then what the request asked for — most specific last, because the request is a person
 * choosing in the settings card and the environment is how this machine is set up.
 *
 * `default` at either level sends no `reasoning_effort` at all, which is how a provider's own
 * default is asked for — and a model named in `custom` may not know the field exists.
 */
export function extraFor(r: Resolved, env: Env, want?: Want): Record<string, unknown> {
  const extra: Record<string, unknown> = { ...r.spec.defaults };
  const t = Number(env.ANYDAG_LLM_TEMPERATURE);
  if (env.ANYDAG_LLM_TEMPERATURE && Number.isFinite(t)) extra.temperature = t;
  const fromEnv = env.ANYDAG_LLM_REASONING?.trim();
  if (fromEnv) {
    if (fromEnv === "default") delete extra.reasoning_effort;
    else extra.reasoning_effort = fromEnv;
  }
  const asked = want?.reasoning?.trim();
  if (asked) {
    if (asked === "default") delete extra.reasoning_effort;
    else {
      const mapped = effortFor(r.spec.id, want);
      if (mapped) extra.reasoning_effort = mapped;
      else delete extra.reasoning_effort;
    }
  }
  return extra;
}
