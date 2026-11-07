import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { CODES } from "@/dsl/codes";
import { EMOJI_CATEGORIES } from "@/dsl/emoji-names";
import { ICON_NAMES } from "@/dsl/icon-names";
import type { Graph, Node } from "@/dsl/ir";
import { parseDiagram } from "@/dsl/parse";
import { suggestPicture } from "@/dsl/suggest";
import { layoutGraph } from "@/layout/elk";
import { figureParts, figureSize } from "@/layout/figure";
import { setMeasurer, TableMeasurer } from "@/layout/measure";
import { sizeGraph, sizeLabels } from "@/layout/size";
import { cutOf } from "@/render/art";
import { iconFor } from "@/render/Icon";
import type { Theme } from "@/theme/contract";
import theme from "../themes/paper/theme.json";

/**
 * `figure` — a picture with a caption under it.
 *
 * Three seams. The grammar: it is one more `sketch` kind, and the thing to hold is that the icon
 * vocabulary it leans on now includes fifteen hundred emoji under a namespace of their own, with
 * two colons in `mono:emoji:house`. The geometry: `layout/figure.ts` is read by the sizer *and* the
 * renderer, so its two answers — how big, and where inside — have to agree with each other in
 * every case a resize can produce. And the art: two generated files that must hold every name the
 * vocabulary promises, or `icon=mono:emoji:x` quietly draws a stick figure.
 */

const T = theme as unknown as Theme;
beforeAll(() => setMeasurer(new TableMeasurer()));

const parse = (src: string): Graph => parseDiagram("sketch", src)!;
const one = (src: string): Node => parse(src).nodes[0]!;
const errors = (g: Graph) => g.diagnostics.filter((d) => d.severity === "error");
const warnings = (g: Graph) => g.diagnostics.filter((d) => d.severity === "warn");

describe("the figure statement", () => {
  it("parses clean, with a caption, a meta and every kind of picture", () => {
    const g = parse(`
figure me "Me" x=0 y=0
figure home "Home" "where the heart is" icon=emoji:house x=120 y=0
figure mono "In the hue" icon=mono:emoji:house hue=teal x=240 y=0
figure line "Line art" icon=house x=360 y=0
figure pg "Postgres" icon=postgresql x=480 y=0
figure bare icon=emoji:rocket x=600 y=0
me --> home "lives in"
`);
    expect(errors(g)).toEqual([]);
    expect(warnings(g)).toEqual([]);
    expect(g.nodes.map((n) => n.kind)).toEqual(Array(6).fill("figure"));
    expect(g.nodes.map((n) => n.icon)).toEqual([
      undefined,
      "emoji:house",
      "mono:emoji:house",
      "house",
      "postgresql",
      "emoji:rocket",
    ]);
    expect(g.nodes[1]!.meta).toBe("where the heart is");
    /* No title is a picture and nothing else — the caption is optional, and `finalize()` must not
       fill one in from the id the way a card's is. */
    expect(g.nodes[5]!.title).toBe("");
  });

  it("warns about an emoji that does not exist, and names the near one", () => {
    const g = parse(`figure f "F" icon=emoji:hous`);
    const w = warnings(g);
    expect(w.map((d) => d.code)).toEqual([CODES.W_UNKNOWN_ICON]);
    expect(w[0]!.message).toContain("emoji:house");
  });

  it("points a picture's name written as a kind at the figure that draws it", () => {
    const g = parse(`house home "Home"`);
    const e = errors(g);
    expect(e.map((d) => d.code)).toEqual([CODES.E_UNKNOWN_KIND]);
    expect(e[0]!.message).toContain('figure home "…" icon=emoji:house');
  });

  it("answers `stickman` with the figure's own default, which needs no icon", () => {
    const e = errors(parse(`stickman bob "Bob"`));
    expect(e[0]!.message).toContain('figure bob "…"`');
    expect(e[0]!.message).not.toContain("icon=");
  });

  it("keeps a drawing tool's word for a kind pointed at the kind", () => {
    /* `rectangle` is a synonym for `box`, not a request for a picture of a rectangle. */
    const e = errors(parse(`rectangle r "R"`));
    expect(e[0]!.message).toContain("Did you mean `box`?");
  });

  it("looks pictures up rather than guessing at them", () => {
    expect(suggestPicture("house", ICON_NAMES)).toBe("emoji:house");
    expect(suggestPicture("home", ICON_NAMES)).toBe("emoji:house");
    expect(suggestPicture("server", ICON_NAMES)).toBe("server");
    expect(suggestPicture("stick-figure", ICON_NAMES)).toBe("");
    /* No edit distance over four thousand names: a near miss is not an answer. */
    expect(suggestPicture("hous", ICON_NAMES)).toBeUndefined();
  });
});

