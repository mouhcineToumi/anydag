import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * Size and describe any card — the controls that stand in for typing `w=`, a third string, a row
 * on a line of its own, `kind=`, a group's `dir=` and the flags the grammar retired.
 *
 * Every check reads the bytes, for the reason `select.spec.ts` gives: what is being tested is that
 * a control turns into a small, correct edit to a document a person also owns. And every board is
 * written by the test that uses it and removed after it — the suite runs in parallel.
 */

const DIR = BOARDS;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-size-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

/** Write the board and open it, with the library shut so nothing covers the canvas. */
async function open(page: Page, fences: string) {
  fs.writeFileSync(file, `---\ntitle: Size\n---\n\n${fences}`);
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** Click, pause, click: the second press is what picks a card out, and Chromium pairs fast ones. */
async function pick(page: Page, selector: string) {
  await page.locator(selector).click();
  await page.waitForTimeout(400);
  await page.locator(selector).click();
  await page.waitForTimeout(200);
}

/** Pick one thing inside a diagram and open the panel on it. */
async function props(page: Page, selector: string) {
  await pick(page, selector);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-props]")).toHaveCount(1);
}

/**
 * Pick a group or a frame and open the panel on it. A click picks cards only; a group is reached
 * through the double-click that renames it, which picks it, and Escape puts the box away and leaves
 * the pick standing.
 */
async function groupProps(page: Page, selector: string) {
  await page.locator(selector).dblclick();
  await expect(page.locator("[data-dag-rename-box]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-rename-box]")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-props]")).toHaveCount(1);
}

/** Select a whole item and open the panel on it — by its corner, where no line or card can be hit. */
async function itemProps(page: Page, id: string) {
  await page.locator(`[data-dag-item="${id}"]`).click({ position: { x: 3, y: 3 } });
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-item-props]")).toHaveCount(1);
}

/** The width the layout gave a card, in board pixels: `place()` writes it onto the element. */
const drawnWidth = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).style.width);

const ARCH = `\`\`\`arch {#infra x=0 y=0 title="Infra"}
service api "The API" icon=server
store db "Database"

api --> db "reads"
\`\`\`
`;

/* ------------------------------------------------------------------------- a card's width */

test("a card in an automatic layout takes a width, and has no height to give", { tag: "@smoke" }, async ({ page }) => {
  await open(page, ARCH);
  await props(page, '[data-dag-item="infra"] [data-dag-node="api"]');

  const w = page.locator("[data-dag-prop-w]");
  await expect(w).toHaveValue("");
  await expect(w).toHaveAttribute("placeholder", "auto");
  /* ELK decides the height, so a box for it would be a lie the layout then ignores. */
  await expect(page.locator("[data-dag-prop-h]")).toHaveCount(0);

  await w.fill("300");
  await w.blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('service api "The API" icon=server w=300');
  await expect.poll(() => drawnWidth(page, '[data-dag-node="api"]')).toBe("300px");
  /* One line changed. */
  expect(read()).toContain('store db "Database"\n');

  /* Not a size: refused in the box, and the file is as it was. */
  const before = read();
  await w.fill("0");
  await w.blur();
  await expect(w).toHaveValue("300");
  expect(read()).toBe(before);

  await w.fill("");
  await w.blur();
  await expect.poll(read, { timeout: 5_000 }).not.toContain("w=300");
  await expect.poll(() => drawnWidth(page, '[data-dag-node="api"]')).not.toBe("300px");
});

/* --------------------------------------------------------------------------- sketch shapes */

const SKETCH = `\`\`\`sketch {#s x=0 y=0}
frame phone "Phone" x=0 y=0 w=320 h=400 {
  circle c "Circle" x=24 y=48 w=96 h=96
  box b "Box" x=160 y=48 w=96 h=64
}
diamond d "Diamond" x=400 y=48
\`\`\`
`;

test("each shape of a sketch with several takes its own width and height", async ({ page }) => {
  await open(page, SKETCH);
  await props(page, '[data-dag-item="s"] [data-dag-node="d"]');

  await page.locator("[data-dag-prop-w]").fill("160");
  await page.locator("[data-dag-prop-w]").blur();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/diamond d "Diamond" x=400 y=48 w=160/);
  await page.locator("[data-dag-prop-h]").fill("120");
  await page.locator("[data-dag-prop-h]").blur();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/diamond d "Diamond" x=400 y=48 w=160 h=120/);
  await expect.poll(() => drawnWidth(page, '[data-dag-node="d"]')).toBe("160px");

  /* The circle inside the frame is a shape of its own, not part of a whole that scales. */
  await props(page, '[data-dag-item="s"] [data-dag-node="c"]');
  await page.locator("[data-dag-prop-w]").fill("128");
  await page.locator("[data-dag-prop-w]").blur();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/circle c "Circle" x=24 y=48 h=96 w=128/);
  /* And the rest of the file is what it was. */
  expect(read()).toContain('box b "Box" x=160 y=48 w=96 h=64');
});

