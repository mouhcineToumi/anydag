import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";

/**
 * F4: dragging a card *inside* a diagram.
 *
 * Every other drag on this board writes a coordinate. This one cannot — ELK has no fixed node, and
 * four of the five house layouts have an axis that already is an ordinal — so the drop is read as
 * what it said about the *structure*, and every check here reads the bytes to prove it: a
 * statement between two brace blocks, a step between two bands, a topic re-indented, a date
 * rewritten, an `x=`/`y=` in a fence whose coordinates are the author's.
 *
 * The one thing that cannot be read off disk is a refusal, which is the gitgraph case: what is
 * asserted there is that nothing changed and that the cursor said so.
 *
 * One board per test: the suite runs in parallel and these write to disk.
 */

const DIR = BOARDS;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-drag-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

/** The fence's body and nothing else, so a check about a diagram cannot be answered elsewhere. */
const bodyOf = (id: string) => {
  const after = read().split(`{#${id}`)[1] ?? "";
  return (after.split("```")[0] ?? "").split("\n").slice(1).join("\n");
};

const write = (text: string) => fs.writeFileSync(file, text);

/**
 * `full` presses `0` for 100%.
 *
 * The board opens fitted, and a board holding one small diagram fits by zooming *in* — a 240px
 * pull across the glass was 64 board units. Every check that reads a *number* out of the file
 * therefore asks for 100% first; the structural ones do not care what the zoom is, which is the
 * point of them.
 */
async function open(page: Page, full = false) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  if (full) {
    /* The viewport's key handler ignores anything that did not land on the viewport itself, so it
       has to have focus before `0` means 100%. */
    await page.locator(".dag-viewport").focus();
    await page.keyboard.press("0");
    await expect.poll(() => page.locator(".dag-viewport").getAttribute("data-zoom")).toBe("1");
  }
}

/** Click, pause, click: the second press picks the card out, and Chromium pairs fast ones. */
async function pick(page: Page, selector: string) {
  await page.locator(selector).click();
  await page.waitForTimeout(400);
  await page.locator(selector).click();
  await expect(page.locator(`${selector}[data-dag-picked]`)).toHaveCount(1);
}

const boxOf = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!;

/**
 * Press on the picked card and let go over a point, past the drag threshold on the way.
 *
 * The steps matter: the gesture arms on the first move that clears `DRAG_SLOP`, and resolves its
 * drop target on every one after that, so a single jump would land with the target never having
 * been under the pointer at a moment the handler ran.
 */
async function dragTo(page: Page, from: string, to: { x: number; y: number }, modifiers: string[] = []) {
  const a = await boxOf(page, from);
  for (const k of modifiers) await page.keyboard.down(k);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
  for (const k of modifiers) await page.keyboard.up(k);
}

/** A point at a fraction across and down an element, in page coordinates. */
async function at(page: Page, selector: string, fx: number, fy: number) {
  const b = await boxOf(page, selector);
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}

/* -------------------------------------------------------------------------------- reorder */

/*
 * **What a reorder moves is the order *within* a layer, never the layer.**
 *
 * `forceNodeModelOrder` — what `aspect=0` turns on — is a crossing-minimisation setting: it makes
 * the file's order the tie-break for the cards that share a layer. Which layer a card is in is
 * decided by the edges, and no amount of moving a line changes that. So the case that shows the
 * layout following the file is two states that *branch* off one, not three in a chain.
 */
