import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * Equations, everywhere Markdown is drawn: a note read-only and in the editor, a board's text
 * card, a quiz. What is held: KaTeX has drawn every equation before the page says it is ready, a price
 * stays a price, an equation that does not parse shows its TeX, and the editor's gestures write the
 * file the way an agent would have written it — and nothing else in it.
 */

const NOTE = `---
title: Equations
---
Short line.

Costs $5 or $10, and the matrix $W_Q$ projects it:$$Q = X W_Q$$Where it goes on.

$$
\\frac{a}{b}
$$

A broken one: $\\frac{a$ and on.
`;

const BOARD = `---
title: Equations on a board
---

\`\`\`md {#eq x=0 y=0 w=420}
The probability is $p_i = \\frac{\\exp(z_i)}{\\sum_j \\exp(z_j)}$, at $5 or $10.

$$
\\sqrt{d_k}
$$
\`\`\`
`;

const QUIZ = `---
title: Equations quiz
---

## What is $\\sqrt{4}$? {#q1}

- [x] $2$
- [ ] $4$
`;

let note = "";
let board = "";
let quiz = "";
let problems: string[] = [];

test.beforeEach(async ({ page }, info) => {
  /* Three stems: a board, a note and a quiz may never share a name. */
  note = `e2e-math-${info.testId}`;
  board = `e2e-mathb-${info.testId}`;
  quiz = `e2e-mathq-${info.testId}`;
  fs.writeFileSync(path.join(BOARDS, `${note}.note.md`), NOTE);
  fs.writeFileSync(path.join(BOARDS, `${board}.board.md`), BOARD);
  fs.writeFileSync(path.join(BOARDS, `${quiz}.quiz.md`), QUIZ);
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  if (note) fs.rmSync(path.join(BOARDS, `${note}.note.md`), { force: true });
  if (board) fs.rmSync(path.join(BOARDS, `${board}.board.md`), { force: true });
  if (quiz) fs.rmSync(path.join(BOARDS, `${quiz}.quiz.md`), { force: true });
  expect(problems, "console output").toEqual([]);
});

const readNote = () => fs.readFileSync(path.join(BOARDS, `${note}.note.md`), "utf8");

async function ready(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** Every equation KaTeX has drawn, by the TeX it was drawn from, and how many are still their TeX. */
const drawn = (page: Page) =>
  page.evaluate(() => ({
    tex: Array.from(document.querySelectorAll(".katex annotation")).map((a) => a.textContent),
    pending: document.querySelectorAll('[data-dag-math="pending"]').length,
  }));

test("a note drawn read-only has every equation drawn when it is ready, and a price is a price", { tag: "@smoke" }, async ({ page }) => {
  await ready(page, `/?note=${note}&view=1`);
  expect(await drawn(page)).toEqual({ tex: ["W_Q", "Q = X W_Q", "\\frac{a}{b}"], pending: 0 });
  /* `$$` mid-line is display, centred on a line of its own, inside the paragraph it was written in. */
  await expect(page.locator("p .dag-math--display .katex-display")).toHaveCount(1);
  await expect(page.locator("p", { hasText: "Costs $5 or $10" })).toHaveCount(1);
  /* An equation that does not parse is its TeX, with KaTeX's words as its title. */
  const broken = page.locator('[data-dag-math="error"]');
  await expect(broken).toHaveText("\\frac{a");
  await expect(broken).toHaveAttribute("title", /KaTeX parse error/);
});

test("in the note editor `$x$` typed is an equation, and a click opens its TeX", async ({ page }) => {
  await ready(page, `/?note=${note}`);
  const editor = page.locator("[data-dag-note-editor]");
  /* W_Q, Q = X W_Q mid-line, and the broken one, which is an equation that does not parse. */
  await expect(editor.locator("[data-dag-math-chip]")).toHaveCount(3);
  await expect(editor.locator("[data-dag-equation]")).toHaveCount(1);
  expect((await drawn(page)).pending).toBe(0);

  /* Typed at the end of the first line: the closing dollar makes it an equation, a price does not. */
  const line = editor.locator(".bn-block-content", { hasText: "Short line." });
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Then $x^2$ for $5 more.");
  await expect(line.locator("[data-dag-math-chip]")).toHaveCount(1);
  await expect.poll(readNote, { timeout: 5_000 }).toContain("Short line. Then $x^2$ for $5 more.");

  /* A click opens the field; what is typed there redraws the equation and reaches the file. */
  await line.locator("[data-dag-math-chip]").click();
  const field = page.locator('[data-dag-math-field="inline"] [data-dag-math-tex]');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("x^2");
  await field.fill("x^{2n}");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-math-field]")).toHaveCount(0);
  await expect.poll(readNote, { timeout: 5_000 }).toContain("Then $x^{2n}$ for $5 more.");

  /* Every block nobody touched is byte for byte as written. */
  expect(readNote()).toBe(NOTE.replace("Short line.", "Short line. Then $x^{2n}$ for $5 more."));
});

test("in the note editor `$$` and a space make an equation block, its field open", async ({ page }) => {
  await ready(page, `/?note=${note}`);
  const editor = page.locator("[data-dag-note-editor]");
  const line = editor.locator(".bn-block-content", { hasText: "Short line." });
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("$$ ");
  const field = page.locator('[data-dag-math-field="block"] [data-dag-math-tex]');
  await expect(field).toBeFocused();
  await page.keyboard.type("e^{i\\pi} + 1 = 0");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("[data-dag-math-field]")).toHaveCount(0);
  await expect(editor.locator("[data-dag-equation]")).toHaveCount(2);
  await expect.poll(readNote, { timeout: 5_000 }).toContain("Short line.\n\n$$\ne^{i\\pi} + 1 = 0\n$$\n\nCosts");
});

test("a board's text card is ready only once its equations are drawn", async ({ page }) => {
  await ready(page, `/?board=${board}`);
  const card = page.locator('.dag-item[data-dag-item="eq"]');
  expect(await drawn(page)).toEqual({ tex: ["p_i = \\frac{\\exp(z_i)}{\\sum_j \\exp(z_j)}", "\\sqrt{d_k}"], pending: 0 });
  await expect(card.locator(".dag-math--block")).toHaveCount(1);
  await expect(card).toContainText("at $5 or $10.");

  /* An export carries KaTeX's faces, and a fraction's bar — a bottom border and nothing else, which
     the `border` shorthand reads as nothing. */
  const svg = await page.evaluate(
    () => new Promise<string>((reply) => document.dispatchEvent(new CustomEvent("dag:export", { detail: { kind: "svg", reply } }))),
  );
  expect(svg).toContain("font-family:'KaTeX_Main'");
  expect(svg).toMatch(/class="frac-line" style="[^"]*border-bottom:[^"]*solid/);
});

test("a quiz draws the equations in its question and its options", async ({ page }) => {
  await ready(page, `/?quiz=${quiz}&view=1`);
  expect(await drawn(page)).toEqual({ tex: ["\\sqrt{4}", "2", "4"], pending: 0 });
});
