import { SHAPE_KINDS, type ShapeKind } from "@/dsl/ir";

import type { Box } from "./types";

export type { ShapeKind };

/**
 * The geometric shapes: one outline, read by two readers.
 *
 * A shape is drawn by `render/nodes/Sketch.tsx` and met by an edge in `route.ts`, and if those two
 * disagree about where a triangle's slanted side is, an arrow stops a quarter of the box short of
 * it or runs through it. So both read this file: `outlineOf` is the path the renderer strokes and
 * the hull the router casts a ray at, from the same arithmetic.
 *
 * Everything is in the shape's own pixels, from its box. A 0–100 `viewBox` stretched with
 * `preserveAspectRatio="none"` would have been shorter, and it bends arcs into eggs and strokes into
 * calligraphy the moment a circle is pulled wide. Arithmetic in `src/layout/` is exempt from
 * `check-literals.mjs` by design — a number that decides how a shape is *computed* belongs to the
 * code — and none of these is a colour or a style.
 */

const SET = new Set<string>(SHAPE_KINDS);
export const isShape = (kind: string | undefined): kind is ShapeKind => kind !== undefined && SET.has(kind);

/**
 * The shapes whose natural box is square. Everything else defaults wider than tall — a
 * parallelogram, a cylinder and a speech bubble all hold a line of text across.
 */
export const SQUARE_SHAPES = new Set<ShapeKind>(["circle", "triangle", "pentagon", "octagon", "star"]);

export interface Point {
  x: number;
  y: number;
}

interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface Outline {
  /** The filled and stroked outline. */
  d: string;
  /** Lines drawn on top and never filled — a cylinder's front rim. */
  detail?: string;
  /**
   * What an edge meets, in the same coordinates. Where the outline is curves the router has no use
   * for — a cloud's bumps, a document's wave — this is the shape it *reads as*: an ellipse, the body
   * rectangle. A line stopping on the idea of a cloud is right; one threading between two bumps is not.
   */
  hull: Point[] | Ellipse;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const poly = (pts: Point[]) => `M${pts.map((p) => `${r1(p.x)} ${r1(p.y)}`).join(" L")} Z`;
const box = (w: number, h: number): Point[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

/** Points around an ellipse, clockwise from `a0` to `a1` (radians, screen-space: +y is down). */
function arc(e: Ellipse, a0: number, a1: number, n: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ x: e.cx + e.rx * Math.cos(a), y: e.cy + e.ry * Math.sin(a) });
  }
  return out;
}

