import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { lead } from "./keys";
import { BOARDS } from "./boards";

/**
 * Tidy up, from the key to the bytes.
 *
 * The arithmetic is tested as arithmetic in `test/tidy.test.ts`; what is checked here is the rest
 * of the path — that `T` runs it over the page's measured boxes, that a selection narrows it, that
 * the result is one write to the board file, that a tidy board is left alone, and that the script
 * an agent runs gets the same answer through the same door.
 */

const DIR = BOARDS;

/* Three notes: two roughly in a row and out of line, one below, with a ragged gap. */
const BOARD = `---
title: Tidy me
flow:
  gap: 40
---

\`\`\`md {#a x=0 y=0 w=200}
A
\`\`\`

\`\`\`md {#b x=290 y=14 w=200}
B
\`\`\`

\`\`\`md {#c x=6 y=300 w=200}
C
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
const at = (id: string, text = read()) => {
  const m = new RegExp(`\`\`\`md \\{#${id} x=(-?\\d+) y=(-?\\d+)`).exec(text);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
};

async function open(page: Page, query = "") {
  await page.goto(`/?board=${name}${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

async function clickItem(page: Page, id: string, modifier?: "Shift") {
  const box = (await page.locator(`[data-dag-item="${id}"]`).boundingBox())!;
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(box.x + 30, box.y + 10);
  if (modifier) await page.keyboard.up(modifier);
}

test("the leader chord lines the board up: one row, one gap, the next row one gap below", async ({ page }) => {
  await open(page);
  await lead(page, "t");

  await expect.poll(() => at("b")?.y, { timeout: 5_000 }).toBe(0);
  const text = read();
  const a = at("a", text)!;
  const b = at("b", text)!;
  const c = at("c", text)!;

  /* A row: b shares a's top and sits one gap past a's width. */
  expect(a).toEqual({ x: 0, y: 0 });
  expect(b).toEqual({ x: 200 + 40, y: 0 });
  /* The next row: c shares a's left edge and sits one gap under the taller of the two. */
  expect(c.x).toBe(0);
  expect(c.y).toBeGreaterThan(0);
  expect(c.y % 8).toBe(0);
  const heights = await page.locator("[data-dag-item]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(c.y).toBeLessThanOrEqual(Math.ceil(Math.max(...heights) / 8) * 8 + 40);

  /* One write, nothing else in the document touched. */
  expect(text.split("\n").length).toBe(BOARD.split("\n").length);
  expect(text).toContain("title: Tidy me");
});

test("a tidy board is a fixed point, and the page says so without writing", async ({ page }) => {
  await open(page);
  await lead(page, "t");
  await expect.poll(() => at("b")?.y, { timeout: 5_000 }).toBe(0);
  /* The file is one round trip ahead of the page: `useBoard` adopts the server's text when the
     response lands, and the boxes this runs over are measured a render later. Pressing `t` again
     before that tidies *stale* boxes, moves things a second time, and `moved` is never 0 — which
     is what timed out here about one run in three under load. `a` and `b` sharing a rendered top
     edge is the page saying it has caught up. */
  const topOf = async (id: string) => Math.round((await page.locator(`[data-dag-item="${id}"]`).boundingBox())!.y);
  await expect.poll(async () => (await topOf("a")) === (await topOf("b")), { timeout: 5_000 }).toBe(true);
  const once = read();
  const stat = fs.statSync(file).mtimeMs;

  await lead(page, "t");
  await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.dagTidy ?? "{}").moved === 0, null, {
    timeout: 5_000,
  });
  await page.waitForTimeout(300);
  expect(read()).toBe(once);
  expect(fs.statSync(file).mtimeMs).toBe(stat);
});

test("with two or more selected, only the selection is tidied", async ({ page }) => {
  await open(page);
  await clickItem(page, "a");
  await clickItem(page, "b", "Shift");
  await lead(page, "t");

  await expect.poll(() => at("b")?.y, { timeout: 5_000 }).toBe(0);
  const text = read();
  expect(at("a", text)).toEqual({ x: 0, y: 0 });
  expect(at("b", text)).toEqual({ x: 240, y: 0 });
  /* c was not in the selection and stays exactly where it was written. */
  expect(at("c", text)).toEqual({ x: 6, y: 300 });
});

test("the toolbar button and the selection bar do the same, and undo takes it back", async ({ page }) => {
  await open(page);
  await page.locator("[data-dag-dock] [data-dag-tidy]").click();
  await expect.poll(() => at("b")?.y, { timeout: 5_000 }).toBe(0);

  /*
   * The bytes are back; the *page* may not know it yet — and ctrl+Z is a question asked of the
   * page. `history.push` runs once the patch **resolves**, so between the file changing and the
   * response landing the undo stack is still empty and ctrl+Z does nothing at all: no request, no
   * error, nothing to see. Against `npm run dev` that window is small enough that this never
   * showed; against the compose stack, where the answer comes back through nginx and Caddy while
   * the container's write has already reached the disk, it is wide enough to lose three runs in
   * five. The undo control going live is the page saying the entry exists, which is exactly the
   * precondition being waited for — the same "wait for something the page renders" rule the block
   * below already states about the boxes.
   */
  await expect(page.locator("[data-dag-dock] [data-dag-undo]")).toBeEnabled({ timeout: 5_000 });

  await page.keyboard.press("Control+z");
  await expect.poll(() => read(), { timeout: 5_000 }).toBe(BOARD);
  /*
   * Waiting for the file is not waiting for the page, and `clickItem` clicks a *box*.
   *
   * The poll above returns the moment the bytes are back, with the tidied positions still on
   * screen — so the box read for `c` is 293px from where the click lands a moment later, the
   * click falls on the paper, and a press on the paper clears the selection rather than
   * extending it. The bar then never appears, because it needs two. Measured 11 times in 12 on
   * this branch and 12 in 12 on main: latent since the test was written, and only ever a
   * question of which side of the repaint the run happened to fall on.
   *
   * `c` is written 300 below `a` and the tidy puts them in a row, so the gap between the two
   * boxes is the page saying which layout it is currently drawing.
   */
  await expect
    .poll(
      async () => {
        const a = await page.locator('[data-dag-item="a"]').boundingBox();
        const c = await page.locator('[data-dag-item="c"]').boundingBox();
        return a && c ? c.y - a.y : 0;
      },
      { timeout: 5_000 },
    )
    .toBeGreaterThan(200);

  await clickItem(page, "a");
  await clickItem(page, "c", "Shift");
  await expect(page.locator("[data-dag-selbar] [data-dag-tidy]")).toBeVisible();
  await page.locator("[data-dag-selbar] [data-dag-tidy]").click();
  await expect.poll(() => at("c")?.x, { timeout: 5_000 }).toBe(0);
  expect(at("b")).toEqual({ x: 290, y: 14 });
});

/* What `scripts/tidy.mjs` does, without the process: the event in, the result on the root. */
const viaEvent = (page: Page, dry: boolean) =>
  page.evaluate(async (dry) => {
    delete document.documentElement.dataset.dagTidy;
    document.dispatchEvent(new CustomEvent("dag:tidy", { detail: { dry } }));
    for (let i = 0; i < 100 && document.documentElement.dataset.dagTidy === undefined; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return JSON.parse(document.documentElement.dataset.dagTidy ?? "{}") as {
      moved: number;
      of: number;
      ids: string[];
      dry: boolean;
    };
  }, dry);

test("the dag:tidy event tidies everything under ?snapshot=1, and publishes what it did", async ({ page }) => {
  await open(page, "&snapshot=1");

  /* A dry run says what would move and touches nothing — the script's `--check`. */
  const dry = await viaEvent(page, true);
  expect(dry).toMatchObject({ of: 3, moved: 2, dry: true });
  expect(dry.ids.sort()).toEqual(["b", "c"]);
  await page.waitForTimeout(300);
  expect(read()).toBe(BOARD);

  const wet = await viaEvent(page, false);
  expect(wet).toMatchObject({ of: 3, moved: 2, dry: false });
  await expect.poll(() => at("b")?.y, { timeout: 5_000 }).toBe(0);
  expect(at("c")!.x).toBe(0);
});
