import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * References between notes and boards.
 *
 * The claims, each a line of the issue's "done when": a link, an embed and a backlink work in both
 * directions; a reference is stored by id and shows the target's title as it is now; and renaming or
 * moving the target keeps every reference intact. The file is what is checked wherever the claim is
 * about what was written, and the page wherever it is about what is shown.
 *
 * Each test writes its own board and note, named for its test id, because the suite runs in
 * parallel against one directory.
 */

let stem = "";
/* A title of this test's own: every test runs at once over one account, and five boards called "The
   target board" is a picker in which Enter takes whichever of them ranks first. */
let target = "";
let problems: string[] = [];
const made: string[] = [];

const boardFile = () => path.join(BOARDS, `${stem}-b.board.md`);
const noteFile = () => path.join(BOARDS, `${stem}-n.note.md`);

const boardText = () => `---
title: ${target}
---

\`\`\`arch {#stack x=0 y=0}
service api "API" icon=server
store db "Postgres" icon=postgresql
api --> db
\`\`\`
`;

test.beforeEach(({ page }, info) => {
  stem = `e2e-refs-${info.testId}`;
  target = `Target ${info.testId.slice(-6)}${info.repeatEachIndex}`;
  fs.writeFileSync(boardFile(), boardText());
  fs.writeFileSync(noteFile(), "---\ntitle: The linking note\n---\n# Linking\n\nStart here.\n");
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  for (const f of [boardFile(), noteFile(), ...made.splice(0)]) fs.rmSync(f, { force: true });
  expect(problems, "console output").toEqual([]);
});

/** The permanent ids of this test's two documents, as the index hands them out. */
async function ids(page: Page): Promise<{ board: string; note: string }> {
  const { docs } = (await (await page.request.get("/__board/index")).json()) as { docs: { id: string; name: string }[] };
  const of = (name: string) => docs.find((d) => d.name === name)!.id;
  return { board: of(`${stem}-b`), note: of(`${stem}-n`) };
}

const ready = (page: Page) =>
  page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });

test("a link shows the target's live title, and survives the target being renamed and moved", { tag: "@smoke" }, async ({
  page,
}) => {
  const { board } = await ids(page);
  fs.writeFileSync(noteFile(), `---\ntitle: The linking note\n---\nSee [an old title](dag:${board}).\n`);
  await page.goto(`/?view=1&note=${stem}-n`);
  await ready(page);
  const link = page.locator(`[data-dag-ref="${board}"]`);
  await expect(link).toHaveText(target);

  /* Renamed and moved in one go, through the route the board list uses — nothing in the note changes. */
  const moved = await page.request.post("/__board/rename", { data: { name: `${stem}-b`, to: `${stem}-dir/renamed` } });
  expect(moved.ok()).toBe(true);
  made.push(path.join(BOARDS, `${stem}-dir`, "renamed.board.md"));
  fs.writeFileSync(
    path.join(BOARDS, `${stem}-dir`, "renamed.board.md"),
    boardText().replace(`title: ${target}`, "title: A new title"),
  );
  await expect(link).toHaveText("A new title");
  expect(fs.readFileSync(noteFile(), "utf8")).toContain(`(dag:${board})`);

  /* And following it opens the board under its new name. */
  await link.click();
  await expect(page.locator("[data-dag-view-title]")).toHaveText("A new title");
  fs.rmSync(path.join(BOARDS, `${stem}-dir`), { recursive: true, force: true });
});

test("following a reference opens it here without loading the page, and Back returns", async ({ page }) => {
  const { board } = await ids(page);
  fs.writeFileSync(noteFile(), `---\ntitle: The linking note\n---\n# Linking\n\nSee [the board](dag:${board}).\n\nAnd more.\n`);
  await page.goto(`/?note=${stem}-n`);
  await ready(page);
  const chip = page.locator(`[data-dag-note-editor] [data-dag-ref="${board}"]`);
  await expect(chip).toHaveText(target);
  /* Something only this page holds: a load of any page would lose it. */
  await page.evaluate(() => ((window as unknown as { dagSame: string }).dagSame = "the same page"));
  const loads: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "document") loads.push(r.url());
  });

  await chip.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("board"), { timeout: 10_000 }).toBe(`${stem}-b`);
  await expect(page.locator('[data-dag-item="stack"]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { dagSame?: string }).dagSame)).toBe("the same page");

  /* A new entry in the history, as following one always was: Back is the note it was followed from. */
  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get("note"), { timeout: 10_000 }).toBe(`${stem}-n`);
  await expect(chip).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { dagSame?: string }).dagSame)).toBe("the same page");
  expect(loads).toEqual([]);
});

