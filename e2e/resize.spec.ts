import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";

/**
 * Resizing from every side and corner.
 *
 * The right edge writes `w=`; the bottom edge writes `h=`, which the item then draws as a minimum
 * height; the left and top edges move the origin too, so the far edge stays put. The board is
 * parked at 1:1 so a screen distance is a board distance, and every pull is a multiple of eight so
 * the grid and the guides agree on where it lands.
 */

const DIR = BOARDS;

const BOARD = `---
title: Resize me
---

\`\`\`md {#one x=0 y=0 w=320}
The first item.
\`\`\`

\`\`\`md {#two x=640 y=0 w=320}
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

const read = () => fs.readFileSync(file, "utf8");
const attrs = (id: string) => {
  const line = new RegExp(`\`\`\`md \\{#${id}([^}]*)\\}`).exec(read())![1]!;
  const out: Record<string, number> = {};
  for (const m of line.matchAll(/(\w+)=(-?\d+)/g)) out[m[1]!] = Number(m[2]);
  return out;
};

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("0");
  await page.mouse.move(800, 600);
  await page.mouse.wheel(0, 1);
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-zoom", "1");
}

async function pull(page: Page, id: string, dir: string, dx: number, dy: number) {
  const at = (await page.locator(`[data-dag-item="${id}"]`).boundingBox())!;
  await page.mouse.click(at.x + 30, at.y + 10);
  const h = (await page.locator(`[data-dag-handle="${dir}"]`).boundingBox())!;
  const x = h.x + h.width / 2;
  const y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test("every side and corner is a handle, and the far edge stays put", async ({ page }) => {
  await open(page);
  const one = (await page.locator('[data-dag-item="one"]').boundingBox())!;
  await page.mouse.click(one.x + 30, one.y + 10);
  await expect(page.locator("[data-dag-handle]")).toHaveCount(8);
  /* The note measured a fractional height; the bottom edge lands on the grid, so the height it
     gets is the grid's nearest to forty more. */
  const h1 = Math.round((one.height + 40) / 8) * 8;

  /* Right edge: wider by 80, origin unchanged. */
  await pull(page, "one", "e", 80, 0);
  await expect.poll(() => attrs("one").w, { timeout: 5_000 }).toBe(400);
  expect(attrs("one").x).toBe(0);

  /* Bottom edge: a height, about forty taller than it measured. */
  await pull(page, "one", "s", 0, 40);
  await expect.poll(() => attrs("one").h, { timeout: 5_000 }).toBe(h1);
  /* And the item on screen is that tall now. */
  await expect
    .poll(async () => Math.round((await page.locator('[data-dag-item="one"]').boundingBox())!.height), { timeout: 5_000 })
    .toBe(h1);

  /* Left edge in by 80: x moves, the right edge stays at 400. */
  await pull(page, "one", "w", 80, 0);
  await expect.poll(() => attrs("one").x, { timeout: 5_000 }).toBe(80);
  expect(attrs("one").w).toBe(320);

  /* Top edge down by 32: y moves, the bottom stays. (Sixteen would have met the neighbour's
     centre line and snapped to it — an edge aligns to centres too.) */
  await pull(page, "one", "n", 0, 32);
  await expect.poll(() => attrs("one").y, { timeout: 5_000 }).toBe(32);
  expect(attrs("one").h).toBe(h1 - 32);

  /* A corner does both. */
  await pull(page, "one", "nw", -80, -32);
  await expect.poll(() => attrs("one").x, { timeout: 5_000 }).toBe(0);
  expect(attrs("one").y).toBe(0);
  expect(attrs("one").w).toBe(400);
  expect(attrs("one").h).toBe(h1);
});

test("a pulled edge snaps to a neighbour's edge, and cannot cross its own far edge", async ({ page }) => {
  await open(page);
  /* Two's left edge is at 640; one's right edge pulled to 637 lands on it. */
  await pull(page, "one", "e", 317, 0);
  await expect.poll(() => attrs("one").w, { timeout: 5_000 }).toBe(640);
  /* Pulled back past the left edge — but released over the paper, not over the board list,
     whose click would open another board — it stops at the minimum width. */
  await pull(page, "one", "e", -600, 0);
  await expect.poll(() => attrs("one").w, { timeout: 5_000 }).toBe(160);
});

/**
 * Hand-placed content: the handles scale the drawing, not a frame around it.
 *
 * `layoutSketch` honours each node's own coordinates and never reads the fence's box, so `w=`/`h=`
 * there moved the frame and left the shapes exactly where they were — a bigger empty rectangle, and
 * on the way in a drawing spilling out of a frame too small to hold it. Every number below is exact
 * rather than approximate, and that is the point: the factor is taken from the *content extent*, so
 * the frame lands precisely where the pointer let go. `frame.barePad` is 8 and `metric.grid` is 8 in
 * all three themes, and neither fence carries a `title=`, so neither wears a header.
 */

const SKETCH = `---
title: Resize me
---

\`\`\`sketch {#draw x=0 y=0}
box a "One" x=0 y=0 w=160 h=80
box b "Two" x=200 y=0 w=160 h=80
\`\`\`
`;

/* Geometry off a declaration line, where `attrs()` above reads it off an `md` fence. */
const nodeAt = (id: string) => {
  const line = new RegExp(`^\\w+ ${id} .*$`, "m").exec(read())![0];
  const out: Record<string, number> = {};
  for (const m of line.matchAll(/\b([xywh])=(-?\d+)/g)) out[m[1]!] = Number(m[2]);
  return out;
};

/**
 * Select the item and pull one handle.
 *
 * Not the `pull()` above: a second click on a diagram picks the card *out* of it (F1's rule), and a
 * picked card takes the handles away from the item. So the paper is clicked first to let go of
 * whatever the last pull left selected, and only then the item.
 */
async function pullItem(page: Page, id: string, dir: string, dx: number, dy: number) {
  await page.mouse.click(1400, 900);
  const at = (await page.locator(`[data-dag-item="${id}"]`).boundingBox())!;
  await page.mouse.click(at.x + 4, at.y + 2);
  const h = (await page.locator(`[data-dag-handle="${dir}"]`).boundingBox())!;
  const x = h.x + h.width / 2;
  const y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

const itemW = async (page: Page, id: string) =>
  Math.round((await page.locator(`[data-dag-item="${id}"]`).boundingBox())!.width);
const itemH = async (page: Page, id: string) =>
  Math.round((await page.locator(`[data-dag-item="${id}"]`).boundingBox())!.height);

test("a sketch of two shapes scales its drawing, one axis at a time", async ({ page }) => {
  fs.writeFileSync(file, SKETCH);
  await open(page);

  /* The content reaches 360 across and 80 down, so the bare frame is 376 × 96. */
  expect(await itemW(page, "draw")).toBe(376);

  /* Pulled 360 wider, the extent is asked to go 360 → 720: exactly twice. */
  await pullItem(page, "draw", "e", 360, 0);
  await expect.poll(() => nodeAt("b").x, { timeout: 5_000 }).toBe(400);
  expect(nodeAt("a")).toEqual({ x: 0, y: 0, w: 320, h: 80 });
  expect(nodeAt("b")).toEqual({ x: 400, y: 0, w: 320, h: 80 });

  /* The idle axis is untouched, which is why `y=0 h=80` above are still what the author wrote: a
     side pull that wrote a height would pin one the author never asked for. */
  expect(read()).not.toContain("aspect=");

  /* And the frame hugs what it now holds rather than standing off it — 720 plus the bare padding
     twice, which is where the pointer was let go. Polled, because the file coming back is one
     round trip ahead of the page having re-laid it out. */
  await expect.poll(() => itemW(page, "draw"), { timeout: 5_000 }).toBe(736);

  /* Now the other axis: 96 tall, pulled 80 further, so the extent goes 80 → 160. */
  await pullItem(page, "draw", "s", 0, 80);
  await expect.poll(() => nodeAt("a").h, { timeout: 5_000 }).toBe(160);
  expect(nodeAt("a")).toEqual({ x: 0, y: 0, w: 320, h: 160 });
  expect(nodeAt("b")).toEqual({ x: 400, y: 0, w: 320, h: 160 });
  await expect.poll(() => itemH(page, "draw"), { timeout: 5_000 }).toBe(176);
});

const FIXED_ARCH = `---
title: Resize me
---

\`\`\`arch {#flow layout=fixed}
service api "API" x=0 y=0 w=160
service db "Database" x=240 y=0 w=160
\`\`\`
`;

test("a fence opened layout=fixed has eight handles, and they scale it", async ({ page }) => {
  fs.writeFileSync(file, FIXED_ARCH);
  await open(page);

  /* `resizeOf` answers about a *type*, so this reported `aspect` and drew the two side handles —
     which wrote an ELK option a fixed layout never consults, a control that changed nothing at all.
     `resizeOfItem` is what reads the fence instead. */
  const at = (await page.locator('[data-dag-item="flow"]').boundingBox())!;
  await page.mouse.click(at.x + 4, at.y + 2);
  await expect(page.locator("[data-dag-handle]")).toHaveCount(8);

  /* 400 across, so 416 with the bare padding; pulled 400 wider the extent doubles. Only the width
     is asserted: a card's height here is its text's, not a number this board wrote. */
  expect(await itemW(page, "flow")).toBe(416);
  await pullItem(page, "flow", "e", 400, 0);
  await expect.poll(() => nodeAt("db").x, { timeout: 5_000 }).toBe(480);
  expect(nodeAt("api").w).toBe(320);
  expect(nodeAt("db").w).toBe(320);
  await expect.poll(() => itemW(page, "flow"), { timeout: 5_000 }).toBe(816);

  /* And no `aspect=` anywhere: the thing this fence stopped doing is fold. */
  expect(read()).not.toContain("aspect=");
});

test("a board with a sized item still becomes ready", async ({ page }) => {
  fs.writeFileSync(file, BOARD.replace("w=320}", "w=320 h=200}"));
  await open(page);
  const one = (await page.locator('[data-dag-item="one"]').boundingBox())!;
  expect(Math.round(one.height)).toBe(200);
});
