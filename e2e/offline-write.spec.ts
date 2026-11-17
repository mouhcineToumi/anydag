import fs from "node:fs";
import path from "node:path";

import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";

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

/*
 * #402: the server answers, but no longer lets this page in — `anydag serve` restarted on the same
 * port with another secret path, under a page left open. The gate's refusal is a `401` with
 * `code: "token"` (`server/app.ts`), fulfilled here by `page.route` for every write, as the restarted
 * server answers the old secret. It used to be read as a write that merely did not land: the item
 * went back and nothing was said, and the page looked fully alive.
 */
async function refusePatches(page: Page): Promise<() => number> {
  let tried = 0;
  await page.route("**/__board/patch**", (route) => {
    tried += 1;
    return route.fulfill({ status: 401, json: { error: "this server needs its token", code: "token" } });
  });
  return () => tried;
}

test("a nudge the server refuses this page its credential for goes back, says so, and the page says it lost the server", async ({
  page,
}) => {
  await open(page);
  const tried = await refusePatches(page);
  const drawn = await item(page).getAttribute("style");
  const before = fs.readFileSync(file, "utf8");
  await expect(page.locator("[data-dag-server-lost]")).toHaveCount(0);

  const at = (await item(page).boundingBox())!;
  await page.mouse.click(at.x + 40, at.y + 12);
  await page.keyboard.press("ArrowRight");

  await expect.poll(tried, { timeout: 5_000 }).toBeGreaterThan(0);
  await expect(notice(page)).toContainText("no longer lets this page in");
  await expect(notice(page)).toContainText("not saved");
  /* The lasting notice: what happened and the way back, there for as long as the page is open. */
  const lost = page.locator("[data-dag-server-lost]");
  await expect(lost).toBeVisible();
  await expect(lost).toContainText("nothing here is saved");
  await expect(lost).toHaveAttribute("role", "alert");
  await expect(item(page)).toHaveAttribute("style", drawn!);
  expect(fs.readFileSync(file, "utf8")).toBe(before);
});
