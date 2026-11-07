import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * A code block coloured by its language, and checked where the language is: the read-only
 * note, the note editor, and a fix typed into the editor taking the error away — with nothing of the
 * colouring ever written into the file.
 */

const NOTE = `---
title: Code colours
---
\`\`\`python
def double(x):
    return x * 2  # twice
\`\`\`

\`\`\`py
def two_sum(nums, target):
    for i, n in enumerate(nums)
        return i
\`\`\`

\`\`\`sql
SELECT count(*) FROM cd.members;
\`\`\`
`;

let note = "";
let problems: string[] = [];

test.beforeEach(async ({ page }, info) => {
  note = `e2e-colours-${info.testId}`;
  fs.writeFileSync(path.join(BOARDS, `${note}.note.md`), NOTE);
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  if (note) fs.rmSync(path.join(BOARDS, `${note}.note.md`), { force: true });
  expect(problems, "console output").toEqual([]);
});

const readNote = () => fs.readFileSync(path.join(BOARDS, `${note}.note.md`), "utf8");

async function ready(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

test("a note read-only colours each block by its language and counts what Python cannot read", { tag: "@smoke" }, async ({ page }) => {
  await ready(page, `/?note=${note}&view=1`);
  const blocks = page.locator(".dag-code");
  await expect(blocks).toHaveCount(3);
  /* Ready means coloured: nothing waited for here but the page saying it is drawn. */
  await expect(blocks.nth(0).locator(".dag-tok-keyword").first()).toHaveText("def");
  await expect(blocks.nth(0).locator(".dag-tok-comment")).toHaveText("# twice");
  await expect(blocks.nth(0).locator(".dag-code__problems")).toHaveCount(0);

  await expect(blocks.nth(1).locator(".dag-code__problems")).toHaveText("1 syntax error");
  await expect(blocks.nth(1).locator("[data-dag-code-error]").first()).toHaveAttribute("title", /line 2/);

  /* SQL is coloured and never checked. */
  await expect(blocks.nth(2)).toHaveAttribute("data-dag-code-read", "coloured");
  await expect(blocks.nth(2).locator(".dag-tok-keyword").first()).toHaveText("SELECT");
});

test("in the editor a fix typed into the block takes the error away, and the file holds only the code", async ({ page }) => {
  await ready(page, `/?note=${note}`);
  const blocks = page.locator('.bn-block-content[data-content-type="codeBlock"]');
  await expect(blocks).toHaveCount(3);
  const broken = blocks.nth(1);
  await expect(broken.locator("[data-dag-code-error]").first()).toBeVisible();
  await expect.poll(() => broken.evaluate((b) => getComputedStyle(b).getPropertyValue("--code-problems"))).toBe('"1 syntax error"');

  /* The caret onto the line missing its colon, at its end. */
  const box = (await broken.locator("code").boundingBox())!;
  await page.mouse.click(box.x + 2, box.y + 4);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.type(":");

  await expect(broken.locator("[data-dag-code-error]")).toHaveCount(0);
  await expect.poll(() => broken.evaluate((b) => getComputedStyle(b).getPropertyValue("--code-problems"))).toBe("");
  await expect.poll(readNote).toContain("for i, n in enumerate(nums):\n");
  expect(readNote()).not.toMatch(/dag-tok|<span/);
});
