import fs from "node:fs";
import path from "node:path";

import { defaultHue } from "../src/note/tags";
import { expectAccessible } from "./axe";
import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";
import { openSettings } from "./sidebar";

/**
 * Settings → This vault → Tags (#327): the vault's tags, each recoloured, renamed, merged into
 * another and deleted from the row it is drawn in — read back from the **files** and from
 * `GET /__board/tags`, because the feature is which documents change and what the tag list holds.
 *
 * Each test works in its own folder, and every tag it names ends in its own id: the suite runs wide
 * over one vault, whose tag list every test shares. What a test registered it deletes after.
 */

let folder = "";
let dir = "";
let mark = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-tagman-${info.testId}`;
  dir = path.join(BOARDS, folder);
  mark = info.testId.replace(/[^0-9a-z]/gi, "").slice(-8);
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

/** A tag name only this test uses. */
const tag = (word: string) => `${word}-${mark}`;
const noteFile = (leaf: string) => path.join(dir, `${leaf}.note.md`);
const read = (leaf: string) => fs.readFileSync(noteFile(leaf), "utf8");

function note(leaf: string, tags: string[]): string {
  fs.writeFileSync(noteFile(leaf), `---\ntitle: ${JSON.stringify(leaf)}\ntags: [${tags.join(", ")}]\n---\nAbout it.\n`);
  return `${folder}/${leaf}`;
}

/** What `GET /__board/tags` says of one tag, or `undefined`. */
async function listed(page: Page, name: string) {
  const got = (await (await page.request.get("/__board/tags")).json()) as {
    tags: { name: string; hue: string; registered: boolean; count: number }[];
  };
  return got.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
}

/** The Tags pane, opened from a note so the vault's listing has been read. */
async function openTags(page: Page, at: string) {
  await page.goto(`/?note=${at}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await openSettings(page, "tags");
  return page.locator('[data-dag-settings-pane="tags"]');
}

const row = (pane: ReturnType<Page["locator"]>, name: string) => pane.locator(`[data-dag-tag-row="${name}"]`);

