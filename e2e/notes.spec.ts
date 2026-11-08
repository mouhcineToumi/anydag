import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS, openBoards } from "./boards";
import { clickOnHover } from "./hover";
import { newFile, openSidebar } from "./sidebar";

/**
 * Notes: a second kind of file beside the boards, written in a block editor.
 *
 * What is ours is not the editor — BlockNote is — but what happens between it and the file: that
 * an edit rewrites only the block it touched and leaves every other byte an agent wrote alone, that
 * an outside write lands in the open editor without moving the caret, that two writers on
 * different blocks merge and on the same block ask, and that the list treats a note as a file.
 *
 * Each test writes its own note, named for its test id, because the suite runs in parallel against
 * one directory.
 */

const DIR = BOARDS;

/* Hard-wrapped the way an agent writes, with `*` bullets and `_` emphasis — all of which the house
   form would rewrite, which is how a test can tell a touched block from an untouched one. */
const NOTE = `---
title: A note
---
# The plan

The first paragraph, wrapped at a column
the way every file here is wrapped, with _underscores_.

The second paragraph.

* a list in stars
* second

The last paragraph.
`;

let name = "";
let file = "";
let problems: string[] = [];
const made: string[] = [];

test.beforeEach(({ page }, info) => {
  name = `e2e-note-${info.testId}`;
  file = path.join(DIR, `${name}.note.md`);
  fs.writeFileSync(file, NOTE);
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  fs.rmSync(file, { force: true });
  fs.rmSync(path.join(DIR, `${name}.assets`), { recursive: true, force: true });
  for (const f of made.splice(0)) fs.rmSync(f, { force: true });
  expect(problems, "console output").toEqual([]);
});

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page, note = name) {
  await page.goto(`/?note=${note}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** The editor's block holding this text, which is where a click puts the caret. */
const block = (page: Page, text: string) => page.locator(".bn-block-content", { hasText: text }).first();

/** Put the caret at the end of a block's text. */
async function endOf(page: Page, text: string) {
  await block(page, text).click();
  await page.keyboard.press("End");
}

test("typing rewrites the block it is in and leaves every other byte alone", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  await endOf(page, "The second paragraph.");
  await page.keyboard.type(" Typed by a person.");
  await expect.poll(read, { timeout: 5_000 }).toContain("The second paragraph. Typed by a person.");
  /* The agent's wrapping, its underscores and its stars are all still there: those blocks were not touched. */
  expect(read()).toBe(NOTE.replace("The second paragraph.", "The second paragraph. Typed by a person."));
});

test("a note bigger than a keepalive request still saves", async ({ page }) => {
  /* Chromium refuses a `keepalive` fetch over 64 KB before sending anything, and every save used to
     be one — so a big note stopped saving without a word anybody could see. */
  const big = NOTE.replace("The last paragraph.", `${"A long paragraph of filler words. ".repeat(3000)}\n\nThe last paragraph.`);
  fs.writeFileSync(file, big);
  expect(big.length).toBeGreaterThan(90_000);
  await open(page);
  await endOf(page, "The last paragraph.");
  await page.keyboard.type(" Saved.");
  await expect.poll(read, { timeout: 5_000 }).toContain("The last paragraph. Saved.");
  expect(read()).toBe(big.replace("The last paragraph.", "The last paragraph. Saved."));
});

test("a save the server could not answer goes again on its own", async ({ page }) => {
  /* The api restarting under a person who has just stopped typing: the save fails with nothing
     wrong with it, and it used to wait for a keystroke that, at the end of a note, never comes. */
  let refused = 0;
  await page.route("**/__board/put?*", (route) =>
    refused < 2 ? (refused++, route.fulfill({ status: 503, body: "restarting" })) : route.fallback(),
  );
  await open(page);
  await endOf(page, "The last paragraph.");
  await page.keyboard.type(" Kept.");
  await expect(page.locator("[data-dag-note-failed]")).toBeVisible();
  await expect.poll(read, { timeout: 10_000 }).toContain("The last paragraph. Kept.");
  expect(refused).toBe(2);
  expect(read()).toBe(NOTE.replace("The last paragraph.", "The last paragraph. Kept."));
  await expect(page.locator("[data-dag-note-failed]")).toHaveCount(0);
  problems = problems.filter((p) => !/status of 503/.test(p));
});

test("a save the server refused waits for the next change", async ({ page }) => {
  /* A 4xx is an answer about the request, and the same request gets the same answer. */
  let puts = 0;
  await page.route("**/__board/put?*", (route) => (puts++, route.fulfill({ status: 413, body: "too big" })));
  await open(page);
  await endOf(page, "The last paragraph.");
  await page.keyboard.type(" Refused.");
  await expect(page.locator("[data-dag-note-failed]")).toBeVisible();
  await page.waitForTimeout(2_500);
  expect(puts).toBe(1);
  expect(read()).toBe(NOTE);
  problems = problems.filter((p) => !/status of 413/.test(p));
});

test("opening a note and looking at it writes nothing", async ({ page }) => {
  const before = fs.statSync(file).mtimeMs;
  await open(page);
  await block(page, "The last paragraph.").click();
  await page.waitForTimeout(800);
  expect(read()).toBe(NOTE);
  expect(fs.statSync(file).mtimeMs).toBe(before);
});

test("the slash menu offers only what a Markdown file can say", async ({ page }) => {
  await open(page);
  await endOf(page, "The last paragraph.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  const items = page.locator(".bn-suggestion-menu-item");
  await expect(items.first()).toBeVisible();
  const titles = (await items.allInnerTexts()).map((t) => t.split("\n")[0]!.trim());
  expect(titles).toEqual([
    "Heading 1",
    "Heading 2",
    "Heading 3",
    "Quote",
    "Numbered List",
    "Bullet List",
    "Check List",
    "Paragraph",
    "Code Block",
    "Divider",
    /* Ours: an equation on lines of its own, `$$` in the file — among the basic blocks. */
    "Equation",
    "Table",
    "Image",
    /* Ours, not BlockNote's: it opens the embed picker, and an embed is Markdown too. */
    "Board",
    /* Ours too: a file from the computer, kept as an attachment and embedded by id. */
    "Upload file",
  ]);
  await page.keyboard.press("Escape");
});

test("the drag handle menu's Delete has a trash icon and keeps its name", async ({ page }) => {
  await open(page);
  await clickOnHover(page, '.bn-block-content:has-text("The last paragraph.")', '[data-test="dragHandle"]');
  const menu = page.locator(".bn-drag-handle-menu");
  const item = menu.getByRole("menuitem", { name: "Delete" });
  await expect(item).toBeVisible();
  /* The glyph is decorative — `aria-hidden` — so the item is still announced, and found by a
     keyboard, as the word. */
  await expect(item.locator("svg")).toHaveCount(1);
  /* And it is still the only action: a note has no colours, alignment or header to offer. */
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
});

test("a Markdown shortcut makes a block, and the file says it in Markdown", async ({ page }) => {
  await open(page);
  await endOf(page, "The last paragraph.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[] ship it");
  await expect.poll(read, { timeout: 5_000 }).toContain("- [ ] ship it");
  expect(read().startsWith(NOTE.trimEnd())).toBe(true);
});

test("an outside write lands in the open note and the caret stays where it was", async ({ page }) => {
  await open(page);
  await endOf(page, "The second paragraph.");
  await page.keyboard.type(" One.");
  await expect.poll(read, { timeout: 5_000 }).toContain("The second paragraph. One.");
  /* Somebody else — an agent, a text editor — rewrites a different paragraph on disk. */
  fs.writeFileSync(file, read().replace("The last paragraph.", "The last paragraph, rewritten elsewhere."));
  await expect(block(page, "rewritten elsewhere")).toBeVisible({ timeout: 10_000 });
  /* The caret never left the block it was in: typing goes on from where it stopped. */
  await page.keyboard.type(" Two.");
  await expect.poll(read, { timeout: 5_000 }).toContain("The second paragraph. One. Two.");
  expect(read()).toContain("The last paragraph, rewritten elsewhere.");
});

test("an outside write to a note of one paragraph lands, and leaving does not put the old text back", async ({ page }) => {
  fs.writeFileSync(file, "---\ntitle: One line\n---\nOnly this line.\n");
  await open(page);
  await expect(block(page, "Only this line.")).toBeVisible();
  fs.writeFileSync(file, "---\ntitle: One line\n---\nWritten elsewhere.\n\nAnd a second.\n");
  await expect(block(page, "Written elsewhere.")).toBeVisible({ timeout: 10_000 });
  await expect(block(page, "And a second.")).toBeVisible();
  await expect(page.locator(".bn-block-content", { hasText: "Only this line." })).toHaveCount(0);
  /* Leaving used to save the text the editor was stuck on over the one written elsewhere. */
  await page.goto("about:blank");
  expect(read()).toBe("---\ntitle: One line\n---\nWritten elsewhere.\n\nAnd a second.\n");
});

test("two writers on different blocks are merged", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  await endOf(page, "The second paragraph.");
  /* Typed, and the file changed on disk before the quarter-second save goes out: the save meets a
     text that has moved, and has to merge rather than overwrite it. */
  await page.keyboard.type(" Mine.");
  fs.writeFileSync(file, NOTE.replace("The last paragraph.", "Theirs."));
  await expect.poll(read, { timeout: 10_000 }).toContain("The second paragraph. Mine.");
  expect(read()).toContain("Theirs.");
  await expect(block(page, "Theirs.")).toBeVisible();
  await expect(page.locator("[data-dag-note-conflict]")).toHaveCount(0);
  /* The 409 is the answer this check is about, and Chromium logs any 4xx in its own words. */
  problems = problems.filter((p) => !/status of 409/.test(p));
});

test("two writers on the same block are asked, and 'use theirs' takes theirs", async ({ page }) => {
  await open(page);
  await endOf(page, "The last paragraph.");
  await page.keyboard.type(" Mine.");
  fs.writeFileSync(file, NOTE.replace("The last paragraph.", "The last paragraph, theirs."));
  await expect(page.locator("[data-dag-note-conflict]")).toBeVisible({ timeout: 10_000 });
  /* Nothing has been overwritten while the question stands. */
  expect(read()).toContain("The last paragraph, theirs.");
  await page.locator("[data-dag-note-theirs]").click();
  await expect(page.locator("[data-dag-note-conflict]")).toHaveCount(0);
  await expect(block(page, "The last paragraph, theirs.")).toBeVisible();
  expect(read()).toBe(NOTE.replace("The last paragraph.", "The last paragraph, theirs."));
  problems = problems.filter((p) => !/status of 409/.test(p));
});

test("the list shows a note beside the boards, and opens either", async ({ page }) => {
  await open(page);
  await expect(page.locator(".dag-toolbar__title")).toHaveText("A note");
  await openBoards(page);
  const row = page.locator(`[data-dag-note="${name}"]`);
  await expect(row).toHaveAttribute("aria-current", "true");
  await page.fill(".dag-panel__input", name);
  await expect(page.locator("[data-dag-note]")).toHaveCount(1);
  await page.fill(".dag-panel__input", "");
  /* From a note to a board: a different page altogether, with the canvas back. */
  await page.locator('[data-dag-board="demo"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await expect(page.locator(".dag-viewport")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("note")).toBeNull();
  /* And back, from the board's own list. */
  await openBoards(page);
  await page.locator(`[data-dag-note="${name}"]`).click();
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  expect(new URL(page.url()).searchParams.get("board")).toBeNull();
  await expect(block(page, "The second paragraph.")).toBeVisible();
});

test("New note makes one, opens it, and names it in its own title", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  await newFile(page, "note", { top: true });
  /* Named at the top of its page, Notion's way — not in a box in its sidebar row. */
  const title = page.locator("[data-dag-note-title]");
  await expect(title).toBeFocused({ timeout: 10_000 });
  await expect(title).toHaveValue("");
  await expect(title).toHaveAttribute("placeholder", "Untitled");
  await expect(page.locator("[data-dag-sidebar-name]")).toHaveCount(0);
  await page.keyboard.type(`${name}-new`);
  await page.keyboard.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("note"), { timeout: 10_000 }).toBe(`${name}-new`);
  /* A new note is a plain \`.md\` (decision 7), called what was typed, verbatim (decision 14): the
     title is the name, so the file says it in no line of its own — only the id the vault minted on
     create. No heading — a second copy of the title is one nothing rewrites. */
  const created = path.join(DIR, `${name}-new.md`);
  made.push(created);
  await expect
    .poll(() => fs.existsSync(created) && fs.readFileSync(created, "utf8"), { timeout: 5_000 })
    .toMatch(/^---\nid: [0-9a-z]{10}\n---\n$/);
  await expect(page.locator(".dag-toolbar__title")).toHaveText(`${name}-new`);
});

test("the title at the top of a note is its name, and the editor stays up while the file follows it", async ({ page }, info) => {
  await open(page);
  const title = page.locator("[data-dag-note-title]");
  await expect(title).toHaveValue("A note");
  /* The editor this page opened with, marked, so a remount on the new name would show. */
  await page.evaluate(() => ((document.querySelector(".bn-editor") as HTMLElement & { dagMark?: number }).dagMark = 1));

  const named = `Renamed ${info.testId}`;
  const moved = path.join(DIR, `${named}.note.md`);
  made.push(moved);
  await title.fill(named);
  /* Enter goes on into the text, on a new line at its top, and whatever is typed there straight
     away lands in the renamed file — while the rename is still out, as often as not. */
  await title.press("Enter");
  await page.keyboard.type("Typed after the title.");
  await expect.poll(() => new URL(page.url()).searchParams.get("note"), { timeout: 10_000 }).toBe(named);
  await expect
    .poll(() => fs.existsSync(moved) && fs.readFileSync(moved, "utf8"), { timeout: 5_000 })
    .toContain("Typed after the title.");
  const text = fs.readFileSync(moved, "utf8");
  expect(text.startsWith(`---\ntitle: ${named}\n---\nTyped after the title.\n\n# The plan\n`)).toBe(true);
  /* Every block nobody touched is the agent's bytes still. */
  expect(text).toContain("The first paragraph, wrapped at a column\nthe way every file here is wrapped, with _underscores_.");
  expect(fs.existsSync(file)).toBe(false);
  expect(await page.evaluate(() => (document.querySelector(".bn-editor") as HTMLElement & { dagMark?: number }).dagMark)).toBe(1);
  await expect(page.locator(".dag-toolbar__title")).toHaveText(named);
  await expect(page.locator("[data-dag-note-conflict], [data-dag-note-failed]")).toHaveCount(0);
});

