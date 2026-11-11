import fs from "node:fs";
import path from "node:path";
import { expect, type Locator, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * Flashcards (#131): a quiz question whose heading says `card`, its closing quote the back. Made in
 * the form, run with nothing to type — the front, Space for the back, `1`/`2` for the verdict — and
 * drawn on the sheet.
 *
 * **In declaration order, in one worker**, `quizzes.spec.ts`'s rule: what somebody answered is the
 * machine's, and every worker records against the same. Each check writes into a folder of its own
 * and reads only what its own quiz recorded.
 */
test.describe.configure({ mode: "default" });

let folder = "";
let dir = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-cards-${info.testId}`;
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

/** Every answer the page sends, in order. */
function recording(page: Page): { quiz: string; question: string; correct: boolean; run: string }[] {
  const sent: { quiz: string; question: string; correct: boolean; run: string }[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/practice")
      sent.push(...(JSON.parse(r.postData() ?? "{}").events ?? []));
  });
  return sent;
}

const CHOICE = "## Which fields decide visibility? {#qvis}\n\n* [x] `xmin`\n* [x]   `xmax`\n* [ ] `ctid`\n";

/** Open a rich field: a click, and the editor in its place with the caret in it. */
async function open(field: Locator): Promise<void> {
  await field.click();
  await expect(field.locator('[contenteditable="true"]')).toBeFocused();
}

test("a flashcard added in the form is written with `card`, and no other byte moves", { tag: "@smoke" }, async ({ page }) => {
  const name = write("made", `---\ntitle: Cards\n---\n\n${CHOICE}`);
  await page.goto(`/?quiz=${name}`);
  await expect(page.locator("[data-dag-quiz-question]")).toHaveCount(1);
  await page.locator("[data-dag-quiz-add-flashcard]").click();
  const added = page.locator("[data-dag-quiz-question]").last();
  await expect(added).toHaveAttribute("data-dag-quiz-kind", "card");
  await expect(added.locator("[data-dag-quiz-kind-select]")).toHaveValue("card");
  /* A card has a front and a back, and nothing to choose between. */
  await expect(added.locator("[data-dag-quiz-option-text]")).toHaveCount(0);
  await expect(added.locator("[data-dag-quiz-add-option]")).toHaveCount(0);
  await expect(added.locator('[data-dag-quiz-prompt] [contenteditable="true"]')).toBeFocused();
  await page.keyboard.type("What is MVCC?");
  await open(added.locator("[data-dag-quiz-why]"));
  await page.keyboard.type("Multi-version concurrency control.");
  await expect
    .poll(() => read("made"))
    .toMatch(/\n## What is MVCC\? \{#q[0-9a-z]{6} card\}\n\n> Multi-version concurrency control\.\n$/);
  /* The question written by hand keeps its author's bullets and spacing. */
  expect(read("made")).toContain(CHOICE);
  await expect(added.locator("[data-dag-quiz-problem]")).toHaveCount(0);

  /* Answered in words, it is an open question: the same quote, `card` gone from the heading. */
  await added.locator("[data-dag-quiz-kind-select]").selectOption("written");
  await expect.poll(() => read("made")).toMatch(/\n## What is MVCC\? \{#q[0-9a-z]{6}\}\n\n> Multi-version/);
  await expect(added).toHaveAttribute("data-dag-quiz-kind", "written");
  /* And a flashcard again, with nothing asked: there were no answers to drop. */
  await added.locator("[data-dag-quiz-kind-select]").selectOption("card");
  await expect.poll(() => read("made")).toMatch(/\n## What is MVCC\? \{#q[0-9a-z]{6} card\}\n\n> Multi-version/);
});

test("turning a question with answers into a flashcard asks before it drops them", async ({ page }) => {
  const name = write("turn", `---\ntitle: Cards\n---\n\n${CHOICE}`);
  await page.goto(`/?quiz=${name}`);
  const card = page.locator('[data-dag-quiz-question="qvis"]');
  await card.locator("[data-dag-quiz-kind-select]").selectOption("card");
  await expect(card.locator("[data-dag-quiz-drop-answers]")).toContainText("A flashcard");
  expect(read("turn")).toContain(CHOICE);
  await card.locator("[data-dag-quiz-drop-answers-yes]").click();
  await expect.poll(() => read("turn")).toMatch(/## Which fields decide visibility\? \{#qvis card\}\n$/);
  await expect(card).toHaveAttribute("data-dag-quiz-kind", "card");
  /* A card with no back says so in words, and its fix is the Back field. */
  await expect(card.locator('[data-dag-quiz-problem="EQ_NO_OPTIONS"]')).toContainText("back of this flashcard");
});

test("a run shows a card's front with nothing to type, Space shows the back, and a miss goes into Mistakes", async ({ page }) => {
  const name = write(
    "run",
    [
      "---",
      "title: Cards",
      "---",
      "",
      "## What is MVCC? {#qmv card}",
      "",
      "> Multi-version concurrency control.",
      "",
      "## What does WAL stand for? {#qwal card}",
      "",
      "> Write-ahead log.",
      "",
    ].join("\n"),
  );
  const id = await idOf(page, name);
  const sent = recording(page);
  await page.goto(`/?quiz=${encodeURIComponent(name)}&run=1`);
  const asking = page.locator('[data-dag-run="asking"]');
  await expect(asking).toHaveAttribute("data-dag-run-question", "qmv");
  await expect(asking).toHaveAttribute("data-dag-run-flashcard", "");
  await expect(page.locator("[data-dag-run-flashcard-tag]")).toHaveText("Flashcard");
  await expect(page.locator("[data-dag-run-answer]")).toHaveCount(0);
  await expect(page.locator("[data-dag-run-model]")).toHaveCount(0);
  /* `1` before the back is showing is no verdict. */
  await page.keyboard.press("1");
  await expect(page.locator("[data-dag-run-verdict]")).toHaveCount(0);
  await page.keyboard.press(" ");
  await expect(page.locator("[data-dag-run-model]")).toHaveText("Multi-version concurrency control.");
  await page.keyboard.press("2");
  await expect(page.locator("[data-dag-run-verdict]")).toHaveAttribute("data-dag-run-verdict", "wrong");
  await page.keyboard.press("Enter");

  /* The second card is shown and left unjudged: a skip, which records nothing. */
  await expect(asking).toHaveAttribute("data-dag-run-question", "qwal");
  await page.locator("[data-dag-run-reveal]").click();
  await expect(page.locator("[data-dag-run-model]")).toHaveText("Write-ahead log.");
  await page.locator("[data-dag-run-next]").click();
  await expect(page.locator("[data-dag-run-tally]")).toHaveAttribute("data-dag-run-tally", "0/1/1");

  await expect
    .poll(() => sent.filter((a) => a.quiz === id))
    .toEqual([{ quiz: id, question: "qmv", correct: false, run: "quiz" }]);
  await expect
    .poll(async () => {
      const got = (await (await page.request.get("/api/practice")).json()) as { pool?: { quiz: string; question: string }[] };
      return (got.pool ?? []).filter((e) => e.quiz === id).map((e) => e.question);
    })
    .toEqual(["qmv"]);
});

test("the sheet draws a card's front with its back under it", async ({ page }) => {
  const name = write("sheet", "---\ntitle: Cards\n---\n\n## What is MVCC? {#qmv card}\n\n> Multi-version concurrency control.\n");
  await page.goto(`/?quiz=${encodeURIComponent(name)}&snapshot=1`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  const q = page.locator('[data-dag-quiz-sheet-question="qmv"]');
  await expect(q.locator("[data-dag-quiz-sheet-flashcard]")).toHaveText("Flashcard. The back:");
  await expect(q.locator(".dag-run__why")).toHaveText("Multi-version concurrency control.");
});
