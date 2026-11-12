/**
 * The Settings modal's tabs: which there are, in which order, under which heading, and
 * which one was open last. No React and no icons, so the order the arrow keys walk and the tab a
 * stored value falls back to are unit tests rather than a browser.
 *
 * **Two groups, Notion's**, and the line between them is where a thing is kept. What belongs to the
 * person — their calendar, the keys, whether logs are sent, what this is — is under *App* and is the
 * same in every vault. What belongs to the vault this tab is in — the look, its files, which model
 * draws its diagrams and flashcards, how it exports — is under the vault's own name, and switches
 * when the vault does. The one setting that crosses the line (a quiz threshold, kept
 * with the practice records in the app's home) says so where it is drawn.
 *
 * Every setting the app has is in exactly one of these, each
 * where it belongs.
 */

import { SETTINGS_TAB, readPref, writeLocal } from "./prefs";

export type SettingsTab = "calendar" | "shortcuts" | "privacy" | "about" | "preferences" | "vault" | "agents" | "export" | "sync";

export type SettingsGroup = "account" | "vault";

/** The tabs in the order they are drawn, which is also the order the arrow keys walk. */
export const GROUPS: readonly { group: SettingsGroup; tabs: readonly SettingsTab[] }[] = [
  { group: "account", tabs: ["calendar", "shortcuts", "privacy", "about"] },
  { group: "vault", tabs: ["preferences", "vault", "sync", "agents", "export"] },
];

export const TABS: readonly SettingsTab[] = GROUPS.flatMap((g) => g.tabs);

/**
 * The tabs that describe the app's server-backed features, and are drawn only when the build's
 * `cloud` switch is on (`server/features.ts`): the logs (Privacy's only content) and sync. Off,
 * a person reads no sign that a server exists — these two are what would have told them.
 */
export const CLOUD_TABS: readonly SettingsTab[] = ["privacy", "sync"];

/** The group's tabs, with the switch's out when it is off. */
export function withoutCloudTabs(
  groups: readonly { group: SettingsGroup; tabs: readonly SettingsTab[] }[],
  cloud: boolean,
): readonly { group: SettingsGroup; tabs: readonly SettingsTab[] }[] {
  if (cloud) return groups;
  return groups
    .map((g) => ({ group: g.group, tabs: g.tabs.filter((t) => !CLOUD_TABS.includes(t)) }))
    .filter((g) => g.tabs.length > 0);
}

export const TAB_LABEL: Readonly<Record<SettingsTab, string>> = {
  calendar: "Calendar",
  shortcuts: "Shortcuts",
  privacy: "Privacy",
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
 * wrap, Home and End go to either end, and anything else is not the list's. The list is the one this
 * modal drew: with the `cloud` switch off its gated tabs are out of it, and so out of the walk.
 */
export function stepTab(from: SettingsTab, key: string, tabs: readonly SettingsTab[] = TABS): SettingsTab | null {
  const i = tabs.indexOf(from);
  switch (key) {
    case "ArrowDown":
      return tabs[(i + 1) % tabs.length]!;
    case "ArrowUp":
      return tabs[(i - 1 + tabs.length) % tabs.length]!;
    case "Home":
      return tabs[0]!;
    case "End":
      return tabs[tabs.length - 1]!;
    default:
      return null;
  }
}
