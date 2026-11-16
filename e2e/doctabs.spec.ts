import fs from "node:fs";
import path from "node:path";

import { BOARDS, openBoards } from "./boards";
import { expect, test, type Page } from "./fixture";
import { clickOnHover } from "./hover";
import { openSidebar } from "./sidebar";
import { suiteVault } from "./vault";

/**
 * Documents in tabs across the top of the page (#264): a middle click, Ctrl/⌘ and a click, or a
 * row's *Open in a new tab* opens one; the strip switches, closes and makes a Home tab; and the
 * window's Back and Forward walk across the tabs, as a browser's do inside one tab.
 *
 * Every file lives in a folder of this check's own, cleaned up by name (`history.spec.ts`).
 */

let folder = "";
const board = (title: string, id: string): string =>
  `---\ntitle: ${title}\n---\n\n\`\`\`md {#${id} x=0 y=0 w=320}\n${title}\n\`\`\`\n`;

test.beforeEach(async ({ page }, info) => {
  folder = `e2e-doctabs-${info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  fs.mkdirSync(path.join(BOARDS, folder), { recursive: true });
  for (const id of ["a", "b", "c"]) fs.writeFileSync(path.join(BOARDS, folder, `${id}.board.md`), board(id.toUpperCase(), id));
  fs.writeFileSync(path.join(BOARDS, folder, "idea.note.md"), "---\ntitle: Idea\n---\n# Idea\n\nStart.\n");
  const vault = await suiteVault(page.request);
  await expect
    .poll(
      async () => {
        const body = (await (await page.request.get("/__board/list", { params: { vault } })).json()) as {
          boards: string[];
          notes: string[];
        };
        return ["a", "b", "c"].every((n) => body.boards.includes(name(n))) && body.notes.includes(name("idea"));
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});
test.afterEach(() => {
  if (folder) fs.rmSync(path.join(BOARDS, folder), { recursive: true, force: true });
  folder = "";
});

const name = (file: string) => `${folder}/${file}`;
const item = (page: Page, id: string) => page.locator(`[data-dag-item="${id}"]`);
const here = (page: Page) => new URL(page.url()).searchParams.get("board");
const fileRow = (page: Page, file: string) => page.locator(`[data-dag-sidebar-file="${name(file)}"]`);
const strip = (page: Page) => page.locator("[data-dag-doctabs]");
const tabs = (page: Page) => page.locator("[data-dag-doctab]");
const front = (page: Page) => page.locator('[data-dag-doctab][aria-selected="true"]');
const tabNamed = (page: Page, label: string) => tabs(page).filter({ hasText: label });

async function openA(page: Page): Promise<void> {
  await page.goto(`/?board=${name("a")}`);
  await expect(item(page, "a")).toBeVisible({ timeout: 10_000 });
  await openSidebar(page);
  await expect(fileRow(page, "b")).toHaveCount(1, { timeout: 10_000 });
}

test("one document draws no strip; a middle click on a row opens a tab behind, and its tab brings it forward", async ({
  page,
}) => {
  await openA(page);
  await expect(strip(page)).toHaveCount(0);

  await fileRow(page, "b").click({ button: "middle" });
  await expect(tabs(page)).toHaveCount(2);
  await expect(front(page)).toHaveText("A");
  /* Behind: the window is still on A, and B is not drawn. */
  expect(here(page)).toBe(name("a"));
  await expect(item(page, "a")).toBeVisible();

  await tabNamed(page, "B").click();
  await expect(item(page, "b")).toBeVisible({ timeout: 10_000 });
  await expect(front(page)).toHaveText("B");
  expect(here(page)).toBe(name("b"));

  /* Back is the window's: to A, in A's tab; Forward to B again. */
  await page.goBack();
  await expect(item(page, "a")).toBeVisible({ timeout: 10_000 });
  await expect(front(page)).toHaveText("A");
  await page.goForward();
  await expect(item(page, "b")).toBeVisible({ timeout: 10_000 });
  await expect(front(page)).toHaveText("B");
});

test("closing the tab in front shows its neighbour, and the last one left takes the strip away", async ({ page }) => {
  await openA(page);
  await fileRow(page, "b").click({ button: "middle" });
  await tabNamed(page, "B").click();
  await expect(item(page, "b")).toBeVisible({ timeout: 10_000 });

  await page.locator(`[data-dag-doctab-close]`).nth(1).click();
  await expect(item(page, "a")).toBeVisible({ timeout: 10_000 });
  expect(here(page)).toBe(name("a"));
  await expect(strip(page)).toHaveCount(0);

  /* A middle click on a tab closes it, as in a browser — and one in the background leaves the page alone. */
  await fileRow(page, "c").click({ button: "middle" });
  await expect(tabs(page)).toHaveCount(2);
  await tabNamed(page, "C").click({ button: "middle" });
  await expect(strip(page)).toHaveCount(0);
  expect(here(page)).toBe(name("a"));
});

test("Ctrl/⌘ and a click on a search hit opens it behind, and with Shift as well in front", async ({ page }) => {
  await openA(page);
  const mod = process.platform === "darwin" ? "Meta" : "Control";

  await openBoards(page);
  await page.locator(`[data-dag-board="${name("b")}"]`).click({ modifiers: [mod] });
  await expect(tabs(page)).toHaveCount(2);
  await expect(front(page)).toHaveText("A");
  expect(here(page)).toBe(name("a"));

  await openBoards(page);
  await page.locator(`[data-dag-board="${name("c")}"]`).click({ modifiers: [mod, "Shift"] });
  await expect(tabs(page)).toHaveCount(3);
  await expect(item(page, "c")).toBeVisible({ timeout: 10_000 });
  await expect(front(page)).toHaveText("C");
  /* The new tab goes next to the one it came from. */
  await expect(tabs(page)).toHaveText(["A", "C", "B"]);
});

test("a row's Open in a new tab, and a document already in a tab is not opened twice", async ({ page }) => {
  await openA(page);
  await clickOnHover(page, `[data-dag-sidebar-file="${name("idea")}"]`, `[data-dag-sidebar-more="${name("idea")}"]`);
  await page.locator('[data-dag-sidebar-menu-item="open-tab"]').click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(page.locator('[data-dag-doctab-kind="note"]')).toHaveText("Idea");
  await expect(front(page)).toHaveText("A");

  /* A plain click on the note's row goes to the tab holding it, rather than opening it in A's. */
  await fileRow(page, "idea").click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(front(page)).toHaveText("Idea");
  expect(new URL(page.url()).searchParams.get("note")).toBe(name("idea"));
  expect(here(page)).toBeNull();
});

test("the strip’s + opens Home in front, next to its tab, and a document opened from it stays there", async ({ page }) => {
  await openA(page);
  await fileRow(page, "b").click({ button: "middle" });
  await page.locator("[data-dag-doctab-new]").click();
  await expect(tabs(page)).toHaveCount(3);
  await expect(front(page)).toHaveText("Home");
  expect(here(page)).toBeNull();

  await fileRow(page, "c").click();
  await expect(item(page, "c")).toBeVisible({ timeout: 10_000 });
  await expect(tabs(page)).toHaveText(["A", "C", "B"]);
  await expect(front(page)).toHaveText("C");
});
