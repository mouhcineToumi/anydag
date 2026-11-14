import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { vaulted } from "./vault";

/**
 * The Assistant panel's left edge: a drag, the arrow keys, and the preference a reload reads.
 *
 * The panel is a chunk of the shell (`src/assistant/Panel.tsx`) and a column of the window rather
 * than a page, so these checks open it over the Tasks page: no board fixture, no canvas, and the
 * `.dag-app` beside it is still one flex child whose width is the reflow being measured. The last
 * one is on a board, because the hazard it holds is the board's keys. It does not need the scripted
 * harness — resizing runs no model.
 */

const panelOf = (page: Page) => page.locator("[data-dag-assistant-panel]");
const gripOf = (page: Page) => page.locator("[data-dag-assistant-grip]");

const widthOf = async (page: Page, selector: string): Promise<number> =>
  Math.round((await page.locator(selector).boundingBox())!.width);

/** The default and the range, named here rather than imported from `src/`. */
const DEFAULT_W = 380;
const MIN_W = 320;
const MAX_W = 720;

async function open(page: Page): Promise<void> {
  await page.goto(await vaulted(page, "/?tasks=1"));
  await page.locator("[data-dag-assistant-toggle]").click();
  const panel = panelOf(page);
  await expect(panel).toBeVisible();
  /* The composer focuses itself when the panel arrives; the grip is reached after it, so a late
     autofocus cannot take the keyboard half away between two checks. */
  await expect(panel.locator("[data-dag-chat-input]")).toBeVisible({ timeout: 15_000 });
}

/** Press the grip's edge and move it `dx` pixels: negative is wider, because the panel is on the right. */
async function pull(page: Page, dx: number, steps = 5): Promise<void> {
  const box = (await gripOf(page).boundingBox())!;
  const at = box.x + box.width / 2;
  const y = box.y + 200;
  await page.mouse.move(at, y);
  await page.mouse.down();
  await page.mouse.move(at + dx, y, { steps });
}

const width = (page: Page) => widthOf(page, "[data-dag-assistant-panel]");

test("the edge drags the panel, the page beside gives way live, and a reload remembers it", async ({ page }) => {
  await open(page);
  expect(await width(page)).toBe(DEFAULT_W);
  /* The target is a finger's, not the hairline drawn on the border. */
  expect(await widthOf(page, "[data-dag-assistant-grip]")).toBeGreaterThanOrEqual(24);

  const pageBefore = await widthOf(page, ".dag-app");
  await pull(page, -120);
  /* Before the release: the panel has followed the pointer and the page has already given way. */
  await expect.poll(() => width(page)).toBe(DEFAULT_W + 120);
  await expect.poll(() => widthOf(page, ".dag-app")).toBe(pageBefore - 120);
  await page.mouse.up();
  await expect.poll(() => width(page)).toBe(DEFAULT_W + 120);

  /* The width survives a reload — the panel's open state does not, so it is opened again. */
  await page.reload();
  await open(page);
  await expect.poll(() => width(page)).toBe(DEFAULT_W + 120);

  /* A double-click on the edge puts it back, and the default is what is remembered too. */
  await gripOf(page).dblclick();
  await expect.poll(() => width(page)).toBe(DEFAULT_W);
  await page.reload();
  await open(page);
  await expect.poll(() => width(page)).toBe(DEFAULT_W);
});

test("a drag stops at the bounds, and the page beside it keeps the rest of the window", async ({ page }) => {
  await open(page);
  await pull(page, 200);
  /* The floor, reached while the pointer is still down. */
  await expect.poll(() => width(page)).toBe(MIN_W);
  await page.mouse.up();

  await pull(page, -800);
  await expect.poll(() => width(page)).toBe(MAX_W);
  await page.mouse.up();
  /* Half the window is at least the page's; 1600 - 720 leaves it plenty. */
  expect(await widthOf(page, ".dag-app")).toBe(1600 - MAX_W);
});

test("the edge is a focusable separator the arrow keys move, remembered like a drag", async ({ page }) => {
  await open(page);
  const grip = gripOf(page);
  await expect(grip).toHaveAttribute("role", "separator");
  await expect(grip).toHaveAttribute("aria-orientation", "vertical");
  await grip.focus();
  await expect(grip).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => width(page)).toBe(DEFAULT_W + 16);
  await expect(grip).toHaveAttribute("aria-valuenow", String(DEFAULT_W + 16));
  /* Shift takes a longer step, and right is narrower. */
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(() => width(page)).toBe(DEFAULT_W + 64 + 16);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => width(page)).toBe(DEFAULT_W + 64);

  await page.reload();
  await open(page);
  await expect.poll(() => width(page)).toBe(DEFAULT_W + 64);

  /* Held at the floor, the keys stop where the drag does. */
  await gripOf(page).focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(() => width(page)).toBe(MIN_W);
  await expect(gripOf(page)).toHaveAttribute("aria-valuenow", String(MIN_W));
});

/** One card, so a board has something selected while the grip's keys are pressed. */
const BOARD = `---
title: Assistant panel keys
---

\`\`\`md {#card x=0 y=0 w=320}
A card.
\`\`\`
`;

test("an arrow at the grip moves the panel's edge, not a selected card", async ({ page }, info) => {
  const stem = `e2e-assistant-panel-${info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  const dir = path.join(BOARDS, stem);
  const file = path.join(dir, "plan.board.md");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, BOARD);
  try {
    await page.goto(await vaulted(page, `/?board=${stem}/plan`));
    const card = page.locator('[data-dag-item="card"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.click();
    await expect(card).toHaveAttribute("data-dag-selected", "");

    await page.locator("[data-dag-assistant-toggle]").click();
    await expect(panelOf(page)).toBeVisible();
    await expect(panelOf(page).locator("[data-dag-chat-input]")).toBeVisible({ timeout: 15_000 });
    await gripOf(page).focus();
    await page.keyboard.press("ArrowLeft");
    /* `useEditor`'s capture handler would nudge the selected card and stop the key at the window, so
       the width moving at all is the proof that it left this grip's arrows alone. */
    await expect.poll(() => width(page)).toBe(DEFAULT_W + 16);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
