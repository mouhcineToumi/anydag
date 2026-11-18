import fs from "node:fs";
import path from "node:path";

import { BOARDS } from "./boards";
import { expect, type Locator, test } from "./fixture";

/**
 * The quiz builder as somebody new to it meets it (#257): every field named, an empty one drawn as
 * a slot, a question nobody has written in saying nothing, and one place to choose a kind when
 * adding. The checks read the **file**, because what the form shows is only right if what it wrote
 * is.
 *
 * Nothing here answers a question, so nothing is recorded; each check writes into a folder of its own.
 */

let folder = "";
let dir = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-builder-${info.testId}`;
  dir = path.join(BOARDS, folder);
  fs.mkdirSync(dir, { recursive: true });
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  /* Only the folder this check made, and only when it knows which (`CLAUDE.md`, *Things that will bite*). */
  if (folder) fs.rmSync(dir, { recursive: true, force: true });
  folder = "";
  expect(problems, "console output").toEqual([]);
});

const quizFile = (leaf: string) => path.join(dir, `${leaf}.quiz.md`);
const read = (leaf: string) => fs.readFileSync(quizFile(leaf), "utf8");

function write(leaf: string, text: string): string {
  fs.writeFileSync(quizFile(leaf), text);
  return `${folder}/${leaf}`;
}

const ONE = "---\ntitle: Drill\n---\n\n## What does VACUUM reclaim? {#qvac}\n\n- [ ] Index bloat only\n- [x] Dead tuples\n";

/** The words of a field's label, drawn above it. */
const labelOf = (field: Locator) => field.locator("xpath=preceding-sibling::*[1][contains(@class, 'dag-quiz__label')]");

test("Add a question opens the four kinds, and nothing is written until one is chosen", { tag: "@smoke" }, async ({ page }) => {
  const name = write("add", ONE);
  await page.goto(`/?quiz=${name}`);
  await expect(page.locator("[data-dag-quiz-question]")).toHaveCount(1);
  /* The foot has two ways to add, no more. */
  await expect(page.locator(".dag-quiz__adds > *")).toHaveCount(2);

  await page.locator("[data-dag-quiz-add]").click();
  const menu = page.locator("[data-dag-quiz-add-menu]");
  await expect(menu).toBeVisible();
  const tiles = menu.locator("[data-dag-quiz-add-kind]");
  await expect(tiles).toHaveCount(4);
  /* Each kind says what the learner does with it, on the tile: no tooltip carries it. */
  await expect(menu.locator('[data-dag-quiz-add-kind="written"]')).toContainText("They write, then compare with your answer.");
  await expect(menu.locator('[data-dag-quiz-add-kind="card"]')).toContainText("A front and a back.");
  await expect(menu.locator("[title]")).toHaveCount(0);
  /* The first kind has the focus, so the arrows and Enter work at once. */
  await expect(tiles.first()).toBeFocused();

  /* Abandoned: Escape, and a press elsewhere. Neither writes a byte. */
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator("[data-dag-quiz-add]")).toBeFocused();
  await page.locator("[data-dag-quiz-add]").click();
  await expect(menu).toBeVisible();
  await page.locator("[data-dag-quiz-description]").click();
  await expect(menu).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(read("add")).toBe(ONE);
  await expect(page.locator("[data-dag-quiz-question]")).toHaveCount(1);

  /* Its number picks a kind: 2 is several right answers, written with no tick and `multi`. */
  await page.locator("[data-dag-quiz-add]").click();
  await page.keyboard.press("2");
  await expect(menu).toHaveCount(0);
  const added = page.locator("[data-dag-quiz-question]").last();
  await expect(added).toHaveAttribute("data-dag-quiz-kind", "several");
  await expect(added.locator('[data-dag-quiz-prompt] [contenteditable="true"]')).toBeFocused();
  await expect.poll(() => read("add")).toMatch(/\n## +\{#q[0-9a-z]{6} multi\}\n\n- \[ \]\n- \[ \]\n$/);
  expect(read("add").startsWith(ONE)).toBe(true);
});

test("an empty quiz opens on the four kinds, and choosing one writes the first question", async ({ page }) => {
  const name = write("empty", "---\ntitle: Empty\n---\n");
  await page.goto(`/?quiz=${name}`);
  const first = page.locator("[data-dag-quiz-first]");
  await expect(first).toContainText("Add the first question");
  await expect(first.locator("[data-dag-quiz-add-kind]")).toHaveCount(4);
  /* No foot while the tiles are the way in. */
  await expect(page.locator("[data-dag-quiz-add]")).toHaveCount(0);
  await first.locator('[data-dag-quiz-add-kind="card"]').click();
  /* Typed at once, before the field's editor is there: every letter is the question's, and a space
     is a space — not the page's leader key (`space A` is the Assistant). */
  await page.keyboard.type("What is a TOAST table for?", { delay: 10 });
  await expect(first).toHaveCount(0);
  const card = page.locator("[data-dag-quiz-question]");
  await expect(card).toHaveAttribute("data-dag-quiz-kind", "card");
  await expect.poll(() => read("empty")).toMatch(/\n## What is a TOAST table for\? \{#q[0-9a-z]{6} card\}\n$/);
  await expect(page.locator("[data-dag-assistant-panel]")).toHaveCount(0);
  await expect(page.locator("[data-dag-quiz-add]")).toBeVisible();
});

test("a question nobody has written in says nothing; one left unfinished says what it lacks", { tag: "@smoke" }, async ({
  page,
}) => {
  const name = write("quiet", ONE);
  await page.goto(`/?quiz=${name}`);
  const status = page.locator(".dag-quiz__status");

  await page.locator("[data-dag-quiz-add]").click();
  await page.locator('[data-dag-quiz-add-kind="one"]').click();
  const added = page.locator("[data-dag-quiz-question]").last();
  await expect(added.locator('[data-dag-quiz-prompt] [contenteditable="true"]')).toBeFocused();
  /* Blank: no problem on it, and the status does not count it. */
  await expect(page.locator("[data-dag-quiz-problem]")).toHaveCount(0);
  await expect(status).toHaveText("");

  /* Being written: still quiet, though its answers are empty and none is ticked. */
  await page.keyboard.type("Which process writes dirty pages?");
  await expect.poll(() => read("quiet")).toContain("## Which process writes dirty pages?");
  await expect(added.locator("[data-dag-quiz-problem]")).toHaveCount(0);
  await added.locator("[data-dag-quiz-why]").click();
  await expect(added.locator("[data-dag-quiz-problem]")).toHaveCount(0);

  /* Left with something in it: what it lacks is said, in the warning role, each with its fix. */
  await page.locator("[data-dag-quiz-description]").click();
  await expect(added.locator('[data-dag-quiz-problem="EQ_NO_ANSWER"]')).toBeVisible();
  await expect(added.locator('[data-dag-quiz-problem="EQ_EMPTY_OPTION"]')).toHaveCount(2);
  await expect(added.locator("[data-dag-quiz-problems]")).toContainText("Not ready to practise yet");
  await expect(added.locator('[data-dag-quiz-problem="EQ_EMPTY_OPTION"] [data-dag-quiz-fix]').first()).toBeVisible();
  await expect(added.locator("[data-dag-quiz-wants]")).toHaveCount(2);
  const colour = (l: Locator) => l.evaluate((el) => getComputedStyle(el).color);
  const warning = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--dag-color-warningText)";
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(await colour(added.locator("[data-dag-quiz-problems]"))).toBe(warning);

  /* A second question added and left blank stays quiet, and so does it after a reload, while the
     partly written one is said at once. */
  await page.locator("[data-dag-quiz-add]").click();
  await page.locator('[data-dag-quiz-add-kind="written"]').click();
  await page.locator("[data-dag-quiz-description]").click();
  await expect(page.locator("[data-dag-quiz-question]")).toHaveCount(3);
  await page.reload();
  await expect(page.locator("[data-dag-quiz-question]")).toHaveCount(3);
  await expect(page.locator("[data-dag-quiz-question]").nth(1).locator('[data-dag-quiz-problem="EQ_NO_ANSWER"]')).toBeVisible();
  await expect(page.locator("[data-dag-quiz-question]").nth(2).locator("[data-dag-quiz-problem]")).toHaveCount(0);
  await expect(status).toHaveText("1 of 3 cannot be practiced until fixed");
});

test("every field says what it is, filled or not, and an empty one is a dashed slot", async ({ page }) => {
  const name = write("labels", `${ONE}\n## What is MVCC? {#qmv card}\n`);
  await page.goto(`/?quiz=${name}`);
  const choice = page.locator('[data-dag-quiz-question="qvac"]');
  await expect(labelOf(choice.locator("[data-dag-quiz-prompt]"))).toHaveText("Question");
  await expect(choice.locator(".dag-quiz__label").filter({ hasText: "Answers" })).toContainText("tick the right one");
  await expect(labelOf(choice.locator("[data-dag-quiz-why]"))).toContainText("Explanation");

  const card = page.locator('[data-dag-quiz-question="qmv"]');
  await expect(labelOf(card.locator("[data-dag-quiz-prompt]"))).toContainText("Front");
  await expect(labelOf(card.locator("[data-dag-quiz-why]"))).toContainText("Back");
  await card.locator("[data-dag-quiz-add-details]").click();
  await expect(labelOf(card.locator("[data-dag-quiz-body]"))).toContainText("Details");

  /* Filled: a box with a solid edge. Empty: a dashed slot, its placeholder at regular weight. */
  const prompt = card.locator("[data-dag-quiz-prompt]");
  const back = card.locator("[data-dag-quiz-why]");
  await expect(prompt).not.toHaveAttribute("data-dag-quiz-empty");
  await expect(back).toHaveAttribute("data-dag-quiz-empty", "");
  expect(await prompt.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid");
  expect(await back.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
  const empty = choice.locator("[data-dag-quiz-why] .dag-quiz__placeholder");
  expect(await empty.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("400");

  /* A press on the label opens its field. */
  await labelOf(back).click();
  await expect(back.locator('[contenteditable="true"]')).toBeFocused();
  await page.keyboard.type("Multi-version concurrency control.");
  await expect.poll(() => read("labels")).toContain("> Multi-version concurrency control.\n");
  await page.locator("[data-dag-quiz-description]").click();
  await expect(back).not.toHaveAttribute("data-dag-quiz-empty");
});

test("a question's kind is changed from the menu on its kind label", async ({ page }) => {
  const name = write("kind", ONE);
  await page.goto(`/?quiz=${name}`);
  const card = page.locator('[data-dag-quiz-question="qvac"]');
  const button = card.locator("[data-dag-quiz-kind-button]");
  await expect(button).toHaveText("One right answer");
  await button.click();
  const menu = card.locator("[data-dag-quiz-kind-menu]");
  await expect(menu.locator('[role="menuitemradio"]')).toHaveCount(4);
  /* The kind it is has the focus and the tick. */
  await expect(menu.locator('[data-dag-quiz-kind-option="one"]')).toHaveAttribute("aria-checked", "true");
  await expect(menu.locator('[data-dag-quiz-kind-option="one"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("data-dag-quiz-kind", "several");
  await expect.poll(() => read("kind")).toContain("## What does VACUUM reclaim? {#qvac multi}");
  /* Escape closes the menu, and the field it was over is not closed by the same key. */
  await button.click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
});
