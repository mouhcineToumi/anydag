import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PROVIDER_NAMES } from "../../src/settings/providerNames";

/**
 * Who can write a diagram for a prompt card, and how each is reached.
 *
 * Two kinds, and one interface in front of both (`llm.ts`):
 *
 * - **`http`** — an OpenAI-compatible `chat/completions` endpoint and a key. `custom` is anything
 *   that speaks the dialect — OpenRouter, Ollama, a local vLLM, and Gemini or Z.ai through their
 *   OpenAI-compatible endpoints — named from the environment.
 * - **`cli`** — a coding agent's own command line, which reuses whatever it is logged into.
 *   `claude` is Claude Code in print mode, on the person's own Claude subscription: no key, because
 *   the login is the CLI's. `opencode` is OpenCode 2 the same way, on whatever it is signed into —
 *   and it is how GLM through **OpenCode Go** is reached, which it has to be: Go's HTTP endpoint is
 *   for coding agents that identify themselves and carry a session (`x-opencode-session`), and
 *   calling it straight from AnyDag is exactly the traffic its terms single out. The CLI *is* the
 *   client it was built for.
 *
 * **No key ever leaves this file's caller.** The registry is resolved on the dev server from its
 * environment, `describeProviders()` reports only whether one is present, and the browser names a
 * provider by id and nothing else.
 */

export type ProviderKind = "http" | "cli";

/** Why a provider cannot answer, in words a machine can act on. The plain `error` stays beside it. */
export type LlmReasonCode =
  | "no-key"
  | "needs-model"
  | "needs-base-url"
  | "not-installed"
  | "not-signed-in"
  | "too-old"
  | "unknown-provider"
  | "busy"
  | "timeout"
  | "provider-error";

export interface LlmReason {
  code: LlmReasonCode;
  provider?: string;
  /** For `no-key`: the environment variables the server reads, in the order it reads them. */
  keyEnv?: string[];
}

/** A refusal a route can send as `{ error, reason }`: the sentence MCP reads, and the code the page reads. */
export interface Failure {
  ok: false;
  error: string;
  reason: LlmReason;
}

const refusal = (error: string, code: LlmReasonCode, provider?: string, keyEnv?: string[]): Failure => ({
  ok: false,
  error,
  reason: { code, ...(provider ? { provider } : {}), ...(keyEnv ? { keyEnv } : {}) },
});

const OPENCODE_DEFAULT_MODEL = "opencode-go/glm-5.3-flash";

export interface ProviderSpec {
  id: string;
  /** The app's one name for it (`src/settings/providerNames.ts`). */
  label: string;
  /** What the name no longer explains: whose plan or login it uses, or what the endpoint is. */
  description: string;
  kind: ProviderKind;
  /** `http` only. `custom` reads it from `ANYDAG_LLM_BASE_URL` instead. */
  baseURL?: string;
  /** The first of these that is set is the key. `cli` has none: the CLI holds its own login. */
  keyEnv: string[];
  defaultModel: string;
  /** Suggestions for the settings card, not a whitelist: any model the endpoint knows is accepted. */
  models: string[];
  /** Body fields sent unless the environment says otherwise (`ANYDAG_LLM_REASONING`, `ANYDAG_LLM_TEMPERATURE`). */
  defaults?: Record<string, unknown>;
}

export const PROVIDERS: ProviderSpec[] = [
  {
    id: "claude",
    label: PROVIDER_NAMES.claude,
    description: "Uses your Claude plan, through the Claude Code signed in on this computer.",
    kind: "cli",
    keyEnv: [],
    /* Claude Code's aliases for the latest of each, so the row does not go stale with a release. */
    defaultModel: "sonnet",
    models: ["sonnet", "opus", "haiku", "fable"],
  },
  {
    id: "opencode",
    label: PROVIDER_NAMES.opencode,
    description: "Uses your OpenCode login and whatever it is signed in to. No key here.",
    kind: "cli",
    keyEnv: [],
    defaultModel: OPENCODE_DEFAULT_MODEL,
    models: ["opencode-go/glm-5.3-flash", "opencode-go/glm-5.3", "opencode-go/kimi-k3", "opencode-go/deepseek-v4.1-flash"],
  },
  {
    id: "custom",
    label: PROVIDER_NAMES.custom,
    description: "Any endpoint that speaks the OpenAI chat-completions dialect.",
    kind: "http",
    keyEnv: ["ANYDAG_LLM_API_KEY"],
    defaultModel: "",
    models: [],
  },
];

