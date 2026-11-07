import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * `[[wikilinks]]`: drawn and followed by name in the read view and the
 * editor, counted as backlinks, and never rewritten — the file says what it said.
 */

let stem = "";
let problems: string[] = [];
const target = () => `${stem} Target`;
const source = () => `${stem} Source`;
const fileOf = (name: string) => path.join(BOARDS, `${name}.md`);
const BODY = () => `# Source\n\nSee [[${target()}|the target]] and [[Nowhere ${stem}]].\n\nThe second paragraph.\n`;

test.beforeEach(({ page }, info) => {
  stem = `e2e wiki ${info.testId.slice(-8)}${info.repeatEachIndex}`;
  fs.writeFileSync(fileOf(target()), "# Target\n\nThe target.\n");
  fs.writeFileSync(fileOf(source()), BODY());
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  for (const n of [target(), source()]) fs.rmSync(fileOf(n), { force: true });
  expect(problems, "console output").toEqual([]);
});

async function open(page: Page, name: string, view = false) {
  await page.goto(`/?note=${encodeURIComponent(name)}${view ? "&view=1" : ""}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

test("the read view draws a wikilink with its own words and follows it by name", async ({ page }) => {
  await open(page, source(), true);
  const link = page.locator(`[data-dag-wiki-target="${target()}"]`);
  await expect(link).toHaveText("the target");
  await expect(link).toHaveAttribute("href", /ref=[0-9a-z]{10}/);
  await expect(page.locator(`[data-dag-wiki-target="Nowhere ${stem}"]`)).toHaveClass(/dag-ref--missing/);
  await link.click();
  await expect(page.getByText("The target.")).toBeVisible();
  /* And the target, opened to be worked on, counts the source among what links to it. */
  await open(page, target());
  await expect(page.locator("[data-dag-backlinks]")).toHaveAttribute("data-dag-backlinks", "1");
});

test("the editor draws it as a reference and writes it back as it was written", async ({ page }) => {
  await open(page, source());
  await expect(page.locator(`[data-dag-note-editor] [data-dag-wiki-target="${target()}"]`)).toHaveText("the target");
  await page.locator(".bn-block-content", { hasText: "The second paragraph." }).first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Typed.");
  const read = () => fs.readFileSync(fileOf(source()), "utf8");
  await expect.poll(read, { timeout: 5_000 }).toContain("The second paragraph. Typed.");
  expect(read()).toContain(`See [[${target()}|the target]] and [[Nowhere ${stem}]].`);
  expect(read()).not.toContain("dag:");
});
