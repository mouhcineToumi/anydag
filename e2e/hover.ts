import { expect, type Page } from "@playwright/test";

/**
 * Reach a control that only exists while its row is hovered.
 *
 * The board list's row actions are `display: none` until the row is hovered, and the list
 * re-renders whenever *any* board file appears or disappears — which, with the suite running eight
 * workers wide over one `boards/` directory, is constantly, because every other spec is writing and
 * removing scratch boards of its own. Two things follow, and a hover-only control needs both:
 *
 * - **A real pointer move, not `locator.hover()`.** Chromium recomputes `:hover` against the *new*
 *   node only on an actual move, so a hover taken before a re-render leaves the button hidden and
 *   Playwright then refuses to click something with no box. That half was already understood, and
 *   `folders.spec.ts` has carried this comment since P1.
 * - **The move and the click retried as one.** The re-render can land *between* them, and then the
 *   move that was correct when it was made is pointing at a node that no longer exists. Retrying
 *   the click alone cannot help — the pointer is already off the row. This is what was missing, and
 *   it is why `reach.spec.ts`'s board-list check failed roughly one run in three under load, on
 *   `main` as much as anywhere else.
 *
 * `toPass` retries the pair. A click that resolves has happened, so nothing here can double-apply:
 * the block either gets through the click or never reaches it.
 *
 * **The row is scrolled into its own container first**, which is not decoration. `boundingBox()`
 * answers for an element that has been scrolled out of an `overflow: auto` list — it returns where
 * the element *would* be, which is a real viewport coordinate outside the list — so `mouse.move`
 * lands on whatever is drawn there instead, the row is never hovered, and the failure is a hover
 * that silently did nothing rather than a locator that found nothing. The board list has always
 * been a scroll container and this only started mattering when it became a card with fifty-five
 * rows in it.
 */
export async function clickOnHover(page: Page, row: string, control: string): Promise<void> {
  await expect(async () => {
    await page.locator(row).scrollIntoViewIfNeeded({ timeout: 1_000 });
    const box = await page.locator(row).boundingBox();
    if (!box) throw new Error(`no row \`${row}\` to hover`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator(control).click({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * Put the pointer over an element for real, for the cases that only *look* at what appears.
 *
 * The same rule as above minus the click, retried so the assertion after it is made against a row
 * the pointer is still on — and scrolled into view first, for the same reason.
 */
async function point(page: Page, selector: string): Promise<void> {
  await expect(async () => {
    await page.locator(selector).scrollIntoViewIfNeeded({ timeout: 1_000 });
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`no element \`${selector}\` to point at`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  }).toPass({ timeout: 10_000 });
}