export type Env = Record<string, string | undefined>;

/** A provider with everything needed to call it. Server-side only: it carries the key. */
export interface Resolved {
  spec: ProviderSpec;
  model: string;
  baseURL?: string;
  key?: string;
  /** `cli` only, when the binary had to be looked for: the path it was found at. */
  bin?: string;
}

const keyOf = (spec: ProviderSpec, env: Env): string | undefined =>
  spec.keyEnv
    .map((k) => env[k])
    .find((v) => typeof v === "string" && v.trim() !== "")
    ?.trim();

const executable = (file: string): boolean => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

/** Where `bin` is on `PATH`, if it is. Sync and cheap: it is asked once per request. */
export function whichOn(bin: string, env: Env): string | undefined {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (dir && executable(path.join(dir, bin))) return path.join(dir, bin);
  }
  return undefined;
}

/** Whether `bin` is an executable somewhere on `PATH`. */
export const onPath = (bin: string, env: Env): boolean => whichOn(bin, env) !== undefined;

/**
 * Where a coding agent's CLI is, or why it cannot be used.
 *
 * Its `ANYDAG_*_BIN` wins, then `PATH`, then the places its installers put it. The last is not belt
 * and braces: the desktop app launched from a menu or an AppImage inherits the session's `PATH`, not
 * a login shell's, so `~/.local/bin` — where Claude Code's native installer links it — and
 * `~/.opencode/bin` are very often not on it, and the provider would say "not installed" on a
 * machine where the command works in every terminal.
 */
function findCli(
  name: string,
  told: string | undefined,
  tellVar: string,
  places: (home: string, exe: string) => string[],
  env: Env,
): { ok: true; bin: string } | { ok: false; error: string } {
  const t = told?.trim();
  if (t) return executable(t) ? { ok: true, bin: t } : { ok: false, error: `${tellVar} (${t}) is not an executable` };
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const found = whichOn(exe, env);
  if (found) return { ok: true, bin: found };
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || os.homedir();
  const bin = [
    ...places(home, exe),
    path.join(home, ".npm-global", "bin", exe),
    path.join(home, ".local", "share", "mise", "shims", exe),
    path.join(home, ".volta", "bin", exe),
    path.join(home, ".bun", "bin", exe),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ].find(executable);
  return bin ? { ok: true, bin } : { ok: false, error: "" };
}

/** Remember a yes for a minute and a no for three seconds, so somebody who has just signed in is
 *  not told otherwise for long. Keyed by whatever the answer depends on. */
const seen = new Map<string, { at: number; value: unknown }>();

/** Forget every remembered answer: Settings' *Check again*, after somebody signed in or installed
 *  something and does not want to wait out a remembered no. */
export function forgetReadiness(): void {
  seen.clear();
}
function remembered<T>(key: string, ask: () => T, good: (v: T) => boolean): T {
  const was = seen.get(key);
  if (was && Date.now() - was.at < (good(was.value as T) ? 60_000 : 3_000)) return was.value as T;
  const value = ask();
  seen.set(key, { at: Date.now(), value });
  return value;
}

/* ---- Claude Code ---- */

