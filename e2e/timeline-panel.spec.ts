import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * A timeline entry's panel: the date, the section and the status, with no Source tab needed.
 *
 * What is checked is the bytes: each control is a small edit to a line a person also owns, so the
 * file is read back rather than the page. The echo under the When field is read off the page, which
 * is the only place it lives. One board per test — the suite runs in parallel and these write to disk.
 */

const BOARD = `---
title: Timeline panel
---

\`\`\`timeline {#tl x=0 y=0}
section "H1"
  2026-01 "Kickoff"
  2026-03 .. 2026-06 "Build" wait
section "H2"
  2026-09 "Launch"
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-timeline-panel-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** Pick the card whose title is `label`, and open the panel on it. */
async function props(page: Page, label: string) {
  const card = page.locator("[data-dag-node]", { hasText: label }).first();
  await card.click();
  await page.waitForTimeout(400);
  await card.click();
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-props]")).toHaveCount(1);
}

test("typing a date writes it at the precision typed, and echoes how it was read", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  await props(page, "Kickoff");

  const when = page.locator("[data-dag-prop-when]");
  await expect(when).toHaveValue("2026-01");
  const echo = page.locator("[data-dag-prop-when-echo]");

  await when.fill("soon");
  await expect(echo).toHaveAttribute("data-dag-prop-when-echo", "bad");
  await when.blur();
  await page.waitForTimeout(600);
  expect(read()).toContain('  2026-01 "Kickoff"');

  await when.fill("Mar 2026");
  await expect(echo).toHaveText("Understood: March 2026");
  await when.press("Enter");
  await expect.poll(read, { timeout: 5_000 }).toContain('  2026-03 "Kickoff"');

  await when.fill("1 Mar 2026");
  await when.press("Enter");
  await expect.poll(read, { timeout: 5_000 }).toContain('  2026-03-01 "Kickoff"');
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("a point becomes a range and a range's end can be cleared again", async ({ page }) => {
  await open(page);
  await props(page, "Kickoff");
  const when = page.locator("[data-dag-prop-when]");

  await when.fill("Jan 2026 to Feb 2026");
  await expect(page.locator("[data-dag-prop-when-echo]")).toHaveText("Understood: January 2026 → February 2026");
  await when.press("Enter");
  await expect.poll(read, { timeout: 5_000 }).toContain('  2026-01 .. 2026-02 "Kickoff"');

  await when.fill("2026-01");
  await when.press("Enter");
  await expect.poll(read, { timeout: 5_000 }).toContain('  2026-01 "Kickoff"');
  expect(read()).not.toContain("..  2026-02");
});

test("the section menu moves the entry into another section", async ({ page }) => {
  await open(page);
  await props(page, "Kickoff");

  const section = page.locator("[data-dag-prop-section]");
  await expect(section.locator("option")).toHaveText(["no section", "H1", "H2"]);
  await section.selectOption({ label: "H2" });
  await expect
    .poll(read, { timeout: 5_000 })
    .toContain('section "H1"\n  2026-03 .. 2026-06 "Build" wait\nsection "H2"\n  2026-09 "Launch"\n  2026-01 "Kickoff"\n');
  /* The pick followed the entry, not the line it left: the panel is still Kickoff's. */
  await expect(page.locator("[data-dag-prop-when]")).toHaveValue("2026-01");
  await expect(section).toHaveValue(/\d+/);
  await expect(section.locator("option:checked")).toHaveText("H2");
});

test("the status picker offers none, done and wait, each with an icon", async ({ page }) => {
  await open(page);
  await props(page, "Build");

  const options = page.locator("[data-dag-prop-status-option]");
  await expect(options).toHaveCount(3);
  await expect(options).toHaveText(["None", "Done", "Wait"]);
  for (const o of await options.all()) await expect(o.locator("svg")).toHaveCount(1);
  await expect(page.locator('[data-dag-prop-status-option="wait"]')).toHaveAttribute("aria-checked", "true");

  await page.locator('[data-dag-prop-status-option="done"]').click();
  await expect.poll(read, { timeout: 5_000 }).toContain('  2026-03 .. 2026-06 "Build" done');

  await page.locator('[data-dag-prop-status-option="none"]').click();
  await expect.poll(read, { timeout: 5_000 }).toContain('  2026-03 .. 2026-06 "Build"\n');
});
