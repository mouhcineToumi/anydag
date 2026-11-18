import fs from "node:fs";
import path from "node:path";

import { BOARDS } from "./boards";
import { expect, type Locator, type Page, test } from "./fixture";

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

/** Open a folded question by its line: the one card open, every other folded. */
async function openCard(page: Page, id: string): Promise<Locator> {
  const card = page.locator(`[data-dag-quiz-question="${id}"]`);
  await card.locator("[data-dag-quiz-row]").click();
  await expect(card).not.toHaveAttribute("data-dag-quiz-folded");
  return card;
}

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
  const count = page.locator("[data-dag-quiz-count]");

  await page.locator("[data-dag-quiz-add]").click();
  await page.locator('[data-dag-quiz-add-kind="one"]').click();
  const added = page.locator("[data-dag-quiz-question]").last();
  await expect(added.locator('[data-dag-quiz-prompt] [contenteditable="true"]')).toBeFocused();
  /* Blank: no problem on it, and the count does not call it unfinished. */
  await expect(page.locator("[data-dag-quiz-problem]")).toHaveCount(0);
  await expect(count).toHaveText("2 questions");

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
  await expect(count).toContainText("2 questions · 1 unfinished");

  /* A second question added and left blank stays quiet, and so does it after a reload, while the
     partly written one is said at once. */
  await page.locator("[data-dag-quiz-add]").click();
  await page.locator('[data-dag-quiz-add-kind="written"]').click();
  await page.locator("[data-dag-quiz-description]").click();
  await expect(page.locator("[data-dag-quiz-question]")).toHaveCount(3);
  await page.reload();
  await expect(page.locator("[data-dag-quiz-question]")).toHaveCount(3);
  const partly = page.locator("[data-dag-quiz-question]").nth(1);
  await expect(partly).toHaveAttribute("data-dag-quiz-unfinished", "");
  await expect(partly.locator("[data-dag-quiz-row-meta]")).toHaveText("3 things to finish");
  await expect(page.locator("[data-dag-quiz-question]").nth(2)).not.toHaveAttribute("data-dag-quiz-unfinished");
  await expect(page.locator("[data-dag-quiz-question]").nth(2).locator("[data-dag-quiz-row-words]")).toHaveText(
    "No question yet",
  );
  await expect(count).toContainText("3 questions · 1 unfinished");
});