/** Where Claude Code is, or why it cannot be used. */
export function findClaude(env: Env): { ok: true; bin: string } | Failure {
  const r = findCli(
    "claude",
    env.ANYDAG_CLAUDE_BIN,
    "ANYDAG_CLAUDE_BIN",
    (home, exe) => [path.join(home, ".local", "bin", exe), path.join(home, ".claude", "local", exe)],
    env,
  );
  if (r.ok) return r;
  return refusal(
    r.error || "Claude Code is not installed — install it and sign in, or set ANYDAG_CLAUDE_BIN",
    "not-installed",
    "claude",
  );
}

/**
 * The environment a `claude` child runs in: the server's, less what would change whose account
 * answers or confuse the child. An `ANTHROPIC_API_KEY` in it would bill that key instead of using
 * the subscription the person chose this row for; `ELECTRON_RUN_AS_NODE` and the server's token are
 * the desktop shell's business; and `CLAUDECODE` set by a dev server started from inside a Claude
 * Code session makes the child think it is nested in one.
 */
export function claudeEnv(env: Env): Env {
  const out: Env = { ...env };
  for (const k of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ELECTRON_RUN_AS_NODE",
    "ANYDAG_TOKEN",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
  ])
    delete out[k];
  return out;
}

/**
 * Whether the Claude Code at `bin` is signed in, through `claude auth status`, which answers in
 * about 0.2 s and prints `{"loggedIn": …}`. A CLI too old to have the command is given the benefit
 * of the doubt: the run itself says if it is not.
 */
export function claudeSignedIn(bin: string, env: Env): boolean {
  return remembered(
    `claude:${bin}`,
    () => {
      const r = spawnSync(bin, ["auth", "status", "--json"], { env: claudeEnv(env), encoding: "utf8", timeout: 5_000 });
      try {
        return (JSON.parse(r.stdout) as { loggedIn?: unknown }).loggedIn !== false;
      } catch {
        /* not JSON: an older CLI, or one that could not start — the run will say which */
        return true;
      }
    },
    (ok) => ok,
  );
}

/** Claude Code found and signed in, or why not. */
export function claudeReady(env: Env): { ok: true; bin: string } | Failure {
  const found = findClaude(env);
  if (!found.ok) return found;
  if (!claudeSignedIn(found.bin, env))
    return refusal(
      "Claude Code is not signed in — run `claude` once and sign in with your Claude account",
      "not-signed-in",
      "claude",
    );
  return found;
}

/* ---- OpenCode ---- */

/** Where OpenCode is, or why it cannot be used. `~/.opencode/bin` is where its install script puts it. */
export function findOpencode(env: Env): { ok: true; bin: string } | Failure {
  const r = findCli(
    "opencode",
    env.ANYDAG_OPENCODE_BIN,
    "ANYDAG_OPENCODE_BIN",
    (home, exe) => [path.join(home, ".opencode", "bin", exe)],
    env,
  );
  if (r.ok) return r;
  return refusal(
    r.error || "OpenCode is not installed — install it and sign in, or set ANYDAG_OPENCODE_BIN",
    "not-installed",
    "opencode",
  );
}

/**
 * The environment an `opencode` child runs in: the server's, less the desktop shell's business and
 * anything that would point it at a config other than the one `opencodeComplete` hands it.
 */
export function opencodeEnv(env: Env): Env {
  const out: Env = { ...env };
  for (const k of ["ELECTRON_RUN_AS_NODE", "ANYDAG_TOKEN", "OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG_CONTENT"])
    delete out[k];
  return out;
}

/** The major version `opencode --version` prints (`opencode v2.2.5`), or `undefined` when it says nothing readable. */
export function opencodeMajor(bin: string, env: Env): number | undefined {
  return remembered(
    `opencode-version:${bin}`,
    () => {
      const r = spawnSync(bin, ["--version"], { env: opencodeEnv(env), encoding: "utf8", timeout: 5_000 });
      const m = /(\d+)\.\d+/.exec(`${r.stdout ?? ""}`);
      return m ? Number(m[1]) : undefined;
    },
    (v) => v !== undefined,
  );
}

