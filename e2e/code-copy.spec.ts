import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * A code block's language and copy button, everywhere one is drawn: the note editor, a
 * note read-only, a board's text card. What is ours is what the button hands the clipboard — the
 * block as it is now, never the label — and that pressing it disturbs nothing: not the caret in the
 * editor, not the board's selection, not a byte of the file.
 *
 * The clipboard is recorded rather than read back: eight workers share one system clipboard, and
 * some machines the suite runs on have none. `copyText`'s fallback is a browser's business.
 */

const NOTE = `---
title: Code
---
Some prose first.

\`\`\`text
You are a research analyst.

TOPIC
LLM fundamentals
\`\`\`

\`\`\`
plain, no language
\`\`\`

\`\`\`python
def greet(name):
    return name
\`\`\`
`;

const BOARD = `---
title: Code on a board
---

\`\`\`\`md {#snippet x=0 y=0 w=420}
**Run it**

\`\`\`sh
npm run dev
\`\`\`
\`\`\`\`
`;

let note = "";
let board = "";
let problems: string[] = [];

test.beforeEach(async ({ page }, info) => {
  /* Two stems: a board and a note may never share a name. */
  note = `e2e-code-${info.testId}`;
  board = `e2e-codeb-${info.testId}`;
  fs.writeFileSync(path.join(BOARDS, `${note}.note.md`), NOTE);
  fs.writeFileSync(path.join(BOARDS, `${board}.board.md`), BOARD);
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void w.__copied.push(text) },
    });
  });
});

test.afterEach(() => {
  if (note) fs.rmSync(path.join(BOARDS, `${note}.note.md`), { force: true });
  if (board) fs.rmSync(path.join(BOARDS, `${board}.board.md`), { force: true });
  expect(problems, "console output").toEqual([]);
});

const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
const readNote = () => fs.readFileSync(path.join(BOARDS, `${note}.note.md`), "utf8");

async function ready(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

test("in the note editor a code block says its language, and its button copies what is in it now", async ({ page }) => {
  await ready(page, `/?note=${note}`);
  const blocks = page.locator('.bn-block-content[data-content-type="codeBlock"]');
  await expect(blocks).toHaveCount(3);
  /* A bare fence and ```text are one block to the editor, and say so alike. */
  await expect(blocks.locator(".dag-code__lang")).toHaveText(["text", "text", "python"]);

  /* Type into the last block, then copy it: the copy is the block as it is now. */
  const py = blocks.nth(2);
  const box = (await py.locator("code").boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + box.height - 4);
  await page.keyboard.press("End");
  await page.keyboard.type(".title()");
  await py.locator(".dag-code__copy").click();
  await expect.poll(() => copied(page)).toEqual(["def greet(name):\n    return name.title()"]);
  await expect(py.locator(".dag-code__copy")).toHaveAttribute("data-dag-code-copy", "copied");

  /* Copying another block does not take the caret out of the one being typed in. */
  await blocks.first().locator(".dag-code__copy").click();
  await expect.poll(() => copied(page)).toHaveLength(2);
  expect((await copied(page))[1]).toBe("You are a research analyst.\n\nTOPIC\nLLM fundamentals");
  await page.keyboard.type("  # done");

  /* The label never reaches the file, and the blocks nobody typed in are byte for byte as written. */
  await expect.poll(readNote, { timeout: 5_000 }).toContain("return name.title()  # done");
  expect(readNote()).toBe(NOTE.replace("    return name\n", "    return name.title()  # done\n"));
});

test("a note drawn read-only copies too, and a snapshot draws the language without the button", async ({ page }) => {
  await ready(page, `/?note=${note}&view=1`);
  const blocks = page.locator(".dag-code");
  await expect(blocks).toHaveCount(3);
  await expect(blocks.locator(".dag-code__lang")).toHaveText(["text", "text", "python"]);
  await blocks.nth(1).locator(".dag-code__copy").click();
  await blocks.nth(2).locator(".dag-code__copy").click();
  await expect.poll(() => copied(page)).toEqual(["plain, no language", "def greet(name):\n    return name"]);

  await ready(page, `/?note=${note}&snapshot=1`);
  await expect(page.locator(".dag-code__lang")).toHaveText(["text", "text", "python"]);
  await expect(page.locator(".dag-code__copy")).toHaveCount(0);
});

test("on a board the button copies without selecting the card, and an export leaves it out", async ({ page }) => {
  await ready(page, `/?board=${board}`);
  const card = page.locator('.dag-item[data-dag-item="snippet"]');
  await expect(card.locator(".dag-code__lang")).toHaveText("sh");
  await card.locator(".dag-code__copy").click();
  await expect.poll(() => copied(page)).toEqual(["npm run dev"]);
  await expect(page.locator("[data-dag-selected]")).toHaveCount(0);

  const svg = await page.evaluate(
    () =>
      new Promise<string>((reply) => document.dispatchEvent(new CustomEvent("dag:export", { detail: { kind: "svg", reply } }))),
  );
  expect(svg).toContain("dag-code__lang");
  expect(svg).not.toContain("dag-code__copy");
});
