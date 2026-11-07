import { beforeAll, describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { loneShape, resizeShape } from "@/edit/build";
import { CODES } from "@/dsl/codes";
import { SHAPE_KINDS, type Graph } from "@/dsl/ir";
import { kindsOf, parseDiagram } from "@/dsl/parse";
import { routeLinks } from "@/layout/boardRoute";
import { setMeasurer, TableMeasurer } from "@/layout/measure";
import { onOutline, outlineOf, SQUARE_SHAPES, textBoxOf } from "@/layout/shapes";
import { sizeGraph } from "@/layout/size";
import type { Theme } from "@/theme/contract";
import { flatten } from "@/quality/geometry";

import theme from "../themes/paper/theme.json";

/**
 * The geometric shapes.
 *
 * A shape is drawn from `outlineOf` and met by an edge through `onOutline`, and the whole point of
 * one function feeding both is that the drawing and the routing cannot disagree. What is held here
 * is that agreement, measured: an arrow into a triangle's side stops *on the side*, not on the box a
 * quarter of the width out, and an arrow into a circle stops on the circle wherever along the side
 * the fan put it.
 */

const T = theme as unknown as Theme;
beforeAll(() => setMeasurer(new TableMeasurer()));

const W = 120;
const H = 120;
const at0 = { x: 0, y: 0, w: W, h: H };

describe("outlineOf", () => {
  for (const kind of SHAPE_KINDS) {
    it(`${kind}: an outline and a place for words, both inside the box`, () => {
      const o = outlineOf(kind, 200, 120);
      expect(o.d.length).toBeGreaterThan(10);
      expect(o.d).not.toMatch(/NaN|Infinity/);
      if (Array.isArray(o.hull)) {
        for (const p of o.hull) {
          expect(p.x).toBeGreaterThanOrEqual(-0.5);
          expect(p.x).toBeLessThanOrEqual(200.5);
          expect(p.y).toBeGreaterThanOrEqual(-0.5);
          expect(p.y).toBeLessThanOrEqual(120.5);
        }
      }
      const t = textBoxOf(kind, 200, 120);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(200);
      expect(t.y + t.h).toBeLessThanOrEqual(120);
      expect(t.w).toBeGreaterThan(0);
      expect(t.h).toBeGreaterThan(0);
    });
  }
});

describe("onOutline", () => {
  it("leaves a circle's side midpoint where it is — the circle touches its box there", () => {
    expect(onOutline("circle", at0, "left", { x: 0, y: 60 })).toEqual({ x: 0, y: 60 });
    expect(onOutline("circle", at0, "top", { x: 60, y: 0 })).toEqual({ x: 60, y: 0 });
  });

  it("brings a fanned anchor in to the circle, keeping its place along the side", () => {
    const p = onOutline("circle", at0, "left", { x: 0, y: 30 });
    expect(p.y).toBe(30);
    expect(Math.hypot(p.x - 60, p.y - 60)).toBeCloseTo(60, 5);
  });

  it("brings a triangle's side anchor in to its slanted side — a quarter of the box", () => {
    const p = onOutline("triangle", at0, "left", { x: 0, y: 60 });
    expect(p.x).toBeCloseTo(W / 4, 5);
    expect(p.y).toBe(60);
    /* Its base is its box's bottom, so nothing moves there. */
    expect(onOutline("triangle", at0, "bottom", { x: 60, y: H })).toEqual({ x: 60, y: H });
  });

  it("works in the box's own place on the board, not only at the origin", () => {
    const p = onOutline("diamond", { x: 500, y: 300, w: 200, h: 100 }, "top", { x: 550, y: 300 });
    /* Halfway from the diamond's top vertex to its left one, the edge is a quarter of the way down. */
    expect(p.x).toBe(550);
    expect(p.y).toBeCloseTo(325, 5);
  });

  it("leaves a shape the router treats as its box exactly where the box is", () => {
    expect(onOutline("cylinder", at0, "left", { x: 0, y: 40 })).toEqual({ x: 0, y: 40 });
  });
});

describe("the sketch dialect's shapes", () => {
  it("offers every shape as a kind, so the menu and E_UNKNOWN_KIND both list it", () => {
    for (const kind of SHAPE_KINDS) expect(kindsOf("sketch")).toContain(kind);
  });

  it("parses every shape clean, with its word as its kind", () => {
    const src = SHAPE_KINDS.map((k, i) => `${k} s${i} "${k}" x=${i * 160} y=0`).join("\n");
    const g = parseDiagram("sketch", src)!;
    expect(g.diagnostics).toEqual([]);
    expect(g.nodes.map((n) => n.kind)).toEqual([...SHAPE_KINDS]);
  });

  it("points a drawing tool's word at this one's", () => {
    const g = parseDiagram("sketch", 'rectangle r "R"')!;
    const d = g.diagnostics.find((x) => x.code === CODES.E_UNKNOWN_KIND)!;
    expect(d.message).toMatch(/Did you mean `box`/);
    expect(parseDiagram("sketch", 'rhombus r "R"')!.diagnostics[0]!.message).toMatch(/`diamond`/);
  });

  it("is a shape only in sketch — the words mean nothing to another dialect", () => {
    const g = parseDiagram("arch", 'circle c "C"')!;
    expect(g.diagnostics.map((d) => d.code)).toContain(CODES.E_UNKNOWN_KIND);
  });
});

describe("sizing a shape", () => {
  const size = (src: string) => {
    const g = parseDiagram("sketch", src)! as Graph;
    return sizeGraph(g, T)[g.nodes[0]!.id]!;
  };
  const m = T.metric.sketch;

  it("takes the theme's box when nobody said", () => {
    expect(size('circle c "C"')).toMatchObject({ w: m.shapeSide, h: m.shapeSide });
    expect(size('cylinder c "C"')).toMatchObject({ w: m.shapeW, h: m.shapeH });
    for (const k of SQUARE_SHAPES) expect(size(`${k} c "C"`).w).toBe(size(`${k} c "C"`).h);
  });

  it("keeps a square shape square when given one side", () => {
    expect(size('circle c "C" w=200')).toMatchObject({ w: 200, h: 200 });
    expect(size('star c "C" h=80')).toMatchObject({ w: 80, h: 80 });
  });

  it("is the author's box when both are given — a circle pulled wide is an ellipse", () => {
    expect(size('circle c "C" w=240 h=120')).toMatchObject({ w: 240, h: 120 });
  });

  it("never grows to its words", () => {
    const long = "a sentence far too long to fit on one line of any shape this size";
    expect(size(`ellipse c "${long}"`)).toMatchObject({ w: m.shapeW, h: m.shapeH });
  });
});

describe("a link to a shape", () => {
  const link = (from: string, to: string) => ({
    id: `l-${from}-${to}`,
    fence: "links",
    from: { item: from.split(".")[0]!, node: from.split(".")[1] },
    to: { item: to.split(".")[0]!, node: to.split(".")[1] },
    dash: false,
    head: "none" as const,
    tail: "none" as const,
    line: 1,
  });

  it("ends on a triangle's slanted side, not on its box", () => {
    const r = routeLinks({
      links: [link("a", "s.t")],
      boxes: new Map([
        ["a", { x: 0, y: 0, w: 200, h: 120 }],
        ["s", { x: 600, y: 0, w: 136, h: 136 }],
      ]),
      nodeBoxes: new Map([["s", { t: { x: 8, y: 8, w: 120, h: 120, shape: "triangle" as const } }]]),
      metric: T.metric,
    });
    const segs = flatten(r.edges[0]!.d);
    const end = segs[segs.length - 1]!.b;
    /* The triangle's left side at mid-height is a quarter of its width in from its box. */
    expect(end.x + r.origin.x).toBeCloseTo(608 + 30, 0);
  });

  it("ends on the one node of an item that is one node, rather than its bare frame", () => {
    const base = {
      links: [link("a", "s")],
      boxes: new Map([
        ["a", { x: 0, y: 0, w: 200, h: 136 }],
        ["s", { x: 600, y: 0, w: 136, h: 136 }],
      ]),
      nodeBoxes: new Map([["s", { c: { x: 8, y: 8, w: 120, h: 120, shape: "circle" as const } }]]),
      metric: T.metric,
    };
    const frame = flatten(routeLinks(base).edges[0]!.d);
    const solo = routeLinks({ ...base, solo: new Map([["s", "c"]]) });
    const card = flatten(solo.edges[0]!.d);
    expect(frame[frame.length - 1]!.b.x + routeLinks(base).origin.x).toBeCloseTo(600, 0);
    expect(card[card.length - 1]!.b.x + solo.origin.x).toBeCloseTo(608, 0);
  });
});

describe("a lone shape", () => {
  const item = (body: string, attrs = "") =>
    parseBoard("t", `\`\`\`sketch {#s x=0 y=0${attrs}}\n${body}\n\`\`\`\n`).items[0]!;

  it("is one bare sketch node and nothing else", () => {
    expect(loneShape(item('circle c "C"'))?.id).toBe("c");
    expect(loneShape(item('box b "B"'))?.id).toBe("b");
    expect(loneShape(item('circle c "C"\ncircle d "D"'))).toBeNull();
    expect(loneShape(item('group g "G" {\n  circle c "C"\n}'))).toBeNull();
    /* A titled one wears a header, and its handles mean the frame. */
    expect(loneShape(item('circle c "C"', ' title="Shapes"'))).toBeNull();
    /* A body that does not parse is not resized through at all. */
    expect(loneShape(item('circle c "C"\nrectangle r "R"'))).toBeNull();
  });

  it("is resized on its own line, and nothing else in the body moves", () => {
    const a = item('circle c "Start" hue=teal %% the entry point');
    expect(resizeShape(a.body, loneShape(a)!, 200, 160)).toBe('circle c "Start" hue=teal w=200 h=160 %% the entry point');
    /* A size already there is rewritten in place, not written twice. */
    const b = item('circle c "Start" w=120 h=120');
    expect(resizeShape(b.body, loneShape(b)!, 200, 160)).toBe('circle c "Start" w=200 h=160');
  });
});
