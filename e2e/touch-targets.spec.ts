import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS, openBoards } from "./boards";
import { vaulted } from "./vault";

/**
 * Every control in the shell fits a finger at phone width, and nothing anywhere is under 24px (#209).
 *
 * The audit measured the shell at 390 × 844 and the pages at 1440 × 900. Both are checked here by
 * walking the same selector everywhere, so a control added later is measured without being named:
 * `button`, a link, a `role=button` or `role=treeitem`, a field, and anything given a tab stop.
 *
 * **The regions are named, not guessed.** At 390 the sidebar sheet and the top bar are the shell —
 * the page behind the sheet is covered and not what the audit was about. At 1440 the shell, the
 * search card, the Tasks page, the calendar, a quiz's form and a table's page are each measured
 * whole. The page tabs are the shell's too, and the phone rule makes their close 44px.
 *
 * Deliberate exceptions, and the reason for each:
 *
 * - **A timed block in a week or a day** (`.dag-cal-column > .dag-calendar__item`) is drawn at the
 *   event's duration on the hour grid. Its height *is* the time it lasts, and padding it to 24px
 *   would draw an event that ends later than the file says. This check walks the month, where every
 *   all-day bar is at least 24px and a day's number is 24px.
 * - **A tick in a read-only table cell** (`.dag-grid__check`) is paint, not a control: the cell is
 *   the target, and it is 34px high. In edit mode the press is a cell gesture too, so the span has
 *   no box of its own to grow.
 *
 * Everything else is expected to meet the floor. A failure names the element, its classes and the
 * box it got, so the fix is a measurement away.
 */

const INTERACTIVE = "button, a[href], [role=button], [role=treeitem], input, select, [tabindex]:not([tabindex='-1'])";

/** The exceptions above, as selectors — empty, because the walks here do not enter them. */
const EXCEPTIONS: string[] = [];

interface Small {
  tag: string;
  cls: string;
  label: string;
  w: number;
  h: number;
}

/** Every visible control in `region` whose box is under `min` on either side, and how many were seen. */
async function under(page: Page, region: string, min: number): Promise<{ seen: number; small: Small[] }> {
  return page.evaluate(
    ({ region, selector, min, except }) => {
      const small: { tag: string; cls: string; label: string; w: number; h: number }[] = [];
      const seen = new Set<Element>();
      let counted = 0;
      const look = (el: Element) => {
        if (seen.has(el) || !el.matches(selector) || except.some((s) => el.matches(s))) return;
        seen.add(el);
        const shown = (el as unknown as { checkVisibility?: () => boolean }).checkVisibility?.() ?? true;
        if (!shown) return;
        const box = el.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return;
        counted += 1;
        if (box.width >= min - 0.5 && box.height >= min - 0.5) return;
        const words =
          el.getAttribute("aria-label") ?? el.getAttribute("title") ?? (el.textContent ?? "").trim().replace(/\s+/g, " ");
        small.push({
          tag: el.tagName.toLowerCase(),
          cls: el.getAttribute("class") ?? "",
          label: words.slice(0, 60),
          w: Math.round(box.width * 10) / 10,
          h: Math.round(box.height * 10) / 10,
        });
      };
      for (const root of document.querySelectorAll(region)) {
        look(root);
        for (const el of root.querySelectorAll(selector)) look(el);
      }
      return { seen: counted, small };
    },
    { region, selector: INTERACTIVE, min, except: EXCEPTIONS },
  );
}

/** The named regions, each measured at `min`. */
async function measure(page: Page, where: string, regions: string[], min: number): Promise<void> {
  const bad: string[] = [];
  let seen = 0;
  for (const region of regions) {
    const answer = await under(page, region, min);
    seen += answer.seen;
    for (const s of answer.small) bad.push(`${region} ${s.tag}.${s.cls} "${s.label}" ${s.w}×${s.h}`);
  }
  /* A check that asserts something is absent must be able to find it (`docs/architecture/things-that-will-bite.md`). */
  expect(seen, `${where}: the walk found no controls at all`).toBeGreaterThan(0);
  expect(bad, `${where}: controls under ${min}×${min}`).toEqual([]);
}

let stem = "";
let dir = "";
let top = "";

