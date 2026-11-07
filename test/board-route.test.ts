import { describe, expect, it } from "vitest";

import type { BoardLink } from "@/board/types";
import { routeLinks } from "@/layout/boardRoute";
import { flatten, meetsRect } from "@/quality/geometry";
import type { Box } from "@/layout/types";
import type { Theme } from "@/theme/contract";

import theme from "../themes/paper/theme.json";

const T = theme as unknown as Theme;

/**
 * The board-space router.
 *
 * `routeEdges` is already covered against diagrams by `layout.test.ts` and `route-quality.test.ts`;
 * what is new here is the translation — every item on the page as a node, a card inside a diagram
 * as a node of its own with the frame turned to scenery, and an origin the overlay is moved to
 * rather than a negative `viewBox`. So these assert the mapping and leave the curve maths to the
 * tests that own it.
 */

const link = (from: string, to: string, extra: Partial<BoardLink> = {}): BoardLink => {
  const cut = (s: string) => {
    const i = s.lastIndexOf(".");
    return i > 0 ? { item: s.slice(0, i), node: s.slice(i + 1) } : { item: s };
  };
  return {
    id: `l-${from}-${to}`,
    fence: "links",
    from: cut(from),
    to: cut(to),
    dash: false,
    head: "chevron",
    tail: "none",
    line: 1,
    ...extra,
  };
};

const boxes = (entries: Record<string, Box>) => new Map(Object.entries(entries));

