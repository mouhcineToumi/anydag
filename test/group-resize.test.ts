import { describe, expect, it } from "vitest";

import { parseBoard } from "../src/board/parseBoard";
import type { BoardItem } from "../src/board/types";
import { parseDiagram } from "../src/dsl/parse";
import type { LaidOut } from "../src/edit/build";
import { groupOf, memberOf, memberOps, minimum, paintOf, place, type Member } from "../src/edit/resize";
import type { Box } from "../src/edit/snap";

/**
 * Resizing a group as one thing.
 *
 * The drawing in the report was six pen strokes, grouped: a flower whose stem meets its petals.
 * What resizing it must never do is let one stroke slide off the one it met, so the property held
 * here is that a *drawing's* corner scales exactly about the group's — the frame's padding does
 * not — and that every write still parses.
 */

const BOARD = `---
title: Group resize
---

\`\`\`md {#note x=0 y=0 w=200 group=g}
A note.
\`\`\`

\`\`\`sketch {#stem x=300 y=0 group=g}
ink ink1 pts="0,0 0,160"
\`\`\`

\`\`\`sketch {#leaf x=316 y=64 group=g}
ink ink1 pts="0,40 40,0"
\`\`\`

\`\`\`sketch {#pair x=0 y=300 group=g}
box a "A" x=0 y=0 w=80 h=40
box b "B" x=120 y=0 w=80 h=40
\`\`\`

\`\`\`arch {#flow x=500 y=300 group=g}
service api "API"
\`\`\`
`;

const board = parseBoard("g", BOARD);
const item = (id: string): BoardItem => board.items.find((it) => it.id === id)!;

/* The layout's answers, as `data-dag-layout` would publish them: a drawing at 0,0 inside its frame. */
const LAID: Record<string, LaidOut> = {
  stem: { nodes: { ink1: { x: 0, y: 0, w: 8, h: 160 } }, groups: {} },
  leaf: { nodes: { ink1: { x: 0, y: 0, w: 40, h: 40 } }, groups: {} },
  pair: { nodes: { a: { x: 0, y: 0, w: 80, h: 40 }, b: { x: 120, y: 0, w: 80, h: 40 } }, groups: {} },
  flow: { nodes: { api: { x: 0, y: 0, w: 160, h: 64 } }, groups: {} },
};
/* The frames: each drawing plus 8px of bare padding all round; the note and the diagram as measured. */
const FROM: Record<string, Box> = {
  note: { x: 0, y: 0, w: 200, h: 48 },
  stem: { x: 300, y: 0, w: 24, h: 176 },
  leaf: { x: 316, y: 64, w: 56, h: 56 },
  pair: { x: 0, y: 300, w: 216, h: 56 },
  flow: { x: 500, y: 300, w: 176, h: 80 },
};
const members: Member[] = Object.keys(FROM).map((id) => memberOf(item(id), FROM[id]!, LAID[id] ?? null));
const byId = (id: string) => members.find((m) => m.id === id)!;
const g0 = groupOf(members);

