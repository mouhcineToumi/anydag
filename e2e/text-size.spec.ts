import fs from "node:fs";
import path from "node:path";
import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";
import { openMore } from "./more";
import { openSettings, openSidebar, settingsTab, type SettingsTab } from "./sidebar";

/**
 * Settings → Appearance → **Text size** (#325).
 *
 * One preference with three steps, and two places it reaches: the app's own words, and a note's
 * reading text. A board is not one of them — its diagram reads `--dag-type-*` and `--dag-metric-*`,
 * and it has its own zoom — so the first check here is as much about what does *not* move as about
 * what does.
 *
 * `?snapshot=1` reads no preference at all, so a picture of a board or a note is the default step
 * however the person last left the app. The last check is the other half of the setting being
 * usable: at *Large* nothing in the sidebar, a menu or Settings may scroll sideways or put a
 * control outside its box. It measures, and leaves screenshots in the test's output directory for
 * reading by eye; the baselines are the Docker image's and none of these is one.
 */

const BOARD = `---
title: Text size scratch
---

\`\`\`md {#words x=0 y=0 w=380}
A paragraph on the board, at the theme's own size.
\`\`\`

\`\`\`arch {#arch x=0 y=260}
service read "Read a line"
\`\`\`
`;

const NOTE = `---
title: Text size note
---

# The plan

The first paragraph.

## A heading

- a list item
`;

let name = "";
let board = "";
let note = "";
test.beforeEach(({}, info) => {
  name = `e2e-text-size-${info.testId}`;
  board = path.join(BOARDS, `${name}.board.md`);
  note = path.join(BOARDS, `${name}.note.md`);
  fs.writeFileSync(board, BOARD);
  fs.writeFileSync(note, NOTE);
});
test.afterEach(() => {
  fs.rmSync(board, { force: true });
  fs.rmSync(note, { force: true });
});

