import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AI_COMMAND, BINDINGS, bindingFor, bindingOn } from "@/edit/bindings";
import { aiOn, AI_SWITCHES, anyAiOn } from "@/settings/aiSwitch";
import { AI, readPref } from "@/settings/prefs";
import { DEFAULTS, normalise, readSettings, resetSettingsWithUndo, STORE, writeSettings } from "@/settings/store";
import { drawnSections, SECTIONS } from "@/settings/tabs";

/**
 * The AI switches (#296): a master switch over one switch per feature, kept with the person's AI
 * choices, and every surface reading `aiOn` for the pair.
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

function url(search: string) {
  Object.defineProperty(globalThis, "location", { configurable: true, value: { search } });
}

beforeEach(() => {
  stub();
  url("?board=demo");
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
  Reflect.deleteProperty(globalThis, "location");
});

describe("the AI switches", () => {
  it("are all on by default, so an install that never opens the tab sees nothing change", () => {
    expect(DEFAULTS.features).toEqual({ ai: true, prompts: true, rewrite: true, flashcards: true, assistant: true });
    for (const f of AI_SWITCHES) expect(aiOn(readSettings(), f)).toBe(true);
  });

  it("read a missing or junk value as on, and keep a false", () => {
    const s = normalise({ features: { ai: "no", prompts: false, rewrite: 0, assistant: null } });
    expect(s.features).toEqual({ ai: true, prompts: false, rewrite: true, flashcards: true, assistant: true });
  });

  it("turn one feature off without touching the others", () => {
    const s = writeSettings({ features: { rewrite: false } });
    expect(AI_SWITCHES.filter((f) => aiOn(s, f))).toEqual(["prompts", "flashcards", "assistant"]);
  });

  it("turn every feature off with the master, and restore each as it was when it comes back", () => {
    writeSettings({ features: { flashcards: false } });
    const off = writeSettings({ features: { ai: false } });
    for (const f of AI_SWITCHES) expect(aiOn(off, f)).toBe(false);
    expect(anyAiOn(off)).toBe(false);
    /* The master leaves each feature's own switch alone. */
    expect(off.features.prompts).toBe(true);
    const on = writeSettings({ features: { ai: true } });
    expect(AI_SWITCHES.filter((f) => aiOn(on, f))).toEqual(["prompts", "rewrite", "assistant"]);
  });

  it("are the person's: kept in `dag:ai`, never in the vault's settings", () => {
    const store = stub();
    writeSettings({ features: { assistant: false } });
    expect(JSON.parse(readPref(AI) ?? "{}").features.assistant).toBe(false);
    expect(store[STORE]).toBeUndefined();
  });

  it("are read as all on under a snapshot, whatever this browser says", () => {
    writeSettings({ features: { ai: false } });
    url("?board=demo&snapshot=1");
    expect(anyAiOn(readSettings())).toBe(true);
  });

  it("go back to on with the AI tab's reset, and Undo puts them back", () => {
    writeSettings({ features: { ai: false, prompts: false } });
    const undo = resetSettingsWithUndo(["features", "llm", "assistant"]);
    expect(readSettings().features).toEqual(DEFAULTS.features);
    undo();
    expect(readSettings().features).toMatchObject({ ai: false, prompts: false });
  });
});

describe("the leader chords of an AI feature", () => {
  const off = (feature: string) => (f: string) => f !== feature;

  it("name the prompt card's and the Assistant's", () => {
    expect(AI_COMMAND).toEqual({ prompt: "prompts", assistant: "assistant" });
  });

  it("do nothing while their feature is off, and every other chord still answers", () => {
    expect(bindingFor("p", off("prompts"))).toBeUndefined();
    expect(bindingFor("a", off("assistant"))).toBeUndefined();
    expect(bindingFor("p", off("assistant"))?.command).toBe("prompt");
    expect(bindingFor("n", () => false)?.command).toBe("note");
    expect(bindingFor("p")?.command).toBe("prompt");
  });

  it("leave the overlay and the sheet with every AI feature off", () => {
    const live = BINDINGS.filter((b) => bindingOn(b, () => false)).map((b) => b.command);
    expect(live).not.toContain("prompt");
    expect(live).not.toContain("assistant");
    expect(live).toContain("note");
  });
});

describe("the Settings tabs with AI off", () => {
  const tabs = (ai: boolean) => drawnSections(SECTIONS, { cloud: true, board: false, ai }).flatMap((g) => g.tabs);

  it("drop AI providers and keep the AI tab, where the switches are", () => {
    expect(tabs(true)).toContain("providers");
    expect(tabs(false)).not.toContain("providers");
    expect(tabs(false)).toContain("ai");
  });
});
