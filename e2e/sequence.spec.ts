import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";

/**
 * A sequence diagram built and changed from the canvas, with no source in sight (#135).
 *
 * A message is drawn by dragging from one lifeline to another, and the height it was let go at is
 * where its statement goes. A picked message, a picked fragment, a picked note and a picked
 * participant each have a panel, and a run of messages picked with shift is wrapped in a fragment
 * from the selection bar. Every check reads the bytes back, for the reason `pick.spec.ts` gives.
 *
 * One board per test: the suite runs in parallel and these write to disk.
 */

const BOARD = `---
title: Sequence
---

\`\`\`sequence {#seq x=0 y=0}
participant a "Alice"
participant b "Bob"
participant c "Carol"
a ->> b : "hello"
b -->> a : "hi"
alt "yes"
  a ->> c : "ask"
end
note over a, b : "a note"
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-sequence-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");
const body = () => read().split("```")[1]!.split("\n").slice(1, -1);

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** A click that cannot be read as half of a double-click — see `pick.spec.ts`. */
async function tap(page: Page, selector: string) {
  await page.locator(selector).click();
  await page.waitForTimeout(400);
}

const message = (n: number) => `[data-dag-item="seq"] [data-dag-edge="msg:${n}"] .dag-edge-hit`;

/** Pick a message by its hit stroke — the line is a hairline, the stroke is what takes the press. */
async function pickMessage(page: Page, n: number, shift = false) {
  await page.locator(message(n)).click({ force: true, modifiers: shift ? ["Shift"] : [] });
  await page.waitForTimeout(300);
}

const picked = (page: Page) =>
  page
    .locator('[data-dag-item="seq"] [data-dag-picked]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.dagEdge ?? (e as HTMLElement).dataset.dagFrag ?? ""));

test("a message is picked, and its panel writes its text, its ends, its arrow and its busy bar", { tag: "@smoke" }, async ({
  page,
}) => {
  await open(page);
  await pickMessage(page, 0);
  expect(await picked(page)).toEqual(["msg:0"]);
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-dag-props="msg:0"]')).toHaveCount(1);

  await expect(page.locator("[data-dag-prop-label]")).toHaveValue("hello");
  await page.locator("[data-dag-prop-label]").fill("good morning");
  await page.locator("[data-dag-prop-label]").blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('a ->> b : "good morning"');

  await page.locator("[data-dag-prop-to]").selectOption("c");
  await expect.poll(read, { timeout: 5_000 }).toContain('a ->> c : "good morning"');

  await page.locator("[data-dag-prop-arrow]").selectOption("-)");
  await expect.poll(read, { timeout: 5_000 }).toContain('a -) c : "good morning"');

  await page.locator("[data-dag-prop-activate]").check();
  await expect.poll(read, { timeout: 5_000 }).toContain('a -) +c : "good morning"');

  /* Down one row: past Bob's reply, so it is the second message now and the panel follows it. */
  await page.locator('[data-dag-prop-move="down"]').click();
  await expect.poll(() => body().slice(3, 5), { timeout: 5_000 }).toEqual(['b -->> a : "hi"', 'a -) +c : "good morning"']);
  await expect(page.locator('[data-dag-props="msg:1"]')).toHaveCount(1);
});

test("Delete on a picked message takes its line and nothing else", async ({ page }) => {
  await open(page);
  await pickMessage(page, 1);
  await page.keyboard.press("Delete");
  await expect.poll(read, { timeout: 5_000 }).not.toContain('"hi"');
  expect(read()).toContain('a ->> b : "hello"');
});

test("a drag from one lifeline to another draws a message where it was let go", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  /* The diagram first: a press on a lifeline of a diagram that is not selected moves the diagram. */
  await tap(page, '[data-dag-item="seq"] [data-dag-node="a"]');

  const first = (await page.locator(message(0)).boundingBox())!;
  const second = (await page.locator(message(1)).boundingBox())!;
  const between = (first.y + first.height / 2 + second.y + second.height / 2) / 2;
  const from = (await page.locator('[data-dag-lifeline="c"]').boundingBox())!;
  const to = (await page.locator('[data-dag-lifeline="a"]').boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, between);
  await page.mouse.down();
  await page.mouse.move(from.x - 40, between, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2 + 6, between, { steps: 6 });
  await expect(page.locator(".dag-msg-ghost")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator(".dag-msg-ghost")).toHaveCount(0);

  await expect.poll(() => body()[4], { timeout: 5_000 }).toBe('c ->> a : "message"');
  expect(body()[3]).toBe('a ->> b : "hello"');
  expect(body()[5]).toBe('b -->> a : "hi"');

  /* It lands picked, with its label open for typing — the way the `+` hands over a new card. */
  const box = page.locator(".dag-rename");
  await expect(box).toBeFocused();
  await box.fill("what time is it");
  await box.press("Enter");
  await expect.poll(() => body()[4], { timeout: 5_000 }).toBe('c ->> a : "what time is it"');
});

