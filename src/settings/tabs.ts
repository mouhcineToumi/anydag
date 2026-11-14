/**
 * The Settings modal's tabs: which there are, in which order, under which heading, and
 * which one was open last. No React and no icons, so the order the arrow keys walk and the tab a
 * stored value falls back to are unit tests rather than a browser.
 *
 * **Four groups, and the line between them is where a setting is kept.** *You* is the person's, the
 * same in every vault: the theme, which model each AI feature uses (#191), the calendar's zone and
 * week start, and the quiz practice threshold, which is kept with the practice records in the app's
 * home. *This computer* is this machine's alone: the API keys the desktop app keeps in the system
 * keyring. *This vault* is stored with the vault and switches when it does: its name and facts, the
 * vault's half of the settings object (problems, pasted images, export) and its sync link. *This board* is the open board's own file:
 * its flow, which is drawn only while that board is open and writable.
 *
 * The three reference pages — Privacy, Keyboard shortcuts and About — are tabs too, but drawn as
 * quieter links at the foot rather than under a scope, because they are pages to read rather than
 * settings to change. They keep a scope badge so every pane says what it belongs to.
 *
 * Every setting the app has is in exactly one of these, each where it is stored today. Moving one to
 * another scope is a storage change and its own issue.
 */

import { SETTINGS_TAB, readPref, writeLocal } from "./prefs";

export type SettingsTab =
  | "appearance"
  | "ai"
  | "calendar"
  | "quizzes"
  | "providers"
  | "vault-general"
  | "vault-files"
  | "export"
  | "sync"
  | "agent-access"
  | "board-layout"
  | "privacy"
  | "shortcuts"
  | "about";

/** What a setting belongs to, and the one thing each pane's badge says. */
export type SettingsGroup = "you" | "computer" | "vault" | "board";

/** A heading over its tabs. `foot` is the quieter list drawn at the bottom, with no heading. */
export type SettingsSection = SettingsGroup | "foot";

export interface TabGroup<G extends string = SettingsGroup> {
  group: G;
  tabs: readonly SettingsTab[];
}

/** The board's own settings, drawn only while a board is open and editable. */
export const BOARD_TABS: readonly SettingsTab[] = ["board-layout"];

/** The tabs in the order they are drawn, which is also the order the arrow keys walk. */
export const GROUPS: readonly TabGroup[] = [
  { group: "you", tabs: ["appearance", "ai", "calendar", "quizzes"] },
  { group: "computer", tabs: ["providers"] },
  { group: "vault", tabs: ["vault-general", "vault-files", "export", "sync", "agent-access"] },
  { group: "board", tabs: BOARD_TABS },
];

/** The reference pages at the foot, outside the groups and drawn as quieter links. */
export const FOOT_TABS: readonly SettingsTab[] = ["privacy", "shortcuts", "about"];

/** Draw order: each group's tabs, then the foot. `withoutCloudTabs` filters this list as drawn. */
export const SECTIONS: readonly TabGroup<SettingsSection>[] = [...GROUPS, { group: "foot", tabs: FOOT_TABS }];

export const TABS: readonly SettingsTab[] = SECTIONS.flatMap((g) => g.tabs);

/** What each pane's badge says, and the word a group's heading uses. */
export const SCOPE_LABEL: Readonly<Record<SettingsGroup, string>> = {
  you: "You",
  computer: "This computer",
  vault: "This vault",
  board: "This board",
};

/**
 * What each tab belongs to. The foot's pages carry one too: Privacy is the install's, Keyboard
 * shortcuts are the person's, and About is the build's.
 */
const SCOPE_OF: Readonly<Record<SettingsTab, SettingsGroup>> = {
  appearance: "you",
  ai: "you",
  calendar: "you",
  quizzes: "you",
  providers: "computer",
  "vault-general": "vault",
  "vault-files": "vault",
  export: "vault",
  sync: "vault",
  "agent-access": "vault",
  "board-layout": "board",
  privacy: "computer",
  shortcuts: "you",
  about: "computer",
};

export function scopeOf(tab: SettingsTab): SettingsGroup {
  return SCOPE_OF[tab];
}

/**
 * The tabs that describe the app's server-backed features, and are drawn only when the build's
 * `cloud` switch is on (`server/features.ts`): the logs (Privacy's only content) and sync. Off,
 * a person reads no sign that a server exists — these two are what would have told them.
 */