test("a frame is sized from the panel too, which only the whole item's handles did", async ({ page }) => {
  await open(page, SKETCH);
  await groupProps(page, '[data-dag-item="s"] [data-dag-group="phone"] [data-dag-title]');

  await expect(page.locator("[data-dag-prop-w]")).toHaveValue("320");
  await expect(page.locator("[data-dag-prop-h]")).toHaveValue("400");
  await page.locator("[data-dag-prop-w]").fill("480");
  await page.locator("[data-dag-prop-w]").blur();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/frame phone "Phone" x=0 y=0 h=400 w=480 \{/);
  await page.locator("[data-dag-prop-h]").fill("");
  await page.locator("[data-dag-prop-h]").blur();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/frame phone "Phone" x=0 y=0 w=480 \{/);
  expect(read()).toContain("circle c");
});

test("a group in an automatic layout has no box to size, only a direction", async ({ page }) => {
  await open(page, `\`\`\`arch {#infra x=0 y=0}\ngroup g "Backend" {\n  service api "API"\n}\n\`\`\`\n`);
  await groupProps(page, '[data-dag-item="infra"] [data-dag-group="g"] [data-dag-title]');
  /* ELK sizes a group from what is in it: no box to give, but a direction to. */
  await expect(page.locator("[data-dag-prop-w]")).toHaveCount(0);
  await expect(page.locator("[data-dag-prop-group-dir]")).toHaveValue("");
});

/* ---------------------------------------------------------------------------- a group's dir */

test("a group's own direction is written on its line", async ({ page }) => {
  await open(page, `\`\`\`arch {#infra x=0 y=0}\ngroup g "Backend" {\n  service api "API"\n  store db "DB"\n}\n\`\`\`\n`);
  await groupProps(page, '[data-dag-item="infra"] [data-dag-group="g"] [data-dag-title]');

  await page.locator("[data-dag-prop-group-dir]").selectOption("TB");
  await expect.poll(read, { timeout: 5_000 }).toContain('group g "Backend" dir=TB {');
  await page.locator("[data-dag-prop-group-dir]").selectOption("");
  await expect.poll(read, { timeout: 5_000 }).toContain('group g "Backend" {');
  expect(read()).not.toContain("dir=");
});

/* ---------------------------------------------------------------------------- a description */

const C4 = `\`\`\`c4 {#sys x=0 y=0}
person user "Customer" "Pays for things."
container api "API" "FastAPI" "Serves the app."
extsystem mail "Mail" "Sends receipts."
\`\`\`
`;

test("the description is the string the card draws, whichever one that is", async ({ page }) => {
  await open(page, C4);

  /* A person's is the second string — the one the panel used to call "meta". */
  await props(page, '[data-dag-item="sys"] [data-dag-node="user"]');
  await expect(page.locator("[data-dag-prop-meta]")).toHaveCount(0);
  const desc = page.locator("[data-dag-prop-desc]");
  await expect(desc).toHaveValue("Pays for things.");
  await desc.fill("Orders and pays.");
  await desc.blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('person user "Customer" "Orders and pays."');
  await expect(page.locator('[data-dag-node="user"]')).toContainText("Orders and pays.");

  /* A container's is the third, and its technology is still a field of its own. */
  await props(page, '[data-dag-item="sys"] [data-dag-node="api"]');
  await expect(page.locator("[data-dag-prop-meta]")).toHaveValue("FastAPI");
  await expect(page.locator("[data-dag-prop-desc]")).toHaveValue("Serves the app.");
  await page.locator("[data-dag-prop-desc]").fill("Serves the shop.");
  await page.locator("[data-dag-prop-desc]").blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('container api "API" "FastAPI" "Serves the shop."');

  /* An external system's, like a person's. Cleared, the string goes and the card stays. */
  await props(page, '[data-dag-item="sys"] [data-dag-node="mail"]');
  await expect(page.locator("[data-dag-prop-desc]")).toHaveValue("Sends receipts.");
  await page.locator("[data-dag-prop-desc]").fill("");
  await page.locator("[data-dag-prop-desc]").blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('extsystem mail "Mail"\n');
  expect(read()).toContain('person user "Customer" "Orders and pays."');
});

test("a card that draws no description is offered none", async ({ page }) => {
  await open(page, ARCH);
  await props(page, '[data-dag-item="infra"] [data-dag-node="api"]');
  await expect(page.locator("[data-dag-prop-meta]")).toHaveCount(1);
  await expect(page.locator("[data-dag-prop-desc]")).toHaveCount(0);
});

/* ---------------------------------------------------------------------------- inline rows */

