/**
 * Enough geometry to ask questions about a drawn edge.
 *
 * `RoutedEdge` keeps only an SVG path string. That is the right thing for the renderer — the `d`
 * attribute is exactly what the browser wants — but it means anything that wants to *measure* a
 * route has to read the string back. Nothing in `src/layout/` does: there is no segment
 * intersection, no bezier evaluation, no bend counter anywhere in the codebase. So this is written
 * from scratch rather than lifted.
 *
 * It lived under `test/` while the only thing that measured a route was a frozen test over the
 * reference boards. `src/quality/` is a layer rather than a helper because the page scores the
 * board it is showing — a board nobody has written an expectation for — and two copies of a
 * scorer would drift the way two copies of a cheat sheet would. Scoring is still not a thing the
 * layout does: this reads a `Placed`, and nothing in `src/layout/` imports it.
 *
 * The path grammar the router emits is small and closed: absolute `M`, `L`, `C` and `Q` only, every
 * coordinate rounded to 0.1. See `pathOf` and `roundedPolyline` in `src/layout/route.ts`.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  a: Point;
  b: Point;
}

/** How finely a curve is broken into straight segments before anything is measured. */
const FLATTEN = 16;

/**
 * Break a path into straight segments.
 *
 * Flattening rather than solving analytically: a cubic-versus-cubic intersection is a ninth-degree
 * polynomial, and at 16 segments per curve the error is far below the 0.1px the coordinates are
 * rounded to anyway. Every question below is asked of the segments.
 */
export function flatten(d: string, steps = FLATTEN): Segment[] {
  const out: Segment[] = [];
  let cur: Point = { x: 0, y: 0 };
  let started: Point | null = null;

  for (const m of d.matchAll(/([MLCQ])([^MLCQ]*)/g)) {
    const cmd = m[1]!;
    const n = (m[2] ?? "")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);

    if (cmd === "M") {
      cur = { x: n[0]!, y: n[1]! };
      started = cur;
    } else if (cmd === "L") {
      const next = { x: n[0]!, y: n[1]! };
      out.push({ a: cur, b: next });
      cur = next;
    } else if (cmd === "C") {
      const p1 = { x: n[0]!, y: n[1]! };
      const p2 = { x: n[2]!, y: n[3]! };
      const p3 = { x: n[4]!, y: n[5]! };
      let prev = cur;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        const at = {
          x: u * u * u * cur.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
          y: u * u * u * cur.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        };
        out.push({ a: prev, b: at });
        prev = at;
      }
      cur = p3;
    } else if (cmd === "Q") {
      const p1 = { x: n[0]!, y: n[1]! };
      const p2 = { x: n[2]!, y: n[3]! };
      let prev = cur;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        const at = {
          x: u * u * cur.x + 2 * u * t * p1.x + t * t * p2.x,
          y: u * u * cur.y + 2 * u * t * p1.y + t * t * p2.y,
        };
        out.push({ a: prev, b: at });
        prev = at;
      }
      cur = p2;
    }
  }

  if (started === null) throw new Error(`path does not start with a move: ${d.slice(0, 40)}`);
  return out;
}

/** Where two segments cross, or null. Touching at an endpoint does not count as crossing. */
function crosses(p: Segment, q: Segment): boolean {
  const r = { x: p.b.x - p.a.x, y: p.b.y - p.a.y };
  const s = { x: q.b.x - q.a.x, y: q.b.y - q.a.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return false;
  const t = ((q.a.x - p.a.x) * s.y - (q.a.y - p.a.y) * s.x) / denom;
  const u = ((q.a.x - p.a.x) * r.y - (q.a.y - p.a.y) * r.x) / denom;
  const inside = (v: number) => v > 1e-6 && v < 1 - 1e-6;
  return inside(t) && inside(u);
}

/** How many times two flattened paths cross each other. */
export function crossingCount(a: Segment[], b: Segment[]): number {
  let n = 0;
  for (const p of a) for (const q of b) if (crosses(p, q)) n++;
  return n;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Whether a point is strictly inside a rectangle, shrunk by `inset` on every side. */
function inside(p: Point, r: Rect, inset = 0): boolean {
  return p.x > r.x + inset && p.x < r.x + r.w - inset && p.y > r.y + inset && p.y < r.y + r.h - inset;
}

/**
 * Whether a segment touches a rectangle, shrunk by `inset` on every side.
 *
 * Asking whether the *ends* of a segment land inside a box is not the same question, and the
 * difference is the whole defect class this exists for. A curve is flattened into sixteen pieces,
 * so sampling its joints happens to work; a polyline's straight run is one segment three hundred
 * pixels long, and a card sitting in the middle of it touches neither end. That route passes
 * clean through a card and scored zero.
 */
export function meetsRect(s: Segment, r: Rect, inset = 0): boolean {
  if (inside(s.a, r, inset) || inside(s.b, r, inset)) return true;
  const x0 = r.x + inset;
  const y0 = r.y + inset;
  const x1 = r.x + r.w - inset;
  const y1 = r.y + r.h - inset;
  const corners: Point[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  for (let i = 0; i < corners.length; i++) {
    if (crosses(s, { a: corners[i]!, b: corners[(i + 1) % corners.length]! })) return true;
  }
  return false;
}

/** Shortest distance from a point to a flattened path. */
export function distanceTo(p: Point, path: Segment[]): number {
  let best = Infinity;
  for (const { a, b } of path) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** Axis-aligned overlap, corner-based — the same test `test/layout.test.ts` uses on node boxes. */
export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
