import { describe, expect, it } from "vitest";

import { emptyGraph, type Edge, type Graph } from "@/dsl/ir";
import type { Box, Placed, RoutedEdge } from "@/layout/types";
import { scoreGraph } from "@/quality/score";
import theme from "../themes/paper/theme.json";
import type { Theme } from "@/theme/contract";

/**
 * The scorer, on drawings small enough to check by hand.
 *
 * `route-quality.test.ts` scores the eleven reference boards and freezes the totals, which is the
 * right test for *the router* and the wrong one for the scorer: every interesting count there is
 * zero, so a check that silently stopped working would pass. These are hand-built layouts with a
 * known answer — a crossing that is a crossing, a crossing that is two edges meeting at a node they
 * share, a card sitting in the middle of a straight run, two cards on top of each other.
 *
 * Nothing here goes near ELK. A `Placed` is a plain object; making one by hand is the whole point,
 * because it is the only way to draw the bad diagram the layout is supposed to never produce.
 */

const T = theme as unknown as Theme;

const edge = (id: string, from: string, to: string): Edge => ({
  id,
  from: { node: from },
  to: { node: to },
  dash: false,
  quiet: false,
  head: "chevron",
  tail: "none",
  line: 1,
});

const routed = (id: string, d: string, label?: { x: number; y: number; text: string }): RoutedEdge => ({
  id,
  d,
  dash: false,
  quiet: false,
  danger: false,
  label: label ? { ...label, anchor: "middle", surface: "paper" } : undefined,
});

function graphOf(edges: Edge[]): Graph {
  const g = emptyGraph("arch", "LR");
  g.edges = edges;
  return g;
}

function placedOf(nodes: Record<string, Box>, edges: RoutedEdge[]): Placed {
  return { kind: "graph", size: { w: 400, h: 400 }, nodes, rows: {}, groups: [], lanes: [], edges };
}

/* Four cards at the corners of a square, well clear of each other and of the middle. */
const CORNERS: Record<string, Box> = {
  a: { x: 0, y: 0, w: 60, h: 40 },
  b: { x: 300, y: 0, w: 60, h: 40 },
  c: { x: 0, y: 300, w: 60, h: 40 },
  d: { x: 300, y: 300, w: 60, h: 40 },
};

describe("crossings", () => {
  it("counts two edges that meet in open space", () => {
    const q = scoreGraph(
      graphOf([edge("e1", "a", "d"), edge("e2", "c", "b")]),
      placedOf(CORNERS, [routed("e1", "M60,40 L300,300"), routed("e2", "M60,300 L300,40")]),
      {},
      T,
    );
    expect(q.totals.crossings).toBeGreaterThan(0);
    expect(q.findings).toContainEqual({ code: "Q_EDGE_CROSSING", ids: ["e1", "e2"] });
  });

  it("says nothing about two edges that share a node", () => {
    /* The same two lines, drawn in exactly the same place — only the pairing changed, and that is
       the whole test. Meeting at a node you have in common is what a diagram is made of; only a
       stranger crossing is a defect. */
    const q = scoreGraph(
      graphOf([edge("e1", "a", "d"), edge("e2", "c", "d")]),
      placedOf(CORNERS, [routed("e1", "M60,40 L300,300"), routed("e2", "M60,300 L300,40")]),
      {},
      T,
    );
    expect(q.totals.crossings).toBe(0);
    expect(q.findings).toEqual([]);
  });

  it("counts a loop between two cards that crosses itself", () => {
    /* Drawn by hand, as reported: `a --> c` and `c --> a` sharing *both* cards, each leaving one half of
       a side and arriving on the opposite half of the other, so they cross in the gap. Sharing a
       node excuses a meeting at the node; it never excused this, and it scored zero. The crossing
       is at the middle of both curves, a joint of each flattening, which is the second half of
       what had hidden it. */
    const q = scoreGraph(
      graphOf([edge("e1", "a", "c"), edge("e2", "c", "a")]),
      placedOf(CORNERS, [routed("e1", "M45,40 C45,170 15,170 15,300"), routed("e2", "M45,300 C45,170 15,170 15,40")]),
      {},
      T,
    );
    expect(q.totals.crossings).toBeGreaterThan(0);
    expect(q.findings).toContainEqual({ code: "Q_EDGE_CROSSING", ids: ["e1", "e2"] });
  });

  it("leaves the same loop alone when its strokes run side by side", () => {
    const q = scoreGraph(
      graphOf([edge("e1", "a", "c"), edge("e2", "c", "a")]),
      placedOf(CORNERS, [routed("e1", "M45,40 C45,170 45,170 45,300"), routed("e2", "M15,300 C15,170 15,170 15,40")]),
      {},
      T,
    );
    expect(q.totals.crossings).toBe(0);
  });
});

