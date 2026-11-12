import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { pageMore } from "./more";
import { openSettings, settingsTab, type SettingsTab } from "./sidebar";

/**
 * Text in Settings, measured rather than eyeballed.
 *
 * `--dag-color-muted` is 2.6:1 on Neutral's white card and 2.4:1 on its side panel, so anything a
 * person must read there is painted with `slate` instead. This walks every tab in every theme, and
 * the board settings card after it, and computes the WCAG contrast of each visible text node
 * against the nearest opaque background behind it — the same thing axe reports, without a
 * dependency the project would have to carry. Placeholders are measured through
 * `getComputedStyle(input, "::placeholder")`, because that colour does not appear on the input's
 * own computed style.
 *
 * The threshold is 4.5:1, or 3:1 for large text (24px, or 18.66px and bold). Disabled controls are
 * skipped: WCAG exempts them, and the app fades them with `opacity`, which would make a measured
 * ratio say less about the token than about the fade.
 */

const BOARD = `---
title: Settings contrast scratch
---

\`\`\`md {#one x=0 y=0 w=320}
A note.
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-contrast-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => {
  fs.rmSync(file, { force: true });
});

async function open(page: Page, theme: string): Promise<void> {
  await page.goto(`/?board=${name}&theme=${theme}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

interface Audit {
  text: number;
  placeholders: number;
  failures: string[];
}

/**
 * Every visible element under `selector` with text of its own, and every visible input with a
 * placeholder. The colour is composited over the closest ancestor whose background is opaque; a
 * token is opaque, so a translucent layer above it is a fade rather than the surface being read.
 */
function audit(page: Page, selector: string): Promise<Audit> {
  return page.evaluate((rootSelector) => {
    interface Rgb {
      r: number;
      g: number;
      b: number;
      a: number;
    }

    const parse = (value: string): Rgb | null => {
      const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
      if (!m) return null;
      const parts = m[1]!
        .split(/[,\s/]+/)
        .filter(Boolean)
        .map(Number);
      if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
      return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
    };

    const linear = (value: number): number => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (c: Rgb): number => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
    const contrast = (a: Rgb, b: Rgb): number => {
      const x = luminance(a);
      const y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const over = (c: Rgb, bg: Rgb): Rgb =>
      c.a >= 1 ? c : { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 };
    const background = (el: Element): Rgb => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c && c.a >= 0.999) return c;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const where = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).join(".") : "";
      return classes ? `${tag}.${classes}` : tag;
    };
    const weightOf = (value: string): number =>
      value === "bold" ? 700 : value === "normal" ? 400 : Number.isNaN(Number(value)) ? 400 : Number(value);
    const large = (size: number, weight: number): boolean => size >= 24 || (size >= 18.66 && weight >= 700);
    const report = (el: Element, color: Rgb, bg: Rgb, size: number, weight: number): string | null => {
      const ratio = contrast(over(color, bg), bg);
      const need = large(size, weight) ? 3 : 4.5;
      if (ratio >= need) return null;
      return `${where(el)}: ${ratio.toFixed(2)}:1, needs ${need}:1 (${getComputedStyle(el).color} on rgb(${bg.r}, ${bg.g}, ${bg.b}))`;
    };
    const visible = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
      if (Number(style.opacity) === 0) return false;
      return el.getClientRects().length > 0;
    };
    const disabled = (el: Element): boolean => !!el.closest(":disabled, [aria-disabled='true']");

    const roots = document.querySelectorAll(rootSelector);
    if (!roots.length) return { text: 0, placeholders: 0, failures: [`nothing matched ${rootSelector}`] };

    const failures: string[] = [];
    let text = 0;
    let placeholders = 0;

    for (const root of roots) {
      for (const el of [root as HTMLElement, ...root.querySelectorAll<HTMLElement>("*")]) {
        if (!(el instanceof HTMLElement) || disabled(el) || !visible(el)) continue;
        const own = Array.from(el.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim();
        if (!own) continue;
        const style = getComputedStyle(el);
        const color = parse(style.color);
        if (!color) continue;
        text++;
        const failure = report(el, color, background(el), parseFloat(style.fontSize), weightOf(style.fontWeight));
        if (failure) failures.push(`${failure} — "${own.replace(/\s+/g, " ").slice(0, 48)}"`);
      }

      for (const el of root.querySelectorAll<HTMLElement>("input[placeholder], textarea[placeholder]")) {
        if (!(el instanceof HTMLElement) || disabled(el) || !visible(el)) continue;
        const style = getComputedStyle(el);
        const pseudo = getComputedStyle(el, "::placeholder");
        const color = parse(pseudo.color);
        if (!color) continue;
        placeholders++;
        const bg = background(el);
        const ratio = contrast(over(color, bg), bg);
        const need = large(
          parseFloat(pseudo.fontSize) || parseFloat(style.fontSize),
          weightOf(pseudo.fontWeight || style.fontWeight),
        )
          ? 3
          : 4.5;
        if (ratio < need) {
          failures.push(
            `${where(el)}::placeholder: ${ratio.toFixed(2)}:1, needs ${need}:1 (${pseudo.color} on rgb(${bg.r}, ${bg.g}, ${bg.b})) — "${el.getAttribute("placeholder")}"`,
          );
        }
      }
    }

    return { text, placeholders, failures };
  }, selector);
}

test("text in Settings and the board settings card meets contrast in every theme", async ({ page }) => {
  /* Warm and dark as well as the default, because the token is the same and the surfaces are not:
     `slate` is 6.3:1 on Neutral's white and 5.8:1 on its panel, but it is the pair of values in a
     theme that decides, so each folder is measured in its own right. */
  for (const theme of ["neutral", "paper", "paper-dark"]) {
    let placeholders = 0;
    await open(page, theme);
    await openSettings(page);

    const tabs = await page
      .locator("[data-dag-settings-tab-button]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-dag-settings-tab-button") as SettingsTab));
    /* The cloud switch is on in the suite, so Privacy and Sync are drawn; both are checked. */
    expect(tabs).toContain("vault-general");
    expect(tabs).toContain("export");

    /* The group headers are ink now, and the line under each is slate: both must clear 4.5:1 on the
       panel behind them, in every theme. */
    const headings = await audit(page, ".dag-settings-modal__heading, .dag-settings-modal__note");
    expect(headings.text, `${theme}: group headers and notes found`).toBeGreaterThanOrEqual(6);
    expect(headings.failures, `${theme}: group headers`).toEqual([]);

    for (const tab of tabs) {
      await settingsTab(page, tab);
      const result = await audit(page, "[data-dag-settings]");
      /* A selector that finds nothing would pass every assertion under it. */
      expect(result.text, `${theme} / ${tab}: text found`).toBeGreaterThan(8);
      expect(result.failures, `${theme} / ${tab}`).toEqual([]);
      placeholders += result.placeholders;
    }

    /* The placeholder is where the default model is shown, so it is a value and not a decoration. */
    expect(placeholders, `${theme}: placeholders found`).toBeGreaterThan(0);

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-dag-settings]")).toHaveCount(0);

    await pageMore(page, "data-dag-board-settings-open");
    const card = page.locator("[data-dag-board-settings]");
    await expect(card).toBeVisible();
    const board = await audit(page, "[data-dag-board-settings]");
    expect(board.text, `${theme} / board settings: text found`).toBeGreaterThanOrEqual(4);
    expect(board.failures, `${theme} / board settings`).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
  }
});
