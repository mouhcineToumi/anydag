import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ASSISTANT_MAX, ASSISTANT_MIN, ASSISTANT_W, clampWidth, rememberWidth, storedWidth, widthCap } from "@/assistant/width";
import { ASSISTANT_WIDTH, PREF_KEYS } from "@/settings/prefs";

/**
 * The Assistant panel's width: the range a drag and the arrow keys settle into, and the preference
 * a reload reads back. `localStorage` and `location` are stubbed the way `settings-tabs.test.ts`
 * stubs them — the suite runs in Node, where neither exists, and both being absent is a case the
 * module has to survive anyway.
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

describe("the Assistant panel's width", () => {
  it("has a default between the bounds, and is one of the person's preferences", () => {
    expect(ASSISTANT_W).toBeGreaterThan(ASSISTANT_MIN);
    expect(ASSISTANT_W).toBeLessThan(ASSISTANT_MAX);
    expect(PREF_KEYS as readonly string[]).toContain(ASSISTANT_WIDTH);
    expect(storedWidth(1600)).toBe(ASSISTANT_W);
  });

  it("clamps a drag to the bounds, in whole pixels", () => {
    expect(clampWidth(100, 1600)).toBe(ASSISTANT_MIN);
    expect(clampWidth(5000, 1600)).toBe(ASSISTANT_MAX);
    expect(clampWidth(500.4, 1600)).toBe(500);
    expect(clampWidth(500.6, 1600)).toBe(501);
    /* A lost pointer must not reach a style as `NaN`, which would collapse the column. */
    expect(clampWidth(Number.NaN, 1600)).toBe(ASSISTANT_W);
    expect(clampWidth(Number.POSITIVE_INFINITY, 1600)).toBe(ASSISTANT_W);
  });

  it("never takes more than half the window, and never shrinks under the floor", () => {
    expect(widthCap(900)).toBe(450);
    expect(widthCap(800)).toBe(400);
    expect(clampWidth(700, 900)).toBe(450);
    expect(widthCap(400)).toBe(ASSISTANT_MIN);
    expect(clampWidth(100, 400)).toBe(ASSISTANT_MIN);
  });

  it("remembers a settled width and reads it back", () => {
    const store = stub();
    expect(rememberWidth(504.4)).toBe(504);
    expect(store[ASSISTANT_WIDTH]).toBe("504");
    expect(storedWidth(1600)).toBe(504);
    /* A caller clamps against the window it was open in, but the fixed bounds hold either way. */
    expect(rememberWidth(5000)).toBe(ASSISTANT_MAX);
    expect(store[ASSISTANT_WIDTH]).toBe(String(ASSISTANT_MAX));
  });

  it("reads a stored value inside the bounds, and a junk one as the default", () => {
    const store = stub({ [ASSISTANT_WIDTH]: "5000" });
    expect(storedWidth(1600)).toBe(ASSISTANT_MAX);
    store[ASSISTANT_WIDTH] = "50";
    expect(storedWidth(1600)).toBe(ASSISTANT_MIN);
    store[ASSISTANT_WIDTH] = "nonsense";
    expect(storedWidth(1600)).toBe(ASSISTANT_W);
    store[ASSISTANT_WIDTH] = "-100";
    expect(storedWidth(1600)).toBe(ASSISTANT_W);
  });

  it("settles a stored width for the window it opens in, without rewriting it", () => {
    const store = stub({ [ASSISTANT_WIDTH]: "720" });
    expect(storedWidth(900)).toBe(450);
    expect(store[ASSISTANT_WIDTH], "a narrower window is not a chosen width").toBe("720");
  });

  it("reads and writes none of it under a snapshot", () => {
    const store = stub({ [ASSISTANT_WIDTH]: "500" });
    url("?snapshot=1");
    expect(storedWidth(1600)).toBe(ASSISTANT_W);
    rememberWidth(600);
    expect(store[ASSISTANT_WIDTH]).toBe("500");
  });
});
