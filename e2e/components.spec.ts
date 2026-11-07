import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { lead } from "./keys";
import { BOARDS } from "./boards";

/**
 * Keeping a selection as a component, and putting it back on a board.
 *
 * The whole point of the composition work is that the library stops being a fixed menu, so what is
 * checked here is the round trip: what a person selects becomes a file they could open, that file
 * becomes an entry in the panel, and dropping it writes items back into a board — with the ids
 * that would have collided renamed and the ones that would not left exactly as they wrote them.
 */

/* Serial: every test in this file writes into the one `.anydag/components/` directory, and two of
   them running at once cannot tell their own saved component from the other's. */
test.describe.configure({ mode: "serial" });

const DIR = BOARDS;
/* A vault keeps its saved components out of its listing, in `.anydag/components/`. */
const KEPT = path.join(DIR, ".anydag", "components");

const BOARD = `---
title: Keep me
---

\`\`\`arch {#infra x=0 y=0 title="Infra"}
client web "Browser" icon=monitor
service api "API" icon=server
store db "Database" icon=database

web --> api --> db
\`\`\`

\`\`\`md {#note1 note x=560 y=0 w=320}
A note beside it.
\`\`\`
`;

let name = "";
let file = "";
let made: string[] = [];

test.beforeEach(({}, info) => {
  name = `e2e-keep-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
  made = fs.existsSync(KEPT) ? fs.readdirSync(KEPT) : [];
});

test.afterEach(() => {
  fs.rmSync(file, { force: true });
  /* Anything this run added, and nothing anyone else did: a stale component under `boards/` is a
     file the next run would find and this one would be blamed for. */
  if (fs.existsSync(KEPT)) {
    for (const f of fs.readdirSync(KEPT)) if (!made.includes(f)) fs.rmSync(path.join(KEPT, f), { force: true });
    if (fs.readdirSync(KEPT).length === 0) fs.rmSync(KEPT, { recursive: true, force: true });
  }
});

const added = () => fs.readdirSync(KEPT).filter((f) => !made.includes(f));

/*
 * The card for the component *this run* saved, by name.
 *
 * It was `[data-dag-component^="saved:"]` and `.first()`, which is only that component while
 * `boards/components/` holds nothing else — and that directory is the one place in `boards/` a
 * person fills by pressing a button. A component somebody had kept off their own board sorted
 * ahead of this one and the drag picked it up instead, so the check failed against a board full
 * of pen strokes it had never heard of. `made`/`added()` already draw the line between "was here
 * before" and "this run put it there"; this is the same line, one element further on.
 */
const mine = (page: Page) => {
  const file = added()[0];
  if (file === undefined) throw new Error("no component was saved by this test");
  return page.locator(`[data-dag-component="saved:${file.replace(/\.board\.md$/, "")}"]`);
};

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

test("keeps a selection as a component, and the component is a board", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+Shift+K");

  await expect.poll(() => (fs.existsSync(KEPT) ? added() : []), { timeout: 5_000 }).toHaveLength(1);
  const text = fs.readFileSync(path.join(KEPT, added()[0]!), "utf8");
  /* Its own frontmatter, and the items' own source — the same flavour a copy puts on the
     clipboard, so the file opens in this editor like any other board. */
  expect(text).toContain("component:");
  expect(text).toContain('service api "API" icon=server');
  expect(text).toContain("A note beside it.");

  /* And it shows itself: the panel opens on the section that holds it. */
  await expect(page.locator("[data-dag-library]")).toBeVisible();
  await expect(page.locator('.dag-panel__folder:text-is("Yours")')).toBeVisible();
});

test("stamps a kept stack back onto a board, with fresh ids and its arrangement", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+Shift+K");
  await expect.poll(() => (fs.existsSync(KEPT) ? added() : []), { timeout: 5_000 }).toHaveLength(1);

  const before = fs.readFileSync(file, "utf8");
  const card = mine(page);
  await expect(card).toBeVisible();
  await page.waitForTimeout(600);
  await card.click();

  await expect.poll(() => fs.readFileSync(file, "utf8").match(/```arch/g)?.length ?? 0, { timeout: 5_000 }).toBe(2);
  const after = fs.readFileSync(file, "utf8");
  /* Two more items, neither carrying the id it was saved under, and the note still beside the
     diagram rather than on top of it. */
  expect(after).not.toBe(before);
  expect(after.match(/#infra\b/g)).toHaveLength(1);
  expect(after.match(/#note1\b/g)).toHaveLength(1);
  expect(after.match(/```md/g)).toHaveLength(2);
});

test("appends a kept diagram to one of its own type, renaming only what collides", async ({ page }) => {
  /* One diagram alone is a fragment, not a stack: it can join another diagram of its type. */
  fs.writeFileSync(
    file,
    `\`\`\`arch {#infra x=0 y=0}\nservice api "API" icon=server\nstore db "Database" icon=database\napi --> db\n\`\`\`\n`,
  );
  await open(page);
  await page.locator('[data-dag-item="infra"]').click();
  await page.keyboard.press("Control+Shift+K");
  await expect.poll(() => (fs.existsSync(KEPT) ? added() : []), { timeout: 5_000 }).toHaveLength(1);

  const card = mine(page);
  /* The panel re-reads the component list on the watcher's push, so the card that appears first is
     replaced a moment later; grabbing it before that settles picks up a detached node. */
  await expect(card).toBeVisible();
  await page.waitForTimeout(600);
  await card.scrollIntoViewIfNeeded();
  const from = (await card.boundingBox())!;
  const onto = (await page.locator('[data-dag-item="infra"]').boundingBox())!;
  await page.mouse.move(from.x + 30, from.y + 15);
  await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y + 35, { steps: 4 });
  await page.mouse.move(onto.x + onto.width / 2, onto.y + 40, { steps: 8 });
  await page.mouse.up();

  /* Both ids were taken, so both are renamed — and the edge between them follows. */
  await expect.poll(() => fs.readFileSync(file, "utf8"), { timeout: 5_000 }).toContain('service api2 "API"');
  const after = fs.readFileSync(file, "utf8");
  expect(after).toContain('store db2 "Database"');
  expect(after).toContain("api2 --> db2");
  expect(after.match(/```arch/g)).toHaveLength(1);
});

test("shows what a ready-made diagram is made of", async ({ page }) => {
  await open(page);
  await lead(page, "l");
  const toggle = page.locator('[data-dag-expand="diagram-arch"]');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  const parts = page.locator('[data-dag-parts="diagram-arch"] [data-dag-component]');
  await expect(parts).toHaveCount(3);
  await expect(parts.nth(0)).toHaveAttribute("data-dag-component", "part-arch-client");
  await expect(parts.nth(1)).toHaveAttribute("data-dag-component", "part-arch-service");
  await expect(parts.nth(2)).toHaveAttribute("data-dag-component", "part-arch-store");
});
