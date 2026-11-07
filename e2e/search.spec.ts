import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS, openBoards } from "./boards";

/**
 * Search across the text of every board and note.
 *
 * What the work set out to do: **a search returns matches from notes and boards in one list**, and
 * **a board result opens the board centred on the matching element**. A note result opens with the
 * caret on the matching block, which is the same promise made about the other kind of document.
 *
 * Each test owns a folder and a word nobody else on the machine has written, because the suite runs
 * wide over one `boards/` and the index is the whole vault's.
 */

let id = "";
let folder = "";
let word = "";
const board = () => `${folder}/plan`;
const note = () => `${folder}/journal`;

/* The match is far from the origin on purpose: a board that opened on its fit and happened to show
   the item would pass a check that only asked whether the item was on screen. */
const BOARD = (w: string) => `---
title: Search plan
---

\`\`\`md {#near x=0 y=0 w=320}
Nothing to see here.
\`\`\`

\`\`\`md {#far x=2400 y=1600 w=320}
The ${w} lives here.
\`\`\`
`;

const NOTE = (w: string) => `---
title: Journal
---
# Monday

Filler paragraph one.

Filler paragraph two.

- first item
- the ${w}list item
- third item

The ${w}para is in this paragraph.
`;

test.beforeEach(({}, info) => {
  id = info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "");
  folder = `e2e-search-${id}`;
  word = `zq${id.slice(-8)}`;
  fs.mkdirSync(path.join(BOARDS, folder), { recursive: true });
  fs.writeFileSync(path.join(BOARDS, `${board()}.board.md`), BOARD(word));
  fs.writeFileSync(path.join(BOARDS, `${note()}.note.md`), NOTE(word));
});
test.afterEach(() => {
  fs.rmSync(path.join(BOARDS, folder), { recursive: true, force: true });
});

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

async function searchFor(page: Page, q: string): Promise<void> {
  await openBoards(page);
  await page.locator("[data-dag-boards] input").fill(q);
}

const hit = (page: Page, name: string, part: string) => page.locator(`[data-dag-hit="${name}"][data-dag-hit-part="${part}"]`);

/**
 * The words the note marked as found. A CSS highlight, not an attribute — ProseMirror redraws any
 * attribute it did not set — so this reads the browser's highlight registry rather than the DOM.
 */
const found = (page: Page) =>
  page.evaluate(() => {
    const h = (CSS as unknown as { highlights?: Map<string, Iterable<Range>> }).highlights?.get("dag-found");
    return h ? [...h].map((r) => r.toString()).join(" ") : "";
  });

test("one list holds matches from boards and notes, each where the words are", { tag: "@smoke" }, async ({ page }) => {
  await page.goto(`/?board=${board()}`);
  await ready(page);
  await searchFor(page, word);
  await expect(hit(page, board(), "far")).toBeVisible();
  /* A block nothing has anchored is named by its line in the file, frontmatter counted. */
  await expect(hit(page, note(), "L14")).toBeVisible();
  await expect(hit(page, note(), "L11")).toBeVisible();
  /* The words that matched are marked, and only those. */
  await expect(hit(page, board(), "far").locator("mark")).toHaveText([word]);
  await expect(page.locator(".dag-panel__count")).toContainText("3 in the text");
});

test("a board result opens the board centred on the matching item, selected", { tag: "@smoke" }, async ({ page }) => {
  await page.goto(`/?board=${board()}`);
  await ready(page);
  await searchFor(page, word);
  await hit(page, board(), "far").click();
  await expect(page.locator("[data-dag-boards]")).toHaveCount(0);

  const item = page.locator('[data-dag-item="far"]');
  await expect(item).toHaveAttribute("data-dag-selected", "");
  /* Shown, not magnified: a small note is drawn at its own size. */
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-zoom", "1");
  const view = (await page.locator(".dag-viewport").boundingBox())!;
  const box = (await item.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - (view.x + view.width / 2))).toBeLessThan(4);
  expect(Math.abs(box.y + box.height / 2 - (view.y + view.height / 2))).toBeLessThan(4);
  /* And the part is let go once shown, or the next board opened would go looking for `far` too. */
  await expect(page).not.toHaveURL(/#/);
});

