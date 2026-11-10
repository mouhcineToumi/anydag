import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";
import { lead } from "./keys";

/**
 * Moving around the board.
 *
 * Every check here reads the transform actually on the glass rather than any React state, because
 * that is the whole design of `Viewport`: a gesture paints and only tells React at the end, so a
 * test that trusted a rendered attribute would be testing the frame after the one that matters.
 *
 * The board is a scratch file rather than a fixture, for the same reason `edit.spec.ts` uses one —
 * the space-and-middle-drag tests are assertions about the file *not* changing, and that is only
 * worth anything against a file a drag could really have written to.
 */

const DIR = BOARDS;

const BOARD = `---
title: Move me
---

\`\`\`md {#one}
The first item.
\`\`\`

\`\`\`md {#two}
The second item.
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

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** Where the canvas is right now: the painted scale and translation, and the box they are in. */
function view(page: Page) {
  return page.evaluate(() => {
    const box = document.querySelector(".dag-viewport") as HTMLElement;
    const layer = document.querySelector(".dag-layer") as HTMLElement;
    const m = new DOMMatrix(getComputedStyle(layer).transform);
    const rect = box.getBoundingClientRect();
    return { zoom: m.a, x: m.e, y: m.f, left: rect.left, top: rect.top };
  });
}

/** The board coordinate under a point on the screen — what a pointer-anchored zoom must preserve. */
const under = (v: Awaited<ReturnType<typeof view>>, cx: number, cy: number) => ({
  x: (cx - v.left - v.x) / v.zoom,
  y: (cy - v.top - v.y) / v.zoom,
});

const zoomOf = (page: Page) => page.locator(".dag-viewport").getAttribute("data-zoom").then(Number);

/*
 * The view a board opens with.
 *
 * The automatic first fit frames the content, and it used to magnify a small board until it filled
 * the glass: a new board's one prompt card opened at 215%, which reads as "too much zoom". It now
 * caps itself at 100%, while the Fit button keeps the full range — a person who asks to frame one
 * small thing means to look at it closely.
 */
const SMALL_BOARD = `---
title: One small card
---

\`\`\`md {#only x=0 y=0 w=240 h=160}
One small card.
\`\`\`
`;

/** Bigger than the 1600 × 1200 harness window in both directions. */
const BIG_BOARD = `---
title: One big card
---

\`\`\`md {#big x=0 y=0 w=4000 h=3000}
One card bigger than the window.
\`\`\`
`;

test("opens a board smaller than the view at 100%, and keeps Fit able to magnify", async ({ page }) => {
  fs.writeFileSync(file, SMALL_BOARD);
  await open(page);

  await expect.poll(() => zoomOf(page)).toBe(1);
  await expect(page.locator(".dag-zoombar__pct")).toHaveText("100%");

  /* The explicit action is unchanged: it still fills the glass with the one card. */
  await page.locator('.dag-zoombar button[aria-label="Fit to content (F)"]').click();
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(1);

  /* Manual zoom still reaches the ceiling, and the readout's own button returns to 100%. */
  await page.mouse.move(800, 600);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -5000);
  await page.keyboard.up("Control");
  await expect.poll(() => zoomOf(page)).toBe(4);

  await page.locator(".dag-zoombar__pct").click();
  await expect.poll(() => zoomOf(page)).toBe(1);
});

test("still fits a board larger than the view, with the existing margin", async ({ page }) => {
  fs.writeFileSync(file, BIG_BOARD);
  await open(page);

  await expect.poll(() => zoomOf(page)).toBeLessThan(1);
  const zoom = await zoomOf(page);
  const viewport = await page.evaluate(() => {
    const box = document.querySelector(".dag-viewport") as HTMLElement;
    return { w: box.clientWidth, h: box.clientHeight };
  });
  const onScreen = (await page.locator('[data-dag-item="big"]').boundingBox())!;
  const content = { w: onScreen.width / zoom, h: onScreen.height / zoom };

  /* The same arithmetic as `fitTo`: the box minus a 64px margin on each side, at the tighter axis. */
  const expected = Math.min((viewport.w - 128) / content.w, (viewport.h - 128) / content.h);
  expect(Math.abs(zoom - expected)).toBeLessThan(0.01);
  expect(onScreen.width).toBeLessThanOrEqual(viewport.w - 128 + 0.5);
  expect(onScreen.height).toBeLessThanOrEqual(viewport.h - 128 + 0.5);
});