describe("routes over cards", () => {
  /*
   * The regression that made this a module rather than a helper.
   *
   * A route drawn as a polyline is one segment for a whole straight run, so a check that samples
   * the *ends* of each segment sees a card in the middle of it and reports nothing. This is that
   * board: `a` to `b` in a straight line, `mid` sitting squarely on it.
   */
  const NODES: Record<string, Box> = { ...CORNERS, mid: { x: 150, y: 0, w: 60, h: 40 } };

  it("catches a card in the middle of a straight run", () => {
    const q = scoreGraph(
      graphOf([edge("e1", "a", "b")]),
      placedOf(NODES, [routed("e1", "M30,20 L330,20")]), // straight through `mid`, at its waist
      {},
      T,
    );
    expect(q.totals.throughNode).toBe(1);
    expect(q.findings).toContainEqual({ code: "Q_EDGE_OVER_NODE", ids: ["e1", "mid"] });
  });

  it("lets a route graze a corner", () => {
    /* Four pixels of a card's edge is the router working in a tight space, not a route through a
       card, and an author asked to fix it has nothing to do. `mid` is 40 tall and the box is shrunk
       by the grid, so a line at 36 clips it and is left alone; the one above, at 20, does not. */
    const q = scoreGraph(graphOf([edge("e1", "a", "b")]), placedOf(NODES, [routed("e1", "M30,36 L330,36")]), {}, T);
    expect(q.totals.throughNode).toBe(0);
  });

  it("does not accuse an edge of crossing its own endpoints", () => {
    const q = scoreGraph(graphOf([edge("e1", "a", "mid")]), placedOf(NODES, [routed("e1", "M30,20 L180,20")]), {}, T);
    expect(q.totals.throughNode).toBe(0);
  });
});

describe("labels", () => {
  const size = { w: 40, h: 12 };

  it("reports a label sitting on a card", () => {
    const q = scoreGraph(
      graphOf([edge("e1", "a", "b")]),
      placedOf(CORNERS, [routed("e1", "M30,20 L330,20", { x: 320, y: 20, text: "reads" })]),
      { e1: size },
      T,
    );
    expect(q.totals.labelOverNode).toBe(1);
    expect(q.findings).toContainEqual({ code: "Q_LABEL_OVER_NODE", ids: ["e1", "b"] });
  });

  it("reports two labels landing on the same spot", () => {
    const q = scoreGraph(
      graphOf([edge("e1", "a", "d"), edge("e2", "c", "b")]),
      placedOf(CORNERS, [
        routed("e1", "M30,20 L330,320", { x: 180, y: 170, text: "one" }),
        routed("e2", "M30,320 L330,20", { x: 182, y: 172, text: "two" }),
      ]),
      { e1: size, e2: size },
      T,
    );
    expect(q.totals.labelOverlaps).toBe(1);
    expect(q.findings).toContainEqual({ code: "Q_LABEL_OVERLAP", ids: ["e2", "e1"] });
  });

  it("measures a label from where it is anchored, not from its middle", () => {
    /* Either side of a loop's two strokes, 60px apart: one ends 12px left of its line, the other
       starts 12px right of its own. Read as centred on `x` they overlapped by most of their width,
       which was a finding about a drawing that has none. */
    const wide = { w: 120, h: 12 };
    const side = (id: string, d: string, x: number, anchor: "start" | "end"): RoutedEdge => ({
      ...routed(id, d),
      label: { x, y: 170, text: id, anchor, surface: "paper" },
    });
    const q = scoreGraph(
      graphOf([edge("e1", "a", "c"), edge("e2", "c", "a")]),
      placedOf(CORNERS, [side("e1", "M60,40 L60,300", 72, "start"), side("e2", "M0,300 L0,40", -12, "end")]),
      { e1: wide, e2: wide },
      T,
    );
    expect(q.totals.labelOverlaps).toBe(0);
  });
});

describe("cards", () => {
  it("reports two cards on top of each other", () => {
    /* `test/layout.test.ts` asserts this can never happen — on the eleven reference boards. Here is
       the same invariant with something to find, which is the only way to know it still looks. */
    const q = scoreGraph(
      graphOf([]),
      placedOf({ a: { x: 0, y: 0, w: 60, h: 40 }, b: { x: 30, y: 20, w: 60, h: 40 } }, []),
      {},
      T,
    );
    expect(q.totals.nodeOverlaps).toBe(1);
    expect(q.findings).toEqual([{ code: "Q_NODE_OVERLAP", ids: ["a", "b"] }]);
  });

  it("leaves cards that merely touch alone", () => {
    const q = scoreGraph(graphOf([]), placedOf({ a: { x: 0, y: 0, w: 60, h: 40 }, b: { x: 60, y: 0, w: 60, h: 40 } }, []), {}, T);
    expect(q.totals.nodeOverlaps).toBe(0);
  });
});

/* Past the frame's own padding, a line is drawn where the page clips it. */
describe("a line past the item's box", () => {
  it("is said, and a line inside the box is not", () => {
    const q = scoreGraph(
      graphOf([edge("e1", "a", "b"), edge("e2", "c", "d")]),
      placedOf(CORNERS, [routed("e1", "M60,20 C120,-80 240,-80 300,20"), routed("e2", "M60,320 L300,320")]),
      {},
      T,
    );
    expect(q.findings).toEqual([{ code: "Q_EDGE_OUTSIDE", ids: ["e1"] }]);
  });

  it("is said of a label hanging off the box, though the line is inside", () => {
    const q = scoreGraph(
      graphOf([edge("e1", "a", "b")]),
      placedOf(CORNERS, [routed("e1", "M60,20 L300,20", { x: 180, y: 2, text: "a label that runs far past the left" })]),
      { e1: { w: 600, h: 12 } },
      T,
    );
    expect(q.findings).toContainEqual({ code: "Q_EDGE_OUTSIDE", ids: ["e1"] });
  });
});

/* The layout measured both the words and the box; the scorer says what it found. */
describe("words a sketch box was drawn too narrow for", () => {
  it("are named by the node", () => {
    const placed: Placed = { ...placedOf(CORNERS, []), clipped: ["a", "c"] };
    expect(scoreGraph(graphOf([]), placed, {}, T).findings).toEqual([
      { code: "Q_TEXT_CLIPPED", ids: ["a"] },
      { code: "Q_TEXT_CLIPPED", ids: ["c"] },
    ]);
  });
});