export function outlineOf(kind: ShapeKind, w: number, h: number): Outline {
  switch (kind) {
    case "circle":
    case "ellipse": {
      const e = { cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 };
      return {
        d: `M0 ${r1(h / 2)} A${r1(e.rx)} ${r1(e.ry)} 0 1 0 ${r1(w)} ${r1(h / 2)} A${r1(e.rx)} ${r1(e.ry)} 0 1 0 0 ${r1(h / 2)} Z`,
        hull: e,
      };
    }
    case "triangle":
      return polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]);
    case "diamond":
      return polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ]);
    case "hexagon": {
      /* Pointed left and right, which is the flowchart "preparation" shape and the one that reads
         as a hexagon at a width that holds text. The cut is capped so a tall one stays a hexagon. */
      const k = Math.min(w / 4, h / 2);
      return polygon([
        { x: k, y: 0 },
        { x: w - k, y: 0 },
        { x: w, y: h / 2 },
        { x: w - k, y: h },
        { x: k, y: h },
        { x: 0, y: h / 2 },
      ]);
    }
    case "pentagon":
      return polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h * 0.38 },
        { x: w * 0.81, y: h },
        { x: w * 0.19, y: h },
        { x: 0, y: h * 0.38 },
      ]);
    case "octagon": {
      const c = Math.min(w, h) * 0.29;
      return polygon([
        { x: c, y: 0 },
        { x: w - c, y: 0 },
        { x: w, y: c },
        { x: w, y: h - c },
        { x: w - c, y: h },
        { x: c, y: h },
        { x: 0, y: h - c },
        { x: 0, y: c },
      ]);
    }
    case "star": {
      /* Five points, the top one on the box's top edge and the two feet on its bottom — which puts
         the centre below the middle, because a star is not as tall below its centre as above. */
      const top = 1;
      const foot = Math.cos(Math.PI / 5);
      const ry = h / (top + foot);
      const rx = w / 2 / Math.sin((2 * Math.PI) / 5);
      const cx = w / 2;
      const cy = ry;
      const inner = 0.45;
      const pts: Point[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 === 0 ? 1 : inner;
        pts.push({ x: cx + rx * k * Math.cos(a), y: cy + ry * k * Math.sin(a) });
      }
      return polygon(pts);
    }
    case "parallelogram": {
      const s = Math.min(w / 4, h * 0.4);
      return polygon([
        { x: s, y: 0 },
        { x: w, y: 0 },
        { x: w - s, y: h },
        { x: 0, y: h },
      ]);
    }
    case "trapezoid": {
      const s = Math.min(w / 4, h * 0.4);
      return polygon([
        { x: s, y: 0 },
        { x: w - s, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]);
    }
    case "arrow": {
      /* A block arrow pointing right: a shaft half the height, a head as long as it can be without
         swallowing the shaft. Direction is a hue's job no more than it is this one's — turn it by
         drawing an edge, or by the order of things around it. */
      const head = Math.min(w * 0.4, h * 0.6);
      return polygon([
        { x: 0, y: h * 0.25 },
        { x: w - head, y: h * 0.25 },
        { x: w - head, y: 0 },
        { x: w, y: h / 2 },
        { x: w - head, y: h },
        { x: w - head, y: h * 0.75 },
        { x: 0, y: h * 0.75 },
      ]);
    }
    case "cylinder": {
      /* A body with an elliptical cap top and bottom, and the cap's front rim drawn over it — the
         one line that makes a rectangle with round ends read as a drum. */
      const ry = Math.min(h * 0.12, w * 0.25);
      const rx = w / 2;
      return {
        d:
          `M0 ${r1(ry)} A${r1(rx)} ${r1(ry)} 0 0 1 ${r1(w)} ${r1(ry)} L${r1(w)} ${r1(h - ry)} ` +
          `A${r1(rx)} ${r1(ry)} 0 0 1 0 ${r1(h - ry)} Z`,
        detail: `M0 ${r1(ry)} A${r1(rx)} ${r1(ry)} 0 0 0 ${r1(w)} ${r1(ry)}`,
        hull: box(w, h),
      };
    }
    case "document": {
      const a = h * 0.08;
      return {
        d:
          `M0 0 L${r1(w)} 0 L${r1(w)} ${r1(h - a)} ` +
          `Q${r1(w * 0.75)} ${r1(h - 3 * a)} ${r1(w / 2)} ${r1(h - a)} T0 ${r1(h - a)} Z`,
        hull: box(w, h),
      };
    }
    case "stadium": {
      const r = Math.min(h / 2, w / 2);
      const left = arc({ cx: r, cy: h / 2, rx: r, ry: h / 2 }, Math.PI / 2, (3 * Math.PI) / 2, 8);
      const right = arc({ cx: w - r, cy: h / 2, rx: r, ry: h / 2 }, -Math.PI / 2, Math.PI / 2, 8);
      return {
        d: `M${r1(r)} 0 L${r1(w - r)} 0 A${r1(r)} ${r1(h / 2)} 0 0 1 ${r1(w - r)} ${r1(h)} L${r1(r)} ${r1(h)} A${r1(r)} ${r1(h / 2)} 0 0 1 ${r1(r)} 0 Z`,
        hull: [...right, ...left],
      };
    }
    case "cloud": {
      /* Bumps on an ellipse, each an arc bulging outward between two neighbours. The base ellipse is
         drawn in from the box by how far a bump stands proud of it, so the cloud fills its box. */
      const n = 9;
      const base = { cx: w / 2, cy: h / 2, rx: (w / 2) * 0.8, ry: (h / 2) * 0.72 };
      const pts = arc(base, -Math.PI / 2, (3 * Math.PI) / 2, n).slice(0, n);
      let d = `M${r1(pts[0]!.x)} ${r1(pts[0]!.y)}`;
      for (let i = 0; i < n; i++) {
        const p = pts[i]!;
        const q = pts[(i + 1) % n]!;
        /* A radius 0.62 of the chord stands each bump a quarter of the chord proud of it. */
        const r = Math.hypot(q.x - p.x, q.y - p.y) * 0.62;
        d += ` A${r1(r)} ${r1(r)} 0 0 1 ${r1(q.x)} ${r1(q.y)}`;
      }
      return { d: `${d} Z`, hull: { cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 } };
    }
    case "callout": {
      /* A rounded bubble over the top four-fifths, with a tail down to the bottom edge on the left. */
      const bh = h * 0.8;
      const r = Math.min(w, bh) * 0.12;
      return {
        d:
          `M${r1(r)} 0 L${r1(w - r)} 0 Q${r1(w)} 0 ${r1(w)} ${r1(r)} L${r1(w)} ${r1(bh - r)} ` +
          `Q${r1(w)} ${r1(bh)} ${r1(w - r)} ${r1(bh)} L${r1(w * 0.36)} ${r1(bh)} L${r1(w * 0.18)} ${r1(h)} ` +
          `L${r1(w * 0.22)} ${r1(bh)} L${r1(r)} ${r1(bh)} Q0 ${r1(bh)} 0 ${r1(bh - r)} L0 ${r1(r)} Q0 0 ${r1(r)} 0 Z`,
        hull: box(w, bh),
      };
    }
  }
}

