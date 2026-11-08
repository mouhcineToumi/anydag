import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BINDINGS } from "../src/edit/bindings";
import { openMore } from "./more";
import { BOARDS } from "./boards";

/**
 * The dock.
 *
 * Four things are held: **nothing on the dock wears a text label**, the rare half is
 * **behind one button**, the zoom figure is **live**, and a picture of a board is still a picture
 * of a board. The last one is what let the rest of this change be made without fuss —
 * `?snapshot=1` strips the chrome, so none of this can move one of
 * the 45 reference baselines — and it is worth a check precisely because it is what everything
 * else was allowed to assume.
 *
 * The tooltips are the other half. Since the labels went, the tooltip is the only place a control's
 * name or key is written down, so it is the only thing making the chords discoverable — which is
 * why it reads `BINDINGS` rather than restating it, and why that is checked here against the table
 * itself rather than against a string typed into this file twice.
 */

const DIR = BOARDS;

const BOARD = `---
title: Dock me
---

\`\`\`md {#a x=0 y=0 w=200}
A
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-dock-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

async function open(page: Page, query = "") {
  await page.goto(`/?board=${name}${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

test("nothing on the dock wears a text label, and every control names its chord", async ({ page }) => {
  await open(page);
  const dock = page.locator("[data-dag-dock]");
  await expect(dock).toBeVisible();

  /* The whole point: six buttons used to carry a word apiece. `⋯` is a glyph, not a
     label, and the zoom figure is in its own cluster — so the dock itself should read as empty. */
  expect((await dock.innerText()).replace(/\s+/g, "")).toBe("");

  /* Each tool's tooltip carries the chord the table says it has, so the two cannot drift. */
  for (const [label, command] of [
    ["Select", "select"],
    ["Hand", "hand"],
    ["Pen", "pen"],
  ] as const) {
    const key = BINDINGS.find((b) => b.command === command)!.key.toUpperCase();
    await expect(dock.getByRole("radio", { name: `${label} (Space ${key})` })).toBeVisible();
  }
});

test("the rare half is behind the ⋯, and Escape puts it away", async ({ page }) => {
  await open(page);
  /* Absent until asked for — that is what "behind an overflow" has to mean to be worth anything. */
  for (const hook of ["data-dag-links", "data-dag-keep", "data-dag-import", "data-dag-help"]) {
    await expect(page.locator(`[${hook}]`)).toHaveCount(0);
  }

  await openMore(page);
  for (const hook of ["data-dag-links", "data-dag-keep", "data-dag-import", "data-dag-help"]) {
    await expect(page.locator(`[${hook}]`)).toHaveCount(1);
  }
  /* Export sits in the top bar, not in the `⋯` — in one place, not two. */
  await expect(page.locator("[data-dag-more-menu] [data-dag-export], [data-dag-more-menu] [data-dag-export-as]")).toHaveCount(0);
  await expect(page.locator(".dag-toolbar [data-dag-export]")).toHaveCount(1);
  /* Settings sits at the sidebar's foot, not in the `⋯`: the dock is this
     board, the sidebar is the app. */
  await expect(page.locator("[data-dag-more-menu] [data-dag-settings-toggle]")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-more-menu]")).toHaveCount(0);
});

test("the zoom figure follows the board, and the percentage is a button back to 100%", async ({ page }) => {
  await open(page);
  const pct = page.locator("[data-dag-zoom-actual]");
  await expect(pct).toBeVisible();

  /* It arrives on a `dag:zoom` event rather than as state, so the check that matters is that it
     moved at all — a figure wired to nothing would sit at whatever it first rendered. The board
     opens at 100% (the automatic fit never magnifies), so either step moves it. */
  const first = await pct.innerText();
  await page.locator("[data-dag-zoombar] button[aria-label^='Zoom out']").click();
  await expect(pct).not.toHaveText(first);

  await pct.click();
  await expect(pct).toHaveText("100%");
});

test("a snapshot has no dock, no zoom and no bar — which is what keeps the baselines honest", async ({ page }) => {
  await open(page, "&snapshot=1");
  for (const sel of ["[data-dag-dock]", "[data-dag-zoombar]", "[data-dag-more]", ".dag-toolbar"]) {
    await expect(page.locator(sel)).toHaveCount(0);
  }
});
