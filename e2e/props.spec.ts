import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { lead } from "./keys";
import { BOARDS } from "./boards";

/**
 * F3: the Properties view, complete.
 *
 * F1 gave the panel a strip of three controls — a hue, a status and an icon — because that was
 * what `restate.ts` could write at the time. This is the rest of it: a kind, the strings, the
 * flags, the rows, an arrow, a label, and the item's own id, hue, `hidden` and the two conversions
 * between an automatic layout and the author's own coordinates.
 *
 * Every check that can read the bytes reads them, for the reason `select.spec.ts` gives: the thing
 * being tested is that a control turns into a small, correct edit to a document a person also owns.
 *
 * One board per test: the suite runs in parallel and these write to disk.
 */

const DIR = BOARDS;

const BOARD = `---
title: Props
---

\`\`\`arch {#infra x=0 y=0 title="Infra"}
service api "The API" "fastapi" icon=server
store db "Database"

api --> db "reads"
\`\`\`

\`\`\`erd {#model x=0 y=480}
entity order "Order" {
  id uuid pk
}
\`\`\`

\`\`\`md {#note x=640 y=0 w=200}
A note.
\`\`\`

\`\`\`edges
note --> infra.api "uses"
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-props-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page) {
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

/** Pick a card and open the panel on it. */
async function props(page: Page, selector: string) {
  await pick(page, selector);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-props]")).toHaveCount(1);
}

/* ------------------------------------------------------------------------- a picked card */

test("the kind menu is the dialect's vocabulary, and it retypes the card", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  await props(page, '[data-dag-item="infra"] [data-dag-node="api"]');

  const kind = page.locator("[data-dag-prop-kind]");
  await expect(kind).toHaveValue("service");
  /* The same list `E_UNKNOWN_KIND` suggests from, so the menu and the error cannot disagree. */
  await expect(kind.locator("option")).toContainText(["service", "store", "client", "queue"]);

  await kind.selectOption("queue");
  await expect.poll(read, { timeout: 5_000 }).toContain('queue api "The API" "fastapi" icon=server');
  /* And the card on the canvas is the new kind, not only the line. */
  await expect(page.locator('[data-dag-node="api"]')).toHaveAttribute("data-dag-kind", "queue");
});

test("title, meta and the flags land on that one line", async ({ page }) => {
  await open(page);
  await props(page, '[data-dag-item="infra"] [data-dag-node="api"]');

  await page.locator("[data-dag-prop-title]").fill("Public API");
  await page.locator("[data-dag-prop-title]").blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('service api "Public API" "fastapi"');

  await page.locator("[data-dag-prop-meta]").fill("django");
  await page.locator("[data-dag-prop-meta]").blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('service api "Public API" "django"');

  await page.locator('[data-dag-prop-flag="external"]').check();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/service api .*external/);

  /* One line changed and nothing else. */
  const now = read();
  expect(now).toContain('store db "Database"');
  expect(now).toContain('api --> db "reads"');
});

test("a row is added, edited and removed, and the card follows", async ({ page }) => {
  await open(page);
  await props(page, '[data-dag-item="model"] [data-dag-node="order"]');

  const rows = page.locator("[data-dag-prop-row]");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveValue("id uuid pk");

  await page.locator("[data-dag-prop-row-add]").click();
  await expect.poll(read, { timeout: 5_000 }).toContain("name type");
  await expect(page.locator('[data-dag-item="model"] [data-dag-row]')).toHaveCount(2);

  const added = page.locator("[data-dag-prop-row]").nth(1);
  await added.fill("total numeric");
  await added.blur();
  await expect.poll(read, { timeout: 5_000 }).toContain("total numeric");
  expect(read()).not.toContain("name type");

  await page.locator("[data-dag-prop-row-remove]").first().click();
  await expect.poll(read, { timeout: 5_000 }).not.toContain("id uuid pk");
  expect(read()).toContain("total numeric");
});

test("a card with no rows in its dialect is offered none", async ({ page }) => {
  await open(page);
  await props(page, '[data-dag-item="infra"] [data-dag-node="api"]');
  /* `arch` has rows; this is the negative case one dialect over. `usecase` has no row grammar at
     all, so offering "add a row" would write a line the parser rejects. */
  await expect(page.locator("[data-dag-prop-rows]")).toHaveCount(1);
});

/* ------------------------------------------------------------------------ a picked edge */

test("a picked edge writes its label, its arrow and its hue", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="infra"] .dag-edge-hit').click({ force: true });
  await page.keyboard.press("Enter");

  await expect(page.locator("[data-dag-prop-label]")).toHaveValue("reads");
  await page.locator("[data-dag-prop-label]").fill("writes");
  await page.locator("[data-dag-prop-label]").blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('api --> db "writes"');

  await page.locator("[data-dag-prop-arrow]").selectOption("-.->");
  await expect.poll(read, { timeout: 5_000 }).toContain('api -.-> db "writes"');

  /* F3 promoted `hue=` in `parseEdge`, so this recolours the line rather than claiming to. */
  await page.locator('[data-dag-prop-hue="coral"]').click();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/api -\.-> db "writes".*hue=coral/);

  await page.locator("[data-dag-prop-quiet]").check();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/api -\.-> db .*quiet/);
});

/* ------------------------------------------------------------------------------ the item */

test("a note takes a hue, and hidden takes it off the canvas", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="note"]').click();
  await page.keyboard.press("Enter");

  await page.locator('[data-dag-prop-hue="teal"]').click();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/#note[^\n]*hue=teal/);

  /* Hidden sits in the Advanced disclosure now, so open it first. */
  await page.locator("[data-dag-advanced-toggle]").click();
  /* A click rather than `check()`: the box's own act takes the item off the canvas, so the panel
     goes with it — the same thing ⌃⇧H does — and there is no checkbox left to read a state off. */
  await page.locator("[data-dag-item-hidden]").click();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/#note[^\n]*hidden/);
  await expect(page.locator('[data-dag-item="note"]')).toHaveCount(0);
});

test("renaming an item rewrites every edges reference to it", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="infra"]').click();
  await page.keyboard.press("Enter");
  await page.locator("[data-dag-advanced-toggle]").click();

  await page.locator("[data-dag-item-id]").fill("platform");
  await page.locator("[data-dag-item-id]").blur();

  await expect.poll(read, { timeout: 5_000 }).toContain("{#platform");
  const now = read();
  /* The whole point: the link travelled with it, so the board still parses. */
  expect(now).toContain('note --> platform.api "uses"');
  expect(now).not.toContain("infra");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("a name somebody already has is refused in the row, and nothing is written", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="infra"]').click();
  await page.keyboard.press("Enter");
  await page.locator("[data-dag-advanced-toggle]").click();

  await page.locator("[data-dag-item-id]").fill("note");
  await page.locator("[data-dag-item-id]").blur();

  await expect(page.locator("[data-dag-item-id-error]")).toContainText("already exists");
  expect(read()).toContain("{#infra");
  await expect(page.locator("[data-dag-item-id]")).toHaveValue("infra");
});

/* -------------------------------------------------------------- detach, and back again */

test("detach writes layout=fixed and every card's coordinate; re-layout takes them away", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="infra"]').click();
  await page.keyboard.press("Enter");
  await page.locator("[data-dag-advanced-toggle]").click();
  const was = (await page.locator('[data-dag-node="api"]').boundingBox())!;

  await page.locator("[data-dag-detach]").click();
  await page.locator("[data-dag-convert-go]").click();

  await expect.poll(read, { timeout: 5_000 }).toMatch(/#infra[^\n]*layout=fixed/);
  /* A fixed frame hugs its drawing where ELK's kept its padding, so the fence moves by that
     corner and the cards stay exactly where they were drawn — the conversion is invisible. */
  await expect
    .poll(async () => {
      const now = (await page.locator('[data-dag-node="api"]').boundingBox())!;
      return [Math.round(now.x - was.x), Math.round(now.y - was.y)];
    })
    .toEqual([0, 0]);
  const detached = read();
  /* Both cards, with the coordinates the layout had already given them — not a fresh grid. */
  expect(detached).toMatch(/service api .*x=\d+ y=\d+/);
  expect(detached).toMatch(/store db .*x=\d+ y=\d+/);
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);

  /* And the way back is one button, which is the same conversion run in reverse. */
  await page.locator('[data-dag-detach="relayout"]').click();
  await page.locator("[data-dag-convert-go]").click();
  await expect.poll(read, { timeout: 5_000 }).not.toContain("layout=fixed");
  expect(read()).not.toMatch(/service api .*x=/);
});

test("a diagram with an axis no rectangle describes is offered no detach", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="note"]').click();
  await page.keyboard.press("Enter");
  /* An `md` is not a diagram at all; the negative that matters is that nothing offers to convert
     something whose coordinates would be text nothing reads. */
  await expect(page.locator("[data-dag-convert]")).toHaveCount(0);
});

/* ------------------------------------------------------------------------ a picked link */

test("a picked link's label is written where its statement lives", async ({ page }) => {
  await open(page);
  await page.locator(".dag-board-edges .dag-edge-hit").first().click({ force: true });
  await page.keyboard.press("Enter");

  await expect(page.locator("[data-dag-props]")).toHaveCount(1);
  await expect(page.locator("[data-dag-prop-label]")).toHaveValue("uses");
  await page.locator("[data-dag-prop-label]").fill("calls");
  await page.locator("[data-dag-prop-label]").blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('note --> infra.api "calls"');
});

/* ------------------------------------------------------- a dropped shape, and its lone node */

const card = (page: Page, id: string) => page.locator(`[data-dag-component="${id}"]`);

test("a shape dropped from the library opens no panel, and the shape is selected", async ({ page }) => {
  await open(page);
  await lead(page, "l");
  await card(page, "part-sketch-circle").click();

  /* The panel is the thing this check is about: nothing opens over the drawing. The shape is
     still selected — `insert` selects what it wrote — so Enter, the next thing a person presses,
     opens the panel on purpose. */
  await expect.poll(read, { timeout: 5_000 }).toMatch(/```sketch \{#sketch-[a-z0-9]{4}[^\n]*\}\ncircle circle1 "Circle"/);
  await expect(page.locator("[data-dag-inspector]")).toHaveCount(0);
  await expect(page.locator("[data-dag-selected]")).toHaveCount(1);
});

