import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { lead } from "./keys";
import { BOARDS } from "./boards";

/**
 * The pen.
 *
 * "Pick up a pen from the toolbar, draw with the mouse, let go — and the stroke becomes a thing on
 * the board like any other." Everything about a stroke *after* it exists is inherited from `sketch`
 * and is already held elsewhere; what is held here is the part that is the pen's own, and every one
 * of these is a claim no unit test can make, because the gesture is the subject.
 *
 * The third check is the one that earned this file. Every unit test, both typechecks and all four
 * `check:*` scripts passed while the pen selected each stroke it drew — which put eight resize
 * handles, four connect handles and the selection bar over the drawing after every stroke, none of
 * them clickable because the pen makes items `pointer-events: none`, and which cost the Escape
 * chain its meaning. Only a browser could see it.
 */

const DIR = BOARDS;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-pen-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, "# Pen\n");
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

/** At zoom 1, so a pointer's pixels are the board's — and the epsilon is the one the pen meant. */
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

/** An arc, drawn as a pointer draws one: many samples, most of them saying nothing. */
async function draw(page: Page, x: number, y: number, dx = 240, samples = 40) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    await page.mouse.move(x + t * dx, y - Math.sin(t * Math.PI) * 100);
  }
  await page.mouse.up();
}

test("the pen draws a stroke, and the stroke is an item in the file", async ({ page }) => {
  await open(page);
  await lead(page, "b");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-tool", "pen");

  await draw(page, 600, 500);
  await expect(page.locator('[data-dag-kind="ink"]')).toHaveCount(1);

  const text = read();
  expect(text).toMatch(/```sketch \{#[^}]*\}\n\s*ink \w+ pts="[-\d, ]+"/);

  /* Simplified, not stored raw: forty-one samples are a handful of points. */
  const pts = text.match(/pts="([^"]*)"/)![1]!.split(" ");
  expect(pts.length).toBeGreaterThan(2);
  expect(pts.length).toBeLessThan(20);
  /* Whole numbers, and normalised so the minimum is 0,0 — the position is on `x=`/`y=`. */
  for (const p of pts) expect(p).toMatch(/^-?\d+,-?\d+$/);
  expect(Math.min(...pts.map((p) => Number(p.split(",")[0])))).toBe(0);
  expect(Math.min(...pts.map((p) => Number(p.split(",")[1])))).toBe(0);
  /* A path the browser can actually draw. CLAUDE.md: a NaN in a `d` draws nothing and names nothing. */
  expect(await page.locator('[data-dag-kind="ink"] path').getAttribute("d")).not.toContain("NaN");
});

test("the pen stays armed, and one Escape puts it down", async ({ page }) => {
  await open(page);
  await lead(page, "b");

  await draw(page, 500, 400, 200);
  await expect(page.locator('[data-dag-kind="ink"]')).toHaveCount(1);
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-tool", "pen");

  await draw(page, 500, 700, 200);
  await expect(page.locator('[data-dag-kind="ink"]')).toHaveCount(2);
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-tool", "pen");

  /* One, not two. The stroke is deliberately not selected, so there is nothing inner to let go of
     first — which is the whole reason the pen's `insert` passes `select: false`. */
  await page.keyboard.press("Escape");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-tool", "select");
});

test("a drawn stroke is not selected, so the pen is never drawing under its own handles", async ({ page }) => {
  await open(page);
  await lead(page, "b");
  await draw(page, 600, 500);
  await expect(page.locator('[data-dag-kind="ink"]')).toHaveCount(1);

  await expect(page.locator("[data-dag-selected]")).toHaveCount(0);
  await expect(page.locator("[data-dag-handle]")).toHaveCount(0);
  await expect(page.locator("[data-dag-selbar]")).toHaveCount(0);
});

test("moving a stroke rewrites its x and y and never its path", async ({ page }) => {
  await open(page);
  await lead(page, "b");
  await draw(page, 600, 500);
  await expect(page.locator('[data-dag-kind="ink"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-tool", "select");

  const before = read();
  const ptsBefore = before.match(/pts="([^"]*)"/)![1];
  const box = (await page.locator('[data-dag-kind="ink"]').boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 96, { steps: 12 });
  await page.mouse.up();

  /* The point of the whole data shape: a drag is a two-number diff, whatever the stroke holds. */
  await expect(async () => {
    const after = read();
    expect(after).not.toBe(before);
    expect(after.match(/pts="([^"]*)"/)![1]).toBe(ptsBefore);
  }).toPass();
});

test("a stray click with the pen up leaves nothing behind", async ({ page }) => {
  await open(page);
  await lead(page, "b");
  await page.mouse.click(700, 500);
  await page.waitForTimeout(400);
  await expect(page.locator('[data-dag-kind="ink"]')).toHaveCount(0);
  expect(read()).not.toContain("ink");
});
