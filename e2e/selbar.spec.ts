import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * The selection toolbar: one row of icons over what is selected.
 *
 * It is chrome — a sibling of the viewport inside `.dag-body`, not inside the layer — so it does
 * not scale with the board, and its position is painted by the component rather than rendered.
 * What a check can hold is the geometry, measured off the same boxes a person sees: the toolbar is
 * above the selection, inside the canvas, and **never over a handle** — the bottom connect dot was
 * under it at almost every zoom, which is the check a screenshot of one zoom would miss.
 */

const DIR = BOARDS;

const BOARD = `---
title: Selbar me
---

\`\`\`md {#one x=400 y=400 w=280}
One.
\`\`\`

\`\`\`md {#two x=800 y=400 w=280}
Two.
\`\`\`

\`\`\`arch {#svc x=400 y=700}
service svc1 "Service" "what runs it" icon=server
\`\`\`

\`\`\`arch {#pair x=900 y=700}
service a "A"
service b "B"
a --> b
\`\`\`

\`\`\`md {#g1 x=400 y=1100 w=200 group=gg}
In a group.
\`\`\`

\`\`\`md {#g2 x=700 y=1100 w=200 group=gg}
Also in it.
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-selbar-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

async function clickItem(page: Page, id: string) {
  const at = (await page.locator(`[data-dag-item="${id}"]`).boundingBox())!;
  await page.mouse.click(at.x + 12, at.y + 8);
}

/** Zoom about the centre of one item, so it stays where the check can see it. */
async function zoomAt(page: Page, id: string, notches: number) {
  const at = (await page.locator(`[data-dag-item="${id}"]`).boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.keyboard.down("Control");
  for (let i = 0; i < Math.abs(notches); i++) await page.mouse.wheel(0, notches > 0 ? -120 : 120);
  await page.keyboard.up("Control");
}

/** Every handle drawn around the selection that something else answers for at its own centre. */
async function covered(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const handles = document.querySelectorAll<HTMLElement>(
      "[data-dag-selected] .dag-handle, [data-dag-selected] .dag-connect-handle, .dag-groupbox .dag-connect-handle, .dag-groupbox .dag-handle, .dag-nodetools [data-dag-connect], .dag-nodetools [data-dag-plus]",
    );
    for (const h of handles) {
      const r = h.getBoundingClientRect();
      if (r.width === 0) continue;
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (at && at !== h && !h.contains(at) && at.closest("[data-dag-selbar]")) {
        out.push(h.dataset.dagConnect ?? h.dataset.dagHandle ?? h.dataset.dagGroupHandle ?? h.dataset.dagPlus ?? "?");
      }
    }
    return out;
  });
}

test("the toolbar sits above the selection, clear of its handles, inside the canvas", async ({ page }) => {
  await open(page);
  await clickItem(page, "svc");
  await expect(page.locator("[data-dag-selbar]")).toBeVisible();

  const north = (await page.locator('[data-dag-item="svc"] [data-dag-connect="n"]').boundingBox())!;
  const bar = (await page.locator(".dag-selbar").boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(north.y);
  expect(bar.y + bar.height).toBeGreaterThan(north.y - 40);

  const vp = (await page.locator(".dag-viewport").boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(vp.x);
  expect(bar.x + bar.width).toBeLessThanOrEqual(vp.x + vp.width);
});

/* The south dot sat 30 board pixels out and the bar 12 screen pixels under the item, so
   the dot was under the bar from about 40% to 230%. Three zooms, and a group's and a picked card's
   handles as well as an item's own — each zoomed about the thing being selected, so it is on
   screen whatever the zoom did to everything else. */
const SELECT: Record<string, (page: Page) => Promise<void>> = {
  "an item": async (page) => {
    await clickItem(page, "svc");
    await expect(page.locator('[data-dag-item="svc"] [data-dag-connect="s"]')).toBeVisible();
  },
  "a group": async (page) => {
    await clickItem(page, "g1");
    await expect(page.locator(".dag-groupbox .dag-connect-handle")).toHaveCount(4);
    /* And its eight resize handles on the box — the north one is where the bar is. */
    await expect(page.locator(".dag-groupbox [data-dag-group-handle]")).toHaveCount(8);
  },
  "a picked card": async (page) => {
    const a = page.locator('[data-dag-node="a"]');
    await a.click();
    await page.waitForTimeout(400);
    await a.click();
    await expect(page.locator(".dag-nodetools [data-dag-plus]")).toHaveCount(4);
  },
};
const TARGET: Record<string, string> = { "an item": "svc", "a group": "g1", "a picked card": "pair" };
for (const notches of [-3, 0, 4]) {
  for (const what of Object.keys(SELECT)) {
    test(`no handle of ${what} is under the toolbar (zoom ${notches > 0 ? "in" : notches < 0 ? "out" : "100%"})`, async ({ page }) => {
      await open(page);
      await zoomAt(page, TARGET[what]!, notches);
      await SELECT[what]!(page);
      await expect(page.locator("[data-dag-selbar]")).toBeVisible();
      await expect.poll(() => covered(page)).toEqual([]);
    });
  }
}

test("the toolbar goes below when the selection is at the top of the canvas, still clear of its handles", async ({ page }) => {
  await open(page);
  await clickItem(page, "svc");
  /* Pan the item up to the canvas's top edge: the wheel moves the paper. */
  const vp = (await page.locator(".dag-viewport").boundingBox())!;
  const item = (await page.locator('[data-dag-item="svc"]').boundingBox())!;
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
  await page.mouse.wheel(0, item.y - vp.y - 30);
  await expect
    .poll(async () => (await page.locator('[data-dag-item="svc"]').boundingBox())!.y - vp.y)
    .toBeLessThan(60);

  const south = (await page.locator('[data-dag-item="svc"] [data-dag-connect="s"]').boundingBox())!;
  await expect.poll(async () => (await page.locator(".dag-selbar").boundingBox())!.y).toBeGreaterThan(south.y + south.height);
  await expect.poll(() => covered(page)).toEqual([]);
});

test("the toolbar follows the selection through a pan", async ({ page }) => {
  await open(page);
  await clickItem(page, "svc");
  await expect(page.locator("[data-dag-selbar]")).toBeVisible();
  const item0 = (await page.locator('[data-dag-item="svc"]').boundingBox())!;
  const bar0 = (await page.locator(".dag-selbar").boundingBox())!;
  expect(bar0.y + bar0.height).toBeLessThanOrEqual(item0.y);

  /* The selection does not move, the view does: a wheel without ctrl moves the paper, and the
     toolbar moves by exactly what the item did. */
  await page.mouse.wheel(60, 80);
  await expect.poll(async () => (await page.locator('[data-dag-item="svc"]').boundingBox())!.y).not.toBe(item0.y);
  const item1 = (await page.locator('[data-dag-item="svc"]').boundingBox())!;
  await expect
    .poll(async () => {
      const bar1 = (await page.locator(".dag-selbar").boundingBox())!;
      return [Math.round(bar1.x - bar0.x - (item1.x - item0.x)), Math.round(bar1.y - bar0.y - (item1.y - item0.y))];
    })
    .toEqual([0, 0]);
});

test("the toolbar is the same size at every zoom — it is chrome, not part of the board", async ({ page }) => {
  await open(page);
  await clickItem(page, "svc");
  const at1 = (await page.locator(".dag-selbar").boundingBox())!;
  await zoomAt(page, "svc", 4);
  await expect.poll(async () => Math.round((await page.locator(".dag-selbar").boundingBox())!.height)).toBe(Math.round(at1.height));
  expect(Math.round((await page.locator(".dag-selbar").boundingBox())!.width)).toBe(Math.round(at1.width));
});

/* One toolbar, icons only, and only what applies. The chip that used to hang
   on a single item — with a second Duplicate and a second Delete — is gone. */
test("one item gets its own tools, and nothing that needs two", async ({ page }) => {
  await open(page);
  await clickItem(page, "one");
  const bar = page.locator("[data-dag-selbar]");
  await expect(bar).toBeVisible();
  await expect(page.locator("[data-dag-chip]")).toHaveCount(0);

  for (const hook of ["edit", "duplicate", "more", "delete"]) {
    await expect(bar.locator(`[data-dag-selbar-${hook}]`)).toHaveCount(1);
  }
  await expect(bar.locator("[data-dag-selbar-export]")).toHaveCount(1);
  /* The order and Keep are used least, and live behind the ⋯ with their keys. */
  await bar.locator("[data-dag-selbar-more]").click();
  for (const hook of ["front", "back", "keep"]) await expect(bar.locator(`[data-dag-selbar-${hook}]`)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(bar.locator("[data-dag-selbar-front]")).toHaveCount(0);
  for (const hook of ["group", "ungroup", "tidy"]) await expect(bar.locator(`[data-dag-selbar-${hook}]`)).toHaveCount(0);
  /* A note is not a diagram: there is nothing for a model to rewrite, so there is no button that
     would only say so after somebody had typed. */
  await expect(bar.locator("[data-dag-rewrite-open]")).toHaveCount(0);
  await expect(bar.locator("input, textarea")).toHaveCount(0);
  /* Icons, but for Edit — the one reached for most says so — and every name is in the tooltip
     with its key. */
  expect((await bar.locator("button").allInnerTexts()).join("").trim()).toBe("Edit");
  await expect(bar.locator("[data-dag-selbar-duplicate]")).toHaveAttribute("title", /\(Ctrl\+D\)$/);

  await clickItem(page, "svc");
  await expect(bar.locator("[data-dag-rewrite-open]")).toHaveCount(1);
});

test("two items get the set tools, and nothing that means one", async ({ page }) => {
  await open(page);
  await clickItem(page, "one");
  const two = (await page.locator('[data-dag-item="two"]').boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.click(two.x + 12, two.y + 8);
  await page.keyboard.up("Shift");
  const bar = page.locator("[data-dag-selbar]");
  await expect(bar.locator(".dag-selbar__count")).toHaveText("2");

  for (const hook of ["group", "tidy", "duplicate", "more", "delete"]) {
    await expect(bar.locator(`[data-dag-selbar-${hook}]`)).toHaveCount(1);
  }
  await bar.locator("[data-dag-selbar-more]").click();
  for (const hook of ["front", "back", "keep"]) await expect(bar.locator(`[data-dag-selbar-${hook}]`)).toHaveCount(1);
  await page.keyboard.press("Escape");
  for (const hook of ["edit", "export", "ungroup"]) await expect(bar.locator(`[data-dag-selbar-${hook}]`)).toHaveCount(0);
  await expect(bar.locator("[data-dag-rewrite-open]")).toHaveCount(0);
  /* Tidy is on the leader chord, and its title says so. */
  await expect(bar.locator("[data-dag-selbar-tidy]")).toHaveAttribute("title", /\(Space T\)$/);
});

test("a grouped selection offers Ungroup", async ({ page }) => {
  await open(page);
  await clickItem(page, "g1");
  await expect(page.locator("[data-dag-selbar] [data-dag-selbar-ungroup]")).toHaveCount(1);
});

/* The Delete key takes a picked card before the diagram it is in, and the toolbar's Delete names
   that key — so it does the same. It used to delete the whole diagram. */
test("with a card picked, the toolbar's Delete takes the card, as the key does", async ({ page }) => {
  await open(page);
  const a = page.locator('[data-dag-node="a"]');
  await a.click();
  await page.waitForTimeout(400);
  await a.click();
  await expect(page.locator('[data-dag-node="a"][data-dag-picked]')).toHaveCount(1);
  const del = page.locator("[data-dag-selbar-delete]");
  await expect(del).toHaveAttribute("title", "Delete the picked card (Del)");
  await del.click();
  await expect.poll(() => fs.readFileSync(file, "utf8")).not.toContain('service a "A"');
  expect(fs.readFileSync(file, "utf8")).toContain("```arch {#pair");
  expect(fs.readFileSync(file, "utf8")).toContain('service b "B"');
});
