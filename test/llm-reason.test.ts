import { describe, expect, it } from "vitest";

import {
  explainLlmReason,
  reasonOf,
  sentenceParts,
  type LlmReason,
  type LlmReasonCode,
  type ProviderStatus,
} from "../src/settings/llmReason";

/**
 * A reason to one sentence and at most two actions, in plain words. No backticks, no `.env.local`
 * in the desktop app, and no provider id on the screen — `src/settings/llmReason.ts` is the one
 * place the four surfaces agree on what an AI failure says.
 */

const providers = (ready: string[]): ProviderStatus[] =>
  ["claude", "opencode", "custom"].map((id) => ({ id, ready: ready.includes(id) }));

const explain = (reason: LlmReason, host: "desktop" | "browser" = "desktop", ready: string[] = []) =>
  explainLlmReason(reason, { host, providers: providers(ready) })!;

describe("explainLlmReason", () => {
  it("says a key is missing, and offers the keyring in the app and another ready provider", () => {
    const said = explain({ code: "no-key", provider: "custom", keyEnv: ["ANYDAG_LLM_API_KEY"] }, "desktop", ["claude"]);
    expect(said.sentence).toBe("OpenAI-compatible needs an API key.");
    expect(said.actions).toEqual([
      { kind: "settings", label: "Add a key" },
      { kind: "provider", label: "Use Claude Code", provider: "claude" },
    ]);
  });

  it("names the server's variable in a browser, drawn as code rather than backticks", () => {
    const said = explain({ code: "no-key", provider: "custom", keyEnv: ["ANYDAG_LLM_API_KEY"] }, "browser");
    expect(said.sentence).toBe("OpenAI-compatible needs an API key in the server's environment: ANYDAG_LLM_API_KEY.");
    expect(said.sentence).not.toContain("`");
    expect(said.sentence).not.toContain(".env.local");
    expect(said.actions).toEqual([{ kind: "settings", label: "Open AI settings" }]);
    expect(sentenceParts(said.sentence)).toContainEqual({ code: "ANYDAG_LLM_API_KEY" });
  });

  it("names OpenAI-compatible as the provider list does, and falls back for an id it does not know", () => {
    expect(explain({ code: "too-old", provider: "custom" }, "browser").sentence).toBe(
      "OpenAI-compatible is too old. Update it, then check again.",
    );
    expect(explain({ code: "too-old", provider: "some-new-thing" }, "browser").sentence).toBe(
      "The model provider is too old. Update it, then check again.",
    );
  });

  it("tells a signed-out coding agent how to sign in, and offers to check again", () => {
    const said = explain({ code: "not-signed-in", provider: "claude" }, "desktop", ["opencode"]);
    expect(said.sentence).toBe("Claude Code is installed but not signed in. Run claude once in a terminal to sign in.");
    expect(said.actions).toEqual([
      { kind: "retry", label: "Check again" },
      { kind: "provider", label: "Use OpenCode", provider: "opencode" },
    ]);
  });

  it("has a next step for every reason, and at most two actions", () => {
    const codes: LlmReasonCode[] = [
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
    ];
    for (const code of codes) {
      const said = explain({ code, provider: "custom" }, "browser", ["claude", "opencode"]);
      expect(said.sentence).not.toBe("");
      expect(said.actions.length).toBeGreaterThan(0);
      expect(said.actions.length).toBeLessThanOrEqual(2);
      expect(said.sentence).not.toContain("`");
      expect(said.sentence).not.toContain(".env.local");
      expect(said.sentence).not.toMatch(/\b(gemini|claude|opencode|zai|custom)\b/);
    }
  });

  it("gives a transient failure its sentence and Try again", () => {
    expect(explain({ code: "busy", provider: "custom" })).toEqual({
      sentence: "The model is busy with other answers right now. Try again in a moment.",
      actions: [{ kind: "retry", label: "Try again" }],
    });
    expect(explain({ code: "timeout", provider: "custom" }).actions).toEqual([{ kind: "retry", label: "Try again" }]);
    expect(explain({ code: "provider-error", provider: "custom" }).sentence).toBe("The model could not answer.");
  });

  it("falls back to the server's own text for a missing or unknown reason", () => {
    expect(explainLlmReason(undefined, { host: "browser" })).toBeNull();
    expect(explainLlmReason({ code: "something-new" as LlmReasonCode }, { host: "browser" })).toBeNull();
    expect(reasonOf({ code: "something-new" })).toBeUndefined();
    expect(reasonOf({ code: "no-key", provider: "custom", keyEnv: ["ANYDAG_LLM_API_KEY"] })).toEqual({
      code: "no-key",
      provider: "custom",
      keyEnv: ["ANYDAG_LLM_API_KEY"],
    });
  });
});