export const CLOUD_TABS: readonly SettingsTab[] = ["privacy", "sync"];

/** The groups, with the switch's out when it is off. */
export function withoutCloudTabs<G extends string>(sections: readonly TabGroup<G>[], cloud: boolean): readonly TabGroup<G>[] {
  if (cloud) return sections;
  return sections
    .map((g) => ({ group: g.group, tabs: g.tabs.filter((t) => !CLOUD_TABS.includes(t)) }))
    .filter((g) => g.tabs.length > 0);
}

/**
 * The groups as this page draws them: the cloud tabs out when the switch is off, and the board's
 * out when no editable board is open. A `board-layout` tab remembered without a board is therefore
 * not drawn, and `lastTab` falls back the way it does for any unknown id.
 */
export function withoutBoardTab<G extends string>(sections: readonly TabGroup<G>[], board: boolean): readonly TabGroup<G>[] {
  if (board) return sections;
  return sections
    .map((g) => ({ group: g.group, tabs: g.tabs.filter((t) => !BOARD_TABS.includes(t)) }))
    .filter((g) => g.tabs.length > 0);
}

/**
 * The tabs that only set up AI features, drawn while at least one of them is on (#296). The AI tab
 * itself is not one: it holds the switches, so it stays to turn them back on.
 */
const AI_TABS: readonly SettingsTab[] = ["providers"];

/** The groups, with the AI providers tab out when every AI feature is off. */
function withoutAiTabs<G extends string>(sections: readonly TabGroup<G>[], ai: boolean): readonly TabGroup<G>[] {
  if (ai) return sections;
  return sections
    .map((g) => ({ group: g.group, tabs: g.tabs.filter((t) => !AI_TABS.includes(t)) }))
    .filter((g) => g.tabs.length > 0);
}

/** Every filter, in the order a page meets them. `ai` defaults to on, which is the default. */
export function drawnSections<G extends string>(
  sections: readonly TabGroup<G>[],
  { cloud, board, ai = true }: { cloud: boolean; board: boolean; ai?: boolean },
): readonly TabGroup<G>[] {
  return withoutAiTabs(withoutBoardTab(withoutCloudTabs(sections, cloud), board), ai);
}

export const TAB_LABEL: Readonly<Record<SettingsTab, string>> = {
  appearance: "Appearance",
  ai: "AI",
  calendar: "Calendar",
  quizzes: "Quizzes",
  providers: "AI providers",
  "vault-general": "General",
  "vault-files": "Files and images",
  export: "Export",
  sync: "Sync",
  "agent-access": "Agent access",
  "board-layout": "Layout",
  privacy: "Privacy",
  shortcuts: "Keyboard shortcuts",
  about: "About",
};

/**
 * The ids a version before the scopes used, and the tab each one means now. A `dag:settings-tab`
 * left in a browser — or in a home the preference sync carried — opens the nearest new tab rather
 * than an empty pane. Preferences was split, so both of its old halves land on General.
 */
const LEGACY_TABS: Readonly<Record<string, SettingsTab>> = {
  preferences: "vault-general",
  vault: "vault-general",
  agents: "ai",
  /* The AI tab was the vault's until its choices became the person's (#191). */
  "vault-ai": "ai",
};

export function isTab(value: unknown): value is SettingsTab {
  return typeof value === "string" && (TABS as readonly string[]).includes(value);
}

/**
 * The tab to open on when nobody asked for one: the last one this browser had open, or the first.
 * A stored value that is not a tab — one a later version renamed, or anything typed into the
 * console — is the first tab rather than an empty pane, except for the ids the scopes renamed, which
 * open the tab that took their place. `board-layout` without an editable board is not drawn either,
 * so it falls back to the first tab like any other id this page cannot show.
 */
export function lastTab(board = false): SettingsTab {
  const drawn = board ? TABS : TABS.filter((t) => !BOARD_TABS.includes(t));
  const stored = readPref(SETTINGS_TAB);
  if (isTab(stored) && drawn.includes(stored)) return stored;
  /* Own keys only: a stored `toString` is not a tab from an older version, it is the object
     prototype showing through. */
  if (stored && Object.prototype.hasOwnProperty.call(LEGACY_TABS, stored)) return LEGACY_TABS[stored]!;
  return drawn[0]!;
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
