import fs from "node:fs";
import path from "node:path";

import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";
import { pageMore } from "./more";
import { openSidebar } from "./sidebar";

/**
 * Tasks. A task is a note whose frontmatter has a `status:`, and every
 * check here reads the **file**, because the whole of the feature is which two lines of it change.
 *
 * Each test writes its notes into a folder named for its test id, because the suite runs eight wide
 * over one `boards/` and the Tasks page lists every task in the vault: its filter, narrowed to that
 * folder, is how a test sees only its own.
 */

let folder = "";
let dir = "";
let problems: string[] = [];
/* A check that asks the server for a refusal makes Chromium print its 4xx; name that line here
   rather than letting it fail the console check. */
let expected: RegExp[] = [];
const made: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-task-${info.testId}`;
  dir = path.join(BOARDS, folder);
  fs.mkdirSync(dir, { recursive: true });
  problems = [];
  expected = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  /* Only the folder this test made, and only when it knows which: a cleanup matching an empty name
     would be every file in the vault (`CLAUDE.md`, *Things that will bite*). */
  if (folder) fs.rmSync(dir, { recursive: true, force: true });
  for (const f of made.splice(0)) fs.rmSync(f, { force: true });
  folder = "";
  expect(
    problems.filter((p) => !expected.some((r) => r.test(p))),
    "console output",
  ).toEqual([]);
});

const noteFile = (leaf: string) => path.join(dir, `${leaf}.note.md`);
const read = (leaf: string) => fs.readFileSync(noteFile(leaf), "utf8");

function write(leaf: string, title: string, lines: string[] = [], body = "What it is about.\n"): string {
  fs.writeFileSync(noteFile(leaf), `---\ntitle: ${JSON.stringify(title)}\n${lines.map((l) => `${l}\n`).join("")}---\n${body}`);
  return `${folder}/${leaf}`;
}

const day = (offset: number): string => {
  const at = new Date();
  at.setDate(at.getDate() + offset);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
};

async function ready(page: Page) {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** Lock this browser before the page loads, the way `lock.spec.ts` does. */
async function lockFirst(page: Page) {
  await page.addInitScript(() => localStorage.setItem("dag:locked", "1"));
}

/** The Tasks page, narrowed to this test's folder, once its rows have arrived. */
async function tasksPage(page: Page, expectRow: string) {
  await page.goto("/?tasks=1");
  await page.locator("[data-dag-tasks-filter]").fill(folder);
  await expect(page.locator(`[data-dag-task-row="${expectRow}"], [data-dag-task-card="${expectRow}"]`)).toBeVisible({
    timeout: 15_000,
  });
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

test("a note with a status is on the Tasks page, in its group, and one click on its mark checks it off", {
  tag: "@smoke",
}, async ({ page }) => {
  const late = write("late", "Send the invoice", ["status: todo", `due: ${day(-2)}`]);
  const doing = write("doing", "Ship the pricing page", ["status: in-progress", `due: ${day(1)}`]);
  const soon = write("soon", "Water the plants", ["status: todo", `due: ${day(0)}`]);
  const finished = write("finished", "Redraw the favicon", ["status: done", `due: ${day(-5)}`]);
  const plain = write("plain", "Meeting notes");
  await tasksPage(page, late);

  await expect(page.locator(`[data-dag-tasks-group="in-progress"] [data-dag-task-row="${doing}"]`)).toBeVisible();
  const row = page.locator(`[data-dag-tasks-group="todo"] [data-dag-task-row="${late}"]`);
  await expect(row).toContainText("Send the invoice");
  /* Past its date and not done, so its date says so; today's is marked too. */
  await expect(row.locator("[data-dag-task-due]")).toHaveAttribute("data-overdue", "");
  await expect(page.locator(`[data-dag-task-row="${soon}"] [data-dag-task-due]`)).toHaveAttribute("data-today", "");
  /* The count line says how many the filter leaves of the open ones, and how many of those are late
     (the vault holds the other tests' tasks too, so the total is whatever it is). */
  await expect(page.locator("[data-dag-tasks-count]")).toHaveText(/^3 of \d+ open, 1 overdue$/);
  /* Done is a tab of its own, and its date carries no emphasis. */
  await expect(page.locator(`[data-dag-task-row="${finished}"]`)).toHaveCount(0);
  await page.locator('[data-dag-tasks-tab="done"]').click();
  await expect(page.locator(`[data-dag-task-row="${finished}"] [data-dag-task-due]`)).not.toHaveAttribute("data-overdue", "");
  await page.locator('[data-dag-tasks-tab="open"]').click();
  /* A plain note is not a task. */
  await expect(page.locator(`[data-dag-task-row="${plain}"]`)).toHaveCount(0);

  /* One click on the mark is done, and writes that one line. */
  await row.locator("[data-dag-task-status]").click();
  await expect
    .poll(() => read("late"))
    .toBe(`---\ntitle: "Send the invoice"\nstatus: done\ndue: ${day(-2)}\n---\nWhat it is about.\n`);
  /* The row stays where it was, struck through, until the toast goes — so Undo is where it happened. */
  await expect(row).toHaveAttribute("data-done", "");
  const toast = page.locator(`[data-dag-task-toast="${late}"]`);
  await expect(toast).toContainText("Send the invoice");
  await toast.locator("[data-dag-task-undo]").click();
  await expect.poll(() => read("late")).toContain("\nstatus: todo\n");
  await expect(row).not.toHaveAttribute("data-done", "");

  /* The other statuses are in the row's menu, by a right-click. */
  await row.click({ button: "right", position: { x: 200, y: 10 } });
  await page.locator('[data-dag-task-menu-status="in-progress"]').click();
  await expect.poll(() => read("late")).toContain("\nstatus: in-progress\n");
  await expect(page.locator(`[data-dag-tasks-group="in-progress"] [data-dag-task-row="${late}"]`)).toBeVisible();

  /* And by the key each one shows: 1 is To do. The row's `⋯` is there under the pointer. */
  await page.locator(`[data-dag-task-row="${late}"]`).hover();
  await page.locator(`[data-dag-task-more="${late}"]`).click();
  await expect(page.locator(`[data-dag-task-menu="${late}"]`)).toBeVisible();
  await page.keyboard.press("1");
  await expect.poll(() => read("late")).toContain("\nstatus: todo\n");
  await expect(page.locator(`[data-dag-task-menu="${late}"]`)).toHaveCount(0);
});

test("on the board, a card dragged into another column takes that status, and the layout is remembered", async ({ page }) => {
  const one = write("one", "Write the copy", ["status: todo"]);
  await tasksPage(page, one);
  await page.locator('[data-dag-tasks-layout="board"]').click();
  const card = page.locator(`[data-dag-tasks-column="todo"] [data-dag-task-card="${one}"]`);
  await expect(card).toBeVisible();

  const from = (await card.boundingBox())!;
  const to = (await page.locator('[data-dag-tasks-column="done"]').boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y + 30, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 12 });
  await expect(page.locator('[data-dag-tasks-column="done"][data-dag-tasks-over]')).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => read("one")).toContain("\nstatus: done\n");
  await expect(page.locator(`[data-dag-tasks-column="done"] [data-dag-task-card="${one}"]`)).toBeVisible();

  /* Which layout is this browser's, and it is still the board the next time the page opens. */
  await page.goto("/?tasks=1");
  await expect(page.locator('[data-dag-tasks="board"]')).toBeVisible();
  await page.locator('[data-dag-tasks-layout="list"]').click();
});

test("a group's + presets the New task row to that status, and the pills write their lines into the new file", async ({
  page,
}, info) => {
  const anchor = write("anchor", "Something to wait for", ["status: todo"]);
  await tasksPage(page, anchor);
  const title = `Quick ${info.testId}`;
  /* A new note is a plain \`.md\`, called its title verbatim (decisions 7 and 14). */
  const file = path.join(BOARDS, `${title}.md`);
  made.push(file);
  await page.locator('[data-dag-tasks-group-add="in-progress"]').click();
  const box = page.locator('[data-dag-task-add="in-progress"]');
  await expect(box).toBeFocused();
  await expect(page.locator('[data-dag-task-new-status="in-progress"]')).toBeVisible();

  await page.locator("[data-dag-task-new-priority]").click();
  await page.locator('[data-dag-task-menu-priority="urgent"]').click();
  await page.locator("[data-dag-task-new-due]").click();
  await page.locator('[data-dag-task-menu-due="tomorrow"]').click();
  await box.fill(title);
  await box.press("Enter");
  await expect
    .poll(() => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""))
    .toMatch(new RegExp(`^---\\nstatus: in-progress\\npriority: urgent\\ndue: ${day(1)}\\nid: [0-9a-z]{10}\\n---\\n$`));
  /* The box is empty for the next one, the pills as they were, and the page is where it was. */
  await expect(box).toHaveValue("");
  await expect(page.locator('[data-dag-task-new-priority="urgent"]')).toBeVisible();
  await expect(page).toHaveURL(/tasks=1/);
});

test("the New task row: N puts the caret in it, Enter makes the task and tints it where it lands, Escape clears, and whitespace does nothing", async ({
  page,
}) => {
  const anchor = write("anchor", "Something to wait for", ["status: todo"]);
  await tasksPage(page, anchor);
  const row = page.locator('[data-dag-task-add-row="todo"]');
  const box = page.locator('[data-dag-task-add="todo"]');
  await expect(box).toHaveAttribute("placeholder", "New task");
  await expect(box).toHaveAttribute("aria-label", "New task: type a title and press Enter");

  /* The `+` is inside the row's label, so pressing it focuses the box it belongs to. */
  await row.locator("svg").click();
  await expect(box).toBeFocused();
  /* Escape leaves it, and N comes back to it. */
  await box.press("Escape");
  await expect(box).not.toBeFocused();
  await page.keyboard.press("n");
  await expect(box).toBeFocused();

  /* Whitespace alone is not a title. */
  await box.fill("   ");
  await box.press("Enter");
  await expect(box).toHaveValue("   ");

  const leaf = `quick-add-${Date.now()}`;
  const file = path.join(BOARDS, `${leaf}.md`);
  made.push(file);
  /* The page was narrowed to this test's folder; a quick add makes at the top level, so widen it. */
  await page.locator("[data-dag-tasks-filter]").fill("");
  await box.fill(leaf);
  await box.press("Enter");
  await expect
    .poll(() => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""))
    .toMatch(/^---\nstatus: todo\nid: [0-9a-z]{10}\n---\n$/);
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  await expect(page.locator(`[data-dag-tasks-group="todo"] [data-dag-task-row="${leaf}"]`)).toBeVisible();

  /* Escape clears what is in the box and makes nothing. */
  const escaped = `escaped-${Date.now()}`;
  await box.fill(escaped);
  await box.press("Escape");
  await expect(box).toHaveValue("");
  expect(fs.existsSync(path.join(BOARDS, `${escaped}.md`))).toBe(false);
});

test("the New task dialog makes a task with a description, keeps itself open for the next one, and Create and open opens it", async ({
  page,
}, info) => {
  const anchor = write("anchor", "Something to wait for", ["status: todo"]);
  await tasksPage(page, anchor);
  const first = `Dialog ${info.testId}`;
  const second = `Opened ${info.testId}`;
  for (const t of [first, second]) made.push(path.join(BOARDS, `${t}.md`));

  /* C opens it, the caret in the title. */
  await page.locator("[data-dag-tasks-filter]").evaluate((el) => (el as HTMLElement).blur());
  await page.keyboard.press("c");
  const dialog = page.locator("[data-dag-task-dialog]");
  const title = page.locator("[data-dag-task-dialog-title]");
  await expect(title).toBeFocused();
  await title.fill(first);
  await page.locator("[data-dag-task-dialog-description]").fill("Why it matters.\n\n- [ ] one step");
  await page.locator("[data-dag-task-dialog-priority]").click();
  await page.keyboard.press("2");
  await expect(page.locator('[data-dag-task-dialog-priority="high"]')).toBeVisible();
  await page.locator("[data-dag-task-dialog-keep]").check();
  await title.press("Enter");
  await expect
    .poll(() =>
      fs.existsSync(path.join(BOARDS, `${first}.md`)) ? fs.readFileSync(path.join(BOARDS, `${first}.md`), "utf8") : "",
    )
    .toMatch(/^---\nstatus: todo\npriority: high\nid: [0-9a-z]{10}\n---\nWhy it matters\.\n\n- \[ \] one step\n$/);
  /* Kept open: the title and description are clean, the pills as they were. */
  await expect(title).toHaveValue("");
  await expect(page.locator("[data-dag-task-dialog-description]")).toHaveValue("");
  await expect(page.locator('[data-dag-task-dialog-priority="high"]')).toBeVisible();

  await title.fill(second);
  await page.locator("[data-dag-task-dialog-open]").click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/note=/);
  await expect(page.locator("[data-dag-taskbar-priority]")).toHaveAttribute("data-dag-taskbar-priority", "high");
});

test("a refused create keeps the title, and the lock's pill is what says why", async ({ page }) => {
  const anchor = write("anchor", "Something to wait for", ["status: todo"]);
  const leaf = `locked-${Date.now()}`;
  const file = path.join(BOARDS, `${leaf}.md`);
  await lockFirst(page);
  await tasksPage(page, anchor);
  const box = page.locator('[data-dag-task-add="todo"]');
  await box.fill(leaf);
  await box.press("Enter");

  /* The top bar's pill shakes — its Unlock is beside it — and no second notice opens. */
  const pill = page.locator("[data-dag-readonly-pill]");
  await expect(pill).toHaveAttribute("data-dag-readonly-shake", "");
  await expect(page.locator("[data-dag-readonly-unlock]")).toBeVisible();
  await expect(box).toHaveValue(leaf);
  expect(fs.existsSync(file)).toBe(false);

  /* Unlocking from the pill makes the title that was kept. */
  await page.locator("[data-dag-readonly-unlock]").click();
  await expect(page.locator("[data-dag-readonly]")).toHaveCount(0);
  made.push(file);
  await box.focus();
  await box.press("Enter");
  await expect.poll(() => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "")).toMatch(/\nstatus: todo\n/);
  await expect(box).toHaveValue("");

  /* A server refusal says the server's reason, and the title stays to be changed and retried. */
  await page.route(/\/__board\/create(?:\?|$)/, (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "The vault is read only." }),
    }),
  );
  expected.push(/status of 400/);
  await box.fill("A refused title");
  await box.press("Enter");
  const problem = page.locator('[data-dag-task-add-problem="todo"]');
  await expect(problem).toContainText("The vault is read only.");
  await expect(box).toHaveValue("A refused title");
  await page.unroute(/\/__board\/create(?:\?|$)/);
  expect(fs.existsSync(path.join(BOARDS, "a-refused-title.md"))).toBe(false);
});

test("a task's own page sets its status and its date through the note's save, and Not a task makes it a note", async ({
  page,
}) => {
  const name = write("own", "Plan the launch", ["status: todo"], "The launch plan.\n\n- [ ] book the room\n");
  await page.goto(`/?note=${name}`);
  await ready(page);
  const bar = page.locator("[data-dag-taskbar]");
  await expect(bar).toHaveAttribute("data-dag-taskbar", "todo");

  /* The status is a menu in the panel; the mark beside the title is the same checkbox as a row's. */
  await bar.locator("[data-dag-taskbar-status]").click();
  await page.locator('[data-dag-task-menu-status="in-progress"]').click();
  await expect
    .poll(() => read("own"))
    .toBe('---\ntitle: "Plan the launch"\nstatus: in-progress\n---\nThe launch plan.\n\n- [ ] book the room\n');
  await bar.locator("[data-dag-taskbar-due]").fill(day(3));
  await expect.poll(() => read("own")).toContain(`\nstatus: in-progress\ndue: ${day(3)}\n---\n`);
  await page.locator("[data-dag-taskbar-clear-due]").click();
  await expect.poll(() => read("own")).not.toContain("due:");

  /* The way back is the top bar's `⋯`, not a word among the values. */
  await pageMore(page, "data-dag-taskbar-untask");
  await expect.poll(() => read("own")).toBe('---\ntitle: "Plan the launch"\n---\nThe launch plan.\n\n- [ ] book the room\n');
  await expect(bar).toHaveCount(0);
  /* And the top bar's `⋯` offers the way back. */
  await pageMore(page, "data-dag-note-make-task");
  await expect.poll(() => read("own")).toContain("\nstatus: todo\n---\n");
  await expect(page.locator('[data-dag-taskbar="todo"]')).toBeVisible();
  await page.locator(".dag-note-view__mark [data-dag-task-status]").click();
  await expect.poll(() => read("own")).toContain("\nstatus: done\n---\n");
});

test("a task's page: its properties beside the text, what links here, a project that moves the file, the panel folded, and the steps through the list", async ({
  page,
}) => {
  write("step-a", "Alpha step", ["status: todo", `due: ${day(1)}`]);
  const b = write("step-b", "Beta step", ["status: todo", `due: ${day(2)}`], "Why.\n\n- [x] one\n- [ ] two\n");
  fs.mkdirSync(path.join(dir, "proj"), { recursive: true });
  const project = `${folder}/proj/launch`;
  fs.writeFileSync(path.join(dir, "proj", "launch.note.md"), '---\ntitle: "Launch"\nproject: active\nhue: moss\n---\n');
  const id = await idOf(page, b);
  write("linker", "Plans", [], `See [Beta](dag:${id}).\n`);

  /* From the Tasks page, so the steps are the order it drew: Alpha, then Beta. */
  await tasksPage(page, b);
  await page.locator(`[data-dag-task-open="${b}"]`).click();
  await ready(page);
  await expect(page.locator("[data-dag-taskstep-at]")).toHaveText("2 of 2");
  const panel = page.locator("aside[data-dag-taskbar]");
  await expect(panel.locator('[data-dag-taskbar-items="1/2"]')).toContainText("1 of 2");
  await expect(panel.locator("[data-dag-taskbar-distance]")).toHaveText("2 days left");
  await expect(panel.locator("[data-dag-linked-from-row]")).toContainText("Plans", { timeout: 15_000 });

  /* Folded into a line of pills, remembered, and back. */
  await page.locator("[data-dag-taskpanel-toggle]").click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".dag-taskline-pills [data-dag-taskbar-status]")).toBeVisible();
  await page.locator("[data-dag-taskpanel-toggle]").click();
  await expect(panel).toBeVisible();

  /* The step before is Alpha. */
  await page.locator("[data-dag-taskstep-prev]").click();
  await expect(page.locator("[data-dag-taskstep-at]")).toHaveText("1 of 2");
  await expect(page).toHaveURL(/step-a/);

  /* A project is a folder: choosing one moves the file into it, and the page follows. */
  await page.locator("[data-dag-taskbar-project]").click();
  await page.locator(`[data-dag-task-menu-project="${project}"]`).click();
  const moved = path.join(dir, "proj", "step-a.note.md");
  await expect.poll(() => fs.existsSync(moved)).toBe(true);
  expect(fs.existsSync(noteFile("step-a"))).toBe(false);
  await expect(page).toHaveURL(/proj%2Fstep-a|proj\/step-a/);
  await expect(page.locator("[data-dag-taskbar-project]")).toHaveAttribute("data-dag-taskbar-project", project);
  expect(fs.readFileSync(moved, "utf8")).toContain(`\nstatus: todo\ndue: ${day(1)}\n`);
});

test("a priority is set from the row's mark, from its menu's keys and from the task's page, and a plain note loses it", async ({
  page,
}) => {
  const name = write("pri", "Fix the leak", ["status: todo"]);
  await tasksPage(page, name);
  const row = page.locator(`[data-dag-task-row="${name}"]`);
  const mark = row.locator("[data-dag-task-priority]");
  await expect(mark).toHaveAttribute("data-dag-task-priority", "none");

  await mark.click();
  await page.locator('[data-dag-task-menu-priority="high"]').click();
  await expect.poll(() => read("pri")).toContain("\nstatus: todo\npriority: high\n---\n");
  await expect(mark).toHaveAttribute("data-dag-task-priority", "high");

  /* The menu's keys: 1 is Urgent, 0 is none. */
  await mark.click();
  await page.keyboard.press("1");
  await expect.poll(() => read("pri")).toContain("\npriority: urgent\n");
  await mark.click();
  await page.keyboard.press("0");
  await expect.poll(() => read("pri")).not.toContain("priority:");
  await expect(mark).toHaveAttribute("data-dag-task-priority", "none");

  /* The task's own page: the same menu, through the note's save. */
  await page.goto(`/?note=${name}`);
  await ready(page);
  await page.locator("[data-dag-taskbar-priority]").click();
  await page.locator('[data-dag-task-menu-priority="low"]').click();
  await expect.poll(() => read("pri")).toBe('---\ntitle: "Fix the leak"\nstatus: todo\npriority: low\n---\nWhat it is about.\n');
  await expect(page.locator("[data-dag-taskbar-priority]")).toHaveAttribute("data-dag-taskbar-priority", "low");

  /* Not a task takes the priority with the status: a plain note keeps no line it cannot show. */
  await pageMore(page, "data-dag-taskbar-untask");
  await expect.poll(() => read("pri")).toBe('---\ntitle: "Fix the leak"\n---\nWhat it is about.\n');
});

test("the read-only view draws a task's status and date and nothing to change them with", async ({ page }) => {
  const name = write("seen", "Review the draft", ["status: in-progress", `due: ${day(0)}`]);
  await page.goto(`/?view=1&note=${name}`);
  await ready(page);
  await expect(page.locator('[data-dag-taskline="in-progress"]')).toContainText("Today");
  await expect(page.locator("[data-dag-taskbar-status]")).toHaveCount(0);
});

test("a task's card on a board changes the task's file", async ({ page }) => {
  const name = write("carded", "Ship the pricing page", ["status: in-progress"]);
  const id = await idOf(page, name);
  const board = path.join(dir, "board.board.md");
  fs.writeFileSync(
    board,
    `---\ntitle: Launch\n---\n\n\`\`\`md {#t1 x=0 y=0 w=360}\n![Ship the pricing page](dag:${id})\n\`\`\`\n`,
  );
  await page.goto(`/?board=${folder}/board`);
  await ready(page);
  const card = page.locator(`[data-dag-embed="${id}"][data-dag-embed-kind="task"]`);
  await expect(card).toHaveAttribute("data-dag-embed-task", "in-progress");
  await card.locator("[data-dag-task-status]").click();
  await expect.poll(() => read("carded")).toContain("\nstatus: done\n");
  await expect(card).toHaveAttribute("data-dag-embed-task", "done");
  /* The press was the button's: the board's own file is untouched, and nothing was selected. */
  expect(fs.readFileSync(board, "utf8")).toContain("```md {#t1 x=0 y=0 w=360}");
  await expect(page.locator("[data-dag-selected]")).toHaveCount(0);
});

