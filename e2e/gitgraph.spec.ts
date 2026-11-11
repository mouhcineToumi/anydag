import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";

/**
 * A git graph built with the pointer: the lane controls (`src/edit/GitLanes.tsx`), the drag that
 * merges a branch (`historyDrop` in `drag.ts`) and the commit's own panel (`GitProps`).
 *
 * Every check reads the bytes on disk, because what is being proved is that a gesture wrote the
 * command a person would otherwise have had to type — the `checkout` included. One board per test:
 * the suite runs in parallel and these write to disk.
 */

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-git-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");
const write = (text: string) => fs.writeFileSync(file, text);

/** The fence's body as lines, so a check about the graph cannot be answered elsewhere. */
const lines = () => (read().split("{#g")[1] ?? "").split("```")[0]!.split("\n").slice(1).filter(Boolean);

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** Select the graph by its frame's header, which is not a commit, a lane or a link. */
async function select(page: Page) {
  const item = page.locator('[data-dag-item="g"]');
  const b = (await item.boundingBox())!;
  await page.mouse.click(b.x + 6, b.y + 6);
  await expect(page.locator('[data-dag-git-lanes="g"]')).toHaveCount(1);
}

/** Click, pause, click: the second press picks the card out, and Chromium pairs fast ones. */
async function pick(page: Page, selector: string) {
  await page.locator(selector).click();
  await page.waitForTimeout(400);
  await page.locator(selector).click();
  await expect(page.locator(`${selector}[data-dag-picked]`)).toHaveCount(1);
}

/** Type into the rename box the last gesture opened, and commit it. */
async function rename(page: Page, text: string) {
  const box = page.locator("[data-dag-rename-box]");
  await expect(box).toBeVisible();
  await box.fill(text);
  await box.press("Enter");
  await expect(box).toHaveCount(0);
}

test("a git graph is built from empty with the lane controls", { tag: "@smoke" }, async ({ page }) => {
  write("```gitgraph {#g x=0 y=0}\n```\n");
  await open(page);
  await select(page);

  /* The `+` at the end of main: a commit, and its message open for typing. */
  await page.locator('[data-dag-git-plus="main"]').click();
  await rename(page, "init");
  await expect.poll(lines, { timeout: 5_000 }).toEqual(['commit "init"']);

  /* + New branch, off the commit just made (it is picked), named in the box that opens. */
  await page.locator("[data-dag-git-new-branch]").click();
  await rename(page, "parser");
  await expect.poll(lines, { timeout: 5_000 }).toEqual(['commit "init"', "branch parser", 'commit "New commit"']);

  /* The `+` on main writes the checkout a person would have had to remember. */
  await page.locator('[data-dag-git-plus="main"]').click();
  await rename(page, "fix");
  await expect
    .poll(lines, { timeout: 5_000 })
    .toEqual(['commit "init"', "branch parser", 'commit "New commit"', "checkout main", 'commit "fix"']);

  /* And the chip on a branch's name renames every statement that names it. */
  await page.locator('[data-dag-git-chip="parser"]').click();
  await rename(page, "lexer");
  await expect
    .poll(lines, { timeout: 5_000 })
    .toEqual(['commit "init"', "branch lexer", 'commit "New commit"', "checkout main", 'commit "fix"']);
  await expect(page.locator('[data-dag-git-chip="main"]')).toBeDisabled();
});

test("dragging a branch's tip onto another lane merges it there", async ({ page }) => {
  write('```gitgraph {#g x=0 y=0}\ncommit "one"\nbranch feature\ncommit "two"\ncheckout main\ncommit "three"\n```\n');
  await open(page);

  const tip = '[data-dag-node="c1"]';
  await pick(page, tip);
  const from = (await page.locator(tip).boundingBox())!;
  const lane = (await page.locator('[data-dag-item="g"] [data-dag-lane="main"]').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  /* Past the last commit, so what is under the pointer is the band and nothing drawn in it. */
  await page.mouse.move(lane.x + lane.width - 4, lane.y + lane.height / 2, { steps: 16 });
  await page.mouse.up();

  await expect
    .poll(lines, { timeout: 5_000 })
    .toEqual(['commit "one"', "branch feature", 'commit "two"', "checkout main", 'commit "three"', "merge feature"]);
});

test("a picked commit is tagged, relabelled and reordered from the panel", async ({ page }) => {
  write('```gitgraph {#g x=0 y=0}\ncommit "one"\ncommit "two"\n```\n');
  await open(page);
  await pick(page, '[data-dag-node="c0"]');
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-dag-props="c0"]')).toHaveCount(1);

  await page.locator("[data-dag-prop-tag]").fill("v1");
  await page.locator("[data-dag-prop-tag]").blur();
  await expect.poll(lines, { timeout: 5_000 }).toEqual(['commit "one"', 'tag "v1"', 'commit "two"']);

  await page.locator("[data-dag-prop-title]").fill("first");
  await page.locator("[data-dag-prop-title]").blur();
  await expect.poll(lines, { timeout: 5_000 }).toEqual(['commit "first"', 'tag "v1"', 'commit "two"']);

  /* The first commit has nothing before it; after it, the swap carries the tag along. */
  await expect(page.locator('[data-dag-git-move="earlier"]')).toBeDisabled();
  await page.locator('[data-dag-git-move="later"]').click();
  await expect.poll(lines, { timeout: 5_000 }).toEqual(['commit "two"', 'commit "first"', 'tag "v1"']);
});
