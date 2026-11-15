import fs from "node:fs";
import path from "node:path";

import { BOARDS, openBoards } from "./boards";
import { expect, test, type Page } from "./fixture";

/**
 * Searching by tag (#327): `#` in the search box offers the vault's tags, a pick is a chip before the
 * words, the chip keeps only what carries the tag — the names and the text alike — and with no words
 * it lists every document carrying it, by title, each with its kind.
 *
 * Each test owns a folder, a word nobody else has written and tags that end in its own id: the suite
 * runs wide over one vault, whose search and tag list every test shares.
 */

let folder = "";
let dir = "";
let mark = "";
let word = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  mark = info.testId
    .replace(/[^0-9a-z]/gi, "")
    .slice(-8)
    .toLowerCase();
  folder = `e2e-tagsearch-${mark}`;
  dir = path.join(BOARDS, folder);
  word = `zt${mark}`;
  fs.mkdirSync(dir, { recursive: true });
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(async ({ page }) => {
  const listed = ((await (await page.request.get("/__board/tags")).json()) as { tags: { name: string }[] }).tags;
  for (const t of listed)
    if (t.name.endsWith(`-${mark}`)) await page.request.post("/__board/tags/delete", { data: { tag: t.name } });
  if (folder) fs.rmSync(dir, { recursive: true, force: true });
  folder = "";
  expect(problems, "console output").toEqual([]);
});

const tag = (w: string) => `${w}-${mark}`;

/** Four documents, three of them tagged: a note, a task, a board — and a note that is not. */
function vault() {
  const pricing = tag("pricing");
  fs.writeFileSync(
    path.join(dir, "plan.note.md"),
    `---\ntitle: Draft the pricing page\ntags: [${pricing}]\n---\nLead with what a ${word} costs.\n`,
  );
  fs.writeFileSync(
    path.join(dir, "send.note.md"),
    `---\ntitle: Book the interviews\nstatus: todo\ntags: [${pricing}, ${tag("q4")}]\n---\nFive calls.\n`,
  );
  fs.writeFileSync(
    path.join(dir, "flow.board.md"),
    `---\ntitle: Onboarding journey\ntags: [${pricing}]\n---\n\n\`\`\`md {#a x=0 y=0 w=320}\nNothing here.\n\`\`\`\n`,
  );
  fs.writeFileSync(path.join(dir, "other.note.md"), `---\ntitle: Seat counts\n---\nThe ${word} again, untagged.\n`);
  return pricing;
}

async function ready(page: Page, pricing: string) {
  await page.goto(`/?note=${folder}/other`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  /* The tag list has the tag before the box offers it. */
  await expect
    .poll(async () =>
      ((await (await page.request.get("/__board/tags")).json()) as { tags: { name: string }[] }).tags.map((t) => t.name),
    )
    .toContain(pricing);
  await openBoards(page);
  return page.locator("[data-dag-boards] input");
}

test("# offers the tags, a pick is a chip, and with no words the card lists what carries it", async ({ page }) => {
  const pricing = vault();
  const box = await ready(page, pricing);

  await box.fill(`#pricing-${mark.slice(0, 3)}`);
  const option = page.locator(`[data-dag-search-tag-option="${pricing}"]`);
  await expect(option).toContainText("3 documents");
  await box.press("Enter");

  const chip = page.locator(`[data-dag-search-tag="${pricing}"]`);
  await expect(chip).toBeVisible();
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  await expect(box).toHaveAccessibleName(new RegExp(`tagged ${pricing}$`));

  /* No words: every document carrying it, by title, each saying its kind. */
  const rows = page.locator("[data-dag-boards] .dag-panel__list .dag-board");
  await expect(rows).toHaveText([
    /^Book the interviews\s*task$/,
    /^Draft the pricing page\s*note$/,
    /^Onboarding journey\s*board$/,
  ]);
  await expect(page.locator("[data-dag-boards-count]")).toHaveText("3 documents");

  /* A row opens its document. */
  await page.locator(`[data-dag-board="${folder}/flow"]`).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("board")).toBe(`${folder}/flow`);
});

test("a chip and words keep only the hits that carry the tag, and Backspace takes the chip back", async ({ page }) => {
  const pricing = vault();
  const box = await ready(page, pricing);
  await box.fill(word);
  const hit = (leaf: string) => page.locator(`[data-dag-hit="${folder}/${leaf}"]`);
  await expect(hit("plan")).toBeVisible({ timeout: 15_000 });
  await expect(hit("other")).toBeVisible();

  /* `#` at the front picks a tag and gives the words back. */
  await box.fill(`#${pricing}`);
  await page.locator(`[data-dag-search-tag-option="${pricing}"]`).click();
  await box.fill(word);
  await expect(hit("plan")).toBeVisible();
  await expect(hit("other")).toHaveCount(0);
  await expect(page.locator(`[data-dag-note="${folder}/other"]`)).toHaveCount(0);

  /* Backspace at the start of the box: the chip, and the words widen again. */
  await box.press("Home");
  await box.press("Backspace");
  await expect(page.locator("[data-dag-search-tag]")).toHaveCount(0);
  await expect(box).toHaveValue(word);
  await expect(hit("other")).toBeVisible();
});

test("Escape lets go of the words, then the tag, then the card; the chip's × says what it removes", async ({ page }) => {
  const pricing = vault();
  const box = await ready(page, pricing);
  await box.fill(`#${pricing}`);
  await box.press("ArrowDown");
  await expect(page.locator(`[data-dag-search-tag-option="${pricing}"]`)).toBeFocused();
  await page.keyboard.press("Enter");
  await box.fill(word);

  await box.press("Escape");
  await expect(box).toHaveValue("");
  await expect(page.locator(`[data-dag-search-tag="${pricing}"]`)).toBeVisible();
  await box.press("Escape");
  await expect(page.locator("[data-dag-search-tag]")).toHaveCount(0);
  await expect(page.locator("[data-dag-boards]")).toBeVisible();

  await box.fill(`#${pricing}`);
  await box.press("Enter");
  const remove = page.locator("[data-dag-search-tag-remove]");
  await expect(remove).toHaveAccessibleName(`Remove the tag ${pricing}`);
  await remove.click();
  await expect(page.locator("[data-dag-search-tag]")).toHaveCount(0);
  await expect(box).toBeFocused();

  /* A `#` nothing matches says so, and Enter picks nothing. */
  await box.fill("#nothing-like-this");
  await expect(page.locator("[data-dag-search-tags-empty]")).toHaveText("no tag matches “nothing-like-this”");
  await box.press("Enter");
  await expect(page.locator("[data-dag-search-tag]")).toHaveCount(0);
  await box.press("Escape");
  await box.press("Escape");
  await expect(page.locator("[data-dag-boards]")).toHaveCount(0);
});
