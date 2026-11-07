import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { vaultKey } from "./vault";
import { clickOnHover } from "./hover";
import { openSidebar } from "./sidebar";

/**
 * Folders in the sidebar: made, named, filled, emptied, renamed and moved.
 *
 * A folder is a **directory**, and a board's name carries the one it is in — `reference/erd` is the
 * board in `reference/`. So moving a board between folders is a rename, and what a name cannot
 * express is a folder with nothing in it yet (`/mkdir`, `/rmdir`) and a folder moving with
 * everything in it (`/mvdir`, which is new). These lived in the search dialog until the sidebar
 * took the file operations; the search is a search now.
 *
 * Every check reads the filesystem, because that is what a folder is here. Each test owns one
 * parent folder and works inside it: the suite runs in parallel over one `boards/`, and keeping a
 * test's rows side by side is what makes a drag two nearby points rather than a scroll.
 */

const DIR = BOARDS;
const BOARD = "---\ntitle: Filed\n---\n\n```md {#a x=0 y=0}\nhi\n```\n";

let id = "";
let parent = "";
let loose = "";
test.beforeEach(({}, info) => {
  id = info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "");
  parent = `e2e-folder-${id}`;
  loose = `e2e-filed-${id}`;
  fs.mkdirSync(path.join(DIR, parent, "b"), { recursive: true });
  fs.writeFileSync(path.join(DIR, parent, "plan.board.md"), BOARD);
  /* An asset beside it: a move that left `x.assets/` behind would break every `image` fence in the
     file it had just moved, so the routes carry it and this is what proves they still do. */
  fs.mkdirSync(path.join(DIR, parent, "plan.assets"), { recursive: true });
  fs.writeFileSync(path.join(DIR, parent, "plan.assets", "shot.txt"), "asset");
});
test.afterEach(() => {
  for (const p of [parent, `${loose}.board.md`, `${loose}.assets`])
    fs.rmSync(path.join(DIR, p), { recursive: true, force: true });
});

const at = (...p: string[]) => path.join(DIR, ...p);
const there = (...p: string[]) => fs.existsSync(at(...p));
const folderRow = (name: string) => `[data-dag-sidebar-folder="${name}"]`;
const fileRow = (name: string) => `[data-dag-sidebar-file="${name}"]`;

