import fs from "node:fs";
import path from "node:path";

import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";

/**
 * Filtering by tag (#327): the Tag select on the Tasks page and in the Calendar's Show menu, held in
 * the address as `tag=`; a Tasks row's chips and its *+n*; and a task typed in while one tag is
 * showing, which is made carrying it — read back from the **file**.
 *
 * Each test works in its own folder, and every tag it names ends in its own id: the suite runs wide
 * over one vault, and the Tasks page lists every task in it.
 */

let folder = "";
let dir = "";
let mark = "";
let problems: string[] = [];
const made: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-tagfilter-${info.testId}`;
  dir = path.join(BOARDS, folder);
  mark = info.testId.replace(/[^0-9a-z]/gi, "").slice(-8);
  fs.mkdirSync(dir, { recursive: true });
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(async ({ page }) => {
  const listed = ((await (await page.request.get("/__board/tags")).json()) as { tags: { name: string }[] }).tags;
  for (const t of listed)
    if (t.name.endsWith(`-${mark}`)) await page.request.post("/__board/tags/delete", { data: { tag: t.name } });
  if (folder) fs.rmSync(dir, { recursive: true, force: true });
  for (const f of made.splice(0)) fs.rmSync(f, { force: true });
  folder = "";
  expect(problems, "console output").toEqual([]);
});

const tag = (word: string) => `${word}-${mark}`;

function write(leaf: string, title: string, lines: string[] = []): string {
  fs.writeFileSync(
    path.join(dir, `${leaf}.note.md`),
    `---\ntitle: ${JSON.stringify(title)}\n${lines.map((l) => `${l}\n`).join("")}---\nAbout it.\n`,
  );
  return `${folder}/${leaf}`;
}

/** The Tasks page, narrowed by words to this test's folder, once `row` is drawn. */
async function tasksPage(page: Page, row: string, query = "") {
  await page.goto(`/?tasks=1${query}`);
  await page.locator("[data-dag-tasks-filter]").fill(folder);
  await expect(page.locator(`[data-dag-task-row="${row}"]`)).toBeVisible({ timeout: 15_000 });
}

const row = (page: Page, name: string) => page.locator(`[data-dag-task-row="${name}"]`);

test("the Tag select keeps the tasks carrying one tag, or none, and says so in the address", async ({ page }) => {
  const pricing = tag("pricing");
  const a = write("a", "Draft the price list", ["status: todo", `tags: [${pricing.toUpperCase()}, ${tag("q4")}]`]);
  const b = write("b", "Book the room", ["status: todo", `tags: [${tag("meeting")}]`]);
  const c = write("c", "Water the plants", ["status: in-progress"]);
  await tasksPage(page, a);
  await expect(row(page, b)).toBeVisible();
  await expect(row(page, c)).toBeVisible();

  const select = page.locator("[data-dag-tasks-tag]");
  await expect(select).toHaveAccessibleName("Show the tasks tagged");
  await select.selectOption(pricing.toUpperCase());
  await expect.poll(() => new URL(page.url()).searchParams.get("tag")).toBe(pricing.toUpperCase());
  await expect(row(page, a)).toBeVisible();
  await expect(row(page, b)).toHaveCount(0);
  await expect(row(page, c)).toHaveCount(0);

  /* Case is ignored: the address may say it either way. */
  await tasksPage(page, a, `&tag=${pricing}`);
  await expect(row(page, b)).toHaveCount(0);
  await expect(select).toHaveValue(pricing.toUpperCase());

  await select.selectOption({ label: "No tag" });
  await expect.poll(() => new URL(page.url()).searchParams.get("tag")).toBe("none");
  await expect(row(page, c)).toBeVisible();
  await expect(row(page, a)).toHaveCount(0);
  await expect(row(page, b)).toHaveCount(0);

  await select.selectOption({ label: "All tags" });
  await expect.poll(() => new URL(page.url()).searchParams.get("tag")).toBeNull();
  await expect(row(page, a)).toBeVisible();
  await expect(row(page, b)).toBeVisible();
});

test("a row shows two chips, then a +n that names the rest and opens them", async ({ page }) => {
  const tags = ["pricing", "q4", "meeting", "design"].map(tag);
  const a = write("a", "Send the price list", ["status: todo", `tags: [${tags.join(", ")}]`]);
  const b = write("b", "Two only", ["status: todo", `tags: [${tags[0]}, ${tags[1]}]`]);
  await tasksPage(page, a);

  const chips = row(page, a).locator("[data-dag-tags-row] [data-dag-tag]");
  await expect(chips).toHaveText([tags[0]!, tags[1]!]);
  const more = row(page, a).locator("[data-dag-tags-more]");
  await expect(more).toHaveText("+2");
  await expect(more).toHaveAccessibleName(`2 more tags: ${tags[2]}, ${tags[3]}`);
  /* Two tags are two chips and no +n. */
  await expect(row(page, b).locator("[data-dag-tag]")).toHaveCount(2);
  await expect(row(page, b).locator("[data-dag-tags-more]")).toHaveCount(0);

  /* Focus shows the drawn tooltip with the names, never a `title`. */
  await more.focus();
  await expect(page.getByRole("tooltip")).toHaveText(`${tags[2]}, ${tags[3]}`);
  await expect(more).not.toHaveAttribute("title", /.*/);

  await more.press("Enter");
  const card = page.locator("[data-dag-tags-more-card]");
  await expect(card.locator("[data-dag-tag]")).toHaveText([tags[2]!, tags[3]!]);
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(card).toHaveAttribute("role", "dialog");
  /* The press put the tooltip away: one thing names the tags at a time. */
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await more.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(more).toBeFocused();
  /* The row did not open its task. */
  await expect(page).toHaveURL(/tasks=1/);

  /* On the board a card is pressed to drag and to open: +n is still its own. */
  await page.locator('[data-dag-tasks-layout="board"]').click();
  const cardMore = page.locator(`[data-dag-task-card="${a}"] [data-dag-tags-more]`);
  await cardMore.click();
  await expect(card.locator("[data-dag-tag]")).toHaveText([tags[2]!, tags[3]!]);
  await expect(page).toHaveURL(/tasks=1/);
  await page.locator('[data-dag-tasks-layout="list"]').click();
});

test("a task typed in while a tag is showing carries it", async ({ page }, info) => {
  const ops = tag("ops");
  const anchor = write("anchor", "Something tagged", ["status: todo", `tags: [${ops}]`]);
  await tasksPage(page, anchor, `&tag=${ops}`);
  const title = `Tagged quick ${info.testId}`;
  const file = path.join(BOARDS, `${title}.md`);
  made.push(file);
  const box = page.locator('[data-dag-task-add="todo"]');
  await box.fill(title);
  await box.press("Enter");
  await expect
    .poll(() => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""))
    .toMatch(new RegExp(`^---\\nstatus: todo\\ntags: \\[${ops}\\]\\nid: [0-9a-z]{10}\\n---\\n$`));
  await expect(box).toHaveValue("");
  /* It is in view: the page shows that tag, and the words filter is what hides it. */
  await page.locator("[data-dag-tasks-filter]").fill(title);
  await expect(page.locator(`[data-dag-task-row="${title}"]`)).toBeVisible();
});

test("under 720px +n is a 44px target, and a tap opens the tags it hides", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const tags = ["pricing", "q4", "meeting"].map(tag);
  const a = write("a", "On a phone", ["status: todo", `tags: [${tags.join(", ")}]`]);
  await tasksPage(page, a);
  const more = row(page, a).locator("[data-dag-tags-more]");
  await expect(more).toHaveAccessibleName(`1 more tag: ${tags[2]}`);
  const box = (await more.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await more.click();
  await expect(page.locator("[data-dag-tags-more-card] [data-dag-tag]")).toHaveText([tags[2]!]);
  /* A press elsewhere shuts it. */
  await page.locator("[data-dag-tasks-count]").click();
  await expect(page.locator("[data-dag-tags-more-card]")).toHaveCount(0);
});

test("the Calendar's Show menu has the same Tag select, over tasks, events and notes", async ({ page }) => {
  const meeting = tag("meeting");
  const project = write("project", "Calendar tags", ["project: active"]);
  const review = write("review", "Design review", ["start: 2031-03-12", `tags: [${meeting}]`]);
  const lunch = write("lunch", "Lunch", ["start: 2031-03-13"]);
  const task = write("task", "Send the agenda", ["status: todo", "due: 2031-03-14", `tags: [${meeting}]`]);
  let id: string | undefined;
  await expect
    .poll(async () => {
      id = ((await (await page.request.get("/__board/list")).json()) as { ids: Record<string, string> }).ids[project];
      return id;
    })
    .toBeTruthy();
  await page.goto(`/?calendar=month&date=2031-03-15&project=${id}`);
  const item = (name: string) => page.locator(`[data-dag-cal-item="${name}"]`).first();
  await expect(item(review)).toBeVisible({ timeout: 15_000 });
  await expect(item(lunch)).toBeVisible();

  await page.locator("[data-dag-calendar-show]").click();
  const select = page.locator("[data-dag-calendar-tag]");
  await expect(select).toHaveAccessibleName("Show the calendar tagged");
  await select.selectOption(meeting);
  await expect.poll(() => new URL(page.url()).searchParams.get("tag")).toBe(meeting);
  await expect(item(review)).toBeVisible();
  await expect(item(task)).toBeVisible();
  await expect(item(lunch)).toHaveCount(0);
  /* The Show button says a filter is on: the project and the tag. */
  await expect(page.locator("[data-dag-calendar-show] .dag-calendar__held")).toHaveAccessibleName("2 filters on");

  await select.selectOption({ label: "No tag" });
  await expect(item(lunch)).toBeVisible();
  await expect(item(review)).toHaveCount(0);
  await expect(item(task)).toHaveCount(0);
});
