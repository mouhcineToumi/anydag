/**
 * The Settings modal's tabs: which there are, in which order, under which heading, and
 * which one was open last. No React and no icons, so the order the arrow keys walk and the tab a
 * stored value falls back to are unit tests rather than a browser.
 *
 * **Two groups, Notion's**, and the line between them is where a thing is kept. What belongs to the
 * person — their calendar, the keys, what this is — is under *App* and is the
 * same in every vault. What belongs to the vault this tab is in — the look, its files, which model draws its prompt cards, how it exports — is under the vault's own name, and
 * switches when the vault does. The one setting that crosses the line (a quiz threshold, kept
 * with the practice records in the app's home) says so where it is drawn.
 *
 * Every setting the app has is in exactly one of these, each
 * where it belongs.
 */

import { SETTINGS_TAB, readPref, writeLocal } from "./prefs";

export type SettingsTab = "calendar" | "shortcuts" | "about" | "preferences" | "vault" | "agents" | "export" | "sync";

export type SettingsGroup = "account" | "vault";

/** The tabs in the order they are drawn, which is also the order the arrow keys walk. */
export const GROUPS: readonly { group: SettingsGroup; tabs: readonly SettingsTab[] }[] = [
  { group: "account", tabs: ["calendar", "shortcuts", "about"] },
  { group: "vault", tabs: ["preferences", "vault", "sync", "agents", "export"] },
];

export const TABS: readonly SettingsTab[] = GROUPS.flatMap((g) => g.tabs);

export const TAB_LABEL: Readonly<Record<SettingsTab, string>> = {
  calendar: "Calendar",
  shortcuts: "Shortcuts",
  about: "About",
  preferences: "Preferences",
  vault: "Vault",
  sync: "Sync",
  agents: "AI and agents",
  export: "Import and export",
};

export function groupOf(tab: SettingsTab): SettingsGroup {
  return GROUPS.find((g) => g.tabs.includes(tab))!.group;
}

export function isTab(value: unknown): value is SettingsTab {
  return typeof value === "string" && (TABS as readonly string[]).includes(value);
}

/**
 * The tab to open on when nobody asked for one: the last one this browser had open, or the first.
 * A stored value that is not a tab — one a later version renamed, or anything typed into the
 * console — is the first tab rather than an empty pane.
 */
export function lastTab(): SettingsTab {
  const stored = readPref(SETTINGS_TAB);
  return isTab(stored) ? stored : TABS[0]!;
}

/** Remember the tab for the next opening. This browser's alone: see `SETTINGS_TAB`. */
export function rememberTab(tab: SettingsTab): void {
  writeLocal(SETTINGS_TAB, tab);
}

/**
 * Where a key moves the selection in the tab list — the WAI vertical tablist: up and down step and
 * wrap, Home and End go to either end, and anything else is not the list's.
 */
export function stepTab(from: SettingsTab, key: string): SettingsTab | null {
  const i = TABS.indexOf(from);
  switch (key) {
    case "ArrowDown":
      return TABS[(i + 1) % TABS.length]!;
    case "ArrowUp":
      return TABS[(i - 1 + TABS.length) % TABS.length]!;
    case "Home":
      return TABS[0]!;
    case "End":
      return TABS[TABS.length - 1]!;
    default:
      return null;
  }
}
