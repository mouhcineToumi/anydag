import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { vaultKey } from "./vault";
import { clickOnHover } from "./hover";

/**
 * The sidebar: the files as a tree, the account, and the way to the settings.
 *
 * **The rest of the suite runs with it put away** — `global-setup.ts` seeds `dag:sidebar=0` — so
 * these are the checks that clear that key and see what a person sees: a column open by default,
 * which puts itself away in one key and stays away.
 *
 * Each test owns a folder of its own, because the suite runs eight wide over one `boards/`.
 */

const BOARD = (title: string) => `---\ntitle: ${title}\n---\n\n\`\`\`md {#a x=0 y=0 w=320}\nhi\n\`\`\`\n`;

let id = "";
let folder = "";
const board = () => `${folder}/inner/plan`;
const other = () => `${folder}/other`;
const note = () => `${folder}/idea`;

test.beforeEach(({}, info) => {
  id = info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "");
  folder = `e2e-sb-${id}`;
  fs.mkdirSync(path.join(BOARDS, folder, "inner"), { recursive: true });
  fs.writeFileSync(path.join(BOARDS, `${board()}.board.md`), BOARD("Plan"));
  fs.writeFileSync(path.join(BOARDS, `${other()}.board.md`), BOARD("Other"));
  fs.writeFileSync(path.join(BOARDS, `${note()}.note.md`), "# Idea\n\nA paragraph.\n");
});
test.afterEach(() => {
  fs.rmSync(path.join(BOARDS, folder), { recursive: true, force: true });
});

const sidebar = (page: Page) => page.locator("[data-dag-sidebar]");
const toggle = (page: Page) => page.locator("[data-dag-sidebar-toggle]");
const docked = (page: Page) => page.locator('[data-dag-sidebar][data-mode="docked"]');
const fileRow = (page: Page, name: string) => page.locator(`[data-dag-sidebar-file="${name}"]`);
const folderRow = (page: Page, name: string) => page.locator(`[data-dag-sidebar-folder="${name}"]`);

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/*
 * The suite's own session, less the one key `global-setup.ts` seeds to put the sidebar away — so a
 * check here starts as a person would, in **one navigation**. It used to be a load, an edit and a
 * reload, and a reload under the Vite dev server with the suite running wide is what crashes the
 * Chromium renderer: 7 to 10 of these fourteen died with "Target crashed" at four workers or more,
 * and none at one. Read lazily, because the file only exists once `global-setup.ts` has run.
 */
test.use({
  storageState: async ({}, use) => {
    const seeded = JSON.parse(fs.readFileSync(path.resolve("e2e/.auth/state.json"), "utf8"));
    for (const o of seeded.origins) o.localStorage = o.localStorage.filter((e: { name: string }) => e.name !== "dag:sidebar");
    await use(seeded);
  },
});

/** Open a board as a person would find it: with no remembered choice about the sidebar. */
async function fresh(page: Page, url = `/?board=${board()}`): Promise<void> {
  await page.goto(url);
  if (url.includes("board=")) await ready(page);
}

test("it is open by default, and one key puts it away and remembers", { tag: "@smoke" }, async ({ page }) => {
  await fresh(page);
  await expect(docked(page)).toBeVisible();
  /* The mark is in the sidebar's header while it is docked, and never in two places. */
  await expect(page.locator("[data-dag-sidebar] .dag-sidebar__logo")).toHaveCount(1);
  await expect(page.locator(".dag-toolbar .dag-toolbar__logo")).toHaveCount(0);

  await page.keyboard.press("Control+Backslash");
  await expect(sidebar(page)).toHaveCount(0);
  await expect(toggle(page)).toBeVisible();
  await expect(page.locator(".dag-toolbar .dag-toolbar__logo")).toHaveCount(1);

  await page.reload();
  await ready(page);
  await expect(sidebar(page)).toHaveCount(0);

  await page.keyboard.press("Control+Backslash");
  await expect(docked(page)).toBeVisible();
  await toggle(page).click();
  await expect(sidebar(page)).toHaveCount(0);
});

