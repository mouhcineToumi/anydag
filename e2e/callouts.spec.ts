import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { exportAs } from "./export";

/**
 * Callouts — `> [!kind]`, as GitHub and Obsidian write them — everywhere Markdown is drawn: a note
 * read-only in every theme, a snapshot, a board's text card, the PDF, and the note editor. What is
 * held: each is drawn in its kind's hue with its icon and title, one marked `-` is drawn shut and
 * `+` open, folding writes nothing, and the editor's gestures write the file in the form GitHub and
 * Obsidian read — and nothing else in it.
 */

const NOTE = `---
title: Callouts
---
Before.

> [!NOTE]
> GitHub's form, upper case and untitled.

> [!warning] Breaking change
> The \`/api/boards\` route is gone in 0.6.

> [!tip]- Folded shut
> Hidden until opened.

> [!example]+ Open, and foldable
> - one
> - two

> [!aside] An unknown kind
> Drawn as a note.

> A plain quote.

After.
`;

const BOARD = `---
title: Callouts on a board
---

\`\`\`md {#c x=0 y=0 w=420}
> [!tip] On a board
> A callout in a text card.

> [!danger]
> And another, untitled.
\`\`\`
`;

const THEMES = ["paper", "neutral", "paper-dark"] as const;

let note = "";
let board = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  /* Two stems: a board and a note may never share a name. */
  note = `e2e-callout-${info.testId}`;
  board = `e2e-calloutb-${info.testId}`;
  fs.writeFileSync(path.join(BOARDS, `${note}.note.md`), NOTE);
  fs.writeFileSync(path.join(BOARDS, `${board}.board.md`), BOARD);
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  if (note) fs.rmSync(path.join(BOARDS, `${note}.note.md`), { force: true });
  if (board) fs.rmSync(path.join(BOARDS, `${board}.board.md`), { force: true });
  expect(problems, "console output").toEqual([]);
});

const noteFile = () => path.join(BOARDS, `${note}.note.md`);
const readNote = () => fs.readFileSync(noteFile(), "utf8");

async function ready(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

/** The callouts drawn read-only, in order: the kind each is drawn as, its title, and whether it is open. */
const callouts = (page: Page, within = "") =>
  page.evaluate(
    (sel) =>
      Array.from(document.querySelectorAll<HTMLElement>(`${sel} .dag-callout`)).map((c) => ({
        kind: c.dataset.dagCallout,
        title: c.querySelector(".dag-callout__title")?.textContent,
        open: c.tagName === "DETAILS" ? (c as HTMLDetailsElement).open : null,
      })),
    within,
  );

const DRAWN = [
  { kind: "note", title: "Note", open: null },
  { kind: "warning", title: "Breaking change", open: null },
  { kind: "tip", title: "Folded shut", open: false },
  { kind: "example", title: "Open, and foldable", open: true },
  { kind: "note", title: "An unknown kind", open: null },
];

for (const theme of THEMES) {
  test(`a note drawn read-only draws its callouts · ${theme}`, theme === "paper" ? { tag: "@smoke" } : {}, async ({ page }) => {
    await ready(page, `/?note=${note}&view=1&theme=${theme}`);
    expect(await callouts(page)).toEqual(DRAWN);
    /* A plain quote is still a quote. */
    await expect(page.locator(".dag-note-view__page blockquote", { hasText: "A plain quote." })).toHaveCount(1);
    /* Shut is shut: its body is not drawn until it is opened. */
    await expect(page.getByText("Hidden until opened.")).toBeHidden();
    if (!process.env.ANYDAG_NO_SNAPSHOTS) {
      await expect(page.locator(".dag-note-view__page")).toHaveScreenshot(`callouts-note-${theme}.png`);
    }
  });
}

test("folding a callout on the page shows its body and writes nothing", async ({ page }) => {
  const before = fs.statSync(noteFile()).mtimeMs;
  await ready(page, `/?note=${note}&view=1`);
  await page.locator(".dag-callout summary", { hasText: "Folded shut" }).click();
  await expect(page.getByText("Hidden until opened.")).toBeVisible();
  await page.locator(".dag-callout summary", { hasText: "Open, and foldable" }).click();
  await expect(page.getByText("one", { exact: true })).toBeHidden();
  await page.waitForTimeout(800);
  expect(readNote()).toBe(NOTE);
  expect(fs.statSync(noteFile()).mtimeMs).toBe(before);
});

test("a snapshot of a note draws its callouts as the page does", async ({ page }) => {
  await ready(page, `/?note=${note}&snapshot=1`);
  expect(await callouts(page)).toEqual(DRAWN);
});

test("a board's text card draws its callouts", async ({ page }) => {
  await ready(page, `/?board=${board}&snapshot=1`);
  expect(await callouts(page, ".dag-md")).toEqual([
    { kind: "tip", title: "On a board", open: null },
    { kind: "danger", title: "Danger", open: null },
  ]);
  if (!process.env.ANYDAG_NO_SNAPSHOTS) {
    await expect(page.locator(".dag-layer")).toHaveScreenshot("callouts-board-paper.png");
  }
});

test("a note's PDF draws its callouts, the shut one shut", async ({ page }) => {
  await ready(page, `/?note=${note}`);
  await expect(page.locator(".dag-toolbar [data-dag-export]")).toBeVisible({ timeout: 15_000 });
  /* The print dialog is nothing a test can press: what it would have been handed is read instead. */
  await page.evaluate(() => {
    const w = window as unknown as { __printed: unknown[] };
    w.__printed = [];
    window.print = () => {
      w.__printed.push(
        Array.from(document.querySelectorAll<HTMLElement>(".dag-print .dag-callout")).map((c) => ({
          kind: c.dataset.dagCallout,
          title: c.querySelector(".dag-callout__title")?.textContent,
          open: c.tagName === "DETAILS" ? (c as HTMLDetailsElement).open : null,
        })),
      );
    };
  });
  await exportAs(page, "pdf");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: unknown[] }).__printed.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __printed: unknown[] }).__printed[0])).toEqual(DRAWN);
  expect(readNote()).toBe(NOTE);
});

