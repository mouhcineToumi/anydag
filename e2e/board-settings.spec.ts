import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { pageMore } from "./more";
import { openSettings } from "./sidebar";

/**
 * The settings a board and a fence had that only typing reached: `aspect=`, a diagram's own `hue=`,
 * the frontmatter's `theme:` and `flow:`, and a repair, in words, for a file that would not parse.
 *
 * Every check reads the bytes, for the reason `select.spec.ts` gives: what is being tested is that a
 * control turns into a small, correct edit to a document a person also owns. One board per test —
 * the suite runs in parallel and these write to disk.
 */

const DIR = BOARDS;

const BOARD = `---
title: Settings
---

\`\`\`arch {#infra x=0 y=0 title=Infra}
service api "The API" icon=server
store db "Database"

api --> db
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-bset-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page, text = BOARD) {
  fs.writeFileSync(file, text);
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** Select the diagram, open its panel and the Advanced half. */
async function advanced(page: Page) {
  await page.locator('[data-dag-item="infra"]').click();
  await page.keyboard.press("Enter");
  await page.locator("[data-dag-advanced-toggle]").click();
}

/* ------------------------------------------------------------------------------- aspect= */

test("wrapping: never wrap writes aspect=0, a shape writes the ratio, the default takes it off", async ({ page }) => {
  await open(page);
  await advanced(page);
  const select = page.locator("[data-dag-item-aspect]");
  await expect(select).toHaveValue("auto");

  await select.selectOption("off");
  await expect.poll(read, { timeout: 5_000 }).toMatch(/#infra[^\n]*aspect=0[ }]/);
  await expect(select).toHaveValue("off");

  await select.selectOption("ratio");
  await expect.poll(read, { timeout: 5_000 }).toMatch(/#infra[^\n]*aspect=1\.6/);

  const ratio = page.locator("[data-dag-item-aspect-ratio]");
  await ratio.fill("2.5");
  await ratio.blur();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/#infra[^\n]*aspect=2\.5/);

  /* A word is refused in the box and nothing is written. */
  const before = read();
  await ratio.fill("wide");
  await ratio.blur();
  await expect(ratio).toHaveValue("2.5");
  expect(read()).toBe(before);

  await select.selectOption("auto");
  await expect.poll(read, { timeout: 5_000 }).not.toContain("aspect");
  expect(read()).toBe(BOARD);
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("an aspect the file got wrong is named in the panel, and any choice replaces it", async ({ page }) => {
  await open(page, BOARD.replace("{#infra", "{#infra aspect=wide"));
  await advanced(page);
  await expect(page.locator("[data-dag-item-aspect-bad]")).toContainText("aspect=wide");
  await page.locator("[data-dag-item-aspect]").selectOption("off");
  await expect.poll(read, { timeout: 5_000 }).toMatch(/aspect=0/);
  await expect(page.locator("[data-dag-item-aspect-bad]")).toHaveCount(0);
});

/* --------------------------------------------------------------------------------- hue= */

test("a diagram's hue tints its frame and its title band, and not the cards inside it", async ({ page }) => {
  await open(page);
  const frame = page.locator('[data-dag-item="infra"] .dag-frame');
  const head = page.locator('[data-dag-item="infra"] .dag-frame__head');
  await expect(frame).not.toHaveClass(/dag-frame--hued/);
  const card = page.locator('[data-dag-item="infra"] [data-dag-node="api"]');
  const cardBefore = await card.evaluate((el) => getComputedStyle(el).borderTopColor + getComputedStyle(el).backgroundColor);
  const boxBefore = (await frame.boundingBox())!;

  await page.locator('[data-dag-item="infra"]').click();
  await page.keyboard.press("Enter");
  /* *None* first, as on every swatch row, and already on because the diagram has no hue. */
  await expect(page.locator("[data-dag-frame-hue-row] [data-dag-hue-none]")).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-dag-frame-hue="teal"]').click();

  await expect.poll(read, { timeout: 5_000 }).toMatch(/#infra[^\n]*hue=teal/);
  await expect(frame).toHaveClass(/dag-frame--hued/);
  await expect(head).toHaveClass(/dag-frame__head--hued/);

  /* Drawn: a hairline round the frame, and a band behind the header that is not the paper. */
  const drawn = await frame.evaluate((el) => {
    const f = getComputedStyle(el);
    const h = getComputedStyle(el.querySelector(".dag-frame__head")!);
    return { shadow: f.boxShadow, band: h.backgroundColor, frameBg: f.backgroundColor };
  });
  expect(drawn.shadow).not.toBe("none");
  expect(drawn.band).not.toBe("rgba(0, 0, 0, 0)");
  expect(drawn.band).not.toBe(drawn.frameBg);

  /* From the theme's own hue variables — never a literal in the stylesheet. */
  const tint = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--dag-tint-teal)";
    document.body.append(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  });
  expect(drawn.band).toBe(tint);

  /* Nothing moved, and nothing inside took the colour: the box is the box and the card is the card. */
  const boxAfter = (await frame.boundingBox())!;
  expect(boxAfter.width).toBe(boxBefore.width);
  expect(boxAfter.height).toBe(boxBefore.height);
  expect(await card.evaluate((el) => getComputedStyle(el).borderTopColor + getComputedStyle(el).backgroundColor)).toBe(
    cardBefore,
  );
  expect(await frame.evaluate((el) => getComputedStyle(el).getPropertyValue("--dag-h"))).toBe("");

  await page.locator("[data-dag-frame-hue-row] [data-dag-hue-none]").click();
  await expect.poll(read, { timeout: 5_000 }).not.toContain("hue=");
  await expect(frame).not.toHaveClass(/dag-frame--hued/);
  expect(read()).toBe(BOARD);
});

test("a diagram with no header keeps the hairline and has no band to tint", async ({ page }) => {
  await open(page, BOARD.replace(" title=Infra", " hue=violet"));
  const frame = page.locator('[data-dag-item="infra"] .dag-frame');
  await expect(frame).toHaveClass(/dag-frame--bare/);
  await expect(frame).toHaveClass(/dag-frame--hued/);
  await expect(page.locator('[data-dag-item="infra"] .dag-frame__head')).toHaveCount(0);
  expect(await frame.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
});

/* -------------------------------------------------------------------- theme: and flow: */

test("board settings: the theme and the flow are the frontmatter's, and undo takes them back", async ({ page }) => {
  await open(page);
  await pageMore(page, "data-dag-board-settings-open");
  const card = page.locator("[data-dag-board-settings]");
  await expect(card).toBeVisible();

  const theme = page.locator("[data-dag-board-theme]");
  await expect(theme).toHaveValue("");
  await theme.selectOption("neutral");
  await expect.poll(read, { timeout: 5_000 }).toMatch(/^---\ntitle: Settings\ntheme: neutral\n---/);

  const width = page.locator("[data-dag-board-flow-width]");
  await width.fill("2400");
  await width.blur();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/flow:\n {2}width: 2400\n/);

  const gap = page.locator("[data-dag-board-flow-gap]");
  await gap.fill("40");
  await gap.blur();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/flow:\n {2}width: 2400\n {2}gap: 40\n/);
  expect(read()).toContain("title: Settings");

  /* The defaults are not written: put them back and the block is as short as it was. */
  await width.fill("4000");
  await width.blur();
  await gap.fill("80");
  await gap.blur();
  await expect.poll(read, { timeout: 5_000 }).not.toContain("flow:");

  await theme.selectOption("");
  await expect.poll(read, { timeout: 5_000 }).toBe(BOARD);
});

test("a flow number the control may not write is put back in the box, with the range", async ({ page }) => {
  await open(page);
  await pageMore(page, "data-dag-board-settings-open");
  const width = page.locator("[data-dag-board-flow-width]");
  await width.fill("12");
  await width.blur();
  await expect(page.locator("[data-dag-board-flow-bad]")).toContainText("320");
  await expect(width).toHaveValue("4000");
  expect(read()).toBe(BOARD);
});

test("the card says so when the address names another theme than the board asks for", async ({ page }) => {
  fs.writeFileSync(file, BOARD.replace("title: Settings", "title: Settings\ntheme: neutral"));
  await page.goto(`/?board=${name}&theme=paper`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await pageMore(page, "data-dag-board-settings-open");
  await expect(page.locator("[data-dag-board-theme]")).toHaveValue("neutral");
  await expect(page.locator("[data-dag-board-theme-note]")).toHaveAttribute("data-dag-board-theme-note", "address");
  await expect(page.locator("[data-dag-board-theme-note]")).toContainText("paper");
});

test("a board's own theme beats the reader's, unless they use their theme on every board", async ({ page }) => {
  fs.writeFileSync(file, BOARD.replace("title: Settings", "title: Settings\ntheme: neutral"));
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "neutral");

  /* The reader picks a dark theme in Settings: the board still asks for its own, and gets it. */
  await openSettings(page, "preferences");
  const own = page.locator("[data-dag-setting-own-theme]");
  await expect(own).not.toBeChecked();
  await page.locator("[data-dag-setting-theme]").selectOption("paper-dark");
  await expect(page.locator("[data-dag-setting-theme]")).toHaveValue("paper-dark");
  await expect(html).toHaveAttribute("data-theme", "neutral");

  /* Turned on, the reader's theme is drawn over the board's — and the file is not touched. */
  await own.click();
  await expect(html).toHaveAttribute("data-theme", "paper-dark");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-settings]")).toHaveCount(0);
  await pageMore(page, "data-dag-board-settings-open");
  await expect(page.locator("[data-dag-board-theme]")).toHaveValue("neutral");
  const note = page.locator("[data-dag-board-theme-note]");
  await expect(note).toHaveAttribute("data-dag-board-theme-note", "mine");
  await expect(note).toContainText("paper-dark");
  expect(read()).toContain("theme: neutral");
  await page.keyboard.press("Escape");

  /* And off again, the board's own look comes back. */
  await openSettings(page, "preferences");
  await page.locator("[data-dag-setting-own-theme]").click();
  await expect(html).toHaveAttribute("data-theme", "neutral");
  await page.keyboard.press("Escape");
  await pageMore(page, "data-dag-board-settings-open");
  await expect(page.locator("[data-dag-board-theme-note]")).toHaveAttribute("data-dag-board-theme-note", "board");
});

test("a board that asks for no theme is drawn in the reader's, whatever the switch says", async ({ page }) => {
  await open(page);
  await openSettings(page, "preferences");
  await page.locator("[data-dag-setting-theme]").selectOption("paper-dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper-dark");
  await page.keyboard.press("Escape");
  await pageMore(page, "data-dag-board-settings-open");
  await expect(page.locator("[data-dag-board-theme-note]")).toContainText("Settings");
});

test("Escape closes the card and leaves the board as it was", async ({ page }) => {
  await open(page);
  await pageMore(page, "data-dag-board-settings-open");
  await expect(page.locator("[data-dag-board-settings]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-board-settings]")).toHaveCount(0);
  expect(read()).toBe(BOARD);
});

/* -------------------------------------------------------------------------- repairs */

const tray = (page: Page) => page.locator("[data-dag-problems-tray]");

async function openTray(page: Page) {
  await page.locator("[data-dag-problems-pill]").click();
  await expect(tray(page)).toBeVisible();
}

test("a settings block that is not YAML is repaired in the dock, keeping what reads", async ({ page }) => {
  const broken = BOARD.replace("title: Settings", "title: Settings\ntheme: [unclosed\nflow:\n  width: 2400");
  await open(page, broken);
  await openTray(page);
  const box = page.locator('[data-dag-repair="EB_FRONTMATTER"]');
  await expect(box).toContainText("cannot be read");
  await box.locator("[data-dag-repair-go]").click();

  await expect.poll(read, { timeout: 5_000 }).toBe(BOARD.replace("title: Settings", "title: Settings\nflow:\n  width: 2400"));
  await expect(page.locator("[data-dag-problems-pill]")).toHaveCount(0);
  await expect(page.locator('[data-dag-item="infra"]')).toBeVisible();
});

test("a fence of a kind nobody knows is relabelled, its text untouched", async ({ page }) => {
  const text = `${BOARD}\n\`\`\`flo {#route x=900 y=0}\nstart --> done\n\`\`\`\n`;
  await open(page, text);
  await openTray(page);
  const box = page.locator('[data-dag-repair="EB_UNKNOWN_TYPE"]');
  await expect(box).toContainText("`flo`");
  /* The closest kind leads, so the box opens on the likeliest answer. */
  await expect(box.locator("[data-dag-repair-kind]")).toHaveValue("flow");
  await box.locator("[data-dag-repair-go]").click();

  await expect.poll(read, { timeout: 5_000 }).toBe(text.replace("```flo ", "```flow "));
  await expect(page.locator('[data-dag-repair="EB_UNKNOWN_TYPE"]')).toHaveCount(0);
});

test("a bad layout is taken off the fence line, and the diagram lays itself out again", async ({ page }) => {
  await open(page, BOARD.replace("{#infra", "{#infra layout=grid"));
  await openTray(page);
  const box = page.locator('[data-dag-repair="EB_BAD_LAYOUT"]');
  await expect(box).toContainText("layout=grid");
  await box.locator("[data-dag-repair-go]").click();
  await expect.poll(read, { timeout: 5_000 }).toBe(BOARD);
});

test("a repair is one undo", async ({ page }) => {
  const text = `${BOARD}\n\`\`\`flo {#route x=900 y=0}\nstart --> done\n\`\`\`\n`;
  await open(page, text);
  await openTray(page);
  await page.locator('[data-dag-repair="EB_UNKNOWN_TYPE"] [data-dag-repair-go]').click();
  await expect.poll(read, { timeout: 5_000 }).toContain("```flow ");
  await page.locator(".dag-viewport").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect.poll(read, { timeout: 5_000 }).toBe(text);
});
