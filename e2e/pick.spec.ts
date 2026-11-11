import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";

/**
 * F1: picking a thing *inside* a diagram.
 *
 * Until now the pointer could reach an item and nothing in one — a card was 27 kinds of `<div>`
 * with no handler on any of them, and everything a card says had to be typed into the fence. What
 * is checked here is the whole of the new gesture and what it makes possible: the second click
 * picks, the pick is its own thing rather than part of the selection, and Delete, ctrl+D and the
 * properties strip all act on it and land in the board file.
 *
 * Every check that can read the bytes reads them, for the reason `select.spec.ts` gives. The two
 * that cannot — the ring, and which half of the panel is showing — are read off the page, because
 * that is where they live.
 *
 * One board per test: the suite runs in parallel and these write to disk.
 */

const DIR = BOARDS;

const BOARD = `---
title: Pick me
---

\`\`\`arch {#infra x=0 y=0 title="Infra"}
service api "The API" icon=server
store db "Database" icon=database

api --> db "reads"
\`\`\`

\`\`\`md {#note x=0 y=560 w=200}
A note.
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-pick-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page, query = "") {
  await page.goto(`/?board=${name}${query}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/**
 * A click that cannot be read as half of a double-click.
 *
 * Chromium pairs two presses at the same point within its own interval, and a `dblclick` on a card
 * opens the panel — which is a different feature answering the same gesture. The pause is what
 * keeps "click, then click again" the thing being tested.
 */
async function tap(page: Page, selector: string) {
  await page.locator(selector).click();
  await page.waitForTimeout(400);
}

