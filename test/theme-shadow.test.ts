import { describe, expect, it } from "vitest";

import type { Theme } from "@/theme/contract";
import dark from "../themes/paper-dark/theme.json";
import neutral from "../themes/neutral/theme.json";
import paper from "../themes/paper/theme.json";

/**
 * The one colour every elevation shadow draws with.
 *
 * The defect this holds: `paper-dark` used `outlineSoft` — a colour *lighter* than the paper — as
 * the shadow, so a 40px blur around the Settings dialog read as a halo. A shadow is depth, which
 * means it must be translucent and it must be darker than the surface it falls on, in every theme.
 */

const THEMES = [paper, neutral, dark] as unknown as Theme[];

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1 };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(value.trim());
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  throw new Error(`not a plain colour: ${value}`);
}

/** WCAG relative luminance, which is what "darker" means to a reader. */
function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** `foreground` painted over `background` at its own alpha. */
function over(foreground: Rgba, background: Rgba): Rgba {
  const a = foreground.a;
  return {
    r: foreground.r * a + background.r * (1 - a),
    g: foreground.g * a + background.g * (1 - a),
    b: foreground.b * a + background.b * (1 - a),
    a: 1,
  };
}

describe("the elevation shadow", () => {
  it("is a translucent token in every theme", () => {
    for (const theme of THEMES) {
      const shadow = parse(theme.color.shadow);
      expect(shadow.a, `${theme.name} shadow`).toBeGreaterThan(0);
      expect(shadow.a, `${theme.name} shadow`).toBeLessThan(1);
    }
  });

  it("is darker than the paper it falls on, in every theme", () => {
    for (const theme of THEMES) {
      const paper = parse(theme.color.paper);
      const shadow = parse(theme.color.shadow);
      /* Both the colour and what it paints over the paper are darker. `outlineSoft` in
         `paper-dark` failed this on both counts, which is the halo the token replaces. */
      expect(luminance(shadow), `${theme.name} shadow`).toBeLessThan(luminance(paper));
      expect(luminance(over(shadow, paper)), `${theme.name} shadow over paper`).toBeLessThan(luminance(paper));
    }
  });
});
