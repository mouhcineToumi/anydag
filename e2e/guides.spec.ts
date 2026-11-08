import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";

/**
 * Smart guides: a dragged item snaps to the items around it, and says so.
 *
 * Three cards of one width in a row, 80 apart, plus one loose card below. Every drop is chosen to
 * land a few pixels off a guide and on the wrong side of the grid, so the file can only hold the
 * guided value if the guide took — the grid alone would have written something else.
 */

const DIR = BOARDS;

const BOARD = `---
title: Line me up
---

\`\`\`md {#a x=0 y=0 w=200}
A
\`\`\`

\`\`\`md {#b x=280 y=0 w=200}
B
\`\`\`

\`\`\`md {#c x=560 y=0 w=200}
C
\`\`\`

\`\`\`md {#loose x=0 y=400 w=200}
Loose
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-scratch-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  /* Park the canvas at 1:1 so a board distance is a screen distance — through the viewport's own
     path, and touched once, so a drop that changes the content bounds does not refit it. */
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("0");
  await page.mouse.move(800, 600);
  await page.mouse.wheel(0, 1);
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-zoom", "1");
}

/** Drag `id` by a screen delta, in two moves so the slop is crossed before the drag proper. */
async function drag(
  page: Page,
  id: string,
  dx: number,
  dy: number,
  opts: { alt?: boolean; hold?: (p: Page) => Promise<void> } = {},
) {
  const at = (await page.locator(`[data-dag-item="${id}"]`).boundingBox())!;
  const x = at.x + 30;
  const y = at.y + 10;
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (opts.alt) await page.keyboard.down("Alt");
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  if (opts.hold) await opts.hold(page);
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up("Alt");
}

const pos = (id: string) => {
  const m = new RegExp(`\`\`\`md \\{#${id} x=(-?\\d+(?:\\.\\d+)?) y=(-?\\d+(?:\\.\\d+)?)`).exec(read())!;
  return { x: Number(m[1]), y: Number(m[2]) };
};

test("a left edge snaps to another card's left edge, over the grid", async ({ page }) => {
  await open(page);
  /* 285 is three off b's left at 280 and five off the grid's 288: only a guide writes 280. */
  await drag(page, "loose", 285, 0, {
    hold: async (p) => {
      await expect(p.locator(".dag-guides line")).not.toHaveCount(0);
    },
  });
  await expect.poll(() => pos("loose").x, { timeout: 5_000 }).toBe(280);
  expect(pos("loose").y).toBe(400);
  await expect(page.locator(".dag-guides line")).toHaveCount(0);
});

test("a card snaps to the middle between two cards", async ({ page }) => {
  await open(page);
  /* Take B out of the row and nudge C along by ten (alt: the grid, not the guides, so C lands
     at 568). Between A (ends 200) and C there is then 368 of room for a 200 card: the middle is
     x = 284, which is not on the grid. Both neighbours are in the row the card is dragged into. */
  await drag(page, "b", 0, 600, { alt: true });
  await expect.poll(() => pos("b").y, { timeout: 5_000 }).toBe(600);
  await drag(page, "c", 10, 0, { alt: true });
  await expect.poll(() => pos("c").x, { timeout: 5_000 }).toBe(568);
  await drag(page, "loose", 287, -400);
  await expect.poll(() => pos("loose").x, { timeout: 5_000 }).toBe(284);
  expect(pos("loose").y).toBe(0);
});

test("a card snaps to the same gap its neighbours keep", async ({ page }) => {
  await open(page);
  /* A..B and B..C are 80 apart; beyond C the equal-gap spot is x = 840. Drag Loose up into the
     row, five off that and three off the grid's 848. */
  await drag(page, "loose", 845, -400);
  await expect.poll(() => pos("loose").x, { timeout: 5_000 }).toBe(840);
  expect(pos("loose").y).toBe(0);
});

test("alt turns the guides off and the grid takes over", async ({ page }) => {
  await open(page);
  await drag(page, "loose", 285, 0, {
    alt: true,
    hold: async (p) => {
      await expect(p.locator(".dag-guides line")).toHaveCount(0);
    },
  });
  await expect.poll(() => pos("loose").x, { timeout: 5_000 }).toBe(288);
});

test("a selection snaps as one box", async ({ page }) => {
  await open(page);
  /* A and B together, dragged down to align their left edge with Loose's: the pair keeps its 80. */
  const a = (await page.locator('[data-dag-item="a"]').boundingBox())!;
  await page.mouse.click(a.x + 30, a.y + 10);
  await page.keyboard.down("Shift");
  const b = (await page.locator('[data-dag-item="b"]').boundingBox())!;
  await page.mouse.click(b.x + 30, b.y + 10);
  await page.keyboard.up("Shift");
  await drag(page, "a", 5, 200);
  await expect.poll(() => pos("a").x, { timeout: 5_000 }).toBe(0);
  expect(pos("b").x).toBe(280);
  expect(pos("b").y).toBe(pos("a").y);
});
