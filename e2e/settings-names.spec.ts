import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { pageMore } from "./more";
import { openSettings, settingsTab, type SettingsTab } from "./sidebar";

/**
 * What a screen reader and a keyboard need from Settings, rather than what the controls change:
 * every control has a name, the modal carries no second banner, and the MCP command wraps instead
 * of scrolling sideways where a keyboard cannot reach it.
 *
 * The suite runs no axe (it is not a dependency); these are the three rules axe reported, checked
 * the way a person would meet them — by role and visible words on the Sync fields, and by
 * Playwright's own accessible-name computation on every control of every tab.
 */

const DIR = BOARDS;

const BOARD = `---
title: Settings names
---

\`\`\`md {#one x=0 y=0 w=320}
A board to open Settings over.
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-settings-names-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => {
  fs.rmSync(file, { force: true });
  fs.rmSync(path.join(DIR, `${name}.assets`), { recursive: true, force: true });
});

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

/** Every tab, including the two a cloud build draws (the suite's server is one). */
const TABS: SettingsTab[] = ["calendar", "shortcuts", "privacy", "about", "preferences", "vault", "sync", "agents", "export"];

test("the Sync fields are named by the words beside them", async ({ page }) => {
  await open(page);
  await openSettings(page, "sync");

  const server = page.getByRole("textbox", { name: "Server address" });
  await expect(server).toBeVisible();
  await expect(server).toHaveAttribute("data-dag-sync-server-input", "");
  await expect(server).toHaveAccessibleDescription("Where the sync server is, such as https://sync.example.com.");

  const code = page.getByRole("textbox", { name: "One-time code" });
  await expect(code).toBeVisible();
  await expect(code).toHaveAttribute("data-dag-sync-code", "");
  await expect(code).toHaveAccessibleDescription("From the server's admin, good for one pairing.");

  const device = page.getByRole("textbox", { name: "This device's name" });
  await expect(device).toBeVisible();
  await expect(device).toHaveAttribute("data-dag-sync-device-input", "");
  await expect(device).toHaveAccessibleDescription("Optional. Shown in the device list.");
});

test("every input, select and button on every tab has a name", async ({ page }) => {
  await open(page);
  await openSettings(page, "calendar");

  for (const tab of TABS) {
    await settingsTab(page, tab);
    /* A hidden control is not in the accessibility tree; what a person can reach is. */
    const controls = page.locator("[data-dag-settings] :is(input, select, button):visible");
    const count = await controls.count();
    expect(count, `controls on the ${tab} tab`).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(controls.nth(i), `control ${i} on the ${tab} tab`).toHaveAccessibleName(/\S/);
    }
  }
});

test("neither settings card holds a second banner, and the MCP command wraps in the box", async ({ page }) => {
  await open(page);
  await openSettings(page, "agents");
  await expect(page.locator("[data-dag-settings] header")).toHaveCount(0);

  const command = page.locator('[data-dag-setting-copy-value="mcp-claude-code"]');
  await expect(command).toBeVisible();
  const overflow = await command.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-settings]")).toHaveCount(0);

  await pageMore(page, "data-dag-board-settings-open");
  await expect(page.locator("[data-dag-board-settings]")).toBeVisible();
  await expect(page.locator("[data-dag-board-settings] header")).toHaveCount(0);
});
