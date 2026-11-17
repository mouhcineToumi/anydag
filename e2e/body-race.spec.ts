import fs from "node:fs";
import path from "node:path";

import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";

/**
 * A card's edit racing another writer's change to the same diagram (#393).
 *
 * An edit to a card inside a fence is written as the fence's whole body. When the page is one round
 * trip behind — the change feed's refetch held here with `page.route`, the slow answer the `base`
 * check exists for — the write meets a 409 carrying the other writer's text. The retry used to post
 * the same body, rendered from the old text, and the other writer's line inside that fence was gone
 * with nobody told. Each check reads the file: the person's edit and the agent's line are both in
 * it, or, when the two changed the same line, the agent's text is and the person is told.
 *
 * One board per test: the suite runs in parallel and these write to disk.
 */

const V1 = `---
title: Body race
---

\`\`\`arch {#infra x=0 y=0}
service api "API"
store db "Database"

api --> db
\`\`\`
`;

/** The agent's write: a new card in the same fence. */
const V2 = V1.replace('store db "Database"\n', 'store db "Database"\nqueue jobs "Jobs"\n');

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-body-race-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, V1);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** Click, pause, click: the second press is what picks a card out, and Chromium pairs fast ones. */
async function pick(page: Page, node: string) {
  const card = page.locator(`[data-dag-item="infra"] [data-dag-node="${node}"]`);
  await card.click();
  await page.waitForTimeout(400);
  await card.click();
  await page.waitForTimeout(200);
}

/**
 * Another writer changes the file while the page cannot hear about it: the feed's refetch is held
 * until the returned function lets it go. Waits until the page has asked, which is the proof the
 * server saw the write — a patch sent before that would be applied to the text it already had.
 */
async function external(page: Page, text: string): Promise<() => Promise<void>> {
  const asked: Promise<void>[] = [];
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/__board/get*", (route) => {
    const sent = held.then(() => route.continue());
    asked.push(sent);
    return sent;
  });
  fs.writeFileSync(file, text);
  await expect.poll(() => asked.length, { timeout: 10_000 }).toBeGreaterThan(0);
  /* Every held request goes on before the route is taken away, or it is left handled by nobody. */
  return async () => {
    release();
    await Promise.all(asked);
    await page.unroute("**/__board/get*");
  };
}

/** Every 409 the page was answered with, counted so a test can prove the race happened. */
function refusals(page: Page): () => number {
  let n = 0;
  page.on("response", (r) => {
    if (r.url().includes("/__board/patch") && r.status() === 409) n += 1;
  });
  return () => n;
}

test("a title typed in the panel lands beside the line another writer added to that diagram", async ({ page }) => {
  await open(page);
  const refused = refusals(page);
  await pick(page, "api");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-props]")).toHaveCount(1);

  const done = await external(page, V2);
  await page.locator("[data-dag-prop-title]").fill("API v2");
  await page.locator("[data-dag-prop-title]").blur();

  await expect.poll(read, { timeout: 5_000 }).toContain('service api "API v2"');
  expect(refused()).toBeGreaterThan(0);
  expect(read()).toBe(V2.replace('service api "API"', 'service api "API v2"'));
  await done();
  await expect(page.locator('[data-dag-item="infra"] [data-dag-node="jobs"]')).toHaveCount(1);

  /* Undo is the version the edit was written over — the agent's, not the one the page held. */
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect.poll(read, { timeout: 5_000 }).toBe(V2);
});

test("Delete on the picked card keeps the line another writer added under it", async ({ page }) => {
  await open(page);
  const refused = refusals(page);
  await pick(page, "db");

  const done = await external(page, V2);
  await page.keyboard.press("Delete");

  await expect.poll(read, { timeout: 5_000 }).not.toContain('store db "Database"');
  expect(refused()).toBeGreaterThan(0);
  const now = read();
  expect(now).toContain('queue jobs "Jobs"');
  expect(now).toContain('service api "API"');
  expect(now).not.toContain("api --> db");
  await done();
});

test("an edit to the line the other writer changed is not written, and the person is told", async ({ page }) => {
  await open(page);
  const refused = refusals(page);
  await pick(page, "api");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-props]")).toHaveCount(1);

  const theirs = V1.replace('service api "API"', 'service api "Gateway"');
  const done = await external(page, theirs);
  await page.locator("[data-dag-prop-title]").fill("API v2");
  await page.locator("[data-dag-prop-title]").blur();

  await expect(page.locator("[data-dag-upload-problem]")).toContainText("not saved");
  expect(refused()).toBe(1);
  expect(read()).toBe(theirs);
  await done();
});
