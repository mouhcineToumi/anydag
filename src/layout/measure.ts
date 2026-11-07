import type { Theme } from "@/theme/contract";

/**
 * Text measurement.
 *
 * Sizing has to be arithmetic rather than a DOM read: a node's box must be known *before* anything
 * renders, because ELK needs it, and measuring afterwards would mean laying out twice and watching
 * the board twitch. So widths come from a canvas context, which measures the same glyphs the
 * browser is about to draw.
 *
 * The catch is fonts. `measureText` with Inter still loading returns the fallback's widths, off by
 * a few percent — enough to clip a title, and enough to make two runs of the same board disagree.
 * `main.tsx` therefore loads every face by name, then waits for `document.fonts.ready`, before the
 * first render — `ready` alone covers only faces something has already drawn — so there is only
 * ever one measurement regime. `generation` remains as a backstop for a face that arrives late
 * (a theme switch pulling in a new family); it clears the cache and invalidates every layout keyed
 * on it.
 */
export interface TextMeasurer {
  width(text: string, font: string): number;
  /** Greedy wrap; returns the line count, which is all the sizer needs. */
  lines(text: string, font: string, maxWidth: number): number;
  readonly generation: number;
}

class CanvasMeasurer implements TextMeasurer {
  private ctx: CanvasRenderingContext2D | null;
  private cache = new Map<string, number>();
  generation = 0;

  constructor() {
    this.ctx = document.createElement("canvas").getContext("2d");
    void document.fonts?.ready.then(() => {
      this.cache.clear();
      this.generation++;
    });
  }

  width(text: string, font: string): number {
    if (!text) return 0;
    const key = `${font}\0${text}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    if (!this.ctx) return text.length * 7;
    this.ctx.font = font;
    const w = this.ctx.measureText(text).width;
    this.cache.set(key, w);
    return w;
  }

  lines(text: string, font: string, maxWidth: number): number {
    if (!text) return 0;
    let n = 1;
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && this.width(next, font) > maxWidth) {
        n++;
        line = word;
      } else {
        line = next;
      }
    }
    return n;
  }
}

/**
 * A deterministic stand-in for tests and for Node, where there is no canvas and no webfont.
 *
 * Per-character averages measured from the real faces. Within a couple of percent, which is enough
 * for the invariants the layout tests assert (no overlaps, containment, determinism) and not enough
 * to pretend a golden pixel comparison would pass.
 */
export class TableMeasurer implements TextMeasurer {
  generation = 0;

  width(text: string, font: string): number {
    if (!text) return 0;
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 14);
    const mono = /Fira Code|ui-monospace|monospace/.test(font);
    /* Weight and slant are read off the string only to keep the per-character average from
       lying about emphasis; a canvas is the honest measure and this is not trying to be one.
       The slant is allowed for because `fontOf` puts it in front of the weight — a bold italic
       title would otherwise stop matching and measure as a regular weight. */
    const bold = /^(?:italic )?[5-9]00 /.test(font);
    const per = mono ? 0.6 : bold ? 0.55 : 0.52;
    return text.length * size * per;
  }

  lines(text: string, font: string, maxWidth: number): number {
    if (!text) return 0;
    let n = 1;
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && this.width(next, font) > maxWidth) {
        n++;
        line = word;
      } else {
        line = next;
      }
    }
    return n;
  }
}

let measurer: TextMeasurer | null = null;

export function getMeasurer(): TextMeasurer {
  if (!measurer) measurer = typeof document === "undefined" ? new TableMeasurer() : new CanvasMeasurer();
  return measurer;
}

export function setMeasurer(m: TextMeasurer): void {
  measurer = m;
}

/**
 * `600 15px Inter, …` — the exact string the CSS will use, so the two cannot disagree.
 *
 * The slant comes before the weight because that is the CSS font shorthand's own order
 * (style, then weight, then size, then family); in the wrong order `measureText` ignores the
 * whole string and falls back to whatever was set before it, silently.
 */
export const fontOf = (theme: Theme, size: number, weight = 400, mono = false, italic = false): string =>
  `${italic ? "italic " : ""}${weight} ${size}px ${mono ? theme.fonts.mono : theme.fonts.sans}`;