test("a sidebar row dropped on the canvas places that task's card where it was let go", async ({ page }) => {
  const name = write("dropped", "Write the onboarding copy", ["status: todo"]);
  const id = await idOf(page, name);
  const board = path.join(dir, "board.board.md");
  fs.writeFileSync(board, "---\ntitle: Launch\n---\n\n```md {#intro x=0 y=0 w=320}\n# Launch\n```\n");
  await page.goto(`/?board=${folder}/board`);
  await ready(page);
  await openSidebar(page);
  /* The open board's folder is opened for it, so the row is there to take. */
  const row = page.locator(`[data-dag-sidebar-file="${name}"]`);
  await expect(row).toHaveAttribute("data-dag-sidebar-task", "todo");

  const from = (await row.boundingBox())!;
  const canvas = (await page.locator(".dag-viewport").boundingBox())!;
  await page.mouse.move(from.x + 30, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 70, from.y + 20, { steps: 4 });
  await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.6, { steps: 12 });
  await expect(page.locator(".dag-viewport[data-dag-drop-file]")).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => fs.readFileSync(board, "utf8")).toContain(`![Write the onboarding copy](dag:${id})`);
  await expect(page.locator(`[data-dag-embed="${id}"][data-dag-embed-kind="task"]`)).toBeVisible();
  /* A card that only embeds a document opens no panel over itself. */
  await expect(page.locator("[data-dag-inspector]")).toHaveCount(0);
});

test("the sidebar counts open tasks, opens the Tasks page, and a row's menu makes a note a task", async ({ page }) => {
  write("counted", "Open one", ["status: todo"]);
  const plain = write("plainrow", "Just a note");
  await page.goto(`/?note=${plain}`);
  await ready(page);
  await openSidebar(page);
  await expect(page.locator("[data-dag-sidebar-tasks-open]")).toBeVisible();

  const row = page.locator(`[data-dag-sidebar-file="${plain}"]`);
  await expect(row).not.toHaveAttribute("data-dag-sidebar-task", /.+/);
  await row.click({ button: "right" });
  await page.locator('[data-dag-sidebar-menu-item="make-task"]').click();
  await expect.poll(() => read("plainrow")).toContain("\nstatus: todo\n---\n");
  await expect(row).toHaveAttribute("data-dag-sidebar-task", "todo");

  await page.locator("[data-dag-sidebar-tasks]").click();
  await expect(page).toHaveURL(/tasks=1/);
  await expect(page.locator("[data-dag-sidebar-tasks]")).toHaveAttribute("aria-current", "page");
});
