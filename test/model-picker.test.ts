import { afterEach, describe, expect, it } from "vitest";

import {
  filterModels,
  nearestModel,
  pickerProvidersFromChat,
  pickerProvidersFromLlm,
  prettyModel,
  readRecent,
  RECENT_KEY,
  RECENT_MAX,
  rememberRecent,
  type PickerProvider,
} from "@/ui/modelList";

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

afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

const providers: PickerProvider[] = [
  {
    id: "claude",
    label: "Claude Code",
    ready: true,
    defaultModel: "sonnet",
    models: [
      { id: "sonnet", label: "Sonnet" },
      { id: "opus", label: "Opus" },
    ],
  },
  {
    id: "opencode",
    label: "OpenCode",
    ready: false,
    why: "OpenCode is not signed in",
    defaultModel: "opencode-go/glm-5.3-flash",
    models: [
      { id: "opencode-go/glm-5.3-flash", label: "GLM 5.3 Flash" },
      { id: "opencode-go/kimi-k3", label: "Kimi K3" },
      { id: "opencode-go/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
    ],
  },
];

describe("filterModels", () => {
  it("finds GLM models by id and by readable name, whatever the case", () => {
    const found = filterModels(providers, "glm");
    expect(found).toHaveLength(1);
    expect(found[0]!.provider.id).toBe("opencode");
    expect(found[0]!.models.map((m) => m.id)).toEqual(["opencode-go/glm-5.3-flash"]);
    expect(filterModels(providers, "FLASH")[0]!.models.map((m) => m.id)).toEqual([
      "opencode-go/glm-5.3-flash",
      "opencode-go/deepseek-v4.1-flash",
    ]);
  });

  it("keeps every model when the query names the provider", () => {
    const found = filterModels(providers, "claude code");
    expect(found).toHaveLength(1);
    expect(found[0]!.models.map((m) => m.label)).toEqual(["Sonnet", "Opus"]);
  });

  it("returns everything for an empty query and nothing for a query no model matches", () => {
    expect(filterModels(providers, "  ")).toHaveLength(2);
    expect(filterModels(providers, "not-a-model")).toEqual([]);
  });
});

describe("the recently chosen models", () => {
  it("puts the newest first, moves a repeat rather than duplicating it, and keeps five", () => {
    stub();
    const picks = ["a", "b", "c", "d", "e", "f"].map((model) => ({ provider: "p", model }));
    let recent = readRecent();
    expect(recent).toEqual([]);
    for (const pick of picks) recent = rememberRecent(pick, recent);
    expect(recent.map((r) => r.model)).toEqual(["f", "e", "d", "c", "b"]);
    recent = rememberRecent({ provider: "p", model: "c" }, recent);
    expect(recent.map((r) => r.model)).toEqual(["c", "f", "e", "d", "b"]);
    expect(recent).toHaveLength(RECENT_MAX);
    expect(readRecent()).toEqual(recent);
  });

  it("ignores a half-written or wrong-shaped stored list", () => {
    stub({ [RECENT_KEY]: "{not json" });
    expect(readRecent()).toEqual([]);
    const store = stub({ [RECENT_KEY]: JSON.stringify([{ provider: "p" }, { provider: "p", model: "m" }, "x"]) });
    expect(readRecent()).toEqual([{ provider: "p", model: "m" }]);
    expect(store[RECENT_KEY]).toBeDefined();
  });

  it("survives storage that throws on the accessor", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("site data blocked");
      },
    });
    expect(readRecent()).toEqual([]);
    expect(() => rememberRecent({ provider: "p", model: "m" })).not.toThrow();
  });
});

describe("nearestModel", () => {
  const models = providers[1]!.models;

  it("suggests the model a typo is reaching for", () => {
    expect(nearestModel("glm-5.2-flash", models)?.id).toBe("opencode-go/glm-5.3-flash");
    expect(nearestModel("kimi-k4", models)?.id).toBe("opencode-go/kimi-k3");
  });

  it("says nothing when the typed id is a different model entirely", () => {
    expect(nearestModel("totally-unrelated", models)).toBeUndefined();
    expect(nearestModel("", models)).toBeUndefined();
    expect(nearestModel("glm", [])).toBeUndefined();
  });
});

describe("model names and the two routes' shapes", () => {
  it("reads a raw id as a name, with a provider prefix off", () => {
    expect(prettyModel("opencode-go/glm-5.3-flash")).toBe("GLM 5.3 Flash");
    expect(prettyModel("gemini-3.8-flash")).toBe("Gemini 3.8 Flash");
    expect(prettyModel("claude-sonnet-5-5")).toBe("Claude Sonnet 5 5");
  });

  it("normalises /__board/llm, keeping each provider's readiness and error", () => {
    const list = pickerProvidersFromLlm({
      providers: [
        {
          id: "gemini",
          label: "Gemini",
          defaultModel: "gemini-3.8-flash",
          models: ["gemini-3.8-flash"],
          ready: false,
          error: "GEMINI_API_KEY is not set",
        },
      ],
    });
    expect(list).toEqual([
      {
        id: "gemini",
        label: "Gemini",
        ready: false,
        why: "GEMINI_API_KEY is not set",
        defaultModel: "gemini-3.8-flash",
        models: [{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }],
      },
    ]);
  });

  it("normalises /__board/chat/models, preferring a readable label to a raw id", () => {
    const list = pickerProvidersFromChat([
      {
        provider: "claude",
        label: "Claude Code",
        available: true,
        default: "claude-sonnet-5-5",
        models: [
          { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
          { id: "opencode-go/glm-5.3-flash", label: "opencode-go/glm-5.3-flash" },
        ],
      },
    ]);
    expect(list[0]!.models).toEqual([
      { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
      { id: "opencode-go/glm-5.3-flash", label: "GLM 5.3 Flash" },
    ]);
  });
});
