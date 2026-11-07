import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openMore } from "./more";

import { lead } from "./keys";
import { BOARDS } from "./boards";

/**
 * Groups, and the shortcuts that make and break them.
 *
 * A group is a `group=` attribute shared by its members — nothing more — so every check here is
 * on the file and on what a click selects. The shortcut sheet is checked here too, since the sheet
 * is where a person learns the rest.
 */

const DIR = BOARDS;

const BOARD = `---
title: Group me
---

\`\`\`md {#a x=0 y=0 w=200}
A
\`\`\`

\`\`\`md {#b x=280 y=0 w=200}
B
\`\`\`

\`\`\`md {#c x=0 y=200 w=200}
C
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
}

async function clickItem(page: Page, id: string, modifier?: "Shift") {
  const at = (await page.locator(`[data-dag-item="${id}"]`).boundingBox())!;
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(at.x + 30, at.y + 10);
  if (modifier) await page.keyboard.up(modifier);
}

const selectedIds = (page: Page) =>
  page.locator("[data-dag-selected]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.dagItem));

const groupOf = (id: string) => new RegExp(`\`\`\`md \\{#${id}[^}]*group=(group-[a-z0-9]{4})`).exec(read())?.[1];

test("ctrl+G groups the selection, a click on a member selects the group, ctrl+shift+G ungroups", async ({ page }) => {
  await open(page);
  await clickItem(page, "a");
  await clickItem(page, "b", "Shift");
  await expect(page.locator("[data-dag-selbar]")).toBeVisible();
  await page.keyboard.press("Control+g");

  await expect.poll(() => groupOf("a"), { timeout: 5_000 }).toMatch(/^group-/);
  expect(groupOf("b")).toBe(groupOf("a"));
  expect(groupOf("c")).toBeUndefined();
  /* The group wears one dashed box around both. */
  await expect(page.locator("[data-dag-groupbox]")).toHaveCount(1);

  /* A click on the paper, then on one member: both come. */
  const vp = (await page.locator(".dag-viewport").boundingBox())!;
  await page.mouse.click(vp.x + 20, vp.y + vp.height - 20);
  expect(await selectedIds(page)).toEqual([]);
  await clickItem(page, "b");
  expect(await selectedIds(page)).toEqual(["a", "b"]);
  /* A second click on a member picks it out. */
  await clickItem(page, "b");
  expect(await selectedIds(page)).toEqual(["b"]);

  /* Shift-click on a member of the group takes the whole group back in, then out. */
  await clickItem(page, "c");
  await clickItem(page, "a", "Shift");
  expect(await selectedIds(page)).toEqual(["a", "b", "c"]);
  await clickItem(page, "a", "Shift");
  expect(await selectedIds(page)).toEqual(["c"]);

  await clickItem(page, "a");
  await page.keyboard.press("Control+Shift+g");
  await expect.poll(() => groupOf("a"), { timeout: 5_000 }).toBeUndefined();
  expect(groupOf("b")).toBeUndefined();
  expect(read()).toContain("```md {#a x=0 y=0 w=200}");
  await expect(page.locator("[data-dag-groupbox]")).toHaveCount(0);
});

