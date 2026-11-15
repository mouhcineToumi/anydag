import fs from "node:fs";
import path from "node:path";

import { BOARDS, openBoards } from "./boards";
import { expect, test, type Page } from "./fixture";

/**
 * The search card draws the lines in view and a margin, not every name in the vault (#267): with
 * nothing typed it lists them all, and 50,000 of them were 400,000 elements and 3.8 s before the
 * first row showed. What that must not cost is what the card does with a row that is **not in the
 * DOM**: the open file's row is shown when the card opens, the arrow keys walk past the lines that
 * were drawn, and the focused row survives being scrolled away from.
 *
 * The folder is generated for the run, under a name made for this worker, and **removed by that
 * exact path** — a cleanup that matches by prefix must refuse an empty one.
 */

const COUNT = 3_000;
const row = (n: number) => `row-${String(n).padStart(4, "0")}`;

let parent = "";
let dir = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(({}, info) => {
  parent = `e2e-search-virtual-${info.workerIndex}-${Date.now().toString(36)}`;
  if (!parent.startsWith("e2e-search-virtual-") || parent === "e2e-search-virtual-") throw new Error("no folder name to make");
  dir = path.join(BOARDS, parent);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < COUNT; i++) fs.writeFileSync(path.join(dir, `${row(i)}.md`), `Row ${i}.\n`);
});

test.afterAll(() => {
  if (dir && dir !== BOARDS && dir.endsWith(parent) && parent.startsWith("e2e-search-virtual-"))
    fs.rmSync(dir, { recursive: true, force: true });
});

const file = (n: number) => `${parent}/${row(n)}`;
const card = (page: Page) => page.locator("[data-dag-boards]");
const noteRow = (page: Page, n: number) => card(page).locator(`[data-dag-note="${file(n)}"]`);
/** The note the focus is on, by name. */
const focused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.dagNote ?? null);

async function openOn(page: Page, n: number): Promise<void> {
  await page.goto(`/?note=${encodeURIComponent(file(n))}`);
  await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 30_000 });
  await openBoards(page);
  await expect(noteRow(page, n)).toHaveCount(1, { timeout: 30_000 });
}

test("only the lines in view are drawn, and the card opens on the open file's row", async ({ page }) => {
  await openOn(page, 1_500);
  /* A window of the list and a margin, however many names the vault holds. */
  expect(await card(page).locator(".dag-browser__line").count()).toBeLessThan(150);
  /* Row 1,500 is a long way down: it is drawn, marked and in view. */
  await expect(noteRow(page, 1_500)).toHaveAttribute("aria-current", "true");
  await expect(noteRow(page, 1_500)).toBeInViewport({ ratio: 1 });
  /* The count is the vault's, not the window's. */
  await expect(card(page).locator("[data-dag-boards-count]")).toContainText("notes");

  /* Scrolled to the end, the last row of the folder is there, and the first is not. */
  await card(page)
    .locator(".dag-panel__list")
    .evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
  await expect(noteRow(page, 1_500)).toHaveCount(0);
});

test("the arrows walk past the lines that were drawn, and the focused row survives a scroll", async ({ page }) => {
  await openOn(page, 1_500);
  await noteRow(page, 1_500).focus();
  /* Forty rows on is past the window drawn when the card opened. */
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowDown");
  await expect.poll(() => focused(page)).toBe(file(1_540));
  await expect(noteRow(page, 1_540)).toBeInViewport({ ratio: 1 });

  /* Scrolled to the top, far from it: the focused row stays in the DOM, and the next arrow brings
     the list back to the row after it. */
  await card(page)
    .locator(".dag-panel__list")
    .evaluate((el) => {
      el.scrollTop = 0;
    });
  await expect(noteRow(page, 1_540)).toHaveCount(1);
  expect(await focused(page)).toBe(file(1_540));
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => focused(page)).toBe(file(1_541));
  await expect(noteRow(page, 1_541)).toBeInViewport({ ratio: 1 });

  /* And Enter opens it. */
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${row(1_541)}(&|$)`));
});