/**
 * The providers OpenCode holds a login for, through `opencode auth list --format json` — about 80 ms.
 * `undefined` when it would not say, which is read as "maybe": the run itself says if it is not.
 */
export function opencodeLogins(bin: string, env: Env): Set<string> | undefined {
  return remembered(
    `opencode-auth:${bin}`,
    () => {
      const r = spawnSync(bin, ["auth", "list", "--format", "json"], { env: opencodeEnv(env), encoding: "utf8", timeout: 5_000 });
      try {
        const list = JSON.parse(r.stdout) as { id?: string; connections?: unknown[] }[];
        return new Set(list.filter((p) => typeof p.id === "string" && (p.connections?.length ?? 0) > 0).map((p) => p.id!));
      } catch {
        return undefined;
      }
    },
    (v) => v === undefined || v.size > 0,
  );
}

/**
 * OpenCode found, new enough, and signed in to the provider `model` names, or why not.
 *
 * **2 or later**, because 2.0 changed the whole headless surface: `--pure`, `--dir` and `--variant`
 * are gone, a variant is written `model#variant`, a run goes through a background service unless it
 * is `--standalone`, and an agent's tools are a `permission` rather than a `tools` map. One shape is
 * supported, and a 1.x is told to upgrade rather than half-working.
 */
export function opencodeReady(env: Env, model?: string): { ok: true; bin: string } | Failure {
  const found = findOpencode(env);
  if (!found.ok) return found;
  const major = opencodeMajor(found.bin, env);
  if (major !== undefined && major < 2)
    return refusal(`OpenCode ${major}.x is too old — run \`opencode upgrade\` (2 or later is needed)`, "too-old", "opencode");
  const logins = opencodeLogins(found.bin, env);
  const provider = model?.split("/")[0];
  if (logins && (logins.size === 0 || (provider && !logins.has(provider))))
    return refusal(
      `OpenCode is not signed in${provider ? ` to ${provider}` : ""} — run \`opencode auth login\``,
      "not-signed-in",
      "opencode",
    );
  return found;
}

/**
 * Which providers the default is looked for in, first to last. In the desktop app (`ANYDAG_DESKTOP=1`,
 * set by the shell) the coding agents' CLIs come first, because a plan the person already pays for
 * needs no key. A browser has nothing keyed ahead of them now that Gemini and Z.ai are reached through
 * OpenAI-compatible, so the order is the same there. When none can answer, the first row is the one
 * whose refusal the person is told.
 */
const DEFAULT_ORDER = {
  desktop: ["claude", "opencode", "custom"],
  elsewhere: ["claude", "opencode", "custom"],
} as const;

/** Ids this build no longer offers. They stay reachable through `custom`'s OpenAI-compatible row. */
export const RETIRED_PROVIDERS: readonly string[] = ["gemini", "zai"];

/** The provider a request names, or `undefined` when it names none — or one this build retired. */
export function namedProvider(id: string | null | undefined): string | undefined {
  const said = id?.trim();
  if (!said || RETIRED_PROVIDERS.includes(said)) return undefined;
  return said;
}

/**
 * The id the server uses when a request names none: `ANYDAG_LLM_PROVIDER`; else the first provider in
 * `DEFAULT_ORDER` that can answer now; else the first row of that order, whose refusal is then what the
 * person is told. Every readiness check is remembered (`remembered`), so asking costs nothing after
 * the first time.
 */
export function defaultProvider(env: Env): string {
  const named = namedProvider(env.ANYDAG_LLM_PROVIDER);
  if (named) return named;
  const order = env.ANYDAG_DESKTOP === "1" ? DEFAULT_ORDER.desktop : DEFAULT_ORDER.elsewhere;
  return order.find((id) => resolveProvider(env, { provider: id }).ok) ?? order[0];
}