test("a plain wheel moves the board rather than zooming it", async ({ page }) => {
  await open(page);
  const before = await view(page);

  await page.mouse.move(800, 600);
  await page.mouse.wheel(0, 240);
  await page.mouse.wheel(120, 0);

  const after = await view(page);
  expect(after.zoom).toBeCloseTo(before.zoom, 5);
  expect(after.y - before.y).toBeCloseTo(-240, 0);
  expect(after.x - before.x).toBeCloseTo(-120, 0);
});

test("shift lends the wheel's one axis to the other one", async ({ page }) => {
  await open(page);
  const before = await view(page);

  await page.mouse.move(800, 600);
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 200);
  await page.keyboard.up("Shift");

  const after = await view(page);
  expect(after.zoom).toBeCloseTo(before.zoom, 5);
  expect(after.x - before.x).toBeCloseTo(-200, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
});

test("ctrl and a wheel zoom about the pointer", async ({ page }) => {
  await open(page);
  const before = await view(page);
  const at = { x: 700, y: 500 };
  const pinned = under(before, at.x, at.y);

  await page.mouse.move(at.x, at.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");

  const after = await view(page);
  expect(after.zoom).toBeGreaterThan(before.zoom * 1.1);

  /* The point of the board that was under the cursor is still under the cursor. */
  const still = under(after, at.x, at.y);
  expect(still.x).toBeCloseTo(pinned.x, 0);
  expect(still.y).toBeCloseTo(pinned.y, 0);
});

test("holding space turns a press on an item into a pan", async ({ page }) => {
  await open(page);
  const before = await view(page);
  const at = (await page.locator('[data-dag-item="one"]').boundingBox())!;

  await page.keyboard.down("Space");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-pan", "");

  await page.mouse.move(at.x + 40, at.y + 20);
  await page.mouse.down();
  /* Two moves: the first crosses the slop, the second is the drag. */
  await page.mouse.move(at.x + 140, at.y + 100, { steps: 8 });
  await page.mouse.move(at.x + 240, at.y + 180, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Space");

  const after = await view(page);
  expect(after.x - before.x).toBeCloseTo(200, 0);
  expect(after.y - before.y).toBeCloseTo(160, 0);

  /* And the item it was pressed on did not move, which means nothing was written. */
  await page.waitForTimeout(500);
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);
});

test("holding ctrl turns a press on an item into a pan", async ({ page }) => {
  await open(page);
  const before = await view(page);
  const at = (await page.locator('[data-dag-item="one"]').boundingBox())!;

  await page.keyboard.down("Control");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-pan", "");

  await page.mouse.move(at.x + 40, at.y + 20);
  await page.mouse.down();
  await page.mouse.move(at.x + 140, at.y + 100, { steps: 8 });
  await page.mouse.move(at.x + 240, at.y + 180, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Control");

  const after = await view(page);
  expect(after.x - before.x).toBeCloseTo(200, 0);
  expect(after.y - before.y).toBeCloseTo(160, 0);

  await page.waitForTimeout(500);
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);
});

/**
 * The case `data-pan` cannot answer.
 *
 * A modifier already held when the window takes focus delivers no keydown, so the viewport never
 * paints the flag — which is why the press carries the answer too. Deleting the attribute with ctrl
 * genuinely down is that state exactly: the browser still reports `ctrlKey` on the press.
 */
test("a ctrl-press the viewport never saw the keydown for still pans", async ({ page }) => {
  await open(page);
  const before = await view(page);
  const at = (await page.locator('[data-dag-item="one"]').boundingBox())!;

  await page.keyboard.down("Control");
  await page.evaluate(() => delete (document.querySelector(".dag-viewport") as HTMLElement).dataset.pan);
  await expect(page.locator(".dag-viewport")).not.toHaveAttribute("data-pan", "");

  await page.mouse.move(at.x + 40, at.y + 20);
  await page.mouse.down();
  await page.mouse.move(at.x + 140, at.y + 100, { steps: 8 });
  await page.mouse.move(at.x + 240, at.y + 180, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Control");

  const after = await view(page);
  expect(after.x - before.x).toBeCloseTo(200, 0);
  expect(after.y - before.y).toBeCloseTo(160, 0);

  await page.waitForTimeout(500);
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);
});

test("a middle drag pans over an item, with no modifier and nothing written", async ({ page }) => {
  await open(page);
  const before = await view(page);
  const at = (await page.locator('[data-dag-item="one"]').boundingBox())!;

  await page.mouse.move(at.x + 40, at.y + 20);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(at.x + 140, at.y + 100, { steps: 8 });
  await page.mouse.move(at.x + 240, at.y + 180, { steps: 8 });
  await page.mouse.up({ button: "middle" });

  const after = await view(page);
  expect(after.x - before.x).toBeCloseTo(200, 0);
  expect(after.y - before.y).toBeCloseTo(160, 0);

  await page.waitForTimeout(500);
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);
});