test("shift picks a run of messages, and Wrap in puts a fragment round it", async ({ page }) => {
  await open(page);
  await pickMessage(page, 0);
  await pickMessage(page, 1, true);
  expect(await picked(page)).toEqual(["msg:0", "msg:1"]);

  await page.locator("[data-dag-selbar-wrap]").click();
  await page.locator('[data-dag-wrap="loop"]').click();
  await expect
    .poll(() => body().slice(3, 7), { timeout: 5_000 })
    .toEqual(['loop "repeat"', '  a ->> b : "hello"', '  b -->> a : "hi"', "end"]);
  /* The new fragment is what is picked now, so its panel is the next thing a person sees. */
  await expect.poll(() => picked(page), { timeout: 5_000 }).toEqual(["frag:0"]);
});

test("a run that crosses a fragment's edge is not offered Wrap in", async ({ page }) => {
  await open(page);
  await pickMessage(page, 1);
  await expect(page.locator("[data-dag-selbar-wrap]")).toHaveCount(1);
  await pickMessage(page, 2, true);
  await expect(page.locator("[data-dag-selbar-wrap]")).toHaveCount(0);
});

test("a picked fragment takes a condition, another branch, and unwraps", async ({ page }) => {
  await open(page);
  await tap(page, '[data-dag-item="seq"] [data-dag-node="a"]');
  await tap(page, '[data-dag-frag="frag:0"][data-dag-branch="0"]');
  expect(await picked(page)).toEqual(["frag:0"]);
  await page.keyboard.press("Enter");

  await expect(page.locator("[data-dag-prop-branch-0]")).toHaveValue("yes");
  await page.locator("[data-dag-prop-branch-0]").fill("it worked");
  await page.locator("[data-dag-prop-branch-0]").blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('alt "it worked"');

  await page.locator("[data-dag-prop-branch-add]").click();
  await expect
    .poll(() => body().slice(5, 9), { timeout: 5_000 })
    .toEqual(['alt "it worked"', '  a ->> c : "ask"', 'else "otherwise"', "end"]);

  await page.locator("[data-dag-prop-unwrap]").click();
  await expect.poll(() => body().slice(5), { timeout: 5_000 }).toEqual(['a ->> c : "ask"', 'note over a, b : "a note"']);
});

test("a double-click on a fragment's tab retypes that branch's condition", async ({ page }) => {
  await open(page);
  await tap(page, '[data-dag-item="seq"] [data-dag-node="a"]');
  await page.locator('[data-dag-frag="frag:0"][data-dag-branch="0"]').dblclick();
  const box = page.locator(".dag-rename");
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("yes");
  await box.fill("maybe");
  await box.press("Enter");
  await expect.poll(read, { timeout: 5_000 }).toContain('alt "maybe"');
});

test("a note's panel writes its words and who it is over", async ({ page }) => {
  await open(page);
  await tap(page, '[data-dag-item="seq"] [data-dag-node="a"]');
  await tap(page, '[data-dag-frag="note:0"]');
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-dag-props="note:0"]')).toHaveCount(1);

  await page.locator("[data-dag-prop-note-text]").fill("remember this");
  await page.locator("[data-dag-prop-note-text]").blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('note over a, b : "remember this"');

  await page.locator('[data-dag-prop-over="c"]').check();
  await expect.poll(read, { timeout: 5_000 }).toContain('note over a, b, c : "remember this"');
  await page.locator('[data-dag-prop-over="a"]').uncheck();
  await expect.poll(read, { timeout: 5_000 }).toContain('note over b, c : "remember this"');
});

test("a participant's kind is the Kind menu, and the item view adds a participant", async ({ page }) => {
  await open(page);
  await tap(page, '[data-dag-item="seq"] [data-dag-node="a"]');
  await tap(page, '[data-dag-item="seq"] [data-dag-node="a"]');
  await page.keyboard.press("Enter");

  const kind = page.locator("[data-dag-prop-kind]");
  await expect(kind).toHaveValue("service");
  /* No status and no flags: a bare word after a participant is read as the next statement. */
  await expect(page.locator("[data-dag-prop-status]")).toHaveCount(0);
  await expect(page.locator("[data-dag-prop-flag]")).toHaveCount(0);
  await kind.selectOption("db");
  await expect.poll(read, { timeout: 5_000 }).toContain('participant a "Alice" kind=db');

  /* Out to the item, whose one control a sequence needs and the canvas cannot start: a column. */
  await page.locator("[data-dag-prop-out]").click();
  await page.locator("[data-dag-seq-participant-add]").click();
  await expect.poll(() => body()[3], { timeout: 5_000 }).toBe('participant participant2 "Participant"');
});