const selectedIds = (page: Page) =>
  page.locator("[data-dag-selected]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.dagItem));

const pickedNodes = (page: Page) =>
  page.locator("[data-dag-node][data-dag-picked]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.dagNode));

/* ------------------------------------------------------------------------------ the gesture */

test("the first click takes the diagram and the second picks the card out of it", { tag: "@smoke" }, async ({ page }) => {
  await open(page);

  await tap(page, '[data-dag-node="api"]');
  expect(await selectedIds(page)).toEqual(["infra"]);
  expect(await pickedNodes(page)).toEqual([]);

  await tap(page, '[data-dag-node="api"]');
  expect(await pickedNodes(page)).toEqual(["api"]);
  /* The pick is not part of the selection: the diagram is still the selected item, and the
     toolbar still offers what one item can do. */
  expect(await selectedIds(page)).toEqual(["infra"]);
  await expect(page.locator("[data-dag-selbar-edit]")).toHaveCount(1);

  /* A third click on the other card moves the pick without touching the selection. */
  await tap(page, '[data-dag-node="db"]');
  expect(await pickedNodes(page)).toEqual(["db"]);
  expect(await selectedIds(page)).toEqual(["infra"]);

  /* And none of it wrote anything: picking is not an edit. */
  expect(read()).toBe(BOARD);
});

test("the handles sit on the picked card, framed or not", async ({ page }) => {
  /* The board here is framed (`title="Infra"`), which is the case that was wrong: the frame's body
     started 23px above where `theme.metric.frame.bodyTop` said it did, so every handle — and every
     board link into a framed card, since M25 — sat 23px below the card it belonged to. The offset
     is derived from what the frame draws now; this holds the two together on both kinds of frame. */
  await open(page);
  const fit = async (node: string) => {
    await tap(page, `[data-dag-node="${node}"]`);
    await tap(page, `[data-dag-node="${node}"]`);
    expect(await pickedNodes(page)).toEqual([node]);
    return page.evaluate((id) => {
      const card = document.querySelector(`[data-dag-node="${id}"]`)!.getBoundingClientRect();
      const tools = document.querySelector("[data-dag-node-tools]")!.getBoundingClientRect();
      return [tools.x - card.x, tools.y - card.y, tools.width - card.width, tools.height - card.height].map(
        (v) => Math.round(v * 10) / 10,
      );
    }, node);
  };
  expect(await fit("api")).toEqual([0, 0, 0, 0]);

  /* Take the title away and the same card is drawn bare — a different top padding, the same answer. */
  fs.writeFileSync(file, BOARD.replace(' title="Infra"', ""));
  await page.waitForFunction(() => !document.querySelector('[data-dag-item="infra"] .dag-frame__head'), null, {
    timeout: 10_000,
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  expect(await fit("db")).toEqual([0, 0, 0, 0]);
});

test("escape lets go of the pick first, and the selection second", async ({ page }) => {
  await open(page);
  await tap(page, '[data-dag-node="api"]');
  await tap(page, '[data-dag-node="api"]');
  expect(await pickedNodes(page)).toEqual(["api"]);

  await page.keyboard.press("Escape");
  expect(await pickedNodes(page)).toEqual([]);
  expect(await selectedIds(page)).toEqual(["infra"]);

  await page.keyboard.press("Escape");
  expect(await selectedIds(page)).toEqual([]);
});

test("a click on the paper lets go of both", async ({ page }) => {
  await open(page);
  await tap(page, '[data-dag-node="api"]');
  await tap(page, '[data-dag-node="api"]');

  const vp = (await page.locator(".dag-viewport").boundingBox())!;
  await page.mouse.click(vp.x + 20, vp.y + vp.height - 20);
  expect(await pickedNodes(page)).toEqual([]);
  expect(await selectedIds(page)).toEqual([]);
});

/* -------------------------------------------------------------------------------- the keys */

test("delete takes the picked card out, and every edge that named it", async ({ page }) => {
  await open(page);
  await tap(page, '[data-dag-node="db"]');
  await tap(page, '[data-dag-node="db"]');
  await page.keyboard.press("Delete");

  await expect.poll(read, { timeout: 5_000 }).not.toContain('store db "Database"');
  const now = read();
  /* The edge goes with it. Without that the author is handed `E_UNKNOWN_ID` on a line they never
     touched, which is the worst kind of error there is. */
  expect(now).not.toContain("api --> db");
  expect(now).toContain('service api "The API" icon=server');
  /* The item itself is untouched — a picked card is not a selected item. */
  expect(now).toContain("```arch {#infra");
  await expect(page.locator('[data-dag-item="infra"]')).toHaveCount(1);
  expect(await pickedNodes(page)).toEqual([]);
});

test("ctrl+D copies the picked statement under a free id, and picks the copy", async ({ page }) => {
  await open(page);
  await tap(page, '[data-dag-node="api"]');
  await tap(page, '[data-dag-node="api"]');
  await page.keyboard.press("Control+d");

  await expect.poll(read, { timeout: 5_000 }).toContain('service api2 "The API" icon=server');
  /* One copy of the declaration, and no copy of the edge: `api --> db` is a statement about `api`. */
  expect(read().match(/api --> db/g)).toHaveLength(1);
  /* The new card is what is picked, so the next thing typed lands on the copy. */
  await expect(page.locator('[data-dag-node="api2"][data-dag-picked]')).toHaveCount(1);
  expect(await selectedIds(page)).toEqual(["infra"]);
});

test("a diagram's panel is its controls, with no Source tab and no text (#145)", async ({ page }) => {
  await open(page);
  await tap(page, '[data-dag-node="api"]');
  await tap(page, '[data-dag-node="api"]');
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-props]")).toHaveAttribute("data-dag-props", "api");
  await expect(page.locator("[data-dag-mode]")).toHaveCount(0);
  await expect(page.locator("[data-dag-body]")).toHaveCount(0);
  /* A preference left behind by the tab that is gone brings nothing back. */
  await page.evaluate(() => localStorage.setItem("dag:inspector-mode", "source"));
  await open(page);
  await tap(page, '[data-dag-item="infra"]');
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-inspector]")).toBeVisible();
  await expect(page.locator("[data-dag-mode]")).toHaveCount(0);
  await expect(page.locator("[data-dag-body]")).toHaveCount(0);
});

test("a note has no halves, and its text is written on the card", async ({ page }) => {
  await open(page);
  await tap(page, '[data-dag-item="note"]');
  /* Enter opens the text where it is drawn, as rich text (#145). */
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-dag-card-text="note"] [contenteditable="true"]')).toHaveText("A note.");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-card-text]")).toHaveCount(0);
  /* The panel holds its settings, and no Markdown: the way to the text is the card. */
  await page.locator("[data-dag-selbar-edit]").click();
  await expect(page.locator("[data-dag-mode]")).toHaveCount(0);
  await expect(page.locator("[data-dag-body]")).toHaveCount(0);
  await page.locator("[data-dag-write-card]").click();
  await expect(page.locator('[data-dag-card-text="note"] [contenteditable="true"]')).toBeFocused();
  await expect(page.locator("[data-dag-inspector]")).toHaveCount(0);
});

/* -------------------------------------------------------------------------------- the edges */

test("an edge inside a diagram is picked by its line and deleted with it", async ({ page }) => {
  await open(page);
  const hit = page.locator('[data-dag-item="infra"] .dag-edge-hit');
  await expect(hit).toHaveCount(1);
  await hit.click({ force: true });

  await expect(page.locator('[data-dag-item="infra"] [data-dag-edge][data-dag-picked]')).toHaveCount(1);
  /* Picking the line works on the diagram it is in, so that diagram is what is selected. */
  expect(await selectedIds(page)).toEqual(["infra"]);

  await page.keyboard.press("Delete");
  await expect.poll(read, { timeout: 5_000 }).not.toContain("api --> db");
  /* Only the statement: both cards it named are still there. */
  const now = read();
  expect(now).toContain('service api "The API"');
  expect(now).toContain('store db "Database"');
});

test("a picked edge offers its label, and the label lands on that segment", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="infra"] .dag-edge-hit').click({ force: true });
  await page.keyboard.press("Enter");

  const label = page.locator("[data-dag-prop-label]");
  await expect(label).toHaveValue("reads");
  await label.fill("writes");
  await label.blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('api --> db "writes"');
});

test("a photographed board has no hit strokes to click", async ({ page }) => {
  await open(page, "&snapshot=1");
  await expect(page.locator(".dag-edge-hit")).toHaveCount(0);
});