/* ------------------------------------------------------------------------------------------------ */
/* The editor                                                                                        */

const editor = (page: Page) => page.locator("[data-dag-note-editor]");
const blockWith = (page: Page, text: string) => editor(page).locator(".bn-block-content", { hasText: text }).first();

async function endOf(page: Page, text: string) {
  await blockWith(page, text).click();
  await page.keyboard.press("End");
}

test("the editor draws each callout with its kind, its title and its fold, and opening the note writes nothing", async ({
  page,
}) => {
  const before = fs.statSync(noteFile()).mtimeMs;
  await ready(page, `/?note=${note}`);
  const boxes = editor(page).locator(".dag-callout");
  await expect(boxes).toHaveCount(5);
  expect(
    await boxes.evaluateAll((els) =>
      els.map((e) => ({
        kind: (e as HTMLElement).dataset.dagCallout,
        word: (e as HTMLElement).dataset.dagCalloutWord,
        title: e.querySelector<HTMLInputElement>("[data-dag-callout-title-field]")?.value,
        open: (e as HTMLElement).dataset.dagCalloutOpen,
      })),
    ),
  ).toEqual([
    { kind: "note", word: "NOTE", title: "", open: "true" },
    { kind: "warning", word: "warning", title: "Breaking change", open: "true" },
    { kind: "tip", word: "tip", title: "Folded shut", open: "false" },
    { kind: "example", word: "example", title: "Open, and foldable", open: "true" },
    { kind: "note", word: "aside", title: "An unknown kind", open: "true" },
  ]);
  /* A callout's blocks are inside its box, not after it. */
  await expect(boxes.nth(3).locator(".bn-block-content", { hasText: "two" })).toHaveCount(1);
  /* Its fold is the page's: the chevron opens it and the file does not move. */
  await expect(blockWith(page, "Hidden until opened.")).toBeHidden();
  await boxes.nth(2).locator("[data-dag-callout-fold-button]").click();
  await expect(blockWith(page, "Hidden until opened.")).toBeVisible();
  await page.waitForTimeout(800);
  expect(readNote()).toBe(NOTE);
  expect(fs.statSync(noteFile()).mtimeMs).toBe(before);
  if (!process.env.ANYDAG_NO_SNAPSHOTS) {
    await page.mouse.move(0, 0);
    await expect(boxes.nth(1)).toHaveScreenshot("callouts-editor-paper.png");
  }
});

test("typing in a callout rewrites that callout and leaves every other byte alone", { tag: "@smoke" }, async ({ page }) => {
  await ready(page, `/?note=${note}`);
  await endOf(page, "is gone in 0.6.");
  await page.keyboard.type(" Use /api/files.");
  await expect.poll(readNote, { timeout: 5_000 }).toContain("is gone in 0.6. Use /api/files.");
  expect(readNote()).toBe(NOTE.replace("is gone in 0.6.", "is gone in 0.6. Use /api/files."));
});

test("the slash menu's Callout makes a note, its head changes the kind and the title", async ({ page }) => {
  await ready(page, `/?note=${note}`);
  await endOf(page, "After.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/callout");
  await page.locator(".bn-suggestion-menu-item", { hasText: "Callout" }).first().click();
  await page.keyboard.type("Remember the base.");
  const end = "After.\n\n> [!note]\n> Remember the base.\n";
  await expect.poll(readNote, { timeout: 5_000 }).toBe(NOTE.replace("After.\n", end));

  const made = editor(page).locator(".dag-callout").last();
  await made.locator("[data-dag-callout-kind]").selectOption("warning");
  await expect.poll(readNote, { timeout: 5_000 }).toContain("> [!warning]\n> Remember the base.");
  await expect(made).toHaveAttribute("data-dag-callout", "warning");

  const title = made.locator("[data-dag-callout-title-field]");
  await title.click();
  await page.keyboard.type("Heads up");
  await page.keyboard.press("Enter");
  const titled = NOTE.replace("After.\n", "After.\n\n> [!warning] Heads up\n> Remember the base.\n");
  await expect.poll(readNote, { timeout: 5_000 }).toBe(titled);

  /* Escape takes back what was typed into the title, and writes nothing. */
  await title.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and nope");
  await page.keyboard.press("Escape");
  await expect(title).toHaveValue("Heads up");
  await page.waitForTimeout(800);
  expect(readNote()).toBe(titled);
});

test("typing `> [!tip] ` at the start of a line makes a tip, and Enter goes on inside it", async ({ page }) => {
  await ready(page, `/?note=${note}`);
  await endOf(page, "After.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("> [!tip] ");
  await expect(editor(page).locator('.dag-callout[data-dag-callout="tip"]')).toHaveCount(2);
  await page.keyboard.type("Careful.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Very.");
  await expect.poll(readNote, { timeout: 5_000 }).toBe(NOTE.replace("After.\n", "After.\n\n> [!tip]\n> Careful.\n>\n> Very.\n"));
});
