import { describe, expect, it } from "vitest";

import { parseDiagram } from "@/dsl/parse";
import { fontOf, setMeasurer, TableMeasurer, type TextMeasurer } from "@/layout/measure";
import { sizeNode } from "@/layout/size";
import theme from "../themes/neutral/theme.json";
import type { Theme } from "@/theme/contract";

const T = theme as unknown as Theme;

/**
 * The emphasis flags have to reach the *measure*, not only the drawing.
 *
 * `TableMeasurer` reads the px back out of the font string and models the weight only as a
 * per-character average — 700 and 600 both land in its bold band, and a slant does not exist to it
 * at all. So a width comparison between a bold card and a plain one would pass through that stand-in
 * for the wrong reason, and this file does not write one. What is honest here is the font string
 * itself: record everything `sizeNode` asks to measure, and assert the title's string carries the
 * theme's bold weight and the slant. A string that says the wrong thing measures the wrong thing
 * against the real canvas, which is the regime the browser runs in.
 */
describe("emphasis in the measure", () => {
  const fonts: string[] = [];
  const inner = new TableMeasurer();
  const spy: TextMeasurer = {
    width: (text, font) => (fonts.push(font), inner.width(text, font)),
    lines: (text, font, maxWidth) => inner.lines(text, font, maxWidth),
    generation: 0,
  };
  setMeasurer(spy);

  const size = (src: string, id: string) => {
    const g = parseDiagram("arch", src)!;
    return sizeNode(g.nodes.find((n) => n.id === id)!, T, "arch");
  };

  it("measures a bold title at the theme's bold weight", () => {
    size('service a "A" bold', "a");
    expect(fonts).toContain(fontOf(T, T.type.nodeTitle, T.type.weightBold));
  });

  it("measures an italic title slanted", () => {
    size('service b "B" italic', "b");
    expect(fonts).toContain(fontOf(T, T.type.nodeTitle, 600, false, true));
  });

  it("measures both at once, slant first — the CSS shorthand's own order", () => {
    size('service c "C" bold italic', "c");
    expect(fonts).toContain(fontOf(T, T.type.nodeTitle, T.type.weightBold, false, true));
  });

  it("leaves an unbold title at the regular weight", () => {
    fonts.length = 0;
    size('service d "D"', "d");
    expect(fonts).toContain(fontOf(T, T.type.nodeTitle, 600));
    expect(fonts).not.toContain(fontOf(T, T.type.nodeTitle, T.type.weightBold));
  });

  it("never comes out narrower than the same card unbold", () => {
    const plain = size('service e "E"', "e");
    const bold = size('service f "F" bold', "f");
    expect(bold.w).toBeGreaterThanOrEqual(plain.w);
  });
});
