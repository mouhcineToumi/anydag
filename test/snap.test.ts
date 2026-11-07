import { describe, expect, it } from "vitest";

import { guidesToSvg, snapBox, union, type Box } from "@/edit/snap";

/**
 * Smart guides, as arithmetic.
 *
 * The drag itself is a pointer gesture the e2e spec exercises; what is checked here is the choice
 * — which candidate wins, what it draws, and that nothing snaps when nothing is near.
 */

const box = (x: number, y: number, w = 100, h = 50): Box => ({ x, y, w, h });

describe("snapBox", () => {
  it("snaps nothing when nothing is near", () => {
    expect(snapBox(box(0, 0), [box(500, 500)], 8)).toEqual({ x: null, y: null, guides: [] });
    expect(snapBox(box(0, 0), [], 8).x).toBeNull();
  });

  it("aligns a left edge to another left edge and draws the line through both", () => {
    const s = snapBox(box(203, 300), [box(200, 0)], 8);
    expect(s.x).toBe(200);
    expect(s.y).toBeNull();
    expect(s.guides).toEqual([{ axis: "x", kind: "align", at: 200, from: 0, to: 350 }]);
  });

  it("aligns centres and right edges too, and picks the nearest", () => {
    /* Same width: left, centre and right all say x = 200, six away. */
    const s = snapBox(box(206, 0, 100), [box(200, 100, 100)], 8);
    expect(s.x).toBe(200);
    const t = snapBox(box(150, 0, 100), [box(200, 100, 200)], 8);
    /* Mover right 250 vs other left 200 — no; mover centre 200 vs other left 200 — yes: x = 150. */
    expect(t.x).toBe(150);
  });

  it("aligns on y independently of x", () => {
    const s = snapBox(box(400, 104), [box(0, 100)], 8);
    expect(s.x).toBeNull();
    expect(s.y).toBe(100);
    expect(s.guides[0]).toMatchObject({ axis: "y", kind: "align", at: 100, from: 0, to: 500 });
  });

  it("centres between two boxes in line with it", () => {
    /* A ends at 100, B starts at 400: 300 of room, 100 wide → x = 200. */
    const s = snapBox(box(205, 10), [box(0, 0), box(400, 0)], 8);
    expect(s.x).toBe(200);
    /* The measure is drawn through the middle of where all three overlap: 10..50, so 30. */
    expect(s.guides.filter((g) => g.kind === "gap")).toEqual([
      { axis: "x", kind: "gap", at: 30, from: 100, to: 200 },
      { axis: "x", kind: "gap", at: 30, from: 300, to: 400 },
    ]);
  });

  it("repeats a pair's gap on either side of it", () => {
    /* A 0..100, B 150..250: gap 50. After B: x = 300. Before A: x = -150. */
    expect(snapBox(box(296, 0), [box(0, 0), box(150, 0)], 8).x).toBe(300);
    expect(snapBox(box(-146, 0), [box(0, 0), box(150, 0)], 8).x).toBe(-150);
  });

  it("ignores spacing with boxes it is not in line with", () => {
    const s = snapBox(box(205, 500), [box(0, 0), box(400, 0)], 8);
    expect(s.x).toBeNull();
  });

  it("prefers a spacing candidate over an alignment at the same distance", () => {
    /* Between A (0..100) and B (400..500) the centre is x = 200; a third box at x = 195 offers a
       left-edge alignment 5 away, and the centre is 5 away too. */
    const s = snapBox(box(205, 10), [box(0, 0), box(400, 0), box(195, 300)], 8);
    expect(s.x).toBe(200);
    expect(s.guides.every((g) => g.kind === "gap")).toBe(true);
  });

  it("extends an alignment line over every box on it", () => {
    const s = snapBox(box(2, 600), [box(0, 0), box(0, 200)], 8);
    expect(s.guides[0]).toMatchObject({ at: 0, from: 0, to: 650 });
  });

  it("scales with the threshold", () => {
    expect(snapBox(box(210, 300), [box(200, 0)], 8).x).toBeNull();
    expect(snapBox(box(210, 300), [box(200, 0)], 12).x).toBe(200);
  });
});

describe("union", () => {
  it("is the bounding box", () => {
    expect(union([box(0, 0), box(50, 100, 10, 10)])).toEqual({ x: 0, y: 0, w: 100, h: 110 });
  });
});

describe("guidesToSvg", () => {
  it("draws an alignment as one line and a gap as a measure with ticks", () => {
    const align = guidesToSvg([{ axis: "x", kind: "align", at: 200, from: 0, to: 350 }], 4);
    expect(align).toBe('<line class="dag-guide" x1="200" y1="0" x2="200" y2="350"/>');
    const gap = guidesToSvg([{ axis: "x", kind: "gap", at: 25, from: 100, to: 200 }], 4);
    expect(gap.match(/<line/g)).toHaveLength(3);
    expect(gap).toContain('x1="100" y1="25" x2="200" y2="25"');
    expect(gap).toContain('x1="100" y1="21" x2="100" y2="29"');
  });
});
