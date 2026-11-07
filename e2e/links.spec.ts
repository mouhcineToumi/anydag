import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { lead } from "./keys";
import { BOARDS } from "./boards";

/**
 * Components and links.
 *
 * The screenshot checks in `reference.spec.ts` already hold what this *looks* like. What is here is
 * the behaviour a picture cannot show: that a header appears and disappears on a rule rather than
 * on an attribute, that a link is a write to the board file like every other gesture, and that a
 * link into a diagram reaches the card rather than the frame — which is the one thing the first
 * version of this feature got wrong, and which no screenshot comparison would have caught, because
 * an arrow stopping forty pixels short of a card looks like an arrow.
 */

const DIR = BOARDS;

const BOARD = `---
title: Links
---

\`\`\`usecase {#who x=0 y=0}
actor person "Someone"
\`\`\`

\`\`\`arch {#stack x=600 y=0 title="Stack"}
service api "API" icon=server
store db "Database" icon=database

api --> db
\`\`\`

\`\`\`edges {#links}
who --> stack.db "reads"
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-links-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

const box = (page: Page, sel: string) => page.locator(sel).boundingBox();

test("a lone node draws bare, and stays bare until its author names it", async ({ page }) => {
  await open(page);
  const who = page.locator('[data-dag-item="who"]');
  await expect(who.locator(".dag-frame--bare")).toHaveCount(1);
  await expect(who.locator(".dag-frame__head")).toHaveCount(0);
  /* The diagram beside it keeps its header, so this is a rule about `title=`, not a stylesheet
     change: `stack` carries `title="Stack"`. */
  await expect(page.locator('[data-dag-item="stack"] .dag-frame__head')).toHaveCount(1);

  /* A second node changes nothing (F0): node count plays no part in whether a header draws. */
  fs.writeFileSync(file, read().replace('actor person "Someone"', 'actor person "Someone"\nusecase uc "Do a thing"\nperson --> uc'));
  await expect(who.locator(".dag-frame__head")).toHaveCount(0);

  /* A title is what grows it. */
  fs.writeFileSync(file, read().replace("{#who x=0 y=0}", '{#who x=0 y=0 title="Who"}'));
  await expect(who.locator(".dag-frame__head")).toHaveCount(1);
});

test("`frame=` overrules the rule in both directions", async ({ page }) => {
  await open(page);
  fs.writeFileSync(file, read().replace("{#who x=0 y=0}", "{#who x=0 y=0 frame=full}"));
  await expect(page.locator('[data-dag-item="who"] .dag-frame__head')).toHaveCount(1);

  fs.writeFileSync(file, read().replace('{#stack x=600 y=0 title="Stack"}', '{#stack x=600 y=0 title="Stack" frame=none}'));
  await expect(page.locator('[data-dag-item="stack"] .dag-frame__head')).toHaveCount(0);
});

test("the link is drawn, over the items, and lands on the card rather than the frame", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  const layer = page.locator(".dag-board-edges");
  await expect(layer).toHaveCount(1);
  await expect(layer.locator("[data-dag-edge]")).toHaveCount(1);
  await expect(layer.locator("text")).toHaveText("reads");

  /* The last point of the path, against the two boxes it could have stopped at. `db` sits inside
     `stack`, so a frame anchor is left of the card by the frame's padding and the card anchor is
     not. Board coordinates are not needed: both are read off the same rendered page. */
  const end = await page.evaluate(() => {
    const p = document.querySelector<SVGPathElement>(".dag-board-edges path[d]")!;
    const at = p.getPointAtLength(p.getTotalLength());
    const r = p.getBoundingClientRect();
    void r;
    const m = p.getScreenCTM()!;
    return { x: at.x * m.a + at.y * m.c + m.e, y: at.x * m.b + at.y * m.d + m.f };
  });
  const card = (await box(page, '[data-dag-node="db"]'))!;
  const frame = (await box(page, '[data-dag-item="stack"]'))!;
  expect(end.x).toBeGreaterThan(frame.x + 1);
  expect(end.x).toBeLessThanOrEqual(card.x + card.width + 1);
  expect(end.x).toBeGreaterThanOrEqual(card.x - 1);
});

test("K opens the links fence, and makes one where there is none", async ({ page }) => {
  await open(page);
  await page.locator(".dag-viewport").click({ position: { x: 20, y: 20 } });
  await lead(page, "k");
  await expect(page.locator("[data-dag-inspector]")).toHaveCount(1);
  await expect(page.locator("[data-dag-body]")).toHaveValue(/who --> stack\.db/);

  /* On a board with no fence, the same key writes one. */
  fs.writeFileSync(file, BOARD.replace(/```edges[\s\S]*?```\n/, ""));
  await expect(page.locator(".dag-board-edges")).toHaveCount(0);
  await page.locator(".dag-viewport").click({ position: { x: 20, y: 20 } });
  await lead(page, "k");
  await expect.poll(read).toContain("```edges");
});