test("typing @ offers every document by title and writes a reference by id", async ({ page }) => {
  const { board } = await ids(page);
  await page.goto(`/?note=${stem}-n`);
  await ready(page);
  await page.locator(".bn-block-content", { hasText: "Start here." }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(` See @${target}`);
  await expect(page.locator(".bn-suggestion-menu-item").first()).toContainText(target);
  await page.keyboard.press("Enter");
  await expect.poll(() => fs.readFileSync(noteFile(), "utf8")).toContain(`See [${target}](dag:${board})`);
  await expect(page.locator(`[data-dag-note-editor] [data-dag-ref="${board}"]`)).toHaveText(target);
});

test("[[ does what @ does", async ({ page }) => {
  const { board } = await ids(page);
  await page.goto(`/?note=${stem}-n`);
  await ready(page);
  await page.locator(".bn-block-content", { hasText: "Start here." }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(` [[${target}`);
  await expect(page.locator(".bn-suggestion-menu-item").first()).toContainText(target);
  await page.keyboard.press("Enter");
  await expect.poll(() => fs.readFileSync(noteFile(), "utf8")).toContain(`(dag:${board})`);
});

test("![ embeds a live board in the note, drawn read-only", async ({ page }) => {
  const { board } = await ids(page);
  await page.goto(`/?note=${stem}-n`);
  await ready(page);
  await page.locator(".bn-block-content", { hasText: "Start here." }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(`![${target}`);
  await expect(page.locator(".bn-suggestion-menu-item").first()).toContainText(target);
  await page.keyboard.press("Enter");
  await expect.poll(() => fs.readFileSync(noteFile(), "utf8")).toContain(`![${target}](dag:${board})`);
  const embed = page.locator(`[data-dag-embed="${board}"][data-dag-embed-kind="board"]`);
  await expect(embed.locator('[data-dag-node="db"]')).toBeVisible();
});

test("an embed of an id the page has not seen yet is a card until the board arrives, then the board, with no reload", async ({
  page,
}) => {
  /* #123: the Assistant made a board and embedded it in the open note, from outside the page. Here
     the note names the id first and the board is written after, which is the harder order. */
  const late = Array.from(createHash("sha1").update(stem).digest())
    .slice(0, 10)
    .map((b) => "0123456789abcdefghjkmnpqrstvwxyz"[b & 31])
    .join("");
  const lateFile = path.join(BOARDS, `${stem}-late.board.md`);
  made.push(lateFile);
  await page.goto(`/?note=${stem}-n`);
  await ready(page);
  const loads: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "document") loads.push(r.url());
  });

  fs.writeFileSync(noteFile(), `---\ntitle: The linking note\n---\n# Linking\n\nStart here.\n\n![The late board](dag:${late})\n`);
  const embed = page.locator(`[data-dag-note-editor] [data-dag-embed="${late}"]`);
  await expect(embed).toHaveClass(/dag-embed--card/);
  await expect(embed).toContainText("The late board");
  await expect(page.locator(".bn-block-content", { hasText: "Start here." })).toBeVisible();

  /* And the first refresh after the board arrives gets no answer — the desktop's requests waited for
     ever behind six held connections, and a refresh that failed used to wait for the next change. */
  let dropped = 0;
  await page.route("**/__board/index*", (route) => (dropped++ === 0 ? route.abort() : route.continue()));
  fs.writeFileSync(lateFile, boardText().replace(`title: ${target}`, `id: ${late}\ntitle: ${target}`));
  const drawn = page.locator(`[data-dag-note-editor] [data-dag-embed="${late}"][data-dag-embed-kind="board"]`);
  await expect(drawn.locator('[data-dag-node="db"]')).toBeVisible({ timeout: 10_000 });
  await expect(drawn).toHaveAttribute("data-dag-embed-ready", "");
  expect(dropped).toBeGreaterThan(1);
  expect(loads).toEqual([]);
  /* The one request this check refused is on the console; nothing else may be. */
  problems = problems.filter((p) => !/Failed to load resource: net::ERR_FAILED/.test(p));
});

