import fs from "node:fs";
import path from "node:path";

import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";
import { openSidebar } from "./sidebar";
import { suiteVault } from "./vault";

/**
 * The document tabs from the keyboard and the strip (#264): Ctrl/⌘+T, +W, +Tab, +1…9 and
 * +Shift+T as in a browser, a tab moved by Shift and an arrow or by a drag, and the tab's menu with
 * *Close others*. A browser keeps these chords for itself; the suite's Chromium has no tabs of its
 * own and hands them to the page, as the desktop app does (`src/ui/tabs/keys.ts`).
 */

let folder = "";
const board = (id: string): string => `---\ntitle: ${id.toUpperCase()}\n---\n\n\`\`\`md {#${id} x=0 y=0 w=320}\n${id}\n\`\`\`\n`;

test.beforeEach(async ({ page }, info) => {
  folder = `e2e-tabkeys-${info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  fs.mkdirSync(path.join(BOARDS, folder), { recursive: true });
  for (const id of ["a", "b", "c"]) fs.writeFileSync(path.join(BOARDS, folder, `${id}.board.md`), board(id));
  const vault = await suiteVault(page.request);
  await expect
    .poll(
      async () => {
        const body = (await (await page.request.get("/__board/list", { params: { vault } })).json()) as { boards: string[] };
        return ["a", "b", "c"].every((n) => body.boards.includes(name(n)));
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});
test.afterEach(() => {
  if (folder) fs.rmSync(path.join(BOARDS, folder), { recursive: true, force: true });
  folder = "";
});

const name = (f: string) => `${folder}/${f}`;
const tabs = (page: Page) => page.locator("[data-dag-doctab]");
const front = (page: Page) => page.locator('[data-dag-doctab][aria-selected="true"]');
const tab = (page: Page, label: string) => tabs(page).filter({ hasText: new RegExp(`^${label}$`) });
const here = (page: Page) => new URL(page.url()).searchParams.get("board");
const mod = process.platform === "darwin" ? "Meta" : "Control";

/** A, B and C in three tabs, A in front. */
async function three(page: Page): Promise<void> {
  await page.goto(`/?board=${name("a")}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await openSidebar(page);
  for (const f of ["b", "c"]) {
    const row = page.locator(`[data-dag-sidebar-file="${name(f)}"]`);
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await row.click({ button: "middle" });
  }
  await expect(tabs(page)).toHaveText(["A", "B", "C"]);
  await expect(front(page)).toHaveText("A");
}

test("Ctrl+Tab and Ctrl+Shift+Tab step round the ends, and Ctrl+digit goes to a place, 9 the last", async ({ page }) => {
  await three(page);
  await page.keyboard.press("Control+Tab");
  await expect(front(page)).toHaveText("B");
  await expect.poll(() => here(page)).toBe(name("b"));
  await page.keyboard.press("Control+Shift+Tab");
  await page.keyboard.press("Control+Shift+Tab");
  await expect(front(page)).toHaveText("C");
  await page.keyboard.press("Control+PageDown");
  await expect(front(page)).toHaveText("A");
  await page.keyboard.press(`${mod}+2`);
  await expect(front(page)).toHaveText("B");
  await page.keyboard.press(`${mod}+9`);
  await expect(front(page)).toHaveText("C");
  await expect.poll(() => here(page)).toBe(name("c"));
});

test("Ctrl+T opens Home in front, Ctrl+W closes it, and Ctrl+Shift+T brings the last closed back where it was", async ({
  page,
}) => {
  await three(page);
  await page.keyboard.press(`${mod}+t`);
  await expect(tabs(page)).toHaveText(["A", "Home", "B", "C"]);
  await expect(front(page)).toHaveText("Home");
  expect(here(page)).toBeNull();

  await page.keyboard.press(`${mod}+w`);
  await expect(tabs(page)).toHaveText(["A", "B", "C"]);
  await expect(front(page)).toHaveText("B");

  await page.keyboard.press(`${mod}+w`);
  await expect(tabs(page)).toHaveText(["A", "C"]);
  await page.keyboard.press(`${mod}+Shift+t`);
  await expect(tabs(page)).toHaveText(["A", "B", "C"]);
  await expect(front(page)).toHaveText("B");
  await expect.poll(() => here(page)).toBe(name("b"));
});

test("Shift and an arrow move the focused tab, and a drag puts one where it is let go", async ({ page }) => {
  await three(page);
  await tab(page, "A").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(tabs(page)).toHaveText(["B", "A", "C"]);
  await expect(tab(page, "A")).toBeFocused();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(tabs(page)).toHaveText(["B", "C", "A"]);
  /* At the end it stays. */
  await page.keyboard.press("Shift+ArrowRight");
  await expect(tabs(page)).toHaveText(["B", "C", "A"]);

  const from = (await tab(page, "A").boundingBox())!;
  const onto = (await tab(page, "B").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 - 20, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(onto.x + 10, onto.y + onto.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(tabs(page)).toHaveText(["A", "B", "C"]);
  /* A drag is not a click: the tab in front is still A, which it was. */
  await expect(front(page)).toHaveText("A");
});

test("a tab's menu closes the others, each of which can come back", async ({ page }) => {
  await three(page);
  await tab(page, "B").click({ button: "right" });
  const menu = page.locator("[data-dag-doctab-menu]");
  await expect(menu).toBeVisible();
  await menu.locator('[data-dag-doctab-menu-item="others"]').click();
  await expect(page.locator("[data-dag-doctabs]")).toHaveCount(0);
  await expect.poll(() => here(page)).toBe(name("b"));

  await page.keyboard.press(`${mod}+Shift+t`);
  await expect(tabs(page)).toHaveText(["B", "C"]);
  await page.keyboard.press(`${mod}+Shift+t`);
  await expect(tabs(page)).toHaveText(["A", "B", "C"]);

  /* From the keyboard: Shift+F10 on the focused tab, and Escape gives the focus back. */
  await tab(page, "C").focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(tab(page, "C")).toBeFocused();
});
