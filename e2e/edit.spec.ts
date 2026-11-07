import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { BOARDS } from "./boards";

/**
 * Dragging an item writes to the board file.
 *
 * This is the only test that exercises the tool's one write path from the pointer all the way to
 * the bytes on disk, so it works on a real board file rather than a fixture string: the thing being
 * checked is precisely that a gesture in a browser turns into a small, correct edit to a document a
 * person also owns.
 *
 * It writes into `boards/` and deletes what it wrote. The name is deliberately obvious in a
 * directory listing, in case a run is killed before it cleans up.
 */

const DIR = BOARDS;

const BOARD = `---
title: Drag me
---

\`\`\`md {#one}
The first item.
\`\`\`

\`\`\`md {#two}
The second item.
\`\`\`
`;

/* One board per test, because the suite runs in parallel and these tests write to disk. */
let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-scratch-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

async function open(page: import("@playwright/test").Page, query = "") {
  await page.goto(`/?board=${name}${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

test("a drag pins the item it moved, and every item that was flowing", { tag: "@smoke" }, async ({ page }) => {
  await open(page);

  const one = page.locator('[data-dag-item="one"]');
  const from = (await one.boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + 20);
  await page.mouse.down();
  /* Two moves: the first crosses the slop and starts the drag, the second is the drag itself. */
  await page.mouse.move(from.x + 140, from.y + 120, { steps: 8 });
  await page.mouse.move(from.x + 240, from.y + 220, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(() => fs.readFileSync(file, "utf8"), { timeout: 5_000 })
    .toMatch(/```md \{#one x=\d+ y=\d+\}/);

  const after = fs.readFileSync(file, "utf8");

  /* The item that moved is pinned where it was dropped, on the theme's 8px grid. */
  const moved = /```md \{#one x=(\d+) y=(\d+)\}/.exec(after)!;
  expect(Number(moved[1]) % 8).toBe(0);
  expect(Number(moved[2]) % 8).toBe(0);

  /* And so is the one that was merely flowing, at the position it already had — otherwise pinning
     the first item would have shoved it down the board. See `placeItems`. */
  expect(after).toMatch(/```md \{#two x=\d+ y=\d+\}/);

  /* Nothing else in the document moved. */
  expect(after).toContain("title: Drag me");
  expect(after).toContain("The first item.");
  expect(after).toContain("The second item.");
  expect(after.split("\n").length).toBe(BOARD.split("\n").length);
});

test("a click is not a drag", async ({ page }) => {
  await open(page);
  const one = page.locator('[data-dag-item="one"]');
  const at = (await one.boundingBox())!;
  await page.mouse.click(at.x + 40, at.y + 20);
  await page.waitForTimeout(500);
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);
});

test("a write against a version that has moved is refused", { tag: "@smoke" }, async ({ page }) => {
  await open(page);

  const stale = await page.evaluate(async (name) => {
    const r = await fetch(`/__board/patch?name=${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base: "0000000000000000000000000000000000000000", ops: [{ id: "one", attrs: { x: 8 } }] }),
    });
    return { status: r.status, body: (await r.json()) as { base?: string; text?: string } };
  }, name);

  expect(stale.status).toBe(409);
  /* The refusal carries what replaced it, so the client can retry against real content rather than
     refetching and guessing. */
  expect(stale.body.text).toBe(BOARD);
  expect(stale.body.base).toHaveLength(40);
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);
});

test("the snapshot view cannot be edited", async ({ page }) => {
  await open(page, "&snapshot=1");
  await expect(page.locator("[data-dag-movable]")).toHaveCount(0);

  const one = page.locator('[data-dag-item="one"]');
  const at = (await one.boundingBox())!;
  await page.mouse.move(at.x + 40, at.y + 20);
  await page.mouse.down();
  await page.mouse.move(at.x + 240, at.y + 220, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);
});
