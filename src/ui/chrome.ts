import type { SettingsTab } from "@/settings/tabs";

/**
 * What the chrome asks a page for: a card only the page can draw — the search, Settings or Send
 * feedback. The sidebar and the vault switcher are above both pages and know neither, so they
 * ask with a document event, the way `dag:tidy` reaches the page from a script.
 *
 * `dag:chrome` and not `dag:settings`, which is the settings-changed event: one name meaning two
 * things is the hazard `docs/architecture/things-that-will-bite.md` records. A request for Settings may name the tab to open on
 * — the switcher's *Vault settings…* opens on the vault's own — and one that names
 * none opens where the last one left off.
 */
export type ChromeRequest = "search" | "settings";

export interface ChromeAsk {
  what: ChromeRequest;
  tab?: SettingsTab;
}

/** Ask the page for one of its cards. The page listens; the chrome never renders one itself. */
export function askPage(what: ChromeRequest, tab?: SettingsTab): void {
  document.dispatchEvent(new CustomEvent<ChromeAsk>("dag:chrome", { detail: { what, tab } }));
}