describe("routeLinks", () => {
  it("draws nothing when there is nothing to draw", () => {
    expect(routeLinks({ links: [], boxes: boxes({}), nodeBoxes: new Map(), metric: T.metric }).edges).toEqual([]);
  });

  it("drops a link whose end is not on the page", () => {
    const r = routeLinks({
      links: [link("a", "gone")],
      boxes: boxes({ a: { x: 0, y: 0, w: 200, h: 80 } }),
      nodeBoxes: new Map(),
      metric: T.metric,
    });
    expect(r.edges).toEqual([]);
  });

  it("routes between two components, anchored on the facing sides", () => {
    const r = routeLinks({
      links: [link("a", "b")],
      boxes: boxes({ a: { x: 0, y: 0, w: 200, h: 80 }, b: { x: 600, y: 0, w: 200, h: 80 } }),
      nodeBoxes: new Map(),
      metric: T.metric,
    });
    expect(r.edges).toHaveLength(1);
    const segs = flatten(r.edges[0]!.d);
    const start = segs[0]!.a;
    const end = segs[segs.length - 1]!.b;
    /* `a`'s right edge and `b`'s left edge, in overlay coordinates — the origin has moved both. */
    expect(start.x).toBeCloseTo(200 - r.origin.x, 1);
    expect(end.x).toBeGreaterThan(start.x);
    expect(end.x).toBeLessThanOrEqual(600 - r.origin.x + 1);
  });

  it("lands on the card inside a diagram, not on the frame around it", () => {
    /* A diagram 400 tall whose `db` sits near the bottom. Anchoring on the frame put the arrow head
       40px of invisible padding short of the thing it named; it goes to the card. */
    const r = routeLinks({
      links: [link("a", "d.db")],
      /* `a` level with the card, so the side facing it is the left one and the anchor is exact. */
      boxes: boxes({ a: { x: 0, y: 300, w: 200, h: 80 }, d: { x: 600, y: 0, w: 400, h: 400 } }),
      nodeBoxes: new Map([["d", { db: { x: 40, y: 300, w: 200, h: 60 } }]]),
      metric: T.metric,
    });
    const segs = flatten(r.edges[0]!.d);
    const end = segs[segs.length - 1]!.b;
    /* The card's own left edge at its mid-height: 600 + 40, and 300 + 60/2. Anchoring on the frame
       would have stopped it at 600, forty pixels of invisible padding short. */
    expect(end.x).toBeCloseTo(640 - r.origin.x, 1);
    expect(end.y).toBeCloseTo(330 - r.origin.y, 1);
  });

  it("threads between the diagram's other cards rather than over them", () => {
    const other = { x: 40, y: 40, w: 320, h: 60 };
    const r = routeLinks({
      links: [link("a", "d.db")],
      boxes: boxes({ a: { x: 0, y: 0, w: 200, h: 80 }, d: { x: 600, y: 0, w: 400, h: 400 } }),
      nodeBoxes: new Map([["d", { db: { x: 40, y: 300, w: 200, h: 60 }, api: other }]]),
      metric: T.metric,
    });
    const rect = { x: 600 + other.x - r.origin.x, y: other.y - r.origin.y, w: other.w, h: other.h };
    expect(flatten(r.edges[0]!.d).some((s) => meetsRect(s, rect, T.metric.grid))).toBe(false);
  });

  it("gets inside a group in the diagram it is entering", () => {
    /* The group wraps the card. Left as an obstacle it walls the card off, the router gives up, and
       the line runs straight through everything in the way — which is what it did. */
    const group = { x: 24, y: 24, w: 352, h: 352, group: true };
    const other = { x: 40, y: 40, w: 320, h: 60 };
    const r = routeLinks({
      links: [link("a", "d.db")],
      boxes: boxes({ a: { x: 0, y: 300, w: 200, h: 80 }, d: { x: 600, y: 0, w: 400, h: 400 } }),
      nodeBoxes: new Map([["d", { cloud: group, api: other, db: { x: 40, y: 300, w: 200, h: 60 } }]]),
      metric: T.metric,
    });
    const segs = flatten(r.edges[0]!.d);
    const end = segs[segs.length - 1]!.b;
    expect(end.x).toBeCloseTo(640 - r.origin.x, 1);
    const rect = { x: 600 + other.x - r.origin.x, y: other.y - r.origin.y, w: other.w, h: other.h };
    expect(segs.some((s) => meetsRect(s, rect, T.metric.grid))).toBe(false);
  });

  it("falls back to the whole item when the node is unknown to it", () => {
    const r = routeLinks({
      links: [link("a", "d.nope")],
      boxes: boxes({ a: { x: 0, y: 0, w: 200, h: 80 }, d: { x: 600, y: 0, w: 400, h: 400 } }),
      nodeBoxes: new Map([["d", { db: { x: 40, y: 300, w: 200, h: 60 } }]]),
      metric: T.metric,
    });
    expect(r.edges).toHaveLength(1);
    const segs = flatten(r.edges[0]!.d);
    const end = segs[segs.length - 1]!.b;
    /* The frame's own left edge at its mid-height, which is a link that never named a node. */
    expect(end.x).toBeCloseTo(600 - r.origin.x, 1);
    expect(end.y).toBeCloseTo(200 - r.origin.y, 1);
  });

  it("keeps a diagram nothing links into as an obstacle", () => {
    const d = { x: 300, y: 0, w: 200, h: 80 };
    const r = routeLinks({
      links: [link("a", "b")],
      boxes: boxes({ a: { x: 0, y: 0, w: 200, h: 80 }, b: { x: 600, y: 0, w: 200, h: 80 }, d }),
      nodeBoxes: new Map([["d", { x1: { x: 8, y: 8, w: 60, h: 40 } }]]),
      metric: T.metric,
    });
    const rect = { x: d.x - r.origin.x, y: d.y - r.origin.y, w: d.w, h: d.h };
    expect(flatten(r.edges[0]!.d).some((s) => meetsRect(s, rect, T.metric.grid))).toBe(false);
  });

  it("gets past an item standing between the two it connects", () => {
    const between = { x: 300, y: 0, w: 200, h: 80 };
    const r = routeLinks({
      links: [link("a", "b")],
      boxes: boxes({ a: { x: 0, y: 0, w: 200, h: 80 }, b: { x: 600, y: 0, w: 200, h: 80 }, c: between }),
      nodeBoxes: new Map(),
      metric: T.metric,
    });
    const segs = flatten(r.edges[0]!.d);
    const rect = { x: between.x - r.origin.x, y: between.y - r.origin.y, w: between.w, h: between.h };
    /* The grid's worth of inset is the router working in a tight space; a route *through* the card
       is the defect, and it is the same test `route-quality` applies inside a diagram. */
    expect(segs.some((s) => meetsRect(s, rect, T.metric.grid))).toBe(false);
  });

  it("carries the arrow, the label and the hue through unchanged", () => {
    const r = routeLinks({
      links: [link("a", "b", { dash: true, quiet: true, hue: "teal", label: "uses", head: "open" })],
      boxes: boxes({ a: { x: 0, y: 0, w: 200, h: 80 }, b: { x: 600, y: 0, w: 200, h: 80 } }),
      nodeBoxes: new Map(),
      metric: T.metric,
    });
    const e = r.edges[0]!;
    expect(e.dash).toBe(true);
    expect(e.quiet).toBe(true);
    expect(e.hue).toBe("teal");
    expect(e.label?.text).toBe("uses");
    expect(e.head?.kind).toBe("open");
  });

  it("puts the origin outside every box, so the layer holds the whole drawing", () => {
    const r = routeLinks({
      links: [link("a", "b")],
      boxes: boxes({ a: { x: -400, y: -200, w: 200, h: 80 }, b: { x: 600, y: 300, w: 200, h: 80 } }),
      nodeBoxes: new Map(),
      metric: T.metric,
    });
    expect(r.origin.x).toBeLessThan(-400);
    expect(r.origin.y).toBeLessThan(-200);
    expect(r.origin.x + r.size.w).toBeGreaterThan(800);
    expect(r.origin.y + r.size.h).toBeGreaterThan(380);
    for (const s of flatten(r.edges[0]!.d)) {
      expect(s.a.x).toBeGreaterThanOrEqual(0);
      expect(s.a.y).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * A board-level group as an endpoint.
 *
 * The router needed almost nothing for this, which is the point of the shape chosen upstream: a
 * group's union box arrives in `boxes` under the group's own *name*, so `boxes.has()` and the
 * endpoint lookup both work untouched. What it does need to be told is which of those ids are
 * groups, because a group is scenery — left solid, its box would wall off every member inside it
 * and a link naming one member would have no way in. That is the same rule a diagram a link
 * points into already follows, and the same rule a boundary inside a diagram follows one level
 * further down.
 */
describe("routeLinks, to a group", () => {
  const G = { x: 0, y: 0, w: 200, h: 120 };
  const scene = boxes({
    "group-a": G,
    m1: { x: 0, y: 0, w: 90, h: 120 },
    m2: { x: 110, y: 0, w: 90, h: 120 },
    far: { x: 500, y: 20, w: 120, h: 80 },
  });

  it("anchors on the union box filed under the group's name", () => {
    const { edges, origin } = routeLinks({
      links: [link("group-a", "far")],
      boxes: scene,
      nodeBoxes: new Map(),
      groups: new Set(["group-a"]),
      metric: T.metric,
    });
    expect(edges).toHaveLength(1);
    const segs = flatten(edges[0]!.d);
    const start = segs[0]!.a;
    /* It leaves the union's own edge — past both members, which end at x=200 together — rather
       than either member's. In board coordinates, undoing the overlay's origin. */
    expect(start.x + origin.x).toBeCloseTo(G.x + G.w, 0);
    expect(start.y + origin.y).toBeGreaterThan(G.y);
    expect(start.y + origin.y).toBeLessThan(G.y + G.h);
  });

  it("is scenery, so a link to one of its members still gets in", () => {
    const { edges, origin } = routeLinks({
      links: [link("far", "m1")],
      boxes: scene,
      nodeBoxes: new Map(),
      groups: new Set(["group-a"]),
      metric: T.metric,
    });
    expect(edges).toHaveLength(1);
    /* It ends on `m1`'s own right edge, which is inside the group's box — so the box did not
       wall it out. */
    const segs = flatten(edges[0]!.d);
    const end = segs[segs.length - 1]!.b;
    expect(end.x + origin.x).toBeCloseTo(90, 0);
  });

  it("drops the link when the group has no box, exactly as for an absent item", () => {
    const { edges } = routeLinks({
      links: [link("group-gone", "far")],
      boxes: scene,
      nodeBoxes: new Map(),
      groups: new Set(["group-a"]),
      metric: T.metric,
    });
    expect(edges).toEqual([]);
  });

  it("treats a group's box as an obstacle for a link that has nothing to do with it", () => {
    /* Scenery is about the link that *names* it. Everything else on the board still has to get
       round the members, which are ordinary items in this map and always were. */
    const { edges, origin } = routeLinks({
      links: [link("far", "far2")],
      boxes: new Map([...scene, ["far2", { x: -400, y: 20, w: 120, h: 80 }]]),
      nodeBoxes: new Map(),
      groups: new Set(["group-a"]),
      metric: T.metric,
    });
    expect(edges).toHaveLength(1);
    const rect = { x: 0 - origin.x, y: 0 - origin.y, w: 90, h: 120 };
    expect(flatten(edges[0]!.d).some((seg) => meetsRect(seg, rect, T.metric.grid))).toBe(false);
  });
});

/**
 * `via=`: one point an author bent the line through.
 *
 * The curve has to go through the point rather than near it, which is the whole claim a handle
 * under the pointer makes, and the markers have to follow the curve rather than the side they
 * anchored on. Both are measured here; the spelling that gets the point out of the file is
 * `links.test.ts`'s and the gesture that puts it there is the suite's.
 */
describe("a bent link", () => {
  const scene = boxes({ a: { x: 0, y: 0, w: 200, h: 80 }, b: { x: 600, y: 0, w: 200, h: 80 } });
  const bent = (via?: { x: number; y: number }) =>
    routeLinks({ links: [link("a", "b", via ? { via } : {})], boxes: scene, nodeBoxes: new Map(), metric: T.metric });

  /** Where a cubic is at `u`, which is what the drawn path means by "halfway". */
  const at = (d: string, u: number) => {
    const n = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const [p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y] = n as number[];
    const v = 1 - u;
    return {
      x: v ** 3 * p0x! + 3 * v * v * u * p1x! + 3 * v * u * u * p2x! + u ** 3 * p3x!,
      y: v ** 3 * p0y! + 3 * v * v * u * p1y! + 3 * v * u * u * p2y! + u ** 3 * p3y!,
    };
  };

  it("passes through the point, in board coordinates", () => {
    const r = bent({ x: 400, y: -240 });
    const half = at(r.edges[0]!.d, 0.5);
    /* To one decimal, because that is the precision `pathOf` writes: this reads the drawn `d`
       rather than the spine behind it, which is the number a person is looking at. `mid` below is
       the spine's own answer and is exact. */
    expect(half.x + r.origin.x).toBeCloseTo(400, 1);
    expect(half.y + r.origin.y).toBeCloseTo(-240, 1);
  });

  it("reports that point as the line's middle, which is where the handle goes", () => {
    const r = bent({ x: 400, y: -240 });
    expect(r.edges[0]!.mid!.x + r.origin.x).toBeCloseTo(400, 6);
    expect(r.edges[0]!.mid!.y + r.origin.y).toBeCloseTo(-240, 6);
  });

  it("points the head along the curve rather than at the side it anchored on", () => {
    /* Bent hard upwards, the line comes down into `b`'s left side: the arrow has to come down
       with it. Unbent it arrives level, which is the angle this would have kept. */
    const straight = bent().edges[0]!.head!.angle;
    const curved = bent({ x: 400, y: -400 }).edges[0]!.head!.angle;
    expect(straight).toBeCloseTo(0, 6);
    expect(curved).toBeGreaterThan(0.5);
  });

  it("keeps the head pointing along a line whose bend lands on the chord", () => {
    /* A bend at exactly a quarter of the way along from one end puts that end's control point on
       the end itself, and a cubic's tangent there is zero. `atan2(0, 0)` is 0 rather than `NaN`,
       so the arrowhead would have pointed east on a line running south and nothing would have
       failed. Vertical, because east is the one direction that hides it. */
    const r = routeLinks({
      links: [link("a", "b", { via: { x: 100, y: 470 } })],
      boxes: boxes({ a: { x: 0, y: 0, w: 200, h: 80 }, b: { x: 0, y: 600, w: 200, h: 80 } }),
      nodeBoxes: new Map(),
      metric: T.metric,
    });
    expect(r.edges[0]!.head!.angle).toBeCloseTo(Math.PI / 2, 3);
  });

  it("counts the point towards the overlay, so an export does not cut the curve off", () => {
    const far = bent({ x: 400, y: -900 });
    expect(far.origin.y).toBeLessThan(-900);
    expect(far.size.h).toBeGreaterThan(bent().size.h);
  });

  it("leaves every other edge on the board exactly as it was", () => {
    /* The one thing that says this is an added branch rather than a changed router. */
    expect(bent().edges[0]!.d).toBe(
      routeLinks({ links: [link("a", "b")], boxes: scene, nodeBoxes: new Map(), metric: T.metric }).edges[0]!.d,
    );
  });
});
