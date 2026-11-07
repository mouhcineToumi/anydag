import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";

/**
 * F3: building a diagram with the pointer alone.
 *
 * Three gestures, and between them they are the whole of "a person can draw without seeing the
 * DSL": double-click renames the thing under the pointer, the `+` on a picked card grows the next
 * one with the edge already drawn, and a round handle pulled onto another card in the same diagram
 * writes an edge *in that diagram's body* rather than a board-level link over the top of it.
 *
 * Every check reads the bytes, because every one of these is a write to a document a person owns.
 *
 * One board per test: the suite runs in parallel and these write to disk.
 */

const DIR = BOARDS;

const BOARD = `---
title: Build
---

\`\`\`arch {#infra x=0 y=0 title="Infra"}
service api "The API" icon=server
store db "Database"

group gcp "Google Cloud" {
  service jobs "Jobs"
}
\`\`\`

\`\`\`sketch {#wire x=760 y=0}
box hero "Hero" x=0 y=0 w=160 h=64
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-build-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");
/** The diagram's body, so a check about the fence cannot be answered by the `edges` one. */
const bodyOf = (id: string) => {
  const after = read().split(`{#${id}`)[1] ?? "";
  /* Past the rest of the fence line, and up to the closing fence: the body and nothing else, so a
     check about a diagram cannot be answered by an `edges` fence somewhere further down. */
  return (after.split("```")[0] ?? "").split("\n").slice(1).join("\n");
};

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** Click, pause, click: the second press picks the card out, and Chromium pairs fast ones. */
async function pick(page: Page, selector: string) {
  await page.locator(selector).click();
  await page.waitForTimeout(400);
  await page.locator(selector).click();
  await expect(page.locator(`${selector}[data-dag-picked]`)).toHaveCount(1);
}

const centreOf = async (page: Page, selector: string) => {
  const b = (await page.locator(selector).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/* --------------------------------------------------------------------------- inline rename */

test("double-clicking a card renames it where it is drawn", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-node="api"]').dblclick();

  const box = page.locator("[data-dag-rename-box]");
  await expect(box).toBeVisible();
  /* It opens with what the *file* says, not with what the card draws. */
  await expect(box).toHaveValue("The API");

  await box.fill("Public API");
  await box.press("Enter");
  await expect.poll(read, { timeout: 5_000 }).toContain('service api "Public API" icon=server');
  await expect(page.locator("[data-dag-rename-box]")).toHaveCount(0);
  /* And the panel did not open: the gesture is the rename, not a detour through the controls. */
  await expect(page.locator("[data-dag-inspector]")).toHaveCount(0);
});

test("escape puts the old name back and writes nothing", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-node="db"]').dblclick();
  await page.locator("[data-dag-rename-box]").fill("Postgres");
  await page.locator("[data-dag-rename-box]").press("Escape");

  await expect(page.locator("[data-dag-rename-box]")).toHaveCount(0);
  await page.waitForTimeout(400);
  expect(read()).toBe(BOARD);
});

test("the same gesture renames a group's label", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-group="gcp"] [data-dag-title]').dblclick();
  const box = page.locator("[data-dag-rename-box]");
  await expect(box).toHaveValue("Google Cloud");
  await box.fill("GCP");
  await box.press("Enter");
  await expect.poll(read, { timeout: 5_000 }).toContain('group gcp "GCP" {');
});

test("the same gesture writes an edge's label, on the segment it was drawn on", async ({ page }) => {
  /* Two cards and one line, and nothing else in the fence: a forced click lands on the middle of
     the *bounding box*, and on the board above that point sits over the group's own card. */
  fs.writeFileSync(
    file,
    `\`\`\`arch {#pair x=0 y=0}\nservice api "The API"\nstore db "Database"\n\napi --> db\n\`\`\`\n`,
  );
  await open(page);

  /* An edge with no label has no `<text>` to measure, so the box lands on the middle of the hit
     stroke's own box — "somewhere along this line", which is where a label goes. */
  await page.locator('[data-dag-item="pair"] .dag-edge-hit').dblclick({ force: true });
  const box = page.locator("[data-dag-rename-box]");
  await expect(box).toBeVisible();
  await box.fill("reads");
  await box.press("Enter");
  await expect.poll(() => bodyOf("pair"), { timeout: 5_000 }).toContain('api --> db "reads"');
});