const parses = (type: string, body: string) => {
  const g = parseDiagram(type, body);
  expect(g?.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
};

describe("what each member follows with", () => {
  it("a note's box, a drawing's shapes, a laid-out diagram's place", () => {
    expect(Object.fromEntries(members.map((m) => [m.id, m.follows]))).toEqual({
      note: "box",
      stem: "drawing",
      leaf: "drawing",
      pair: "drawing",
      flow: "slide",
    });
  });

  it("reads where a drawing sits in its frame off the layout, not a padding it assumes", () => {
    expect(byId("stem").inner).toEqual({ left: 8, top: 8, w: 8, h: 160 });
    expect(byId("pair").inner).toEqual({ left: 8, top: 8, w: 200, h: 40 });
  });
});

describe("placing a member", () => {
  const g1: Box = { ...g0, w: g0.w * 2, h: g0.h * 2 };

  it("scales a box about the group's corner", () => {
    expect(place(byId("note"), g0, g1)).toEqual({ x: 0, y: 0, w: 400, h: 96 });
  });

  it("scales a drawing's own corner, so two strokes that met still meet", () => {
    /* The leaf's drawing started 16px right of the stem's and 64px down; doubled, 32 and 128. */
    const stem = place(byId("stem"), g0, g1);
    const leaf = place(byId("leaf"), g0, g1);
    const corner = (m: Member, at: Box) => ({ x: at.x + m.inner!.left, y: at.y + m.inner!.top });
    const s = corner(byId("stem"), stem);
    const l = corner(byId("leaf"), leaf);
    expect({ dx: l.x - s.x, dy: l.y - s.y }).toEqual({ dx: 32, dy: 128 });
    /* And the frame is the drawing at twice the size, with the padding it always had. */
    expect(stem.w).toBe(24 + 8);
    expect(stem.h).toBe(176 + 160);
  });

  it("slides a diagram whose size is the layout's, keeping its place in the space around it", () => {
    /* The diagram ends at the group's right edge; it still does, at its own size. */
    const at = place(byId("flow"), g0, g1);
    expect(at.w).toBe(176);
    expect(at.x + at.w).toBeCloseTo(g1.x + g1.w);
    expect(at.y + at.h).toBeCloseTo(g1.y + g1.h);
  });

  it("the far side stays put: pulled from the west, the east edge does not move", () => {
    const west: Box = { x: g0.x - 100, y: g0.y, w: g0.w + 100, h: g0.h };
    const right = (m: Member) => place(m, g0, west).x + place(m, g0, west).w;
    expect(right(byId("flow"))).toBeCloseTo(g0.x + g0.w);
  });

  it("anchors on what is drawn: a stroke on the edge that holds still does not move at all", () => {
    /* Only the strokes: the stem's drawing is the group's west edge, so pulled east it stays put —
       anchored on frames, it would have moved by its padding. */
    const strokes = [byId("stem"), byId("leaf")];
    const s0 = groupOf(strokes);
    const s1: Box = { ...s0, w: s0.w * 3 };
    expect(s0.x).toBe(308);
    expect(place(byId("stem"), s0, s1).x + 8).toBe(308);
  });

  it("paints a drawing scaled about the frame's corner so its shapes land where they will be written", () => {
    const p = paintOf(byId("leaf"), g0, g1);
    const at = place(byId("leaf"), g0, g1);
    expect(p.sx).toBe(2);
    /* The frame's corner, scaled, carries the padding with it: 8px becomes 16px. */
    expect(p.x + 8 * 2).toBeCloseTo(at.x + 8);
  });
});

describe("the smallest a group may go", () => {
  it("is a factor floor, so no member that scales goes under one grid step — and a diagram always fits", () => {
    const least = minimum(members, g0, 8);
    /* The stem's drawing is 8 wide already, so it asks nothing; the leaf's 40 does: 8/40 of the group. */
    expect(least.w).toBeCloseTo(Math.max(176, g0.w * (8 / 40)));
    expect(least.h).toBeGreaterThanOrEqual(80);
  });
});

describe("what the release writes", () => {
  const east: Box = { ...g0, w: g0.w * 2 };

  it("a note: its width, and a position only where it moved", () => {
    expect(memberOps(item("note"), byId("note"), g0, east, null, 8)).toEqual({ id: "note", attrs: { w: 400 } });
  });

  it("a pen stroke: the stroke's own w=, on the axis that moved and no other, and never its points", () => {
    const op = memberOps(item("leaf"), byId("leaf"), g0, east, LAID.leaf!, 8)!;
    expect("body" in op && op.body).toBe('ink ink1 pts="0,40 40,0" w=80');
    expect("attrs" in op && op.attrs?.x).toBe(Math.round(place(byId("leaf"), g0, east).x));
    parses("sketch", (op as { body: string }).body);
  });

  it("a sketch of two shapes: every shape scaled, still parsing", () => {
    const op = memberOps(item("pair"), byId("pair"), g0, east, LAID.pair!, 8)! as { body: string };
    expect(op.body).toContain('box b "B" y=0 h=40 x=240 w=160');
    parses("sketch", op.body);
  });

  it("a lone circle or figure: both sides, since one given side would decide the other", () => {
    /* `circle w=192` alone is a 192×192 circle and `figure w=160` alone a taller picture: the pull
       east would have grown them south as well, while the group's height held still. */
    const b = parseBoard("s", '```sketch {#c x=0 y=0 group=g}\ncircle c1 "C"\n```\n\n```sketch {#f x=200 y=0 group=g}\nfigure f1 "House" icon=emoji:house\n```\n');
    const at = (id: string) => b.items.find((it) => it.id === id)!;
    const laid: Record<string, LaidOut> = {
      c: { nodes: { c1: { x: 0, y: 0, w: 96, h: 96 } }, groups: {} },
      f: { nodes: { f1: { x: 0, y: 0, w: 80, h: 104 } }, groups: {} },
    };
    const ms = [memberOf(at("c"), { x: 0, y: 0, w: 112, h: 112 }, laid.c!), memberOf(at("f"), { x: 200, y: 0, w: 96, h: 120 }, laid.f!)];
    const g = groupOf(ms);
    const wide: Box = { ...g, w: g.w * 2 };
    const circle = memberOps(at("c"), ms[0]!, g, wide, laid.c!, 8) as { body: string };
    const figure = memberOps(at("f"), ms[1]!, g, wide, laid.f!, 8) as { body: string };
    expect(circle.body).toBe('circle c1 "C" w=192 h=96');
    expect(figure.body).toBe('figure f1 "House" icon=emoji:house w=160 h=104');
    parses("sketch", circle.body);
    parses("sketch", figure.body);
  });

  it("a laid-out diagram: only where it went", () => {
    const op = memberOps(item("flow"), byId("flow"), g0, east, LAID.flow!, 8)!;
    expect(op).toEqual({ id: "flow", attrs: { x: Math.round(place(byId("flow"), g0, east).x), y: 300 } });
  });

  it("nothing at all for a member the pull did not change", () => {
    /* Pulled down, a note at the top keeps its place and its width — and it writes its height. */
    const south: Box = { ...g0, h: g0.h + 100 };
    expect(memberOps(item("note"), byId("note"), g0, south, null, 8)).toEqual({ id: "note", attrs: { h: Math.round(48 * (south.h / g0.h)) } });
    expect(memberOps(item("note"), byId("note"), g0, g0, null, 8)).toBeNull();
  });
});
