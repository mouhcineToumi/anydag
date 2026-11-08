import { describe, expect, it } from "vitest";

import { tidy, type TidyBox, type TidyPoint } from "@/board/tidy";

/**
 * Tidy up: the arrangement a person roughly made, made exact.
 *
 * Two properties matter more than any single arrangement, and both are checked over random boards
 * rather than hand-picked ones: nothing overlaps afterwards, and a tidy board is a fixed point —
 * running it again moves nothing. The second is what lets the page skip the write, and what lets
 * the skill run it at the end of every draw as a check rather than a change.
 */

const GAP = 80;
const GRID = 8;
const opts = { gap: GAP, grid: GRID };

const box = (id: string, x: number, y: number, w: number, h: number, group?: string): TidyBox => ({ id, x, y, w, h, group });

/** The boxes after a tidy, at their new positions, sizes rounded up to the grid as the layout does. */
function after(boxes: TidyBox[], moves: Map<string, TidyPoint>): TidyBox[] {
  const up = (v: number) => Math.ceil(v / GRID - 1e-6) * GRID;
  return boxes.map((b) => ({ ...b, x: moves.get(b.id)!.x, y: moves.get(b.id)!.y, w: up(b.w), h: up(b.h) }));
}

const overlapping = (a: TidyBox, b: TidyBox): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/*
 * Two members of one group are exempt, and that is the promise rather than a hole in the check.
 * A group is placed as one rigid box and its members keep the offsets they arrived with, so a
 * drawing made of overlapping pen strokes stays a drawing. Everything else on the board — group
 * against group, group against loose item, loose against loose — must still come apart.
 */
function expectNoOverlap(boxes: TidyBox[]) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.group !== undefined && a.group === b.group) continue;
      expect(overlapping(a, b), `${a.id} and ${b.id} overlap`).toBe(false);
    }
  }
}

describe("a row", () => {
  it("shares one top edge and one gap, whatever the drop was", () => {
    const boxes = [box("a", 0, 0, 200, 100), box("b", 250, 12, 300, 140), box("c", 700, 6, 200, 80)];
    const m = tidy(boxes, opts);
    expect(m.get("a")).toEqual({ x: 0, y: 0 });
    expect(m.get("b")).toEqual({ x: 200 + GAP, y: 0 });
    expect(m.get("c")).toEqual({ x: 200 + GAP + 304 + GAP, y: 0 });
  });

  it("keeps the order the boxes were in, not the order they were listed", () => {
    const boxes = [box("late", 500, 0, 100, 100), box("early", 0, 0, 100, 100)];
    const m = tidy(boxes, opts);
    expect(m.get("early")!.x).toBeLessThan(m.get("late")!.x);
  });
});

describe("a column beside a diagram", () => {
  const notes = [box("n1", 3, 0, 300, 120), box("n2", 0, 160, 300, 120), box("n3", 5, 330, 300, 120)];
  const diagram = box("d", 380, 10, 900, 460);

  it("stacks the notes, stands the diagram beside them, and aligns their tops", () => {
    const m = tidy([...notes, diagram], opts);
    expect(m.get("n1")).toEqual({ x: 0, y: 0 });
    expect(m.get("n2")).toEqual({ x: 0, y: 120 + GAP });
    expect(m.get("n3")).toEqual({ x: 0, y: 2 * (120 + GAP) });
    expect(m.get("d")).toEqual({ x: 304 + GAP, y: 0 });
  });
});

