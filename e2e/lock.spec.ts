import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { lead } from "./keys";
import { openSidebar } from "./sidebar";

/**
 * The lock. Read only, so nothing changes by accident: every check here
 * reads the **file** after trying to change it, because the whole of the feature is that the file
 * does not move — and the notice, because a press that did nothing and said nothing would read as a
 * broken page.
 *
 * Each test writes into a folder of its own, for the suite's eight workers over one `boards/`.
 */

let folder = "";
let dir = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-lock-${info.testId}`;
  dir = path.join(BOARDS, folder);
  fs.mkdirSync(dir, { recursive: true });
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  /* Only the folder this test made, and only when it knows which (`CLAUDE.md`, *Things that will bite*). */
  if (folder) fs.rmSync(dir, { recursive: true, force: true });
  folder = "";
  expect(problems, "console output").toEqual([]);
});

const BOARD = `---
title: Locked board
---

\`\`\`md {#one x=0 y=0 w=280}
The first item.
\`\`\`

\`\`\`md {#two x=360 y=0 w=280}
The second item.
\`\`\`
`;

function board(): { name: string; file: string } {
  const file = path.join(dir, "board.board.md");
  fs.writeFileSync(file, BOARD);
  return { name: `${folder}/board`, file };
}

/** Lock this browser before the page loads, the way a reload of a locked tab finds it. */
async function lockFirst(page: Page) {
  await page.addInitScript(() => localStorage.setItem("dag:locked", "1"));
}

async function ready(page: Page) {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

const notice = (page: Page) => page.locator("[data-dag-readonly-notice]");

test("the top bar's switch and ctrl+shift+L lock and unlock, every tab of the browser hears it, and a reload keeps it", async ({ page, context }) => {
  /* Two tabs and a reload are three boards drawn: more than one page's worth of time. */
  test.setTimeout(60_000);
  const { name } = board();
  await page.goto(`/?board=${name}`);
  await ready(page);
  const button = page.locator("[data-dag-readonly]");
  /* Unlocked, the bar carries no lock at all: the switch is in the ⋯ (the UI review). */
  await expect(button).toHaveCount(0);
  await page.locator("[data-dag-page-more]").click();
  await expect(page.locator("[data-dag-readonly-lock]")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+Shift+L");
  await expect(button).toHaveAttribute("data-dag-readonly", "on");
  await expect(button).toHaveText(/Read only/);
  await expect(notice(page)).toHaveAttribute("data-dag-readonly-notice", "locked");
  await expect(page.locator("html")).toHaveAttribute("data-dag-locked", "");

  /* Another tab of this browser is locked too, through the `storage` event. */
  const other = await context.newPage();
  await other.goto(`/?board=${name}`);
  await ready(other);
  await expect(other.locator("[data-dag-readonly]")).toHaveAttribute("data-dag-readonly", "on");

  /* A reload is still locked: it is this browser's, until it is unlocked. */
  await page.reload();
  await ready(page);
  await expect(page.locator("[data-dag-readonly]")).toHaveAttribute("data-dag-readonly", "on");

  await page.locator("[data-dag-readonly]").click();
  await expect(page.locator("[data-dag-readonly]")).toHaveCount(0);
  await expect(notice(page)).toHaveAttribute("data-dag-readonly-notice", "unlocked");
  await expect(other.locator("[data-dag-readonly]")).toHaveCount(0);

  /* And the ⋯'s row locks it again. */
  await page.locator("[data-dag-page-more]").click();
  await page.locator("[data-dag-readonly-lock]").click();
  await expect(page.locator("[data-dag-readonly]")).toHaveAttribute("data-dag-readonly", "on");
  await other.close();
});

test("a locked board is selected and panned, never moved, deleted, pasted onto or typed into", { tag: "@smoke" }, async ({ page }) => {
  const { name, file } = board();
  const before = fs.readFileSync(file, "utf8");
  await lockFirst(page);
  await page.goto(`/?board=${name}`);
  await ready(page);
  /* Every tool on the dock makes something, so there is none; the zoom is its own bar. */
  await expect(page.locator(".dag-dock")).toHaveCount(0);

  const item = page.locator('[data-dag-item="one"]');
  const at = (await item.boundingBox())!;
  await page.mouse.move(at.x + 40, at.y + 12);
  await page.mouse.down();
  await page.mouse.move(at.x + 140, at.y + 112, { steps: 8 });
  await page.mouse.up();
  /* Selected, with no handle to resize or connect, and a bar that only exports. */
  await expect(item).toHaveAttribute("data-dag-selected", "");
  await expect(page.locator(".dag-handle, .dag-connect-handle")).toHaveCount(0);
  await expect(page.locator("[data-dag-selbar] [data-dag-selbar-export]")).toBeVisible();
  await expect(page.locator("[data-dag-selbar-delete], [data-dag-selbar-duplicate]")).toHaveCount(0);

  await page.keyboard.press("Delete");
  await expect(notice(page)).toHaveAttribute("data-dag-readonly-notice", "refused");
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Enter");
  await expect(page.locator(".dag-inspector")).toHaveCount(0);
  await lead(page, "n");
  await page.mouse.dblclick(at.x + 40, at.y + 400);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "pasted while locked");
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  });
  await page.waitForTimeout(500);
  expect(fs.readFileSync(file, "utf8")).toBe(before);
  await expect(page.locator(".dag-item")).toHaveCount(2);

  /* Unlocked, the board is a board again. */
  await page.keyboard.press("Control+Shift+L");
  await expect(page.locator(".dag-dock")).toBeVisible();
});

