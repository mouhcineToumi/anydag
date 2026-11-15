import fs from "node:fs";
import path from "node:path";

import { defaultHue } from "../src/note/tags";
import { expectAccessible } from "./axe";
import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";
import { pageMore } from "./more";
import { openSidebar } from "./sidebar";

/**
 * Tags (#327): the note page's Tags row, *Tags…* on a board and a sidebar row, a tag made where it is
 * typed, a chip's colour changed in place — read back from the **file** and from `GET /__board/tags`,
 * because the feature is which line of the frontmatter changes and what `.anydag/tags.json` holds.
 *
 * Each test works in its own folder, and every tag it names ends in its own id: the suite runs wide
 * over one vault, whose tag list every test shares. What a test registered it deletes after.
 */

let folder = "";
let dir = "";
let mark = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-tags-${info.testId}`;
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
  /* Every tag this test could have registered, then only the folder it made. */
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
const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");

function note(leaf: string, lines: string[] = [], body = "What it is about.\n"): string {
  fs.writeFileSync(noteFile(leaf), `---\ntitle: ${JSON.stringify(leaf)}\n${lines.map((l) => `${l}\n`).join("")}---\n${body}`);
  return `${folder}/${leaf}`;
}

async function ready(page: Page) {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** What `GET /__board/tags` says of one tag, or `undefined`. */
async function listed(page: Page, name: string) {
  const got = (await (await page.request.get("/__board/tags")).json()) as {
    tags: { name: string; hue: string; registered: boolean; count: number }[];
  };
  return got.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
}

async function openRow(page: Page) {
  const row = page.locator("[data-dag-note-tags]");
  await expect(row.locator("[data-dag-tag-add]")).toBeEnabled();
  await row.locator("[data-dag-tag-add]").click();
  const input = row.locator("[data-dag-tag-input]");
  await expect(input).toBeFocused();
  return { row, input };
}

test("a note's Tags row suggests the vault's tags, and Enter takes the one highlighted", async ({ page }) => {
  const research = tag("research");
  note("other", [`tags: [${research}]`]);
  const name = note("plan");
  await page.goto(`/?note=${name}`);
  await ready(page);

  const { input } = await openRow(page);
  /* The ARIA 1.2 combobox: the field names its list and the row it would take. */
  await expect(input).toHaveAttribute("role", "combobox");
  /* A start only this test's tag has: the vault is shared with the tests beside it. */
  const typed = research.slice(0, -2);
  await input.pressSequentially(typed);
  await expect(input).toHaveAttribute("aria-expanded", "true");
  const option = page.locator(`[data-dag-tag-option="${research}"]`);
  await expect(option).toHaveAttribute("aria-selected", "true");
  const list = await input.getAttribute("aria-controls");
  await expect(page.locator(`[role="listbox"][id="${list}"]`)).toBeVisible();
  await expect(input).toHaveAttribute("aria-activedescendant", (await option.getAttribute("id"))!);
  /* Enter takes the highlighted row, so the existing tag wins over making what was typed. */
  await expect(page.locator(`[data-dag-tag-create="${typed}"]`)).toHaveAttribute("aria-selected", "false");
  await input.press("Enter");

  await expect.poll(() => read(noteFile("plan"))).toContain(`\ntags: [${research}]\n`);
  await expect(page.locator(`[data-dag-note-tags] [data-dag-tag="${research}"]`)).toBeVisible();
  /* The field empties and keeps the focus, for the next one. */
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  /* An existing tag registers nothing. */
  expect((await listed(page, research))?.registered).toBe(false);
});

test("a new name is made where it is typed: a space is a -, and Enter creates it in its default colour", async ({ page }) => {
  const name = note("plan");
  await page.goto(`/?note=${name}`);
  await ready(page);

  const { input } = await openRow(page);
  await input.pressSequentially(`two words ${mark}`);
  const made = `two-words-${mark}`;
  await expect(input).toHaveValue(made);
  const create = page.locator(`[data-dag-tag-create="${made}"]`);
  const hue = defaultHue(made);
  const label = hue.charAt(0).toUpperCase() + hue.slice(1);
  await expect(create).toHaveAttribute("aria-label", `Create tag ${made}, colour ${label}, default`);
  await expect(create).toHaveAttribute("aria-selected", "true");
  /* The ten swatches under it, the default chosen. */
  const strip = page.locator(`[role="radiogroup"][aria-label="Colour for ${made}"]`);
  await expect(strip.locator('[role="radio"]')).toHaveCount(10);
  await expect(strip.locator(`[data-dag-palette-hue="${hue}"]`)).toHaveAttribute("aria-checked", "true");
  await input.press("Enter");

  await expect.poll(() => read(noteFile("plan"))).toContain(`\ntags: [${made}]\n`);
  await expect.poll(async () => (await listed(page, made))?.registered).toBe(true);
  expect((await listed(page, made))?.hue).toBe(hue);
});

test("the keyboard reaches the swatches: Tab, the arrows to choose, Enter to create", async ({ page }) => {
  const name = note("plan");
  await page.goto(`/?note=${name}`);
  await ready(page);

  const { input } = await openRow(page);
  const made = tag("roadmap");
  await input.pressSequentially(made);
  const strip = page.locator(`[role="radiogroup"][aria-label="Colour for ${made}"]`);
  /* One Tab stop: the chosen swatch. */
  await expect(strip.locator('[role="radio"][tabindex="0"]')).toHaveCount(1);
  await input.press("Tab");
  const start = defaultHue(made);
  await expect(strip.locator(`[data-dag-palette-hue="${start}"]`)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const order = ["indigo", "teal", "coral", "spruce", "ochre", "violet", "magenta", "moss", "crimson", "bronze"];
  const next = order[(order.indexOf(start) + 1) % order.length]!;
  await expect(strip.locator(`[data-dag-palette-hue="${next}"]`)).toHaveAttribute("aria-checked", "true");
  await expect(strip.locator(`[data-dag-palette-hue="${next}"]`)).toBeFocused();
  /* The create row says the colour it will make. */
  await expect(page.locator(`[data-dag-tag-create="${made}"]`)).toHaveAttribute("aria-label", new RegExp(`colour ${next}`, "i"));
  /* Escape goes back to the field, and Tab comes back to the choice. */
  await page.keyboard.press("Escape");
  await expect(input).toBeFocused();
  await input.press("Tab");
  await expect(strip.locator(`[data-dag-palette-hue="${next}"]`)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect.poll(() => read(noteFile("plan"))).toContain(`\ntags: [${made}]\n`);
  await expect.poll(async () => (await listed(page, made))?.hue).toBe(next);
  await expect(input).toBeFocused();
});

test("a press on a swatch creates the tag in that colour, and a typo taken off again is not kept", async ({ page }) => {
  const name = note("plan");
  await page.goto(`/?note=${name}`);
  await ready(page);

  const { input } = await openRow(page);
  const made = tag("roadmpa");
  await input.pressSequentially(made);
  await page.locator(`[role="radiogroup"][aria-label="Colour for ${made}"] [data-dag-palette-hue="crimson"]`).click();
  await expect.poll(() => read(noteFile("plan"))).toContain(`\ntags: [${made}]\n`);
  await expect.poll(async () => (await listed(page, made))?.hue).toBe("crimson");

  /* Taken off in the same sitting, on no other document: out of the tag list too. */
  await page.locator(`[data-dag-tag-remove="${made}"]`).click();
  await expect.poll(() => read(noteFile("plan"))).not.toContain("tags:");
  await expect.poll(async () => await listed(page, made)).toBeUndefined();
});

test("a name of digits alone is the one refusal, with its fix a press away", async ({ page }) => {
  const name = note("plan");
  await page.goto(`/?note=${name}`);
  await ready(page);

  const { input } = await openRow(page);
  await input.pressSequentially("2026");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  const why = page.locator("[data-dag-tag-problem]");
  await expect(why).toContainText("A tag needs a letter.");
  /* The message is the field's description, so a screen reader reads the two together. */
  await expect(input).toHaveAttribute("aria-describedby", (await why.getAttribute("id"))!);
  await expect(page.locator("[data-dag-tag-create]")).toHaveCount(0);
  await page.locator('[data-dag-tag-fix="q-2026"]').click();
  await expect(input).toHaveValue("q-2026");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
});

test("a chip's dot recolours the tag in place, and Backspace in an empty field takes the last chip off", async ({ page }) => {
  const pricing = tag("pricing");
  const meeting = tag("meeting");
  const name = note("plan", [`tags: [${meeting}, ${pricing}]`]);
  await page.goto(`/?note=${name}`);
  await ready(page);

  const pick = page.locator(`[data-dag-tag-pick="${pricing}"]`);
  await expect(pick).toHaveAttribute("aria-haspopup", "dialog");
  await pick.click();
  await expect(pick).toHaveAttribute("aria-expanded", "true");
  const card = page.locator(`[data-dag-tag-hues="${pricing}"]`);
  await expect(card).toHaveAttribute("role", "dialog");
  await card.locator('[data-dag-palette-hue="teal"]').click();
  await expect(card).toHaveCount(0);
  await expect(pick).toBeFocused();
  await expect.poll(async () => (await listed(page, pricing))?.hue).toBe("teal");
  expect((await listed(page, pricing))?.registered).toBe(true);
  /* The colour is the vault's, not the file's: the note is as it was. */
  expect(read(noteFile("plan"))).toContain(`tags: [${meeting}, ${pricing}]`);

  /* *Use the default colour* puts it back. */
  await pick.click();
  await page.locator("[data-dag-tag-default]").click();
  await expect.poll(async () => (await listed(page, pricing))?.hue).toBe(defaultHue(pricing));

  const { input } = await openRow(page);
  await input.press("Backspace");
  await expect.poll(() => read(noteFile("plan"))).toContain(`\ntags: [${meeting}]\n`);
});

test("a task's Tags row sits with its other properties", async ({ page }) => {
  const name = note("task", ["status: todo", `tags: [${tag("q4")}]`]);
  await page.goto(`/?note=${name}`);
  await ready(page);
  const bar = page.locator("[data-dag-taskbar]");
  await expect(bar.locator(`[data-dag-note-tags] [data-dag-tag="${tag("q4")}"]`)).toBeVisible();
  await expect(page.locator("[data-dag-tagbar]")).toHaveCount(0);
});

test("Tags… in a board's ⋯ opens the editor under it, and a tag made there is written to the board's frontmatter", async ({
  page,
}) => {
  const file = path.join(dir, "flow.board.md");
  fs.writeFileSync(file, "```md {#intro x=0 y=0 w=320}\n# Checkout\n```\n");
  await page.goto(`/?board=${folder}/flow`);
  await ready(page);
  await pageMore(page, "data-dag-toolbar-tags");

  const pop = page.locator(`[data-dag-tagpop="${folder}/flow"]`);
  await expect(pop).toHaveAttribute("role", "dialog");
  const input = pop.locator("[data-dag-tag-input]");
  await expect(input).toBeFocused();
  const made = tag("design");
  await input.pressSequentially(made);
  await pop.locator(`[data-dag-palette-hue="magenta"]`).click();
  /* A board's new frontmatter is apart from its body by a blank line. */
  await expect.poll(() => read(file)).toBe(`---\ntags: [${made}]\n---\n\n\`\`\`md {#intro x=0 y=0 w=320}\n# Checkout\n\`\`\`\n`);
  await expect.poll(async () => (await listed(page, made))?.hue).toBe("magenta");
  await expect(pop.locator(`[data-dag-tag="${made}"]`)).toBeVisible();

  /* Escape shuts it, and the focus goes back to the ⋯. */
  await input.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(page.locator("[data-dag-page-more]")).toBeFocused();
});

