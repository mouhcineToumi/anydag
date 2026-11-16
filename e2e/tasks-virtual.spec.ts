import fs from "node:fs";
import path from "node:path";

import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";

/**
 * A long Tasks list draws the rows in view and a margin, not every task (#267): two thousand tasks
 * were 73,000 elements and nearly a second before the first row showed. What that must not cost is
 * what the list's keys do with a row that is **not in the DOM**: J walks past the rows that were
 * drawn, and the focused row survives being scrolled away from.
 *
 * The tasks are generated for the run, in a folder named for this worker and **removed by that exact
 * path**. Each is due a day after the one before, so the list's order — soonest first — is theirs,
 * and a word in every title filters the list to them alone.
 */

const COUNT = 400;
const pad = (n: number) => String(n).padStart(3, "0");
const day = (n: number) => new Date(Date.UTC(2031, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);

let parent = "";
let dir = "";
let word = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(({}, info) => {
  const id = `${info.workerIndex}${Date.now().toString(36)}`;
  parent = `e2e-tasks-virtual-${id}`;
  word = `vt${id}`;
  if (!parent.startsWith("e2e-tasks-virtual-") || parent === "e2e-tasks-virtual-") throw new Error("no folder name to make");
  dir = path.join(BOARDS, parent);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < COUNT; i++)
    fs.writeFileSync(path.join(dir, `t${pad(i)}.md`), `---\ntitle: ${word} ${pad(i)}\nstatus: todo\ndue: ${day(i)}\n---\n`);
});

test.afterAll(() => {
  if (dir && dir !== BOARDS && dir.endsWith(parent) && parent.startsWith("e2e-tasks-virtual-"))
    fs.rmSync(dir, { recursive: true, force: true });
});

const task = (n: number) => `${parent}/t${pad(n)}`;
const row = (page: Page, n: number) => page.locator(`[data-dag-task-row="${task(n)}"]`);
/** The task the focus is on, by name. */
const focused = (page: Page) =>
  page.evaluate(
    () =>
      (document.activeElement as HTMLElement | null)?.closest("[data-dag-task-row]")?.getAttribute("data-dag-task-row") ?? null,
  );

async function openList(page: Page): Promise<void> {
  await page.goto("/?tasks=1");
  await page.locator("[data-dag-tasks-filter]").fill(word);
  await expect(row(page, 0)).toBeVisible({ timeout: 30_000 });
}

test("a long list draws only the rows in view, and every task still counts", async ({ page }) => {
  await openList(page);
  await expect(page.locator("[data-dag-tasks-count]")).toContainText(String(COUNT));
  expect(await page.locator("[data-dag-task-row]").count()).toBeLessThan(150);
  /* Scrolled to the end, the last task is there and the first is not. */
  await page.locator("main.dag-tasks").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(row(page, COUNT - 1)).toBeInViewport();
  await expect(row(page, 0)).toHaveCount(0);
});

test("J walks past the rows that were drawn, and the focused row survives a scroll", async ({ page }) => {
  await openList(page);
  await row(page, 0).locator("[data-dag-task-open]").focus();
  /* Eighty rows on is past the window drawn when the list opened. */
  for (let i = 0; i < 80; i++) await page.keyboard.press("j");
  await expect.poll(() => focused(page)).toBe(task(80));
  await expect(row(page, 80)).toBeInViewport();

  /* Scrolled to the end, far from it: the focused row stays in the DOM, and the next key brings the
     list back to the row after it. */
  await page.locator("main.dag-tasks").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(row(page, 80)).toHaveCount(1);
  await page.keyboard.press("j");
  await expect.poll(() => focused(page)).toBe(task(81));
  await expect(row(page, 81)).toBeInViewport();
});
