import { beforeAll, describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import type { Graph } from "@/dsl/ir";
import { parseDiagram } from "@/dsl/parse";
import { boxesOf, clearSpot, cornerOf, fileAt, frameShift, grow, scaleFixed, type LaidOut } from "@/edit/build";
import { dropEdit } from "@/edit/drag";
import { memberOf } from "@/edit/resize";
import { layoutGraph } from "@/layout/elk";
import { setMeasurer, TableMeasurer } from "@/layout/measure";
import { sizeGraph, sizeLabels } from "@/layout/size";
import type { Placed } from "@/layout/types";
import theme from "../themes/paper/theme.json";
import type { Theme } from "@/theme/contract";

/**
 * The writers that move or scale a fixed drawing, against a frame that is more than its boxes.
 *
 * A sketch's frame holds a back edge's bow and its label too, so the boxes no longer start
 * at the frame's corner or end at its far edge. Three writers assume a frame that is
 * the boxes and nothing else, and every one of them is wrong by the bow's margin: a drag or a `+`
 * moved the fence as though the boxes' corner were the frame's, so everything else in the drawing
 * slid by the margin; a resize counted the margin in the extent it scaled, so the frame landed short
 * of the pointer; and a group resize took the padding round the frame to be the padding round the
 * boxes. Each case here lays the drawing out for real, makes the edit, lays it out again, and asks
 * where things are on the board.
 */

const T = theme as unknown as Theme;
beforeAll(() => setMeasurer(new TableMeasurer()));

const ROW =
  'box a "1" x=0 y=0 w=80 h=56\nbox b "2" x=120 y=0 w=80 h=56\nbox c "3" x=240 y=0 w=80 h=56\n' +
  'box d "4" x=360 y=0 w=80 h=56\na --> b\nb --> c\nc --> d\nd --> b "back to 2"';

const parse = (body: string): Graph => parseDiagram("sketch", body, undefined, undefined, undefined)!;

async function lay(body: string): Promise<{ graph: Graph; placed: Placed; laid: LaidOut }> {
  const graph = parse(body);
  const placed = await layoutGraph(graph, sizeGraph(graph, T), sizeLabels(graph, T), T.metric);
  const groups: LaidOut["groups"] = {};
  for (const g of placed.groups) groups[g.id] = { x: g.x, y: g.y, w: g.w, h: g.h };
  /* What `data-dag-layout` publishes, field for field. */
  return { graph, placed, laid: { nodes: placed.nodes, groups, origin: placed.origin, size: placed.size } };
}

describe("a fixed drawing whose frame is more than its boxes", () => {
  it("starts with the bow above the row, which is what every case below stands on", async () => {
    const { laid } = await lay(ROW);
    expect(cornerOf(laid).y).toBeGreaterThan(0);
    expect(laid.size!.h).toBeGreaterThan(boxesOf(laid)!.y + boxesOf(laid)!.h - 1);
  });

  it("a drag above the bow moves the fence by how far the box passed it, and nothing else slides", async () => {
    const before = await lay(ROW);
    const edit = dropEdit({
      type: "sketch",
      body: ROW,
      node: "a",
      over: { what: "frame", id: "x" },
      half: { x: 0.5, y: 0.5 },
      laid: before.laid,
      by: { x: 0, y: -104 },
      grid: 8,
    })!;
    const after = await lay(edit.body);
    /* On the board a box is the fence plus its layout position; the fence moves by `shift`. */
    for (const id of ["b", "c", "d"]) {
      expect(after.placed.nodes[id]!.y + edit.shift.y, id).toBe(before.placed.nodes[id]!.y);
      expect(after.placed.nodes[id]!.x + edit.shift.x, id).toBe(before.placed.nodes[id]!.x);
    }
    /* And the dragged one lands where the pointer let it go. */
    expect(after.placed.nodes.a!.y + edit.shift.y).toBe(before.placed.nodes.a!.y - 104);
  });

  it("a drag that stays under the bow does not move the fence", async () => {
    const before = await lay(ROW);
    const edit = dropEdit({
      type: "sketch",
      body: ROW,
      node: "c",
      over: { what: "frame", id: "x" },
      half: { x: 0.5, y: 0.5 },
      laid: before.laid,
      by: { x: 0, y: 16 },
      grid: 8,
    })!;
    expect(edit.shift).toEqual({ x: 0, y: 0 });
  });

  it("a + grown north past the bow moves the fence by how far the new box passed it", async () => {
    const before = await lay(ROW);
    const spot = clearSpot(before.laid, "c", "n", 32)!;
    const at = fileAt(before.laid, spot, undefined);
    const made = grow("sketch", ROW, undefined, "c", { side: "n", edge: false, at })!;
    const was = cornerOf(before.laid);
    const shift = frameShift(was, { x: Math.min(was.x, spot.x), y: Math.min(was.y, spot.y) });
    const after = await lay(made.body);
    for (const id of ["a", "b", "c", "d"]) expect(after.placed.nodes[id]!.y + shift.y, id).toBe(before.placed.nodes[id]!.y);
    expect(after.placed.nodes[made.id]!.y + shift.y).toBe(spot.y);
  });

  it("a resize scales the boxes by the pointer's travel, and the frame lands on the pointer", async () => {
    const before = await lay(ROW);
    const content = boxesOf(before.laid)!;
    const pull = 56;
    const sy = (content.h + pull) / content.h;
    const after = await lay(scaleFixed(before.graph, before.laid, ROW, 1, sy, 8));
    /* Within a grid step: the bow is routed again round the taller boxes and rises a little with
       them, which nothing before the next layout can know. Counting the bow's margin in the extent,
       as the writer did, left the frame 15px short of a 56px pull. */
    expect(Math.abs(after.placed.size.h - (before.placed.size.h + pull))).toBeLessThanOrEqual(8);
  });

  it("a group resize reads the padding round the frame, and the boxes sit in from it", async () => {
    const body = 'box a "A" x=0 y=0 w=80 h=56\nbox b "B" x=0 y=160 w=80 h=56\na --> b "a fairly long label here"';
    const { laid, placed } = await lay(body);
    /* The label hangs past the boxes on the right, so the frame is wider than they are. */
    expect(placed.size.w).toBeGreaterThan(80);
    const board = parseBoard("g", "```sketch {#s x=1000 y=1000}\n" + body + "\n```\n");
    const pad = T.metric.frame.barePad;
    const from = { x: 1000, y: 1000, w: placed.size.w + 2 * pad, h: placed.size.h + 2 * pad };
    const m = memberOf(board.items[0]!, from, laid);
    expect(m.follows).toBe("drawing");
    expect(m.inner).toEqual({ left: pad + placed.nodes.a!.x, top: pad + placed.nodes.a!.y, w: 80, h: 216 });
  });
});

describe("frameShift", () => {
  it("follows the boxes when they are the frame's corner", () => {
    expect(frameShift({ x: 0, y: 0 }, { x: 40, y: -24 })).toEqual({ x: 40, y: -24 });
  });

  it("stays with a line that is the corner until a box goes past it", () => {
    expect(frameShift({ x: 0, y: 40 }, { x: 0, y: 16 })).toEqual({ x: 0, y: 0 });
    expect(frameShift({ x: 0, y: 40 }, { x: 0, y: -64 })).toEqual({ x: 0, y: -64 });
  });
});