test("every text's sidebar row has Tags…, and an attachment's has none", async ({ page }) => {
  const name = note("plan");
  const table = path.join(dir, "deals.table.md");
  fs.writeFileSync(table, "## Deals {#deals}\n\n| Name {#name} |\n| --- |\n| Acme {#racme} |\n");
  await page.goto(`/?note=${name}`);
  await ready(page);
  await openSidebar(page);

  const row = page.locator(`[data-dag-sidebar-file="${folder}/deals"]`);
  await row.click({ button: "right" });
  await page.locator('[data-dag-sidebar-menu-item="tags"]').click();
  const pop = page.locator(`[data-dag-tagpop="${folder}/deals"]`);
  const input = pop.locator("[data-dag-tag-input]");
  await expect(input).toBeFocused();
  const made = tag("pipeline");
  await input.pressSequentially(made);
  await input.press("Enter");
  await expect.poll(() => read(table)).toMatch(new RegExp(`^---\\ntags: \\[${made}\\]\\n---\\n`));
  await expect(pop.locator(`[data-dag-tag="${made}"]`)).toBeVisible();
  /* A press outside shuts it. */
  await page.locator("[data-dag-note-view]").click({ position: { x: 5, y: 5 } });
  await expect(pop).toHaveCount(0);
});

test("swatches and chips are 24px targets on a desktop and 44px under 720px", async ({ page }) => {
  const pricing = tag("pricing");
  const name = note("plan", [`tags: [${pricing}]`]);
  await page.goto(`/?note=${name}`);
  await ready(page);

  const pick = page.locator(`[data-dag-tag-pick="${pricing}"]`);
  let box = (await pick.boundingBox())!;
  expect(Math.round(box.width)).toBeGreaterThanOrEqual(24);
  expect(Math.round(box.height)).toBeGreaterThanOrEqual(24);
  await pick.click();
  const swatch = page.locator(`[data-dag-tag-hues="${pricing}"] [data-dag-palette-hue="teal"]`);
  box = (await swatch.boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([24, 24]);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 800 });
  const chip = page.locator(`[data-dag-note-tags] [data-dag-tag="${pricing}"]`);
  await expect.poll(async () => Math.round((await chip.boundingBox())!.height)).toBe(44);
  const remove = page.locator(`[data-dag-tag-remove="${pricing}"]`);
  box = (await remove.boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([44, 44]);
  /* A tap anywhere on the chip but its × opens the colour picker. */
  await chip.click();
  box = (await swatch.boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([44, 44]);
  /* Two rows of five. */
  const first = (await page.locator(`[data-dag-tag-hues="${pricing}"] [data-dag-palette-hue="indigo"]`).boundingBox())!;
  const sixth = (await page.locator(`[data-dag-tag-hues="${pricing}"] [data-dag-palette-hue="violet"]`).boundingBox())!;
  expect(sixth.y).toBeGreaterThan(first.y);
  expect(Math.round(sixth.x)).toBe(Math.round(first.x));
});

test("read only, a note's tags are chips above its text", async ({ page }) => {
  const research = tag("research");
  const name = note("plan", [`tags: [${research}]`]);
  await page.goto(`/?note=${name}&view=1`);
  await ready(page);
  const line = page.locator("[data-dag-tagline]");
  await expect(line.locator(`[data-dag-tag="${research}"]`)).toBeVisible();
  await expect(line.locator("button")).toHaveCount(0);
});

test("the editor open, a new name typed, and the Tags… card pass the accessibility gate", async ({ page }) => {
  const meeting = tag("meeting");
  const name = note("plan", [`tags: [${meeting}]`]);
  await page.goto(`/?note=${name}`);
  await ready(page);
  const { input } = await openRow(page);
  await input.pressSequentially(tag("roadmap"));
  await expect(page.locator(`[data-dag-tag-create="${tag("roadmap")}"]`)).toBeVisible();
  await expectAccessible(page);
  await page.locator(`[data-dag-tag-pick="${meeting}"]`).click();
  await expect(page.locator(`[data-dag-tag-hues="${meeting}"]`)).toBeVisible();
  await expectAccessible(page);

  const file = path.join(dir, "flow.board.md");
  fs.writeFileSync(file, "```md {#intro x=0 y=0 w=320}\n# Checkout\n```\n");
  await page.goto(`/?board=${folder}/flow`);
  await ready(page);
  await pageMore(page, "data-dag-toolbar-tags");
  await expect(page.locator("[data-dag-tagpop] [data-dag-tag-input]")).toBeFocused();
  await expectAccessible(page);
});
