import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * A file that cannot be opened says why and offers a way forward.
 *
 * The same card stands in for every document kind: `?board=does-not-exist` and
 * `?note=does-not-exist` are one `missing` card with the three ways to find the file, and a board
 * whose read reaches no server is `unreachable` with *Try again*. The code and the raw message are
 * behind *Details for a bug report*, never in the sentence a person reads.
 *
 * The unreachable case is a `fetch` rejected with `page.route`, the same rejection a stopped server
 * gives `fetch` — the suite cannot stop the dev server a check is running against.
 */

const BOARD = `---
title: File problem
---

\`\`\`md {#one x=0 y=0 w=280}
Still here.
\`\`\`
`;

let file = "";

test.afterEach(() => {
  if (file) fs.rmSync(file, { force: true });
  file = "";
});

const card = (page: Page, reason: "missing" | "unreachable" | "unreadable") =>
  page.locator(`[data-dag-file-problem="${reason}"]`);

test("a missing board says which board and offers search, trash and home", async ({ page }, info) => {
  const name = `e2e-file-problem-${info.testId}`;
  await page.goto(`/?board=${name}`);

  const shown = card(page, "missing");
  await expect(shown).toBeVisible({ timeout: 20_000 });
  await expect(shown).toContainText(`There's no board called \u201c${name}\u201d`);
  await expect(shown).toContainText("It may have been renamed, moved or trashed.");
  for (const action of ["search", "trash", "home"])
    await expect(page.locator(`[data-dag-file-problem-act="${action}"]`)).toBeVisible();

  /* The top bar does not keep naming the file as though it were open. */
  await expect(page.locator("[data-dag-open-boards]")).toHaveCount(0);

  await page.locator('[data-dag-file-problem-act="trash"]').click();
  await expect(page.locator("[data-dag-trash]")).toBeVisible();
});

test("a missing note draws the same card, with the same three actions", async ({ page }, info) => {
  const name = `e2e-file-problem-note-${info.testId}`;
  await page.goto(`/?note=${name}`);

  const shown = card(page, "missing");
  await expect(shown).toBeVisible({ timeout: 20_000 });
  await expect(shown).toContainText(`There's no note called \u201c${name}\u201d`);
  for (const action of ["search", "trash", "home"])
    await expect(page.locator(`[data-dag-file-problem-act="${action}"]`)).toBeVisible();

  await page.locator('[data-dag-file-problem-act="search"]').click();
  await expect(page.locator("[data-dag-boards]")).toBeVisible();
});

test("a missing quiz and a missing table are the same card", async ({ page }, info) => {
  const stem = `e2e-file-problem-kind-${info.testId}`;
  await page.goto(`/?quiz=${stem}`);
  await expect(card(page, "missing")).toContainText(`There's no quiz called \u201c${stem}\u201d`, { timeout: 20_000 });
  for (const action of ["search", "trash", "home"])
    await expect(page.locator(`[data-dag-file-problem-act="${action}"]`)).toBeVisible();

  await page.goto(`/?table=${stem}`);
  await expect(card(page, "missing")).toContainText(`There's no table called \u201c${stem}\u201d`, { timeout: 20_000 });
  for (const action of ["search", "trash", "home"])
    await expect(page.locator(`[data-dag-file-problem-act="${action}"]`)).toBeVisible();
});

test("a board with no server says so, keeps its code in Details, and Try again reads it", async ({ page }, info) => {
  const name = `e2e-file-problem-offline-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);

  await page.route("**/__board/get?*", (route) => route.abort("connectionrefused"));
  await page.goto(`/?board=${name}`);

  const shown = card(page, "unreachable");
  await expect(shown).toBeVisible({ timeout: 20_000 });
  await expect(shown).toContainText(`Couldn't open \u201c${name}\u201d`);
  await expect(shown).toContainText("AnyDag's server isn't answering. The file is safe on disk.");
  await expect(page.locator('[data-dag-file-problem-act="retry"]')).toBeVisible();

  /*
   * No code in anything a person reads. The disclosure is shut, so its rows are not on screen
   * either — this asks the card's own text with the details removed, which is what an eye gets.
   */
  const prose = await shown.evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const details of copy.querySelectorAll("details")) details.remove();
    return copy.textContent ?? "";
  });
  expect(prose).not.toContain("EB_");
  await expect(shown).toContainText("Details for a bug report");
  await expect(page.locator("[data-dag-file-problem-code]")).toHaveText("EB_UNREADABLE");

  /* What was a dead server is reachable again: the retry asks once and the board opens. */
  await page.unroute("**/__board/get?*");
  await page.locator('[data-dag-file-problem-act="retry"]').click();
  await expect(page.locator('[data-dag-item="one"]')).toBeVisible({ timeout: 10_000 });
  await expect(card(page, "unreachable")).toHaveCount(0);
});

test("a board the server cannot read is unreadable, not missing, and has no search for it", async ({ page }, info) => {
  const name = `e2e-file-problem-unreadable-${info.testId}`;
  await page.route("**/__board/get?*", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "the disk refused it" }) }),
  );
  await page.goto(`/?board=${name}`);

  const shown = card(page, "unreadable");
  await expect(shown).toBeVisible({ timeout: 20_000 });
  await expect(shown).toContainText(`Couldn't open \u201c${name}\u201d`);
  await expect(shown).toContainText("The file is there, but AnyDag couldn't read it.");
  await expect(page.locator('[data-dag-file-problem-act="home"]')).toBeVisible();
  await expect(page.locator('[data-dag-file-problem-act="search"]')).toHaveCount(0);
  await expect(page.locator('[data-dag-file-problem-act="trash"]')).toHaveCount(0);
  await expect(page.locator("[data-dag-file-problem-code]")).toHaveText("EB_UNREADABLE");
});

test("home from the card is the welcome page", async ({ page }, info) => {
  const name = `e2e-file-problem-home-${info.testId}`;
  await page.goto(`/?board=${name}`);
  await expect(card(page, "missing")).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-dag-file-problem-act="home"]').click();
  await expect(page.locator("[data-dag-welcome]")).toBeVisible();
});
