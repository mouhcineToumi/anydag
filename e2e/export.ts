import { expect, type Page } from "@playwright/test";

/**
 * Open the Export menu at the end of the top bar, which is where it went from the dock's
 * `⋯` — on a board and on a note alike.
 *
 * Idempotent and retried as a pair for `openMore`'s reason: the top bar re-renders with the board,
 * so a click can land between the press and the menu appearing, and the button is a toggle — a
 * second click on an open menu would shut it.
 */
export async function openExport(page: Page): Promise<void> {
  await expect(async () => {
    if (await page.locator("[data-dag-export-menu]").isVisible()) return;
    await page.locator("[data-dag-export]").click({ timeout: 1_000 });
    await expect(page.locator("[data-dag-export-menu]")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** Save the open board or note as `value` — `svg`, `png` or `md` for a board, `pdf` or `md` for a note. */
export async function exportAs(page: Page, value: string): Promise<void> {
  await openExport(page);
  await page.locator(`[data-dag-export-as="${value}"]`).click();
}
