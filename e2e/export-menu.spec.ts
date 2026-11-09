import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS, boardId } from "./boards";
import { exportAs, openExport } from "./export";

/**
 * Export at the top right, and a note saved as a PDF.
 *
 * A PDF is the browser's own print — `src/export/print.ts` says why — and a print dialog is nothing a
 * test can press. So every check here replaces `window.print` with a recorder that reads, at the
 * moment the dialog would open, what the dialog would have printed: the page's title (the PDF's file
 * name), the element set out for paper, and what the print stylesheet does to everything else. That
 * is exactly the state the browser photographs. `anydag note export --format pdf` is the other half,
 * printing that same element through Chromium's own PDF writer.
 *
 * Each test writes its own files, named for its test id, because the suite runs in parallel against
 * one directory.
 */

const DIR = BOARDS;

const NOTE = `---
title: Launch checklist
---
# Before the launch

The **orders** table is ready, and \`place()\` is idempotent.

- load test
- a second region
`;

const BOARD = `---
title: Print scratch
---

\`\`\`md {#one x=0 y=0 w=320}
The first item.
\`\`\`
`;

let stem = "";
const made: string[] = [];
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  stem = `e2e-export-${info.testId}`;
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  for (const f of made.splice(0)) fs.rmSync(f, { force: true, recursive: true });
});

function write(name: string, kind: "note" | "board", text: string): string {
  const file = path.join(DIR, `${name}.${kind}.md`);
  fs.writeFileSync(file, text);
  made.push(file);
  return file;
}

async function ready(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function saved(page: Page, act: () => Promise<void>): Promise<{ name: string; bytes: Buffer }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), act()]);
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync((await dl.path())!) };
}

/** What the print dialog would have been handed, recorded instead of opened. */
interface Printed {
  title: string;
  text: string;
  /** The theme the sheet is drawn in, and the one the screen is. */
  sheet: string | undefined;
  screen: string | undefined;
  /** Under the print media query: whether the app is off the page and the sheet on it. */
  appShown: boolean;
  sheetShown: boolean;
  embeds: { ready: boolean; items: number }[];
}

async function recordPrint(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __printed: unknown[] }).__printed = [];
    window.print = () => {
      const sheet = document.querySelector<HTMLElement>(".dag-print");
      const app = document.querySelector<HTMLElement>("#root");
      (window as unknown as { __printed: unknown[] }).__printed.push({
        title: document.title,
        text: sheet?.textContent ?? "",
        sheet: sheet?.dataset.theme,
        screen: document.documentElement.dataset.theme,
        appShown: app ? getComputedStyle(app).display !== "none" : false,
        sheetShown: sheet ? getComputedStyle(sheet).visibility === "visible" : false,
        embeds: Array.from(sheet?.querySelectorAll<HTMLElement>("[data-dag-embed-kind]") ?? []).map((e) => ({
          ready: e.hasAttribute("data-dag-embed-ready"),
          items: e.querySelectorAll(".dag-item").length,
        })),
      });
    };
  });
}

const printed = (page: Page) => page.evaluate(() => (window as unknown as { __printed: Printed[] }).__printed);

test("a note saves as its own file, and as a PDF in the light theme, under its title", { tag: "@smoke" }, async ({ page }) => {
  const name = `${stem}-note`;
  const file = write(name, "note", NOTE);
  await ready(page, `note=${name}&theme=paper-dark`);
  /* The button waits for the note to be known, as Share beside it does. */
  await expect(page.locator(".dag-toolbar [data-dag-export]")).toBeVisible({ timeout: 15_000 });

  const md = await saved(page, () => exportAs(page, "md"));
  expect(md.name).toBe(`${name}.note.md`);
  expect(md.bytes.toString("utf8")).toBe(NOTE);

  await recordPrint(page);
  /* The print stylesheet is what the dialog applies; with it on, the recorder reads what is printed. */
  await page.emulateMedia({ media: "print" });
  await exportAs(page, "pdf");
  await expect.poll(async () => (await printed(page)).length).toBe(1);
  const [got] = await printed(page);

  /* The frontmatter title is the file name the dialog offers, and the sheet's first line. */
  expect(got!.title).toBe("Launch checklist");
  expect(got!.text.startsWith("Launch checklist")).toBe(true);
  expect(got!.text).toContain("Before the launch");
  expect(got!.text).toContain("a second region");
  /* Paper is light whatever the screen wears. */
  expect(got!.screen).toBe("paper-dark");
  expect(got!.sheet).toBe("paper");
  /* Only the sheet is on the page. */
  expect(got!.appShown).toBe(false);
  expect(got!.sheetShown).toBe(true);

  /* And afterwards nothing of it is left: the sheet, the title and the attribute that hides the app. */
  await expect(page.locator(".dag-print")).toHaveCount(0);
  expect(await page.evaluate(() => document.title)).toBe("AnyDag");
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-dag-printing"))).toBe(false);
  await expect(page.locator(".dag-toolbar")).toBeVisible();

  /* An export is a read: the file is exactly what it was. */
  expect(fs.readFileSync(file, "utf8")).toBe(NOTE);
  expect(problems).toEqual([]);
});

test("a note's PDF waits for the board it embeds to be drawn", async ({ page }) => {
  const board = `${stem}-board`;
  write(board, "board", BOARD);
  /* The id is the store's, minted when the file is first listed — which this waits for. */
  const id = await boardId(page, board);

  const name = `${stem}-note`;
  write(name, "note", `# Where it runs\n\n![Print scratch](dag:${id})\n\nAfter the board.\n`);
  await ready(page, `note=${name}`);
  await expect(page.locator(".dag-toolbar [data-dag-export]")).toBeVisible({ timeout: 15_000 });

  await recordPrint(page);
  await exportAs(page, "pdf");
  await expect.poll(async () => (await printed(page)).length, { timeout: 30_000 }).toBe(1);
  const [got] = await printed(page);
  /* No frontmatter title: the note's name is what the dialog offers. */
  expect(got!.title).toBe(name);
  /* The embed is the board, drawn — not a card with its name on it, and not frames still empty. */
  expect(got!.embeds).toEqual([{ ready: true, items: 1 }]);
  expect(got!.text).toContain("The first item.");
  expect(got!.text).toContain("After the board.");
  expect(problems).toEqual([]);
});

test("the Export menu is walked with the arrows and put away with Escape", async ({ page }) => {
  const name = `${stem}-board`;
  write(name, "board", BOARD);
  await ready(page, `board=${name}`);

  await openExport(page);
  const items = page.locator("[data-dag-export-as]");
  await expect(items).toHaveText(["Board as SVG", "Board as PNG (2×)", "Board file (.board.md)"]);
  /* The first choice has the focus the moment the menu opens; the arrows wrap. */
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(items.nth(2)).toBeFocused();

  /* One Escape shuts the menu and hands the focus back to the button, and the board keeps its own. */
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-export-menu]")).toHaveCount(0);
  await expect(page.locator("[data-dag-export]")).toBeFocused();
  expect(problems).toEqual([]);
});

test("printing without Export prints the page as it always did", async ({ page }) => {
  /* The stylesheet that takes the app off the paper is scoped to the moment a note is being exported:
     unscoped, ctrl+P anywhere in the app would print a blank sheet. */
  const name = `${stem}-note`;
  write(name, "note", NOTE);
  await ready(page, `note=${name}`);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".dag-note-view")).toBeVisible();
  await expect(page.locator(".dag-print")).toHaveCount(0);
});
