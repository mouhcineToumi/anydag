/**
 * Why a model could not answer, turned into a sentence a person can read and the next steps they
 * can take. The server sends a machine-readable `reason` beside its developer `error`; this is the
 * one place the page decides what that means, so a prompt card, a rewrite, flashcards and the
 * Settings tab all say the same thing.
 *
 * **No provider ids and no backticks reach the screen.** A provider is named the way the app names
 * it ("Claude Code", "Gemini"); a variable name is plain text here and `LlmSentence` draws it as
 * code. The host matters: the desktop app stores a key in its keyring, a browser reads the server's
 * environment, and `.env.local` is never a thing the desktop app's person is told to edit.
 *
 * Pure: no React, no `fetch`, no DOM. The caller passes whether it is the desktop app and which
 * providers are ready; `test/llm-reason.test.ts` holds the sentences and the action limits.
 */

import { providerName } from "./providerNames";

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
  keyEnv?: string[];
}

/** A refused request: the server's sentence, and the reason the page can turn into a next step. */
export class LlmRequestError extends Error {
  constructor(
    message: string,
    readonly reason?: LlmReason,
  ) {
    super(message);
    this.name = "LlmRequestError";
  }
}

/** The part of `GET /__board/llm` this module needs: an id and whether it could answer. */
export interface ProviderStatus {
  id: string;
  ready: boolean;
}

export interface LlmAction {
  kind: "settings" | "provider" | "retry";
  label: string;
  /** For `provider`: which provider the action switches to. */
  provider?: string;
}

export interface Explained {
  sentence: string;
  actions: LlmAction[];
}

export interface ExplainOptions {
  /** The desktop app can store a key; a browser reads the server's environment. */
  host: "desktop" | "browser";
  /** Every provider and whether it could answer now, from `GET /__board/llm`. */
  providers?: readonly ProviderStatus[];
}

const nameOf = (id?: string): string => providerName(id) ?? "The model provider";

/** How each coding agent's CLI signs in, in the words its own installer uses. */
const SIGN_IN: Readonly<Record<string, string>> = {
  claude: "Run claude once in a terminal to sign in.",
  opencode: "Run opencode auth login in a terminal to sign in.",
};

/**
 * The other coding agent that could answer now, if one can. Only the two CLIs are offered: a Gemini
 * or Z.ai key is a different arrangement, while Claude Code and OpenCode are logins the person
 * already has, and switching to one is a single press.
 */
function otherReady(reason: LlmReason, providers?: readonly ProviderStatus[]): string | undefined {
  for (const id of ["claude", "opencode"]) {
    if (id === reason.provider) continue;
    if (providers?.some((p) => p.id === id && p.ready)) return id;
  }
  return undefined;
}

const providerAction = (id: string): LlmAction => ({ kind: "provider", label: `Use ${nameOf(id)}`, provider: id });

/** At most two, as the issue says: one way out, and one alternative when there is one. */
const explained = (sentence: string, actions: LlmAction[]): Explained => ({ sentence, actions: actions.slice(0, 2) });

function assertNever(x: never): never {
  throw new Error(`unhandled reason \`${String(x)}\``);
}

const CODES: ReadonlySet<string> = new Set<LlmReasonCode>([
  "no-key",
  "needs-model",
  "needs-base-url",
  "not-installed",
  "not-signed-in",
  "too-old",
  "unknown-provider",
  "busy",
  "timeout",
  "provider-error",
]);

/** A reason from the wire, or `undefined` for anything this page does not know. */
export function reasonOf(raw: unknown): LlmReason | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const reason = raw as Partial<LlmReason>;
  if (typeof reason.code !== "string" || !CODES.has(reason.code)) return undefined;
  return {
    code: reason.code as LlmReasonCode,
    ...(typeof reason.provider === "string" ? { provider: reason.provider } : {}),
    ...(Array.isArray(reason.keyEnv)
      ? { keyEnv: reason.keyEnv.filter((v): v is string => typeof v === "string" && v !== "") }
      : {}),
  };
}

/**
 * A reason to the sentence and actions the page shows, or `null` when it is missing or unknown —
 * in which case the caller falls back to the server's own `error`, as it always did.
 */
export function explainLlmReason(reason: LlmReason | null | undefined, options: ExplainOptions): Explained | null {
  if (!reason || !CODES.has(reason.code)) return null;
  const name = nameOf(reason.provider);
  const alternative = otherReady(reason, options.providers);
  const other = alternative ? [providerAction(alternative)] : [];
  const settings = (label: "Add a key" | "Open AI settings"): LlmAction => ({ kind: "settings", label });
  const check = (): LlmAction => ({ kind: "retry", label: "Check again" });

  switch (reason.code) {
    case "no-key": {
      const vars = reason.keyEnv ?? [];
      const sentence =
        options.host === "desktop"
          ? `${name} needs an API key.`
          : `${name} needs an API key in the server's environment${vars.length ? `: ${vars.join(" or ")}` : ""}.`;
      return explained(sentence, [settings(options.host === "desktop" ? "Add a key" : "Open AI settings"), ...other]);
    }
    case "needs-model":
      return explained(`${name} needs a model. Choose one in Settings.`, [settings("Open AI settings"), ...other]);
    case "needs-base-url":
      return explained(`${name} needs the address of its server. Set it where the server is configured.`, [
        settings("Open AI settings"),
        ...other,
      ]);
    case "not-installed":
      return explained(`${name} is not installed. Install it, then check again.`, [check(), ...other]);
    case "not-signed-in":
      return explained(
        `${name} is installed but not signed in. ${SIGN_IN[reason.provider ?? ""] ?? "Sign in to it, then check again."}`,
        [check(), ...other],
      );
    case "too-old":
      return explained(`${name} is too old. Update it, then check again.`, [check(), ...other]);
    case "unknown-provider":
      return explained("That model provider is not available. Choose another in Settings.", [
        settings("Open AI settings"),
        ...other,
      ]);
    case "busy":
      return explained("The model is busy with other answers right now. Try again in a moment.", [
        { kind: "retry", label: "Try again" },
      ]);
    case "timeout":
      return explained("The model did not answer in time.", [{ kind: "retry", label: "Try again" }]);
    case "provider-error":
      return explained("The model could not answer.", [{ kind: "retry", label: "Try again" }]);
    default:
      return assertNever(reason.code);
  }
}

/** A piece of a sentence: prose, or a variable name the page draws as code. */
export type SentencePart = string | { code: string };

/**
 * Split a sentence so an environment variable is drawn as code without the server's backticks.
 * Only `UPPER_CASE_WITH_UNDERSCORES` becomes code, so ordinary words are left alone.
 */
export function sentenceParts(text: string): SentencePart[] {
  const parts: SentencePart[] = [];
  const vars = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
  let at = 0;
  for (let m = vars.exec(text); m; m = vars.exec(text)) {
    if (m.index > at) parts.push(text.slice(at, m.index));
    parts.push({ code: m[0] });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}
