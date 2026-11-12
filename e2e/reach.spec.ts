import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { clickOnHover } from "./hover";
import { pageMore } from "./more";
import { newFile, openSettings, openSidebar } from "./sidebar";
import { BOARDS } from "./boards";

/**
 * M27: the things the board file could always say and the pointer could not reach.
 *
 * Every check reads the bytes on disk, for the reason `select.spec.ts` gives — the thing being
 * tested is that a click turns into a small, correct edit to a document a person also owns. The
 * three that are not a file edit (the caret landing on a card's line, the offer appearing, the
 * theme surviving a reload) are read off the page, because that is where they live.
 *
 * One board per test: the suite runs in parallel and these write to disk.
 */

const DIR = BOARDS;

const BOARD = `---
title: Reach me
---

\`\`\`arch {#infra x=0 y=0}
client browser "Browser" icon=monitor

group gcp "Google Cloud" hue=indigo {
  service api "The API" "fastapi" icon=server
}

browser --> api "/api"
\`\`\`

\`\`\`md {#note x=0 y=520 w=200}
A note.
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-reach-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => {
  fs.rmSync(file, { force: true });
  /* A rename or a duplicate leaves a second file behind, named after this one. */
  for (const f of fs.readdirSync(DIR))
    if (f.startsWith(`${name}-`) || f.startsWith(`renamed-${name}`)) fs.rmSync(path.join(DIR, f), { force: true });
});

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page, query = "") {
  await page.goto(`/?board=${name}${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/* ------------------------------------------------------------------ the card and its line */

/**
 * Pick a card, then open the panel on it.
 *
 * F1 made the second click on a card pick it out of its diagram; **F3 took the double-click**, which
 * is now the inline rename — a person who double-clicks a label is asking to retype the label, in
 * every drawing tool there is. Enter is what opens the controls, and the pause is what keeps
 * "click, then click again" from being read as one double-click by Chromium.
 */
async function props(page: Page, selector: string) {
  await page.locator(selector).click();
  await page.waitForTimeout(400);
  await page.locator(selector).click();
  await page.keyboard.press("Enter");
}

test("picking a card and pressing enter opens the panel on that card", async ({ page }) => {
  await open(page);
  await props(page, '[data-dag-node="api"]');

  /* F1 changed what this gesture means. It used to open the *text* with the declaring line
     selected; it opens the controls for the thing that was clicked. */
  await expect(page.locator("[data-dag-inspector]")).toBeVisible();
  await expect(page.locator("[data-dag-props]")).toHaveAttribute("data-dag-props", "api");
  /* The panel is the controls: there is no text behind them to switch to (#145). */
  await expect(page.locator("[data-dag-mode]")).toHaveCount(0);
  await expect(page.locator("[data-dag-body]")).toHaveCount(0);
});

test("the properties strip writes hue, status and icon onto that one line", async ({ page }) => {
  await open(page);
  await props(page, '[data-dag-node="api"]');

  await page.locator('[data-dag-prop-hue="coral"]').click();
  await expect.poll(read, { timeout: 5_000 }).toContain("hue=coral");

  await page.locator("[data-dag-prop-status]").selectOption("wait");
  await expect.poll(read, { timeout: 5_000 }).toMatch(/service api .*wait/);

  await page.locator("[data-dag-prop-icon]").fill("database");
  await page.locator("[data-dag-prop-icon]").blur();
  await expect.poll(read, { timeout: 5_000 }).toContain("icon=database");

  /* One line changed and nothing else: the group, the client and the edge are untouched. */
  const now = read();
  expect(now).toContain('client browser "Browser" icon=monitor');
  expect(now).toContain('group gcp "Google Cloud" hue=indigo {');
  expect(now).toContain('browser --> api "/api"');
  expect(now).not.toContain("icon=server");
});

/* ------------------------------------------------------------------------------- z-order */

test("] and [ reorder the item's fence block in the file", async ({ page }) => {
  await open(page);

  /* `infra` is written first, `note` second — the file's own z-order. */
  expect(read().indexOf("{#infra")).toBeLessThan(read().indexOf("{#note"));

  const infra = (await page.locator('[data-dag-item="infra"]').boundingBox())!;
  await page.mouse.click(infra.x + 20, infra.y + 12);
  await page.keyboard.press("]");
  await expect.poll(() => read().indexOf("{#infra") > read().indexOf("{#note"), { timeout: 5_000 }).toBe(true);

  /* And back again with the other key. */
  await page.keyboard.press("[");
  await expect.poll(() => read().indexOf("{#infra") < read().indexOf("{#note"), { timeout: 5_000 }).toBe(true);

  /* Nothing else in the document moved. */
  const now = read();
  expect(now).toContain("title: Reach me");
  expect(now).toContain('client browser "Browser" icon=monitor');
  expect(now).toContain("A note.");
});

/* ---------------------------------------------------------------------- resize by aspect */

test("a diagram has two handles and they write aspect, not w", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="infra"]').click();
  await expect(page.locator('[data-dag-item="infra"] [data-dag-handle]')).toHaveCount(2);

  const box = (await page.locator('[data-dag-item="infra"]').boundingBox())!;
  const east = (await page.locator('[data-dag-item="infra"] [data-dag-handle="e"]').boundingBox())!;
  await page.mouse.move(east.x + east.width / 2, east.y + east.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, east.y + east.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect.poll(read, { timeout: 5_000 }).toMatch(/aspect=[\d.]+/);
  expect(read()).not.toMatch(/#infra[^\n]*\bw=/);
});

test("a note keeps all eight handles, because its box is its own", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="note"]').click();
  await expect(page.locator('[data-dag-item="note"] [data-dag-handle]')).toHaveCount(8);
});