test("retitling a note rewrites the wikilinks to it in another note, and nothing else in it", async ({ page }, info) => {
  /* Named by its file, not by its title: every note in this spec is called "A note", and a link by
     title would name whichever of them resolution prefers. */
  const linker = path.join(DIR, `${name}-links.md`);
  made.push(linker);
  fs.writeFileSync(linker, `See [[${name}|the plan]] and ![[${name}#The plan]].\n\n\`[[${name}]]\` is code.\n`);
  await open(page);
  const named = `Relinked ${info.testId}`;
  made.push(path.join(DIR, `${named}.note.md`));
  const title = page.locator("[data-dag-note-title]");
  await title.fill(named);
  await title.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("note"), { timeout: 10_000 }).toBe(named);
  await expect
    .poll(() => fs.readFileSync(linker, "utf8"), { timeout: 5_000 })
    .toBe(`See [[${named}|the plan]] and ![[${named}#The plan]].\n\n\`[[${name}]]\` is code.\n`);
});

test("Escape takes the title back, and emptying it makes the note Untitled again", async ({ page }) => {
  await open(page);
  const title = page.locator("[data-dag-note-title]");
  await title.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and more");
  await page.keyboard.press("Escape");
  await expect(title).toHaveValue("A note");
  await expect(title).not.toBeFocused();
  expect(read()).toBe(NOTE);

  /* Emptied, it is the word a new note has — and the field shows it as the placeholder. */
  await title.fill("");
  await title.blur();
  await expect.poll(() => new URL(page.url()).searchParams.get("note"), { timeout: 10_000 }).toMatch(/^Untitled( \d+)?$/);
  const moved = path.join(DIR, `${new URL(page.url()).searchParams.get("note")}.note.md`);
  made.push(moved);
  await expect
    .poll(() => fs.existsSync(moved) && fs.readFileSync(moved, "utf8"), { timeout: 5_000 })
    .toMatch(/^---\ntitle: Untitled\n---\n# The plan\n/);
  await expect(title).toHaveValue("");
});

test("renaming the open note from the sidebar follows it, and deleting it leaves nothing open", async ({ page }) => {
  await open(page);
  await openSidebar(page);
  await clickOnHover(page, `[data-dag-sidebar-file="${name}"]`, `[data-dag-sidebar-more="${name}"]`);
  await page.locator('[data-dag-sidebar-menu-item="rename"]').click();
  await page.locator("[data-dag-sidebar-name]").fill(`${name}-renamed`);
  await page.keyboard.press("Enter");
  const renamed = path.join(DIR, `${name}-renamed.note.md`);
  made.push(renamed);
  await expect.poll(() => fs.existsSync(renamed), { timeout: 5_000 }).toBe(true);
  expect(fs.existsSync(file)).toBe(false);
  await expect.poll(() => new URL(page.url()).searchParams.get("note"), { timeout: 5_000 }).toBe(`${name}-renamed`);

  await clickOnHover(page, `[data-dag-sidebar-file="${name}-renamed"]`, `[data-dag-sidebar-more="${name}-renamed"]`);
  await page.locator('[data-dag-sidebar-menu-item="delete"]').click();
  await expect.poll(() => fs.existsSync(renamed), { timeout: 5_000 }).toBe(false);
  await expect(page.locator("[data-dag-welcome]")).toBeVisible({ timeout: 10_000 });
});

test("space O opens the list while the caret is not in the text, and is a space while it is", async ({ page }) => {
  await open(page);
  await endOf(page, "The second paragraph.");
  await page.keyboard.type(" o");
  await expect(page.locator("[data-dag-boards]")).toHaveCount(0);
  await expect.poll(read, { timeout: 5_000 }).toContain("The second paragraph. o");
  /* Out of the text: a press on the margin beside the page. */
  await page.mouse.click(20, 600);
  await page.keyboard.press(" ");
  await page.keyboard.press("o");
  await expect(page.locator("[data-dag-boards]")).toBeVisible();
});

/*
 * A task's page is a note's page, so a task has the title too — above its status and date,
 * as Notion puts a page's properties under its name.
 */
test("a task's title sits above its bar, with Untitled as its placeholder", async ({ page }) => {
  fs.writeFileSync(file, "---\ntitle: Untitled\nstatus: todo\n---\n");
  await open(page);
  const title = page.locator("textarea[data-dag-note-title]");
  await expect(title).toHaveValue("");
  await expect(title).toHaveAttribute("placeholder", "Untitled");
  const bar = page.locator("[data-dag-taskbar]");
  expect((await title.boundingBox())!.y).toBeLessThan((await bar.boundingBox())!.y);
});

test("an image pasted into a note is stored beside it and written as Markdown", async ({ page }) => {
  await open(page);
  await endOf(page, "The last paragraph.");
  await page.keyboard.press("Enter");
  /* A one-pixel PNG on the clipboard, pasted the way a screenshot is. */
  await page.evaluate(() => {
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0),
    );
    const data = new DataTransfer();
    data.items.add(new File([png], "shot.png", { type: "image/png" }));
    const target = document.querySelector(".bn-editor");
    target?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  /* A pasted picture is an attachment (decision 13): kept in the vault's attachments folder, named
     \`Pasted image <stamp>\`, and referred to by id like any other file. */
  await expect.poll(read, { timeout: 10_000 }).toMatch(/!\[[^\]]*\]\(dag:[0-9a-z]{10}\)/);
  const id = /\(dag:([0-9a-z]{10})\)/.exec(read())![1]!;
  const resolved = (await (await page.request.get(`/__board/resolve?id=${id}`)).json()) as { name: string };
  expect(resolved.name).toMatch(/^attachments\/Pasted image \d{14}( \d+)?\.png$/);
  expect(fs.existsSync(path.join(DIR, resolved.name))).toBe(true);
  await page.request.post("/__board/delete", { data: { name: resolved.name, kind: "file" } });
  await expect(page.locator(".bn-visual-media")).toBeVisible();
});

