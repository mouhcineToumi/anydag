import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SETTINGS_TAB } from "@/settings/prefs";
import { GROUPS, TABS, TAB_LABEL, groupOf, isTab, lastTab, rememberTab, stepTab } from "@/settings/tabs";

/**
 * The Settings modal's tabs: the list, the order the arrow keys walk, and the tab it opens
 * on. `localStorage` and `location` are stubbed the way `settings.test.ts` stubs them — the suite runs
 * in Node, and both being absent is a case the module has to survive anyway.
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

describe("the tab list", () => {
  it("puts every tab in exactly one group, in the order the groups draw them", () => {
    expect(new Set(TABS).size).toBe(TABS.length);
    expect(TABS).toEqual(GROUPS.flatMap((g) => g.tabs));
    for (const t of TABS) expect(GROUPS.filter((g) => g.tabs.includes(t))).toHaveLength(1);
  });

  it("names every tab", () => {
    expect(Object.keys(TAB_LABEL).sort()).toEqual([...TABS].sort());
  });

  it("keeps the account's tabs apart from the vault's", () => {
    expect(GROUPS.map((g) => g.group)).toEqual(["account", "vault"]);
    expect(groupOf("calendar")).toBe("account");
    expect(groupOf("shortcuts")).toBe("account");
    expect(groupOf("preferences")).toBe("vault");
    expect(groupOf("agents")).toBe("vault");
  });
});

describe("the arrow keys", () => {
  it("step down and up, wrapping at either end", () => {
    expect(stepTab(TABS[0]!, "ArrowDown")).toBe(TABS[1]);
    expect(stepTab(TABS[0]!, "ArrowUp")).toBe(TABS[TABS.length - 1]);
    expect(stepTab(TABS[TABS.length - 1]!, "ArrowDown")).toBe(TABS[0]);
  });

  it("cross from one group into the next as though the heading were not there", () => {
    const lastOfAccount = GROUPS[0]!.tabs[GROUPS[0]!.tabs.length - 1]!;
    expect(stepTab(lastOfAccount, "ArrowDown")).toBe(GROUPS[1]!.tabs[0]);
  });

  it("go to either end on Home and End, and leave every other key alone", () => {
    expect(stepTab("agents", "Home")).toBe(TABS[0]);
    expect(stepTab("agents", "End")).toBe(TABS[TABS.length - 1]);
    expect(stepTab("agents", "ArrowLeft")).toBeNull();
    expect(stepTab("agents", "a")).toBeNull();
  });
});

describe("the tab it opens on", () => {
  it("is the first tab when nothing is remembered", () => {
    expect(lastTab()).toBe(TABS[0]);
  });

  it("is the last one opened, in this browser", () => {
    const store = stub();
    rememberTab("agents");
    expect(store[SETTINGS_TAB]).toBe("agents");
    expect(lastTab()).toBe("agents");
  });

  it("falls back to the first for a stored value that is not a tab", () => {
    stub({ [SETTINGS_TAB]: "language" });
    expect(isTab("language")).toBe(false);
    expect(lastTab()).toBe(TABS[0]);
  });

  it("is not read or written under a snapshot", () => {
    const store = stub({ [SETTINGS_TAB]: "agents" });
    url("?board=demo&snapshot=1");
    expect(lastTab()).toBe(TABS[0]);
    rememberTab("export");
    expect(store[SETTINGS_TAB]).toBe("agents");
  });
});