/* ------------------------------------------------------------------------------- pages */

test("the tabs make a page, move an item onto it, and take it away again", async ({ page }) => {
  await open(page);
  /* A one-page board has no tab strip: its second page comes from the top bar's `⋯`. */
  await pageMore(page, "data-dag-page-add");
  await expect.poll(read, { timeout: 5_000 }).toContain("pages:");
  await expect(page.locator("[data-dag-page]")).toHaveCount(2);

  /* The new page is the one being shown, and it is empty. */
  await expect(page.locator("[data-dag-item]")).toHaveCount(0);

  /* Move the note onto it, from the panel, and it appears here and leaves page one. */
  await page.locator('[data-dag-page="page-1"]').click();
  await page.locator('[data-dag-item="note"]').click();
  /* A double-click on a text card opens its words; its settings are the toolbar's Edit. */
  await page.locator("[data-dag-selbar-edit]").click();
  /* The page select is in the Advanced disclosure now. */
  await page.locator("[data-dag-advanced-toggle]").click();
  await page.locator("[data-dag-item-page]").selectOption("page-2");
  await expect.poll(read, { timeout: 5_000 }).toMatch(/#note[^\n]*page=page-2/);
  await expect(page.locator('[data-dag-item="note"]')).toHaveCount(0);

  /* Removing a page brings what was on it back to the first, rather than hiding it. */
  await page.locator('[data-dag-page="page-2"]').click();
  await page.locator("[data-dag-page-remove]").click();
  /* One page left, and a strip of one tab says nothing: it goes. */
  await expect(page.locator("[data-dag-pagebar]")).toHaveCount(0);
  await expect.poll(read, { timeout: 5_000 }).not.toContain("page=page-2");
  await expect(page.locator('[data-dag-item="note"]')).toHaveCount(1);
});

/* ---------------------------------------------------------------- the board list's files */

test("the sidebar duplicates, names, and deletes a board file", async ({ page }) => {
  await open(page);
  await openSidebar(page);

  /* The row's tools appear on hover — a column of rows each wearing icons is a wall — so every one
     is reached the way a person reaches it: a real pointer move and the click retried as one pair,
     because the list re-renders under the pointer whenever any board file appears anywhere, and
     eight workers writing scratch boards makes that constant. See `e2e/hover.ts`. */
  const row = (b: string) => `[data-dag-sidebar-file="${b}"]`;
  const more = async (b: string, item: string) => {
    await clickOnHover(page, row(b), `[data-dag-sidebar-more="${b}"]`);
    await page.locator(`[data-dag-sidebar-menu-item="${item}"]`).click();
  };

  /* Duplicate this one: the server numbers it (`<name> 2`, decision 14), the app opens what it named, and the copy is named
     next where its title is drawn, in the top bar — the next thing anybody does to a copy. */
  await more(name, "duplicate");
  await expect.poll(() => fs.existsSync(path.join(DIR, `${name} 2.board.md`)), { timeout: 5_000 }).toBe(true);
  const title = page.locator("[data-dag-toolbar-name]");
  await expect(title).toBeFocused();
  await title.fill(`renamed-${name}`);
  await title.press("Enter");
  const box = page.locator("[data-dag-sidebar-name]");
  await expect.poll(() => fs.existsSync(path.join(DIR, `renamed-${name}.board.md`)), { timeout: 5_000 }).toBe(true);
  expect(fs.existsSync(path.join(DIR, `${name} 2.board.md`))).toBe(false);
  /* The copy was open, so it follows its own rename. */
  await expect.poll(() => new URL(page.url()).searchParams.get("board")).toBe(`renamed-${name}`);

  /* F2 renames the focused row too, which is the keyboard's way in. */
  await page.locator(row(`renamed-${name}`)).focus();
  await page.keyboard.press("F2");
  await expect(box).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);

  /* Delete asks nothing: it goes to the trash, and the notice offers it back. What was
     open goes back to nothing. */
  await more(`renamed-${name}`, "delete");
  await expect(page.locator("[data-dag-trash-notice]")).toBeVisible();
  await expect.poll(() => fs.existsSync(path.join(DIR, `renamed-${name}.board.md`)), { timeout: 5_000 }).toBe(false);
  await expect(page.locator("[data-dag-welcome]")).toBeVisible({ timeout: 10_000 });
});