function polygon(pts: Point[]): Outline {
  return { d: poly(pts), hull: pts };
}

/**
 * Where a shape's words go: the largest comfortable rectangle inside the outline.
 *
 * Not the box. A triangle's text centred in its box sits on the slanted sides, and a callout's
 * centred in its box sits half in the tail. These are proportions of the box rather than pixels,
 * so a shape pulled to any size keeps its text where the shape can hold it.
 */
export function textBoxOf(kind: ShapeKind, w: number, h: number): Box {
  const at = (x: number, y: number, bw: number, bh: number): Box => ({ x: w * x, y: h * y, w: w * bw, h: h * bh });
  switch (kind) {
    case "circle":
    case "ellipse":
    case "cloud":
      return at(0.15, 0.15, 0.7, 0.7);
    case "triangle":
      return at(0.25, 0.45, 0.5, 0.5);
    case "diamond":
      return at(0.22, 0.25, 0.56, 0.5);
    case "hexagon":
      return at(0.18, 0.08, 0.64, 0.84);
    case "pentagon":
      return at(0.2, 0.3, 0.6, 0.62);
    case "octagon":
      return at(0.12, 0.12, 0.76, 0.76);
    case "star":
      return at(0.3, 0.38, 0.4, 0.34);
    case "parallelogram":
    case "trapezoid":
      return at(0.2, 0.08, 0.6, 0.84);
    case "arrow":
      return at(0.06, 0.27, 0.6, 0.46);
    case "cylinder":
      return at(0.08, 0.26, 0.84, 0.64);
    case "document":
      return at(0.08, 0.06, 0.84, 0.78);
    case "stadium":
      return at(0.14, 0.08, 0.72, 0.84);
    case "callout":
      return at(0.08, 0.06, 0.84, 0.68);
  }
}

export type Side = "top" | "right" | "bottom" | "left";

/** Pointing into the box from each side. */
const INWARD: Record<Side, Point> = {
  top: { x: 0, y: 1 },
  right: { x: -1, y: 0 },
  bottom: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
};

/**
 * Move an anchor from the box's side inward until it meets the shape.
 *
 * `route.ts` places every anchor on a side of a rectangle, which is exactly right for a card and a
 * quarter of the box wrong for a triangle's side. The anchor keeps its position *along* the side —
 * so a fan of three edges into one side stays a fan — and only its depth changes, along the side's
 * inward normal, to the first place the outline is. A ray that meets nothing (an anchor fanned past
 * where a shape reaches) keeps the point it was given, which is the rectangle's answer and no worse
 * than before.
 */
export function onOutline(kind: ShapeKind, b: Box, side: Side, p: Point): Point {
  const { hull } = outlineOf(kind, b.w, b.h);
  const o = { x: p.x - b.x, y: p.y - b.y };
  const d = INWARD[side];
  const t = Array.isArray(hull) ? rayPolygon(o, d, hull) : rayEllipse(o, d, hull);
  if (t === null) return p;
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}

/**
 * The same cast at a polygon handed in rather than one of the sixteen outlines — the hull a node
 * carries of its own (`RouteNode.hull`), which is how a `figure` is met on its picture and its
 * caption rather than on the box around both. In the box's own coordinates, like
 * `outlineOf`'s; a ray that misses keeps the box's point, as it does there.
 */
export function onHull(hull: Point[], b: Box, side: Side, p: Point): Point {
  const o = { x: p.x - b.x, y: p.y - b.y };
  const d = INWARD[side];
  const t = rayPolygon(o, d, hull);
  if (t === null) return p;
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}

/** The smallest `t ≥ 0` at which `o + t·d` crosses an edge of the polygon, or `null`. */
function rayPolygon(o: Point, d: Point, pts: Point[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
    const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
    if (t < -1e-6 || u < -1e-6 || u > 1 + 1e-6) continue;
    if (best === null || t < best) best = Math.max(0, t);
  }
  return best;
}

/** The same for an ellipse. The ray is axis-aligned, so this is one square root. */
function rayEllipse(o: Point, d: Point, e: Ellipse): number | null {
  if (d.x !== 0) {
    const dy = (o.y - e.cy) / e.ry;
    if (Math.abs(dy) > 1) return null;
    const half = e.rx * Math.sqrt(1 - dy * dy);
    const x = d.x > 0 ? e.cx - half : e.cx + half;
    return Math.max(0, (x - o.x) * d.x);
  }
  const dx = (o.x - e.cx) / e.rx;
  if (Math.abs(dx) > 1) return null;
  const half = e.ry * Math.sqrt(1 - dx * dx);
  const y = d.y > 0 ? e.cy - half : e.cy + half;
  return Math.max(0, (y - o.y) * d.y);
}
