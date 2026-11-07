import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS, openBoards } from "./boards";

/**
 * The page tabs: where they are, what they do with a long name, and reordering them.
 *
 * The strip moved out of the toolbar and down to the bottom of the window, the way a spreadsheet
 * puts its sheets — the toolbar row was already full, so a page called "What the office actually
 * produces" came out wrapped onto three lines inside a box with no border, which is what this is
 * here to stop happening again.
 *
 * Every reorder check reads the bytes on disk: the order of the tabs *is* the order of `pages:` in
 * the frontmatter, and nothing about it is editor state.
 *
 * One board per test: the suite runs in parallel and these write to disk.
 */

const DIR = BOARDS;

const board = (pages: [string, string][]): string =>
  `---\ntitle: Tabs\npages:\n${pages.map(([id, n]) => `  - id: ${id}\n    name: ${JSON.stringify(n)}`).join("\n")}\n---\n\n\`\`\`md {#a x=0 y=0}\nfirst\n\`\`\`\n`;

const THREE: [string, string][] = [
  ["one", "One"],
  ["two", "Two"],
  ["three", "Three"],
];

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-pages-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, board(THREE));
});
test.afterEach(() => {
  fs.rmSync(file, { force: true });
  fs.rmSync(path.join(DIR, `${name}-2.board.md`), { force: true });
});

const read = () => fs.readFileSync(file, "utf8");
/** The declared order, which is the only thing a reorder changes. */
const order = () => [...read().matchAll(/^ {2}- id: (\S+)$/gm)].map((m) => m[1]!);

