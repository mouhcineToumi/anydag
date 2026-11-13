import { describe, expect, it } from "vitest";

import type { Theme } from "@/theme/contract";
import dark from "../themes/paper-dark/theme.json";
import neutral from "../themes/neutral/theme.json";
import paper from "../themes/paper/theme.json";

/**
 * The accent is text: every link, "New board", a selected item, the label of a filled button.
 *
 * The defect this holds (#204): Paper's accent was #2F6BF0, 4.42:1 on the page and 4.03:1 on
 * `accentSoft`, so every link in the default theme was just under WCAG AA. It is #2A63E0 now, the
 * same hue one step darker. A filled button writes `card` on the accent, never `paper`, which was
 * the weaker of the two in the light themes.
 */

const THEMES = [paper, neutral, dark] as unknown as Theme[];
const AA = 4.5;

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("the accent as text", () => {
  for (const theme of THEMES) {
    const c = theme.color as unknown as Record<string, string>;
    it(`${theme.name}: reads at AA on the page, on a card and on accentSoft`, () => {
      expect(contrast(c.accent!, c.paper!)).toBeGreaterThanOrEqual(AA);
      expect(contrast(c.accent!, c.card!)).toBeGreaterThanOrEqual(AA);
      expect(contrast(c.accent!, c.accentSoft!)).toBeGreaterThanOrEqual(AA);
    });
    it(`${theme.name}: a filled button's label reads at AA`, () => {
      expect(contrast(c.card!, c.accent!)).toBeGreaterThanOrEqual(AA);
    });
  }
});
