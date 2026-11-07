import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";

/**
 * The product says its own name.
 *
 * The mark landed on its own, and a mark is a shape: nothing in the window said what this
 * application is called, and the sidebar — the first place somebody looks for
 * decided to be here — named itself only through an `aria-label`, which reaches everyone except
 * the people looking at it.
 *
 * The ratios are checked rather than the pixels. The mark's source drawing is a
 * 64-unit box with the name at `font-size: 44` starting at `x=86`, and those two fractions are
 * what make a lockup rather than a logo with a word after it. Written as `calc()` off the mark,
 * one set of figures serves the toolbar's 20px and the card's 32px; asserting the computed pixels
 * is what catches a later hand-tuned override that quietly unpicks that.
 */

const BOARD = `---\ntitle: Brand\n---\n\n\`\`\`md {#one}\nA board to hang a toolbar over.\n\`\`\`\n`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-brand-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

test("the name is beside the mark in the top left", async ({ page }) => {
  await open(page);
  const lockup = page.locator(".dag-toolbar .dag-lockup");
  await expect(lockup).toBeVisible();
  await expect(lockup.locator(".dag-lockup__name")).toHaveText("AnyDag");

  /* The name is read and the mark is not, so a screen reader says it once. */
  await expect(lockup.locator(".dag-logo")).toHaveAttribute("aria-hidden", "true");

  /* Beside, not under: one row, with the mark first. */
  const mark = (await lockup.locator(".dag-logo").boundingBox())!;
  const word = (await lockup.locator(".dag-lockup__name").boundingBox())!;
  expect(word.x).toBeGreaterThan(mark.x + mark.width - 1);
  expect(Math.abs(word.y + word.height / 2 - (mark.y + mark.height / 2))).toBeLessThan(mark.height / 2);
});

test("the lockup keeps the asset's two ratios at either size", async ({ page }) => {
  await open(page);
  const read = (sel: string) =>
    page.evaluate((s) => {
      const el = document.querySelector(s) as HTMLElement;
      const word = el.querySelector(".dag-lockup__name") as HTMLElement;
      const mark = el.querySelector(".dag-logo") as SVGElement;
      return {
        mark: mark.getBoundingClientRect().width,
        font: parseFloat(getComputedStyle(word).fontSize),
        gap: parseFloat(getComputedStyle(el).columnGap),
        weight: getComputedStyle(word).fontWeight,
      };
    }, sel);

  const bar = await read(".dag-toolbar .dag-lockup");
  expect(bar.mark).toBe(20);
  expect(bar.font).toBeCloseTo((20 * 44) / 64, 2);
  expect(bar.gap).toBeCloseTo((20 * 22) / 64, 2);
  expect(bar.weight).toBe("600");
});

test("the favicon is a real file the page asks for by name", async ({ page }) => {
  /* It was `href="data:,"` until the brand existed, and a full Chromium asks for `/favicon.ico`
     whatever the document says — `npm run e2e` fails on any console output, so an icon that 404s
     would fail the gate. This is the check that the file is actually served, which is what the
     report turned out to be about: the bytes had landed and the browser was still holding the
     empty one it had cached. */
  const icon = await page.request.get("/favicon.svg");
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");

  await open(page);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  expect(await page.title()).toBe("AnyDag");
});

test("a snapshot has no chrome, so the reference baselines never see any of this", async ({ page }) => {
  /* The assumption every branding change is allowed to be aggressive under, and the one this
     whole commit rests on: none of the 45 reference screenshots may move because of a wordmark. */
  await page.goto(`/?board=${name}&snapshot=1`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await expect(page.locator(".dag-toolbar")).toHaveCount(0);
  await expect(page.locator(".dag-lockup")).toHaveCount(0);
});