/**
 * Turn a request's `provider`/`model` into something callable, or say why not.
 *
 * `ANYDAG_LLM_MODEL` belongs to the provider `ANYDAG_LLM_PROVIDER` names, and to the
 * OpenAI-compatible row: a person who picked a different provider in the settings card and left the
 * model empty wants that provider's default, not one provider's model name sent to another. A
 * `gemini` or `zai` in a request or in the environment is read as if no provider were named, so the
 * default answers rather than a request failing with `unknown-provider`.
 */
export function resolveProvider(
  env: Env,
  want?: { provider?: string | null; model?: string | null },
): { ok: true; value: Resolved } | Failure {
  const id = namedProvider(want?.provider) ?? defaultProvider(env);
  const spec = PROVIDERS.find((p) => p.id === id);
  if (!spec)
    return refusal(`no provider \`${id}\` — expected one of ${PROVIDERS.map((p) => p.id).join(", ")}`, "unknown-provider", id);

  /* Read against the provider the environment named, and `custom`: a model set for one provider is
     not a model name Claude Code or OpenCode knows, so it is never sent to them unless one of them
     is the provider the environment named. */
  const named = namedProvider(env.ANYDAG_LLM_PROVIDER);
  const envModel = id === "custom" || (named !== undefined && id === named) ? env.ANYDAG_LLM_MODEL?.trim() : undefined;
  /* A retired provider's model goes with it: `gemini-3.8-flash` means nothing to the default. */
  const retired = Boolean(want?.provider?.trim()) && namedProvider(want?.provider) === undefined;
  const model = (retired ? "" : want?.model?.trim()) || envModel || spec.defaultModel;
  if (!model)
    return refusal(`provider \`${id}\` needs a model — set ANYDAG_LLM_MODEL or pick one in Settings`, "needs-model", id);

  if (spec.id === "claude") {
    const ready = claudeReady(env);
    if (!ready.ok) return ready;
    return { ok: true, value: { spec, model, bin: ready.bin } };
  }
  if (spec.id === "opencode") {
    const ready = opencodeReady(env, model);
    if (!ready.ok) return ready;
    return { ok: true, value: { spec, model, bin: ready.bin } };
  }

  const baseURL = (spec.id === "custom" ? env.ANYDAG_LLM_BASE_URL?.trim() : spec.baseURL)?.replace(/\/+$/, "");
  if (!baseURL) return refusal("provider `custom` needs ANYDAG_LLM_BASE_URL", "needs-base-url", "custom");
  const key = keyOf(spec, env);
  /* A local endpoint (Ollama, vLLM) may take no key at all; every hosted one here needs one. */
  if (!key && spec.id !== "custom")
    return refusal(`provider \`${id}\` has no key — set ${spec.keyEnv.join(" or ")} in .env.local`, "no-key", id, spec.keyEnv);
  return { ok: true, value: { spec, model, baseURL, key } };
}

/** What `GET /__board/llm` returns: which providers exist and which could run now. No secrets. */
export interface PublicProvider {
  id: string;
  label: string;
  /** What the name no longer explains, as one line under the provider's row in Settings. */
  description: string;
  kind: ProviderKind;
  /** The environment variables its key is read from, first one first. Names, never values. */
  keyEnv: string[];
  defaultModel: string;
  models: string[];
  ready: boolean;
  /** Why it is not ready, in the server's own words. */
  error?: string;
  /** The same answer, for the page to turn into a sentence and a next step. */
  reason?: LlmReason;
}

export function describeProviders(env: Env): { default: string; providers: PublicProvider[] } {
  return {
    default: defaultProvider(env),
    providers: PROVIDERS.map((spec) => {
      const r = resolveProvider(env, { provider: spec.id });
      return {
        id: spec.id,
        label: spec.label,
        description: spec.description,
        kind: spec.kind,
        keyEnv: [...spec.keyEnv],
        defaultModel: r.ok ? r.value.model : spec.defaultModel,
        models: spec.models,
        ready: r.ok,
        error: r.ok ? undefined : r.error,
        reason: r.ok ? undefined : r.reason,
      };
    }),
  };
}
