import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { clickOnHover } from "./hover";
import { openSettings, openSidebar } from "./sidebar";

/**
 * Quizzes. A quiz is `<name>.quiz.md`, and the form's checks read the
 * **file**, because an edit is supposed to change one question and no other byte of it.
 *
 * **In declaration order, in one worker** (`mode: "default"` over the config's `fullyParallel`). What
 * somebody answered is recorded for this machine, and every worker records against the same: two
 * checks recording personal misses at once would each see the other's in Mistakes. Each check still
 * writes into a folder of its own and narrows every read to its own quiz's id, and a quiz deleted
 * afterwards leaves Mistakes on its own — the server leaves out a question whose quiz is gone.
 */
test.describe.configure({ mode: "default" });

let folder = "";
let dir = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-quiz-${info.testId}`;
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

const QUIZ = `---
title: Postgres basics
---

A short drill.

## What does VACUUM reclaim? {#qvac}

* [ ] Index bloat only
* [x] The space of dead tuples
* [ ]   Old WAL segments

> Dead tuples stay until VACUUM
marks their space reusable.

## Which fields decide visibility? {#qvis}
- [x] \`xmin\`
- [x] \`xmax\`
- [ ] \`ctid\`

## Which isolation level is the default?

- [x] Read committed
- [ ] Serializable
`;

function write(leaf: string, text = QUIZ): string {
  fs.writeFileSync(quizFile(leaf), text);
  return `${folder}/${leaf}`;
}

async function idOf(page: Page, name: string): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(async () => {
      id = ((await (await page.request.get("/__board/list")).json()) as { ids: Record<string, string> }).ids[name];
      return id;
    })
    .toBeTruthy();
  return id!;
}

type Stats = Record<string, { wrong: number; right: number; streak: number; inPool: boolean }>;
const statsOf = async (page: Page, id: string): Promise<Stats> =>
  ((await (await page.request.get(`/api/practice?quiz=${id}`)).json()) as { stats: Stats }).stats;
const poolOf = async (page: Page, id: string): Promise<string[]> =>
  ((await (await page.request.get("/api/practice")).json()) as { pool: { quiz: string; question: string }[] }).pool
    .filter((e) => e.quiz === id)
    .map((e) => e.question);

/** Pick option `n` (1-based) and check it, then move on. */
async function answer(page: Page, ...picks: number[]) {
  for (const n of picks) await page.keyboard.press(String(n));
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-run-verdict]")).toBeVisible();
  await page.keyboard.press("Enter");
}

/**
 * Answer a Mistakes run to its end: `ours` with option `right`, and skip anything else. The run asks
 * every question in Mistakes, and Mistakes is the whole suite's, so a question somebody else left
 * there can come first — the check is about its own question, read off its record.
 * Skipped rather than answered: a skip records nothing, so another check's question
 * keeps its streak, and an open question, which no option key answers, is passed over too.
 */
async function mistakesRun(page: Page, ours: string, right: number) {
  /* Asking first: until it is, the screen may still be the run that came before, which is done. */
  await expect(page.locator('[data-dag-run="asking"]')).toBeVisible();
  let met = false;
  for (;;) {
    const state = page.locator("[data-dag-run]");
    await expect(state).toHaveAttribute("data-dag-run", /asking|done/);
    if ((await state.getAttribute("data-dag-run")) === "done") break;
    const asked = await state.getAttribute("data-dag-run-question");
    met ||= asked === ours;
    if (asked === ours) await answer(page, right);
    else {
      /* Two quizzes may both have a `qa`, so the move is read off "Question n of m", not the id. */
      const where = await page.locator(".dag-run__where").textContent();
      await page.locator("[data-dag-run-next]").click();
      await expect
        .poll(
          async () =>
            (await state.getAttribute("data-dag-run")) === "done" ||
            (await page.locator(".dag-run__where").textContent()) !== where,
        )
        .toBe(true);
    }
  }
  expect(met, `the Mistakes run asked ${ours}`).toBe(true);
}