test("the toggle and the mark stay where they are, docked, away and peeking", async ({ page }) => {
  /* The toggle used to be two buttons taking turns — the header's at the column's right edge, the
     toolbar's at the window's left one — so it jumped 200px every time it was pressed, and a peek
     drew a third. It is one button now, in the corner, and this holds it there. */
  await fresh(page);
  await expect(docked(page)).toBeVisible();
  const box = async () => {
    const b = (await toggle(page).boundingBox())!;
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const mark = async () => Math.round((await page.locator(".dag-lockup .dag-logo").boundingBox())!.x);
  const docked0 = await box();
  const mark0 = await mark();
  /* In the top-left corner, where Claude.ai's is, and in the slot the header keeps for it. */
  expect(docked0.x).toBeLessThan(40);
  expect(docked0.y).toBeLessThan(20);
  const slot = (await page.locator("[data-dag-sidebar] .dag-sidebar-toggle-slot").boundingBox())!;
  expect(Math.round(slot.x)).toBe(docked0.x);

  /* A press leaves the focus on the board, where the canvas's keys are: on the button, the `space`
     that opens a chord would press it again. */
  await page.locator(".dag-viewport").focus();
  await toggle(page).click();
  await expect(sidebar(page)).toHaveCount(0);
  expect(await box()).toEqual(docked0);
  expect(await mark()).toBe(mark0);
  await expect(page.locator(".dag-viewport")).toBeFocused();
  await expect(toggle(page)).toHaveAttribute("aria-label", "Show the sidebar");

  /* Peeking, it is still the one toggle, at the same place: the floating column has no header,
     and so no second button to keep it open. */
  await page.mouse.move(600, 500);
  await toggle(page).hover();
  await expect(page.locator('[data-dag-sidebar][data-mode="overlay"]')).toBeVisible();
  expect(await box()).toEqual(docked0);
  await expect(page.locator('[data-dag-sidebar] button[aria-label*="sidebar" i]')).toHaveCount(0);
  await expect(page.locator(".dag-sidebar__head")).toHaveCount(0);
  await expect(toggle(page)).toHaveCount(1);

  /* And Enter on it docks the column and puts it away again, without moving it or losing the focus
     — the header's button used to unmount under the key that pressed it, dropping it on `<body>`. */
  await toggle(page).focus();
  await page.keyboard.press("Enter");
  await expect(docked(page)).toBeVisible();
  expect(await box()).toEqual(docked0);
  await expect(toggle(page)).toBeFocused();
  await expect(toggle(page)).toHaveAttribute("aria-label", "Hide the sidebar");
  await page.keyboard.press("Enter");
  await expect(sidebar(page)).toHaveCount(0);
  await expect(toggle(page)).toBeFocused();
});

test("what is open is marked, and the folders above it are opened to show it", async ({ page }) => {
  await fresh(page);
  await expect(fileRow(page, board())).toHaveAttribute("aria-current", "page");
  await expect(folderRow(page, folder)).toHaveAttribute("aria-expanded", "true");
  await expect(folderRow(page, `${folder}/inner`)).toHaveAttribute("aria-expanded", "true");
  /* The breadcrumb names the same two folders, and the title rather than the file name. */
  await expect(page.locator(`[data-dag-crumb="${folder}/inner"]`)).toHaveText("inner");
  await expect(page.locator("[data-dag-open-boards]")).toContainText("Plan");
});

test("a folder opens and shuts, and the tree walks on the keyboard", async ({ page }) => {
  await fresh(page);
  const inner = folderRow(page, `${folder}/inner`);
  await inner.click();
  await expect(inner).toHaveAttribute("aria-expanded", "false");
  await expect(fileRow(page, board())).toHaveCount(0);

  /* → opens a shut folder, a second → steps into it, ← from a file goes to its folder, and ← on
     an open folder shuts it. The WAI tree pattern, over real buttons. */
  await inner.focus();
  await page.keyboard.press("ArrowRight");
  await expect(inner).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowRight");
  await expect(fileRow(page, board())).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(inner).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(inner).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowDown");
  await expect(fileRow(page, note())).toBeFocused();

  /* Which folders are open is remembered in this browser. */
  await page.reload();
  await ready(page);
  await expect(folderRow(page, `${folder}/inner`)).toHaveAttribute("aria-expanded", "true");
});

test("opening a board or a note keeps the sidebar exactly where it was", async ({ page }) => {
  await fresh(page);
  /* A mark on the element itself. If opening a file rebuilt the column, this would be gone. */
  await sidebar(page).evaluate((el) => el.setAttribute("data-e2e-kept", ""));

  await fileRow(page, other()).click();
  await expect(page).toHaveURL(new RegExp(`board=${encodeURIComponent(other()).replace(/%2F/g, "(%2F|/)")}`));
  await ready(page);
  await expect(fileRow(page, other())).toHaveAttribute("aria-current", "page");

  await fileRow(page, note()).click();
  await expect(page.locator("[data-dag-note-view]")).toBeVisible();
  await expect(fileRow(page, note())).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-e2e-kept]")).toHaveCount(1);
});

