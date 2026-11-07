import { entriesOf } from "@/dsl/graph/timeline";
import type { Graph } from "@/dsl/ir";
import type { ThemeMetric } from "@/theme/contract";

import type { AxisTick, Placed, SizedNode } from "./types";

/** Everything the board draws lands on the same 8px grid, however its position was arrived at. */
const snap = (v: number, grid: number) => Math.round(v / grid) * grid;

/**
 * Timeline placement: x is real time, y is whatever keeps entries from overlapping.
 *
 * The x scale is linear in days rather than one column per entry, because that is the only version
 * that tells the truth — three things in one week and one thing a year later should not look evenly
 * spaced. Rows are then a packing problem: an entry drops to the first row where it does not
 * collide with what is already there.
 */
const DAY = 86_400_000;

export function layoutTimeline(graph: Graph, sizes: Record<string, SizedNode>, metric: ThemeMetric): Placed {
  const entries = entriesOf(graph);
  const nodes: Placed["nodes"] = {};
  const rows: Placed["rows"] = {};

  if (entries.length === 0) {
    return { kind: "graph", size: { w: 1, h: 1 }, nodes, rows, groups: [], lanes: [], edges: [] };
  }

  const sizeOf = (id: string) => sizes[id] ?? { w: metric.node.stepW, h: metric.node.stepH, rowY: [] };

  const min = Math.min(...entries.map((e) => e.start));
  const max = Math.max(...entries.map((e) => e.end ?? e.start));
  const span = Math.max(DAY * 30, max - min);

  /* Wide enough that the narrowest gap between two entries still separates their cards. */
  const widest = Math.max(...entries.map((e) => sizeOf(e.id).w));
  const width = Math.max(900, Math.round((span / DAY) * 3.2) + widest);
  const scale = (t: number) => ((t - min) / span) * (width - widest);

  const gap = metric.lane.padY;
  const rowTop: number[] = [];
  const rowEnd: number[] = [];

  for (const e of entries) {
    const size = sizeOf(e.id);
    const x = snap(scale(e.start), metric.grid);
    const w = e.end !== null ? Math.max(size.w, snap(scale(e.end) - x, metric.grid) + size.w) : size.w;

    /* First row this entry fits in. Entries are in file order, so a reader can follow the source
       down the page even when the packing moves things up. */
    let row = 0;
    while (row < rowEnd.length && (rowEnd[row] ?? 0) + gap > x) row++;
    if (row === rowEnd.length) {
      rowTop.push(rowEnd.length === 0 ? 0 : snap((rowTop[row - 1] ?? 0) + size.h + gap, metric.grid));
      rowEnd.push(0);
    }
    rowEnd[row] = x + w;

    nodes[e.id] = { x, y: rowTop[row]!, w, h: size.h };
    rows[e.id] = {};
  }

  const bottom = Math.max(...Object.values(nodes).map((b) => b.y + b.h));
  const axisY = bottom + metric.lane.padY;

  /* One tick per month while that stays readable, then per quarter, then per year. */
  const months = span / (DAY * 30.44);
  const step = months <= 18 ? 1 : months <= 60 ? 3 : 12;
  const ticks: AxisTick[] = [];
  const first = new Date(min);
  const cursor = new Date(Date.UTC(first.getUTCFullYear(), Math.floor(first.getUTCMonth() / step) * step, 1));
  while (cursor.getTime() <= max) {
    const t = cursor.getTime();
    if (t >= min - DAY * 31) {
      const january = cursor.getUTCMonth() === 0;
      ticks.push({
        x: Math.round(scale(t)),
        label:
          january || step === 12
            ? String(cursor.getUTCFullYear())
            : cursor.toLocaleString("en", { month: "short", timeZone: "UTC" }),
        major: january || step === 12,
      });
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + step);
  }

  /* A section is a stretch of time, so it is drawn as a bar over the stretch it covers rather than
     a box around the cards. Full-height bands merged into one tint and stacked their labels. */
  const STRIP = 30;
  const groups: Placed["groups"] = [];
  for (const g of graph.groups) {
    const own = entries.filter((e) => e.section === g.id).map((e) => nodes[e.id]!);
    if (own.length === 0) continue;
    const x0 = Math.min(...own.map((b) => b.x));
    const x1 = Math.max(...own.map((b) => b.x + b.w));
    groups.push({ id: g.id, x: x0, y: -(STRIP + 16), w: x1 - x0, h: STRIP, level: 0, strip: true });
  }

  return {
    kind: "graph",
    /* The strips sit above y=0; the frame's body starts there, so the diagram declares the room. */
    size: { w: Math.ceil(width), h: Math.ceil(axisY + 28) },
    nodes,
    rows,
    groups,
    lanes: [],
    edges: [],
    /* `scale` is the same three numbers `scale()` closes over, published so a drag can invert it.
       See `AxisScale`: an entry dragged sideways is asking for a date, and the date is whatever
       this mapping says the pointer landed on. */
    axis: { y: axisY, ticks, scale: { min, span, px: width - widest } },
  };
}