test("the rows of a one-line block are edited, removed and added like any others", async ({ page }) => {
  await open(page, `\`\`\`erd {#model x=0 y=0}\nentity user "User" { id uuid pk; slug text } %% keep\n\`\`\`\n`);
  await props(page, '[data-dag-item="model"] [data-dag-node="user"]');

  const rows = page.locator("[data-dag-prop-row]");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveValue("id uuid pk");
  await expect(rows.nth(1)).toHaveValue("slug text");

  await rows.nth(1).fill("handle varchar");
  await rows.nth(1).blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('entity user "User" { id uuid pk; handle varchar } %% keep');
  await expect(page.locator('[data-dag-item="model"] [data-dag-row]')).toHaveCount(2);

  await page.locator("[data-dag-prop-row-add]").click();
  await expect.poll(read, { timeout: 5_000 }).toContain("handle varchar; name type }");

  await page.locator("[data-dag-prop-row-remove]").first().click();
  await expect.poll(read, { timeout: 5_000 }).toContain('entity user "User" { handle varchar; name type } %% keep');
  await expect(page.locator("[data-dag-prop-row]")).toHaveCount(2);
});

/* ------------------------------------------------------------------------------- kind= */

test("a card carrying kind= shows that kind, and the menu replaces it", async ({ page }) => {
  await open(page, `\`\`\`arch {#infra x=0 y=0}\nservice api "API" kind=store hue=teal\n\`\`\`\n`);
  await props(page, '[data-dag-item="infra"] [data-dag-node="api"]');

  const kind = page.locator("[data-dag-prop-kind]");
  await expect(kind).toHaveValue("store");
  await kind.selectOption("queue");
  /* The word changes and the override goes, or the card would go on being a store. */
  await expect.poll(read, { timeout: 5_000 }).toContain('queue api "API" hue=teal');
  expect(read()).not.toContain("kind=");
  await expect(page.locator('[data-dag-node="api"]')).toHaveAttribute("data-dag-kind", "queue");
});

test("a sequence participant is typed from a menu that writes kind=", async ({ page }) => {
  await open(
    page,
    `\`\`\`sequence {#seq x=0 y=0}\nparticipant learner "Learner"\nparticipant api "API"\nlearner ->> api : "asks"\n\`\`\`\n`,
  );
  await props(page, '[data-dag-item="seq"] [data-dag-node="learner"]');

  const kind = page.locator("[data-dag-prop-kind]");
  await expect(kind).toHaveValue("service");
  await kind.selectOption("person");
  await expect.poll(read, { timeout: 5_000 }).toContain('participant learner "Learner" kind=person');
  await expect(page.locator('[data-dag-node="learner"]')).toHaveAttribute("data-dag-kind", "person");
  await kind.selectOption("service");
  await expect.poll(read, { timeout: 5_000 }).toContain('participant learner "Learner"\n');
  expect(read()).not.toContain("kind=");
});

/* ----------------------------------------------------------------------- retired flags */

test("a retired flag is brought up to date from the card that wears it", async ({ page }) => {
  await open(page, `\`\`\`arch {#infra x=0 y=0}\nservice api "API" focus hue=teal\nstore db "DB"\napi --> db\n\`\`\`\n`);
  await props(page, '[data-dag-item="infra"] [data-dag-node="api"]');

  await expect(page.locator('[data-dag-update="retired"]')).toContainText("focus");
  await page.locator('[data-dag-update-go="retired"]').click();
  await expect.poll(read, { timeout: 5_000 }).toContain('service api "API" hue=teal\n');
  expect(read()).not.toContain("focus");
  await expect(page.locator('[data-dag-update="retired"]')).toHaveCount(0);
});

test("every retired flag in a diagram is updated from the item's panel, one click", async ({ page }) => {
  await open(
    page,
    `\`\`\`arch {#infra x=0 y=0}\nservice api "API" focus\nstore db "DB" current\napi --> db\nlegend focus "the one in focus"\n\`\`\`\n`,
  );
  await itemProps(page, "infra");

  await expect(page.locator('[data-dag-update="retired"]')).toContainText("3 lines");
  await page.locator('[data-dag-update-go="retired"]').click();
  await expect.poll(read, { timeout: 5_000 }).toContain('service api "API"\nstore db "DB"\napi --> db\n```');
  expect(read()).not.toMatch(/focus|current|legend/);
  await expect(page.locator('[data-dag-update="retired"]')).toHaveCount(0);
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

/* ------------------------------------------------------------------------ a body's dir= */

test("a dir= in the body moves to the fence, where the Direction control is", async ({ page }) => {
  await open(page, `\`\`\`arch {#infra x=0 y=0}\ndir=TB\nservice api "API"\nstore db "DB"\napi --> db\n\`\`\`\n`);
  await itemProps(page, "infra");

  await expect(page.locator('[data-dag-update="dir"]')).toContainText("dir=TB");
  await page.locator('[data-dag-update-go="dir"]').click();
  await expect
    .poll(read, { timeout: 5_000 })
    .toMatch(/```arch \{#infra[^\n]*dir=TB[^\n]*\}\nservice api "API"\nstore db "DB"\napi --> db\n```/);
  await expect(page.locator('[data-dag-update="dir"]')).toHaveCount(0);

  /* The control is the truth now: it reads the fence, and changing it changes the drawing. */
  await page.locator("[data-dag-advanced-toggle]").click();
  await expect(page.locator(".dag-select", { hasText: "top to bottom" }).first()).toHaveValue("TB");
});
