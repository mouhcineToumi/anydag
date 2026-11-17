import fs from "node:fs";
import path from "node:path";

import { BINDINGS } from "../src/edit/bindings";
import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";
import { lead } from "./keys";
import { openMore } from "./more";

/**
 * The dock.
 *
 * Five things are held: **nothing on the dock wears a text label**, the rare half is
 * **behind one button**, the zoom figure is **live**, the two bars **never sit on each other when
 * the canvas is narrow** (#395), and a picture of a board is still a picture
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

  /* The drawn tooltip replaced the native one; a `title` left behind would draw both. */
  await expect(dock.locator("button[title]")).toHaveCount(0);
});

test("a hover or a focus draws the tooltip, and leave, Escape and blur put it away", async ({ page }) => {
  await open(page);
  const dock = page.locator("[data-dag-dock]");
  const select = dock.getByRole("radio", { name: /^Select/ });
  const tidy = page.locator("[data-dag-tidy]");
  const tip = page.locator("[data-dag-tip]");

  await expect(tip).toHaveCount(0);

  /* Hover: the tooltip is drawn, names the control, carries the chord, and opens upward without
     leaving the window. The dock sits at the bottom, so every one of those is checkable. */
  await select.hover();
  await expect(tip).toBeVisible();
  const key = BINDINGS.find((b) => b.command === "select")!.key.toUpperCase();
  await expect(tip).toContainText("Select");
  await expect(tip).toContainText(`(Space ${key})`);

  const box = (await tip.boundingBox())!;
  const control = (await select.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.y + box.height).toBeLessThanOrEqual(control.y);

  /* A different control says a different thing, so the text is the control's and not one bubble
     left standing for the whole dock. */
  await tidy.hover();
  await expect(tip).toContainText("Tidy up");

  await page.mouse.move(0, 0);
  await expect(tip).toHaveCount(0);

  /* Keyboard focus opens it too. */
  await select.focus();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Select");
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);

  /* And blur dismisses it. Blurred explicitly rather than by Tab: Tab lands on Hand, whose own
     tooltip would be due 400 ms later and could race the assertion. */
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await select.focus();
  await expect(tip).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(tip).toHaveCount(0);
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

/*
 * The two bars at the foot of the drawing.
 *
 * The dock is centred on the canvas and the zoom cluster is pinned to its right edge, and neither
 * rule can see the other's width — so with the library open on an 800×700 window their boxes
 * intersect, and the cluster, later in the DOM on the same layer, took every press aimed at the
 * dock's last controls: `elementFromPoint` answered with the cluster at the centre of all nine of
 * them (#395). The check is the defect's own: every control has to answer its own centre, and the
 * two boxes must not touch.
 */
test("the zoom cluster never covers the dock, and every control answers its own centre", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await open(page);

  /* The library takes 272px off the drawing, which is the canvas width at which QA found the
     overlap: the dock at its middle reached the cluster at its right edge by 68px. */
  await lead(page, "l");
  await expect(page.locator("[data-dag-library]")).toBeVisible();

  const boxes = () =>
    page.evaluate(() => {
      const read = (sel: string) => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      return { dock: read("[data-dag-dock]"), zoom: read("[data-dag-zoombar]"), canvas: read(".dag-viewport") };
    });
  type Box = { x: number; y: number; w: number; h: number };
  const apart = (a: Box, b: Box) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

  /* Every control, not a sample: the defect covered the last two, and the QA pass measured all
     nine because a wrong stacking answer is not a bug about two buttons. */
  const covered = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-dag-dock] button"))
        .filter((b) => {
          const r = b.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !hit || !b.contains(hit);
        })
        .map((b) => b.getAttribute("aria-label") ?? "a control with no name"),
    );
  await expect.poll(covered, { timeout: 5_000 }).toEqual([]);

  const narrow = await boxes();
  expect(apart(narrow.dock, narrow.zoom)).toBe(true);
  /* Above it rather than beside it, because there is no room beside it. */
  expect(narrow.zoom.y + narrow.zoom.h).toBeLessThanOrEqual(narrow.dock.y);

  /* The worst case QA measured: the board list docked as well, which leaves the drawing narrower
     than the dock itself — the bar overflows the canvas on both sides and the cluster sits over its
     right end, not past it. This is where all nine controls were unclickable. */
  await page.locator("[data-dag-sidebar-toggle]").click();
  await expect.poll(async () => (await boxes()).canvas.w, { timeout: 5_000 }).toBeLessThan(400);
  await expect.poll(covered, { timeout: 5_000 }).toEqual([]);
  const narrowest = await boxes();
  expect(apart(narrowest.dock, narrowest.zoom)).toBe(true);

  /* And a real press lands on it: ⋯ was the control the cluster sat on. */
  await page.locator("[data-dag-more]").click();
  await expect(page.locator("[data-dag-more-menu]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-more-menu]")).toHaveCount(0);

  /* A window with room keeps the arrangement the design asks for: the dock at the drawing's middle,
     the cluster 12px inside its right edge, both on one row. */
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect
    .poll(
      async () => {
        const wide = await boxes();
        return (
          apart(wide.dock, wide.zoom) &&
          Math.abs(wide.zoom.y - wide.dock.y) < 1 &&
          Math.round(wide.canvas.x + wide.canvas.w - (wide.zoom.x + wide.zoom.w)) === 12 &&
          Math.abs(wide.dock.x + wide.dock.w / 2 - (wide.canvas.x + wide.canvas.w / 2)) <= 1
        );
      },
      { timeout: 5_000 },
    )
    .toBe(true);
});
