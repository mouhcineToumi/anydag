import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS, boardId, openBoards } from "./boards";
import { auditContrast, type ContrastAudit } from "./contrast";
import { vaulted } from "./vault";

/**
 * Text in the chrome, measured rather than eyeballed.
 *
 * `--dag-color-muted` is 2.46:1 on Paper's page and 2.29:1 on its sidebar, so every rule that
 * colours words with it uses `slate` now, and only disabled controls, separators and decorative
 * glyphs keep `muted` (`scripts/chrome-muted-allowlist.json`). This walks the six pages the issue
 * names — home, a board, a note, Search, Tasks and the calendar — in Paper and Paper dark, and
 * computes the WCAG contrast of every visible text node and placeholder. It is the same check
 * axe's `color-contrast` rule makes, without a dependency the project would have to carry.
 *
 * The diagram surface is skipped: `nodes.css` is out of scope, and its own `muted` text is a
 * separate decision from the chrome's.
 */

const WORD = (id: string) => `zq${id.slice(-10)}`;

const BOARD = (word: string) => `---
title: Contrast board ${word}
---

\`\`\`md {#a x=0 y=0 w=320}
A note about ${word}.
\`\`\`
`;

const NOTE = (word: string) => `---
title: Contrast note
---
# Heading

A paragraph about ${word}, long enough to be read.

- first item
- second item
`;

const PROJECT = `---
title: Contrast project
project: active
---
`;

const TASK = `---
title: Contrast task
status: todo
project: active
---
What it is about.
`;

const EVENT = `---
title: Contrast event
start: 2031-03-12
end: 2031-03-13
project: active
---
What it is about.
`;

let folder = "";
let word = "";
const board = () => `${folder}/plan`;
const note = () => `${folder}/journal`;
const project = () => `${folder}/project`;
const event = () => `${folder}/event`;

test.beforeEach(({}, info) => {
  const id = info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "");
  folder = `e2e-contrast-${id}`;
  word = WORD(id);
  const dir = path.join(BOARDS, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.board.md"), BOARD(word));
  fs.writeFileSync(path.join(dir, "journal.note.md"), NOTE(word));
  fs.writeFileSync(path.join(dir, "project.note.md"), PROJECT);
  fs.writeFileSync(path.join(dir, "task.note.md"), TASK);
  fs.writeFileSync(path.join(dir, "event.note.md"), EVENT);
});

test.afterEach(() => {
  /* Only the folder this check made, and only when it knows which (`CLAUDE.md`, *Things that will bite*). */
  if (folder) fs.rmSync(path.join(BOARDS, folder), { recursive: true, force: true });
  folder = "";
  word = "";
});

async function settle(page: Page, theme: string): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function check(page: Page, selector: string, where: string, { placeholders = false } = {}): Promise<ContrastAudit> {
  const result = await auditContrast(page, selector, ".dag-layer");
  /* A selector that finds nothing would pass every assertion under it. */
  expect(result.text, `${where}: text found`).toBeGreaterThan(0);
  if (placeholders) expect(result.placeholders, `${where}: placeholders found`).toBeGreaterThan(0);
  failures.push(...result.failures.map((failure) => `${where}: ${failure}`));
  return result;
}

const failures: string[] = [];

test("chrome text meets contrast on the six pages in Paper and Paper dark", async ({ page }) => {
  failures.length = 0;
  for (const theme of ["paper", "paper-dark"]) {
    /* Home: the welcome card and the shell around it. */
    await page.goto(await vaulted(page, `/?theme=${theme}`));
    await expect(page.locator("[data-dag-welcome]")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await check(page, ".dag-shell", `${theme} / home`);

    /* A board: the toolbar, the dock and the page's own chrome; the drawing is skipped. */
    await page.goto(await vaulted(page, `/?board=${board()}&theme=${theme}`));
    await expect(page.locator('[data-dag-item="a"]')).toBeVisible();
    await settle(page, theme);
    await check(page, ".dag-shell", `${theme} / board`);

    /* A note: the title, the editor's prose and the backlink strip. */
    await page.goto(await vaulted(page, `/?note=${note()}&theme=${theme}`));
    await expect(page.locator("[data-dag-note-view]")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await check(page, ".dag-shell", `${theme} / note`);

    /* Search: the filter's placeholder, the count, the kind labels and the folder headings. */
    await openBoards(page);
    await page.locator("[data-dag-boards] input").fill(word);
    await expect(page.locator("[data-dag-hit]").first()).toBeVisible({ timeout: 15_000 });
    await check(page, "[data-dag-boards]", `${theme} / search`, { placeholders: true });

    /* Tasks: the groups, their counts, every row and the quick-add row. */
    await page.goto(await vaulted(page, `/?tasks=1&theme=${theme}`));
    await page.locator("[data-dag-tasks-filter]").fill(folder);
    await expect(page.locator(`[data-dag-task-row="${folder}/task"]`)).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await check(page, ".dag-shell", `${theme} / tasks`, { placeholders: true });

    /* The calendar: day names, the hour gutter, the Show menu and the items on the week. */
    const id = await boardId(page, project());
    await page.goto(await vaulted(page, `/?project=${id}&calendar=week&date=2031-03-15&theme=${theme}`));
    await expect(page.locator("[data-dag-calendar]")).toBeVisible();
    await expect(page.locator(`[data-dag-cal-item="${event()}"]`).first()).toBeVisible({ timeout: 15_000 });
    await page.locator("[data-dag-calendar-show]").click();
    await expect(page.locator("[data-dag-calendar-show-menu]")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await check(page, ".dag-shell", `${theme} / calendar`);
  }
  expect(failures, "every page").toEqual([]);
});
