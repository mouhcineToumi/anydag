import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";
import { vaultKey } from "./vault";

/**
 * Problems a person can act on, and nothing else (#145).
 *
 * The board that started the dock had a stray `y` at the top of its `edges` fence, and a 620px red
 * card hung over the canvas until somebody found and fixed it. Then the dock took the card's place
 * and pointed at lines — in a text a person no longer sees. What is here now: a statement that
 * cannot be read is skipped and the rest drawn, with nothing said; a problem with an answer — a
 * link to a card that is not there — is a quiet mark on the diagram, a notification that goes away,
 * a count that stays, and from any of them the panel, with the link picked and a way to fix it.
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

/** A link to a card that is not there: something a person can see and do something about. */
const GHOST = GOOD.replace("api --> db", "api --> db\napi --> ghost");

/** The shape of the board that started this: one stray word at the top of the links fence. */
const STRAY = `${GOOD}
\`\`\`edges {#links}
y
stack.api --> other
\`\`\`
`;

/** A diagram with a statement that cannot be read: a word that is not a kind. */
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

test("a link to nothing is a notification, never a card on the canvas", { tag: "@smoke" }, async ({ page }) => {
  await open(page, GHOST);
  await expect(page.locator(".dag-viewport .dag-error")).toHaveCount(0);
  await expect(toast(page)).toHaveAttribute("data-dag-problems-toast", "E_UNKNOWN_ID");
  /* In words: no code, no line, no grammar. */
  await expect(toast(page)).not.toContainText("E_UNKNOWN_ID");
  await expect(toast(page)).not.toContainText("line");
  await expect(pill(page)).toHaveText(/1 error/);

  /* Put away, and the count stays so the problem is not lost. */
  await page.locator("[data-dag-problems-dismiss]").click();
  await expect(toast(page)).toHaveCount(0);
  await expect(pill(page)).toBeVisible();
});

test("the notification goes away on its own", async ({ page }) => {
  await open(page, GHOST);
  await expect(toast(page)).toBeVisible();
  await expect(toast(page)).toHaveCount(0, { timeout: 12_000 });
  await expect(pill(page)).toBeVisible();
});

test("the diagram wears a count by its title, and loses it when fixed", async ({ page }) => {
  await open(page, GHOST);
  const item = page.locator('[data-dag-item="stack"]');
  await expect(item).toHaveAttribute("data-dag-problem-count", "1");
  await expect(page.locator('[data-dag-item="other"]')).not.toHaveAttribute("data-dag-problem-count", /.*/);
  fs.writeFileSync(file, GOOD);
  await expect(item).not.toHaveAttribute("data-dag-problem-count", /.*/);
  await expect(pill(page)).toHaveCount(0);
});

test("Show opens the panel on the link, with the problem at the top", async ({ page }) => {
  await open(page, GHOST);
  await page.locator("[data-dag-problems-show]").click();
  await expect(page.locator("[data-dag-inspector]")).toHaveCount(1);
  const block = page.locator("[data-dag-inspector-problems]");
  await expect(block).toContainText("not there");
  await expect(block).not.toContainText("E_UNKNOWN_ID");
  /* The link is what is picked, drawn hanging from the card it has, and its controls are the panel's. */
  await expect(page.locator('[data-dag-item="stack"] [data-dag-edge][data-dag-picked]')).toHaveCount(1);
  await expect(page.locator("[data-dag-props] [data-dag-prop-arrow]")).toHaveCount(1);
});

/** A third card to drop the loose end on. */
const LOOSE = GHOST.replace("api --> db", 'service web "Web" icon=server\napi --> db');

test("a link to nothing hangs from its card, and its loose end dropped on a card mends it", async ({ page }) => {
  await open(page, LOOSE);
  const stack = page.locator('[data-dag-item="stack"]');
  const stub = stack.locator('[data-dag-loose="ghost"]');
  await expect(stub).toBeVisible();
  await expect(stack.locator("[data-dag-edge]")).toHaveCount(2);

  /* The diagram first, as for a card: the first click takes the container. */
  await stack.locator('[data-dag-node="api"]').click();
  const from = (await stub.boundingBox())!;
  const to = (await stack.locator('[data-dag-node="web"]').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
  await expect(page.locator(".dag-connect")).toHaveCount(1);
  await page.mouse.up();

  await expect.poll(() => fs.readFileSync(file, "utf8")).toContain("api --> web");
  expect(fs.readFileSync(file, "utf8")).not.toContain("ghost");
  await expect(stub).toHaveCount(0);
  await expect(pill(page)).toHaveCount(0);
});

test("a click on a loose end picks its link, and Delete takes it out", async ({ page }) => {
  await open(page, LOOSE);
  const stack = page.locator('[data-dag-item="stack"]');
  await stack.locator('[data-dag-node="api"]').click();
  await stack.locator('[data-dag-loose="ghost"]').click();
  await expect(stack.locator("[data-dag-edge][data-dag-picked]")).toHaveCount(1);
  await page.keyboard.press("Delete");
  await expect.poll(() => fs.readFileSync(file, "utf8")).not.toContain("ghost");
  expect(fs.readFileSync(file, "utf8")).toContain("api --> db");
});

test("the count opens the list, and a row opens the panel", async ({ page }) => {
  await open(page, GHOST);
  await pill(page).click();
  const row = page.locator('[data-dag-problems-row="E_UNKNOWN_ID"]');
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator("[data-dag-inspector]")).toHaveCount(1);
  await expect(page.locator("[data-dag-problems-tray]")).toHaveCount(0);
});

test("the panel deletes a link to nothing from its row", async ({ page }) => {
  await open(page, GHOST);
  await page.locator("[data-dag-problems-show]").click();
  await page.locator("[data-dag-problem-delete]").click();
  await expect.poll(() => fs.readFileSync(file, "utf8"), { timeout: 5_000 }).not.toContain("ghost");
  expect(fs.readFileSync(file, "utf8")).toContain("api --> db");
  await expect(pill(page)).toHaveCount(0);
  await expect(page.locator("[data-dag-inspector-problems]")).toHaveCount(0);
});

test("a statement that cannot be read is skipped, the rest drawn, and nothing said", async ({ page }) => {
  await open(page, BROKEN);
  await expect(page.locator('[data-dag-item="stack"] [data-dag-node="api"]')).toBeVisible();
  await expect(page.locator('[data-dag-item="stack"] [data-dag-node="cache2"]')).toHaveCount(0);
  /* A tool reading the page still learns it: the marker is there, and hidden. */
  await expect(page.locator('[data-dag-item="stack"] [data-dag-error]')).toHaveCount(1);
  await expect(page.locator('[data-dag-item="stack"] [data-dag-error]')).toBeHidden();
  await page.waitForTimeout(1500);
  await expect(toast(page)).toHaveCount(0);
  await expect(pill(page)).toHaveCount(0);
  await expect(page.locator('[data-dag-item="stack"]')).not.toHaveAttribute("data-dag-problem-count", /.*/);
});

test("a stray word in the links is skipped, and the links still drawn", async ({ page }) => {
  await open(page, STRAY);
  await expect(page.locator(".dag-board-edges .dag-edge-hit")).toHaveCount(1);
  await page.waitForTimeout(1500);
  await expect(toast(page)).toHaveCount(0);
  await expect(pill(page)).toHaveCount(0);
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
  await open(page, GHOST);
  await page.waitForTimeout(1500);
  await expect(page.locator("[data-dag-problems]")).toHaveCount(0);
  await page.evaluate((k) => localStorage.removeItem(k), settings);
});
