import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS, openBoards } from "./boards";

/**
 * Choosing a board.
 *
 * The list is the one piece of chrome a person uses before they can use anything else, and it
 * replaced a `<select>` that needed no test because the browser was the whole implementation. What
 * is ours is the filter, the keyboard path through it, and the fact that it is a
 * dialog at all: it opens from the board's own name, it closes when a board is chosen, and with no
 * `?board=` in the URL there is no board and the welcome card says so.
 *
 * Each test writes its own board into `boards/`, as `edit.spec.ts` and `navigate.spec.ts` do: the
 * suite runs in parallel against one directory, so a search has to be for a name no other worker
 * could have created.
 */

const DIR = BOARDS;

const BOARD = `---
title: Findable
---

\`\`\`md {#one}
The only item.
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

async function open(page: Page, board = "demo") {
  await page.goto(`/?board=${board}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

test("the open board is marked, and the reference set is a section of its own", async ({ page }) => {
  await open(page, "reference/erd");
  await openBoards(page);

  /* What the board is called — its title — under a heading: the folder is said once
     rather than on every row, and the file's name is not said at all. */
  const title = /^title: (.*)$/m.exec(fs.readFileSync(path.join(BOARDS, "reference", "erd.board.md"), "utf8"))![1]!;
  await expect(page.locator('.dag-board[aria-current="true"]')).toHaveText(title.replace(/^"|"$/g, ""));
  await expect(page.locator(".dag-browser__folder", { hasText: "reference" })).toBeVisible();
});

test("a keyword filters the list, and clicking a row opens that board", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  await openBoards(page);

  /* Two words, in an order the file name does not use: each has to be found on its own for the
     search to be usable by someone who half remembers a name. */
  await page.fill(".dag-panel__input", `${name.slice(-6)} scratch`);
  const rows = page.locator(".dag-board");
  await expect(rows).toHaveCount(1);

  await rows.first().click();
  await expect(page).toHaveURL(new RegExp(`board=${name}`));
  await expect(page.locator('[data-dag-item="one"]')).toContainText("The only item.");
  /* Opening a board is what the card is for, so it is also what closes it — otherwise the first
     thing a person sees of the board they just chose is the list they chose it from. */
  await expect(page.locator("[data-dag-boards]")).toHaveCount(0);
});

test("enter opens the board the search has left standing", async ({ page }) => {
  await open(page);
  await openBoards(page);

  await page.fill(".dag-panel__input", name);
  await page.press(".dag-panel__input", "Enter");

  await expect(page).toHaveURL(new RegExp(`board=${name}`));
  await expect(page.locator("[data-dag-boards]")).toHaveCount(0);
  /* The toolbar says which board is open, and pressing it is how the list comes back. */
  await expect(page.locator("[data-dag-open-boards]")).toContainText("Findable");
});

test("a search that matches nothing says so", async ({ page }) => {
  await open(page);
  await openBoards(page);

  await page.fill(".dag-panel__input", "zzz-no-such-board");
  await expect(page.locator(".dag-board")).toHaveCount(0);
  await expect(page.locator(".dag-panel__empty")).toBeVisible();
});

test("arrow down walks into the list from the search box", async ({ page }) => {
  await open(page);
  await openBoards(page);

  await page.fill(".dag-panel__input", name);
  await page.press(".dag-panel__input", "ArrowDown");
  await expect(page.locator(".dag-board").first()).toBeFocused();
});

test("escape lets go of the filter first and the card second", async ({ page }) => {
  await open(page);
  await openBoards(page);

  await page.fill(".dag-panel__input", name);
  await page.press(".dag-panel__input", "Escape");
  /* Still open, and showing everything again: the innermost thing held is the first let go, which
     is the order the whole app's Escape chain follows. */
  await expect(page.locator("[data-dag-boards]")).toBeVisible();
  await expect(page.locator(".dag-panel__input")).toHaveValue("");

  await page.press(".dag-panel__input", "Escape");
  await expect(page.locator("[data-dag-boards]")).toHaveCount(0);
});

test("the chord opens it, and a click outside puts it away", async ({ page }) => {
  await open(page);

  await page.locator(".dag-viewport").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Space");
  await page.keyboard.press("o");
  await expect(page.locator("[data-dag-boards]")).toBeVisible();

  /* The scrim, not the card: a press inside stops there, which is what lets somebody drag a row
     from one folder to another without the card closing under their hand. */
  await page.locator("[data-dag-boards]").click({ position: { x: 8, y: 8 } });
  await expect(page.locator("[data-dag-boards]")).toHaveCount(0);
});

test("with no board in the URL there is no board, and the card says what to do about it", async ({ page }) => {
  await page.goto("/");

  /* The fallback used to be `boards[0]` — whichever file sorted first, which on this checkout is
     somebody's reference fixture. Nothing is open now, and nothing is drawn. */
  await expect(page.locator("[data-dag-welcome]")).toBeVisible();
  await expect(page.locator(".dag-item")).toHaveCount(0);
  /* No title pretending to be one: the card is what says what to do. */
  await expect(page.locator("[data-dag-open-boards]")).toHaveCount(0);

  await page.locator("[data-dag-welcome-open]").click();
  await expect(page.locator("[data-dag-boards]")).toBeVisible();
});

test("start drawing makes a board and opens it", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-dag-welcome-new]").click();

  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  /* The server numbers a name it finds taken, so this is `Untitled` or `Untitled <n>` — which is
     also why the check is on the URL rather than on a file this test could name in advance. */
  await expect(page).toHaveURL(/board=Untitled/);
  await expect(page.locator("[data-dag-welcome]")).toHaveCount(0);

  const made = new URL(page.url()).searchParams.get("board")!;
  expect(fs.existsSync(path.join(DIR, `${made}.board.md`))).toBe(true);
  fs.rmSync(path.join(DIR, `${made}.board.md`), { force: true });
});
