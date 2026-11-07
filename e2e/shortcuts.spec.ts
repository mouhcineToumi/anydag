import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BINDINGS, LEADER_CODE, WHICHKEY_MS } from "../src/edit/bindings";
import { lead } from "./keys";
import { BOARDS } from "./boards";

/**
 * The leader key.
 *
 * Every other spec in here presses `lead(page, "l")` and cares only that the library opened; this
 * one is about the chord itself, and it is the only place the awkward halves are checked. Three of
 * them are worth naming, because each is a defect that got as far as a browser:
 *
 * - **The leader is also the pan modifier.** They share a key and are told apart by the pointer, so
 *   a pan must leave no chord behind. Nothing else on the board tests a gesture for what it did
 *   *not* also do.
 * - **A held key repeats.** Auto-repeat starts about half a second in, which is *after* the overlay
 *   appears — so a naive handler shows the set and takes it away again while the key is still down.
 *   That is why the long-hold check waits well past the repeat delay rather than just past
 *   `WHICHKEY_MS`.
 * - **A bare letter must now do nothing.** Asserting an absence is the weakest kind of check, so it
 *   is made against a surface this file proves it can see: the same locator opens under a chord two
 *   lines earlier.
 *
 * One board per test, because the suite runs in parallel and the canvas writes to disk.
 */

const DIR = BOARDS;

const BOARD = `---
title: Chords
---

\`\`\`md {#one x=40 y=40}
Something to look at.
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
  /* A click on the paper, so focus is on the board and not on whatever the page loaded with —
     `typing()` skips the whole chain for a focused BUTTON, which a fresh tab can land on. */
  const vp = (await page.locator(".dag-viewport").boundingBox())!;
  await page.mouse.click(vp.x + vp.width - 60, vp.y + vp.height - 60);
}

const library = (page: Page) => page.locator("[data-dag-library]");
const whichKey = (page: Page) => page.locator("[data-dag-whichkey]");

test("a tap on the leader, then a letter, runs the command", async ({ page }) => {
  await open(page);
  await expect(library(page)).toHaveCount(0);
  await lead(page, "l");
  await expect(library(page)).toBeVisible();
});

test("the leader held, with the letter pressed under it, runs the same command", async ({ page }) => {
  await open(page);
  await page.keyboard.down(LEADER_CODE);
  await page.keyboard.press("l");
  await page.keyboard.up(LEADER_CODE);
  await expect(library(page)).toBeVisible();
});

test("the leader survives being held past the keyboard's repeat delay", async ({ page }) => {
  await open(page);
  await page.keyboard.down(LEADER_CODE);
  /* Past `WHICHKEY_MS` so the strip is up, then well past any repeat delay: a repeat read as a
     second press would take the chord back with the key still down. */
  await expect(whichKey(page)).toBeVisible();
  await page.waitForTimeout(900);
  await expect(whichKey(page)).toBeVisible();
  await page.keyboard.press("l");
  await page.keyboard.up(LEADER_CODE);
  await expect(library(page)).toBeVisible();
});

test("the bare letters no longer do anything on their own", async ({ page }) => {
  await open(page);
  /* Proven visible under a chord first, then taken away again, so the absence below is an absence
     this locator can actually see — the `[data-dag-error]` lesson, asserted rather than assumed. */
  await lead(page, "l");
  await expect(library(page)).toBeVisible();
  await lead(page, "l");
  await expect(library(page)).toHaveCount(0);

  await page.keyboard.press("l");
  await page.keyboard.press("t");
  await page.keyboard.press("k");
  await expect(library(page)).toHaveCount(0);
  /* `t` and `k` write to the file when they land, so the bytes are the other half of the answer. */
  expect(read()).toBe(BOARD);
});

test("a bare n no longer makes a note, and the chord still does", async ({ page }) => {
  await open(page);
  await page.keyboard.press("n");
  await expect(page.locator("[data-dag-inspector]")).toHaveCount(0);
  expect(read()).toBe(BOARD);

  await lead(page, "n");
  await expect.poll(read, { timeout: 5_000 }).toMatch(/```md \{#md-[a-z0-9]{4} x=-?\d+ y=-?\d+\}\nNew note\n```/);
});

test("the overlay is silent at once and names the set after the pause", async ({ page }) => {
  await open(page);
  await page.keyboard.press(LEADER_CODE);
  /* Checked before the timer can have fired. `toHaveCount(0)` rather than `toBeHidden`, because
     the strip is not rendered at all until then — there is no element to be hidden. */
  expect(await whichKey(page).count()).toBe(0);
  await expect(whichKey(page)).toBeVisible({ timeout: WHICHKEY_MS + 2_000 });
  await expect(page.locator("[data-dag-whichkey-key]")).toHaveCount(BINDINGS.length);
});

test("Escape lets go of a chord before anything else, and the letter after it is inert", async ({ page }) => {
  await open(page);
  await page.keyboard.press(LEADER_CODE);
  await expect(whichKey(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(whichKey(page)).toHaveCount(0);
  await page.keyboard.press("l");
  await expect(library(page)).toHaveCount(0);
});

test("a key that is not a binding closes the chord and does nothing", async ({ page }) => {
  await open(page);
  await page.keyboard.press(LEADER_CODE);
  await expect(whichKey(page)).toBeVisible();
  await page.keyboard.press("q");
  await expect(whichKey(page)).toHaveCount(0);
  expect(read()).toBe(BOARD);
});

test("a second tap on the leader takes the chord back", async ({ page }) => {
  await open(page);
  await page.keyboard.press(LEADER_CODE);
  await expect(whichKey(page)).toBeVisible();
  await page.keyboard.press(LEADER_CODE);
  await expect(whichKey(page)).toHaveCount(0);
});

test("space-drag still pans, and the pan takes the chord with it", async ({ page }) => {
  await open(page);
  const layer = () => page.locator(".dag-layer").evaluate((el) => getComputedStyle(el).transform);
  const before = await layer();
  const vp = (await page.locator(".dag-viewport").boundingBox())!;

  await page.keyboard.down(LEADER_CODE);
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
  await page.mouse.down();
  await page.mouse.move(vp.x + vp.width / 2 + 160, vp.y + vp.height / 2 + 90, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up(LEADER_CODE);

  await expect.poll(layer).not.toBe(before);
  /* The chord the pan opened must be gone, or every pan would leave one armed behind it. */
  await expect(whichKey(page)).toHaveCount(0);
  await page.keyboard.press("l");
  await expect(library(page)).toHaveCount(0);
});

test("the sheet prints the whole table, and is itself reached by a chord", async ({ page }) => {
  await open(page);
  await lead(page, "?");
  await expect(page.locator("[data-dag-shortcuts]")).toBeVisible();
  for (const b of BINDINGS) {
    await expect(page.locator(".dag-shortcuts__row", { hasText: b.label })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-shortcuts]")).toHaveCount(0);
});
