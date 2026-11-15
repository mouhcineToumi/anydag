import fs from "node:fs";
import path from "node:path";

import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";
import { openSidebar } from "./sidebar";
import { suiteVault } from "./vault";

/**
 * What a document tab keeps while another is in front (#264, `src/ui/tabs/keep.ts`): a board's
 * view, selection and undo; a note's editor, mounted and hidden; any page's scroll. And what
 * switching must never do: write a byte, or fight a change made to a file while its tab was behind.
 *
 * Every file lives in a folder of this check's own, cleaned up by name (`history.spec.ts`).
 */

let folder = "";
const board = (id: string): string => `---\ntitle: ${id.toUpperCase()}\n---\n\n\`\`\`md {#${id} x=0 y=0 w=320}\n${id}\n\`\`\`\n`;
const NOTE = "---\ntitle: Idea\n---\n# Idea\n\nThe first line.\n\nThe second line.\n";

test.beforeEach(async ({ page }, info) => {
  folder = `e2e-tabstate-${info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  fs.mkdirSync(path.join(BOARDS, folder), { recursive: true });
  for (const id of ["a", "b"]) fs.writeFileSync(file(`${id}.board.md`), board(id));
  fs.writeFileSync(file("idea.note.md"), NOTE);
  const vault = await suiteVault(page.request);
  await expect
    .poll(
      async () => {
        const body = (await (await page.request.get("/__board/list", { params: { vault } })).json()) as {
          boards: string[];
          notes: string[];
        };
        return ["a", "b"].every((n) => body.boards.includes(name(n))) && body.notes.includes(name("idea"));
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});
test.afterEach(() => {
  if (folder) fs.rmSync(path.join(BOARDS, folder), { recursive: true, force: true });
  folder = "";
});

const name = (f: string) => `${folder}/${f}`;
const file = (f: string) => path.join(BOARDS, folder, f);
const read = (f: string) => fs.readFileSync(file(f), "utf8");
const item = (page: Page, id: string) => page.locator(`[data-dag-item="${id}"]`);
const fileRow = (page: Page, f: string) => page.locator(`[data-dag-sidebar-file="${name(f)}"]`);
const tab = (page: Page, label: string) => page.locator("[data-dag-doctab]").filter({ hasText: new RegExp(`^${label}$`) });
const ready = (page: Page) =>
  page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
/** The page in front: a note kept mounted behind it is in the DOM too. */
const front = (page: Page) => page.locator(".dag-docs__page:not([data-dag-docs-away])");

async function start(page: Page, address: string): Promise<void> {
  await page.goto(address);
  await ready(page);
  await openSidebar(page);
  await expect(fileRow(page, "b")).toHaveCount(1, { timeout: 10_000 });
}

/** Where the canvas is: the painted scale and translation (`navigate.spec.ts`). */
const view = (page: Page) =>
  page.evaluate(() => {
    const layer = document.querySelector(".dag-docs__page:not([data-dag-docs-away]) .dag-layer") as HTMLElement;
    const m = new DOMMatrix(getComputedStyle(layer).transform);
    return { zoom: m.a, x: m.e, y: m.f };
  });

test("a board's tab keeps its view, its selection and its undo while another is in front", async ({ page }) => {
  await start(page, `/?board=${name("a")}`);
  await fileRow(page, "b").click({ button: "middle" });

  const at = (await item(page, "a").boundingBox())!;
  await page.mouse.click(at.x + 40, at.y + 12);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => read("a.board.md"), { timeout: 5_000 }).toMatch(/\{#a x=8 y=0/);
  await page.keyboard.press("=");
  await page.keyboard.press("=");
  const before = await view(page);
  await expect(page.locator("[data-dag-selected]")).toHaveAttribute("data-dag-item", "a");

  await tab(page, "B").click();
  await expect(item(page, "b")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-dag-selected]")).toHaveCount(0);
  await tab(page, "A").click();
  await expect(item(page, "a")).toBeVisible({ timeout: 10_000 });
  await ready(page);

  await expect(page.locator("[data-dag-selected]")).toHaveAttribute("data-dag-item", "a");
  expect(await view(page)).toEqual(before);
  /* The undo the tab kept is the move made before it went behind. */
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => read("a.board.md"), { timeout: 5_000 }).toMatch(/\{#a x=0 y=0/);
});

test("a note behind the tab in front stays mounted: its editor, caret and undo are the ones it left", async ({ page }) => {
  await start(page, `/?note=${name("idea")}`);
  await fileRow(page, "a").click({ button: "middle" });
  const editor = front(page).locator(".bn-editor");
  await editor.evaluate((el) => ((el as HTMLElement & { dagMark?: number }).dagMark = 1));

  await front(page).getByText("The second line.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Typed here.");
  await expect.poll(() => read("idea.note.md"), { timeout: 5_000 }).toContain("The second line. Typed here.");

  await tab(page, "A").click();
  await expect(item(page, "a")).toBeVisible({ timeout: 10_000 });
  /* Hidden and out of reach, not gone. */
  await expect(page.locator(".dag-docs__page[data-dag-docs-away] .bn-editor")).toHaveCount(1);

  await tab(page, "Idea").click();
  await ready(page);
  expect(await editor.evaluate((el) => (el as HTMLElement & { dagMark?: number }).dagMark)).toBe(1);
  /* The editor's own undo, which only a mounted editor has. */
  await front(page).getByText("The second line. Typed here.").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => read("idea.note.md"), { timeout: 5_000 }).not.toContain("Typed here.");
});

test("switching tabs writes nothing, and a note changed on disk while it was behind shows the change on return", async ({
  page,
}) => {
  await start(page, `/?note=${name("idea")}`);
  await fileRow(page, "a").click({ button: "middle" });
  await fileRow(page, "b").click({ button: "middle" });

  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/__board")) writes.push(`${r.method()} ${r.url()}`);
  });
  const files = ["a.board.md", "b.board.md", "idea.note.md"];
  const was = files.map((f) => [read(f), fs.statSync(file(f)).mtimeMs]);
  for (const label of ["A", "B", "Idea", "A", "Idea", "B"]) {
    await tab(page, label).click();
    await ready(page);
  }
  expect(writes).toEqual([]);
  expect(files.map((f) => [read(f), fs.statSync(file(f)).mtimeMs])).toEqual(was);

  /* In front: B. The note is behind, mounted; its file changes under it. */
  fs.writeFileSync(file("idea.note.md"), `${NOTE}\nAdded while it was behind.\n`);
  await page.waitForTimeout(1_500);
  await tab(page, "Idea").click();
  await ready(page);
  await expect(front(page).getByText("Added while it was behind.")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-dag-note-conflict]")).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("a write a note was holding when its tab went behind is made, on the version it read", async ({ page }) => {
  await start(page, `/?note=${name("idea")}`);
  await fileRow(page, "a").click({ button: "middle" });
  await front(page).getByText("The first line.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" And more.");
  /* Away before the write's debounce is up. */
  await tab(page, "A").click();
  await expect.poll(() => read("idea.note.md"), { timeout: 5_000 }).toContain("The first line. And more.");
  expect(read("idea.note.md")).toContain("The second line.");
});

test("a page that is not kept mounted has its scroll back when its tab returns", async ({ page }) => {
  for (let i = 0; i < 60; i++)
    fs.writeFileSync(
      file(`task-${String(i).padStart(2, "0")}.note.md`),
      `---\nstatus: todo\n---\n# Task ${i} of the tab check\n`,
    );
  await page.goto("/?tasks=1");
  await expect(page.locator(".dag-app--tasks")).toBeVisible({ timeout: 10_000 });
  const task = page.locator(`[data-dag-task-open="${name("task-00")}"]`);
  await expect(task).toHaveCount(1, { timeout: 10_000 });
  /* The list is still filling in as the files are listed, and a row can move under the press; a
     second press on the same task goes to the tab the first one made, so it is safe to try again. */
  await expect(async () => {
    await task.click({ button: "middle" });
    await expect(page.locator("[data-dag-doctab]")).toHaveCount(2, { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });

  const scroller = async () =>
    page.evaluate(() => {
      const root = document.querySelector(".dag-docs__page:not([data-dag-docs-away]) .dag-app--tasks");
      const all = root ? [root, ...root.querySelectorAll("*")] : [];
      const el = all.find((e) => e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
      return el ? { top: el.scrollTop, can: el.scrollHeight - el.clientHeight } : null;
    });
  await expect.poll(async () => (await scroller())?.can ?? 0, { timeout: 10_000 }).toBeGreaterThan(300);
  await page.evaluate(() => {
    const root = document.querySelector(".dag-docs__page:not([data-dag-docs-away]) .dag-app--tasks")!;
    const el = [root, ...root.querySelectorAll("*")].find(
      (e) => e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY),
    )!;
    el.scrollTop = 300;
  });

  await page.locator('[data-dag-doctab-kind="note"]').click();
  await ready(page);
  await expect(page.locator(".dag-app--tasks")).toHaveCount(0);
  await page.locator('[data-dag-doctab-kind="tasks"]').click();
  await expect.poll(async () => (await scroller())?.top ?? -1, { timeout: 5_000 }).toBe(300);
});