test("a snapshot draws the note read-only, with no editor", async ({ page }) => {
  await page.goto(`/?note=${name}&snapshot=1`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  /* Its title where the editor has its field, and the text under it. */
  await expect(page.locator("[data-dag-note-title-read]")).toHaveText("A note");
  await expect(page.locator("[data-dag-note-title]")).toHaveCount(0);
  await expect(page.locator(".dag-note-view__page.dag-md h1")).toHaveText("The plan");
  await expect(page.locator(".bn-editor")).toHaveCount(0);
  await expect(page.locator(".dag-toolbar")).toHaveCount(0);
});

test("with nothing open, the welcome card starts a note", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-dag-welcome-note]").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("note"), { timeout: 10_000 }).toMatch(/^Untitled/);
  const made_ = new URL(page.url()).searchParams.get("note")!;
  made.push(path.join(DIR, `${made_}.md`));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  /* The sidebar's own way to begin a note: titled Untitled, and named next in its own
     title at the top of the page — which shows the word as a placeholder, not as an
     answer. Escape keeps it. */
  const title = page.locator("[data-dag-note-title]");
  await expect(title).toBeFocused();
  await expect(title).toHaveValue("");
  await expect(title).toHaveAttribute("placeholder", "Untitled");
  await page.keyboard.press("Escape");
  await expect(title).not.toBeFocused();
  expect(fs.readFileSync(path.join(DIR, `${made_}.md`), "utf8")).toMatch(/^---\nid: [0-9a-z]{10}\n---\n$/);
});