test("a group moves, duplicates and deletes as one", async ({ page }) => {
  fs.writeFileSync(
    file,
    BOARD.replace("{#a x=0 y=0 w=200}", "{#a x=0 y=0 w=200 group=g1}").replace(
      "{#b x=280 y=0 w=200}",
      "{#b x=280 y=0 w=200 group=g1}",
    ),
  );
  await open(page);

  /* Drag A: B comes with it, at its distance. */
  const a = (await page.locator('[data-dag-item="a"]').boundingBox())!;
  await page.mouse.move(a.x + 30, a.y + 10);
  await page.mouse.down();
  await page.mouse.move(a.x + 130, a.y + 210, { steps: 6 });
  await page.mouse.move(a.x + 230, a.y + 410, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => /#a x=(\d+) y=(\d+)/.exec(read())?.[2], { timeout: 5_000 }).not.toBe("0");
  const pa = /#a x=(\d+) y=(\d+)/.exec(read())!;
  const pb = /#b x=(\d+) y=(\d+)/.exec(read())!;
  expect(Number(pb[1]) - Number(pa[1])).toBe(280);
  expect(pb[2]).toBe(pa[2]);

  /* Duplicate: two new items, in a new group of their own. */
  await page.keyboard.press("Control+d");
  await expect.poll(() => (read().match(/```md/g) ?? []).length, { timeout: 5_000 }).toBe(5);
  const groups = [...read().matchAll(/group=([\w-]+)/g)].map((m) => m[1]);
  expect(groups.filter((g) => g === "g1")).toHaveLength(2);
  const fresh = groups.filter((g) => g !== "g1");
  expect(fresh).toHaveLength(2);
  expect(fresh[0]).toBe(fresh[1]);
  expect(fresh[0]).toMatch(/^group-/);

  /* Delete the copies — they are the selection — and the originals stay.
     Waited on by *which* two are selected, not by how many: the file is written before the
     response that moves the selection onto the copies arrives, so a count of two was satisfied by
     the originals still being selected and the Delete below took them instead. The board is one
     round trip stale after a write, and this is the shape that rule takes in a spec. */
  await expect(page.locator('[data-dag-item="a"][data-dag-selected]')).toHaveCount(0);
  await expect(page.locator("[data-dag-selected]")).toHaveCount(2);
  await page.keyboard.press("Delete");
  await expect.poll(() => (read().match(/```md/g) ?? []).length, { timeout: 5_000 }).toBe(3);
  expect(read()).toContain("group=g1");
});

test("the dashed box and its handles follow the members mid-drag", async ({ page }) => {
  fs.writeFileSync(
    file,
    BOARD.replace("{#a x=0 y=0 w=200}", "{#a x=0 y=0 w=200 group=g1}").replace(
      "{#b x=280 y=0 w=200}",
      "{#b x=280 y=0 w=200 group=g1}",
    ),
  );
  await open(page);
  await clickItem(page, "a");
  await expect(page.locator("[data-dag-groupbox]")).toHaveCount(1);

  /* The box and the four connect handles on it are `App`'s, drawn from `places`, which a
     gesture that paints never touches — so a dragged group used to leave the thing you link *from*
     behind at the position it started in. Measured with the pointer still down, because that is
     the only moment the defect exists: on release the write lands and everything agrees again. */
  const before = (await page.locator("[data-dag-groupbox]").boundingBox())!;
  const a = (await page.locator('[data-dag-item="a"]').boundingBox())!;
  await page.mouse.move(a.x + 30, a.y + 10);
  await page.mouse.down();
  await page.mouse.move(a.x + 130, a.y + 210, { steps: 6 });
  await page.mouse.move(a.x + 230, a.y + 410, { steps: 6 });

  const moved = (await page.locator('[data-dag-item="a"]').boundingBox())!;
  const box = (await page.locator("[data-dag-groupbox]").boundingBox())!;
  expect(Math.round(box.x - before.x)).toBe(Math.round(moved.x - a.x));
  expect(Math.round(box.y - before.y)).toBe(Math.round(moved.y - a.y));
  /* The handles are the box's children, so they come with it; the north one proves they did. */
  const north = (await page.locator('[data-dag-groupbox] [data-dag-connect="n"]').boundingBox())!;
  expect(north.y).toBeGreaterThan(before.y);

  await page.mouse.up();
  await expect.poll(() => /#a x=(\d+) y=(\d+)/.exec(read())?.[2], { timeout: 5_000 }).not.toBe("0");
});

test("a group resizes as one: eight handles on its box, every member scaled, and one undo", async ({ page }) => {
  /* Two notes and a pen stroke, grouped — the report's drawing, less the flower. */
  fs.writeFileSync(
    file,
    BOARD.replace("{#a x=0 y=0 w=200}", "{#a x=0 y=0 w=200 group=g1}").replace(
      "{#b x=280 y=0 w=200}",
      "{#b x=280 y=0 w=200 group=g1}",
    ) + '\n```sketch {#s x=0 y=200 group=g1}\nink ink1 pts="0,0 80,0 80,40"\n```\n',
  );
  await open(page);
  /* At 1:1, so a screen distance is a board distance. */
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("0");
  await page.mouse.move(800, 600);
  await page.mouse.wheel(0, 1);
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-zoom", "1");
  const before = read();

  await clickItem(page, "a");
  await expect(page.locator("[data-dag-selected]")).toHaveCount(3);
  /* The group's own eight, on its box — and no member's, which would be a second set of squares. */
  await expect(page.locator("[data-dag-groupbox] [data-dag-group-handle]")).toHaveCount(8);
  await expect(page.locator("[data-dag-handle]")).toHaveCount(0);

  /* The union is 480 wide, from the left edge of A to the right edge of B: the east handle pulled
     480 further doubles it, and every member doubles about the west edge with it. */
  const h = (await page.locator('[data-dag-group-handle="e"]').boundingBox())!;
  const x = h.x + h.width / 2;
  const y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 240, y, { steps: 4 });
  /* Mid-drag, the members are painted where they will land — B's left edge at 560. */
  await page.mouse.move(x + 480, y, { steps: 4 });
  const bMid = (await page.locator('[data-dag-item="b"]').boundingBox())!;
  const aMid = (await page.locator('[data-dag-item="a"]').boundingBox())!;
  expect(Math.round(bMid.x - aMid.x)).toBe(560);
  await page.mouse.up();

  await expect.poll(() => /#b x=(\d+)/.exec(read())?.[1], { timeout: 5_000 }).toBe("560");
  expect(read()).toMatch(/\{#a x=0 y=0 w=400 group=g1\}/);
  expect(read()).toMatch(/\{#b x=560 y=0 w=400 group=g1\}/);
  /* The stroke's own width, doubled — its points are the drawing's shape and never rewritten — and
     the drawing, which began 8px in from the group's west edge, is 16px in: it scaled about the
     group's corner, and its frame is put back around it with the padding it always had. */
  expect(read()).toContain('ink ink1 pts="0,0 80,0 80,40" w=160');
  expect(read()).toMatch(/\{#s x=8 y=200 group=g1\}/);

  /* One commit, so one ctrl+Z puts every member back. The undo control going live is the page
     saying the history entry exists — the file alone would race it. */
  await expect(page.locator("[data-dag-undo]")).toBeEnabled({ timeout: 5_000 });
  await page.keyboard.press("Control+z");
  await expect.poll(read, { timeout: 5_000 }).toBe(before);
});

test("a circle in a group pulled sideways lands as the preview drew it: wider, and no taller", async ({ page }) => {
  /* A circle given one side stays square, so a pull east written as `w=` alone grew it south too —
     a stretched ellipse under the pointer, a bigger circle on release, and the group's height
     moved though nobody pulled it. */
  fs.writeFileSync(
    file,
    BOARD.replace("{#a x=0 y=0 w=200}", "{#a x=0 y=0 w=200 group=g1}").replace(
      /```md \{#b[^]*?```\n/,
      '```sketch {#s x=280 y=0 group=g1}\ncircle c1 "C"\n```\n',
    ),
  );
  await open(page);
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("0");
  await page.mouse.move(800, 600);
  await page.mouse.wheel(0, 1);
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-zoom", "1");
  const shape = page.locator('[data-dag-item="s"] [data-dag-node="c1"]');
  const was = (await shape.boundingBox())!;

  await clickItem(page, "a");
  await expect(page.locator("[data-dag-selected]")).toHaveCount(2);
  const h = (await page.locator('[data-dag-group-handle="e"]').boundingBox())!;
  const group = (await page.locator("[data-dag-groupbox]").boundingBox())!;
  const x = h.x + h.width / 2;
  const y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + group.width / 2, y, { steps: 4 });
  await page.mouse.move(x + group.width, y, { steps: 4 });
  await page.mouse.up();

  await expect.poll(() => /circle c1 "C"[^\n]*/.exec(read())?.[0], { timeout: 5_000 }).toMatch(/ w=\d+ h=\d+$/);
  await expect.poll(async () => Math.round((await shape.boundingBox())!.height), { timeout: 5_000 }).toBe(Math.round(was.height));
  const now = (await shape.boundingBox())!;
  expect(now.width).toBeGreaterThan(was.width * 1.5);
});

test("the marquee takes a whole group by touching one member, and the sheet lists the keys", async ({ page }) => {
  fs.writeFileSync(
    file,
    BOARD.replace("{#a x=0 y=0 w=200}", "{#a x=0 y=0 w=200 group=g1}").replace(
      "{#c x=0 y=200 w=200}",
      "{#c x=0 y=200 w=200 group=g1}",
    ),
  );
  await open(page);
  const vp = (await page.locator(".dag-viewport").boundingBox())!;
  const a = (await page.locator('[data-dag-item="a"]').boundingBox())!;
  /* From the corner to the middle of A only: C, in A's group, comes too; B does not. */
  await page.mouse.move(vp.x + 10, vp.y + 10);
  await page.mouse.down();
  await page.mouse.move(vp.x + 100, vp.y + 100, { steps: 4 });
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(await selectedIds(page)).toEqual(["a", "c"]);

  await lead(page, "?");
  await expect(page.locator("[data-dag-shortcuts]")).toBeVisible();
  await expect(page.locator(".dag-shortcuts__row", { hasText: "Group · ungroup" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-shortcuts]")).toHaveCount(0);
  /* Escape closed the sheet and left the selection alone. */
  expect(await selectedIds(page)).toEqual(["a", "c"]);
  await openMore(page);
  await page.locator("[data-dag-help]").click();
  await expect(page.locator("[data-dag-shortcuts]")).toBeVisible();
});