const boardText = (word: string) =>
  `---\ntitle: Touch ${stem}\n---\n\n\`\`\`md {#a x=0 y=0 w=320}\nThe ${word} lives here.\n\`\`\`\n`;

const noteText = (title: string, lines: string[]) =>
  `---\ntitle: ${JSON.stringify(title)}\n${lines.map((l) => `${l}\n`).join("")}---\nWhat it is about.\n`;

const QUIZ = `---
title: Touch quiz
---

## Which one? {#q1}

- [x] This one
- [ ] That one
`;

const TABLE = `---
title: Touch table
---

## Deals {#deals}

| Name {#name} | Stage {#stage select options="Lead, Won"} |
| --- | --- |
| Acme {#racme} | Won |

## People {#people}

| Name {#name} | Role {#role} |
| --- | --- |
| Ada {#rada} | Engineer |
`;

test.beforeEach(({}, info) => {
  /* A name per test, so the suite's eight workers can write into one board directory. */
  stem = `e2e-touch-${info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  dir = path.join(BOARDS, stem);
  fs.mkdirSync(dir, { recursive: true });
  top = `${stem}-board`;
});

test.afterEach(() => {
  /* Only what this test made, and only when it knows the name (`CLAUDE.md`, *Things that will bite*). */
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  if (top) {
    fs.rmSync(path.join(BOARDS, `${top}.board.md`), { force: true });
    fs.rmSync(path.join(BOARDS, `${top}.assets`), { recursive: true, force: true });
  }
  stem = "";
  dir = "";
  top = "";
});

test("at 390 × 844 the sidebar sheet and the top bar are 44 × 44", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  fs.writeFileSync(path.join(BOARDS, `${top}.board.md`), boardText("touch"));
  fs.writeFileSync(path.join(dir, "table.table.md"), TABLE);
  await page.goto(await vaulted(page, `/?board=${top}`));

  /* The search is a card over the shell, and its field and rows are finger-sized too. */
  await openBoards(page);
  await expect(page.locator("[data-dag-boards]")).toBeVisible();
  await expect(page.locator("[data-dag-board]").first()).toBeVisible({ timeout: 15_000 });
  await measure(page, "the search at 390", ["[data-dag-boards]"], 44);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-boards]")).toHaveCount(0);

  /* The column is a sheet at this width, and the suite starts with it put away. */
  await page.locator("[data-dag-sidebar-toggle]").click();
  await expect(page.locator("[data-dag-sidebar][data-sheet]")).toBeVisible();
  await expect(page.locator(`[data-dag-sidebar-file="${top}"]`)).toBeVisible({ timeout: 15_000 });

  const shell = ["[data-dag-toolbar]", "[data-dag-sidebar][data-sheet]", "[data-dag-sidebar-toggle]"];
  await measure(page, "the shell at 390", shell, 44);

  /* The menus are part of the shell and their rows are controls too. */
  await page.locator("[data-dag-sidebar-new]").click();
  await expect(page.locator("[data-dag-sidebar-new-menu]")).toBeVisible();
  await measure(page, "the New menu at 390", shell, 44);
  await page.keyboard.press("Escape");

  /* The open file's row keeps its ⋯ on screen; its menu is the only way to rename or move on a phone. */
  await page.locator(".dag-sidebar__line--on > .dag-sidebar__tools [data-dag-sidebar-more]").click();
  await expect(page.locator("[data-dag-sidebar-menu]")).toBeVisible();
  await measure(page, "a row's menu at 390", shell, 44);

  await page.locator('[data-dag-sidebar-menu-item="rename"]').click();
  await expect(page.locator("[data-dag-sidebar-name]")).toBeVisible();
  await measure(page, "the rename box at 390", shell, 44);
  await page.keyboard.press("Escape");

  /* The page tabs are the shell's bottom edge; their close is 44px on a phone too. */
  await page.goto(await vaulted(page, `/?table=${encodeURIComponent(`${stem}/table`)}`));
  await expect(page.locator("[data-dag-pagebar]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-dag-page-remove]")).toBeVisible();
  await measure(page, "the page tabs at 390", ["[data-dag-pagebar]"], 44);
});

test("at 1440 × 900 the shell and the search are at least 24 × 24", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  fs.writeFileSync(path.join(BOARDS, `${top}.board.md`), boardText("touchsearch"));
  await page.goto(await vaulted(page, `/?board=${top}`));

  await page.locator("[data-dag-sidebar-toggle]").click();
  await expect(page.locator('[data-dag-sidebar][data-mode="docked"]')).toBeVisible();
  await expect(page.locator(`[data-dag-sidebar-file="${top}"]`)).toBeVisible({ timeout: 15_000 });
  await measure(page, "the shell at 1440", ["[data-dag-toolbar]", "[data-dag-sidebar]", "[data-dag-sidebar-toggle]"], 24);

  await openBoards(page);
  await page.locator("[data-dag-boards] input").fill(stem);
  await expect(page.locator(`[data-dag-board="${top}"]`)).toBeVisible();
  await measure(page, "the search at 1440", ["[data-dag-boards]"], 24);
});

test("at 1440 × 900 Tasks, the calendar, a quiz and a table are at least 24 × 24", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  fs.writeFileSync(path.join(dir, "task.note.md"), noteText("Touch task", ["status: todo", "due: 2035-07-12"]));
  fs.writeFileSync(path.join(dir, "event.note.md"), noteText("Touch event", ["start: 2035-07-12", "end: 2035-07-13"]));
  fs.writeFileSync(path.join(dir, "quiz.quiz.md"), QUIZ);
  fs.writeFileSync(path.join(dir, "table.table.md"), TABLE);

  await page.goto(await vaulted(page, "/?tasks=1"));
  await page.locator("[data-dag-tasks-filter]").fill(stem);
  await expect(page.locator(`[data-dag-task-row="${stem}/task"]`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`[data-dag-task-row="${stem}/task"] .dag-task-status`)).toBeVisible();
  await measure(page, "Tasks at 1440", [".dag-app--tasks"], 24);

  await page.goto(await vaulted(page, "/?calendar=month&date=2035-07-15"));
  await expect(page.locator(`[data-dag-cal-item="${stem}/event"]`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-dag-cal-day-open]").first()).toBeVisible();
  await measure(page, "the calendar at 1440", [".dag-app--calendar"], 24);
  /* The Show card holds a real `<select>`, which is a control too. */
  await page.locator("[data-dag-calendar-show]").click();
  await expect(page.locator("[data-dag-calendar-show-menu]")).toBeVisible();
  await measure(page, "the calendar's Show card at 1440", [".dag-app--calendar"], 24);
  await page.keyboard.press("Escape");

  await page.goto(await vaulted(page, `/?quiz=${encodeURIComponent(`${stem}/quiz`)}`));
  await expect(page.locator("[data-dag-quiz-question]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-dag-quiz-correct-toggle]").first()).toBeVisible();
  await measure(page, "a quiz at 1440", [".dag-app--quiz"], 24);
  /* Delete asks on the card before it does anything. */
  await page.locator("[data-dag-quiz-delete]").click();
  await expect(page.locator("[data-dag-quiz-confirm]")).toBeVisible();
  await measure(page, "a quiz's delete question at 1440", [".dag-app--quiz"], 24);
  await page.locator("[data-dag-quiz-confirm] button").last().click();

  await page.goto(await vaulted(page, `/?table=${encodeURIComponent(`${stem}/table`)}`));
  await expect(page.locator("[data-dag-grid-wrap]")).toBeVisible({ timeout: 15_000 });
  /* A second tab is what draws the close button this issue is about. */
  await expect(page.locator("[data-dag-page]")).toHaveCount(2);
  await expect(page.locator("[data-dag-page-remove]")).toBeVisible();
  await measure(page, "a table at 1440", [".dag-app--table"], 24);
  /* Sort and Filter ask in a card of selects and fields. */
  await page.locator("[data-dag-tablepage-sort]").click();
  await expect(page.locator("[data-dag-tablepage-sorts]")).toBeVisible();
  await measure(page, "a table's Sort card at 1440", [".dag-app--table"], 24);
  await page.keyboard.press("Escape");
  await page.locator("[data-dag-tablepage-filter]").click();
  await expect(page.locator("[data-dag-tablepage-filters]")).toBeVisible();
  await measure(page, "a table's Filter card at 1440", [".dag-app--table"], 24);
  await page.keyboard.press("Escape");
});