test("every field says what it is, filled or not, and an empty one is a dashed slot", async ({ page }) => {
  const name = write("labels", `${ONE}\n## What is MVCC? {#qmv card}\n`);
  await page.goto(`/?quiz=${name}`);
  const choice = await openCard(page, "qvac");
  await expect(labelOf(choice.locator("[data-dag-quiz-prompt]"))).toHaveText("Question");
  await expect(choice.locator(".dag-quiz__label").filter({ hasText: "Answers" })).toContainText("tick the right one");
  await expect(labelOf(choice.locator("[data-dag-quiz-why]"))).toContainText("Explanation");
  /* An empty field's placeholder is at regular weight, the question's too. */
  const empty = choice.locator("[data-dag-quiz-why] .dag-quiz__placeholder");
  expect(await empty.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("400");

  const card = await openCard(page, "qmv");
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
  const card = await openCard(page, "qvac");
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

const THREE = `${ONE}
## What is MVCC? {#qmv card}

> Multi-version concurrency control.

## Write the query for every member {#qsql}

> select * from members;
`;

test("questions fold to one line, and one card is open at a time", { tag: "@smoke" }, async ({ page }) => {
  const name = write("fold", THREE);
  await page.goto(`/?quiz=${name}`);
  const cards = page.locator("[data-dag-quiz-question]");
  await expect(cards).toHaveCount(3);
  /* Every question is a line: its words, and a summary of it. No field is drawn. */
  await expect(page.locator("[data-dag-quiz-folded]")).toHaveCount(3);
  await expect(page.locator("[data-dag-quiz-field]:not([data-dag-quiz-description])")).toHaveCount(0);
  await expect(cards.nth(0).locator("[data-dag-quiz-row-meta]")).toHaveText("2 answers");
  await expect(cards.nth(1).locator("[data-dag-quiz-row-meta]")).toHaveText("Flashcard");
  await expect(cards.nth(2).locator("[data-dag-quiz-row-meta]")).toHaveText("Model answer");
  await expect(cards.nth(2).locator("[data-dag-quiz-row-words]")).toHaveText("Write the query for every member");

  /* Opening one folds the one that was open. */
  const vac = await openCard(page, "qvac");
  await expect(vac.locator("[data-dag-quiz-prompt]")).toHaveText("What does VACUUM reclaim?");
  const mv = await openCard(page, "qmv");
  await expect(vac).toHaveAttribute("data-dag-quiz-folded", "");
  await expect(mv.locator("[data-dag-quiz-why]")).toHaveText("Multi-version concurrency control.");
  await expect(page.locator(".dag-quiz__card:not([data-dag-quiz-folded])")).toHaveCount(1);
  /* Folded again by its own button; from the keyboard, a line opens on Enter. */
  await mv.locator("[data-dag-quiz-fold]").click();
  await expect(page.locator("[data-dag-quiz-folded]")).toHaveCount(3);
  await cards.nth(2).locator("[data-dag-quiz-row]").focus();
  await page.keyboard.press("Enter");
  await expect(cards.nth(2)).not.toHaveAttribute("data-dag-quiz-folded");
  /* Opening and folding is not an edit. */
  await page.waitForTimeout(300);
  expect(read("fold")).toBe(THREE);
});

test("Show them steps through the unfinished questions, and a search result opens its question", async ({ page }) => {
  const name = write(
    "show",
    `${ONE}\n## Which process writes dirty pages? {#qdirty}\n\n- [ ] The background writer\n- [ ] The checkpointer\n\n## What is MVCC? {#qmv card}\n`,
  );
  await page.goto(`/?quiz=${name}`);
  const count = page.locator("[data-dag-quiz-count]");
  await expect(count).toContainText("3 questions · 2 unfinished · Show them");
  await expect(page.locator('[data-dag-quiz-question="qdirty"] [data-dag-quiz-row-meta]')).toHaveText("No right answer marked");
  await expect(page.locator('[data-dag-quiz-question="qmv"] [data-dag-quiz-row-meta]')).toHaveText("No back yet");
  const show = page.locator("[data-dag-quiz-show-unfinished]");
  const isOpen = (id: string) =>
    expect(page.locator(`[data-dag-quiz-question="${id}"]`)).not.toHaveAttribute("data-dag-quiz-folded");
  await show.click();
  await isOpen("qdirty");
  await expect(page.locator('[data-dag-quiz-question="qdirty"] [data-dag-quiz-problem="EQ_NO_ANSWER"]')).toBeVisible();
  await show.click();
  await isOpen("qmv");
  await show.click();
  await isOpen("qdirty");

  /* A search result names a question in the address: its card opens, with the caret in it. */
  await page.goto(`/?quiz=${name}#qmv`);
  await isOpen("qmv");
  await expect(page.locator('[data-dag-quiz-question="qmv"] [data-dag-quiz-prompt] [contenteditable="true"]')).toBeFocused();
});

test("the grip is the one way to reorder: drag it, or Alt+Up and Alt+Down on it", async ({ page }) => {
  const name = write("move", THREE);
  await page.goto(`/?quiz=${name}`);
  /* No arrows beside it. */
  await expect(page.locator('[aria-label="Move up"], [aria-label="Move down"]')).toHaveCount(0);
  const grip = page.locator('[data-dag-quiz-question="qsql"] [data-dag-quiz-grip]');
  await grip.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => read("move")).toMatch(/\{#qvac\}[\s\S]*\{#qsql\}[\s\S]*\{#qmv card\}/);
  /* The focus stays on the grip it moved, so a second press moves it again. */
  await expect(page.locator('[data-dag-quiz-question="qsql"] [data-dag-quiz-grip]')).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => read("move")).toMatch(/\{#qsql\}[\s\S]*\{#qvac\}[\s\S]*\{#qmv card\}/);
  /* At the top, a press up goes nowhere and writes nothing. */
  const top = read("move");
  await page.keyboard.press("Alt+ArrowUp");
  await page.waitForTimeout(300);
  expect(read("move")).toBe(top);

  /* An answer the same way, on its own grip. */
  const vac = await openCard(page, "qvac");
  await vac.locator(".dag-quiz__option .dag-quiz__grip").first().focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => read("move")).toContain("- [x] Dead tuples\n- [ ] Index bloat only\n");
  await expect(vac.locator(".dag-quiz__option .dag-quiz__grip").nth(1)).toBeFocused();
});

test("Duplicate and Delete are in the open card's menu", async ({ page }) => {
  const name = write("menu", ONE);
  await page.goto(`/?quiz=${name}`);
  const vac = await openCard(page, "qvac");
  await vac.locator("[data-dag-quiz-card-more]").click();
  /* Two rows at this width; the third, Preview, is drawn only under 720px. */
  await expect(vac.locator("[data-dag-quiz-card-menu] [role=menuitem]:visible")).toHaveCount(2);
  await vac.locator("[data-dag-quiz-duplicate]").click();
  const cards = page.locator("[data-dag-quiz-question]");
  await expect(cards).toHaveCount(2);
  /* The copy is the card open, with an id of its own. */
  await expect(cards.nth(1)).not.toHaveAttribute("data-dag-quiz-folded");
  await expect(cards.nth(0)).toHaveAttribute("data-dag-quiz-folded", "");
  await expect.poll(() => (read("menu").match(/## What does VACUUM reclaim\?/g) ?? []).length).toBe(2);

  /* Delete asks on the card first. */
  const copy = cards.nth(1);
  await copy.locator("[data-dag-quiz-card-more]").click();
  await copy.locator("[data-dag-quiz-delete]").click();
  await expect(copy.locator("[data-dag-quiz-confirm]")).toContainText("Delete this question?");
  await copy.locator("[data-dag-quiz-delete-yes]").click();
  await expect(cards).toHaveCount(1);
  await expect.poll(() => read("menu")).toBe(ONE);
});

const SHUFFLED = `---
title: Drill
---

## Which command shows a query's plan? {#qplan}

- [ ] DESCRIBE
- [x] EXPLAIN
- [ ] SHOW PLAN {pin}
- [ ] None of the above
`;

test("shuffle is a switch with one line under it, and a pin says in words what it does, only while shuffling", async ({
  page,
}) => {
  const name = write("pins", SHUFFLED);
  await page.goto(`/?quiz=${name}`);
  const shuffle = page.locator("[data-dag-quiz-shuffle]");
  await expect(shuffle).toHaveAttribute("role", "switch");
  await expect(shuffle).not.toBeChecked();
  await expect(page.locator(".dag-quiz__shuffle-note")).toContainText("an answer can be kept in place");
  const card = await openCard(page, "qplan");
  /* Shuffle off: nothing moves, so there is nothing to keep in place. */
  await expect(card.locator(".dag-quiz__pin")).toHaveCount(0);

  await shuffle.check();
  await expect.poll(() => read("pins")).toContain("shuffle: true");
  const pins = card.locator(".dag-quiz__option .dag-quiz__pin");
  await expect(pins).toHaveCount(4);
  await expect(pins.nth(0)).toHaveText("Keep in place");
  await expect(pins.nth(0)).toHaveAttribute("aria-pressed", "false");
  await expect(pins.nth(2)).toHaveText("Kept in place");
  await expect(pins.nth(2)).toHaveAttribute("aria-pressed", "true");
  /* The answer that names the others stays where it is: said, with nothing to press. */
  await expect(pins.nth(3)).toHaveText("Stays last: it names the others");
  await expect(card.locator('span[data-dag-quiz-pin="words"]')).toHaveCount(1);
  /* No tooltip carries what a control means: the tick says it in its name. */
  await expect(card.locator(".dag-quiz__option [title]:not([data-dag-quiz-remove-option])")).toHaveCount(0);

  await pins.nth(0).click();
  await expect.poll(() => read("pins")).toContain("- [ ] DESCRIBE {pin}\n");
  await expect(pins.nth(0)).toHaveText("Kept in place");
  await pins.nth(2).click();
  await expect.poll(() => read("pins")).toContain("- [ ] SHOW PLAN\n");
});

test("Preview draws the question as a run asks it, answerable, and writes nothing", async ({ page }) => {
  const text = SHUFFLED.replace("title: Drill\n", "title: Drill\nshuffle: true\n");
  const name = write("preview", text);
  await page.goto(`/?quiz=${name}`);
  const card = await openCard(page, "qplan");
  const mode = card.locator('[role="radiogroup"]');
  await expect(mode.locator('[data-dag-quiz-preview-choice="edit"]')).toHaveAttribute("aria-checked", "true");
  await mode.locator('[data-dag-quiz-preview-choice="preview"]').click();

  const preview = card.locator("[data-dag-quiz-preview]");
  await expect(preview).toBeVisible();
  await expect(card.locator("[data-dag-quiz-prompt]")).toHaveCount(0);
  await expect(preview.locator(".dag-run__question")).toHaveText("Which command shows a query's plan?");
  await expect(preview.locator(".dag-run__hint")).toHaveText("Choose one answer.");
  const options = preview.locator("[data-dag-run-option]");
  await expect(options).toHaveCount(4);
  /* Shuffled as a run would, with the kept answer and the one naming the others where they are. */
  await expect(preview.locator('[data-dag-run-place="2"]')).toHaveAttribute("data-dag-run-option", "2");
  await expect(preview.locator('[data-dag-run-place="3"]')).toHaveAttribute("data-dag-run-option", "3");
  await expect(preview).toContainText("Shuffled, as in a run. Nothing is recorded.");

  const check = preview.locator("[data-dag-quiz-preview-check]");
  await expect(check).toBeDisabled();
  await preview.locator('[data-dag-run-option="0"]').click();
  await check.click();
  await expect(preview.locator(".dag-run__verdict")).toHaveAttribute("data-dag-run-verdict", "wrong");
  await expect(preview.locator('[data-dag-run-option="1"]')).toHaveAttribute("data-dag-run-mark", "right");
  await preview.locator("[data-dag-quiz-preview-again]").click();
  await expect(preview.locator(".dag-run__verdict")).toHaveCount(0);
  await preview.locator('[data-dag-run-option="1"]').click();
  await check.click();
  await expect(preview.locator(".dag-run__verdict")).toHaveAttribute("data-dag-run-verdict", "right");

  /* The arrows walk the switch; Edit is the form again, with nothing written. */
  await mode.locator('[data-dag-quiz-preview-choice="preview"]').focus();
  await page.keyboard.press("ArrowLeft");
  await expect(mode.locator('[data-dag-quiz-preview-choice="edit"]')).toBeFocused();
  await expect(card.locator("[data-dag-quiz-prompt]")).toBeVisible();
  await page.waitForTimeout(300);
  expect(read("preview")).toBe(text);

  /* A flashcard's preview turns the card and asks if it was known. */
  const flash = write(
    "flash",
    "---\ntitle: Cards\n---\n\n## What is a TOAST table for? {#qtoast card}\n\n> Out-of-line storage.\n",
  );
  await page.goto(`/?quiz=${flash}`);
  const front = await openCard(page, "qtoast");
  await front.locator('[data-dag-quiz-preview-choice="preview"]').click();
  await front.locator("[data-dag-quiz-preview-reveal]").click();
  await expect(front.locator("[data-dag-run-model]")).toContainText("Out-of-line storage.");
  await front.locator('[data-dag-run-judge="right"]').click();
  await expect(front.locator(".dag-run__verdict")).toHaveAttribute("data-dag-run-verdict", "right");
  /* Folding goes back to the form. */
  await front.locator("[data-dag-quiz-fold]").click();
  await openCard(page, "qtoast");
  await expect(front.locator("[data-dag-quiz-prompt]")).toBeVisible();
});

test("under 720px Edit and Preview are in the card's menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const name = write("narrow", SHUFFLED);
  await page.goto(`/?quiz=${name}`);
  const card = await openCard(page, "qplan");
  await expect(card.locator('[role="radiogroup"]')).toBeHidden();
  await card.locator("[data-dag-quiz-card-more]").click();
  const menu = card.locator("[data-dag-quiz-card-menu]");
  /* The first row drawn has the focus: Preview, not a row hidden at this width. */
  await expect(menu.locator('[data-dag-quiz-preview-item="preview"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card.locator("[data-dag-quiz-preview]")).toBeVisible();
  await card.locator("[data-dag-quiz-card-more]").click();
  await menu.locator('[data-dag-quiz-preview-item="edit"]').click();
  await expect(card.locator("[data-dag-quiz-prompt]")).toBeVisible();
});
