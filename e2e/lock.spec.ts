import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { lead } from "./keys";
import { openSidebar } from "./sidebar";
import { vaulted } from "./vault";

/**
 * The lock. Read only, so nothing changes by accident: every check here
 * reads the **file** after trying to change it, because the whole of the feature is that the file
 * does not move — and the pill, because a press that did nothing and said nothing would read as a
 * broken page.
 *
 * Each test writes into a folder of its own, for the suite's eight workers over one `boards/`.
 */

let folder = "";
let dir = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-lock-${info.testId}`;
  dir = path.join(BOARDS, folder);
  fs.mkdirSync(dir, { recursive: true });
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  /* Only the folder this test made, and only when it knows which (`CLAUDE.md`, *Things that will bite*). */
  if (folder) fs.rmSync(dir, { recursive: true, force: true });
  folder = "";
  expect(problems, "console output").toEqual([]);
});

const BOARD = `---
title: Locked board
---

\`\`\`md {#one x=0 y=0 w=280}
The first item.
\`\`\`

\`\`\`md {#two x=360 y=0 w=280}
The second item.
\`\`\`
`;

function board(): { name: string; file: string } {
  const file = path.join(dir, "board.board.md");
  fs.writeFileSync(file, BOARD);
  return { name: `${folder}/board`, file };
}

/** Lock this browser before the page loads, the way a reload of a locked tab finds it. */
async function lockFirst(page: Page) {
  await page.addInitScript(() => localStorage.setItem("dag:locked", "1"));
}

