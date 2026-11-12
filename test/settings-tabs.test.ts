import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SETTINGS_TAB } from "@/settings/prefs";
import {
  BOARD_TABS,
  CLOUD_TABS,
  FOOT_TABS,
  GROUPS,
  SECTIONS,
  TABS,
  TAB_LABEL,
  drawnSections,
  isTab,
  lastTab,
  rememberTab,
  scopeOf,
  stepTab,
  withoutBoardTab,
  withoutCloudTabs,
} from "@/settings/tabs";

/**
 * The Settings modal's tabs: the list, the groups they are drawn in, the order the arrow keys walk,
 * and the tab it opens on. `localStorage` and `location` are stubbed the way `settings.test.ts`
 * stubs them — the suite runs in Node, and both being absent is a case the module has to survive
 * anyway.
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
  it("puts every tab in exactly one section, in the order the sections draw them", () => {
    expect(new Set(TABS).size).toBe(TABS.length);
    expect(TABS).toEqual(SECTIONS.flatMap((s) => s.tabs));
    for (const t of TABS) expect(SECTIONS.filter((s) => s.tabs.includes(t))).toHaveLength(1);
  });

  it("names every tab", () => {
    expect(Object.keys(TAB_LABEL).sort()).toEqual([...TABS].sort());
  });

  it("groups the settings by where they are kept", () => {
    expect(GROUPS.map((g) => g.group)).toEqual(["you", "computer", "vault", "board"]);
    /* The person's, in every vault: the theme and the AI choices since #191. */
    for (const tab of ["appearance", "ai", "calendar", "quizzes"] as const) expect(scopeOf(tab), tab).toBe("you");
    /* This machine's. */
    expect(scopeOf("providers")).toBe("computer");
    /* Stored with the vault. */
    for (const tab of ["vault-general", "vault-files", "export", "sync", "agent-access"] as const)
      expect(scopeOf(tab), tab).toBe("vault");
    /* Stored in the board's own file, and drawn only while one is open. */
    expect(scopeOf("board-layout")).toBe("board");
  });

  it("draws This board after This vault and before the foot, only with a board", () => {
    expect(BOARD_TABS).toEqual(["board-layout"]);
    const withBoard = withoutBoardTab(SECTIONS, true);
    expect(withBoard.map((s) => s.group)).toEqual(["you", "computer", "vault", "board", "foot"]);
    const without = withoutBoardTab(SECTIONS, false);
    expect(without.map((s) => s.group)).toEqual(["you", "computer", "vault", "foot"]);
    expect(without.flatMap((s) => s.tabs)).not.toContain("board-layout");
    /* The two switches compose in draw order. */
    expect(drawnSections(SECTIONS, { cloud: false, board: true }).map((s) => s.group)).toEqual([
      "you",
      "computer",
      "vault",
      "board",
      "foot",
    ]);
    expect(
      drawnSections(SECTIONS, { cloud: true, board: false })
        .flatMap((s) => s.tabs)
        .includes("board-layout"),
    ).toBe(false);
  });

  it("draws the reference pages at the foot, outside the groups and after every group", () => {
    expect(FOOT_TABS).toEqual(["privacy", "shortcuts", "about"]);
    expect(TABS.slice(-FOOT_TABS.length)).toEqual(FOOT_TABS);
    for (const tab of FOOT_TABS)
      expect(
        GROUPS.some((g) => g.tabs.includes(tab)),
        tab,
      ).toBe(false);
    /* They still say what they belong to. */
    expect(scopeOf("privacy")).toBe("computer");
    expect(scopeOf("shortcuts")).toBe("you");
    expect(scopeOf("about")).toBe("computer");
  });

  it("hides every sync and privacy tab when the cloud switch is off", () => {
    expect(CLOUD_TABS).toEqual(["privacy", "sync"]);
    const off = withoutCloudTabs(SECTIONS, false);
    const drawn = off.flatMap((s) => s.tabs);
    for (const tab of CLOUD_TABS) expect(drawn, tab).not.toContain(tab);
    /* The foot is still there, without Privacy. */
    expect(off.find((s) => s.group === "foot")?.tabs).toEqual(["shortcuts", "about"]);
    expect(off.map((s) => s.group)).toEqual(["you", "computer", "vault", "board", "foot"]);
    expect(drawn).toContain("ai");
    expect(withoutCloudTabs(SECTIONS, true)).toEqual(SECTIONS);
  });
});

