import fs from "node:fs";
import path from "node:path";

import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";
import { openSidebar } from "./sidebar";
import { suiteVault } from "./vault";

/**
 * The tabs between runs and as their files move (#264, `src/ui/tabs/saved.ts`): a window opens on the
 * tabs it had, a tab whose file is gone is dropped, a tab follows its file through a rename or a
 * move, and one behind the tab in front closes and says why when its file goes to the trash.
 *
 * The suite runs with the settings' sync off (`dag:sync`), so the tabs are kept in this browser's
 * storage for the vault — the rule every preference follows — and a fresh context starts with none.
 * `/api/tabs`, where they are kept with sync on, is `test/server/tabs.test.ts`'s.
 */

let folder = "";
const board = (id: string): string => `---\ntitle: ${id.toUpperCase()}\n---\n\n\`\`\`md {#${id} x=0 y=0 w=320}\n${id}\n\`\`\`\n`;

test.beforeEach(async ({ page }, info) => {
  folder = `e2e-tabrestore-${info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  fs.mkdirSync(path.join(BOARDS, folder), { recursive: true });
  for (const id of ["a", "b", "c"]) fs.writeFileSync(path.join(BOARDS, folder, `${id}.board.md`), board(id));
  fs.writeFileSync(path.join(BOARDS, folder, "idea.note.md"), "---\ntitle: Idea\n---\n# Idea\n\nStart.\n");
  const vault = await suiteVault(page.request);
  await expect
    .poll(
      async () => {
        const body = (await (await page.request.get("/__board/list", { params: { vault } })).json()) as {
          boards: string[];
          notes: string[];
        };
        return ["a", "b", "c"].every((n) => body.boards.includes(name(n))) && body.notes.includes(name("idea"));
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
const tabs = (page: Page) => page.locator("[data-dag-doctab]");
const front = (page: Page) => page.locator('[data-dag-doctab][aria-selected="true"]');
const tab = (page: Page, label: string) => tabs(page).filter({ hasText: new RegExp(`^${label}$`) });
const here = (page: Page, kind = "board") => new URL(page.url()).searchParams.get(kind);
const ready = (page: Page) =>
  page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });

/** A in front, then B and the note behind it. */
async function open(page: Page): Promise<void> {
  await page.goto(`/?board=${name("a")}`);
  await ready(page);
  await openSidebar(page);
  for (const f of ["b", "idea"]) {
    const row = page.locator(`[data-dag-sidebar-file="${name(f)}"]`);
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await row.click({ button: "middle" });
  }
  await expect(tabs(page)).toHaveText(["A", "B", "Idea"]);
}

test("a window opens on the tabs it had, a new one with the tab that was in front, and none of it is in the vault", async ({
  page,
}) => {
  const bytes = () =>
    fs.readdirSync(path.join(BOARDS, folder)).map((f) => `${f}:${fs.readFileSync(path.join(BOARDS, folder, f), "utf8")}`);
  const before = bytes();
  await open(page);
  await tab(page, "B").click();
  await expect.poll(() => here(page)).toBe(name("b"));
  /* Kept a moment after the last change. */
  await page.waitForTimeout(800);

  await page.reload();
  await ready(page);
  await expect(tabs(page)).toHaveText(["A", "B", "Idea"]);
  await expect(front(page)).toHaveText("B");

  /* A new window — a launch — with a bare address carries on with the tab that was in front. */
  const other = await page.context().newPage();
  await other.goto("/");
  await ready(other);
  await expect(tabs(other)).toHaveText(["A", "B", "Idea"]);
  await expect(front(other)).toHaveText("B");
  await expect.poll(() => here(other)).toBe(name("b"));
  await other.close();

  /* In a window already open a bare address is Home, as it always was, beside the tab in front. */
  await page.goto("/");
  await expect(page.locator("[data-dag-welcome]")).toBeVisible({ timeout: 20_000 });
  await expect(tabs(page)).toHaveText(["A", "B", "Home", "Idea"]);
  await expect(front(page)).toHaveText("Home");

  /* A link to a document no tab holds opens it in a new tab beside the one that was in front. */
  await page.goto(`/?board=${name("c")}`);
  await ready(page);
  await expect(tabs(page)).toHaveText(["A", "B", "Home", "C", "Idea"]);
  await expect(front(page)).toHaveText("C");

  /* Not a byte of the vault was written: the folder holds the four files it had, as they were. */
  expect(bytes()).toEqual(before);
});

test("a tab whose file is gone is not restored, and says nothing", async ({ page }) => {
  await open(page);
  await page.waitForTimeout(800);
  fs.rmSync(path.join(BOARDS, folder, "b.board.md"));
  await page.reload();
  await ready(page);
  await expect(tabs(page)).toHaveText(["A", "Idea"]);
  await expect(front(page)).toHaveText("A");
  await expect(page.locator("[data-dag-doctabs-closed]")).toHaveCount(0);
});

test("a tab follows its file through a rename and a move, in front or behind", async ({ page }) => {
  await open(page);
  const moved = await page.request.post("/__board/rename", { data: { name: name("b"), to: `${folder}/sub/b-renamed` } });
  expect(moved.ok()).toBe(true);
  await expect(tab(page, "B")).toHaveCount(1);
  await tab(page, "B").click();
  await expect.poll(() => here(page)).toBe(`${folder}/sub/b-renamed`);
  await expect(page.locator('[data-dag-item="b"]')).toBeVisible({ timeout: 10_000 });

  /* And the tab in front, renamed from outside the page. */
  const again = await page.request.post("/__board/rename", { data: { name: `${folder}/sub/b-renamed`, to: `${folder}/b-back` } });
  expect(again.ok()).toBe(true);
  await expect.poll(() => here(page)).toBe(`${folder}/b-back`);
  await expect(front(page)).toHaveText("B");
});

test("a tab behind whose file goes to the trash closes, and says so with a way to the trash", async ({ page }) => {
  await open(page);
  const gone = await page.request.post("/__board/delete", { data: { name: name("idea"), kind: "note" } });
  expect(gone.ok()).toBe(true);
  const said = page.locator('[data-dag-doctabs-closed="trash"]');
  await expect(said).toBeVisible({ timeout: 10_000 });
  await expect(said).toContainText("Idea was closed: it was moved to the trash.");
  await expect(tabs(page)).toHaveText(["A", "B"]);
  await expect(front(page)).toHaveText("A");

  await page.locator("[data-dag-doctabs-closed-trash]").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("trash")).toBe("1");
});