test("a link naming nothing is one error, and the good links still draw", async ({ page }) => {
  await open(page);
  fs.writeFileSync(file, read().replace('who --> stack.db "reads"', 'who --> stack.db "reads"\nwho --> ghost'));
  /* In the problems dock, never as a card on the canvas: see `problems.spec.ts`. */
  await page.locator("[data-dag-problems-pill]").click();
  await expect(page.locator("[data-dag-problems-row]")).toHaveCount(1);
  await expect(page.locator('[data-dag-problems-row="EB_LINK_UNKNOWN_ITEM"]')).toBeVisible();
  await expect(page.locator(".dag-viewport .dag-error")).toHaveCount(0);
  await expect(page.locator(".dag-board-edges [data-dag-edge]")).toHaveCount(1);
});

/* ---- the gesture ---- */

/**
 * Connect-by-drag.
 *
 * Everything below ends in the board file, because that is the whole design: there is no link
 * state that is not also in the document Claude reads.
 */

async function pullFrom(page: Page, item: string, side: "n" | "s" | "e" | "w", to: { x: number; y: number }) {
  await page.locator(`[data-dag-item="${item}"]`).click();
  /* A click on a diagram that is *already* the whole selection picks the card under it (F1), and a
     picked card takes the item's own handles away and puts four of its own on the card (F3). This
     helper wants the item's, so it lets go of any pick first — which is Escape's innermost step,
     and leaves the selection exactly where it was. */
  if (await page.locator("[data-dag-picked]").count()) await page.keyboard.press("Escape");
  const handle = page.locator(`[data-dag-item="${item}"] [data-dag-connect="${side}"]`);
  await expect(handle).toBeVisible();
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  /* Two moves: the first starts the gesture, the second lands it. */
  await page.mouse.move((h.x + to.x) / 2, (h.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

const centreOf = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test("dragging from a connect handle onto another item writes a link", async ({ page }) => {
  await open(page);
  fs.writeFileSync(file, BOARD.replace(/```edges[\s\S]*?```\n/, ""));
  /*
   * Wait for the *page*, not for the file this test just wrote itself.
   *
   * A poll on `read()` is satisfied the instant `writeFileSync` returns, so it is not a wait at
   * all — and what comes next needs the board re-parsed and re-rendered, because it measures a
   * connect handle's position. The board is one round trip stale after any write, and over the
   * change feed it is two: a push, a refetch, then a render. Under the dev server's socket that
   * window was small enough to lose the race only occasionally; it is wider now, which is how a
   * latent defect became a visible one.
   */
  await expect(page.locator(".dag-board-edges [data-dag-edge]")).toHaveCount(0);

  await pullFrom(page, "who", "e", await centreOf(page, '[data-dag-item="stack"] [data-dag-node="api"]'));
  await expect.poll(read).toContain("who --> stack.api");
  await expect.poll(read).toContain("```edges");
});

test("dropping on the item itself, or on the paper, writes nothing", async ({ page }) => {
  await open(page);
  const before = read();

  await pullFrom(page, "who", "e", await centreOf(page, '[data-dag-item="who"]'));
  await pullFrom(page, "who", "s", { x: 300, y: 900 });
  await page.waitForTimeout(300);
  expect(read()).toBe(before);
});

test("escape abandons a link that is being pulled", async ({ page }) => {
  await open(page);
  const before = read();
  await page.locator('[data-dag-item="who"]').click();
  const h = (await page.locator('[data-dag-item="who"] [data-dag-connect="e"]').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 200, h.y, { steps: 4 });
  await expect(page.locator(".dag-connect")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".dag-connect")).toHaveCount(0);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(read()).toBe(before);
});

test("a link is picked by clicking it, and Delete takes its line out", async ({ page }) => {
  await open(page);
  const hit = page.locator(".dag-board-edges .dag-edge-hit");
  await expect(hit).toHaveCount(1);
  await hit.click({ force: true });
  await expect(page.locator(".dag-board-edges [data-dag-picked]")).toHaveCount(1);

  await page.keyboard.press("Delete");
  await expect.poll(() => read().includes("who --> stack.db")).toBe(false);
  await expect(page.locator(".dag-board-edges")).toHaveCount(0);
  /* The fence stays, empty, so the next link has somewhere to go. */
  expect(read()).toContain("```edges");
});

test("deleting an item takes the links that named it, in one undo, and leaves nothing to report", async ({ page }) => {
  /* A task card copied, linked to the original and then deleted used to leave its link behind — an
     `EB_LINK_UNKNOWN_ITEM` error in the dock about a card nobody could see any more. */
  await open(page);
  const linked = read().replace('who --> stack.db "reads"', 'who --> stack.db "reads"\nstack --> who\nstack.api --> stack.db');
  fs.writeFileSync(file, linked);
  await expect(page.locator(".dag-board-edges [data-dag-edge]")).toHaveCount(3);

  await page.locator('[data-dag-item="who"]').click();
  await page.keyboard.press("Delete");
  await expect(page.locator('[data-dag-item="who"]')).toHaveCount(0);
  await expect.poll(read).toContain("```edges {#links}\nstack.api --> stack.db\n```");
  await expect(page.locator(".dag-board-edges [data-dag-edge]")).toHaveCount(1);
  await expect(page.locator("[data-dag-problems-pill]")).toHaveCount(0);

  /* The card and its links went in one write, so one ctrl+Z brings back both. */
  await expect(page.locator("[data-dag-undo]")).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect.poll(read).toBe(linked);
  await expect(page.locator(".dag-board-edges [data-dag-edge]")).toHaveCount(3);
});

test("the handle at a picked link's middle bends it, and a double-click straightens it", async ({ page }) => {
  await open(page);
  const hit = page.locator(".dag-board-edges .dag-edge-hit");
  await hit.click({ force: true });

  /* The handle exists only on the picked line, and only on the board layer — a diagram's
     own edges run between cards ELK placed, so a point pinned between two of them is a claim the
     next relayout would make false. */
  const handle = page.locator(".dag-bend-handle");
  await expect(handle).toHaveCount(1);
  await expect(page.locator('[data-dag-item="stack"] .dag-bend-handle')).toHaveCount(0);

  const at = (await handle.boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2, at.y - 160, { steps: 10 });
  /* The curve is under the pointer before the file says so: the gesture publishes the point on
     `dag:link-bend` and the link layer routes again. Only then is it written. */
  const moved = (await handle.boundingBox())!;
  expect(moved.y).toBeLessThan(at.y - 100);
  await page.mouse.up();

  await expect.poll(() => /via="(-?\d+),(-?\d+)"/.exec(read())?.[0], { timeout: 5_000 }).toMatch(/^via="/);
  /* Straight back out again, on the handle that put it there. */
  const bent = (await handle.boundingBox())!;
  await page.mouse.dblclick(bent.x + bent.width / 2, bent.y + bent.height / 2);
  await expect.poll(() => read().includes("via="), { timeout: 5_000 }).toBe(false);
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("a link follows the item it is attached to, while it is being dragged", async ({ page }) => {
  await open(page);
  const d = () => page.locator(".dag-board-edges path.dag-edge-line").getAttribute("d");
  const before = await d();

  const b = (await page.locator('[data-dag-item="who"]').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 260, { steps: 6 });
  /* Mid-gesture: nothing has been written and the line has already moved. */
  expect(await d()).not.toBe(before);
  await page.mouse.up();
});

/**
 * Linking a group.
 *
 * A group could not be linked, twice over: an item's connect handles are gated on
 * `solo` — `selected.size === 1` — while `withGroups` guarantees a grouped item is never the sole
 * selection, so no member of a group could ever show a handle; and the grammar had no way to name
 * a group, so hand-typing it into the fence came back `EB_LINK_UNKNOWN_ITEM`. Both ends here: the
 * handle exists, and the statement it writes resolves.
 */
const GROUPED = `---
title: A grouped drawing
---

\`\`\`sketch {#s1 x=0 y=0 group=group-ink}
ink i1 pts="0,0 40,20 80,0"
\`\`\`

\`\`\`sketch {#s2 x=40 y=60 group=group-ink}
ink i2 pts="0,0 30,30 60,0"
\`\`\`

\`\`\`md {#target x=520 y=40 w=200}
Where it points.
\`\`\`
`;

test("a group of pen strokes has handles, and the link it draws names the group", async ({ page }, info) => {
  const gname = `e2e-group-${info.testId}`;
  const gfile = path.join(DIR, `${gname}.board.md`);
  fs.writeFileSync(gfile, GROUPED);
  try {
    await page.goto(`/?board=${gname}`);
    await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });

    /* One click on any member takes the whole group — the M19 rule — and that is exactly the
       state in which an item's own handles are suppressed. */
    const s1 = (await page.locator('[data-dag-item="s1"]').boundingBox())!;
    await page.mouse.click(s1.x + s1.width / 2, s1.y + s1.height / 2);
    await expect(page.locator("[data-dag-groupbox]")).toHaveCount(1);
    await expect(page.locator("[data-dag-group-connect]")).toHaveCount(4);
    /* And the item's own are not also up, which would be two sets of handles with nothing saying
       which thing either acted on. */
    await expect(page.locator('.dag-item .dag-connect-handle')).toHaveCount(0);

    const handle = (await page.locator('[data-dag-group-connect][data-dag-connect="e"]').boundingBox())!;
    const target = (await page.locator('[data-dag-item="target"]').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
    await page.mouse.up();

    /* The group's name, not a member's: the drawing is what was linked. */
    await expect
      .poll(() => fs.readFileSync(gfile, "utf8"), { timeout: 5_000 })
      .toContain("group-ink --> target");
    /* And it resolves, so it is actually drawn rather than sitting in the file as a diagnostic. */
    await expect(page.locator(".dag-board-edges path.dag-edge-line")).toHaveCount(1);
    await expect(page.locator("[data-dag-error]")).toHaveCount(0);
  } finally {
    fs.rmSync(gfile, { force: true });
  }
});

test("dropping on a member of a group names the group, as a click selects it", async ({ page }, info) => {
  const gname = `e2e-groupdrop-${info.testId}`;
  const gfile = path.join(DIR, `${gname}.board.md`);
  fs.writeFileSync(gfile, GROUPED);
  try {
    await page.goto(`/?board=${gname}`);
    await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });

    /* The other direction: pull from the loose item onto a *member*, and the endpoint written is
       the group. Anything else would mean a group could only be dropped onto in the gaps between
       the things inside it. */
    const target = (await page.locator('[data-dag-item="target"]').boundingBox())!;
    await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
    const handle = (await page.locator('.dag-item .dag-connect-handle[data-dag-connect="w"]').boundingBox())!;
    const s2 = (await page.locator('[data-dag-item="s2"]').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(s2.x + s2.width / 2, s2.y + s2.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect
      .poll(() => fs.readFileSync(gfile, "utf8"), { timeout: 5_000 })
      .toContain("target --> group-ink");
  } finally {
    fs.rmSync(gfile, { force: true });
  }
});
