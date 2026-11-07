import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * What a quiz can say and how a run asks it, 336, 338, 340 and 342:
 * an option holding a code block, shuffled options, a board drawn in a quiz, a folder as one run,
 * and an open question.
 *
 * **In declaration order, in one worker**, `quizzes.spec.ts`'s rule: what somebody answered is the
 * account's, and every worker is the one e2e account. Each check writes into a folder of its own and
 * reads only what its own quizzes recorded.
 */
test.describe.configure({ mode: "default" });

let folder = "";
let dir = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-runs-${info.testId}`;
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

function write(leaf: string, text: string, ext = "quiz"): string {
  fs.mkdirSync(path.dirname(path.join(dir, leaf)), { recursive: true });
  fs.writeFileSync(path.join(dir, `${leaf}.${ext}.md`), text);
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
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/practice") sent.push(...(JSON.parse(r.postData() ?? "{}").events ?? []));
  });
  return sent;
}

/** A quiz's run, once it is asking: until then there is nothing to read the order off. */
async function run(page: Page, name: string): Promise<void> {
  await page.goto(`/?quiz=${encodeURIComponent(name)}&run=1`);
  await expect(page.locator('[data-dag-run="asking"]')).toBeVisible();
}

/** The file's index of every option, in the order the run shows them. */
const shown = (page: Page) =>
  page.locator("[data-dag-run-option]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-dag-run-option"))));

test("an option holding a code block is drawn as a block beside its key, and picked by it", async ({ page }) => {
  const name = write(
    "sql",
    [
      "## Which query lists every member? {#qa}",
      "",
      "- [ ] The one with a filter",
      "  ```sql",
      "  select * from cd.members where memid > 0;",
      "  ```",
      "- [x] The one with no filter",
      "  ```sql",
      "  select * from cd.members;",
      "  ```",
      "- [ ] A one-line `option`",
      "",
    ].join("\n"),
  );
  await run(page, name);
  const block = page.locator('[data-dag-run-option="1"]');
  await expect(block).toHaveClass(/dag-run__option--block/);
  await expect(block.locator("pre")).toContainText("select * from cd.members;");
  await expect(page.locator('[data-dag-run-option="2"]')).not.toHaveClass(/dag-run__option--block/);
  await page.keyboard.press("2");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-run-verdict]")).toHaveAttribute("data-dag-run-verdict", "right");

  await page.goto(`/?quiz=${encodeURIComponent(name)}&snapshot=1`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await expect(page.locator(".dag-quiz-sheet__option--block pre")).toHaveCount(2);
});

test("an open question is answered in words, the model answer shown, and the person's verdict recorded", async ({ page }) => {
  const name = write("open", "## Write the query {#qo}\n\nEvery member.\n\n> ```sql\n> select * from cd.members;\n> ```\n");
  const id = await idOf(page, name);
  const sent = recording(page);
  await run(page, name);
  const box = page.locator("[data-dag-run-answer]");
  await expect(box).toBeFocused();
  await expect(box).toHaveClass(/dag-run__answer--code/);
  await page.keyboard.type("select * from members;");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("[data-dag-run-model]")).toContainText("select * from cd.members;");
  await expect(box).toHaveAttribute("readonly", "");
  await page.keyboard.press("2");
  await expect(page.locator("[data-dag-run-verdict]")).toHaveAttribute("data-dag-run-verdict", "wrong");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-run-tally], [data-dag-run-score]").first()).toBeVisible();
  await expect.poll(() => sent.filter((a) => a.quiz === id)).toEqual([{ quiz: id, question: "qo", correct: false, run: "quiz" }]);
});