test("a lone shape's hue swatch writes the node's line in the body, not the fence", async ({ page }) => {
  await open(page);
  await lead(page, "l");
  await card(page, "part-sketch-circle").click();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/```sketch \{#sketch-[a-z0-9]{4}/);

  /* The drop left focus on the library's own button, so Enter there would drop a second shape —
     and clicking the shape would *pick* it, the second click on a selected diagram reaching
     inside. The viewport takes the focus, and Enter opens the panel on the selection. The file
     is not a wait here: the poll above saw the bytes land, and the page's own selection is one
     round trip behind them, so this waits on the DOM instead. */
  await expect(page.locator("[data-dag-selected]")).toHaveCount(1);
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("Enter");
  /* The style block is the lone node's, not the item's structural fields. */
  await expect(page.locator("[data-dag-item-style]")).toBeVisible();
  await page.locator('[data-dag-item-style] [data-dag-prop-hue="coral"]').click();
  /* On the statement, in the body — and nowhere on the fence line, where an item hue would go. */
  await expect.poll(read, { timeout: 5_000 }).toMatch(/circle circle1 "Circle" hue=coral/);
  expect(read()).not.toMatch(/```sketch \{#[^\n]*hue=/);
});

test("the text-style buttons write the bare flags onto the picked card's line", async ({ page }) => {
  await open(page);
  await props(page, '[data-dag-item="infra"] [data-dag-node="api"]');

  const bold = page.locator('[data-dag-prop-em="bold"]');
  await bold.click();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/service api "The API"[^\n]*\bbold\b/);
  await expect(bold).toHaveAttribute("aria-pressed", "true");

  await page.locator('[data-dag-prop-em="italic"]').click();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/service api [^\n]*italic/);

  await bold.click();
  await expect.poll(read, { timeout: 5_000 }).not.toMatch(/service api[^\n]*\bbold\b/);
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  /* `bold` going left `italic` where it was — the two are independent flags, not a set of one. */
  await expect(page.locator('[data-dag-prop-em="italic"]')).toHaveAttribute("aria-pressed", "true");
});

test("title, id and hidden wait for the Advanced disclosure", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="infra"]').click();
  await page.keyboard.press("Enter");

  /* Collapsed means not rendered, which is what "not reachable" is here. */
  await expect(page.locator("[data-dag-item-title]")).toHaveCount(0);
  await expect(page.locator("[data-dag-item-id]")).toHaveCount(0);
  await expect(page.locator("[data-dag-item-hidden]")).toHaveCount(0);

  await page.locator("[data-dag-advanced-toggle]").click();
  await expect(page.locator("[data-dag-item-title]")).toBeVisible();
  await expect(page.locator("[data-dag-item-id]")).toBeVisible();
  await expect(page.locator("[data-dag-item-hidden]")).toBeVisible();
});
