import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { lead } from "./keys";
import { BOARDS } from "./boards";

/**
 * Shapes on the board.
 *
 * "The user or the agent must be able to add shapes to the board like circles, triangles,
 * rectangles … each of those shapes could have inside it some text. And could also have edges
 * linking to other components." What a picture cannot show is what is held here: that one comes
 * from the library as a shape rather than a diagram of one, that its handles size the *shape*, that
 * its words are typed where they are drawn, and that a line into it stops on its outline.
 */

const DIR = BOARDS;

const BOARD = `\`\`\`sketch {#c x=0 y=0}
circle round "Circle"
\`\`\`

\`\`\`sketch {#t x=480 y=0}
triangle tri "Triangle"
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-shapes-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

/** At zoom 1, so a pointer's pixels are the board's. */
async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("0");
  await page.mouse.move(800, 600);
  await page.mouse.wheel(0, 1);
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-zoom", "1");
}

const centreOf = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test("a shape comes from the library as one bare shape, drawn", async ({ page }) => {
  await open(page);
  await lead(page, "l");
  const entry = page.locator('[data-dag-component="part-sketch-diamond"]');
  await entry.scrollIntoViewIfNeeded();
  await entry.click();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/```sketch \{#sketch-[a-z0-9]{4}[^}]*\}\ndiamond diamond1 "Decide\?"/);
  await expect(page.locator('[data-dag-shape="diamond"]')).toBeVisible();
  /* Bare: no header, no type chip — the shape is the whole of what is drawn. */
  await expect(page.locator('[data-dag-shape="diamond"]').locator("xpath=ancestor::*[contains(@class,'dag-frame')]")).toHaveClass(
    /dag-frame--bare/,
  );
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("the handles of a lone shape size the shape, not a frame around it", async ({ page }) => {
  await open(page);
  const before = (await page.locator('[data-dag-node="round"]').boundingBox())!;
  const item = (await page.locator('[data-dag-item="c"]').boundingBox())!;
  await page.mouse.click(item.x + 20, item.y + 20);
  const h = (await page.locator('[data-dag-handle="se"]').boundingBox())!;
  const x = h.x + h.width / 2;
  const y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 40, { steps: 4 });
  await page.mouse.move(x + 80, y + 80, { steps: 4 });
  await page.mouse.up();

  await expect.poll(read).toMatch(/circle round "Circle" w=200 h=200/);
  /* The fence carries no size of its own: the frame hugs the shape. */
  expect(read()).toMatch(/```sketch \{#c x=0 y=0\}/);
  await expect
    .poll(async () => (await page.locator('[data-dag-node="round"]').boundingBox())!.width)
    .toBeCloseTo(before.width + 80, 0);
});

test("a shape's words are typed where they are drawn", async ({ page }) => {
  await open(page);
  const at = await centreOf(page, '[data-dag-node="round"]');
  await page.mouse.click(at.x, at.y);
  await page.mouse.dblclick(at.x, at.y);
  const box = page.locator("[data-dag-rename-box] input, input[data-dag-rename-box]");
  await expect(box).toBeVisible();
  await box.fill("Begin here");
  await box.press("Enter");
  await expect.poll(read).toContain('circle round "Begin here"');
});

test("a link into a triangle stops on its slanted side", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="c"]').click();
  if (await page.locator("[data-dag-picked]").count()) await page.keyboard.press("Escape");
  const handle = page.locator('[data-dag-item="c"] [data-dag-connect="e"]');
  await expect(handle).toBeVisible();
  const h = (await handle.boundingBox())!;
  const to = await centreOf(page, '[data-dag-node="tri"]');
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move((h.x + to.x) / 2, (h.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(read).toContain("c --> t.tri");

  /* Where the drawn line ends, on the screen, against where the triangle's left side is. */
  const line = page.locator(".dag-board-edges [data-dag-edge] .dag-edge-line");
  await expect(line).toHaveCount(1);
  const end = await line.evaluate((p: SVGPathElement) => {
    const at = p.getPointAtLength(p.getTotalLength());
    const m = p.getScreenCTM()!;
    return { x: at.x * m.a + m.e, y: at.y * m.d + m.f };
  });
  const tri = (await page.locator('[data-dag-node="tri"]').boundingBox())!;
  /* The left side at the height the line arrives at: the apex is at the top centre and the base
     corner at the bottom left, so the side is `w/2 · (1 − (y − top)/h)` in from the box. */
  const side = tri.x + (tri.width / 2) * (1 - (end.y - tri.y) / tri.height);
  expect(Math.abs(end.x - side)).toBeLessThan(3);
  /* And not the box's own edge, which is where a card's line would have stopped. */
  expect(end.x - tri.x).toBeGreaterThan(10);
});

/*
 * A lone shape picked out of its item and dragged used to write the shape's own `x=`/`y=`, and
 * the frame — which started at the file's `0,0` — grew around the gap: a cylinder dragged right
 * sat at the far end of an empty rectangle three times its size, and one dragged left did not
 * move at all. One card is the item, so the press moves the item, and the frame stays the shape.
 */
test("dragging a picked lone shape moves the item and leaves the shape's line alone", async ({ page }) => {
  await open(page);
  const shape = page.locator('[data-dag-node="round"]');
  const at = await centreOf(page, '[data-dag-node="round"]');
  await page.mouse.click(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect(shape).toHaveAttribute("data-dag-picked", "");

  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 120, at.y + 40, { steps: 6 });
  await page.mouse.move(at.x + 240, at.y + 80, { steps: 6 });
  await page.mouse.up();

  await expect.poll(read).toMatch(/```sketch \{#c x=240 y=80\}\ncircle round "Circle"\n/);
  /* The frame still hugs the shape: its padding and nothing else. */
  const frame = (await page.locator('[data-dag-item="c"]').boundingBox())!;
  const drawn = (await shape.boundingBox())!;
  expect(frame.width - drawn.width).toBeLessThan(40);
  expect(drawn.x - frame.x).toBeLessThan(20);
});

/*
 * The same defect with two shapes, where the item cannot simply move: the leftmost one dragged
 * right used to leave an empty strip, and one dragged out past the left used to shove its
 * neighbour. The frame hugs the drawing, and the fence moves by however far its corner went.
 */
test("the leftmost of two shapes dragged right leaves no empty strip, and its neighbour stays put", async ({ page }) => {
  fs.writeFileSync(
    file,
    `\`\`\`sketch {#pair x=0 y=0}\nbox a "A" x=0 y=0 w=160 h=80\nbox b "B" x=320 y=160 w=160 h=80\n\`\`\`\n`,
  );
  await open(page);
  const b0 = (await page.locator('[data-dag-node="b"]').boundingBox())!;
  const at = await centreOf(page, '[data-dag-node="a"]');
  await page.mouse.click(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 200, at.y + 40, { steps: 6 });
  await page.mouse.move(at.x + 400, at.y + 80, { steps: 6 });
  await page.mouse.up();

  await expect.poll(read).toMatch(/box a "A" w=160 h=80 x=400 y=80/);
  /* The corner is now b's left edge and a's new top, so the fence moved 320 right and 80 down. */
  expect(read()).toMatch(/```sketch \{#pair x=320 y=80\}/);
  await expect.poll(async () => (await page.locator('[data-dag-node="b"]').boundingBox())!.x).toBeCloseTo(b0.x, 0);
  expect((await page.locator('[data-dag-node="b"]').boundingBox())!.y).toBeCloseTo(b0.y, 0);
  const frame = (await page.locator('[data-dag-item="pair"]').boundingBox())!;
  expect((await page.locator('[data-dag-node="b"]').boundingBox())!.x - frame.x).toBeLessThan(20);
});

/* A label into a shape was laid out again by Chromium at every zoom, hinted to the screen,
   and that layout was often never painted — the label kept its box and drew nothing. Whether a
   paint is missed depends on the build and the moment, so what is held here is the cause: a label
   is one width on the board whatever the zoom, which is what `text-rendering: geometricPrecision`
   in `nodes.css` buys. Without it this label measured 210 to 239 board pixels across five zooms. */
test("an edge label into a shape is one width at every zoom, and is drawn", async ({ page }) => {
  fs.writeFileSync(
    file,
    `\`\`\`sketch {#ring x=0 y=0}\ncircle a "A" x=0 y=0 w=96 h=96\ncircle b "B" x=440 y=0 w=96 h=96\na --> b "circle to circle"\n\`\`\`\n`,
  );
  await open(page);
  const label = page.locator('[data-dag-item="ring"] [data-dag-edge-label]');
  await expect(label).toHaveText("circle to circle");
  const onBoard = () =>
    label.evaluate((t) => t.getBoundingClientRect().width / Number(t.closest<HTMLElement>(".dag-viewport")!.dataset.zoom));
  const at1 = await onBoard();
  const widths: number[] = [];
  for (const key of ["=", "=", "-", "-", "-"]) {
    const before = await page.locator(".dag-viewport").getAttribute("data-zoom");
    await page.keyboard.press(key);
    await expect(page.locator(".dag-viewport")).not.toHaveAttribute("data-zoom", before!);
    widths.push(await onBoard());
  }
  for (const w of widths) expect(Math.abs(w - at1)).toBeLessThan(0.5);
});