async function open(page: Page, board = `${parent}/plan`): Promise<void> {
  await page.goto(`/?board=${board}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await openSidebar(page);
}

/** A row's `⋯`, then one item of its menu. The tools are there on hover and focus alone. */
async function menu(page: Page, row: string, more: string, item: string): Promise<void> {
  await clickOnHover(page, row, `[data-dag-sidebar-more="${more}"]`);
  await page.locator(`[data-dag-sidebar-menu-item="${item}"]`).click();
}

/**
 * Drag one row onto another.
 *
 * **Aimed again until the target is marked**, because the rows move under the pointer: eight
 * workers make and delete their own folders at the top of this same list all the time, and one
 * appearing above ours shifts every row down by one while the drag is in the air. A drop that
 * missed would land on whatever row slid into the target's place. `CLAUDE.md` records the same
 * hazard for the search's hover controls; this is it for a drag.
 */
async function drag(page: Page, from: string, onto: string): Promise<void> {
  await page.locator(from).scrollIntoViewIfNeeded();
  const a = (await page.locator(from).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  /* Past the slop, so the press is a drag before it is anywhere near the target. */
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 3 });
  await expect(async () => {
    const b = (await page.locator(onto).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await expect(page.locator(`${onto}[data-dag-sidebar-over]`)).toHaveCount(1, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await page.mouse.up();
}

test("a new folder is made first and named where it is drawn, and an empty one still shows", async ({ page }) => {
  await open(page);
  await clickOnHover(page, folderRow(parent), `[data-dag-sidebar-add="${parent}"]`);
  await page.locator('[data-dag-sidebar-menu-item="new-folder"]').click();
  /* Made as `Untitled` straight away — `/mkdir` numbers nothing, so the sidebar found the name —
     and the box it is named in arrives with that name selected. */
  await expect.poll(() => there(parent, "Untitled"), { timeout: 5_000 }).toBe(true);
  const box = page.locator("[data-dag-sidebar-name]");
  await expect(box).toBeFocused();
  await box.fill("made");
  await box.press("Enter");
  await expect.poll(() => there(parent, "made"), { timeout: 5_000 }).toBe(true);
  expect(there(parent, "Untitled")).toBe(false);

  const made = page.locator(folderRow(`${parent}/made`));
  await expect(made).toHaveCount(1);
  if ((await made.getAttribute("aria-expanded")) !== "true") await made.click();
  await expect(made.locator("xpath=..").locator(".dag-sidebar__empty")).toHaveText("Empty");
});

test("dragging a board onto a folder moves the file and its assets, and the open board follows", async ({ page }) => {
  await open(page);
  await drag(page, fileRow(`${parent}/plan`), folderRow(`${parent}/b`));

  await expect.poll(() => there(parent, "b", "plan.board.md"), { timeout: 5_000 }).toBe(true);
  expect(there(parent, "plan.board.md")).toBe(false);
  expect(there(parent, "b", "plan.assets", "shot.txt")).toBe(true);
  await expect.poll(() => new URL(page.url()).searchParams.get("board")).toBe(`${parent}/b/plan`);
});

test("the move menu files a board, and takes it out to the top level", async ({ page }) => {
  await open(page);
  await menu(page, fileRow(`${parent}/plan`), `${parent}/plan`, "move");
  await page.locator("[data-dag-sidebar-move-to]").selectOption(`${parent}/b`);
  await expect.poll(() => there(parent, "b", "plan.board.md"), { timeout: 5_000 }).toBe(true);

  /* To the top level under a name of its own, so the suite's other workers are not collided with. */
  fs.renameSync(at(parent, "b", "plan.board.md"), at(parent, "b", `${loose}.board.md`));
  await expect(page.locator(fileRow(`${parent}/b/${loose}`))).toHaveCount(1);
  await menu(page, fileRow(`${parent}/b/${loose}`), `${parent}/b/${loose}`, "move");
  /* `""` is the top level, which is why the drop attribute is read as `=== undefined` everywhere. */
  await page.locator("[data-dag-sidebar-move-to]").selectOption("");
  await expect.poll(() => there(`${loose}.board.md`), { timeout: 5_000 }).toBe(true);
  expect(there(parent, "b", `${loose}.board.md`)).toBe(false);
});

test("a board moved to the folder it is already in is left alone", async ({ page }) => {
  /*
   * `uniqueBoard` numbers any stem whose file exists, and the file that exists is this board's own
   * — so before the route learned to check, renaming `plan` to `plan` moved it to `plan-2`. Neither
   * gesture sends that call now: choosing the folder it is in from the menu writes nothing, and its
   * own folder is not a drop target at all.
   */
  fs.renameSync(at(parent, "plan.board.md"), at(parent, "b", "plan.board.md"));
  fs.renameSync(at(parent, "plan.assets"), at(parent, "b", "plan.assets"));
  const moved = `${parent}/b/plan`;
  await open(page, moved);
  await menu(page, fileRow(moved), moved, "move");
  await page.locator("[data-dag-sidebar-move-to]").selectOption(`${parent}/b`);

  await page.locator(fileRow(moved)).scrollIntoViewIfNeeded();
  const a = (await page.locator(fileRow(moved)).boundingBox())!;
  const b = (await page.locator(folderRow(`${parent}/b`)).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await expect(page.locator("[data-dag-sidebar-over]")).toHaveCount(0);
  await page.mouse.up();

  await page.waitForTimeout(800);
  expect(there(parent, "b", "plan.board.md")).toBe(true);
  expect(there(parent, "b", "plan-2.board.md")).toBe(false);
});

test("a folder goes to the trash at once, empty or full, and the notice says what went", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  const notice = page.locator("[data-dag-trash-notice]");
  /* `b` is empty: nothing is asked, in the row or anywhere. */
  await menu(page, folderRow(`${parent}/b`), `${parent}/b`, "delete");
  await expect.poll(() => there(parent, "b"), { timeout: 5_000 }).toBe(false);
  await expect(notice).toContainText("Moved the folder “b” to the trash.");

  /* The parent holds a board, and goes the same way: it used to ask in a modal that counted
     what went with it, because nothing could bring any of it back. */
  await menu(page, folderRow(parent), parent, "delete");
  await expect.poll(() => there(parent), { timeout: 5_000 }).toBe(false);
  await expect(notice).toContainText(`Moved the folder “${parent}” and the file in it to the trash.`);
  await expect(page.locator("[data-dag-sidebar-dialog]")).toHaveCount(0);
});

test("Undo puts a folder back with everything in it, and opens the board that was open", async ({ page }) => {
  fs.mkdirSync(at(parent, "sub"), { recursive: true });
  fs.writeFileSync(at(parent, "sub", "deep.board.md"), BOARD);
  fs.writeFileSync(at(parent, "idea.note.md"), "# Idea\n");
  await open(page);

  await menu(page, folderRow(parent), parent, "delete");
  await expect.poll(() => there(parent), { timeout: 5_000 }).toBe(false);
  await expect(page.locator(folderRow(parent))).toHaveCount(0);
  /* The board that was open was in there, and deleting what you are looking at leaves nothing open. */
  await expect(page).not.toHaveURL(/board=/);

  await page.locator("[data-dag-trash-undo]").click();
  /* Everything, as it was: the boards, the note, the empty folder, the images. */
  await expect.poll(() => there(parent, "plan.board.md"), { timeout: 5_000 }).toBe(true);
  expect(there(parent, "sub", "deep.board.md")).toBe(true);
  expect(there(parent, "idea.note.md")).toBe(true);
  expect(there(parent, "b")).toBe(true);
  expect(there(parent, "plan.assets", "shot.txt")).toBe(true);
  await expect(page.locator("[data-dag-trash-notice]")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("board")).toBe(`${parent}/plan`);
});

test("a folder that could not go to the trash says so, keeps everything, and leaves the board open", async ({ page }) => {
  await open(page);
  /* The one answer worse than a question is a failure kept quiet: the person would believe a folder
     was gone that is still there. */
  await page.route("**/__board/rmdir*", (r) =>
    r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }),
  );
  await menu(page, folderRow(parent), parent, "delete");
  await expect(page.locator("[data-dag-sidebar-bulk-problem]")).toContainText(`“${parent}” could not be moved to the trash.`);
  await expect(page.locator("[data-dag-trash-notice]")).toHaveCount(0);
  expect(there(parent, "plan.board.md")).toBe(true);
  await expect(page).toHaveURL(new RegExp(`board=${parent}`));
});

test("a favourite inside a deleted folder goes with it, one outside stays, and Undo brings it back", async ({ page }) => {
  fs.writeFileSync(at(`${loose}.board.md`), BOARD);
  await open(page);
  await menu(page, fileRow(`${parent}/plan`), `${parent}/plan`, "favourite");
  await menu(page, fileRow(loose), loose, "favourite");
  const fav = (name: string) => page.locator(`[data-dag-sidebar-favourite="${name}"]`);
  await expect(fav(`${parent}/plan`)).toBeVisible();
  await expect(fav(loose)).toBeVisible();

  await menu(page, folderRow(parent), parent, "delete");
  await expect.poll(() => there(parent), { timeout: 5_000 }).toBe(false);
  await expect(fav(`${parent}/plan`)).toHaveCount(0);
  await expect(fav(loose)).toBeVisible();
  /* Let go of in the preference too, not only undrawn: a board made later at the same name is a
     stranger, and must not arrive already starred. */
  const favourites = await vaultKey(page, "dag:favourites");
  const kept = await page.evaluate((k) => localStorage.getItem(k) ?? "", favourites);
  expect(kept).not.toContain(`board:${parent}/plan`);
  expect(kept).toContain(`board:${loose}`);

  /* Taken back, it is the same board, and a favourite again. */
  await page.locator("[data-dag-trash-undo]").click();
  await expect(fav(`${parent}/plan`)).toBeVisible();
});

test("a folder is renamed with everything in it, and the open board follows", async ({ page }) => {
  await open(page);
  await menu(page, folderRow(parent), parent, "rename");
  const box = page.locator("[data-dag-sidebar-name]");
  await box.fill(`${parent}-renamed`);
  await box.press("Enter");

  const renamed = `${parent}-renamed`;
  await expect.poll(() => there(renamed, "plan.board.md"), { timeout: 5_000 }).toBe(true);
  expect(there(renamed, "plan.assets", "shot.txt")).toBe(true);
  expect(there(renamed, "b")).toBe(true);
  expect(there(parent)).toBe(false);
  await expect.poll(() => new URL(page.url()).searchParams.get("board")).toBe(`${renamed}/plan`);
  /* Put it back where afterEach looks. */
  fs.renameSync(at(renamed), at(parent));
});

test("a folder's rename says why before Enter when the name is taken", async ({ page }) => {
  fs.mkdirSync(at(parent, "c"), { recursive: true });
  await open(page);
  await menu(page, folderRow(`${parent}/b`), `${parent}/b`, "rename");
  const box = page.locator("[data-dag-sidebar-name]");
  await box.fill("c");
  await expect(page.locator("[data-dag-sidebar-name-why]")).toContainText("already exists");
  await box.press("Enter");
  /* Still asking, and nothing moved. */
  await expect(box).toBeVisible();
  expect(there(parent, "b")).toBe(true);
});

test("a folder dragged onto another moves in whole", async ({ page }) => {
  fs.mkdirSync(at(parent, "c", "inner"), { recursive: true });
  fs.writeFileSync(at(parent, "c", "inner", "deep.board.md"), BOARD);
  await open(page);
  await drag(page, folderRow(`${parent}/c`), folderRow(`${parent}/b`));
  await expect.poll(() => there(parent, "b", "c", "inner", "deep.board.md"), { timeout: 5_000 }).toBe(true);
  expect(there(parent, "c")).toBe(false);
});

/** A point on the page's top bar, right of the sidebar: no drop target, and never a row that moves. */
const LET_GO = { x: 700, y: 20 };

test("a dragged row rides beside the pointer, and the row it came from fades until it is let go", async ({ page }) => {
  fs.mkdirSync(at(parent, "c"), { recursive: true });
  fs.writeFileSync(at(parent, "c", "deep.board.md"), BOARD);
  await open(page);
  const from = page.locator(folderRow(`${parent}/c`));
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 6, { steps: 3 });
  const ghost = page.locator("[data-dag-sidebar-ghost]");
  await expect(ghost).toHaveText("c");
  await expect(page.locator(`${folderRow(`${parent}/c`)}[data-dag-sidebar-lifted]`)).toHaveCount(1);
  /* It follows the pointer, a move for a move. */
  const before = (await ghost.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2 + 52, a.y + a.height / 2 + 6, { steps: 3 });
  const after = (await ghost.boundingBox())!;
  expect(Math.round(after.x - before.x)).toBe(40);
  /* Let go over the top bar, which is nowhere to go — and is still there when the rows around it have
     moved, as they do with the suite's other workers making folders in this tree: nothing moves, and
     the chip and the fade go. */
  await page.mouse.move(LET_GO.x, LET_GO.y, { steps: 3 });
  await expect(page.locator("[data-dag-sidebar-over]")).toHaveCount(0);
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  await expect(page.locator("[data-dag-sidebar-lifted]")).toHaveCount(0);
  expect(there(parent, "c", "deep.board.md")).toBe(true);
});

test("a row held at the bottom of the tree scrolls it, and at the top scrolls it back", async ({ page }) => {
  /* Forty rows under `b`, so there is a tree's height to scroll below it whatever else is listed. */
  for (let i = 0; i < 40; i++) fs.writeFileSync(at(parent, "b", `n${String(i).padStart(2, "0")}.board.md`), BOARD);
  await open(page);
  const b = page.locator(folderRow(`${parent}/b`));
  await b.scrollIntoViewIfNeeded();
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  await expect(page.locator(fileRow(`${parent}/b/n39`))).toHaveCount(1);
  /* In the middle, never at an edge: an edge is where holding it scrolls. */
  await b.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const tree = page.locator(".dag-sidebar__tree");
  const box = (await tree.boundingBox())!;
  const a = (await b.boundingBox())!;
  const start = await tree.evaluate((el) => el.scrollTop);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 12, { steps: 3 });
  await page.mouse.move(a.x + a.width / 2, box.y + box.height - 6, { steps: 6 });
  await expect.poll(() => tree.evaluate((el) => el.scrollTop), { timeout: 5_000 }).toBeGreaterThan(start + 100);
  const peak = await tree.evaluate((el) => el.scrollTop);
  await page.mouse.move(a.x + a.width / 2, box.y + 6, { steps: 6 });
  await expect.poll(() => tree.evaluate((el) => el.scrollTop), { timeout: 5_000 }).toBeLessThan(peak - 100);
  /* Let go over the top bar, which is nowhere to go — and the tree, which the pointer passed over as
     the top level's target on the way, is not left outlined: every clearing of the marks used to miss
     the tree itself. */
  await page.mouse.move(LET_GO.x, LET_GO.y, { steps: 3 });
  await expect(page.locator("[data-dag-sidebar-over]")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator("[data-dag-sidebar-over]")).toHaveCount(0);
  expect(there(parent, "b", "n00.board.md")).toBe(true);
});

test("a folder move the server refuses says why under the tree, and nothing moves", async ({ page }) => {
  fs.mkdirSync(at(parent, "c"), { recursive: true });
  fs.writeFileSync(at(parent, "c", "deep.board.md"), BOARD);
  /* A refusal, in the words the store gives for a folder too heavy for one commit — stubbed:
     what is under test is that the page says the server's sentence, whatever it is. */
  const why = `${parent}/c is too big to move in one go: 9.1 MB across 1200 files, and a move carries at most 8 MB. Move some of its subfolders first.`;
  await page.route("**/__board/mvdir*", (route) =>
    route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: why }) }),
  );
  await open(page);
  await drag(page, folderRow(`${parent}/c`), folderRow(`${parent}/b`));
  await expect(page.locator("[data-dag-sidebar-bulk-problem]")).toHaveText(why);
  expect(there(parent, "c", "deep.board.md")).toBe(true);
  await expect(page.locator(folderRow(`${parent}/c`))).toHaveCount(1);
});

/*
 * A selection: ctrl or ⌘ picks a row, shift a run of them, and the bar under the tree, a
 * picked row's menu or a drag acts on all of them. Every check reads the filesystem, as above.
 */
const picked = (page: Page) => page.locator("[data-dag-sidebar-picked]");
const bar = (page: Page) => page.locator("[data-dag-sidebar-bulk]");

function more(): void {
  fs.writeFileSync(at(parent, "idea.note.md"), "---\ntitle: Idea\n---\nText.\n");
  fs.mkdirSync(at(parent, "c"), { recursive: true });
  fs.writeFileSync(at(parent, "c", "deep.board.md"), BOARD);
}

test("ctrl and shift pick rows, and the bar moves them into a folder together", async ({ page }) => {
  more();
  await open(page);
  await expect(page.locator(fileRow(`${parent}/idea`))).toBeVisible();
  const mod = process.platform === "darwin" ? "Meta" : "Control";

  /* Two picked, one at a time; picking one again lets it go; a modified click opens nothing. */
  await page.locator(fileRow(`${parent}/plan`)).click({ modifiers: [mod] });
  await page.locator(fileRow(`${parent}/idea`)).click({ modifiers: [mod] });
  await expect(picked(page)).toHaveCount(2);
  await expect(bar(page)).toHaveAttribute("data-dag-sidebar-bulk", "2");
  await page.locator(fileRow(`${parent}/idea`)).click({ modifiers: [mod] });
  await expect(picked(page)).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("note")).toBeNull();

  /* Shift runs from the last one picked to this one, in the order the rows are drawn — the folders,
     then the files by title, "Filed" before "Idea" — and replaces what was picked. */
  await page.locator(folderRow(`${parent}/b`)).click({ modifiers: ["Shift"] });
  await expect(picked(page)).toHaveCount(4);
  await expect(page.locator(`${folderRow(`${parent}/c`)}[aria-selected="true"]`)).toHaveCount(1);
  /* Escape lets the selection go. */
  await page.keyboard.press("Escape");
  await expect(picked(page)).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);

  /* A folder and two files, into `b`: the folder with what is in it, the board with its assets, and the open board followed. */
  await page.locator(folderRow(`${parent}/c`)).click({ modifiers: [mod] });
  await page.locator(fileRow(`${parent}/plan`)).click({ modifiers: [mod] });
  await page.locator(fileRow(`${parent}/idea`)).click({ modifiers: [mod] });
  await expect(bar(page)).toHaveAttribute("data-dag-sidebar-bulk", "3");
  await page.locator('[data-dag-sidebar-bulk-act="move"]').click();
  /* A folder that is picked is not somewhere the selection can go. */
  await expect(page.locator(`[data-dag-sidebar-bulk-move-to] option[value="to:${parent}/c"]`)).toHaveCount(0);
  await page.locator("[data-dag-sidebar-bulk-move-to]").selectOption(`to:${parent}/b`);
  await expect.poll(() => there(parent, "b", "c", "deep.board.md"), { timeout: 5_000 }).toBe(true);
  await expect.poll(() => there(parent, "b", "idea.note.md"), { timeout: 5_000 }).toBe(true);
  await expect.poll(() => there(parent, "b", "plan.assets", "shot.txt"), { timeout: 5_000 }).toBe(true);
  expect(there(parent, "plan.board.md")).toBe(false);
  await expect.poll(() => new URL(page.url()).searchParams.get("board")).toBe(`${parent}/b/plan`);
  await expect(bar(page)).toHaveCount(0);
});

test("a selection is dragged onto a folder, and goes to the trash in one delete that one Undo takes back", async ({ page }) => {
  more();
  await open(page);
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.locator(fileRow(`${parent}/idea`)).click({ modifiers: [mod] });
  await page.locator(folderRow(`${parent}/c`)).click({ modifiers: [mod] });
  await drag(page, fileRow(`${parent}/idea`), folderRow(`${parent}/b`));
  await expect.poll(() => there(parent, "b", "idea.note.md"), { timeout: 5_000 }).toBe(true);
  await expect.poll(() => there(parent, "b", "c", "deep.board.md"), { timeout: 5_000 }).toBe(true);

  /* The folder `b` and the open board, from a picked row's menu: into the trash at once. */
  await page.locator(folderRow(`${parent}/b`)).click({ modifiers: [mod] });
  await page.locator(fileRow(`${parent}/plan`)).click({ modifiers: [mod] });
  await page.locator(fileRow(`${parent}/plan`)).click({ button: "right" });
  await page.locator('[data-dag-sidebar-bulk-item="delete"]').click();
  await expect.poll(() => there(parent, "b"), { timeout: 5_000 }).toBe(false);
  await expect.poll(() => there(parent, "plan.board.md"), { timeout: 5_000 }).toBe(false);
  await expect(page.locator("[data-dag-trash-notice]")).toContainText("Moved 2 items to the trash.");
  /* The open board was among them, so nothing is open. */
  await expect.poll(() => new URL(page.url()).searchParams.get("board")).toBeNull();

  /* One Undo for the one delete: both come back, and the board that was open opens again. */
  await page.locator("[data-dag-trash-undo]").click();
  await expect.poll(() => there(parent, "b", "idea.note.md"), { timeout: 5_000 }).toBe(true);
  await expect.poll(() => there(parent, "plan.board.md"), { timeout: 5_000 }).toBe(true);
  await expect.poll(() => new URL(page.url()).searchParams.get("board")).toBe(`${parent}/plan`);
});

test("a selection let go on a board places a card for every file in it, in one write", async ({ page }) => {
  fs.writeFileSync(at(parent, "idea.note.md"), "---\ntitle: Idea\n---\nText.\n");
  fs.writeFileSync(at(parent, "memo.note.md"), "---\ntitle: Memo\n---\nText.\n");
  await open(page);
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await expect(page.locator(fileRow(`${parent}/memo`))).toBeVisible();
  await page.locator(fileRow(`${parent}/idea`)).click({ modifiers: [mod] });
  await page.locator(fileRow(`${parent}/memo`)).click({ modifiers: [mod] });
  /* The open board is picked too, and is not placed on itself. */
  await page.locator(fileRow(`${parent}/plan`)).click({ modifiers: [mod] });
  await expect(picked(page)).toHaveCount(3);

  const before = fs.readFileSync(at(parent, "plan.board.md"), "utf8");
  const a = (await page.locator(fileRow(`${parent}/idea`)).boundingBox())!;
  const v = (await page.locator(".dag-viewport").boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2, { steps: 8 });
  await expect(page.locator(".dag-viewport[data-dag-drop-file]")).toHaveCount(1);
  await page.mouse.up();

  const cards = () => (fs.readFileSync(at(parent, "plan.board.md"), "utf8").match(/\]\(dag:[a-z0-9]+\)/g) ?? []).length;
  await expect.poll(cards, { timeout: 5_000 }).toBe(2);
  /* Side by side, and one undo takes both. */
  await expect(page.locator(".dag-item[data-dag-selected]")).toHaveCount(2);
  await expect(page.locator("[data-dag-dock] [data-dag-undo]")).toBeEnabled({ timeout: 5_000 });
  await page.locator("[data-dag-dock] [data-dag-undo]").click();
  await expect.poll(() => fs.readFileSync(at(parent, "plan.board.md"), "utf8")).toBe(before);
});
