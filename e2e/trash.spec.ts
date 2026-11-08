import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { clickOnHover } from "./hover";
import { openSidebar } from "./sidebar";

/**
 * The trash: a delete asks nothing and offers Undo, and the Trash page
 * lists what went, restores it, and deletes it for good.
 *
 * **Every test is in a vault of its own**, because the trash is the vault's and the suite runs wide
 * over one: Empty trash in the suite's vault would empty every other worker's trash under them, and
 * an Undo there would find nothing to put back.
 */

const BOARD = (title: string) => `---\ntitle: ${title}\n---\n\n\`\`\`md {#a x=0 y=0 w=320}\n${title}\n\`\`\`\n`;

let id = "";
let made: string[] = [];
let parents: string[] = [];
const dirs = new Map<string, string>();

test.beforeEach(({}, info) => {
  id = info.testId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(-10);
  made = [];
  parents = [];
});

test.afterEach(async ({ page }) => {
  /* Off the page first, `vaults.spec.ts`'s reason: closing the vault a tab is in sends it elsewhere. */
  await page.goto("about:blank").catch(() => undefined);
  await page.request.post("/api/vaults/open", { data: { path: BOARDS } }).catch(() => undefined);
  for (const v of made) await page.request.post("/api/vaults/close", { data: { id: v, forget: true } }).catch(() => undefined);
  for (const p of parents) fs.rmSync(p, { recursive: true, force: true });
});

/** A vault's folder. */
const dirOf = (v: string) => dirs.get(v)!;

/** A vault of the test's own under a temp directory, and the suite's put back as the one a bare `/` opens. */
async function workspace(page: Page): Promise<string> {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-e2e-trash-"));
  parents.push(parent);
  const r = await page.request.post("/api/vaults/create", { data: { parent, name: `trash${id}` } });
  expect(r.ok(), await r.text()).toBe(true);
  const vault = ((await r.json()) as { vault: { id: string; path: string } }).vault;
  made.push(vault.id);
  dirs.set(vault.id, vault.path);
  await page.request.post("/api/vaults/open", { data: { path: BOARDS } });
  return vault.id;
}

/** A board titled `title`, and the name it was given: in a vault a new file is named after its title (decision 14). */
async function make(page: Page, ws: string, name: string, title: string): Promise<string> {
  const r = await page.request.post(`/__board/create?vault=${ws}`, { data: { name, text: BOARD(title) } });
  expect(r.ok(), await r.text()).toBe(true);
  return ((await r.json()) as { name: string }).name;
}

async function trashed(page: Page, ws: string, name: string): Promise<void> {
  const r = await page.request.post(`/__board/delete?vault=${ws}`, { data: { name } });
  expect(r.ok(), await r.text()).toBe(true);
}

const entry = (page: Page, name: string) => page.locator(`[data-dag-trash-entry="${name}"]`);