describe("a grid", () => {
  it("shares left edges down a column and top edges along a row, with unequal cells", () => {
    /* Column one is wider than column two; row one is taller than row two. */
    const boxes = [
      box("a", 0, 0, 600, 300),
      box("b", 700, 8, 400, 200),
      box("c", 4, 400, 400, 150),
      box("d", 690, 390, 400, 150),
    ];
    const m = tidy(boxes, opts);
    expect(m.get("a")).toEqual({ x: 0, y: 0 });
    expect(m.get("b")).toEqual({ x: 600 + GAP, y: 0 });
    expect(m.get("c")).toEqual({ x: 0, y: 304 + GAP });
    expect(m.get("d")).toEqual({ x: 600 + GAP, y: 304 + GAP });
  });

  it("keeps an L: a grid with one hole is still a grid", () => {
    const boxes = [box("a", 0, 0, 200, 100), box("b", 300, 0, 200, 100), box("c", 0, 200, 200, 100)];
    const m = tidy(boxes, opts);
    expect(m.get("b")).toEqual({ x: 200 + GAP, y: 0 });
    expect(m.get("c")).toEqual({ x: 0, y: 104 + GAP });
  });

  it("does not keep a diagonal: two boxes that cut both ways become a row", () => {
    const boxes = [box("a", 0, 0, 200, 100), box("b", 300, 200, 200, 100)];
    const m = tidy(boxes, opts);
    expect(m.get("a")).toEqual({ x: 0, y: 0 });
    expect(m.get("b")).toEqual({ x: 200 + GAP, y: 0 });
  });
});

describe("the demo board's shape", () => {
  /* Two columns of prose over a diagram that spans both. */
  const boxes = [
    box("intro", 0, 0, 560, 300),
    box("rules", 0, 340, 560, 290),
    box("table", 640, 0, 560, 250),
    box("infra", 0, 700, 1200, 600),
  ];

  it("keeps the two columns and the wide diagram under them", () => {
    const m = tidy(boxes, opts);
    expect(m.get("intro")).toEqual({ x: 0, y: 0 });
    expect(m.get("table")).toEqual({ x: 560 + GAP, y: 0 });
    expect(m.get("rules")).toEqual({ x: 0, y: 304 + GAP });
    expect(m.get("infra")!.x).toBe(0);
    expect(m.get("infra")!.y).toBe(304 + GAP + 296 + GAP);
    expectNoOverlap(after(boxes, m));
  });
});

describe("a pile", () => {
  it("pulls a duplicate off the item it was dropped on", () => {
    const boxes = [box("a", 0, 0, 400, 200), box("a-copy", 24, 24, 400, 200)];
    const m = tidy(boxes, opts);
    expect(m.get("a")).toEqual({ x: 0, y: 0 });
    expect(m.get("a-copy")).toEqual({ x: 400 + GAP, y: 0 });
  });

  it("stacks a tall pile downwards", () => {
    const boxes = [box("a", 0, 0, 200, 400), box("b", 10, 60, 200, 400)];
    const m = tidy(boxes, opts);
    expect(m.get("b")).toEqual({ x: 0, y: 400 + GAP });
  });
});

