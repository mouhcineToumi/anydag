import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";
import { vaultKey } from "./vault";

/**
 * Problems live at the bottom of the board, not on it.
 *
 * The board that started this had a stray `y` at the top of its `edges` fence, and a 620px red card
 * hung over the canvas until somebody found and fixed it — with no way to put it away. Everything
 * here is about what a person sees instead: nothing on the canvas but the drawing, a notification
 * that goes away, a count that stays, and a way from either to the line that is wrong.
 */

const DIR = BOARDS;

const GOOD = `\`\`\`arch {#stack x=0 y=0}
service api "API" icon=server
store db "Postgres" icon=database
api --> db
\`\`\`

\`\`\`arch {#other x=600 y=0}
store cache "Redis" icon=database
\`\`\`
`;

/** The shape of today's board: one stray word at the top of the links fence. */
const STRAY = `${GOOD}
\`\`\`edges {#links}
y
stack.api --> other
\`\`\`
`;

/** A diagram whose own body does not parse: a word that is not a kind. */
const BROKEN = GOOD.replace("api --> db", 'api --> db\ndatabase cache2 "Redis"');

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-problems-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

async function open(page: Page, text: string) {
  fs.writeFileSync(file, text);
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

const toast = (page: Page) => page.locator("[data-dag-problems-toast]");
const pill = (page: Page) => page.locator("[data-dag-problems-pill]");

test("a board error is a notification, never a card on the canvas", { tag: "@smoke" }, async ({ page }) => {
  await open(page, STRAY);
  await expect(page.locator(".dag-viewport .dag-error, .dag-viewport [data-dag-error]")).toHaveCount(0);
  await expect(toast(page)).toHaveAttribute("data-dag-problems-toast", "EB_LINK_SYNTAX");
  await expect(pill(page)).toHaveText(/1 error/);

  /* Put away, and the count stays so the problem is not lost. */
  await page.locator("[data-dag-problems-dismiss]").click();
  await expect(toast(page)).toHaveCount(0);
  await expect(pill(page)).toBeVisible();
});

test("the notification goes away on its own", async ({ page }) => {
  await open(page, STRAY);
  await expect(toast(page)).toBeVisible();
  await expect(toast(page)).toHaveCount(0, { timeout: 12_000 });
  await expect(pill(page)).toBeVisible();
});

test("Show opens the fence with the caret on the line that is wrong", async ({ page }) => {
  await open(page, STRAY);
  await page.locator("[data-dag-problems-show]").click();
  const area = page.locator("[data-dag-body]");
  await expect(area).toBeFocused();
  await expect
    .poll(() => area.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd)))
    .toBe("y");
  /* And the panel lists it, under the text it is about. */
  await expect(page.locator("[data-dag-inspector-problems]")).toContainText("EB_LINK_SYNTAX");
});

test("the count opens the list, and a row goes to the line", async ({ page }) => {
  await open(page, STRAY);
  await pill(page).click();
  const row = page.locator('[data-dag-problems-row="EB_LINK_SYNTAX"]');
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator("[data-dag-inspector]")).toHaveCount(1);
  await expect(page.locator("[data-dag-problems-tray]")).toHaveCount(0);
});

test("fixing it clears the count", async ({ page }) => {
  await open(page, STRAY);
  await expect(pill(page)).toBeVisible();
  fs.writeFileSync(file, STRAY.replace("\ny\n", "\n"));
  await expect(pill(page)).toHaveCount(0);
});

test("a diagram that breaks keeps its last drawing, marked", async ({ page }) => {
  await open(page, GOOD);
  await expect(page.locator('[data-dag-item="stack"] [data-dag-node="api"]')).toBeVisible();

  fs.writeFileSync(file, BROKEN);
  await expect(page.locator('[data-dag-item="stack"] [data-dag-stale]')).toHaveCount(1);
  /* The cards are the old drawing's, still there. */
  await expect(page.locator('[data-dag-item="stack"] [data-dag-node="api"]')).toBeVisible();
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
  await expect(toast(page)).toHaveAttribute("data-dag-problems-toast", "E_UNKNOWN_KIND");

  fs.writeFileSync(file, GOOD);
  await expect(page.locator("[data-dag-stale]")).toHaveCount(0);
  await expect(pill(page)).toHaveCount(0);
});

test("opened broken, a diagram is a small placeholder", async ({ page }) => {
  await open(page, BROKEN);
  const stub = page.locator('[data-dag-item="stack"] [data-dag-error]');
  await expect(stub).toHaveCount(1);
  await expect(stub).toContainText("can't be drawn");
  /* A stand-in, not the old card: it does not list the messages. */
  await expect(page.locator(".dag-error")).toHaveCount(0);
});

test("a warning is counted but never pops up", async ({ page }) => {
  await open(page, GOOD.replace("icon=server", "icon=server hue=purple"));
  await expect(pill(page)).toHaveText(/1 warning/);
  await page.waitForTimeout(1500);
  await expect(toast(page)).toHaveCount(0);
  await expect(page.locator(".dag-warnings")).toHaveCount(0);
});

test("the setting can turn it all off", async ({ page }) => {
  await page.goto("/");
  const settings = await vaultKey(page, "dag:settings");
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ problems: { show: "off" } })), settings);
  await open(page, STRAY);
  await page.waitForTimeout(1500);
  await expect(page.locator("[data-dag-problems]")).toHaveCount(0);
  await page.evaluate((k) => localStorage.removeItem(k), settings);
});
