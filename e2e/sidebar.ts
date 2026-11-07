import { expect, type Page } from "@playwright/test";

/**
 * Dock the sidebar, so its rows are reachable.
 *
 * **The suite starts every check with it put away** — `global-setup.ts` seeds `dag:sidebar=0` —
 * because a column open by default would move the canvas under every spec that measures
 * `.dag-viewport` or aims at a coordinate on it, for a reason none of them is about. So a check that
 * wants a row in it docks it first, which is what this does.
 *
 * Idempotent, and retried as a pair for the reason `openMore` is: a click can land between the press
 * and the column appearing, and the toggle is a toggle — a second click on a docked sidebar would
 * put it away again.
 */
export async function openSidebar(page: Page): Promise<void> {
  await expect(async () => {
    if (await page.locator('[data-dag-sidebar][data-mode="docked"]').isVisible()) return;
    await page.locator("[data-dag-sidebar-toggle]").click({ timeout: 1_000 });
    await expect(page.locator('[data-dag-sidebar][data-mode="docked"]')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** The Settings modal's tabs, by the id `src/settings/tabs.ts` gives each. */
export type SettingsTab = "calendar" | "shortcuts" | "privacy" | "about" | "preferences" | "vault" | "agents" | "export" | "sync";

/**
 * Settings sits at the sidebar's foot, not behind the dock's `⋯`. A modal of tabs, so a check that
 * wants a control names the tab it is on: the modal opens on the tab
 * this browser had open last, which is a fact about the check before this one.
 */
export async function openSettings(page: Page, tab?: SettingsTab): Promise<void> {
  await openSidebar(page);
  await page.locator("[data-dag-settings-toggle]").click();
  await expect(page.locator("[data-dag-settings]")).toBeVisible();
  if (tab) await settingsTab(page, tab);
}

/** Move to one tab of an open Settings modal, and wait for its pane. */
export async function settingsTab(page: Page, tab: SettingsTab): Promise<void> {
  await page.locator(`[data-dag-settings-tab-button="${tab}"]`).click();
  await expect(page.locator(`[data-dag-settings-pane="${tab}"]`)).toBeVisible();
}

/**
 * Make a file from the sidebar's one New row, which opens a menu of the six kinds — each
 * with the hook its own row had (`data-dag-sidebar-new-board` and the rest). `top` presses the menu's
 * *Top level* first, for a check that must not depend on which folder the open file is in.
 */
export async function newFile(page: Page, kind: "board" | "note" | "task" | "event" | "quiz" | "table", { top = false } = {}): Promise<void> {
  await openSidebar(page);
  await expect(async () => {
    if (!(await page.locator("[data-dag-sidebar-new-menu]").isVisible())) {
      await page.locator("[data-dag-sidebar-new]").click({ timeout: 1_000 });
      await expect(page.locator("[data-dag-sidebar-new-menu]")).toBeVisible({ timeout: 1_000 });
    }
    const where = page.locator("[data-dag-sidebar-new-where]");
    if (top && (await where.getAttribute("data-dag-sidebar-new-where")) !== "") await page.locator("[data-dag-sidebar-new-top]").click({ timeout: 1_000 });
    await page.locator(`[data-dag-sidebar-new-${kind}]`).click({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