test("a board deleted from the sidebar is in the trash, and Restore puts it back to open", { tag: "@smoke" }, async ({
  page,
}) => {
  const ws = await workspace(page);
  const plan = await make(page, ws, "plan", "Q3 plan");
  expect(plan).toBe("Q3 plan");
  await page.goto(`/?board=${encodeURIComponent(plan)}&vault=${ws}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await openSidebar(page);

  await clickOnHover(page, `[data-dag-sidebar-file="${plan}"]`, `[data-dag-sidebar-more="${plan}"]`);
  await page.locator('[data-dag-sidebar-menu-item="delete"]').click();
  await expect(page.locator("[data-dag-trash-notice]")).toContainText("Moved “Q3 plan” to the trash.");
  await expect.poll(() => fs.existsSync(path.join(dirOf(ws), `${plan}.board.md`))).toBe(false);
  await expect(page.locator("[data-dag-welcome]")).toBeVisible({ timeout: 10_000 });

  /* View trash, from the notice: the page, with the row in the sidebar marked as where you are. */
  await page.locator("[data-dag-trash-view]").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("trash")).toBe("1");
  await expect(page.locator("[data-dag-sidebar-trash]")).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-dag-trash-days]")).toContainText("30 days");
  await expect(entry(page, plan)).toContainText("Q3 plan");
  await expect(entry(page, plan)).toContainText("Board");
  /* When it went and how long it has are said once, on the day it sits under. */
  await expect(page.locator('[data-dag-trash-day="today"]', { has: entry(page, plan) })).toContainText("Today30 days left");

  await entry(page, plan).locator("[data-dag-trash-restore]").click();
  await expect(entry(page, plan)).toHaveCount(0);
  await expect(page.locator(`[data-dag-trash-restored="${plan}"]`)).toContainText("Restored “Q3 plan”.");
  await expect.poll(() => fs.existsSync(path.join(dirOf(ws), `${plan}.board.md`))).toBe(true);
  await expect(page.locator(`[data-dag-sidebar-file="${plan}"]`)).toBeVisible();
  await page.locator("[data-dag-trash-open]").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("board")).toBe(plan);
});

test("Delete forever asks in its row, and Empty trash asks once", async ({ page }) => {
  const ws = await workspace(page);
  for (const n of ["one", "two", "three"]) await trashed(page, ws, await make(page, ws, n, n.toUpperCase()));
  await page.goto(`/?trash=1&vault=${ws}`);
  /* The first page a cold dev server serves can take its time; 15 s, the suite's first-load wait. */
  await expect(page.locator("[data-dag-trash-entry]")).toHaveCount(3, { timeout: 15_000 });

  /* The filter narrows the list by what each was called or where it was. */
  await page.locator("[data-dag-trash-filter]").fill("tw");
  await expect(page.locator("[data-dag-trash-entry]")).toHaveCount(1);
  await page.locator("[data-dag-trash-filter]").fill("");

  await entry(page, "ONE").locator("[data-dag-trash-forget]").click();
  /* The one delete left that cannot be taken back asks, and the key pressed without reading is the
     one that keeps it: Escape here is nothing, and the confirm is a second, separate press. */
  const confirm = entry(page, "ONE").locator("[data-dag-trash-forget-confirm]");
  await expect(confirm).toBeFocused();
  await confirm.click();
  await expect(entry(page, "ONE")).toHaveCount(0);
  const left = (await (await page.request.get(`/__board/trash?vault=${ws}`)).json()) as { entries: unknown[] };
  expect(left.entries).toHaveLength(2);

  await page.locator("[data-dag-trash-empty]").click();
  await expect(page.locator("[data-dag-trash-empty-ask]")).toContainText("Delete the 2 items in the trash for good?");
  await page.locator("[data-dag-trash-empty-confirm]").click();
  await expect(page.locator("[data-dag-trash-none]")).toBeVisible();
  const none = (await (await page.request.get(`/__board/trash?vault=${ws}`)).json()) as { entries: unknown[] };
  expect(none.entries).toHaveLength(0);
});

test("the page hears a delete made somewhere else, and a folder is one entry", async ({ page }) => {
  const ws = await workspace(page);
  expect(await make(page, ws, "work/plan", "Plan")).toBe("work/Plan");
  expect(await make(page, ws, "work/notes", "Notes")).toBe("work/Notes");
  await page.goto(`/?trash=1&vault=${ws}`);
  await expect(page.locator("[data-dag-trash-none]")).toBeVisible({ timeout: 15_000 });

  /* An agent, the CLI or another tab: the feed says the trash changed, and the page asks again. */
  const r = await page.request.post(`/__board/rmdir?vault=${ws}`, { data: { name: "work", recursive: true } });
  expect(r.ok(), await r.text()).toBe(true);
  await expect(entry(page, "work")).toBeVisible({ timeout: 10_000 });
  await expect(entry(page, "work")).toContainText("2 files");
  await expect(page.locator("[data-dag-trash-entry]")).toHaveCount(1);

  await entry(page, "work").locator("[data-dag-trash-restore]").click();
  await expect.poll(() => fs.existsSync(path.join(dirOf(ws), "work", "Notes.board.md"))).toBe(true);
  expect(fs.existsSync(path.join(dirOf(ws), "work", "Plan.board.md"))).toBe(true);
});