test("put away, a hover on its toggle slides it over the page without taking any canvas", async ({ page }) => {
  await fresh(page);
  await page.keyboard.press("Control+Backslash");
  await expect(sidebar(page)).toHaveCount(0);
  const before = await page.locator(".dag-viewport").boundingBox();

  await toggle(page).hover();
  await expect(page.locator('[data-dag-sidebar][data-mode="overlay"]')).toBeVisible();
  expect(await page.locator(".dag-viewport").boundingBox()).toEqual(before);

  /* Leaving it lets it go, after a grace long enough for a diagonal exit not to flicker. */
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await expect(sidebar(page)).toHaveCount(0);
});

test("while it peeks, the toggle is still there to press, and pressing it keeps the sidebar", async ({ page }) => {
  /* The peek once slid in over the very toggle that summoned it, so a click meant to dock it landed
     on the sidebar's own logo. It floats below the toolbar now, which this holds. */
  await fresh(page);
  await page.keyboard.press("Control+Backslash");
  await toggle(page).hover();
  await expect(page.locator('[data-dag-sidebar][data-mode="overlay"]')).toBeVisible();
  await toggle(page).click({ timeout: 2_000 });
  await expect(docked(page)).toBeVisible();
});

test("the drawing does not move when the column opens or closes", async ({ page }) => {
  await fresh(page);
  const viewport = page.locator(".dag-viewport");
  const pct = page.locator("[data-dag-zoom-actual]");
  const item = page.locator('[data-dag-item="a"]');
  const x = async () => Math.round((await item.boundingBox())!.x);
  const close = async () => {
    await page.keyboard.press("Control+Backslash");
    await expect(sidebar(page)).toHaveCount(0);
  };
  const reopen = async () => {
    await page.keyboard.press("Control+Backslash");
    await expect(docked(page)).toBeVisible();
  };

  /*
   * Take the view over with `0`: a view nobody has touched is refitted on a resize, as it always
   * was, and `0` is a choice like the zoom bar's 100% — the ResizeObserver a sidebar toggle fires
   * must leave both the zoom and the drawing where it put them. `data-zoom` alone would miss a
   * refit that kept the zoom and moved the paper; the item's place on the glass and the zoom bar's
   * own readout are read as well.
   */
  await viewport.focus();
  await page.keyboard.press("0");
  await expect(viewport).toHaveAttribute("data-zoom", "1");
  await expect(pct).toHaveText("100%");
  const x0 = await x();

  await close();
  await expect.poll(x).toBe(x0);
  await expect(viewport).toHaveAttribute("data-zoom", "1");
  await expect(pct).toHaveText("100%");

  await reopen();
  await expect.poll(x).toBe(x0);
  await expect(viewport).toHaveAttribute("data-zoom", "1");
  await expect(pct).toHaveText("100%");

  /* The button is the same choice from the same place: `f` hands the view back to the fit, then
     the zoom bar's 100% claims it exactly as the key did. */
  await viewport.focus();
  await page.keyboard.press("f");
  await pct.click();
  await expect(viewport).toHaveAttribute("data-zoom", "1");
  await expect(pct).toHaveText("100%");

  await close();
  await expect.poll(x).toBe(x0);
  await expect(viewport).toHaveAttribute("data-zoom", "1");
  await expect(pct).toHaveText("100%");

  await reopen();
  await expect.poll(x).toBe(x0);
  await expect(viewport).toHaveAttribute("data-zoom", "1");
  await expect(pct).toHaveText("100%");
});

