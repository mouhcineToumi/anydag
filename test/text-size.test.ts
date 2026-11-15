import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ACCOUNT_PREF_KEYS, PREF_KEYS, TEXT_SIZE, VAULT_PREF_KEYS } from "@/settings/prefs";
import { TEXT_SIZE_STEPS, applyTextSize, readTextSize, writeTextSize } from "@/ui/textSize";

/**
 * The text size: the three steps a person can pick, the key they are kept under, and the attribute
 * `<html>` carries — `localStorage` and `location` stubbed the way `assistant-width.test.ts` stubs
 * them, because the suite runs in Node and a browser that has neither must survive this too.
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

function root(): { dataset: Record<string, string> } {
  return { dataset: {} };
}

beforeEach(() => {
  stub();
  url("?board=demo");
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
  Reflect.deleteProperty(globalThis, "location");
});

describe("the text size", () => {
  it("offers three steps, in the order a person reads them", () => {
    expect(TEXT_SIZE_STEPS.map((step) => step.value)).toEqual(["small", "default", "large"]);
    expect(TEXT_SIZE_STEPS.map((step) => step.label)).toEqual(["Small", "Default", "Large"]);
  });

  it("is the person's, in every vault — so it follows them and no vault owns one", () => {
    expect(PREF_KEYS as readonly string[]).toContain(TEXT_SIZE);
    expect(ACCOUNT_PREF_KEYS as readonly string[]).toContain("dag:text-size");
    expect(VAULT_PREF_KEYS as readonly string[]).not.toContain("dag:text-size");
  });

  it("reads an absent or junk value as the default", () => {
    expect(readTextSize()).toBe("default");
    stub({ [TEXT_SIZE]: "enormous" });
    expect(readTextSize()).toBe("default");
    stub({ [TEXT_SIZE]: "small" });
    expect(readTextSize()).toBe("small");
  });

  it("keeps a step as a key, and writes the default as no key at all", () => {
    const store = stub();
    writeTextSize("large");
    expect(store[TEXT_SIZE]).toBe("large");
    writeTextSize("small");
    expect(store[TEXT_SIZE]).toBe("small");
    writeTextSize("default");
    expect(store).not.toHaveProperty(TEXT_SIZE);
  });

  it("puts the step on the root, for the stylesheet to read", () => {
    const el = root();
    writeTextSize("large");
    applyTextSize(el as unknown as HTMLElement);
    expect(el.dataset.dagTextSize).toBe("large");
    writeTextSize("small");
    applyTextSize(el as unknown as HTMLElement);
    expect(el.dataset.dagTextSize).toBe("small");
    writeTextSize("default");
    applyTextSize(el as unknown as HTMLElement);
    expect(el.dataset.dagTextSize).toBe("default");
  });

  it("reads and writes none of it under a snapshot", () => {
    const store = stub({ [TEXT_SIZE]: "large" });
    const el = root();
    url("?snapshot=1");
    expect(readTextSize()).toBe("default");
    applyTextSize(el as unknown as HTMLElement);
    expect(el.dataset.dagTextSize).toBe("default");
    writeTextSize("small");
    expect(store[TEXT_SIZE], "a snapshot writes nothing back").toBe("large");
  });
});
