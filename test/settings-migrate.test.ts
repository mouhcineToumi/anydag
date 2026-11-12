import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateToPerson } from "@/settings/migrate";
import { AI, THEME } from "@/settings/prefs";
import { DEFAULTS, readSettings, resetSettings, STORE, writeSettings } from "@/settings/store";

/**
 * The theme and the AI choices moved from the vault to the person (#191). These hold the two halves
 * apart and the one-time carry-over, in Node, against a stand-in `localStorage`.
 */
function stub(store: Record<string, string> = {}) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    },
  });
  return store;
}

/* A tab in vault `v1`: the vault's keys are `key@v1`, the person's are bare. */
const VAULT = "v1";
const at = (key: string) => `${key}@${VAULT}`;

beforeEach(() => {
  Object.defineProperty(globalThis, "location", { configurable: true, value: { search: `?vault=${VAULT}` } });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
  Reflect.deleteProperty(globalThis, "location");
});

describe("the AI choices are the person's", () => {
  it("writes llm and assistant to dag:ai, and the vault's sections to the vault's key", () => {
    const store = stub();
    writeSettings({ llm: { provider: "opencode", model: "m" }, export: { scale: 3 } });
    expect(JSON.parse(store[AI]!)).toMatchObject({ llm: { provider: "opencode", model: "m" } });
    const vault = JSON.parse(store[at(STORE)]!);
    expect(vault.export.scale).toBe(3);
    /* The vault's key carries none of the person's sections. */
    expect(vault).not.toHaveProperty("llm");
    expect(vault).not.toHaveProperty("assistant");
    expect(readSettings().llm.provider).toBe("opencode");
  });

  it("does not rewrite the other half's key", () => {
    const store = stub();
    writeSettings({ export: { scale: 3 } });
    expect(store[AI]).toBeUndefined();
    writeSettings({ assistant: { provider: "claude" } });
    expect(JSON.parse(store[at(STORE)]!).export.scale).toBe(3);
  });

  it("reads the choice from the person's key alone, the same in another vault", () => {
    stub({ [AI]: JSON.stringify({ llm: { provider: "claude", model: "opus" } }) });
    expect(readSettings().llm).toMatchObject({ provider: "claude", model: "opus" });
    Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "?vault=v2" } });
    expect(readSettings().llm).toMatchObject({ provider: "claude", model: "opus" });
  });

  it("never reads a vault's old llm once the person has a key", () => {
    stub({
      [AI]: JSON.stringify({ llm: { provider: "claude" } }),
      [at(STORE)]: JSON.stringify({ llm: { provider: "opencode" } }),
    });
    expect(readSettings().llm.provider).toBe("claude");
  });

  it("a reset of the AI sections clears them and leaves the vault's alone", () => {
    const store = stub();
    writeSettings({ llm: { provider: "opencode" }, export: { scale: 3 } });
    resetSettings(["llm", "assistant"]);
    expect(readSettings().llm).toEqual(DEFAULTS.llm);
    expect(JSON.parse(store[at(STORE)]!).export.scale).toBe(3);
  });
});

describe("the carry-over from the vault", () => {
  it("takes the vault's theme and AI choice once, from this browser's copy", () => {
    const store = stub({
      [at(THEME)]: "paper-dark",
      [at(STORE)]: JSON.stringify({ llm: { provider: "opencode", model: "x", reasoning: "low" }, export: { scale: 3 } }),
    });
    expect(migrateToPerson()).toBe(true);
    expect(store[THEME]).toBe("paper-dark");
    expect(readSettings().llm).toEqual({ provider: "opencode", model: "x", reasoning: "low" });
    /* The vault's own copy is left where it was, so nothing is lost. */
    expect(store[at(THEME)]).toBe("paper-dark");
    /* A second run finds the person's values and changes nothing. */
    expect(migrateToPerson()).toBe(false);
  });

  it("prefers the vault's bundle as the server holds it", () => {
    const store = stub({ [at(THEME)]: "neutral" });
    const bundle = { [THEME]: "paper-dark", settings: { assistant: { provider: "claude", model: "sonnet" } } };
    expect(migrateToPerson(bundle)).toBe(true);
    expect(store[THEME]).toBe("paper-dark");
    expect(readSettings().assistant).toEqual({ provider: "claude", model: "sonnet" });
  });

  it("never writes over a value the person already has", () => {
    const store = stub({
      [THEME]: "neutral",
      [AI]: JSON.stringify({ llm: { provider: "claude" } }),
      [at(THEME)]: "paper-dark",
      [at(STORE)]: JSON.stringify({ llm: { provider: "opencode" } }),
    });
    expect(migrateToPerson()).toBe(false);
    expect(store[THEME]).toBe("neutral");
    expect(readSettings().llm.provider).toBe("claude");
  });

  it("writes nothing for a vault that never chose", () => {
    const store = stub({ [at(STORE)]: JSON.stringify({ export: { scale: 2 } }) });
    expect(migrateToPerson()).toBe(false);
    expect(store[THEME]).toBeUndefined();
    expect(store[AI]).toBeUndefined();
  });
});