test("a laptop window keeps it docked, narrower, and a phone's is a sheet over the whole window", async ({ page }) => {
  /* The report's own window: 929px wide, where it used to be impossible to keep open. */
  await page.setViewportSize({ width: 929, height: 800 });
  await fresh(page);
  await expect(docked(page)).toBeVisible();
  expect(Math.round((await sidebar(page).boundingBox())!.width)).toBe(232);

  /* A phone: never docked, whatever the preference says — the board open takes the window. */
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(sidebar(page)).toHaveCount(0);
  await toggle(page).click();
  const sheet = page.locator("[data-dag-sidebar][data-sheet]");
  await expect(sheet).toBeVisible();
  expect(Math.round((await sheet.boundingBox())!.width)).toBe(390);
  /* It stays until it is answered — here by its own close button, as it covers the toggle. */
  await page.waitForTimeout(400);
  await expect(sidebar(page)).toHaveCount(1);
  await page.locator("[data-dag-sidebar-close]").click();
  await expect(sidebar(page)).toHaveCount(0);
});

test("on a phone with nothing open, the sidebar is the home screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await fresh(page, "/");
  await expect(page.locator("[data-dag-sidebar][data-sheet]")).toBeVisible();
  /* Opening anything puts it away, and the page has the window. */
  await page.locator("[data-dag-sidebar-tasks]").click();
  await expect(sidebar(page)).toHaveCount(0);
  await expect(page).toHaveURL(/tasks=1/);
});

test("a folder in the breadcrumb is shown in the sidebar", async ({ page }) => {
  await fresh(page);
  await page.keyboard.press("Control+Backslash");
  await folderRow(page, `${folder}/inner`).count();
  await page.locator(`[data-dag-crumb="${folder}"]`).click();
  await expect(page.locator('[data-dag-sidebar][data-mode="overlay"]')).toBeVisible();
  await expect(folderRow(page, folder)).toBeFocused();
});

test("Settings is reached from a note, which had no way to", async ({ page }) => {
  await fresh(page, `/?note=${note()}`);
  await expect(page.locator("[data-dag-note-view]")).toBeVisible();
  await page.locator("[data-dag-settings-toggle]").click();
  await expect(page.locator("[data-dag-settings]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-settings]")).toHaveCount(0);
});

test("its width is dragged, remembered, and put back by a double-click", async ({ page }) => {
  await fresh(page);
  const nav = docked(page);
  const grip = page.locator("[data-dag-sidebar-grip]");
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(328);

  await page.reload();
  await ready(page);
  await expect.poll(async () => Math.round((await docked(page).boundingBox())!.width)).toBe(328);

  await page.locator("[data-dag-sidebar-grip]").dblclick();
  await expect.poll(async () => Math.round((await docked(page).boundingBox())!.width)).toBe(248);
});

