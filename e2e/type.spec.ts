import { expect, test, type Page } from "@playwright/test";

import { openSidebar } from "./sidebar";

/**
 * The chrome's type comes from one place (#206).
 *
 * Every font size in `chrome.css` reads `--dag-ui-text-*`, so two menus built from the same item
 * class draw it at one size (they were 12 and 13 px), and a button takes the size of where it sits
 * instead of the browser's own 13.33 px. This reads what the browser computed, on real menus.
 */

const ITEM = ".dag-more__item";

async function size(page: Page, selector: string): Promise<string> {
  const item = page.locator(selector).first();
  await expect(item).toBeVisible();
  return item.evaluate((el) => getComputedStyle(el).fontSize);
}

test("a menu item is one size in the page's ⋯, the sidebar's New menu and the vault switcher", async ({ page }) => {
  await page.goto("/?board=demo");
  await expect(page.locator("[data-dag-ready]")).toBeVisible({ timeout: 20_000 });

  const root = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return { sm: s.getPropertyValue("--dag-ui-text-sm").trim(), md: s.getPropertyValue("--dag-ui-text-md").trim() };
  });
  expect(root).toEqual({ sm: "12px", md: "13px" });

  await page.locator("[data-dag-page-more]").click();
  const pageMore = await size(page, `[data-dag-page-more-menu] ${ITEM}`);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-page-more-menu]")).toHaveCount(0);

  await openSidebar(page);
  await page.locator("[data-dag-sidebar-new]").click();
  const made = await size(page, `[data-dag-sidebar-new-menu] ${ITEM}`);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-sidebar-new-menu]")).toHaveCount(0);

  await page.locator("[data-dag-vault-switcher]").click();
  const vault = await size(page, `[data-dag-vault-menu] ${ITEM}`);

  expect(made).toBe(pageMore);
  expect(vault).toBe(pageMore);
  expect([root.sm, root.md]).toContain(pageMore);
});

test("an icon button takes the page's type, not the browser's 13.33px", async ({ page }) => {
  await page.goto("/?board=demo");
  await expect(page.locator("[data-dag-ready]")).toBeVisible({ timeout: 20_000 });
  const button = await size(page, "[data-dag-page-more]");
  expect(button).not.toBe("13.3333px");
  expect(button).toMatch(/^1[1-6]px$/);
});