test("a locked note is read where it is written, and typing into it says why nothing happens", async ({ page }) => {
  const file = path.join(dir, "note.note.md");
  const text = "---\ntitle: Locked note\n---\nSomething to read.\n";
  fs.writeFileSync(file, text);
  await lockFirst(page);
  await page.goto(`/?note=${folder}/note`);
  const editor = page.locator("[data-dag-note-editor]");
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await expect(editor.locator('[contenteditable="false"]').first()).toBeAttached();
  await expect(page.locator("[data-dag-note-title]")).toHaveJSProperty("readOnly", true);

  await editor.getByText("Something to read.").click();
  await page.keyboard.type("xyz");
  await expect(notice(page)).toHaveAttribute("data-dag-readonly-notice", "refused");

  /* The `⋯` says what unlocking gives back, greyed, rather than leaving it out. */
  await page.locator("[data-dag-page-more]").click();
  await expect(page.locator("[data-dag-page-more-menu] [data-dag-note-make-task]")).toBeDisabled();
  await expect(page.locator("[data-dag-page-more-menu] [data-dag-toolbar-rename]")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  expect(fs.readFileSync(file, "utf8")).toBe(text);
});

test("the sidebar opens and selects while locked, and makes, renames and deletes nothing", async ({ page }) => {
  const { name, file } = board();
  const before = fs.readFileSync(file, "utf8");
  await lockFirst(page);
  await page.goto(`/?board=${name}`);
  await ready(page);
  await openSidebar(page);

  await page.locator("[data-dag-sidebar-new]").click({ force: true });
  await expect(notice(page)).toHaveAttribute("data-dag-readonly-notice", "refused");
  await expect(page.locator("[data-dag-sidebar-new-menu]")).toHaveCount(0);
  await expect(page.locator("[data-dag-sidebar-add]")).toHaveCount(0);

  const row = page.locator(`[data-dag-sidebar-row][data-dag-sidebar-key="board:${name}"]`);
  await row.click({ button: "right" });
  await expect(page.locator("[data-dag-sidebar-menu-locked]")).toBeVisible();
  for (const what of ["rename", "duplicate", "move", "delete"]) await expect(page.locator(`[data-dag-sidebar-menu-item="${what}"]`)).toHaveCount(0);
  await expect(page.locator('[data-dag-sidebar-menu-item="favourite"]')).toBeVisible();
  await page.keyboard.press("Escape");

  await row.focus();
  await page.keyboard.press("F2");
  await expect(page.locator("[data-dag-sidebar-name]")).toHaveCount(0);
  await expect(notice(page)).toHaveAttribute("data-dag-readonly-notice", "refused");
  expect(fs.existsSync(file)).toBe(true);
  expect(fs.readFileSync(file, "utf8")).toBe(before);
});

test("a locked table is read, and its grid answers a keystroke with the notice", async ({ page }) => {
  const file = path.join(dir, "costs.table.md");
  const text = "---\ntitle: Costs\n---\n\n## Costs {#costs}\n\n| Item {#item} | Amount {#amount number} |\n| --- | ---: |\n| Hosting {#r1aaaa} | 120 |\n";
  fs.writeFileSync(file, text);
  await lockFirst(page);
  await page.goto(`/?table=${folder}/costs`);
  const cell = page.locator('[data-dag-grid-at="0:1"]');
  await expect(cell).toBeVisible({ timeout: 20_000 });
  await cell.click();
  await page.keyboard.type("9");
  await page.keyboard.press("Enter");
  await expect(notice(page)).toHaveAttribute("data-dag-readonly-notice", "refused");
  await expect(page.locator("[data-dag-grid-editing]")).toHaveCount(0);
  await expect(page.locator("[data-dag-tablepage-undo]")).toBeDisabled();
  await page.waitForTimeout(500);
  expect(fs.readFileSync(file, "utf8")).toBe(text);
});