async function ready(page: Page) {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

const lock = (page: Page) => page.locator("[data-dag-readonly]");
const pill = (page: Page) => page.locator("[data-dag-readonly-pill]");

test("the top bar's switch and ctrl+shift+L lock and unlock, every tab of the browser hears it, and a reload keeps it", async ({
  page,
  context,
}) => {
  /* Two tabs and a reload are three boards drawn: more than one page's worth of time. */
  test.setTimeout(60_000);
  const { name } = board();
  await page.goto(`/?board=${name}`);
  await ready(page);
  /* Unlocked, the bar carries no lock at all: the switch is in the ⋯ (the UI review). */
  await expect(lock(page)).toHaveCount(0);
  await page.locator("[data-dag-page-more]").click();
  await expect(page.locator("[data-dag-readonly-lock]")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+Shift+L");
  await expect(lock(page)).toHaveAttribute("data-dag-readonly", "on");
  await expect(pill(page)).toHaveText(/Read only/);
  /* The one lock display, with its way out beside it. */
  await expect(page.locator("[data-dag-readonly-unlock]")).toHaveText("Unlock");
  await expect(page.locator("html")).toHaveAttribute("data-dag-locked", "");

  /* Another tab of this browser is locked too, through the `storage` event. */
  const other = await context.newPage();
  await other.goto(`/?board=${name}`);
  await ready(other);
  await expect(lock(other)).toHaveAttribute("data-dag-readonly", "on");

  /* A reload is still locked: it is this browser's, until it is unlocked. */
  await page.reload();
  await ready(page);
  await expect(lock(page)).toHaveAttribute("data-dag-readonly", "on");

  await page.locator("[data-dag-readonly-unlock]").click();
  await expect(lock(page)).toHaveCount(0);
  await expect(lock(other)).toHaveCount(0);

  /* And the ⋯'s row locks it again. */
  await page.locator("[data-dag-page-more]").click();
  await page.locator("[data-dag-readonly-lock]").click();
  await expect(lock(page)).toHaveAttribute("data-dag-readonly", "on");
  await other.close();
});

test("the Read only pill meets 4.5:1 in every theme", async ({ page }) => {
  const { name } = board();
  await lockFirst(page);
  for (const theme of ["neutral", "paper", "paper-dark"]) {
    await page.goto(`/?board=${name}&theme=${theme}`);
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const ratio = await pill(page).evaluate((el) => {
      interface Rgb {
        r: number;
        g: number;
        b: number;
      }
      const parse = (value: string): Rgb | null => {
        const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
        if (!m) return null;
        const parts = m[1]!
          .split(/[,\s/]+/)
          .filter(Boolean)
          .map(Number);
        if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
        return { r: parts[0]!, g: parts[1]!, b: parts[2]! };
      };
      const linear = (value: number): number => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (c: Rgb): number => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
      const style = getComputedStyle(el);
      const fg = parse(style.color)!;
      const bg = parse(style.backgroundColor)!;
      const x = luminance(fg);
      const y = luminance(bg);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    });
    expect(ratio, `${theme}: Read only on its pill`).toBeGreaterThanOrEqual(4.5);
  }
});

test("with nothing open, a locked card says read only and unlocks in place", async ({ page }) => {
  await lockFirst(page);
  await page.goto(await vaulted(page, "/"));
  const card = page.locator("[data-dag-welcome]");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("Read only: nothing here can be changed until you unlock.");
  await expect(card.locator("[data-dag-welcome-unlock]")).toBeVisible();
  await expect(pill(page)).toContainText("Read only");

  /* Both writes are visibly unavailable before they are pressed, and say the chord on hover. */
  for (const what of ["new", "note"]) {
    const act = card.locator(`[data-dag-welcome-${what}]`);
    await expect(act).toHaveAttribute("aria-disabled", "true");
    await expect(act).toHaveAttribute("title", "Read only — unlock (Ctrl+Shift+L)");
    await expect(act).toHaveAttribute("data-dag-readonly-blocked", "");
  }

  /* Unlock is in place, and the card becomes a card that can start something — no reload. */
  await card.locator("[data-dag-welcome-unlock]").click();
  await expect(page.locator("html")).not.toHaveAttribute("data-dag-locked", "");
  await expect(card.locator("[data-dag-welcome-unlock]")).toHaveCount(0);
  await expect(card.locator("[data-dag-welcome-new]")).not.toHaveAttribute("aria-disabled", "true");
  await expect(card.locator("[data-dag-welcome-note]")).not.toHaveAttribute("aria-disabled", "true");
  await expect(lock(page)).toHaveCount(0);
});

test("a refused write shakes the Read only pill, opens no second notice, and Unlock works after it", async ({ page }) => {
  const { name } = board();
  await lockFirst(page);
  await page.goto(`/?board=${name}`);
  await ready(page);
  await openSidebar(page);

  await expect(pill(page)).not.toHaveAttribute("data-dag-readonly-shake", "");
  await page.locator("[data-dag-sidebar-new]").click({ force: true });
  await expect(pill(page)).toHaveAttribute("data-dag-readonly-shake", "");
  /* The refusal is said to a reader by the clipped live line inside the pill — the one place it is
     said — rather than drawn as a second notice under the bar. */
  await expect(page.locator("[data-dag-readonly] .dag-readonly__said")).toHaveText("Read only: unlock to change this.");
  await expect(page.getByText("Read only: unlock to change this.")).toHaveCount(1);

  /* The animation plays rather than the class merely being there; reduced motion is its own
     check below. */
  await expect(pill(page)).toHaveCSS("animation-name", "dag-readonly-shake");

  await page.locator("[data-dag-readonly-unlock]").click();
  await expect(lock(page)).toHaveCount(0);

  /* The same control works again without a reload. */
  await page.locator("[data-dag-sidebar-new]").click();
  await expect(page.locator("[data-dag-sidebar-new-menu]")).toBeVisible();
});

test("the refusal shakes nothing under prefers-reduced-motion", async ({ page }) => {
  const { name } = board();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await lockFirst(page);
  await page.goto(`/?board=${name}`);
  await ready(page);

  await page.locator("[data-dag-dock-prompt]").click({ force: true });
  await expect(pill(page)).toHaveAttribute("data-dag-readonly-shake", "");
  await expect(pill(page)).toHaveCSS("animation-name", "none");
  /* The refusal is still said, to a reader. */
  await expect(page.locator(".dag-readonly__said")).toHaveText("Read only: unlock to change this.");
});

test("a locked board is selected and panned, never moved, deleted, pasted onto or typed into", { tag: "@smoke" }, async ({
  page,
}) => {
  const { name, file } = board();
  const before = fs.readFileSync(file, "utf8");
  await lockFirst(page);
  await page.goto(`/?board=${name}`);
  await ready(page);
  /* The dock stays, so the tools do not vanish without a reason: the writing ones are visibly
     unavailable, the two reading tools are not, and its Locked chip is the way back. */
  const dock = page.locator("[data-dag-dock]");
  await expect(dock).toBeVisible();
  await expect(dock.locator("[data-dag-dock-locked]")).toHaveText("Locked");
  await expect(dock.locator("[data-dag-dock-prompt]")).toHaveAttribute("aria-disabled", "true");
  await expect(dock.locator("[data-dag-tidy]")).toHaveAttribute("aria-disabled", "true");
  await expect(dock.locator("[data-dag-library-toggle]")).toHaveAttribute("aria-disabled", "true");
  for (const tool of ["Select", "Hand"])
    await expect(dock.getByRole("radio", { name: new RegExp(`^${tool}`) })).not.toHaveAttribute("aria-disabled", "true");
  await expect(dock.getByRole("radio", { name: /^Pen/ })).toHaveAttribute("aria-disabled", "true");

  const item = page.locator('[data-dag-item="one"]');
  const at = (await item.boundingBox())!;
  await page.mouse.move(at.x + 40, at.y + 12);
  await page.mouse.down();
  await page.mouse.move(at.x + 140, at.y + 112, { steps: 8 });
  await page.mouse.up();
  /* Selected, with no handle to resize or connect, and a bar that only exports. */
  await expect(item).toHaveAttribute("data-dag-selected", "");
  await expect(page.locator(".dag-handle, .dag-connect-handle")).toHaveCount(0);
  await expect(page.locator("[data-dag-selbar] [data-dag-selbar-export]")).toBeVisible();
  await expect(page.locator("[data-dag-selbar-delete], [data-dag-selbar-duplicate]")).toHaveCount(0);

  await page.keyboard.press("Delete");
  await expect(pill(page)).toHaveAttribute("data-dag-readonly-shake", "");
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Enter");
  await expect(page.locator(".dag-inspector")).toHaveCount(0);
  await lead(page, "n");
  await page.mouse.dblclick(at.x + 40, at.y + 400);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "pasted while locked");
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  });
  await page.waitForTimeout(500);
  expect(fs.readFileSync(file, "utf8")).toBe(before);
  await expect(page.locator(".dag-item")).toHaveCount(2);

  /* The dock's own Locked chip unlocks, and the board is a board again: the pill goes and the
     make tools come back. */
  await dock.locator("[data-dag-dock-locked]").click();
  await expect(lock(page)).toHaveCount(0);
  await expect(dock.locator("[data-dag-dock-locked]")).toHaveCount(0);
  await expect(dock.locator("[data-dag-dock-prompt]")).not.toHaveAttribute("aria-disabled", "true");
});

