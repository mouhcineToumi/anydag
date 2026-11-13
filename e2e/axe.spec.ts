import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { expectAccessible } from "./axe";
import { BOARDS, openBoards } from "./boards";
import { openSidebar } from "./sidebar";
import { vaulted } from "./vault";

/**
 * The shell's accessibility gate: home, a board, a note and the search, with the sidebar docked
 * so its file tree is part of what is measured.
 *
 * **The tree is the reason the sidebar is open.** The suite starts with it put away, and a page
 * without it would pass while the tree was the thing axe reported. The vault menu's own items are
 * covered by its roles rather than by opening it here: it is shut on a page that has just loaded.
 *
 * Each test owns a folder, because the suite runs several workers wide over one `boards/`.
 */

let folder = "";
const board = () => `${folder}/plan`;
const note = () => `${folder}/journal`;

const BOARD = `---
title: Axe plan
---

\`\`\`md {#a x=0 y=0 w=320}
hi
\`\`\`
`;
const NOTE = `---
title: Journal
---

# Journal

A paragraph.
`;

test.beforeEach(({}, info) => {
  folder = `e2e-axe-${info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  fs.mkdirSync(path.join(BOARDS, folder), { recursive: true });
  fs.writeFileSync(path.join(BOARDS, `${board()}.board.md`), BOARD);
  fs.writeFileSync(path.join(BOARDS, `${note()}.note.md`), NOTE);
});
test.afterEach(() => {
  if (folder) fs.rmSync(path.join(BOARDS, folder), { recursive: true, force: true });
  folder = "";
});

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

test.describe("the shell passes axe", { tag: "@smoke" }, () => {
  test("home", async ({ page }) => {
    await page.goto(await vaulted(page, "/"));
    await expect(page.locator("[data-dag-welcome]")).toBeVisible({ timeout: 20_000 });
    await openSidebar(page);
    await expect(page.locator('[data-dag-sidebar] [role="tree"]')).toBeVisible();
    await expectAccessible(page);
  });

  test("a board", async ({ page }) => {
    await page.goto(await vaulted(page, `/?board=${board()}`));
    await ready(page);
    await openSidebar(page);
    await expect(page.locator('[data-dag-item="a"]')).toBeVisible();
    /* The tree owns treeitems and nothing else, and a row's tools are inside the row's treeitem. */
    const tree = page.locator('[data-dag-sidebar] [role="tree"]');
    await expect(tree.locator(":scope > :not([role=treeitem])")).toHaveCount(0);
    const tools = tree.locator(".dag-sidebar__tools");
    expect(await tools.count()).toBeGreaterThan(0);
    expect(await tools.evaluateAll((els) => els.every((el) => el.parentElement?.getAttribute("role") === "treeitem"))).toBe(true);
    await expectAccessible(page);
  });

  test("a note", async ({ page }) => {
    await page.goto(await vaulted(page, `/?note=${note()}`));
    const field = page.locator("[data-dag-note-editor] [contenteditable=true]");
    await expect(field).toBeVisible({ timeout: 20_000 });
    /* The editor is a field with no visible label of its own; its name is the note's title. */
    await expect(field).toHaveAttribute("aria-label", "Journal");
    await openSidebar(page);
    await expectAccessible(page);
  });

  test("search", async ({ page }) => {
    await page.goto(await vaulted(page, `/?board=${board()}`));
    await ready(page);
    await openSidebar(page);
    await openBoards(page);
    await expectAccessible(page);
  });
});
