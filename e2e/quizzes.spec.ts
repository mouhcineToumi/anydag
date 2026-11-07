import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

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
        .poll(async () => (await state.getAttribute("data-dag-run")) === "done" || (await page.locator(".dag-run__where").textContent()) !== where)
        .toBe(true);
    }
  }
  expect(met, `the Mistakes run asked ${ours}`).toBe(true);
}

test("a quiz written as a file is a card on the Quizzes page, and its questions are cards in the form", async ({ page }) => {
  const name = write("pg");
  await page.goto("/?quizzes=1");
  await page.locator("[data-dag-quizzes-filter]").fill(folder);
  const card = page.locator(`[data-dag-quizzes-card="${name}"]`);
  await expect(card).toContainText("Postgres basics");
  await expect(card).toContainText("3 questions");

  await card.locator(".dag-quizzes__open").click();
  await expect(page).toHaveURL(new RegExp(`quiz=${encodeURIComponent(name).replace(/%2F/g, "(%2F|/)")}`));
  await expect(page.locator("[data-dag-quiz-question]")).toHaveCount(3);
  await expect(page.locator('[data-dag-quiz-question="qvac"] [data-dag-quiz-prompt]')).toHaveValue("What does VACUUM reclaim?");
  await expect(page.locator('[data-dag-quiz-question="qvis"] [data-dag-quiz-multi]')).toBeChecked();
  /* Opening it wrote nothing: the question with no id keeps having none until something writes. */
  expect(read("pg")).toBe(QUIZ);
});

test("an edit in the form rewrites the question it touched and leaves every other byte", async ({ page }) => {
  const name = write("pg");
  await page.goto(`/?quiz=${name}`);
  const prompt = page.locator('[data-dag-quiz-question="qvis"] [data-dag-quiz-prompt]');
  await prompt.fill("Which two fields decide a row's visibility?");
  await expect.poll(() => read("pg")).toContain("## Which two fields decide a row's visibility? {#qvis}");
  const after = read("pg");
  /* The first question, in its author's own bullets and spacing, is byte for byte what it was. */
  const first = QUIZ.slice(QUIZ.indexOf("## What does"), QUIZ.indexOf("## Which fields"));
  expect(after).toContain(first);
  /* And the write gave the question that had no id one — minted where it is first needed. */
  expect(after).toMatch(/## Which isolation level is the default\? \{#q[0-9a-z]{6}\}/);
});

test("a question added in the form is written, and asks for every answer once two are ticked", async ({ page }) => {
  const name = write("pg");
  await page.goto(`/?quiz=${name}`);
  await page.locator("[data-dag-quiz-add]").click();
  const added = page.locator("[data-dag-quiz-question]").last();
  /* The new card takes the caret, so a person can type straight into it. */
  await expect(added.locator("[data-dag-quiz-prompt]")).toBeFocused();
  await page.keyboard.type("Which of these are MVCC?");
  await added.locator("[data-dag-quiz-option-text]").nth(0).fill("Snapshots");
  await added.locator("[data-dag-quiz-option-text]").nth(1).fill("Row versions");
  await added.locator("[data-dag-quiz-correct-toggle]").nth(1).check();
  await expect.poll(() => read("pg")).toMatch(/## Which of these are MVCC\? \{#q[0-9a-z]{6}\}\n\n- \[x\] Snapshots\n- \[x\] Row versions\n$/);
  await expect(added.locator("[data-dag-quiz-multi]")).toBeChecked();
  await expect(added.locator("[data-dag-quiz-multi]")).toBeDisabled();
});

test("a question the runner cannot ask says so, and Source shows the whole file with its problems", async ({ page }) => {
  const name = write("broken", "---\ntitle: Broken\n---\n\n## Nothing is right {#qa}\n- [ ] one\n- [ ] two\n");
  await page.goto(`/?quiz=${name}`);
  await expect(page.locator('[data-dag-quiz-question="qa"] [data-dag-quiz-problem="EQ_NO_ANSWER"]')).toBeVisible();
  await expect(page.locator("[data-dag-quiz-practice]")).toBeDisabled();
  await page.locator('[data-dag-quiz-mode="source"]').click();
  await expect(page.locator("[data-dag-quiz-source]")).toHaveValue(read("broken"));
  await expect(page.locator('[data-dag-quiz-problem="EQ_NO_ANSWER"]')).toContainText("line 6");
});

test("a run records a miss into Mistakes, and two right in a row in the Mistakes run take it out", async ({ page }) => {
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