test("New board makes one, opens it, and names it where it is drawn", async ({ page }) => {
  await open(page);
  await newFile(page, "board", { top: true });

  /* Made first — `Untitled`, numbered if another worker got there — and opened, with the box it is
     named in already holding its title, selected: in the top bar, where the title is drawn,
     and never in its sidebar row. */
  const box = page.locator("[data-dag-toolbar-name]");
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("Untitled");
  await expect(page.locator("[data-dag-sidebar-name]")).toHaveCount(0);
  const untitled = new URL(page.url()).searchParams.get("board")!;
  expect(untitled).toMatch(/^Untitled( \d+)?$/);
  await box.fill(`${name}-fresh`);
  await box.press("Enter");

  const made = path.join(DIR, `${name}-fresh.board.md`);
  await expect.poll(() => fs.existsSync(made), { timeout: 5_000 }).toBe(true);
  expect(fs.existsSync(path.join(DIR, `${untitled}.board.md`))).toBe(false);
  await expect.poll(() => new URL(page.url()).searchParams.get("board")).toBe(`${name}-fresh`);
  /* Empty: the ways in are a card on the page, not a note in the file somebody then has to
     delete — and nothing in it says `untitled`, which would outlive the name it was made under. */
  await expect(page.locator("[data-dag-item]")).toHaveCount(0);
  await expect(page.locator("[data-dag-empty-board]")).toBeVisible();
  expect(fs.readFileSync(made, "utf8")).not.toContain("untitled");
  await expect(page.locator("[data-dag-open-boards]")).toContainText(`${name}-fresh`);

  /* A note from the card is the first item, and the card goes. */
  await page.locator('[data-dag-empty-board-act="note"]').click();
  await expect(page.locator("[data-dag-item]")).toHaveCount(1);
  await expect(page.locator("[data-dag-empty-board]")).toHaveCount(0);
  fs.rmSync(made, { force: true });
});

/* ----------------------------------------------------------------------------- the theme */

/** The theme lives in Settings now, so every read of it opens the dialog first. */
const theme = (page: Page) => page.locator("[data-dag-setting-theme]");

test("a theme picked in settings survives a reload", async ({ page }) => {
  await open(page);
  await openSettings(page, "vault-general");
  await theme(page).selectOption("neutral");
  await expect(theme(page)).toHaveValue("neutral");

  await open(page);
  await openSettings(page, "vault-general");
  await expect(theme(page)).toHaveValue("neutral");

  /* An explicit `?theme=` still outranks it — `snapshot.mjs --theme` and every check here are that. */
  await open(page, "&theme=paper");
  await openSettings(page, "vault-general");
  await expect(theme(page)).toHaveValue("paper");
});

test("a snapshot reads no stored preference at all", async ({ page }) => {
  await open(page);
  await openSettings(page, "vault-general");
  await theme(page).selectOption("neutral");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "neutral");

  /* `?snapshot=1` is a picture being taken by `snapshot.mjs`, `tidy.mjs` or a check here, and a
     picture of a board must be a fact about the board rather than about whoever last opened it on
     this machine. It held only because a fresh context has empty storage; now it is stated. */
  await open(page, "&snapshot=1");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await expect(page.locator("[data-dag-settings-toggle]")).toHaveCount(0);
});

/* --------------------------------------------------------------------------- the Mermaid */

test("a Mermaid paste is offered a conversion, and taking it retypes the fence", async ({ page }) => {
  fs.writeFileSync(
    file,
    `---\ntitle: Reach me\n---\n\n\`\`\`arch {#pasted x=0 y=0}\ngraph LR\n  A[Client] --> B{Cache hit?}\n  B -->|yes| C[Serve it]\n\`\`\`\n`,
  );
  await open(page);
  await page.locator('[data-dag-item="pasted"]').dblclick();

  await expect(page.locator("[data-dag-mermaid-offer]")).toHaveAttribute("data-dag-mermaid-offer", "flow");
  await page.locator("[data-dag-mermaid-convert]").click();

  await expect.poll(read, { timeout: 5_000 }).toContain("```flow {#pasted");
  const now = read();
  expect(now).toContain("dir=LR");
  expect(now).toContain('step a "Client"');
  expect(now).toContain('decision b "Cache hit?"');
  expect(now).toContain('b --> c "yes"');
  expect(now).not.toContain("graph LR");

  /* The offer goes when there is nothing left to convert, and the diagram draws. */
  await expect(page.locator("[data-dag-mermaid-offer]")).toHaveCount(0);
  await expect(page.locator('[data-dag-node="a"]')).toHaveCount(1);
});
