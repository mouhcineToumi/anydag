import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";
import { lead } from "./keys";

/**
 * Wrapping in a container, a container's shape and direction, and start and end states.
 *
 * Each of these used to be a line somebody had to type, and the diagram panel's Source tab is going,
 * so each has a control and this is the proof that the control reaches the file: wrap the picked card
 * in a `group` (or a `lane`, where the dialect has bands), turn a `group` into a `system` and back,
 * give it a `dir=`, drop a start or an end state from the library and draw to it, and grow one off
 * a card with the panel.
 *
 * Every check reads the bytes, because every one of these is a write to a document a person owns.
 *
 * One board per test: the suite runs in parallel and these write to disk.
 */

const DIR = BOARDS;

const BOARD = `---
title: Wrap me
---

\`\`\`arch {#infra x=0 y=0}
service api "The API" icon=server
store db "Database"

api --> db "reads"
\`\`\`

\`\`\`erd {#model x=640 y=0}
entity order { id uuid pk }
entity item { id uuid pk; order_id uuid fk }
\`\`\`

\`\`\`state {#life x=0 y=420}
state draft "Draft"
state live "Live"

draft --> live "publish"
\`\`\`

\`\`\`flow {#steps x=640 y=420}
step a "First"
step b "Second"

a --> b
\`\`\`

\`\`\`usecase {#uses x=0 y=840}
group sys "Billing" {
  usecase pay "Pay"
}
actor user "Customer"
user --> pay
\`\`\`

\`\`\`sketch {#wire x=640 y=840}
box hero "Hero" x=0 y=0 w=160 h=64
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-groups-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");
/** One diagram's body, so a check about it cannot be answered by another diagram's. */
const bodyOf = (id: string) => {
  const after = read().split(`{#${id}`)[1] ?? "";
  return (after.split("```")[0] ?? "").split("\n").slice(1).join("\n");
};

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** Click, pause, click: the second press picks the card out, and Chromium pairs fast ones. */
async function pick(page: Page, selector: string) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.locator(selector).click();
  await page.waitForTimeout(400);
  await page.locator(selector).click();
  await expect(page.locator(`${selector}[data-dag-picked]`)).toHaveCount(1);
}

/** Pick a card and open the panel on it. */
async function props(page: Page, selector: string) {
  await pick(page, selector);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-props]")).toHaveCount(1);
}

/**
 * Pick a group and open the panel on it.
 *
 * A group is reached the way a card is (#145): the first click takes the diagram, the second, on
 * the group's name, picks the group. It used to take a double-click, which opens the rename, and an
 * Escape to put the rename away.
 */
async function propsOfGroup(page: Page, item: string, group: string) {
  const ring = `[data-dag-item="${item}"] [data-dag-group="${group}"]`;
  const label = page.locator(`${ring} [data-dag-title]`);
  await label.click();
  await page.waitForTimeout(400);
  await label.click();
  await expect(page.locator(`${ring}[data-dag-picked]`)).toHaveCount(1);
  await expect(page.locator("[data-dag-rename-box]")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-props]")).toHaveCount(1);
}

/** The rename box a wrap opens on the container it made; Escape leaves the default name. */
async function leaveName(page: Page) {
  await expect(page.locator("[data-dag-rename-box]")).toBeVisible({ timeout: 10_000 });
  await page.locator("[data-dag-rename-box]").press("Escape");
}

/* ----------------------------------------------------------------------------------- wrap */

test("wrapping a card in a group writes the group round that one statement", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  await props(page, '[data-dag-item="infra"] [data-dag-node="api"]');

  const wrap = page.locator("[data-dag-prop-wrap]");
  await expect(wrap).toHaveAttribute("data-dag-prop-wrap", "group");
  await wrap.click();

  await expect
    .poll(() => bodyOf("infra"), { timeout: 5_000 })
    .toBe('group group2 "Group" {\n  service api "The API" icon=server\n}\nstore db "Database"\n\napi --> db "reads"\n');
  /* The new container is what is picked, and the rename is open on it — name it where it is drawn. */
  await expect(page.locator("[data-dag-rename-box]")).toBeVisible({ timeout: 10_000 });
  await page.locator("[data-dag-rename-box]").fill("Backend");
  await page.locator("[data-dag-rename-box]").press("Enter");
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain('group group2 "Backend" {');

  await expect(page.locator('[data-dag-item="infra"] [data-dag-group="group2"]')).toHaveCount(1);
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
  /* Nothing in any other diagram was touched. */
  expect(read()).toContain("entity order { id uuid pk }");
});