test("space released, a press on an item moves it again", async ({ page }) => {
  await open(page);
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  await expect(page.locator(".dag-viewport")).not.toHaveAttribute("data-pan", "");

  const at = (await page.locator('[data-dag-item="one"]').boundingBox())!;
  await page.mouse.move(at.x + 40, at.y + 20);
  await page.mouse.down();
  await page.mouse.move(at.x + 140, at.y + 120, { steps: 8 });
  await page.mouse.move(at.x + 240, at.y + 220, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => fs.readFileSync(file, "utf8"), { timeout: 5_000 }).toMatch(/```md \{#one x=\d+ y=\d+\}/);
});

/*
 * The hand tool.
 *
 * It was honoured only in `Viewport`, which sees a press on the paper and never one on an item,
 * because `Item` stops the press it has decided to keep. So over an item the hand did nothing at
 * all: the press selected, the drag moved, and the cursor said `grab` throughout. Both halves of
 * the report are here — the item that must not move, and the prose that must not highlight.
 */
test("the hand tool pans from a press on an item, and writes nothing", async ({ page }) => {
  await open(page);
  await lead(page, "h");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-tool", "hand");

  const before = await view(page);
  const at = (await page.locator('[data-dag-item="one"]').boundingBox())!;

  await page.mouse.move(at.x + 40, at.y + 20);
  await page.mouse.down();
  /* Two moves, as above: the first crosses the slop, the second is the drag. */
  await page.mouse.move(at.x + 140, at.y + 100, { steps: 8 });
  await page.mouse.move(at.x + 240, at.y + 180, { steps: 8 });
  await page.mouse.up();

  const after = await view(page);
  expect(after.x - before.x).toBeCloseTo(200, 0);
  expect(after.y - before.y).toBeCloseTo(160, 0);

  /* Nothing selected it on the way, either: a press that moved the paper is not a press that
     chose a thing to act on. */
  await expect(page.locator("[data-dag-selected]")).toHaveCount(0);

  await page.waitForTimeout(500);
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);
});

test("the hand tool and a held pan modifier make the board unselectable, so a pan highlights nothing", async ({ page }) => {
  await open(page);

  /*
   * The property, not the gesture. A synthetic pointer does not start a native text selection in
   * this app — probed with both halves of the fix reverted, and no drag, sub-slop nudge or double
   * press highlighted a character under either tool — so a check written as "drag and expect no
   * selection" would pass against a canvas that highlights every word for a real mouse. That is
   * the `[data-dag-error]` mistake this suite has already made once: seventeen assertions that an
   * element was absent, against a selector nothing ever set.
   *
   * What is testable is what the rule says. `user-select` is `auto` on a board item by design —
   * prose is there to be read and copied — and turns off for exactly as long as the paper is the
   * thing being moved.
   */
  const inside = () =>
    page.evaluate(() => {
      const body = document.querySelector('[data-dag-item="one"] .dag-item__body') as HTMLElement;
      return getComputedStyle(body).userSelect;
    });

  expect(await inside()).toBe("auto");

  await lead(page, "h");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-tool", "hand");
  expect(await inside()).toBe("none");

  /* And it comes back, or the hand tool would cost every board its selectable prose for good. */
  await lead(page, "v");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-tool", "select");
  expect(await inside()).toBe("auto");

  /* A held pan modifier is the same rule for the same reason, and goes the same way. */
  await page.keyboard.down("Space");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-pan", "");
  expect(await inside()).toBe("none");

  await page.keyboard.up("Space");
  await expect(page.locator(".dag-viewport")).not.toHaveAttribute("data-pan", "");
  expect(await inside()).toBe("auto");
});