describe("the figure's geometry", () => {
  const S = T.metric.sketch;

  it("is the picture alone when there is no caption", () => {
    expect(figureSize(one("figure f icon=emoji:rocket"), T)).toEqual({ w: S.figureSide, h: S.figureSide });
  });

  it("puts one line of caption under the picture", () => {
    const n = one(`figure f "Home"`);
    const size = figureSize(n, T);
    expect(size.w).toBe(S.figureSide);
    expect(size.h).toBe(S.figureSide + S.figureGap + S.figureLineH);
    const parts = figureParts(n, size, T);
    expect(parts.pic.w).toBe(S.figureSide);
    expect(parts.caption!.y).toBeGreaterThanOrEqual(parts.pic.y + parts.pic.h);
    expect(parts.caption!.y + parts.caption!.h).toBeLessThanOrEqual(size.h);
  });

  it("grows wider for a longer caption, then wraps it rather than growing past its measure", () => {
    const short = figureSize(one(`figure f "The payments team"`), T);
    expect(short.w).toBeGreaterThan(S.figureSide);
    const long = one(`figure f "Everybody who has ever asked the payments team for a refund"`);
    const size = figureSize(long, T);
    expect(size.w).toBeLessThanOrEqual(S.figureCaptionW + T.metric.grid);
    const parts = figureParts(long, size, T);
    expect(parts.caption!.h).toBeGreaterThan(S.figureLineH);
    expect(parts.pic.w).toBe(S.figureSide);
  });

  it("never breaks one long word — it widens the figure instead", () => {
    const n = one(`figure f "Supercalifragilisticexpialidociously"`);
    const size = figureSize(n, T);
    expect(size.w).toBeGreaterThan(S.figureCaptionW);
    expect(figureParts(n, size, T).caption!.h).toBe(S.figureLineH);
  });

  it("grows the picture with one given side, as a circle keeps round", () => {
    const wide = one(`figure f "Home" w=160`);
    const size = figureSize(wide, T);
    expect(size.w).toBe(160);
    expect(figureParts(wide, size, T).pic.w).toBe(160);
    const tall = one(`figure f "Home" h=240`);
    const t = figureSize(tall, T);
    expect(t.h).toBe(240);
    expect(figureParts(tall, t, T).pic.w).toBeGreaterThan(S.figureSide);
  });

  it("fits the picture in whatever box a resize writes, and keeps the caption inside it", () => {
    const n = one(`figure f "A caption that has to wrap somewhere" w=96 h=320`);
    for (const box of [
      { w: 96, h: 320 },
      { w: 320, h: 96 },
      { w: 40, h: 40 },
      { w: 200, h: 200 },
    ]) {
      const p = figureParts(n, box, T);
      expect(p.pic.w).toBe(p.pic.h);
      expect(p.pic.w).toBeLessThanOrEqual(box.w);
      expect(p.pic.x).toBeGreaterThanOrEqual(0);
      expect(p.pic.x + p.pic.w).toBeLessThanOrEqual(box.w + 1e-9);
      if (p.caption) expect(p.caption.y).toBeGreaterThanOrEqual(p.pic.y + p.pic.h);
    }
  });

  it("is laid out where the author put it, at the size the sizer said", async () => {
    const g = parse(`figure a "A" icon=emoji:house x=0 y=0\nfigure b icon=emoji:rocket x=200 y=0\na --> b`);
    const sizes = sizeGraph(g, T);
    const placed = await layoutGraph(g, sizes, sizeLabels(g, T), T.metric);
    expect(placed.nodes.a).toMatchObject({ x: 0, y: 0, w: sizes.a!.w, h: sizes.a!.h });
    expect(placed.nodes.b).toMatchObject({ x: 200, y: 0 });
    expect(placed.edges).toHaveLength(1);
  });
});

describe("the emoji vocabulary", () => {
  const read = (f: string) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, "..", "icons", "data", f), "utf8")) as {
      icons: Record<string, { body: string }>;
    };
  const names = EMOJI_CATEGORIES.flatMap((c) => c.icons);

  it("names every subject once, in a category", () => {
    expect(names.length).toBeGreaterThan(1500);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has both cuts of every name it promises, and is in the icon vocabulary", () => {
    const color = read("emoji-color.json");
    const mono = read("emoji-mono.json");
    for (const n of names) {
      expect(color.icons[n], n).toBeDefined();
      expect(mono.icons[n], n).toBeDefined();
      expect(ICON_NAMES.has(`emoji:${n}`), n).toBe(true);
    }
  });

  it("leaves the skin-tone variants out, but keeps a traffic light that only sounds like one", () => {
    expect(names).not.toContain("artist-dark");
    expect(names).toContain("artist");
    expect(names).toContain("horizontal-traffic-light");
  });

  it("draws the mono cut in currentColor, so it can take a hue", () => {
    const mono = read("emoji-mono.json");
    expect(mono.icons.house!.body).toContain("currentColor");
  });

  it("resolves the colour cut as a brand and the mono cut as a silhouette", () => {
    expect(iconFor("figure", T, "emoji:house")).toEqual({ mode: "brand", name: "emoji:house" });
    expect(iconFor("figure", T, "mono:emoji:house")).toEqual({ mode: "mono", name: "emoji:house" });
    /* A figure with no icon is the theme's stick figure. */
    expect(iconFor("figure", T)).toEqual({ mode: "concept", name: "PersonStanding" });
    /* An emoji that does not exist falls back, as every unknown icon does. */
    expect(iconFor("figure", T, "emoji:nope")).toEqual({ mode: "concept", name: "PersonStanding" });
    /* A bare `house` is still Lucide's, as it has been since M11: the namespace is what keeps it. */
    expect(iconFor("figure", T, "house")).toEqual({ mode: "concept", name: "House" });
  });

  it("says which file an icon value needs", () => {
    expect(cutOf("emoji:house")).toBe("color");
    expect(cutOf("mono:emoji:house")).toBe("mono");
    expect(cutOf("mono:postgresql")).toBeNull();
    expect(cutOf("house")).toBeNull();
    expect(cutOf(undefined)).toBeNull();
  });
});