async function open(page: Page, query = ""): Promise<void> {
  await page.goto(`/?board=${name}${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

const tabs = (page: Page) => page.locator("[data-dag-page]");

/* ------------------------------------------------------------------------ where the strip is */

test("the strip is below the board, not in the toolbar", async ({ page }) => {
  await open(page);
  const bar = (await page.locator("[data-dag-pagebar]").boundingBox())!;
  const view = (await page.locator(".dag-viewport").boundingBox())!;
  const tools = (await page.locator(".dag-toolbar").boundingBox())!;
  expect(bar.y).toBeGreaterThanOrEqual(view.y + view.height - 1);
  expect(bar.y).toBeGreaterThan(tools.y);
  /*
   * It spans the window rather than the canvas — which is the whole reason it is a sibling of
   * `.dag-body` rather than something inside it.
   *
   * This used to be `bar.x < view.x`, and the gap it measured was the board list: a permanent
   * 232px column that pushed the viewport right while the strip went under it. The list is a
   * dialog now, so on a board with no panels open the two left edges are the same pixel and
   * a strict `<` reads `0 < 0`. The claim that survives is the one that was always the
   * point: the strip starts no further right than the canvas and is at least as wide.
   */
  expect(bar.x).toBeLessThanOrEqual(view.x);
  expect(bar.width).toBeGreaterThanOrEqual(view.width);
});

test("a long name is one truncated line, and the whole of it is the tooltip", async ({ page }) => {
  const long = "What the office actually produces, at some length";
  fs.writeFileSync(
    file,
    board([
      ["docs", long],
      ["b", "Second"],
    ]),
  );
  await open(page);

  const tab = page.locator('[data-dag-page="docs"]');
  await expect(tab).toHaveAttribute("title", long);

  const box = (await tab.boundingBox())!;
  const line = await tab.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || 16);
  /* One line: a wrapped tab was three of them. And truncated rather than squeezed — the text it
     is asked to draw is wider than the box it is drawn in. */
  expect(box.height).toBeLessThan(line * 2);
  expect(await tab.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await tab.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
});

test("a short name still gets a minimum width, and many tabs scroll rather than shrink", async ({ page }) => {
  const many: [string, string][] = Array.from({ length: 14 }, (_, i) => [`p${i}`, `Page number ${i}`]);
  fs.writeFileSync(file, board(many));
  await open(page);

  const first = (await page.locator('[data-dag-page="p0"]').boundingBox())!;
  expect(first.width).toBeGreaterThanOrEqual(80);

  /* Fourteen tabs at that width cannot fit, and the answer is the strip's own scroll — every tab
     keeps its size, which is the whole point of a minimum. */
  const scroll = page.locator(".dag-pagebar__scroll");
  expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const last = (await page.locator('[data-dag-page="p13"]').boundingBox())!;
  expect(last.width).toBeGreaterThanOrEqual(80);
});

/* ---------------------------------------------------------------------------- reordering */

/** Drag one tab onto a half of another. `at` is the fraction across the target. */
async function dragTab(page: Page, from: string, to: string, at: number): Promise<void> {
  const a = (await page.locator(`[data-dag-page="${from}"]`).boundingBox())!;
  const b = (await page.locator(`[data-dag-page="${to}"]`).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * at, b.y + b.height / 2, { steps: 20 });
  await page.mouse.move(b.x + b.width * at, b.y + b.height / 2, { steps: 3 });
  await page.mouse.up();
}

test("dragging a tab past another reorders the pages in the file", async ({ page }) => {
  await open(page);
  await expect(tabs(page)).toHaveCount(3);

  await dragTab(page, "three", "one", 0.1);
  await expect.poll(order, { timeout: 5_000 }).toEqual(["three", "one", "two"]);
  await expect
    .poll(async () => tabs(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.dagPage)))
    .toEqual(["three", "one", "two"]);

  /* The right half of a tab means after it. */
  await dragTab(page, "three", "two", 0.9);
  await expect.poll(order, { timeout: 5_000 }).toEqual(["one", "two", "three"]);
});

test("a reorder is one undo, and it takes back the whole move", async ({ page }) => {
  await open(page);
  await dragTab(page, "three", "one", 0.1);
  await expect.poll(order, { timeout: 5_000 }).toEqual(["three", "one", "two"]);

  await page.locator(".dag-viewport").click({ position: { x: 700, y: 400 } });
  await page.keyboard.press("Control+z");
  await expect.poll(order, { timeout: 5_000 }).toEqual(["one", "two", "three"]);
});

test("a drag does not also open the tab it let go over, and a click still does", async ({ page }) => {
  await open(page);
  /* The reorder ends on a different tab than it began on, so no `click` is dispatched at all —
     which is why the suppression flag is cleared when a press starts rather than by a click. A
     flag waiting for an event that never comes swallows the *next* real click instead. */
  await dragTab(page, "three", "one", 0.1);
  await expect.poll(order, { timeout: 5_000 }).toEqual(["three", "one", "two"]);
  expect(new URL(page.url()).searchParams.get("page")).toBe(null);

  await page.locator('[data-dag-page="two"]').click();
  await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("two");
});

test("shift and an arrow key move a tab, which is the gesture without a pointer", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-page="one"]').focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(order, { timeout: 5_000 }).toEqual(["two", "one", "three"]);
});

/* ------------------------------------------------------------------- opening another board */

test("opening a board from the list lands on its first page", async ({ page }) => {
  /* A second board with one page, so the page id this one is on cannot exist over there. */
  const other = `${name}-2`;
  fs.writeFileSync(path.join(DIR, `${other}.board.md`), "---\ntitle: Other\n---\n\n```md {#z}\nz\n```\n");

  await open(page, "&page=three");
  await expect(page.locator('[data-dag-page="three"]')).toHaveAttribute("aria-selected", "true");

  await openBoards(page);
  await page.locator(`[data-dag-board="${other}"]`).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("board")).toBe(other);
  /* `page=` is cleared with the switch, and what is on the one page over there is drawn — the
     defect was landing on `page-3` of a board that has no such page: a blank canvas. A board of one
     page draws no tab strip, so the item is what says so. */
  expect(new URL(page.url()).searchParams.get("page")).toBe(null);
  await expect(page.locator('[data-dag-item="z"]')).toBeVisible();
});

test("a shared link to a page that does not exist falls back to the first", async ({ page }) => {
  await open(page, "&page=page-9");
  await expect(page.locator('[data-dag-page="one"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-dag-page][aria-selected="true"]')).toHaveCount(1);
});
