import { expect, type Page } from "@playwright/test";

/**
 * Open the dock's `⋯`, so the rare half is reachable.
 *
 * The rare half sits behind one button: Links, Keep, Import and the shortcut sheet are the
 * controls reached for least, while Select, Hand, Pen, Undo and Redo stay up. The file `<input>`
 * is still a file input, so `setInputFiles` drives it exactly as before. What changed is that
 * they now have to be *visible* first, and the locator's methods check for that.
 *
 * Idempotent on purpose. The `⋯` is a toggle, so a second call on an open menu would shut it —
 * which is the failure that looks like the helper working and the click missing.
 *
 * Wrapped in `toPass` for the reason `hover.ts` is: the dock re-renders whenever the board does —
 * undo and redo take their disabled state from the history — so a click can land between the
 * press and the menu appearing. Retrying the pair is what settles that, and it is safe because
 * the guard above makes a second attempt a no-op once the menu is up.
 */
export async function openMore(page: Page): Promise<void> {
  await expect(async () => {
    if (await page.locator("[data-dag-more-menu]").isVisible()) return;
    await page.locator("[data-dag-more]").click({ timeout: 1_000 });
    await expect(page.locator("[data-dag-more-menu]")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * Press one row of the top bar's `⋯`, by the hook the control had before it moved in there
 * — `data-dag-note-make-task`, `data-dag-tablepage-import`, `data-dag-toolbar-rename`.
 *
 * `openMore`'s shape and its reason: the bar re-renders with the page, and the `⋯` is a toggle.
 */
export async function pageMore(page: Page, hook: string): Promise<void> {
  await expect(async () => {
    if (!(await page.locator("[data-dag-page-more-menu]").isVisible())) {
      await page.locator("[data-dag-page-more]").click({ timeout: 1_000 });
      await expect(page.locator("[data-dag-page-more-menu]")).toBeVisible({ timeout: 1_000 });
    }
    await page.locator(`[data-dag-page-more-menu] [${hook}]`).click({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