test("a quiz written as a file is a card on the Quizzes page, and its questions are cards in the form", {
  tag: "@smoke",
}, async ({ page }) => {
  const name = write("pg");
  await page.goto("/?quizzes=1");
  await page.locator("[data-dag-quizzes-filter]").fill(folder);
  const card = page.locator(`[data-dag-quizzes-card="${name}"]`);
  await expect(card).toContainText("Postgres basics");
  await expect(card).toContainText("3 questions");

  await card.locator(".dag-quizzes__open").click();
  await expect(page).toHaveURL(new RegExp(`quiz=${encodeURIComponent(name).replace(/%2F/g, "(%2F|/)")}`));
  await expect(page.locator("[data-dag-quiz-question]")).toHaveCount(3);
  /* Drawn as what it says — the backticks are code, never characters on the screen. */
  await expect(page.locator('[data-dag-quiz-question="qvac"] [data-dag-quiz-prompt]')).toHaveText("What does VACUUM reclaim?");
  await expect(page.locator('[data-dag-quiz-question="qvis"] [data-dag-quiz-option-text]').first()).toHaveText("xmin");
  await expect(page.locator('[data-dag-quiz-question="qvis"] [data-dag-quiz-kind-select]')).toHaveValue("several");
  await expect(page.locator('[data-dag-quiz-question="qvac"] [data-dag-quiz-kind-select]')).toHaveValue("one");
  /* No source anywhere on the page. */
  await expect(page.locator("textarea")).toHaveCount(0);
  /* Opening it wrote nothing: the question with no id keeps having none until something writes. */
  expect(read("pg")).toBe(QUIZ);
});

/** Open a rich field: a click, and the editor in its place with the caret in it. */
async function open(field: Locator): Promise<void> {
  await field.click();
  await expect(field.locator('[contenteditable="true"]')).toBeFocused();
}

