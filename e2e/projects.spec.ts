import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { openSidebar } from "./sidebar";

/**
 * Projects. A project is a folder holding a note with a `project:`,
 * and every check here reads the **file**, because the whole of the feature is which lines of that
 * note change and which folder a task sits in.
 *
 * Each test works in a folder named for its test id, for `tasks.spec.ts`'s reason: the suite runs
 * eight wide over one `boards/`, and the Tasks page and the sidebar list the whole account.
 */

let folder = "";
let dir = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-project-${info.testId}`;
  dir = path.join(BOARDS, folder);
  fs.mkdirSync(dir, { recursive: true });
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  /* Only the folder this test made, and only when it knows which (`CLAUDE.md`, *Things that will bite*). */
  if (folder) fs.rmSync(dir, { recursive: true, force: true });
  folder = "";
  expect(problems, "console output").toEqual([]);
});

const file = (leaf: string) => path.join(dir, `${leaf}.note.md`);
/* A note a test writes is \`.note.md\`; one the app makes is \`.md\` (decision 7) and is called its title (decision 14). */
const read = (leaf: string) => {
  for (const f of [path.join(dir, `${leaf}.md`), file(leaf)]) if (fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  return "";
};

function write(leaf: string, title: string, lines: string[] = [], body = "What it is about.\n"): string {
  fs.mkdirSync(path.dirname(file(leaf)), { recursive: true });
  fs.writeFileSync(file(leaf), `---\ntitle: ${JSON.stringify(title)}\n${lines.map((l) => `${l}\n`).join("")}---\n${body}`);
  return `${folder}/${leaf}`;
}

async function ready(page: Page) {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
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

test("a folder's menu makes it a project, and the project's bar writes its status and colour", async ({ page }) => {
  const anchor = write("copy", "Write the launch copy", ["status: todo"]);
  write("research/ask", "Interview five customers", ["status: in-progress"]);
  await page.goto(`/?note=${anchor}`);
  await ready(page);
  await openSidebar(page);

  const row = page.locator(`[data-dag-sidebar-folder="${folder}"]`);
  await expect(row).not.toHaveAttribute("data-dag-sidebar-project", /.+/);
  await row.click({ button: "right" });
  await page.locator('[data-dag-sidebar-menu-item="make-project"]').click();

  /* The folder's project note, titled after the folder, made in it and opened. */
  /* Called its title, verbatim (decision 14) — so there is no `title:` line to read. */
  await expect(page).toHaveURL(new RegExp(`note=${encodeURIComponent(`${folder}/`)}E2e`));
  const stem = new URL(page.url()).searchParams.get("note")!.slice(folder.length + 1);
  await expect.poll(() => read(stem)).toMatch(/^---\nproject: active\nid: [0-9a-z]{10}\n---\n$/);
  await expect(row).toHaveAttribute("data-dag-sidebar-project", "active");

  /* The bar counts every task under the folder, a subfolder's included. */
  const bar = page.locator("[data-dag-projectbar]");
  await expect(bar).toHaveAttribute("data-dag-projectbar", "active");
  await expect(bar.locator("[data-dag-projectbar-counts]")).toHaveAttribute("data-dag-projectbar-counts", "2");

  await bar.locator('[data-dag-projectbar-status="paused"]').click();
  await expect.poll(() => read(stem)).toContain("\nproject: paused\n");
  await bar.locator("[data-dag-projectbar-colour]").click();
  await bar.locator('[data-dag-projectbar-hue="coral"]').click();
  await expect.poll(() => read(stem)).toMatch(/\nproject: paused\n(id: [0-9a-z]{10}\n)?hue: coral\n/);
  await expect(row).toHaveAttribute("data-dag-sidebar-project", "paused");

  /* The top bar does not offer to make a project a task. */
  await expect(page.locator("[data-dag-note-make-task]")).toHaveCount(0);
});

test("Open tasks shows only the project's tasks, and one typed in there is made in its folder", async ({ page }, info) => {
  /* The project is a folder inside this test's own, so a task beside it is outside the project. */
  const project = write("proj/launch", "Launch", ["project: active", "hue: teal"]);
  const inside = write("proj/copy", "Write the launch copy", ["status: todo"]);
  const deeper = write("proj/research/ask", "Interview five customers", ["status: in-progress"]);
  const outside = write("other", "Something unrelated", ["status: todo"]);
  const id = await idOf(page, project);

  await page.goto(`/?note=${project}`);
  await ready(page);
  await page.locator("[data-dag-projectbar-tasks]").click();
  await expect(page).toHaveURL(new RegExp(`tasks=1&project=${id}`));
  await expect(page.locator(`[data-dag-task-row="${inside}"]`)).toBeVisible();
  await expect(page.locator(`[data-dag-task-row="${deeper}"]`)).toBeVisible();
  await expect(page.locator(`[data-dag-task-row="${outside}"]`)).toHaveCount(0);
  /* Filtered to it, a row need not name the project it is in. */
  await expect(page.locator(`[data-dag-task-row="${inside}"] [data-dag-project-chip]`)).toHaveCount(0);

  const title = `Book ${info.testId}`;
  const box = page.locator('[data-dag-task-add="todo"]');
  await box.fill(title);
  await box.press("Enter");
  await expect.poll(() => read(`proj/${title}`)).toMatch(/^---\nstatus: todo\nid: [0-9a-z]{10}\n---\n$/);

  /* Every project: a row names its project with a chip, and one outside every project has none. */
  await page.locator("[data-dag-tasks-project]").selectOption("");
  await page.locator("[data-dag-tasks-filter]").fill(folder);
  await expect(page.locator(`[data-dag-task-row="${inside}"] [data-dag-project-chip]`)).toHaveAttribute(
    "data-dag-project-chip",
    "Launch",
  );
  await expect(page.locator(`[data-dag-task-row="${outside}"] [data-dag-project-chip]`)).toHaveCount(0);
});

test("Not a project takes the two lines out, and the folder is a plain folder again", async ({ page }) => {
  const project = write("launch", "Launch", ["project: done", "hue: moss"], "Why.\n");
  await page.goto(`/?note=${project}`);
  await ready(page);
  await openSidebar(page);
  const row = page.locator(`[data-dag-sidebar-folder="${folder}"]`);
  await expect(row).toHaveAttribute("data-dag-sidebar-project", "done");

  await row.click({ button: "right" });
  await page.locator('[data-dag-sidebar-menu-item="unmake-project"]').click();
  await expect.poll(() => read("launch")).toBe('---\ntitle: "Launch"\n---\nWhy.\n');
  await expect(row).not.toHaveAttribute("data-dag-sidebar-project", /.+/);
  await expect(page.locator("[data-dag-projectbar]")).toHaveCount(0);
});

test("a project's card on a board says so, and its read-only page draws its status", async ({ page }) => {
  const project = write("launch", "Launch", ["project: paused"]);
  const id = await idOf(page, project);
  fs.writeFileSync(
    path.join(dir, "board.board.md"),
    `---\ntitle: Launch board\n---\n\n\`\`\`md {#p1 x=0 y=0 w=360}\n![Launch](dag:${id})\n\`\`\`\n`,
  );
  await page.goto(`/?board=${folder}/board`);
  await ready(page);
  const card = page.locator(`[data-dag-embed="${id}"][data-dag-embed-kind="project"]`);
  await expect(card).toContainText("Project · Paused");

  await page.goto(`/?view=1&note=${project}`);
  await ready(page);
  await expect(page.locator('[data-dag-projectline="paused"]')).toBeVisible();
  await expect(page.locator("[data-dag-projectbar-status]")).toHaveCount(0);
});
