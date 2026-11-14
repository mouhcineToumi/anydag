import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { openSidebar } from "./sidebar";
import { vaulted } from "./vault";

/**
 * The sidebar draws the rows in view and a margin, not every row of an open folder (#281), so a
 * folder of five thousand files is as quick to open as one of a hundred. What that must not cost is
 * everything the tree does with a row that is **not in the DOM**: the arrow keys walk past it, a
 * selection runs across it, a rename box on it survives a scroll, a drop reaches a folder that was
 * scrolled in for it, and the open file's row is shown when it was never drawn.
 *
 * The folder is generated for the run, under one parent named for this worker, and **removed by that
 * exact path** — `rmSync` on a name made by prefix would empty `boards/local/` the day the prefix
 * came out empty, so an empty one is refused before anything is made. The layout is
 *
 *   <parent>/files/row-0000 … row-4999    five thousand notes: the folder under test
 *   <parent>/target/                      a folder that is listed *after* all of them
 *
 * which puts the drop target at the bottom of the list and the rows to be dragged beside it, and the
 * top of the list five thousand rows away from both.
 */

const COUNT = 5_000;
const row = (n: number) => `row-${String(n).padStart(4, "0")}`;

let parent = "";
let dir = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(({}, info) => {
  parent = `e2e-virtual-${info.workerIndex}-${Date.now().toString(36)}`;
  /* A cleanup that matches by prefix must refuse an empty one. */
  if (!parent.startsWith("e2e-virtual-") || parent === "e2e-virtual-") throw new Error("no folder name to make");
  dir = path.join(BOARDS, parent);
  fs.mkdirSync(path.join(dir, "files"), { recursive: true });
  fs.mkdirSync(path.join(dir, "target"), { recursive: true });
  for (let i = 0; i < COUNT; i++) fs.writeFileSync(path.join(dir, "files", `${row(i)}.md`), `Row ${i}.\n`);
});

test.afterAll(() => {
  if (dir && dir !== BOARDS && dir.endsWith(parent) && parent.startsWith("e2e-virtual-"))
    fs.rmSync(dir, { recursive: true, force: true });
});

const file = (n: number) => `${parent}/files/${row(n)}`;
const fileRow = (name: string) => `[data-dag-sidebar-file="${name}"]`;
const folderRow = (name: string) => `[data-dag-sidebar-folder="${name}"]`;
const tree = (page: Page) => page.locator(".dag-sidebar__tree");
const rowsInDom = (page: Page) => page.locator("[data-dag-sidebar-row]").count();

async function open(page: Page, n: number): Promise<void> {
  await page.goto(await vaulted(page, `/?note=${encodeURIComponent(file(n))}`));
  await openSidebar(page);
  /* The list is five thousand rows longer than the page was ready for: wait for the open row. */
  await expect(page.locator(`${fileRow(file(n))}[aria-current="page"]`)).toHaveCount(1, { timeout: 30_000 });
}

/**
 * Scroll the tree until row `n` of `files/` is where the open row `from` was, `n - from` rows on. The
 * other specs of the suite add and remove rows above these, so the position is taken from a row that
 * is drawn, never counted from the top.
 */
async function scrollTo(page: Page, from: number, n: number): Promise<void> {
  await tree(page).evaluate(
    (el, [name, rows]) => {
      const anchor = el.querySelector<HTMLElement>(`[data-dag-sidebar-file="${name}"]`)!;
      const top = anchor.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      el.scrollTop = top + (rows as number) * anchor.getBoundingClientRect().height - 100;
    },
    [file(from), n - from] as const,
  );
}

/** The key of the row that has the focus, whether file or folder. */
const focused = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.dagSidebarKey ?? null);

test("only the rows in view are drawn, and the open file's row is shown though it was never drawn", async ({ page }) => {
  await open(page, 2_500);
  /* A window of the list and a margin, however many rows the folder holds. */
  expect(await rowsInDom(page)).toBeLessThan(150);
  expect(await page.locator("[data-dag-sidebar-key]").count()).toBeLessThan(150);

  /* Row 2,500 is a screen away from the top of five thousand: it is drawn *and* in view. */
  const current = page.locator(fileRow(file(2_500)));
  await expect(current).toBeInViewport({ ratio: 1 });
  const t = (await tree(page).boundingBox())!;
  const r = (await current.boundingBox())!;
  expect(r.y).toBeGreaterThanOrEqual(t.y);
  expect(r.y + r.height).toBeLessThanOrEqual(t.y + t.height);
  /* Rows far from it are not in the page at all. */
  await expect(page.locator(fileRow(file(0)))).toHaveCount(0);
  await expect(page.locator(fileRow(file(4_999)))).toHaveCount(0);

  /* Every row still says where it is in its folder, drawn or not. */
  const item = page.locator(`[role="treeitem"]:has(${fileRow(file(2_500))})`);
  await expect(item).toHaveAttribute("aria-posinset", "2501");
  await expect(item).toHaveAttribute("aria-setsize", String(COUNT));

  /* Scrolling draws others, and lets go of the ones it left. */
  await tree(page).evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(page.locator(fileRow(file(2_500)))).toHaveCount(1);
  await tree(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator(fileRow(file(4_999)))).toHaveCount(1);
  await expect(page.locator(fileRow(file(2_400)))).toHaveCount(0);
});