test("a double-click on the frame still opens the panel — there is nothing there to rename", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="infra"] .dag-frame__head').dblclick();
  await expect(page.locator("[data-dag-inspector]")).toBeVisible();
  await expect(page.locator("[data-dag-rename-box]")).toHaveCount(0);
});

/* -------------------------------------------------------------------------------- the "+" */

test("three plusses read back as three statements and three edges", async ({ page }) => {
  await open(page);
  await pick(page, '[data-dag-node="api"]');

  for (let n = 0; n < 3; n++) {
    await page.locator('[data-dag-plus="e"]').click();
    /* Each `+` opens the rename on the card it made, and Escape leaves the default name. */
    await expect(page.locator("[data-dag-rename-box]")).toBeVisible({ timeout: 10_000 });
    await page.locator("[data-dag-rename-box]").press("Escape");
    /* The new card is what is picked, so the next `+` grows from *it* — a chain, not a fan. */
    await page.waitForTimeout(300);
  }

  const body = bodyOf("infra");
  const made = body.match(/service service\d+ "New service"/g) ?? [];
  expect(made).toHaveLength(3);
  const edges = body.match(/^\w+ --> \w+$/gm) ?? [];
  expect(edges).toHaveLength(3);
  expect(edges[0]).toBe("api --> service2");
  /* Everything still parses: no error card, and no diagnostics strip. */
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
  await expect(page.locator('[data-dag-node="service4"]')).toHaveCount(1);
});

test("a plus on the west side points the new edge back at the picked card", async ({ page }) => {
  await open(page);
  await pick(page, '[data-dag-node="api"]');
  await page.locator('[data-dag-plus="w"]').click();
  await expect(page.locator("[data-dag-rename-box]")).toBeVisible({ timeout: 10_000 });
  await page.locator("[data-dag-rename-box]").press("Escape");

  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toMatch(/service2 --> api/);
});

test("a card grown from inside a group stays in that group", async ({ page }) => {
  await open(page);
  await pick(page, '[data-dag-node="jobs"]');
  await page.locator('[data-dag-plus="e"]').click();
  await expect(page.locator("[data-dag-rename-box]")).toBeVisible({ timeout: 10_000 });
  await page.locator("[data-dag-rename-box]").press("Escape");

  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toMatch(/ {2}service jobs "Jobs"\n {2}service \w+ "New service"\n\}/);
});

test("a plus on a sketch box lands to its right, and draws no edge", async ({ page }) => {
  await open(page);
  await pick(page, '[data-dag-node="hero"]');
  await page.locator('[data-dag-plus="e"]').click();
  await expect(page.locator("[data-dag-rename-box]")).toBeVisible({ timeout: 10_000 });
  await page.locator("[data-dag-rename-box]").press("Escape");

  await expect.poll(() => bodyOf("wire"), { timeout: 5_000 }).toMatch(/box box2 "New box" x=192 y=0/);
  /* Coordinates carry the meaning here, so an arrow is a separate claim only a drag makes. */
  expect(bodyOf("wire")).not.toContain("-->");
});

/* A card already standing where the `+` would land. It was written at x=192 and drawn over
   "Right"; it goes one gap past it now, in the direction that was pulled. */