test("a note placed on a board is drawn as a card, and a backlink goes back to it", async ({ page }) => {
  const { note, board } = await ids(page);
  fs.writeFileSync(
    noteFile(),
    `---\ntitle: The linking note\n---\n# Linking\n\nA paragraph in the note, pointing at [the board](dag:${board}).\n`,
  );
  fs.writeFileSync(boardFile(), `${boardText()}\n\`\`\`md {#card x=0 y=240 w=420}\n![The linking note](dag:${note})\n\`\`\`\n`);
  await page.goto(`/?board=${stem}-b`);
  await ready(page);
  /* Its title and what it is, and none of its text: a card of one size, whatever the note holds. */
  const card = page.locator(`[data-dag-item="card"] [data-dag-embed="${note}"][data-dag-embed-kind="note"]`);
  await expect(card).toHaveAttribute("data-dag-embed-placed", "");
  await expect(card).toContainText("The linking note");
  await expect(card).not.toContainText("A paragraph in the note");

  /* The note links to the board, so the board lists the note — and following it opens the note. */
  await page.locator("[data-dag-backlinks-toggle]").click();
  const row = page.locator(`[data-dag-backlink="${note}"]`);
  await expect(row).toContainText("The linking note");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`note=${stem}-n`));
  await ready(page);
  /* And the note lists the board, which embeds it. */
  await expect(page.locator("[data-dag-backlinks]")).toHaveAttribute("data-dag-backlinks", "1");
});

test("the library offers every note as a card to place on a board", async ({ page }) => {
  const { note } = await ids(page);
  await page.goto(`/?board=${stem}-b`);
  await ready(page);
  await page.locator("[data-dag-library-toggle]").click();
  const entry = page.locator(`[data-dag-component="note-card:${note}"]`);
  await expect(entry).toBeVisible();
  await entry.click();
  /* One `md` card whose whole body is the embed, by id — and it draws the card that names the note. */
  await expect.poll(() => fs.readFileSync(boardFile(), "utf8")).toContain(`![The linking note](dag:${note})`);
  await expect(page.locator(`[data-dag-embed="${note}"][data-dag-embed-kind="note"]`)).toContainText("The linking note");
});

test("a card placed on a board is one size whatever it holds, and its button opens it", async ({ page }) => {
  const { note, board } = await ids(page);
  const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of a long note.`).join("\n\n");
  fs.writeFileSync(noteFile(), `---\ntitle: The linking note\n---\n${long}\n`);
  const other = path.join(BOARDS, `${stem}-c.board.md`);
  made.push(other);
  fs.writeFileSync(
    other,
    `---\ntitle: Cards\n---\n\n\`\`\`md {#long x=0 y=0 w=360}\n![](dag:${note})\n\`\`\`\n\n\`\`\`md {#board x=400 y=0 w=360}\n![](dag:${board})\n\`\`\`\n`,
  );
  await page.goto(`/?board=${stem}-c`);
  await ready(page);
  const longCard = page.locator(`[data-dag-item="long"] [data-dag-embed-placed]`);
  const boardCard = page.locator(`[data-dag-item="board"] [data-dag-embed-placed]`);
  await expect(boardCard).toHaveAttribute("data-dag-embed-kind", "board");
  await expect(boardCard).toContainText(target);
  /* Forty paragraphs and a board draw as two cards of one height. */
  const [a, b] = [(await longCard.boundingBox())!, (await boardCard.boundingBox())!];
  expect(Math.abs(a.height - b.height)).toBeLessThan(1);
  await expect(longCard).not.toContainText("Paragraph 1");

  /* A press on the card is the board's: it selects the item and opens nothing. */
  await longCard.locator(".dag-embed__name").click();
  await expect(page.locator('[data-dag-item="long"][data-dag-selected]')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("board")).toBe(`${stem}-c`);
  /* The button is what opens it, on its own page. */
  await longCard.locator("[data-dag-embed-open]").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("note"), { timeout: 10_000 }).toBe(`${stem}-n`);
  await ready(page);
});

test("the slash menu's Board opens the same picker ![ does", async ({ page }) => {
  const { board } = await ids(page);
  await page.goto(`/?note=${stem}-n`);
  await ready(page);
  await page.locator(".bn-block-content", { hasText: "Start here." }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/board");
  await expect(page.locator(".bn-suggestion-menu-item").first()).toContainText("Board");
  await page.keyboard.press("Enter");
  await page.keyboard.type(target);
  await expect(page.locator(".bn-suggestion-menu-item").first()).toContainText(target);
  await page.keyboard.press("Enter");
  await expect.poll(() => fs.readFileSync(noteFile(), "utf8")).toContain(`![${target}](dag:${board})`);
});