describe("the arrow keys", () => {
  it("step down and up, wrapping at either end", () => {
    expect(stepTab(TABS[0]!, "ArrowDown")).toBe(TABS[1]);
    expect(stepTab(TABS[0]!, "ArrowUp")).toBe(TABS[TABS.length - 1]);
    expect(stepTab(TABS[TABS.length - 1]!, "ArrowDown")).toBe(TABS[0]);
  });

  it("cross from one group into the next as though the heading were not there", () => {
    const lastOfYou = GROUPS[0]!.tabs[GROUPS[0]!.tabs.length - 1]!;
    expect(stepTab(lastOfYou, "ArrowDown")).toBe(GROUPS[1]!.tabs[0]);
    /* Into This board, and out of it into the foot links. */
    const lastOfVault = GROUPS[2]!.tabs[GROUPS[2]!.tabs.length - 1]!;
    expect(stepTab(lastOfVault, "ArrowDown")).toBe("board-layout");
    expect(stepTab("board-layout", "ArrowDown")).toBe(FOOT_TABS[0]);
  });

  it("go to either end on Home and End, and leave every other key alone", () => {
    expect(stepTab("ai", "Home")).toBe(TABS[0]);
    expect(stepTab("ai", "End")).toBe(TABS[TABS.length - 1]);
    expect(stepTab("ai", "ArrowLeft")).toBeNull();
    expect(stepTab("ai", "a")).toBeNull();
  });
});

describe("the tab it opens on", () => {
  it("is the first tab when nothing is remembered", () => {
    expect(lastTab()).toBe(TABS[0]);
  });

  it("is the last one opened, in this browser", () => {
    const store = stub();
    rememberTab("ai");
    expect(store[SETTINGS_TAB]).toBe("ai");
    expect(lastTab()).toBe("ai");
  });

  it("opens the tab that took an old id's place", () => {
    stub({ [SETTINGS_TAB]: "preferences" });
    expect(lastTab()).toBe("vault-general");
    stub({ [SETTINGS_TAB]: "vault" });
    expect(lastTab()).toBe("vault-general");
    stub({ [SETTINGS_TAB]: "agents" });
    expect(lastTab()).toBe("ai");
    /* The AI tab was the vault's until its choices became the person's (#191). */
    stub({ [SETTINGS_TAB]: "vault-ai" });
    expect(lastTab()).toBe("ai");
    /* The ids that did not move stay theirs. */
    expect(isTab("export")).toBe(true);
    expect(isTab("sync")).toBe(true);
  });

  it("falls back to the first for a stored value that is not a tab", () => {
    stub({ [SETTINGS_TAB]: "language" });
    expect(isTab("language")).toBe(false);
    expect(lastTab()).toBe(TABS[0]);
    /* A name on the object's prototype is not a tab from an older version. */
    stub({ [SETTINGS_TAB]: "toString" });
    expect(lastTab()).toBe(TABS[0]);
  });

  it("falls back from a remembered board tab when no board is open", () => {
    stub({ [SETTINGS_TAB]: "board-layout" });
    /* The id is real, but this page cannot draw it without a board. */
    expect(isTab("board-layout")).toBe(true);
    expect(lastTab()).toBe(TABS[0]);
    /* With one, the remembered tab is drawn and comes back. */
    expect(lastTab(true)).toBe("board-layout");
    stub({ [SETTINGS_TAB]: "ai" });
    expect(lastTab(true)).toBe("ai");
  });

  it("is not read or written under a snapshot", () => {
    const store = stub({ [SETTINGS_TAB]: "agents" });
    url("?board=demo&snapshot=1");
    expect(lastTab()).toBe(TABS[0]);
    rememberTab("export");
    expect(store[SETTINGS_TAB]).toBe("agents");
  });
});
