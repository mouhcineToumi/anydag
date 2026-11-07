import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * A board write the server never receives (an api restart, a closed desktop server child).
 *
 * `fetch` rejects rather than answering, and a drag's release and a nudge both fire and forget, so
 * the rejection used to be unhandled and the item stayed drawn where it was dropped while the file
 * said otherwise. Every check here reads the three things that must hold afterwards: the page threw
 * nothing, the item is drawn where the file has it, and the person was told the change was not
 * saved. `/__board/patch` is failed with a network error by `page.route`, which is the same
 * rejection a dead server gives `fetch`.
 *
 * One board per test, because the suite runs in parallel and these tests write to disk.
 */

const BOARD = `---
title: Offline
---

\`\`\`md {#one x=0 y=0 w=280}
The first item.
\`\`\`
`;

let name = "";
let file = "";
let thrown: string[] = [];

test.beforeEach(({ page }, info) => {
  name = `e2e-offline-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
  thrown = [];
  page.on("pageerror", (e) => thrown.push(String(e)));
});

test.afterEach(() => {
  fs.rmSync(file, { force: true });
  /* An unhandled rejection is a `pageerror`; the aborted request's own "Failed to load resource" line
     is the browser reporting what the test did on purpose, and is not read. */
  expect(thrown, "uncaught errors").toEqual([]);
});

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** The server is unreachable for writes from here on, and the number of writes that were tried. */
async function failPatches(page: Page): Promise<() => number> {
  let tried = 0;
  await page.route("**/__board/patch**", (route) => {
    tried += 1;
    return route.abort("connectionrefused");
  });
  return () => tried;
}

const notice = (page: Page) => page.locator("[data-dag-upload-problem]");
const item = (page: Page) => page.locator('[data-dag-item="one"]');

test("a drag released while the server is unreachable goes back to where the file has it, and says so", async ({ page }) => {
  await open(page);
  const tried = await failPatches(page);
  const drawn = await item(page).getAttribute("style");
  const before = fs.readFileSync(file, "utf8");

  const at = (await item(page).boundingBox())!;
  await page.mouse.move(at.x + 40, at.y + 12);
  await page.mouse.down();
  await page.mouse.move(at.x + 160, at.y + 112, { steps: 8 });
  await page.mouse.up();

  await expect.poll(tried, { timeout: 5_000 }).toBeGreaterThan(0);
  await expect(notice(page)).toContainText("not saved");
  await expect(item(page)).toHaveAttribute("style", drawn!);
  expect(fs.readFileSync(file, "utf8")).toBe(before);
});

test("a nudge released while the server is unreachable goes back too", async ({ page }) => {
  await open(page);
  const tried = await failPatches(page);
  const drawn = await item(page).getAttribute("style");
  const before = fs.readFileSync(file, "utf8");

  const at = (await item(page).boundingBox())!;
  await page.mouse.click(at.x + 40, at.y + 12);
  await page.keyboard.press("ArrowRight");

  await expect.poll(tried, { timeout: 5_000 }).toBeGreaterThan(0);
  await expect(notice(page)).toContainText("not saved");
  await expect(item(page)).toHaveAttribute("style", drawn!);
  expect(fs.readFileSync(file, "utf8")).toBe(before);
});

test("a delete while the server is unreachable says so and leaves the item drawn", async ({ page }) => {
  await open(page);
  const tried = await failPatches(page);
  const before = fs.readFileSync(file, "utf8");

  const at = (await item(page).boundingBox())!;
  await page.mouse.click(at.x + 40, at.y + 12);
  await page.keyboard.press("Delete");

  await expect.poll(tried, { timeout: 5_000 }).toBeGreaterThan(0);
  await expect(notice(page)).toContainText("not saved");
  await expect(item(page)).toBeVisible();
  expect(fs.readFileSync(file, "utf8")).toBe(before);
});