test("on a laptop window the grip widens it past the quarter the default keeps to", async ({ page }) => {
  /* The report's window. The default gives way to 232px here; a drag used to change nothing at all. */
  await page.setViewportSize({ width: 926, height: 800 });
  await fresh(page);
  const nav = docked(page);
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(232);
  const box = (await page.locator("[data-dag-sidebar-grip]").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + 200, { steps: 4 });
  /* It follows the pointer while it is held, not only once it is let go. */
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(382);
  /* And stops at half the window, however far the pointer goes. */
  await page.mouse.move(box.x + 700, box.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(463);

  await page.reload();
  await ready(page);
  await expect.poll(async () => Math.round((await docked(page).boundingBox())!.width)).toBe(463);
  await page.locator("[data-dag-sidebar-grip]").dblclick();
  await expect.poll(async () => Math.round((await docked(page).boundingBox())!.width)).toBe(232);
});

test("Settings is one gear at the foot, and opens on the tab this browser had open last", async ({ page }) => {
  await fresh(page);
  const gear = page.locator("[data-dag-settings-toggle]");
  await expect(gear).toHaveCount(1);
  await gear.click();
  await page.locator('[data-dag-settings-tab-button="shortcuts"]').click();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-settings]")).toHaveCount(0);
  await gear.click();
  await expect(page.locator('[data-dag-settings-pane="shortcuts"]')).toBeVisible();
});

test("a favourite is kept above the files, opens, follows a rename, and comes out again", async ({ page }) => {
  await fresh(page);
  const more = async (name: string, item: string) => {
    await clickOnHover(page, `[data-dag-sidebar-file="${name}"]`, `[data-dag-sidebar-more="${name}"]`);
    await page.locator(`[data-dag-sidebar-menu-item="${item}"]`).click();
  };
  await more(other(), "favourite");
  const fav = (name: string) => page.locator(`[data-dag-sidebar-favourite="${name}"]`);
  await expect(fav(other())).toBeVisible();
  /* It is the account's, so it is written where preferences are. */
  const favourites = await vaultKey(page, "dag:favourites");
  expect(await page.evaluate((k) => localStorage.getItem(k), favourites)).toContain(`board:${other()}`);

  await fav(other()).click();
  await expect(page).toHaveURL(/board=/);
  await ready(page);
  await expect(fav(other())).toHaveAttribute("aria-current", "page");

  /* A rename made here carries it along; the name is the identity, so it has to be told. */
  await more(other(), "rename");
  await page.locator("[data-dag-sidebar-name]").fill("other-renamed");
  await page.keyboard.press("Enter");
  await expect(fav(`${folder}/other-renamed`)).toBeVisible();
  await expect(fav(other())).toHaveCount(0);

  await more(`${folder}/other-renamed`, "unfavourite");
  await expect(page.locator("[data-dag-sidebar-favourite]")).toHaveCount(0);
});