test("shuffled options keep their order through Previous and Next, pinned ones their place, and Again draws afresh", async ({ page }) => {
  const name = write(
    "joins",
    [
      "---",
      "title: Joins",
      "shuffle: true",
      "---",
      "",
      "## Which join keeps unmatched rows? {#qj}",
      "- [x] left join",
      "- [ ] inner join",
      "- [ ] cross join",
      "- [ ] natural join",
      "- [ ] semi join",
      "- [ ] It depends {pin}",
      "- [ ] None of the above",
      "",
      "## Second {#qk}",
      "- [x] y",
      "- [ ] n",
      "",
    ].join("\n"),
  );
  const id = await idOf(page, name);
  const sent = recording(page);
  await run(page, name);
  const first = await shown(page);
  expect([...first].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(first.slice(5)).toEqual([5, 6]);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  expect(await shown(page)).toEqual(first);
  /* The key names a place; what is recorded is the option the file calls right. */
  await page.keyboard.press(String(first.indexOf(0) + 1));
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-run-verdict]")).toHaveAttribute("data-dag-run-verdict", "right");
  await expect.poll(() => sent.filter((a) => a.quiz === id)).toEqual([{ quiz: id, question: "qj", correct: true, run: "quiz" }]);

  /* Again draws a new order: five movable options, so five Agains coming out the same is not chance. */
  const orders = [first.join()];
  for (let n = 0; n < 5 && orders.every((o) => o === first.join()); n++) {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.locator("[data-dag-run-again]").click();
    await expect(page.locator('[data-dag-run="asking"]')).toBeVisible();
    const order = await shown(page);
    expect(order.slice(5)).toEqual([5, 6]);
    orders.push(order.join());
  }
  expect(new Set(orders).size).toBeGreaterThan(1);

  /* The sheet keeps the author's order. */
  await page.goto(`/?quiz=${encodeURIComponent(name)}&snapshot=1`);
  await expect(page.locator('[data-dag-quiz-sheet-question="qj"] .dag-quiz-sheet__option').first()).toContainText("left join");
});

test("a folder of quizzes is one run, every answer recorded against its own quiz", async ({ page }) => {
  const a = write("course/2-joins", "---\ntitle: 2 · Joins\n---\n\nAbout joins.\n\n## Join? {#qj}\n- [x] y\n- [ ] n\n");
  const b = write("course/10-windows", "---\ntitle: 10 · Windows\n---\n\n## Window? {#qw}\n- [ ] y\n- [x] n\n");
  const [ia, ib] = [await idOf(page, a), await idOf(page, b)];
  const sent = recording(page);
  await page.goto(`/?quizzes=1&run=${encodeURIComponent(`folder:${folder}/course`)}`);
  await expect(page.locator(".dag-run__where")).toHaveText("2 · Joins · Question 1 of 2");
  await expect(page.locator("[data-dag-run-about]")).toContainText("About joins.");
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.locator(".dag-run__where")).toHaveText("10 · Windows · Question 2 of 2");
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-run-score]")).toHaveAttribute("data-dag-run-score", "1/2");
  await expect
    .poll(() => sent.filter((e) => e.quiz === ia || e.quiz === ib))
    .toEqual([
      { quiz: ia, question: "qj", correct: true, run: "quiz" },
      { quiz: ib, question: "qw", correct: false, run: "quiz" },
    ]);

  /* And the Quizzes page offers it once the folder is chosen. */
  await page.goto("/?quizzes=1");
  await page.locator("[data-dag-quizzes-folder]").selectOption(`${folder}/course`);
  await page.locator(`[data-dag-quizzes-practice-folder="${folder}/course"]`).click();
  await expect(page.locator('[data-dag-run="asking"]')).toBeVisible();
});

test("a board embedded in a quiz is drawn, survives a pick, and a snapshot waits for it", async ({ page }) => {
  const board = write("schema", "---\ntitle: Schema\n---\n\n```erd {#erd}\nentity members \"Members\" {\n  memid int pk\n}\n```\n", "board");
  const id = await idOf(page, board);
  const name = write("with-board", `The schema:\n\n![The schema](dag:${id})\n\n## Which table? {#qt}\n\n![The schema](dag:${id})\n\n- [x] members\n- [ ] bookings\n`);
  await page.goto(`/?quiz=${encodeURIComponent(name)}&snapshot=1`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  const embeds = page.locator('[data-dag-embed-kind="board"]');
  await expect(embeds).toHaveCount(2);
  expect(await embeds.evaluateAll((els) => els.every((e) => e.hasAttribute("data-dag-embed-ready")))).toBe(true);

  await run(page, name);
  const inPrompt = page.locator('.dag-run__prompt [data-dag-embed-kind="board"]');
  await expect(inPrompt).toHaveAttribute("data-dag-embed-ready", "");
  await expect(inPrompt.locator('[data-dag-node="members"]')).toBeVisible();
  const before = await inPrompt.elementHandle();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-run-verdict]")).toBeVisible();
  expect(await page.evaluate(([x, y]) => x === y, [before, await inPrompt.elementHandle()])).toBe(true);
});
