import { describe, expect, it } from "vitest";

import { metricsHash } from "@/theme/applyTheme";
import { THEMES, paperTheme } from "@/theme/useTheme";

/**
 * The theme a note is printed in: paper is light, so a dark screen prints in a light theme,
 * and one whose measurements are the screen's — an embedded board is laid out once, for the sheet.
 */
describe("paperTheme", () => {
  it("keeps a light theme as it is", () => {
    for (const t of Object.values(THEMES).filter((t) => t.color.scheme !== "dark")) expect(paperTheme(t)).toBe(t);
  });

  it("prints a dark theme in a light one that measures the same", () => {
    const dark = Object.values(THEMES).filter((t) => t.color.scheme === "dark");
    expect(dark.length).toBeGreaterThan(0);
    for (const t of dark) {
      const paper = paperTheme(t);
      expect(paper.color.scheme).not.toBe("dark");
      expect(metricsHash(paper)).toBe(metricsHash(t));
    }
  });
});