test("two states in one layer swap, and the drawing follows the file", async ({ page }) => {
  write(
    '```state {#s x=0 y=0 aspect=0}\n' +
      'state start "Start"\nstate a "Approve"\nstate b "Reject"\n\nstart --> a\nstart --> b\n```\n',
  );
  await open(page);
  const first = await boxOf(page, '[data-dag-node="a"]');
  expect(first.y).toBeLessThan((await boxOf(page, '[data-dag-node="b"]')).y);

  await pick(page, '[data-dag-node="a"]');
  /* The trailing half of `b`, on the axis the two are actually spread along: after it. */
  await dragTo(page, '[data-dag-node="a"]', await at(page, '[data-dag-node="b"]', 0.5, 0.85));

  await expect
    .poll(() => bodyOf("s").split("\n").slice(0, 3), { timeout: 5_000 })
    .toEqual(['state start "Start"', 'state b "Reject"', 'state a "Approve"']);

  /* Both read inside the poll: the relayout lands some renders after the file does, and a `b`
     measured before it is `b` where it used to be. */
  await expect
    .poll(
      async () =>
        (await boxOf(page, '[data-dag-node="a"]')).y > (await boxOf(page, '[data-dag-node="b"]')).y,
      { timeout: 10_000 },
    )
    .toBe(true);
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

/* ---------------------------------------------------------------------------- into a group */

const ARCH =
  '```arch {#infra x=0 y=0 title="Infra"}\n' +
  'service api "The API"\n' +
  'store db "Database"\n' +
  '\n' +
  'group gcp "Google Cloud" {\n' +
  '  service jobs "Jobs"\n' +
  '}\n' +
  '\n' +
  'api --> db\n' +
  '```\n';

test("a service dropped on a group's box moves between brace blocks", async ({ page }) => {
  write(ARCH);
  await open(page);
  await pick(page, '[data-dag-node="db"]');
  /* The boundary's own padding, below its one card: the group, not anything in it. */
  await dragTo(page, '[data-dag-node="db"]', await at(page, '[data-dag-group="gcp"]', 0.5, 0.93));

  await expect
    .poll(() => bodyOf("infra"), { timeout: 5_000 })
    .toMatch(/group gcp "Google Cloud" \{\n {2}service jobs "Jobs"\n {2}store db "Database"\n\}/);
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("dropping it back on the frame's padding takes it out again, and undo restores the file", async ({ page }) => {
  write(ARCH);
  await open(page);
  await pick(page, '[data-dag-node="db"]');
  await dragTo(page, '[data-dag-node="db"]', await at(page, '[data-dag-group="gcp"]', 0.5, 0.93));
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain('  store db "Database"');

  /* One ctrl+Z takes the whole drop back — it was one write. The button is what says the entry
     has landed: the history is pushed when the patch's response returns, not when the file does. */
  await expect(page.locator("[data-dag-undo]")).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect.poll(read, { timeout: 5_000 }).toBe(ARCH);
});

test("escape mid-drag abandons it and writes nothing", async ({ page }) => {
  write(ARCH);
  await open(page);
  await pick(page, '[data-dag-node="db"]');

  const from = await boxOf(page, '[data-dag-node="db"]');
  const to = await at(page, '[data-dag-group="gcp"]', 0.5, 0.93);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.keyboard.press("Escape");
  await page.mouse.up();

  await page.waitForTimeout(600);
  expect(read()).toBe(ARCH);
});

test("alt drags the diagram instead, which is the escape hatch", async ({ page }) => {
  write(ARCH);
  await open(page);
  await pick(page, '[data-dag-node="api"]');
  const item = await boxOf(page, '[data-dag-item="infra"]');
  await dragTo(page, '[data-dag-node="api"]', { x: item.x + 240, y: item.y + 160 }, ["Alt"]);

  /* The item moved and the body did not: `x=` on the fence, and every statement where it was. */
  await expect.poll(() => read(), { timeout: 5_000 }).not.toContain("{#infra x=0 y=0");
  expect(bodyOf("infra")).toContain('service api "The API"\nstore db "Database"');
});

/* ----------------------------------------------------------------------------- into a lane */

test("a step dropped on another band moves into that lane's block", async ({ page }) => {
  write(
    '```flow {#f x=0 y=0}\n' +
      'lane person "Person" {\n  step ask "Ask"\n}\n\n' +
      'lane system "System" {\n  step parse "Parse"\n}\n\n' +
      'ask --> parse\n```\n',
  );
  await open(page);
  await pick(page, '[data-dag-node="ask"]');
  /* Far right of the second band, past its one step: the band itself. */
  await dragTo(page, '[data-dag-node="ask"]', await at(page, '[data-dag-lane="system"]', 0.92, 0.5));

  await expect
    .poll(() => bodyOf("f"), { timeout: 5_000 })
    .toMatch(/lane system "System" \{\n {2}step parse "Parse"\n {2}step ask "Ask"\n\}/);
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

/* -------------------------------------------------------------------------------- mindmap */

test("a topic dropped on another is re-indented under it, with its subtree", async ({ page }) => {
  write('```mindmap {#m x=0 y=0}\nroot Board\n  Dialects\n    Arch\n  Editing\n```\n');
  await open(page);
  /* `m1` is Dialects and `m5` is Editing — the ids are the parser's, and its counter is shared
     with the edges it invents. */
  await pick(page, '[data-dag-node="m5"]');
  await dragTo(page, '[data-dag-node="m5"]', await at(page, '[data-dag-node="m1"]', 0.5, 0.5));

  await expect.poll(() => bodyOf("m"), { timeout: 5_000 }).toContain("  Dialects\n    Arch\n    Editing");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

/* ------------------------------------------------------------------------------- timeline */

test("a timeline entry dragged sideways is re-dated, and a vertical drag writes nothing", async ({ page }) => {
  write('```timeline {#t x=0 y=0}\n2026-01-01 "Kickoff"\n2026-06-01 "Beta"\n```\n');
  await open(page, true);
  await pick(page, '[data-dag-node="t0"]');
  const start = await boxOf(page, '[data-dag-node="t0"]');
  await dragTo(page, '[data-dag-node="t0"]', { x: start.x + start.width / 2 + 160, y: start.y + start.height / 2 });

  /* How many days 160px is depends on the span and the widest card, which is the layout's business
     and not this test's. What is asserted is the shape: the same line, at day precision, later
     than it was and short of the entry it was dragged towards. */
  const dated = () => /^(2026-\d\d-\d\d) "Kickoff"$/m.exec(bodyOf("t"))?.[1] ?? "";
  /* `.not.toBe("")` was satisfied by `2026-01-01` — the date the board was *written* with — so the
     poll returned before the drag had landed and the assertion under it raced the write. What is
     being waited for is the date *changing*. */
  await expect.poll(dated, { timeout: 5_000 }).not.toBe("2026-01-01");
  expect(dated() < "2026-06-01").toBe(true);
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);

  /* Straight down: the packing owns y, so there is nothing to write and the file stands. */
  const held = read();
  await pick(page, '[data-dag-node="t0"]');
  const now = await boxOf(page, '[data-dag-node="t0"]');
  await dragTo(page, '[data-dag-node="t0"]', { x: now.x + now.width / 2, y: now.y + now.height / 2 + 120 });
  await page.waitForTimeout(600);
  expect(read()).toBe(held);
});

/* ------------------------------------------------------------------------------- gitgraph */

test("a gitgraph commit refuses the drag and says so with the cursor", async ({ page }) => {
  const board = '```gitgraph {#g x=0 y=0}\ncommit "one"\ncommit "two"\nbranch feature\ncommit "three"\n```\n';
  write(board);
  await open(page);
  const commit = page.locator("[data-dag-node]").first();
  const id = (await commit.getAttribute("data-dag-node"))!;
  await pick(page, `[data-dag-node="${id}"]`);

  const b = await boxOf(page, `[data-dag-node="${id}"]`);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 200, b.y + b.height / 2 + 80, { steps: 12 });
  await expect(page.locator('html[data-dag-node-drag="refused"]')).toHaveCount(1);
  await page.mouse.up();

  await page.waitForTimeout(600);
  expect(read()).toBe(board);
});

/* --------------------------------------------------------------------------------- sketch */

test("a sketch box writes the coordinate it was dropped at", async ({ page }) => {
  write('```sketch {#w x=0 y=0}\nbox hero "Hero" x=0 y=0 w=160 h=64\nbox foot "Foot" x=0 y=200 w=160 h=64\n```\n');
  await open(page, true);
  await pick(page, '[data-dag-node="hero"]');
  const b = await boxOf(page, '[data-dag-node="hero"]');
  await dragTo(page, '[data-dag-node="hero"]', { x: b.x + b.width / 2 + 240, y: b.y + b.height / 2 + 80 });

  await expect.poll(() => bodyOf("w"), { timeout: 5_000 }).toMatch(/box hero "Hero" w=160 h=64 x=240 y=80/);
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

/* ---------------------------------------------------------------------------------- col= */

test("the panel offers the column the layout used, and Release takes it off", async ({ page }) => {
  write(ARCH);
  await open(page);
  await pick(page, '[data-dag-node="db"]');
  await page.keyboard.press("Enter");

  const keep = page.locator("[data-dag-prop-col]");
  await expect(keep).toBeVisible();
  await keep.click();
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toMatch(/store db "Database" col=\d+/);

  await page.locator("[data-dag-prop-col-clear]").click();
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).not.toContain("col=");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});