describe("groups", () => {
  /*
   * A group is rigid, and it used to be re-arranged inside.
   *
   * The old pair of checks froze the opposite promise — the members dealt out into an exact row,
   * one gap apart — and that is the defect they were reported as: six overlapping pen strokes are
   * a drawing, `arrange` reads a pile with no structure to keep, and it stacks a pile along its
   * longer side. The group survived and the picture in it did not. What `group=` means everywhere
   * else on this board is that the arrangement is the person's, and a drag honours that without
   * touching their spacing.
   */
  it("moves a group as one box, leaving the arrangement inside it alone", () => {
    const boxes = [box("g1", 0, 0, 200, 100, "g"), box("g2", 232, 8, 200, 100, "g"), box("other", 0, 300, 700, 100)];
    const m = tidy(boxes, opts);
    const g1 = m.get("g1")!;
    const g2 = m.get("g2")!;
    /* Exactly the offsets they were written with, not a gap the algorithm chose. */
    expect(g2.x - g1.x).toBe(232);
    expect(g2.y - g1.y).toBe(8);
    /* And the group as a whole is still placed, with what is below it put one gap under its box. */
    expect(g1).toEqual({ x: 0, y: 0 });
    expect(m.get("other")).toEqual({ x: 0, y: 112 + GAP });
  });

  it("keeps a group together even when something else sits between its members", () => {
    const boxes = [box("g1", 0, 0, 200, 100, "g"), box("x", 0, 150, 200, 100), box("g2", 0, 304, 200, 100, "g")];
    const m = tidy(boxes, opts);
    const g1 = m.get("g1")!;
    const g2 = m.get("g2")!;
    /* Their own spacing, kept; nothing of `x` in it. */
    expect(g2.y - g1.y).toBe(304);
    /* Stated as what the name says: nothing of `x` lands between the two members. The old form
       named the two places it could go instead, which was a fact about a group that compacted to
       one gap tall — a rigid group is as tall as its contents, and `x` goes above it. */
    const x = m.get("x")!;
    expect(x.y > g1.y && x.y < g2.y).toBe(false);
  });

  it("puts a group's members on the grid, whatever offsets they arrived with", () => {
    const boxes = [box("g1", 0, 0, 100, 100, "g"), box("g2", 53, 27, 100, 100, "g"), box("o", 0, 400, 100, 100)];
    const m = tidy(boxes, opts);
    for (const id of ["g1", "g2", "o"]) {
      expect(m.get(id)!.x % GRID, `${id} x`).toBe(0);
      expect(m.get(id)!.y % GRID, `${id} y`).toBe(0);
    }
    /* Snapped to the nearest step, so the drawing shifts by less than one grid square. */
    expect(m.get("g2")!.x - m.get("g1")!.x).toBe(56);
    expect(m.get("g2")!.y - m.get("g1")!.y).toBe(24);
  });
});

describe("the origin", () => {
  it("stays where the board was, on the grid", () => {
    const m = tidy([box("a", 803, -397, 100, 100), box("b", 1000, -400, 100, 100)], opts);
    expect(m.get("a")).toEqual({ x: 800, y: -400 });
    expect(m.get("b")).toEqual({ x: 800 + 104 + GAP, y: -400 });
  });

  it("returns nothing for nothing, and one box where it was", () => {
    expect(tidy([], opts).size).toBe(0);
    expect(tidy([box("a", 16, 24, 100, 100)], opts).get("a")).toEqual({ x: 16, y: 24 });
  });

  it("rounds a gap that is off the grid up onto it", () => {
    const m = tidy([box("a", 0, 0, 100, 100), box("b", 200, 0, 100, 100)], { gap: 50, grid: 8 });
    expect(m.get("b")!.x).toBe(104 + 56);
  });
});

describe("over random boards", () => {
  /* A small LCG, so a failure is reproducible from its seed. */
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  function randomBoard(seed: number): TidyBox[] {
    const r = rng(seed);
    const n = 2 + Math.floor(r() * 9);
    const out: TidyBox[] = [];
    for (let i = 0; i < n; i++) {
      const group = r() < 0.2 ? `g${Math.floor(r() * 2)}` : undefined;
      out.push(
        box(
          `b${i}`,
          Math.floor(r() * 1600),
          Math.floor(r() * 1200),
          80 + Math.floor(r() * 600),
          40 + Math.floor(r() * 500),
          group,
        ),
      );
    }
    return out;
  }

  it("leaves nothing overlapping, everything on the grid, and every box accounted for", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const boxes = randomBoard(seed);
      const m = tidy(boxes, opts);
      expect(m.size, `seed ${seed}`).toBe(boxes.length);
      for (const [id, p] of m) {
        expect(p.x % GRID, `seed ${seed} ${id} x`).toBe(0);
        expect(p.y % GRID, `seed ${seed} ${id} y`).toBe(0);
      }
      expectNoOverlap(after(boxes, m));
    }
  });

  it("is a fixed point: tidying a tidy board moves nothing", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const boxes = randomBoard(seed);
      const once = after(boxes, tidy(boxes, opts));
      const twice = tidy(once, opts);
      for (const b of once) expect(twice.get(b.id), `seed ${seed} ${b.id}`).toEqual({ x: b.x, y: b.y });
    }
  });
});