test("a result on another board opens that board on the item", async ({ page }) => {
  await page.goto("/?board=demo");
  await ready(page);
  await searchFor(page, word);
  await hit(page, board(), "far").click();
  await expect(page).toHaveURL(new RegExp(`board=${folder}`));
  await expect(page.locator('[data-dag-item="far"]')).toHaveAttribute("data-dag-selected", "");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-zoom", "1");
});

test("a note result opens the note with the caret on the matching block", async ({ page }) => {
  await page.goto(`/?board=${board()}`);
  await ready(page);
  await searchFor(page, `${word}para`);
  await hit(page, note(), "L14").click();
  await expect(page).toHaveURL(new RegExp(`note=${folder}`));
  await expect.poll(() => found(page)).toContain(`${word}para`);
  /* The caret is in it: typing goes where the match was. */
  await expect(page.locator("[data-dag-note-editor] [contenteditable=true]")).toBeFocused();
  const caret = await page.evaluate(() => window.getSelection()?.anchorNode?.textContent ?? "");
  expect(caret).toContain(`${word}para`);
  await expect(page).not.toHaveURL(/#/);
});

test("a match inside a list opens on its own item, not the first", async ({ page }) => {
  await page.goto(`/?note=${note()}`);
  await ready(page);
  await searchFor(page, `${word}list`);
  await hit(page, note(), "L11").click();
  await expect.poll(() => found(page)).toContain(`${word}list item`);
  expect(await found(page)).not.toContain("first item");
});

test("a block somebody anchored is found by its anchor, and opens there", async ({ page }) => {
  /* A line number is what a block has before anybody pointed at it; an anchor is better, because it
     survives an edit above the block. The corpus names the block by it when it has one. */
  fs.writeFileSync(path.join(BOARDS, `${note()}.note.md`), `${NOTE(word)}\nFiller after.\n\nThe ${word}anchored block. ^found\n`);
  await page.goto(`/?board=${board()}`);
  await ready(page);
  await searchFor(page, `${word}anchored`);
  await hit(page, note(), "^found").click();
  await expect(page).toHaveURL(new RegExp(`note=${folder}`));
  await expect.poll(() => found(page)).toContain(`${word}anchored block`);
  expect(await found(page)).not.toContain("Filler after");
  await expect(page).not.toHaveURL(/#/);
});

test("a reference to an item opens its board framed on it, in the editor and not only the view", async ({ page }) => {
  const { docs } = (await (await page.request.get("/__board/index")).json()) as { docs: { id: string; name: string }[] };
  const ident = docs.find((d) => d.name === board())!.id;
  /* `?ref=` is what following `[…](dag:<id>#far)` does, and the read-only view's part handling came first. */
  await page.goto(`/?ref=${ident}#far`);
  await expect(page).toHaveURL(new RegExp(`board=${folder}`));
  await expect(page.locator('[data-dag-item="far"]')).toHaveAttribute("data-dag-selected", "");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-zoom", "1");
  await expect(page).not.toHaveURL(/#/);
});

test("a part the board does not have opens the board as it would open anyway, and is let go", async ({ page }) => {
  await page.goto(`/?board=${board()}#nothing-called-this`);
  await ready(page);
  await expect(page).not.toHaveURL(/#/);
  await expect(page.locator("[data-dag-item][data-dag-selected]")).toHaveCount(0);
});

test("the list follows an edit made while the card is open", async ({ page }) => {
  await page.goto(`/?board=${board()}`);
  await ready(page);
  await searchFor(page, `${word}later`);
  await expect(page.locator("[data-dag-hits-empty]")).toContainText("matches");
  /* Written by the other writer, with the card still up: the change feed says so, and the index
     asks again. */
  fs.writeFileSync(
    path.join(BOARDS, `${board()}.board.md`),
    `${BOARD(word)}\n\`\`\`md {#late x=0 y=400}\nAdded ${word}later on.\n\`\`\`\n`,
  );
  await expect(hit(page, board(), "late")).toBeVisible({ timeout: 10_000 });
});