test("a locked note is read where it is written, and typing into it says why nothing happens", async ({ page }) => {
  const file = path.join(dir, "note.note.md");
  const text = "---\ntitle: Locked note\n---\nSomething to read.\n";
  fs.writeFileSync(file, text);
  await lockFirst(page);
  await page.goto(`/?note=${folder}/note`);
  const editor = page.locator("[data-dag-note-editor]");
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await expect(editor.locator('[contenteditable="false"]').first()).toBeAttached();
  await expect(page.locator("[data-dag-note-title]")).toHaveJSProperty("readOnly", true);

  await editor.getByText("Something to read.").click();
  await page.keyboard.type("xyz");
  await expect(pill(page)).toHaveAttribute("data-dag-readonly-shake", "");

  /* The `⋯` says what unlocking gives back, greyed, rather than leaving it out. */
  await page.locator("[data-dag-page-more]").click();
  await expect(page.locator("[data-dag-page-more-menu] [data-dag-note-make-task]")).toBeDisabled();
  await expect(page.locator("[data-dag-page-more-menu] [data-dag-toolbar-rename]")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  expect(fs.readFileSync(file, "utf8")).toBe(text);
});

test("the sidebar opens and selects while locked, and makes, renames and deletes nothing", async ({ page }) => {
  const { name, file } = board();
  const before = fs.readFileSync(file, "utf8");
  await lockFirst(page);
  await page.goto(`/?board=${name}`);
  await ready(page);
  await openSidebar(page);

  await page.locator("[data-dag-sidebar-new]").click({ force: true });
  await expect(pill(page)).toHaveAttribute("data-dag-readonly-shake", "");
  await expect(page.locator("[data-dag-sidebar-new-menu]")).toHaveCount(0);
  await expect(page.locator("[data-dag-sidebar-add]")).toHaveCount(0);

  const row = page.locator(`[data-dag-sidebar-row][data-dag-sidebar-key="board:${name}"]`);
  await row.click({ button: "right" });
  await expect(page.locator("[data-dag-sidebar-menu-locked]")).toBeVisible();
  for (const what of ["rename", "duplicate", "move", "delete"])
    await expect(page.locator(`[data-dag-sidebar-menu-item="${what}"]`)).toHaveCount(0);
  await expect(page.locator('[data-dag-sidebar-menu-item="favourite"]')).toBeVisible();
  await page.keyboard.press("Escape");

  await row.focus();
  await page.keyboard.press("F2");
  await expect(page.locator("[data-dag-sidebar-name]")).toHaveCount(0);
  await expect(pill(page)).toHaveAttribute("data-dag-readonly-shake", "");
  expect(fs.existsSync(file)).toBe(true);
  expect(fs.readFileSync(file, "utf8")).toBe(before);
});

test("a locked table is read, and its grid answers a keystroke by drawing the eye to the pill", async ({ page }) => {
  const file = path.join(dir, "costs.table.md");
  const text =
    "---\ntitle: Costs\n---\n\n## Costs {#costs}\n\n| Item {#item} | Amount {#amount number} |\n| --- | ---: |\n| Hosting {#r1aaaa} | 120 |\n";
  fs.writeFileSync(file, text);
  await lockFirst(page);
  await page.goto(`/?table=${folder}/costs`);
  const cell = page.locator('[data-dag-grid-at="0:1"]');
  await expect(cell).toBeVisible({ timeout: 20_000 });
  await cell.click();
  await page.keyboard.type("9");
  await page.keyboard.press("Enter");
  await expect(pill(page)).toHaveAttribute("data-dag-readonly-shake", "");
  await expect(page.locator("[data-dag-grid-editing]")).toHaveCount(0);
  await expect(page.locator("[data-dag-tablepage-undo]")).toBeDisabled();
  await page.waitForTimeout(500);
  expect(fs.readFileSync(file, "utf8")).toBe(text);
});