async function openBoard(page: Page): Promise<void> {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  /* The board itself, not only the flag: a fixture written a moment ago can answer a first request
     with the app's "no board" page while the watcher catches up, and the flag is set by that page too. */
  await expect(page.locator('[data-dag-item="words"]')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function openNote(page: Page, extra = ""): Promise<void> {
  await page.goto(`/?note=${name}${extra}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await expect(page.locator(".dag-note-view")).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

/** The size a selector is actually drawn at, in px. Waits for the element and a settled style. */
async function sizeOf(page: Page, selector: string): Promise<number> {
  const locator = page.locator(selector).filter({ visible: true }).first();
  await expect(locator, `${selector} is not drawn`).toBeVisible();
  let size = Number.NaN;
  await expect
    .poll(
      async () => {
        const raw = await locator.evaluate((el) => getComputedStyle(el).fontSize);
        size = Number.parseFloat(raw);
        return size;
      },
      { message: `${selector} has no font size yet` },
    )
    .not.toBeNaN();
  return size;
}

/** The step the page was opened at, as `src/ui/textSize.ts` put it on `<html>`. */
const stepOf = (page: Page): Promise<string> =>
  page
    .locator("html")
    .getAttribute("data-dag-text-size")
    .then((v) => v ?? "");

async function choose(page: Page, size: "small" | "default" | "large"): Promise<void> {
  await openSettings(page, "appearance");
  await page.locator("[data-dag-setting-text-size]").selectOption(size);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-settings]")).toHaveCount(0);
}

/** True when nothing inside `locator` is drawn wider than the box it is in. */
const fits = (locator: ReturnType<Page["locator"]>): Promise<boolean> =>
  locator.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);

test("the three steps change the chrome, and nothing a board draws", async ({ page }) => {
  await openBoard(page);
  await openSidebar(page);

  /* The default: the theme's `ui.text.md` on the column and the bar, and the theme's own ramp on
     everything the board draws. */
  expect(await stepOf(page)).toBe("default");
  expect(await sizeOf(page, ".dag-sidebar__row")).toBeCloseTo(13, 1);
  expect(await sizeOf(page, ".dag-toolbar")).toBeCloseTo(13, 1);
  expect(await sizeOf(page, '[data-dag-item="words"] .dag-md')).toBeCloseTo(14, 1);
  expect(await sizeOf(page, '[data-dag-node="read"] .dag-node__title')).toBeCloseTo(15, 1);

  await openSettings(page, "appearance");
  const control = page.locator("[data-dag-setting-text-size]");
  await expect(control).toHaveValue("default");
  await expect(control.locator("option")).toHaveText(["Small", "Default", "Large"]);

  await control.selectOption("large");
  await expect(page.locator("html")).toHaveAttribute("data-dag-text-size", "large");
  /* The modal is chrome too, and follows while it is open. */
  expect(await sizeOf(page, '[data-dag-settings-pane="appearance"] .dag-settings__row')).toBeGreaterThan(13);

  await page.keyboard.press("Escape");
  expect(await sizeOf(page, ".dag-sidebar__row")).toBeGreaterThan(13);
  expect(await sizeOf(page, ".dag-toolbar")).toBeGreaterThan(13);

  /* Nothing the board draws moved — not its Markdown, not a diagram's card, and not the theme's
     own tokens. This is the half of the setting that would be a defect if it were wrong. */
  expect(await sizeOf(page, '[data-dag-item="words"] .dag-md')).toBeCloseTo(14, 1);
  expect(await sizeOf(page, '[data-dag-node="read"] .dag-node__title')).toBeCloseTo(15, 1);
  const type = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--dag-type-nodeTitle").trim(),
  );
  expect(type).toBe("15px");

  /* The step below the default is a step too. */
  await choose(page, "small");
  await expect(page.locator("html")).toHaveAttribute("data-dag-text-size", "small");
  expect(await sizeOf(page, ".dag-sidebar__row")).toBeLessThan(13);
  expect(await sizeOf(page, ".dag-toolbar")).toBeLessThan(13);
  expect(await sizeOf(page, '[data-dag-item="words"] .dag-md')).toBeCloseTo(14, 1);

  await choose(page, "default");
  await expect(page.locator("html")).toHaveAttribute("data-dag-text-size", "default");
  expect(await sizeOf(page, ".dag-sidebar__row")).toBeCloseTo(13, 1);
});

test("a note reads at the step, its text and its title", async ({ page }) => {
  await openBoard(page);
  /* A step stored directly, as a person who chose Large yesterday would leave it. */
  await page.evaluate(() => localStorage.setItem("dag:text-size", "large"));
  await openNote(page);

  await expect(page.locator(".dag-note-view .bn-editor")).toBeVisible();
  expect(await sizeOf(page, ".dag-note-view .bn-editor")).toBeGreaterThan(14);
  expect(await sizeOf(page, ".dag-note-title")).toBeGreaterThan(26 * 1.35);

  /* Down one step, and back to the theme's own. */
  await choose(page, "small");
  expect(await sizeOf(page, ".dag-note-view .bn-editor")).toBeLessThan(14);
  expect(await sizeOf(page, ".dag-note-title")).toBeLessThan(26 * 1.35);

  await choose(page, "default");
  expect(await sizeOf(page, ".dag-note-view .bn-editor")).toBeCloseTo(14, 1);
  expect(await sizeOf(page, ".dag-note-title")).toBeCloseTo(26 * 1.35, 0);
});

test("the calendar's small month follows the step, and stays inside its card", async ({ page }, info) => {
  await openBoard(page);
  await choose(page, "large");

  await page.goto("/?calendar=week&date=2035-07-15");
  const mini = page.locator("[data-dag-cal-mini]");
  await expect(mini).toBeVisible({ timeout: 15_000 });

  /* Every size on it is the chrome's step: a day number `sm`, the month `md`, a weekday `xs`. */
  expect(await sizeOf(page, "[data-dag-cal-mini-day]")).toBeGreaterThan(12);
  expect(await sizeOf(page, "[data-dag-cal-mini-title]")).toBeGreaterThan(13);
  expect(await sizeOf(page, ".dag-cal-mini__name")).toBeGreaterThan(11);

  /* The card is a fixed 240px column of seven days: at Large the grid still fits it, every day keeps
     its 24px target, and no number is wider than the button that holds it. */
  expect(await fits(mini), "the small month overflows its card at Large").toBe(true);
  for (const day of await mini.locator("[data-dag-cal-mini-day]").all()) {
    const box = (await day.boundingBox())!;
    expect(box.width, "a day of the small month is under 24px at Large").toBeGreaterThanOrEqual(24);
    expect(await fits(day), "a day number leaves its button at Large").toBe(true);
  }
  await page.screenshot({ path: info.outputPath("calendar-large.png") });
});

test("the Assistant's subject chip follows the step, and keeps its title inside the pill", async ({ page }) => {
  await openBoard(page);
  await choose(page, "large");

  await openNote(page);
  await page.locator("[data-dag-assistant-toggle]").click();
  const panel = page.locator("[data-dag-assistant-panel]");
  const chip = panel.locator(`[data-dag-chat-subject="${name}"]`);
  await expect(chip).toBeVisible({ timeout: 15_000 });

  /* The chip is the chrome's `sm`, and the document's title ellipsizes inside the pill rather than
     widening it or spilling out of the panel. */
  expect(await sizeOf(page, ".dag-chat-docchip")).toBeGreaterThan(12);
  expect(await fits(panel), "the Assistant panel scrolls sideways at Large").toBe(true);
  expect(await fits(chip), "the subject chip overflows at Large").toBe(true);
  const title = chip.locator(".dag-chat-docchip__title");
  expect(await title.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
  const chipBox = (await chip.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
});

test("the choice survives a restart, and the tab's reset puts both rows back", async ({ page }) => {
  await openBoard(page);
  await choose(page, "large");
  expect(await sizeOf(page, ".dag-toolbar")).toBeGreaterThan(13);

  /* A restart: the same browser, a fresh load. The write is a preference like any other. */
  await openBoard(page);
  await expect(page.locator("html")).toHaveAttribute("data-dag-text-size", "large");
  expect(await sizeOf(page, ".dag-toolbar")).toBeGreaterThan(13);

  /* The Appearance tab's Reset covers both rows it owns. */
  await openSettings(page, "appearance");
  await page.locator("[data-dag-setting-reset]").click();
  await expect(page.locator("[data-dag-setting-text-size]")).toHaveValue("default");
  await expect(page.locator("html")).toHaveAttribute("data-dag-text-size", "default");

  /* And its Undo puts the pair back the way they were. */
  await page.locator("[data-dag-setting-reset-undo]").click();
  await expect(page.locator("[data-dag-setting-text-size]")).toHaveValue("large");
  await expect(page.locator("html")).toHaveAttribute("data-dag-text-size", "large");
});

test("a snapshot reads none of it", async ({ page }) => {
  await openBoard(page);
  /* A step stored directly, as a person who chose Large yesterday would leave it. */
  await page.evaluate(() => localStorage.setItem("dag:text-size", "large"));

  /* The note editor draws the same page read-only, at the theme's own ramp. */
  await openNote(page, "&snapshot=1");
  await expect(page.locator("html")).toHaveAttribute("data-dag-text-size", "default");
  await expect(page.locator(".dag-note-view .dag-md")).toBeVisible();
  expect(await sizeOf(page, ".dag-note-view .dag-md")).toBeCloseTo(14, 1);

  /* And a board's board is the default chrome's — the snapshot draws no chrome, but the explicit
     `?theme=` case is the one place an instruction still wins, and text size has no such source. */
  await page.goto(`/?board=${name}&snapshot=1`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await expect(page.locator('[data-dag-item="words"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("data-dag-text-size", "default");
  expect(await sizeOf(page, '[data-dag-item="words"] .dag-md')).toBeCloseTo(14, 1);
});

test("nothing overflows in the sidebar, a menu or Settings at Large", async ({ page }, info) => {
  await openBoard(page);
  await openSidebar(page);
  await choose(page, "large");

  /* The column: the tree scrolls down, never sideways, and a row stays inside it. A long name
     ellipsizes — that is what the ellipsis is for — but no row or control leaves the column. */
  const tree = page.locator(".dag-sidebar__tree");
  expect(await fits(tree), "the sidebar tree scrolls sideways at Large").toBe(true);
  const column = (await tree.boundingBox())!;
  for (const row of await page.locator(".dag-sidebar__row:visible").all()) {
    const box = (await row.boundingBox())!;
    expect(box.x, "a sidebar row starts outside its column at Large").toBeGreaterThanOrEqual(column.x - 1);
    expect(box.x + box.width, "a sidebar row leaves its column at Large").toBeLessThanOrEqual(column.x + column.width + 1);
  }
  await page.screenshot({ path: info.outputPath("sidebar-large.png") });

  /* A menu: the dock's `⋯`, whose rows carry a name and a chord. */
  await openMore(page);
  const menu = page.locator("[data-dag-more-menu]");
  expect(await fits(menu), "the menu scrolls sideways at Large").toBe(true);
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  for (const item of await menu.locator(".dag-more__item:visible").all()) {
    expect(await fits(item), "a menu row is wider than the menu at Large").toBe(true);
  }
  await page.keyboard.press("Escape");

  /* Settings: every tab whose rows vary in width, then the whole card inside the window. */
  await openSettings(page);
  expect(await fits(page.locator(".dag-settings-modal__nav")), "the tab list scrolls sideways at Large").toBe(true);
  const tabs: SettingsTab[] = ["appearance", "vault-general", "export", "calendar", "shortcuts", "about"];
  for (const tab of tabs) {
    await settingsTab(page, tab);
    const pane = page.locator(`[data-dag-settings-pane="${tab}"]`);
    expect(await fits(pane), `the ${tab} tab scrolls sideways at Large`).toBe(true);
    for (const row of await pane.locator(".dag-settings__row:visible").all()) {
      expect(await fits(row), `a ${tab} row is wider than its box at Large`).toBe(true);
    }
  }
  await settingsTab(page, "appearance");
  const card = (await page.locator(".dag-settings-modal").boundingBox())!;
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: info.outputPath("settings-large.png") });
});