test("a file is called its title — Untitled until somebody names it — and its name follows out of sight", async ({ page }) => {
  await fresh(page);
  /* A row says what the file is called, and only a file nobody titled says its name. */
  await expect(fileRow(page, board())).toHaveText("Plan");
  await expect(fileRow(page, other())).toHaveText("Other");
  await expect(fileRow(page, note())).toHaveText("idea");

  /* Made in a folder, it is called Untitled: the box that asks — in the top bar, where the title is
     drawn — holds the title, never `untitled`. */
  await clickOnHover(page, `[data-dag-sidebar-folder="${folder}"]`, `[data-dag-sidebar-add="${folder}"]`);
  await page.locator('[data-dag-sidebar-menu-item="new-board"]').click();
  const asked = page.locator("[data-dag-toolbar-name]");
  await expect(asked).toBeFocused();
  await expect(asked).toHaveValue("Untitled");
  await expect.poll(() => new URL(page.url()).searchParams.get("board"), { timeout: 10_000 }).toBe(`${folder}/Untitled`);
  await asked.press("Escape");
  const box = page.locator("[data-dag-sidebar-name]");
  await expect(fileRow(page, `${folder}/Untitled`)).toHaveText("Untitled");
  /* The name says the title, so the file does not say it twice. */
  expect(fs.readFileSync(path.join(BOARDS, folder, "Untitled.board.md"), "utf8")).not.toMatch(/^title:/m);
  await expect(page.locator(".dag-toolbar__title")).toHaveText("Untitled");

  /* Named, the title is what changes — and the file's name follows it, so what an agent and a URL
     read still says roughly the same thing. The row, the toolbar and the open board all follow. */
  await clickOnHover(page, `[data-dag-sidebar-file="${folder}/Untitled"]`, `[data-dag-sidebar-more="${folder}/Untitled"]`);
  await page.locator('[data-dag-sidebar-menu-item="rename"]').click();
  await expect(box).toHaveValue("Untitled");
  await box.fill("Q3: the plan");
  await box.press("Enter");
  const named = `${folder}/Q3 the plan`; // the colon is not a file-name character; the title keeps it
  await expect.poll(() => new URL(page.url()).searchParams.get("board"), { timeout: 10_000 }).toBe(named);
  await expect(fileRow(page, named)).toHaveText("Q3: the plan");
  expect(fs.existsSync(path.join(BOARDS, folder, "Untitled.board.md"))).toBe(false);
  expect(fs.readFileSync(path.join(BOARDS, `${named}.board.md`), "utf8")).toMatch(
    /^---\ntitle: "Q3: the plan"\n(id: [0-9a-z]{10}\n)?---\n/,
  );
  await expect(page.locator(".dag-toolbar__title")).toHaveText("Q3: the plan");
  /* Rows go by what they say: idea, Other, then the plan — not by the names under them. */
  const titles = await page
    .locator(`[data-dag-sidebar-file^="${folder}/"]:not([data-dag-sidebar-file^="${folder}/inner/"]) .dag-sidebar__name`)
    .allTextContents();
  expect(titles).toEqual(["idea", "Other", "Q3: the plan"]);
});

test("a snapshot draws no sidebar and no shell around the page", async ({ page }) => {
  await page.goto(`/?board=${board()}`);
  await page.evaluate(() => localStorage.removeItem("dag:sidebar"));
  await page.goto(`/?board=${board()}&snapshot=1`);
  await ready(page);
  await expect(page.locator("[data-dag-sidebar]")).toHaveCount(0);
  await expect(page.locator(".dag-shell")).toHaveCount(0);
});

test("a list not heard yet is said to be loading, and the next page draws the one this browser kept", async ({
  page,
  context,
}) => {
  /* The listing held back, as one of nine hundred notes on the document store was: the column says
     it is on its way, never that the account is empty. */
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/__board/list*", async (route) => {
    await held;
    await route.continue();
  });
  await fresh(page);
  await expect(page.locator("[data-dag-sidebar-loading]")).toHaveText("Loading your files…");
  await expect(page.getByText("Nothing here yet")).toHaveCount(0);
  release();
  await expect(folderRow(page, folder)).toBeVisible();
  await expect(page.locator("[data-dag-sidebar-loading]")).toHaveCount(0);
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Object.keys(localStorage)
            .filter((k) => k === "dag:file-list" || k.startsWith("dag:file-list@"))
            .map((k) => localStorage.getItem(k))
            .join(""),
        ),
      { timeout: 5_000 },
    )
    .toContain(folder);

  /* A second page in this browser draws what the first one kept, while its own listing is held. */
  const later = await context.newPage();
  let again!: () => void;
  const stillHeld = new Promise<void>((r) => (again = r));
  await later.route("**/__board/list*", async (route) => {
    await stillHeld;
    await route.continue();
  });
  await later.goto(`/?board=${board()}`);
  await expect(folderRow(later, folder)).toBeVisible();
  await expect(later.locator("[data-dag-sidebar-loading]")).toHaveCount(0);
  again();
  await later.close();
});