test("one ctrl+Z takes the wrap back", async ({ page }) => {
  await open(page);
  await props(page, '[data-dag-item="infra"] [data-dag-node="api"]');
  await page.locator("[data-dag-prop-wrap]").click();
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain("group group2");
  await leaveName(page);

  /* Focus is in the panel's own controls; the canvas takes ctrl+Z from the paper. */
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("Control+z");
  await expect.poll(read, { timeout: 5_000 }).toBe(BOARD);
});

test("an entity can be wrapped, which is what fk=<group> needs", async ({ page }) => {
  await open(page);
  await props(page, '[data-dag-item="model"] [data-dag-node="order"]');
  await page.locator("[data-dag-prop-wrap]").click();
  await expect
    .poll(() => bodyOf("model"), { timeout: 5_000 })
    .toBe('group group2 "Group" {\n  entity order { id uuid pk }\n}\nentity item { id uuid pk; order_id uuid fk }\n');
  await leaveName(page);
  await expect(page.locator('[data-dag-item="model"] [data-dag-group="group2"]')).toHaveCount(1);
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("a state can be wrapped, and a group can be wrapped again", async ({ page }) => {
  await open(page);
  await props(page, '[data-dag-item="life"] [data-dag-node="draft"]');
  await page.locator("[data-dag-prop-wrap]").click();
  await expect.poll(() => bodyOf("life"), { timeout: 5_000 }).toContain('group group2 "Group" {\n  state draft "Draft"\n}');
  await leaveName(page);

  /* The new group is what is picked, so the same button wraps *it*. */
  await expect(page.locator("[data-dag-props]")).toHaveCount(1);
  await page.locator("[data-dag-prop-wrap]").click();
  await expect
    .poll(() => bodyOf("life"), { timeout: 5_000 })
    .toContain('group group3 "Group" {\n  group group2 "Group" {\n    state draft "Draft"\n  }\n}');
  await leaveName(page);
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("a flow card is wrapped in a lane, and a card already in one is offered none", async ({ page }) => {
  await open(page);
  await props(page, '[data-dag-item="steps"] [data-dag-node="a"]');
  const wrap = page.locator("[data-dag-prop-wrap]");
  await expect(wrap).toHaveAttribute("data-dag-prop-wrap", "lane");
  await wrap.click();
  await expect.poll(() => bodyOf("steps"), { timeout: 5_000 }).toContain('lane lane2 "Lane" {\n  step a "First"\n}');
  await leaveName(page);

  /* `a` is in a band now, and a band in a band is not something the lane layout draws. */
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await props(page, '[data-dag-item="steps"] [data-dag-node="a"]');
  await expect(page.locator("[data-dag-prop-wrap]")).toHaveCount(0);
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("a shape on a sketch is wrapped in a frame with a box of its own, and stays where it was", async ({ page }) => {
  await open(page);
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("0");
  const was = (await page.locator('[data-dag-node="hero"]').boundingBox())!;
  await props(page, '[data-dag-node="hero"]');
  await page.locator("[data-dag-prop-wrap]").click();

  await expect
    .poll(() => bodyOf("wire"), { timeout: 5_000 })
    .toMatch(/group group2 "Group" x=-?\d+ y=-?\d+ w=\d+ h=\d+ \{\n {2}box hero "Hero" w=160 h=64 x=\d+ y=\d+\n\}/);
  await leaveName(page);
  await expect(page.locator('[data-dag-node="hero"]')).toBeVisible();
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
  const now = (await page.locator('[data-dag-node="hero"]').boundingBox())!;
  /* The container appeared round the card; the card did not move under the pointer. */
  expect(now.width).toBeCloseTo(was.width, 0);
  expect(now.height).toBeCloseTo(was.height, 0);
});

/* ------------------------------------------------------------------- shape and direction */

test("a group's shape is a group or a system, and the line says which", async ({ page }) => {
  await open(page);
  await propsOfGroup(page, "uses", "sys");

  const shape = page.locator("[data-dag-prop-shape]");
  await expect(shape).toHaveValue("group");
  await shape.selectOption("system");
  await expect.poll(() => bodyOf("uses"), { timeout: 5_000 }).toContain('system sys "Billing" {');
  await expect(shape).toHaveValue("system");

  await shape.selectOption("group");
  await expect.poll(() => bodyOf("uses"), { timeout: 5_000 }).toContain('group sys "Billing" {');
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("a group in a dialect with no system word is offered no shape", async ({ page }) => {
  fs.writeFileSync(file, `\`\`\`arch {#infra x=0 y=0}\ngroup gcp "Cloud" {\n  service a "A"\n}\n\`\`\`\n`);
  await open(page);
  await propsOfGroup(page, "infra", "gcp");
  await expect(page.locator("[data-dag-prop-shape]")).toHaveCount(0);
  await expect(page.locator("[data-dag-prop-group-dir]")).toHaveCount(1);
});

test("a group and a lane are picked with one click, as a card is, and the card inside is still its own", async ({ page }) => {
  fs.writeFileSync(
    file,
    `${BOARD}\n\`\`\`flow {#lanes x=1280 y=0}\nlane ops "Ops" {\n  step c "Check"\n}\nlane dev "Dev" {\n  step d "Deploy"\n}\nc --> d\n\`\`\`\n`,
  );
  await open(page);
  const ring = '[data-dag-item="uses"] [data-dag-group="sys"]';
  /* The first click takes the diagram; the second, on the group's name, picks the group. */
  await page.locator(`${ring} [data-dag-title]`).click();
  await page.waitForTimeout(400);
  await page.locator(`${ring} [data-dag-title]`).click();
  await expect(page.locator(`${ring}[data-dag-picked]`)).toHaveCount(1);
  await expect(page.locator("[data-dag-rename-box]")).toHaveCount(0);
  /* A card inside it is still the card. */
  await page.waitForTimeout(400);
  await page.locator('[data-dag-item="uses"] [data-dag-node="pay"]').click();
  await expect(page.locator('[data-dag-item="uses"] [data-dag-node="pay"][data-dag-picked]')).toHaveCount(1);
  await expect(page.locator(`${ring}[data-dag-picked]`)).toHaveCount(0);

  /* A swimlane's band, by its label. */
  const label = page.locator('[data-dag-item="lanes"] [data-dag-lane-label="dev"]');
  await label.scrollIntoViewIfNeeded();
  await label.click();
  await page.waitForTimeout(400);
  await label.click();
  await expect(page.locator('[data-dag-item="lanes"] [data-dag-lane="dev"][data-dag-picked]')).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-props]")).toHaveAttribute("data-dag-props", "dev");
});

test("a group's direction is dir=TB or dir=LR, and 'follow the diagram' takes it off", async ({ page }) => {
  fs.writeFileSync(file, `\`\`\`arch {#infra x=0 y=0}\ngroup gcp "Cloud" {\n  service a "A"\n  service b "B"\n}\n\`\`\`\n`);
  await open(page);
  await propsOfGroup(page, "infra", "gcp");

  const dir = page.locator("[data-dag-prop-group-dir]");
  await expect(dir).toHaveValue("");
  await dir.selectOption("TB");
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain('group gcp "Cloud" dir=TB {');
  await dir.selectOption("LR");
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain('group gcp "Cloud" dir=LR {');
  await dir.selectOption("");
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain('group gcp "Cloud" {');
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

/* ------------------------------------------------------------------ start and end states */

test("a start state dropped from the library is drawn, and a handle ends on it", async ({ page }) => {
  await open(page);
  await lead(page, "l");
  await page.fill("[data-dag-library-search]", "start");
  const card = page.locator('[data-dag-component="part-state-start"]');
  await card.scrollIntoViewIfNeeded();
  const from = (await card.boundingBox())!;
  const into = (await page.locator('[data-dag-item="life"]').boundingBox())!;
  await page.mouse.move(from.x + 30, from.y + 15);
  await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y + 35, { steps: 4 });
  await page.mouse.move(into.x + into.width / 2, into.y + 40, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => bodyOf("life"), { timeout: 5_000 }).toContain("start begin1");
  await expect(page.locator('[data-dag-item="life"] [data-dag-node="begin1"]')).toHaveAttribute("data-dag-kind", "start");

  /* Close the library so its panel is not between the pointer and the card, then pull a link from
     the start state onto `draft`: a declared state has an id, so there is something to end on. */
  await page.keyboard.press("Escape");
  await pick(page, '[data-dag-item="life"] [data-dag-node="begin1"]');
  const handle = (await page.locator('.dag-nodetools [data-dag-connect="e"]').boundingBox())!;
  const target = (await page.locator('[data-dag-item="life"] [data-dag-node="draft"]').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => bodyOf("life"), { timeout: 5_000 }).toContain("begin1 --> draft");
  expect(read()).not.toContain("```edges");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("a link pulled onto an end state ends on it, and a second one shares it", async ({ page }) => {
  fs.writeFileSync(file, `\`\`\`state {#life x=0 y=0}\nstate a "A"\nstate b "B"\nend done\n\na --> b\n\`\`\`\n`);
  await open(page);
  for (const from of ["a", "b"]) {
    await pick(page, `[data-dag-node="${from}"]`);
    const handle = (await page.locator('.dag-nodetools [data-dag-connect="s"]').boundingBox())!;
    const target = (await page.locator('[data-dag-node="done"]').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => bodyOf("life"), { timeout: 5_000 }).toContain(`${from} --> done`);
    await page.keyboard.press("Escape");
  }
  /* One ring, two lines into it — which `[*]` cannot say, since each mention is its own. */
  await expect(page.locator('[data-dag-node][data-dag-kind="end"]')).toHaveCount(1);
});

test("the panel grows a start state in front of a card and an end state behind it, edge included", async ({ page }) => {
  await open(page);
  await props(page, '[data-dag-item="life"] [data-dag-node="draft"]');

  await page.locator('[data-dag-prop-pseudo="start"]').click();
  await expect
    .poll(() => bodyOf("life"), { timeout: 5_000 })
    .toBe('state draft "Draft"\nstart start2\nstate live "Live"\n\ndraft --> live "publish"\nstart2 --> draft\n');
  await expect(page.locator('[data-dag-item="life"] [data-dag-node="start2"]')).toHaveAttribute("data-dag-kind", "start");

  /* The new state is what is picked, and a start state is offered no start or end of its own. */
  await expect(page.locator("[data-dag-prop-pseudo]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await props(page, '[data-dag-item="life"] [data-dag-node="live"]');
  await page.locator('[data-dag-prop-pseudo="end"]').click();
  await expect.poll(() => bodyOf("life"), { timeout: 5_000 }).toMatch(/end end2\n[\s\S]*live --> end2/);
  await expect(page.locator('[data-dag-item="life"] [data-dag-node="end2"]')).toHaveAttribute("data-dag-kind", "end");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("a legacy [*] is offered a name, and with one it is a start state like any other", async ({ page }) => {
  fs.writeFileSync(
    file,
    `${BOARD}\n\`\`\`state {#old x=1280 y=0}\nstate open "Open"\nstate shut "Shut"\n\n[*] --> open\nopen --> shut\nshut --> [*]\n\`\`\`\n`,
  );
  await open(page);
  const dot = '[data-dag-item="old"] [data-dag-node^="__start-"]';
  await pick(page, dot);
  await page.keyboard.press("Enter");
  /* No controls that would write into the edge's line: only the explanation and the one button. */
  await expect(page.locator("[data-dag-legacy-pseudo]")).toHaveAttribute("data-dag-legacy-pseudo", "start");
  await expect(page.locator("[data-dag-prop-kind]")).toHaveCount(0);
  await page.locator('[data-dag-prop-convert-pseudo="start"]').click();
  await expect
    .poll(() => bodyOf("old"), { timeout: 5_000 })
    .toBe('state open "Open"\nstate shut "Shut"\n\nstart start2\nstart2 --> open\nopen --> shut\nshut --> [*]\n');
  /* The pick follows it: the start state now has an id, and the panel is the start state's own. */
  await expect(page.locator('[data-dag-item="old"] [data-dag-node="start2"][data-dag-picked]')).toHaveCount(1);
  await expect(page.locator("[data-dag-legacy-pseudo]")).toHaveCount(0);
});

test("a start state has no title, colour or status to set — and a plus from it grows a real state", async ({ page }) => {
  fs.writeFileSync(file, `\`\`\`state {#life x=0 y=0}\nstart s0\nstate a "A"\n\ns0 --> a\n\`\`\`\n`);
  await open(page);
  await props(page, '[data-dag-node="s0"]');
  await expect(page.locator("[data-dag-prop-title]")).toHaveCount(0);
  await expect(page.locator("[data-dag-prop-status]")).toHaveCount(0);
  /* The kind menu is how it becomes a state — or an end. */
  await expect(page.locator("[data-dag-prop-kind] option")).toContainText(["state", "start", "end"]);

  await page.locator('[data-dag-plus="e"]').click();
  await leaveName(page);
  await expect.poll(() => bodyOf("life"), { timeout: 5_000 }).toContain('state state2 "New state"');
  expect(bodyOf("life")).toMatch(/s0 --> state2/);
});