test("the arrows, Home and End walk rows that are not in the DOM", async ({ page }) => {
  await open(page, 2_500);
  await page.locator(fileRow(file(2_500))).focus();
  await expect.poll(() => focused(page)).toBe(`note:${file(2_500)}`);

  /* A hundred rows down is far past the margin: every step has to find a row that was not drawn. */
  for (let i = 0; i < 100; i++) await page.keyboard.press("ArrowDown");
  await expect.poll(() => focused(page)).toBe(`note:${file(2_600)}`);
  const focus = page.locator(`${fileRow(file(2_600))}:focus`);
  await expect(focus).toBeInViewport({ ratio: 1 });

  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowUp");
  await expect.poll(() => focused(page)).toBe(`note:${file(2_570)}`);

  /* Shift and an arrow grows a selection from where it started, across rows that were drawn a moment ago. */
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowDown");
  await expect(page.locator("[data-dag-sidebar-bulk]")).toHaveAttribute("data-dag-sidebar-bulk", "4");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-sidebar-bulk]")).toHaveCount(0);

  /* Left goes to the folder the row is in, which is 2,570 rows up. */
  await page.locator(fileRow(file(2_570))).focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => focused(page)).toBe(`folder:${parent}/files`);
  await expect(page.locator(folderRow(`${parent}/files`))).toBeInViewport({ ratio: 1 });

  /* End is the last row of the tree, wherever the tree ends; Home the first. */
  await page.keyboard.press("End");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const item = el?.closest<HTMLElement>('[role="treeitem"]');
        return item ? item.getAttribute("aria-posinset") === item.getAttribute("aria-setsize") : null;
      }),
    )
    .toBe(true);
  await page.keyboard.press("Home");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const item = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[role="treeitem"]');
        return item ? `${item.getAttribute("aria-level")}.${item.getAttribute("aria-posinset")}` : null;
      }),
    )
    .toBe("1.1");
  expect(await rowsInDom(page)).toBeLessThan(150);
});

test("a rename box on a row survives scrolling it out of view, and Enter retitles the file", async ({ page }) => {
  await open(page, 2_500);
  await page.locator(fileRow(file(2_500))).focus();
  await page.keyboard.press("F2");
  const box = page.locator("[data-dag-sidebar-name]");
  await expect(box).toBeFocused();
  await box.fill("Half typed");

  /* Scrolled to the top of the tree: the row is thousands of rows outside the window, and its box is
     still there, with what was typed. */
  await tree(page).evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(box).not.toBeInViewport();
  await expect(box).toHaveCount(1);
  await expect(box).toHaveValue("Half typed");
  /* Back to it, and the same box, with what was typed in it. */
  await box.scrollIntoViewIfNeeded();
  await expect(box).toBeInViewport();
  await box.focus();
  await expect(box).toHaveValue("Half typed");

  await box.press("Enter");
  /* The title is the name: the file moves to what was typed, in the same folder. */
  await expect.poll(() => fs.existsSync(path.join(dir, "files", "Half typed.md")), { timeout: 10_000 }).toBe(true);
  expect(fs.existsSync(path.join(dir, "files", `${row(2_500)}.md`))).toBe(false);
});

test("a selection runs from a row to one a screen of rows away, and acts on all of them", async ({ page }) => {
  await open(page, 100);
  /* Two rows picked, the second last: the focus is on it, so the first is drawn only while it is in view. */
  await page.locator(fileRow(file(110))).click({ modifiers: ["ControlOrMeta"] });
  await page.locator(fileRow(file(111))).click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator("[data-dag-sidebar-bulk]")).toHaveAttribute("data-dag-sidebar-bulk", "2");
  /* Scrolled until both are out of the page, so the range starts from rows that are not there. */
  await scrollTo(page, 100, 160);
  await expect(page.locator(fileRow(file(110)))).toHaveCount(0);
  await expect(page.locator(fileRow(file(160)))).toHaveCount(1);
  await page.locator(fileRow(file(160))).click({ modifiers: ["ControlOrMeta", "Shift"] });
  /* 110 to 160, both ends included: what was picked, and the run from the last one picked. */
  await expect(page.locator("[data-dag-sidebar-bulk]")).toHaveAttribute("data-dag-sidebar-bulk", "51");
  /* And it is kept, not drawn: a row scrolled back into view is still picked. */
  await scrollTo(page, 160, 120);
  await expect(page.locator(`${fileRow(file(120))}[data-dag-sidebar-picked]`)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-sidebar-picked]")).toHaveCount(0);
});

test("a file dragged from the end of the folder is dropped on the folder listed after it", async ({ page }) => {
  await open(page, 100);
  /* The bottom of the list: the last rows of `files/` are drawn now and were not a moment ago. */
  await tree(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const from = fileRow(file(4_990));
  const onto = folderRow(`${parent}/target`);
  await expect(page.locator(from)).toHaveCount(1);
  await expect(page.locator(onto)).toBeInViewport();

  const a = (await page.locator(from).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 3 });
  /* The row it came from is faded where it is. */
  await expect(page.locator(`${from}[data-dag-sidebar-lifted]`)).toHaveCount(1);
  await expect(async () => {
    const b = (await page.locator(onto).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await expect(page.locator(`${onto}[data-dag-sidebar-over]`)).toHaveCount(1, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await page.mouse.up();

  await expect.poll(() => fs.existsSync(path.join(dir, "target", `${row(4_990)}.md`)), { timeout: 10_000 }).toBe(true);
  expect(fs.existsSync(path.join(dir, "files", `${row(4_990)}.md`))).toBe(false);
  await expect(page.locator("[data-dag-sidebar-over]")).toHaveCount(0);
  await expect(page.locator("[data-dag-sidebar-lifted]")).toHaveCount(0);
});
