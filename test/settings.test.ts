import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULTS, normalise, readSettings, resetSettings, STORE, writeSettings } from "@/settings/store";

/**
 * A stand-in for `localStorage`, plus the one that throws.
 *
 * The suite runs in Node, where neither `localStorage` nor `location` exists — which is also the
 * shape of the two failures the store has to survive, so the stubs are the test rather than a
 * scaffold around it.
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

describe("normalise", () => {
  it("fills every field from nothing", () => {
    expect(normalise(null)).toEqual(DEFAULTS);
    expect(normalise({})).toEqual(DEFAULTS);
    expect(normalise("not an object")).toEqual(DEFAULTS);
  });

  it("keeps what is valid and defaults what is not, field by field", () => {
    const s = normalise({ paste: { size: "pixels", width: "wide" }, export: { scale: 3, paper: "yes" } });
    expect(s.paste.size).toBe("pixels");
    expect(s.paste.width).toBe(DEFAULTS.paste.width);
    expect(s.export.scale).toBe(3);
    expect(s.export.paper).toBe(DEFAULTS.export.paper);
  });

  it("drops a key nobody knows", () => {
    expect(normalise({ paste: { size: "screen", colour: "red" }, wat: 1 })).toEqual(DEFAULTS);
  });

  it("clamps a scale out of range rather than refusing the whole object", () => {
    expect(normalise({ export: { scale: 99 } }).export.scale).toBe(4);
    expect(normalise({ export: { scale: 0 } }).export.scale).toBe(1);
    expect(normalise({ export: { scale: Number.NaN } }).export.scale).toBe(DEFAULTS.export.scale);
  });

  it("reads a cap only when it is big enough to be a picture", () => {
    expect(normalise({ paste: { maxWidth: 1600 } }).paste.maxWidth).toBe(1600);
    /* A cap of 8 would turn every screenshot into the smudge this milestone exists to remove. */
    expect(normalise({ paste: { maxWidth: 8 } }).paste.maxWidth).toBeNull();
    expect(normalise({ paste: { maxWidth: 0 } }).paste.maxWidth).toBeNull();
    expect(normalise({ paste: { maxWidth: null } }).paste.maxWidth).toBeNull();
  });

  it("rejects a size word the placement rule cannot honour", () => {
    expect(normalise({ paste: { size: "enormous" } }).paste.size).toBe(DEFAULTS.paste.size);
  });

  it("reads how loud problems are, and notifies by default", () => {
    expect(DEFAULTS.problems.show).toBe("notify");
    expect(normalise({ problems: { show: "off" } }).problems.show).toBe("off");
    expect(normalise({ problems: { show: "badge" } }).problems.show).toBe("badge");
    expect(normalise({ problems: { show: "shout" } }).problems.show).toBe("notify");
    /* A settings object written before the key existed reads as the default, not as broken. */
    expect(normalise({ paste: { size: "pixels" } }).problems.show).toBe("notify");
  });

  it("writes one section without touching the others", () => {
    writeSettings({ export: { scale: 3 } });
    writeSettings({ problems: { show: "badge" } });
    const s = readSettings();
    expect(s.problems.show).toBe("badge");
    expect(s.export.scale).toBe(3);
  });
});

describe("readSettings", () => {
  it("round-trips a write", () => {
    writeSettings({ export: { scale: 1 }, paste: { size: "width", width: 640 } });
    const s = readSettings();
    expect(s.export.scale).toBe(1);
    expect(s.paste).toMatchObject({ size: "width", width: 640 });
    /* A patch names one section and leaves the other exactly as it was. */
    expect(s.export.paper).toBe(DEFAULTS.export.paper);
  });

  it("survives a half-written string", () => {
    stub({ [STORE]: "{not json" });
    expect(readSettings()).toEqual(DEFAULTS);
  });

  it("survives storage that throws on the accessor", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("site data blocked");
      },
    });
    expect(readSettings()).toEqual(DEFAULTS);
    /* And a write against it is a no-op rather than a crash mid-gesture. */
    expect(() => writeSettings({ export: { scale: 4 } })).not.toThrow();
  });

  it("reset removes the key rather than storing the defaults", () => {
    const store = stub();
    writeSettings({ export: { scale: 4 } });
    expect(store[STORE]).toBeDefined();
    expect(resetSettings()).toEqual(DEFAULTS);
    expect(store[STORE]).toBeUndefined();
  });

  it("reset of some sections leaves the others as they were", () => {
    writeSettings({ export: { scale: 4 }, paste: { size: "pixels" }, llm: { provider: "opencode" } });
    const after = resetSettings(["export"]);
    expect(after.export).toEqual(DEFAULTS.export);
    expect(after.paste.size).toBe("pixels");
    expect(readSettings().llm.provider).toBe("opencode");
    resetSettings(["paste", "problems"]);
    expect(readSettings().paste).toEqual(DEFAULTS.paste);
    expect(readSettings().llm.provider).toBe("opencode");
  });
});

describe("a snapshot reads no preference", () => {
  it("returns the defaults with the key populated", () => {
    stub({ [STORE]: JSON.stringify({ export: { scale: 4, paper: false }, paste: { size: "width", width: 900 } }) });
    url("?board=demo&snapshot=1");
    expect(readSettings()).toEqual(DEFAULTS);
  });

  it("and writes nothing, so a photographed page cannot leave a preference behind", () => {
    const store = stub();
    url("?board=demo&snapshot=1");
    writeSettings({ export: { scale: 4 } });
    expect(store[STORE]).toBeUndefined();
  });

  it("but reads it again the moment the query no longer says so", () => {
    stub({ [STORE]: JSON.stringify({ export: { scale: 4 } }) });
    url("?board=demo&snapshot=1");
    expect(readSettings().export.scale).toBe(DEFAULTS.export.scale);
    /* `App` rewrites the query with `replaceState`, so this is read per call and never cached. */
    url("?board=demo");
    expect(readSettings().export.scale).toBe(4);
  });

  it("and none of that needs a `location` to exist at all", () => {
    Reflect.deleteProperty(globalThis, "location");
    expect(readSettings()).toEqual(DEFAULTS);
  });
});

describe("the model a prompt card asks", () => {
  it("defaults to the server's provider, model and thinking level", () => {
    expect(DEFAULTS.llm).toEqual({ provider: null, model: null, reasoning: null });
  });

  it("keeps a thinking level it offers and drops one it does not", () => {
    expect(normalise({ llm: { reasoning: "high" } }).llm.reasoning).toBe("high");
    /* Gemini refuses `minimal` and the card never offers it: a hand-edited file saying so is
       dropped rather than sent for the provider to reject. */
    expect(normalise({ llm: { reasoning: "minimal" } }).llm.reasoning).toBeNull();
    expect(normalise({ llm: { reasoning: 7 } }).llm.reasoning).toBeNull();
  });

  it("writes one field of it without touching the others", () => {
    writeSettings({ llm: { provider: "opencode" } });
    writeSettings({ llm: { reasoning: "low" } });
    expect(readSettings().llm).toEqual({ provider: "opencode", model: null, reasoning: "low" });
  });
});
