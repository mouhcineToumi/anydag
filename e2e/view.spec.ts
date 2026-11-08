import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS, boardId } from "./boards";

/**
 * The read-only view — `?view=1`.
 *
 * Three claims: it draws a board and a note as the file says; it pans, zooms, fits and pages; and
 * it does so **without the editor ever being fetched**, which is a fact about the network rather
 * than about the tree and so is checked on the requests the page makes.
 *
 * Each test writes its own fixture, named for its test id, because the suite runs in parallel
 * against one directory.
 */

const BOARD = `---
title: A board to look at
pages:
  - id: one
    name: One
  - id: two
    name: Two
---

\`\`\`md {#hello x=0 y=0 w=320}
## Hello
Drawn read-only.
\`\`\`

\`\`\`arch {#stack x=0 y=200}
service api "API" icon=server
store db "Postgres" icon=postgresql
api --> db
\`\`\`

\`\`\`md {#later x=0 y=0 w=320 page=two}
The second page.
\`\`\`
`;

const NOTE = `---
title: A note to look at
---
# Heading

A paragraph with an anchor. ^para

- one
- two
`;

let stem = "";
let problems: string[] = [];
let fetched: string[] = [];

test.beforeEach(({ page }, info) => {
  stem = `e2e-view-${info.testId}`;
  fs.writeFileSync(path.join(BOARDS, `${stem}.board.md`), BOARD);
  fs.writeFileSync(path.join(BOARDS, `${stem}-n.note.md`), NOTE);
  problems = [];
  fetched = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("request", (r) => fetched.push(new URL(r.url()).pathname));
});

test.afterEach(() => {
  fs.rmSync(path.join(BOARDS, `${stem}.board.md`), { force: true });
  fs.rmSync(path.join(BOARDS, `${stem}-n.note.md`), { force: true });
  expect(problems, "console output").toEqual([]);
});

const ready = (page: Page) =>
  page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });

/** Anything that is the canvas or the editor: the lazy `App` chunk, `src/edit/`, BlockNote. */
const editorFetched = () => fetched.filter((p) => /\/src\/App\.tsx|\/src\/edit\/|blocknote|mantine|BlockEditor/i.test(p));

test("draws a board without fetching the editor, and pages it", { tag: "@smoke" }, async ({ page }) => {
  await page.goto(`/?view=1&board=${stem}`);
  await ready(page);
  await expect(page.locator("[data-dag-view-title]")).toHaveText("A board to look at");
  await expect(page.locator('[data-dag-item="hello"]')).toBeVisible();
  await expect(page.locator('[data-dag-item="stack"] [data-dag-node="db"]')).toBeVisible();
  /* Nothing on the view is pickable or movable: an `Item` with no editor behind it. */
  await expect(page.locator("[data-dag-movable]")).toHaveCount(0);
  await expect(page.locator("[data-dag-open-boards]")).toHaveCount(0);

  await page.locator('[data-dag-page="two"]').click();
  await expect(page.locator('[data-dag-item="later"]')).toBeVisible();
  await expect(page.locator('[data-dag-item="hello"]')).toHaveCount(0);

  expect(editorFetched()).toEqual([]);
});

test("zooms and fits", async ({ page }) => {
  await page.goto(`/?view=1&board=${stem}`);
  await ready(page);
  const zoom = () => page.locator(".dag-viewport").getAttribute("data-zoom").then(Number);
  const fitted = await zoom();
  await page.locator(".dag-zoombar button").last().click(); // fit is idempotent
  await page.locator(".dag-zoombar button").first().click(); // out
  await expect.poll(zoom).toBeLessThan(fitted);
});

test("opens a board by its permanent id", async ({ page }) => {
  /* The id index is fed by the file watcher, not by the write: poll the list until it names the file. */
  const id = await boardId(page, stem);
  expect(id).toMatch(/^[0-9a-z]{10}$/);
  await page.goto(`/?view=1&ref=${id}`);
  await ready(page);
  await expect(page.locator("[data-dag-view-title]")).toHaveText("A board to look at");
});

test("draws a note read-only, with a block's anchor off the words and on the element", async ({ page }) => {
  await page.goto(`/?view=1&note=${stem}-n`);
  await ready(page);
  await expect(page.locator("[data-dag-view-title]")).toHaveText("A note to look at");
  /* The title heads the page as it does in the editor, above the text's own headings. */
  await expect(page.locator("[data-dag-note-title-read]")).toHaveText("A note to look at");
  const para = page.locator('[id="^para"]');
  await expect(para).toHaveText("A paragraph with an anchor.");
  await expect(page.locator(".bn-editor")).toHaveCount(0);
  expect(editorFetched()).toEqual([]);

  /* A note the view is showing follows the file. */
  fs.writeFileSync(path.join(BOARDS, `${stem}-n.note.md`), NOTE.replace("# Heading", "# Rewritten"));
  await expect(page.locator(".dag-note-view__page h1")).toHaveText("Rewritten");
});

test("says so when there is nothing with that id", async ({ page }) => {
  /* The resolve route's 404 is the answer under test, and Chromium logs any 4xx as an error. */
  await page.goto(`/?view=1&ref=0000000000`);
  await expect(page.locator('[data-dag-view="missing"]')).toContainText("0000000000");
  problems = problems.filter((p) => !/404/.test(p));
});
