import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
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
const made: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-task-${info.testId}`;
  dir = path.join(BOARDS, folder);
  fs.mkdirSync(dir, { recursive: true });
  problems = [];
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
  expect(problems, "console output").toEqual([]);
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

/** The Tasks page, narrowed to this test's folder, once its rows have arrived. */
async function tasksPage(page: Page, expectRow: string) {
  await page.goto("/?tasks=1");
  await page.locator("[data-dag-tasks-filter]").fill(folder);
  await expect(page.locator(`[data-dag-task-row="${expectRow}"], [data-dag-task-card="${expectRow}"]`)).toBeVisible({ timeout: 15_000 });
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

test("a note with a status is on the Tasks page, in its group, and its status moves on from there", async ({ page }) => {
  const late = write("late", "Send the invoice", ["status: todo", `due: ${day(-2)}`]);
  const doing = write("doing", "Ship the pricing page", ["status: in-progress", `due: ${day(1)}`]);
  const finished = write("finished", "Redraw the favicon", ["status: done"]);
  const plain = write("plain", "Meeting notes");
  await tasksPage(page, late);

  await expect(page.locator(`[data-dag-tasks-group="in-progress"] [data-dag-task-row="${doing}"]`)).toBeVisible();
  const row = page.locator(`[data-dag-tasks-group="todo"] [data-dag-task-row="${late}"]`);
  await expect(row).toContainText("Send the invoice");
  /* Past its date and not done, so its date says so. */
  await expect(row.locator("[data-dag-task-due]")).toHaveAttribute("data-overdue", "");
  /* Done starts shut, and says how many are in it. */
  await expect(page.locator(`[data-dag-task-row="${finished}"]`)).toHaveCount(0);
  await expect(page.locator('[data-dag-tasks-group="done"] .dag-tasks__n')).toHaveText("1");
  await page.locator('[data-dag-tasks-twisty="done"]').click();
  await expect(page.locator(`[data-dag-task-row="${finished}"]`)).toBeVisible();
  /* A plain note is not a task. */
  await expect(page.locator(`[data-dag-task-row="${plain}"]`)).toHaveCount(0);

  /* The status button moves it on — to do, in progress — and writes that one line. */
  await row.locator("[data-dag-task-status]").click();
  await expect.poll(() => read("late")).toBe(`---\ntitle: "Send the invoice"\nstatus: in-progress\ndue: ${day(-2)}\n---\nWhat it is about.\n`);
  await expect(page.locator(`[data-dag-tasks-group="in-progress"] [data-dag-task-row="${late}"]`)).toBeVisible();
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

test("a title typed into a group is a task named after it, in that status", async ({ page }, info) => {
  const anchor = write("anchor", "Something to wait for", ["status: todo"]);
  await tasksPage(page, anchor);
  const title = `Quick ${info.testId}`;
  /* A new note is a plain \`.md\`, called its title verbatim (decisions 7 and 14). */
  const file = path.join(BOARDS, `${title}.md`);
  made.push(file);
  const box = page.locator('[data-dag-task-add="in-progress"]');
  await box.fill(title);
  await box.press("Enter");
  await expect.poll(() => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "")).toMatch(/^---\nstatus: in-progress\nid: [0-9a-z]{10}\n---\n$/);
  /* The box is empty for the next one, and the page is where it was. */
  await expect(box).toHaveValue("");
  await expect(page).toHaveURL(/tasks=1/);
});

test("a task's own page sets its status and its date through the note's save, and Not a task makes it a note", async ({ page }) => {
  const name = write("own", "Plan the launch", ["status: todo"], "The launch plan.\n\n- [ ] book the room\n");
  await page.goto(`/?note=${name}`);
  await ready(page);
  const bar = page.locator("[data-dag-taskbar]");
  await expect(bar).toHaveAttribute("data-dag-taskbar", "todo");

  await bar.locator('[data-dag-taskbar-status="in-progress"]').click();
  await expect.poll(() => read("own")).toBe('---\ntitle: "Plan the launch"\nstatus: in-progress\n---\nThe launch plan.\n\n- [ ] book the room\n');
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
  fs.writeFileSync(board, `---\ntitle: Launch\n---\n\n\`\`\`md {#t1 x=0 y=0 w=360}\n![Ship the pricing page](dag:${id})\n\`\`\`\n`);
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