test("a plus on a sketch box goes past a card already where it would land", async ({ page }) => {
  fs.writeFileSync(file, `\`\`\`sketch {#pair x=0 y=0}\nbox a "Left" x=0 y=0\nbox b "Right" x=200 y=0\n\`\`\`\n`);
  await open(page);
  await pick(page, '[data-dag-node="a"]');
  await page.locator('[data-dag-plus="e"]').click();
  await expect(page.locator("[data-dag-rename-box]")).toBeVisible({ timeout: 10_000 });
  await page.locator("[data-dag-rename-box]").press("Escape");

  await expect.poll(() => bodyOf("pair"), { timeout: 5_000 }).toMatch(/box box2 "New box" x=392 y=0/);
  await expect(page.locator('[data-dag-node="box2"]')).toBeVisible();
  const right = (await page.locator('[data-dag-node="b"]').boundingBox())!;
  const made = (await page.locator('[data-dag-node="box2"]').boundingBox())!;
  expect(made.x).toBeGreaterThan(right.x + right.width);
});

/* A shape dropped from the library has no coordinate, and `layoutSketch` places those *below*
   everything that has one — so the new card's `x=` sent the one it grew from under it. The `+`
   pins what is unplaced in the same write, and west moves the fence rather than the drawing. */
test("a plus on a lone library shape leaves the shape where it is, whichever side it grows", async ({ page }) => {
  fs.writeFileSync(file, `\`\`\`sketch {#lone x=0 y=0}\ncylinder db "Database" w=160 h=120\n\`\`\`\n`);
  await open(page);
  /* At zoom 1 and held there, so a position on the glass is a position on the board. */
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("0");
  await page.mouse.move(800, 600);
  await page.mouse.wheel(0, 1);
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-zoom", "1");
  const was = (await page.locator('[data-dag-node="db"]').boundingBox())!;
  await pick(page, '[data-dag-node="db"]');
  await page.locator('[data-dag-plus="w"]').click();
  await expect(page.locator("[data-dag-rename-box]")).toBeVisible({ timeout: 10_000 });
  await page.locator("[data-dag-rename-box]").press("Escape");

  await expect.poll(() => bodyOf("lone"), { timeout: 5_000 }).toMatch(/cylinder db "Database" w=160 h=120 x=0 y=0/);
  expect(bodyOf("lone")).toMatch(/cylinder cylinder2 "New cylinder" x=-192 y=0/);
  expect(read()).toMatch(/```sketch \{#lone x=-192 y=0\}/);
  await expect(page.locator('[data-dag-node="cylinder2"]')).toBeVisible();
  const now = (await page.locator('[data-dag-node="db"]').boundingBox())!;
  expect(now.x).toBeCloseTo(was.x, 0);
  expect(now.y).toBeCloseTo(was.y, 0);
});

/* --------------------------------------------------------------------- connect inside one */

test("connecting two cards in one diagram writes into its body, not into edges", async ({ page }) => {
  await open(page);
  await pick(page, '[data-dag-node="api"]');

  /* The item's own handles are gone while a card is picked: two sets around one thing, with
     nothing on either saying which it would act on, is a thicket rather than an affordance. */
  await expect(page.locator('[data-dag-item="infra"] [data-dag-connect]')).toHaveCount(0);
  await expect(page.locator('[data-dag-item="infra"] [data-dag-handle]')).toHaveCount(0);

  const handle = await centreOf(page, '.dag-nodetools [data-dag-connect="s"]');
  const target = await centreOf(page, '[data-dag-node="db"]');
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain("api --> db");
  /* Nothing reached the board level: no `edges` fence was made. */
  expect(read()).not.toContain("```edges");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("a card cannot be connected to itself", async ({ page }) => {
  await open(page);
  await pick(page, '[data-dag-node="api"]');
  const handle = await centreOf(page, '.dag-nodetools [data-dag-connect="e"]');
  const self = await centreOf(page, '[data-dag-node="api"]');
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(self.x, self.y, { steps: 8 });
  await page.mouse.up();

  await page.waitForTimeout(400);
  expect(bodyOf("infra")).not.toContain("api --> api");
});