test("a row says each tag's colour and count, and a swatch recolours it", async ({ page }) => {
  const prices = tag("prices");
  const roadmap = tag("roadmap");
  const at = note("a", [prices]);
  note("b", [prices]);
  await page.request.post("/__board/tags/color", { data: { tag: roadmap, hue: "spruce" } });
  const pane = await openTags(page, at);

  /* Found only in files: its default colour, as a ring, and the words for it. */
  const p = row(pane, prices);
  await expect(p.locator("[data-dag-tag-count]")).toHaveText("2 documents");
  await expect(p.locator(".dag-tags__dot")).toHaveAttribute("data-default", "");
  await expect(p.locator(".dag-tags__default")).toHaveText("Default colour");
  const fallback = defaultHue(prices);
  await expect(p.locator("[data-dag-tag-colour]")).toHaveAccessibleName(
    `Colour of ${prices}: ${fallback[0]!.toUpperCase()}${fallback.slice(1)}, the default`,
  );
  /* Registered and on no document. */
  await expect(row(pane, roadmap).locator("[data-dag-tag-count]")).toHaveText("Unused");

  await p.locator("[data-dag-tag-colour]").click();
  const card = page.locator(`[data-dag-tag-hues="${prices}"]`);
  await expect(card).toBeVisible();
  const pick = fallback === "violet" ? "Teal" : "Violet";
  await card.getByRole("radio", { name: pick, exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(p.locator("[data-dag-tag-colour]")).toBeFocused();
  await expect.poll(async () => (await listed(page, prices))?.hue).toBe(pick.toLowerCase());
  expect((await listed(page, prices))?.registered).toBe(true);
  await expect(p.locator(".dag-tags__default")).toHaveCount(0);
  await expect(p.locator(".dag-tags__dot")).not.toHaveAttribute("data-default", "");

  /* Back to the default: still registered, no longer a ring. */
  await p.locator("[data-dag-tag-colour]").click();
  await page.locator("[data-dag-tag-default]").click();
  await expect.poll(async () => (await listed(page, prices))?.hue).toBe(fallback);
  expect((await listed(page, prices))?.registered).toBe(true);
});

test("renaming a tag rewrites every document, and its colour goes with it", async ({ page }) => {
  const from = tag("prices");
  const to = tag("pricing");
  const at = note("a", [from, tag("keep")]);
  note("b", [from]);
  await page.request.post("/__board/tags/color", { data: { tag: from, hue: "magenta" } });
  const pane = await openTags(page, at);

  await row(pane, from).locator("[data-dag-tag-name]").click();
  const field = page.locator(`[data-dag-tag-rename-input="${from}"]`);
  await expect(field).toBeFocused();
  await expect(field).toHaveAccessibleName(`Rename ${from}`);
  /* A space is a `-` as it is typed. */
  await field.fill("");
  await field.pressSequentially(`pricing ${mark}`);
  await expect(field).toHaveValue(to);
  await field.press("Enter");

  await expect(row(pane, to).locator("[data-dag-tag-count]")).toHaveText("2 documents");
  await expect(row(pane, from)).toHaveCount(0);
  await expect.poll(() => read("a")).toContain(`tags: [${to}, ${tag("keep")}]`);
  expect(read("b")).toContain(`tags: [${to}]`);
  expect(read("a")).not.toContain(from);
  const after = await listed(page, to);
  expect(after).toMatchObject({ hue: "magenta", registered: true, count: 2 });
  expect(await listed(page, from)).toBeUndefined();
});

test("Escape leaves a rename, and digits alone are refused with the reason", async ({ page }) => {
  const name = tag("draft");
  const at = note("a", [name]);
  const pane = await openTags(page, at);

  await row(pane, name).locator("[data-dag-tag-name]").click();
  const field = page.locator(`[data-dag-tag-rename-input="${name}"]`);
  await field.fill("2026");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(pane.getByRole("alert")).toHaveText("A tag needs a letter.");
  await field.press("Enter");
  await expect(field).toBeVisible();
  await field.press("Escape");
  /* Escape was the field's: the modal stays, the name comes back focused, nothing was written. */
  await expect(page.locator("[data-dag-settings]")).toBeVisible();
  await expect(row(pane, name).locator("[data-dag-tag-name]")).toBeFocused();
  expect(read("a")).toContain(`tags: [${name}]`);
});

test("renaming onto a tag that exists asks to merge, and Merge leaves one tag", async ({ page }) => {
  const from = tag("prices");
  const to = tag("pricing");
  const at = note("a", [from]);
  note("b", [from, to]);
  note("c", [to]);
  const pane = await openTags(page, at);

  await row(pane, from).locator("[data-dag-tag-name]").click();
  const field = page.locator(`[data-dag-tag-rename-input="${from}"]`);
  await field.fill(to.toUpperCase());
  await field.press("Enter");
  const ask = page.locator(`[data-dag-tag-merge-ask="${to}"]`);
  await expect(ask).toContainText(`Merge into “${to}”?`);
  await expect(ask).toContainText(`2 documents tagged ${from} will carry ${to}.`);
  /* The ask has the focus on its answer, and Cancel leaves both. */
  await expect(row(pane, from).locator("[data-dag-tag-merge]")).toBeFocused();
  await row(pane, from).getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toHaveCount(0);
  expect(read("a")).toContain(`tags: [${from}]`);

  await row(pane, from).locator("[data-dag-tag-name]").click();
  await field.fill(to);
  await field.press("Enter");
  await row(pane, from).locator("[data-dag-tag-merge]").click();
  await expect(row(pane, from)).toHaveCount(0);
  await expect(row(pane, to).locator("[data-dag-tag-count]")).toHaveText("3 documents");
  await expect.poll(() => read("a")).toContain(`tags: [${to}]`);
  /* A document that had both carries the one. */
  expect(read("b")).toContain(`tags: [${to}]`);
  expect(read("c")).toContain(`tags: [${to}]`);
});

test("Delete… on a used tag asks first, then takes it off every document", async ({ page }) => {
  const name = tag("old");
  const keep = tag("keep");
  const at = note("a", [name, keep]);
  note("b", [name]);
  const pane = await openTags(page, at);

  const more = row(pane, name).locator("[data-dag-tag-more]");
  await expect(more).toHaveAccessibleName(`More for ${name}`);
  await more.click();
  const menu = page.getByRole("menu", { name: `More for ${name}` });
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Delete…" })).toBeFocused();
  await page.keyboard.press("Enter");

  const ask = page.getByRole("alertdialog", { name: "Remove a tag" });
  await expect(ask).toContainText(`Remove “${name}” from 2 documents?`);
  await expect(ask).toContainText(`only “${name}” is taken off`);
  await expectAccessible(page);
  /* Escape is the dialog's: it shuts and Settings stays. */
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await expect(page.locator("[data-dag-settings]")).toBeVisible();
  expect(read("b")).toContain(`tags: [${name}]`);

  await more.click();
  await menu.getByRole("menuitem", { name: "Delete…" }).click();
  await page.locator("[data-dag-tag-delete-confirm]").click();
  await expect(row(pane, name)).toHaveCount(0);
  await expect.poll(() => read("a")).toContain(`tags: [${keep}]`);
  expect(read("b")).not.toContain(name);
  expect(await listed(page, name)).toBeUndefined();
  /* A used tag is not put back with Undo: the dialog was the question. */
  await expect(page.locator("[data-dag-tag-deleted]")).toHaveCount(0);
});

test("deleting an unused tag is done at once, and Undo puts it back with its colour", async ({ page }) => {
  const name = tag("roadmap");
  const at = note("a", [tag("other")]);
  await page.request.post("/__board/tags/color", { data: { tag: name, hue: "crimson" } });
  const pane = await openTags(page, at);

  await row(pane, name).locator("[data-dag-tag-more]").click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(row(pane, name)).toHaveCount(0);
  await expect.poll(async () => listed(page, name)).toBeUndefined();

  const told = page.locator(`[data-dag-tag-deleted="${name}"]`);
  await expect(told).toContainText(`Deleted “${name}”.`);
  await told.locator("[data-dag-tag-undo]").click();
  await expect(row(pane, name).locator("[data-dag-tag-count]")).toHaveText("Unused");
  expect(await listed(page, name)).toMatchObject({ hue: "crimson", registered: true, count: 0 });
  await expect(told).toHaveCount(0);
});

test("a rename that missed a file says which, and Try again finishes it", async ({ page }) => {
  const from = tag("prices");
  const to = tag("pricing");
  const at = note("a", [from]);
  note("b", [from]);
  const pane = await openTags(page, at);

  /* The route's own answer, with one file it wrote reported as kept changing — a 409 partway, which
     the store's contracts make. Only the first answer is changed. */
  let first = true;
  await page.route(/\/__board\/tags\/rename(\?|$)/, async (route) => {
    const real = await route.fetch();
    const body = (await real.json()) as { files: { name: string; kind: string }[]; missed: unknown[] };
    if (first) {
      first = false;
      const b = body.files.findIndex((f) => f.name.endsWith("/b"));
      body.missed = body.files.splice(b, 1);
    }
    await route.fulfill({ response: real, json: body });
  });

  await row(pane, from).locator("[data-dag-tag-name]").click();
  const field = page.locator(`[data-dag-tag-rename-input="${from}"]`);
  await field.fill(to);
  await field.press("Enter");

  const told = page.locator("[data-dag-tag-partial]");
  await expect(told).toContainText("Renamed in 1 of 2 documents. “b” kept changing.");
  await expect(told).toHaveAttribute("role", "alert");
  await told.locator("[data-dag-tag-retry]").click();
  await expect(told).toHaveCount(0);
  await expect.poll(() => read("b")).toContain(`tags: [${to}]`);
  expect(read("a")).toContain(`tags: [${to}]`);
});

test("the pane and its colour card pass axe, and Escape shuts the card without Settings", async ({ page }) => {
  const name = tag("design");
  const at = note("a", [name]);
  const pane = await openTags(page, at);
  await expectAccessible(page);
  await row(pane, name).locator("[data-dag-tag-colour]").click();
  /* The colour card is a radiogroup with one Tab stop, the current colour. */
  const card = page.locator(`[data-dag-tag-hues="${name}"]`);
  await expect(card.locator('[role="radio"][tabindex="0"]')).toBeFocused();
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(row(pane, name).locator("[data-dag-tag-colour]")).toBeFocused();
  await expect(page.locator("[data-dag-settings]")).toBeVisible();
});
