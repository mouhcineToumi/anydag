import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS, openBoards } from "./boards";
import { clickOnHover } from "./hover";
import { openSidebar } from "./sidebar";
import { suiteVault, vaulted } from "./vault";

/**
 * Back and forward through the documents this window visited (#320).
 *
 * The entry is the address the app already uses, so this is also what makes the browser's own
 * Back work in `anydag serve`; the desktop app, which has no browser chrome, gets the keys and the
 * mouse from `src/ui/history.ts` and `desktop/main.ts`.
 *
 * Every file in a check lives in one folder of its own — the suite is eight workers wide over one
 * `boards/` — and the folder is cleaned up by name, which is the only thing that says which one is
 * ours (`CLAUDE.md`, *Things that will bite*).
 */

let folder = "";
const board = (name: string, id: string): string =>
  `---\ntitle: ${name}\n---\n\n\`\`\`md {#${id} x=0 y=0 w=320}\n${name}\n\`\`\`\n`;

test.beforeEach(async ({ page }, info) => {
  folder = `e2e-history-${info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  fs.mkdirSync(path.join(BOARDS, folder), { recursive: true });
  for (const [file, id] of [
    ["a", "a"],
    ["b", "b"],
    ["c", "c"],
  ] as const)
    fs.writeFileSync(path.join(BOARDS, folder, `${file}.board.md`), board(file.toUpperCase(), id));
  fs.writeFileSync(path.join(BOARDS, folder, "idea.note.md"), "---\ntitle: Idea\n---\n# Idea\n\nStart.\n");
  /* A listing is one round trip behind a file written with `fs`; a page opened in that window asks
     about a board the server has not heard of yet. Wait for the list, as `home.spec.ts` does. */
  const vault = await suiteVault(page);
  await expect
    .poll(
      async () => {
        const body = (await (await page.request.get("/__board/list", { params: { vault } })).json()) as {
          boards: string[];
          notes: string[];
        };
        return ["a", "b", "c"].every((name) => body.boards.includes(`${folder}/${name}`)) && body.notes.includes(name("idea"));
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});
test.afterEach(() => {
  /* Only the folder this check made, and only when it knows which. */
  if (folder) fs.rmSync(path.join(BOARDS, folder), { recursive: true, force: true });
  folder = "";
});

const name = (file: string) => `${folder}/${file}`;
const item = (page: Page, id: string) => page.locator(`[data-dag-item="${id}"]`);
const back = (page: Page) => page.locator("[data-dag-history-back]");
const forward = (page: Page) => page.locator("[data-dag-history-forward]");
const here = (page: Page) => new URL(page.url()).searchParams.get("board");
const fileRow = (page: Page, file: string) => page.locator(`[data-dag-sidebar-file="${name(file)}"]`);

/** A row's `⋯`, then one item of its menu — the hover pair `folders.spec.ts` uses. */
async function menu(page: Page, row: string, more: string, item: string): Promise<void> {
  await clickOnHover(page, row, `[data-dag-sidebar-more="${more}"]`);
  await page.locator(`[data-dag-sidebar-menu-item="${item}"]`).click();
}

/** Open A, dock the sidebar with its folder open, and have B a row away. */
async function openA(page: Page): Promise<void> {
  await page.goto(await vaulted(page, `/?board=${name("a")}`));
  await expect(item(page, "a")).toBeVisible({ timeout: 10_000 });
  await openSidebar(page);
  /* The open file's folders are always opened by `Shell`, so A's row is in the tree. */
  await expect(fileRow(page, "a")).toHaveCount(1, { timeout: 10_000 });
}

/** A is open; B comes from a row, C from the search — the ways this app opens a file. */
async function openABC(page: Page): Promise<void> {
  await fileRow(page, "b").click();
  await expect(item(page, "b")).toBeVisible({ timeout: 10_000 });

  await openBoards(page);
  await page.locator(`[data-dag-board="${name("c")}"]`).click();
  await expect(item(page, "c")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => here(page)).toBe(name("c"));
}

test("A, then B, then C: Back twice is A, and Forward is B", { tag: "@smoke" }, async ({ page }) => {
  await openA(page);
  await expect(back(page)).toBeDisabled();
  await expect(forward(page)).toBeDisabled();

  await openABC(page);
  await expect(back(page)).toBeEnabled();
  await expect(forward(page)).toBeDisabled();

  await back(page).click();
  await expect.poll(() => here(page)).toBe(name("b"));
  await expect(item(page, "b")).toBeVisible({ timeout: 10_000 });

  await back(page).click();
  await expect.poll(() => here(page)).toBe(name("a"));
  await expect(item(page, "a")).toBeVisible({ timeout: 10_000 });
  await expect(back(page)).toBeDisabled();
  await expect(forward(page)).toBeEnabled();

  await forward(page).click();
  await expect.poll(() => here(page)).toBe(name("b"));
  await expect(item(page, "b")).toBeVisible({ timeout: 10_000 });
  await expect(back(page)).toBeEnabled();
  await expect(forward(page)).toBeEnabled();
});

test("a renamed file in the history is followed, not opened under its old name", async ({ page }) => {
  await openA(page);
  await fileRow(page, "b").click();
  await expect(item(page, "b")).toBeVisible({ timeout: 10_000 });

  /* Renamed from A's own row, which is what the sidebar does: the file moves to its title. */
  await menu(page, `[data-dag-sidebar-file="${name("a")}"]`, name("a"), "rename");
  const box = page.locator("[data-dag-sidebar-name]");
  await box.fill("History renamed");
  await box.press("Enter");
  await expect(page.locator(`[data-dag-sidebar-file="${folder}/History renamed"]`)).toHaveCount(1, { timeout: 10_000 });

  await back(page).click();
  await expect.poll(() => here(page)).toBe(`${folder}/History renamed`);
  await expect(item(page, "a")).toBeVisible({ timeout: 10_000 });
});

test("a trashed file in the history is skipped, and home stands where it was", async ({ page }) => {
  await openA(page);
  await fileRow(page, "b").click();
  await expect(item(page, "b")).toBeVisible({ timeout: 10_000 });

  await menu(page, `[data-dag-sidebar-file="${name("a")}"]`, name("a"), "delete");
  await expect(fileRow(page, "a")).toHaveCount(0, { timeout: 10_000 });

  /* A is the entry before B, and A has gone: Back walks past it to the start of the history. */
  await back(page).click();
  await expect(page.locator("[data-dag-welcome]")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => here(page)).toBeNull();
  await expect(back(page)).toBeDisabled();
  await expect(forward(page)).toBeEnabled();
});

test("going back from a note with unsaved typing saves it first", async ({ page }) => {
  await openA(page);
  await openBoards(page);
  await page.locator(`[data-dag-note="${name("idea")}"]`).click();
  await expect(page.locator(".dag-note-view")).toBeVisible({ timeout: 10_000 });
  const note = path.join(BOARDS, folder, "idea.note.md");

  /* The save is on a debounce; Back is pressed inside it, so the write is the unmount's — the same
     one leaving through the sidebar does. */
  await page.locator(".bn-block-content", { hasText: "Start." }).first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Saved on the way back.");
  await back(page).click();

  await expect(item(page, "a")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => fs.readFileSync(note, "utf8"), { timeout: 5_000 }).toContain("Start. Saved on the way back.");
});

declare global {
  interface Window {
    /** The shell's `history:go`, as `desktop/preload.ts` hands it over — the stub's remote. */
    historyCommand?: (to: "back" | "forward") => void;
  }
}

test("the desktop's Alt+arrows, app commands and mouse buttons walk the history", async ({ page }) => {
  /* No Electron here, so the bridge is a stub of the parts the page reads: this is the shell that
     has no browser chrome, and `history.onCommand` is what `desktop/preload.ts` exposes for the
     app commands Windows and Linux send instead of DOM events. */
  await page.addInitScript(() => {
    (window as unknown as { anydagDesktop: unknown }).anydagDesktop = {
      platform: "linux",
      history: {
        onCommand(listener: (to: "back" | "forward") => void) {
          window.historyCommand = listener;
          return () => undefined;
        },
      },
    };
  });
  await openA(page);
  await fileRow(page, "b").click();
  await expect(item(page, "b")).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press("Alt+ArrowLeft");
  await expect.poll(() => here(page)).toBe(name("a"));
  await expect(item(page, "a")).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(() => here(page)).toBe(name("b"));
  await expect(item(page, "b")).toBeVisible({ timeout: 10_000 });

  /* What `desktop/main.ts` sends for the mouse's back button, and the `mouseup` macOS gets. The
     two reports of one gesture share a cooldown, so the second is a press of its own. */
  await page.evaluate(() => window.historyCommand?.("back"));
  await expect.poll(() => here(page)).toBe(name("a"));
  await page.waitForTimeout(350);
  await page.dispatchEvent("body", "mouseup", { button: 4, bubbles: true });
  await expect.poll(() => here(page)).toBe(name("b"));
  await expect(item(page, "b")).toBeVisible({ timeout: 10_000 });
});