test("an edit in the form rewrites the question it touched and leaves every other byte", async ({ page }) => {
  const name = write("pg");
  await page.goto(`/?quiz=${name}`);
  const prompt = page.locator('[data-dag-quiz-question="qvis"] [data-dag-quiz-prompt]');
  await open(prompt);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Which two fields decide a row's visibility?");
  await expect.poll(() => read("pg")).toContain("## Which two fields decide a row's visibility? {#qvis}");
  const after = read("pg");
  /* The first question, in its author's own bullets and spacing, is byte for byte what it was. */
  const first = QUIZ.slice(QUIZ.indexOf("## What does"), QUIZ.indexOf("## Which fields"));
  expect(after).toContain(first);
  /* And the write gave the question that had no id one — minted where it is first needed. */
  expect(after).toMatch(/## Which isolation level is the default\? \{#q[0-9a-z]{6}\}/);

  /* A field opened and left writes nothing, whatever its author's wrapping. */
  await open(page.locator('[data-dag-quiz-question="qvac"] [data-dag-quiz-why]'));
  await page.locator('[data-dag-quiz-question="qvac"] [data-dag-quiz-prompt]').click();
  await page.locator("[data-dag-quiz-description]").click();
  await page.waitForTimeout(400);
  expect(read("pg")).toBe(after);
});

test("a question built in the form is written as the file's Markdown, none of it typed", async ({ page }) => {
  const name = write("pg");
  await page.goto(`/?quiz=${name}`);
  await page.locator("[data-dag-quiz-add]").click();
  const added = page.locator("[data-dag-quiz-question]").last();
  /* The new card takes the caret, so a person can type straight into it. */
  await expect(added.locator('[data-dag-quiz-prompt] [contenteditable="true"]')).toBeFocused();
  await page.keyboard.type("Which of these are MVCC?");
  /* Enter is the next field — the first answer — never a second line of the question. */
  await page.keyboard.press("Enter");
  await expect(added.locator('[data-dag-quiz-option-text] [contenteditable="true"]').first()).toBeFocused();
  await page.keyboard.type("Snapshots");
  await open(added.locator("[data-dag-quiz-option-text]").nth(1));
  await page.keyboard.type("Row versions");
  await expect.poll(() => read("pg")).toMatch(/- \[ \] Row versions\n$/);

  /* One right answer: ticking the second takes the tick off the first. */
  await added.locator("[data-dag-quiz-correct-toggle]").nth(1).check();
  await expect.poll(() => read("pg")).toMatch(/- \[ \] Snapshots\n- \[x\] Row versions\n$/);
  /* Several: both can be ticked, and the ticks say it, so the heading needs no `multi`. */
  await added.locator("[data-dag-quiz-kind-select]").selectOption("several");
  await added.locator("[data-dag-quiz-correct-toggle]").nth(0).check();
  await expect
    .poll(() => read("pg"))
    .toMatch(/## Which of these are MVCC\? \{#q[0-9a-z]{6}\}\n\n- \[x\] Snapshots\n- \[x\] Row versions\n$/);

  /* Formatting with the keyboard and the slash menu, never with a Markdown character. */
  await open(added.locator("[data-dag-quiz-why]"));
  await page.keyboard.press("ControlOrMeta+B");
  await page.keyboard.type("Both");
  await page.keyboard.press("ControlOrMeta+B");
  await page.keyboard.type(" keep ");
  await page.keyboard.press("ControlOrMeta+E");
  await page.keyboard.type("xmin");
  await page.keyboard.press("ControlOrMeta+E");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/code");
  await expect(page.locator(".bn-suggestion-menu")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("select xmin from t;");
  await expect.poll(() => read("pg")).toContain("> select xmin from t;");
  const text = read("pg");
  expect(text).toContain("> **Both** keep `xmin`");
  expect(text).toMatch(/> ```\w*\n> select xmin from t;\n> ```/);
  /* The other questions are what they were. */
  expect(text).toContain(QUIZ.slice(QUIZ.indexOf("## What does"), QUIZ.indexOf("## Which fields")));

  /* Typed the instant an answer is added, before its editor is there: not one letter lost. */
  for (const words of ["Table locks", "Hint bits"]) {
    await added.locator("[data-dag-quiz-add-option]").click();
    await page.keyboard.type(words, { delay: 10 });
    await expect.poll(() => read("pg")).toContain(`- [ ] ${words}\n`);
  }
  /* Escape closes the field and leaves it closed; a letter on it opens it again, and is kept. */
  await page.keyboard.press("Escape");
  await expect(added.locator("[data-dag-quiz-open-field]")).toHaveCount(0);
  await page.keyboard.type("!");
  await expect.poll(() => read("pg")).toContain("- [ ] Hint bits!\n");
});

test("a question becomes answered in words, after asking, and back", async ({ page }) => {
  const name = write("pg");
  await page.goto(`/?quiz=${name}`);
  const card = page.locator('[data-dag-quiz-question="qvac"]');
  await card.locator("[data-dag-quiz-kind-select]").selectOption("written");
  /* It has answers with words in them: asked first, and nothing written until it is answered. */
  await expect(card.locator("[data-dag-quiz-drop-answers]")).toBeVisible();
  expect(read("pg")).toBe(QUIZ);
  await card.locator("[data-dag-quiz-drop-answers-yes]").click();
  await expect
    .poll(() => read("pg"))
    .toMatch(/## What does VACUUM reclaim\? \{#qvac\}\n\n> Dead tuples stay until VACUUM\n> marks their space reusable\.\n/);
  await expect(card.locator("[data-dag-quiz-option-text]")).toHaveCount(0);
  await expect(card.locator("[data-dag-quiz-why]")).toHaveAttribute("data-dag-quiz-why", "");
  await card.locator("[data-dag-quiz-kind-select]").selectOption("one");
  await expect.poll(() => read("pg")).toMatch(/## What does VACUUM reclaim\? \{#qvac\}\n\n- \[x\]\n- \[ \]\n\n> Dead tuples/);
});

test("a broken quiz says what is wrong in words, on its question, and the form fixes each", async ({ page }) => {
  const name = write(
    "broken",
    [
      "---",
      "title: Broken",
      "---",
      "",
      "## Nothing is right {#qa}",
      "- [ ] one",
      "- [ ] two",
      "",
      "## Something is after {#qb}",
      "- [x] one",
      "- [ ] two",
      "",
      "> Why.",
      "",
      "A stray paragraph.",
      "",
      "## A setting nobody knows {#qc wide}",
      "- [x] one",
      "- [ ] two",
      "",
      "## A block left open {#qd}",
      "- [ ] two",
      "- [x] one",
      "  ```sql",
      "  select 1;",
      "",
      "## Swallowed {#qe}",
      "- [x] one",
      "- [ ] two",
      "",
    ].join("\n"),
  );
  await page.goto(`/?quiz=${name}`);
  const status = page.locator(".dag-quiz__status");
  await expect(status).toContainText("cannot be practiced until fixed");
  const problems = page.locator("[data-dag-quiz-problem]");
  await expect(problems).toHaveCount(4);
  /* Words, never the file: no line numbers and no syntax. */
  for (const words of await problems.allTextContents()) expect(words).not.toMatch(/line \d|[`#>{}]|\[x\]/);

  /* No answer marked: the ticks are the fix. */
  const qa = page.locator('[data-dag-quiz-question="qa"]');
  await expect(qa.locator('[data-dag-quiz-problem="EQ_NO_ANSWER"]')).toBeVisible();
  await qa.locator("[data-dag-quiz-correct-toggle]").nth(1).check();
  await expect(qa.locator("[data-dag-quiz-problem]")).toHaveCount(0);

  /* Text the form has no field for: shown, and the card is read-only until it has a place. */
  const qb = page.locator('[data-dag-quiz-question="qb"]');
  await expect(qb.locator("[data-dag-quiz-stray]")).toContainText("A stray paragraph.");
  await expect(qb.locator('[data-dag-quiz-prompt] [role="textbox"]')).toHaveAttribute("aria-readonly", "true");
  await qb.locator('[data-dag-quiz-stray-to="why"]').click();
  await expect.poll(() => read("broken")).toContain("> Why.\n>\n> A stray paragraph.\n");
  await expect(qb.locator("[data-dag-quiz-problem]")).toHaveCount(0);

  const qc = page.locator('[data-dag-quiz-question="qc"]');
  await qc.locator('[data-dag-quiz-fix="clean"]').click();
  await expect.poll(() => read("broken")).toContain("## A setting nobody knows {#qc}\n");

  /* The open block swallowed a question; ending it brings the question back. */
  await expect(page.locator('[data-dag-quiz-question="qe"]')).toHaveCount(0);
  await page.locator('[data-dag-quiz-fix="close-fence"]').click();
  await expect(page.locator('[data-dag-quiz-question="qe"]')).toBeVisible();
  await expect(page.locator("[data-dag-quiz-problem]")).toHaveCount(0);
  await expect(page.locator("[data-dag-quiz-question]")).toHaveCount(5);
  await expect(status).toHaveText("");
});

test("an answer and a question are moved by dragging their handles", async ({ page }) => {
  const name = write("pg");
  await page.goto(`/?quiz=${name}`);
  const card = page.locator('[data-dag-quiz-question="qvis"]');
  const drag = async (from: Locator, to: Locator, below: boolean) => {
    const a = (await from.boundingBox())!;
    const b = (await to.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 8, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, below ? b.y + b.height - 2 : b.y + 2, { steps: 8 });
    await page.mouse.up();
  };
  /* The first answer to the end. */
  const grips = card.locator(".dag-quiz__option .dag-quiz__grip");
  await drag(grips.nth(0), card.locator(".dag-quiz__option").nth(2), true);
  await expect.poll(() => read("pg")).toContain("- [x] `xmax`\n- [ ] `ctid`\n- [x] `xmin`\n");
  /* The last question to the top. */
  await drag(
    page.locator("[data-dag-quiz-question]").last().locator("[data-dag-quiz-grip]"),
    page.locator("[data-dag-quiz-question]").first(),
    false,
  );
  await expect.poll(() => read("pg")).toMatch(/A short drill\.\n\n## Which isolation level is the default\?/);
});

test("a run records a miss into Mistakes, and two right in a row in the Mistakes run take it out", { tag: "@smoke" }, async ({
  page,
}) => {
  const name = write("pg");
  const id = await idOf(page, name);
  await page.goto(`/?quiz=${name}`);
  await page.locator("[data-dag-quiz-practice]").click();
  await expect(page.locator('[data-dag-run="asking"]')).toBeVisible();
  /* A run needs every question's id, so the one with none was given one before the first answer. */
  await expect.poll(() => read("pg")).toMatch(/## Which isolation level is the default\? \{#q[0-9a-z]{6}\}/);

  await answer(page, 1); // wrong
  await answer(page, 1, 2); // right: both of the two
  await answer(page, 1); // right
  await expect(page.locator("[data-dag-run-score]")).toHaveAttribute("data-dag-run-score", "2/3");
  await expect(page.locator(".dag-run__note")).toContainText("1 question went into Mistakes.");
  await expect.poll(() => poolOf(page, id)).toEqual(["qvac"]);
  expect((await statsOf(page, id)).qvis).toMatchObject({ right: 1, streak: 0, inPool: false });

  await page.locator("[data-dag-run-mistakes]").click();
  await expect(page).toHaveURL(/quizzes=1.*run=mistakes|run=mistakes.*quizzes=1/);
  await mistakesRun(page, "qvac", 2);
  await expect.poll(async () => (await statsOf(page, id)).qvac?.streak).toBe(1);
  /* Still in Mistakes after one: it takes two in a row. */
  expect(await poolOf(page, id)).toEqual(["qvac"]);
  await page.locator("[data-dag-run-again]").click();
  await mistakesRun(page, "qvac", 2);
  await expect.poll(() => poolOf(page, id)).toEqual([]);
});

test("Previous and Next move through a run without answering, and the end offers what was skipped", async ({ page }) => {
  const name = write("pg");
  const id = await idOf(page, name);
  await page.goto(`/?quiz=${name}`);
  await page.locator("[data-dag-quiz-practice]").click();
  const run = page.locator("[data-dag-run]");
  await expect(run).toHaveAttribute("data-dag-run", "asking");
  await expect(page.locator("[data-dag-run-previous]")).toBeDisabled();

  /* → leaves the first unanswered; the second is answered, right. */
  await page.keyboard.press("ArrowRight");
  await expect(run).toHaveAttribute("data-dag-run-question", "qvis");
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  await page.keyboard.press("Enter");
  await expect(run).toHaveAttribute("data-dag-run-checked", "right");

  /* ← back to the first: still unanswered, with nothing showing a verdict. */
  await page.keyboard.press("ArrowLeft");
  await expect(run).toHaveAttribute("data-dag-run-question", "qvac");
  await expect(page.locator("[data-dag-run-verdict]")).toHaveCount(0);
  await expect(page.locator("[data-dag-run-check]")).toBeDisabled();

  /* Next, the button, to the second again: its answer kept, and not asked again. */
  await page.locator("[data-dag-run-next]").click();
  await expect(run).toHaveAttribute("data-dag-run-checked", "right");
  await expect(page.locator("[data-dag-run-option] input").first()).toBeDisabled();
  await expect(page.locator("[data-dag-run-check]")).toHaveCount(0);

  /* On to the last, and past it without answering. */
  await page.locator("[data-dag-run-next]").click();
  await expect(page.locator("[data-dag-run-next]")).toHaveText("See how it went");
  await page.locator("[data-dag-run-next]").click();
  await expect(run).toHaveAttribute("data-dag-run", "done");
  await expect(page.locator("[data-dag-run-score]")).toHaveAttribute("data-dag-run-score", "1/3");
  await expect(page.locator("[data-dag-run-tally]")).toHaveAttribute("data-dag-run-tally", "1/0/2");
  await expect(page.locator(".dag-run__note")).toContainText("Nothing went into Mistakes.");
  /* A skip is no answer: only the one answered was recorded. */
  await expect.poll(async () => Object.keys(await statsOf(page, id))).toEqual(["qvis"]);

  /* The skipped ones, as a round of their own. */
  await page.locator("[data-dag-run-skipped]").click();
  await expect(run).toHaveAttribute("data-dag-run-question", "qvac");
  await expect(page.locator(".dag-run__where")).toHaveText("Question 1 of 2");
});

test("a run shows the quiz's description beside the question, folds it away, and above it when narrow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const name = write("pg");
  await page.goto(`/?quiz=${name}&run=1`);
  const about = page.locator("[data-dag-run-about]");
  await expect(about).toContainText("About this quiz");
  await expect(about).toContainText("A short drill.");
  await expect(page.locator("[data-dag-run-about-inline]")).toBeHidden();
  /* Beside the question, on its right. */
  const main = (await page.locator(".dag-run__main").boundingBox())!;
  expect((await about.boundingBox())!.x).toBeGreaterThanOrEqual(main.x + main.width);

  /* Folded away, and still folded after a reload, with a way back in the run's header. */
  await page.locator("[data-dag-run-about-hide]").click();
  await expect(about).toHaveCount(0);
  await page.reload();
  await expect(page.locator("[data-dag-run-about-show]")).toBeVisible();
  await expect(about).toHaveCount(0);
  await page.locator("[data-dag-run-about-show]").click();
  await expect(about).toBeVisible();

  /* Narrow: a disclosure above the question, shut until it is opened. */
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(about).toBeHidden();
  const inline = page.locator("[data-dag-run-about-inline]");
  await expect(inline).toBeVisible();
  await expect(inline.locator(".dag-run__about-body")).toBeHidden();
  await inline.locator("summary").click();
  await expect(inline.locator(".dag-run__about-body")).toContainText("A short drill.");
});

test("raising the threshold in Settings puts a question back into Mistakes", async ({ page }) => {
  const name = write("pg");
  const id = await idOf(page, name);
  const events = [
    { quiz: id, question: "qvac", correct: false, run: "quiz" },
    { quiz: id, question: "qvac", correct: true, run: "mistakes" },
    { quiz: id, question: "qvac", correct: true, run: "mistakes" },
  ];
  expect((await page.request.post("/api/practice", { data: { events } })).ok()).toBe(true);
  expect(await poolOf(page, id)).toEqual([]);
  try {
    await page.goto(`/?quiz=${name}`);
    await openSettings(page, "preferences");
    const select = page.locator("[data-dag-setting-graduate]");
    await expect(select).toHaveValue("2");
    await select.selectOption("3");
    await expect.poll(() => poolOf(page, id)).toEqual(["qvac"]);
  } finally {
    await page.request.put("/api/practice", { data: { graduate: 2 } });
  }
});

test("a quiz on a board is a card with its count, its Mistakes and a way into its run", async ({ page }) => {
  const name = write("pg");
  const id = await idOf(page, name);
  await page.request.post("/api/practice", { data: { events: [{ quiz: id, question: "qvis", correct: false, run: "quiz" }] } });
  const board = path.join(dir, "board.board.md");
  fs.writeFileSync(board, `---\ntitle: Study\n---\n\n\`\`\`md {#q1 x=0 y=0 w=360}\n![Postgres basics](dag:${id})\n\`\`\`\n`);
  await page.goto(`/?board=${folder}/board`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  const card = page.locator(`[data-dag-embed="${id}"][data-dag-embed-kind="quiz"]`);
  await expect(card).toContainText("3 questions");
  await expect(card).toContainText("1 in Mistakes");
  await card.locator("[data-dag-embed-practice]").click();
  await expect(page.locator('[data-dag-run="asking"]')).toBeVisible();
});

test("a snapshot of a quiz is its sheet, every answer showing", async ({ page }) => {
  const name = write("pg");
  await page.goto(`/?quiz=${name}&snapshot=1`);
  const sheet = page.locator("[data-dag-quiz-sheet]");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-dag-quiz-sheet-question]")).toHaveCount(3);
  await expect(sheet.locator('[data-dag-run-mark="right"]')).toHaveCount(4);
});

test("the sidebar's New quiz makes one and opens it, and Quizzes opens the Quizzes page", async ({ page }) => {
  const name = write("pg");
  await page.goto(`/?quiz=${name}`);
  await openSidebar(page);
  const row = page.locator(`[data-dag-sidebar-file="${name}"]`);
  await expect(row).toBeVisible();
  await page.locator("[data-dag-sidebar-quizzes]").click();
  await expect(page).toHaveURL(/quizzes=1/);
  await expect(page.locator("[data-dag-sidebar-quizzes]")).toHaveAttribute("aria-current", "page");

  /* A folder's own + makes the quiz in the folder, so the check cleans up after itself. */
  await clickOnHover(page, `[data-dag-sidebar-folder="${folder}"]`, `[data-dag-sidebar-add="${folder}"]`);
  await page.locator('[data-dag-sidebar-menu-item="new-quiz"]').click();
  await expect.poll(() => fs.readdirSync(dir).filter((f) => f.startsWith("Untitled") && f.endsWith(".quiz.md"))).toHaveLength(1);
  await expect.poll(() => new URL(page.url()).searchParams.get("quiz"), { timeout: 10_000 }).toBe(`${folder}/Untitled`);
  /* It is named where its title is drawn, the top bar, as a board is — a note in its own
     title. Escape keeps *Untitled*. */
  const box = page.locator("[data-dag-toolbar-name]");
  await expect(box).toHaveValue("Untitled");
  await box.press("Escape");
  await expect(page.locator("[data-dag-quiz-add]")).toContainText("Add the first question");
});
