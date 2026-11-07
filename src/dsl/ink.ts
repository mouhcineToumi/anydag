/**
 * The arithmetic over a freehand stroke's points.
 *
 * An `ink` node's whole content is a list of coordinates, and two different layers need to say
 * things about that list. The *file* says it — `pts="0,0 14,9 …"` is text the parser reads and the
 * serialiser writes, and the grammar layer owns text. The *gesture* says it too: the pen releases
 * a run of pointer samples that must be reduced, bounded and shifted before they can become a
 * statement, and `src/edit/` already imports from `src/dsl/` (the span writers) but nothing in
 * `src/edit/` imports `@/layout` anywhere today. So the point-list arithmetic lives beside the
 * grammar rather than beside the drawing, and `src/layout/ink.ts` — the one place that turns
 * points into a path — imports it.
 *
 * Everything here is pure numbers. No SVG, no `d` string, no colour: the layer contract is that
 * `src/dsl/` may not know pixels, and the drawing of a stroke is a render concern whose arithmetic
 * (the Catmull-Rom conversion) sits in `src/layout/`, where `check-literals.mjs` exempts it the
 * same way it exempts `shapes.ts`.
 *
 * **Points are in the node's own coordinate space and are normalised to a minimum of 0,0.** The
 * node's `x=`/`y=` carry the position, which is what makes moving a stroke a two-number edit
 * rather than a rewrite of every point in it — the same argument as a group's children being
 * relative to their group's origin. `normalise()` is the function that enforces it, and the
 * pen gesture calls it on release so the file never holds a stroke that starts elsewhere.
 */

export interface InkPoint {
  x: number;
  y: number;
}

/**
 * `"0,0 14,9 31,5"` → points. `undefined` when the list is malformed — a pair without a comma, a
 * coordinate that is not a whole number, or nothing at all. The caller decides what malformed
 * means (`modifiers()` reports it; the pen gesture would never produce one), so this does not
 * diagnose. Whole numbers are the grammar, not a preference: `formatPoints` rounds, and a
 * fractional point accepted here would come back from the next write silently changed.
 */
export function parsePoints(s: string): InkPoint[] | undefined {
  if (!s.trim()) return undefined;
  const out: InkPoint[] = [];
  for (const pair of s.trim().split(/\s+/)) {
    const comma = pair.indexOf(",");
    if (comma <= 0 || comma === pair.length - 1) return undefined;
    const x = Number(pair.slice(0, comma));
    const y = Number(pair.slice(comma + 1));
    if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
    out.push({ x, y });
  }
  return out.length > 0 ? out : undefined;
}

/** The inverse of `parsePoints`: whole numbers, one space between pairs — what the file holds. */
export function formatPoints(pts: InkPoint[]): string {
  return pts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ");
}

/** Squared distance from `p` to the segment `a–b`. */
function segDist2(p: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const ex = a.x + t * dx - p.x;
  const ey = a.y + t * dy - p.y;
  return ex * ex + ey * ey;
}

/**
 * Ramer–Douglas–Peucker: keep the shape, drop the samples the shape does not need.
 *
 * The pen samples a pointer sixty times a second, and most of those points say nothing a straight
 * run between their neighbours does not. The stored form is the *reduced* polyline (decision 2) —
 * the file holds points, the smoothing is the renderer's — so this runs before anything is written,
 * and the first and last points always survive: a stroke that lost its ends is a different stroke.
 */
export function simplifyPoints(pts: InkPoint[], epsilon: number): InkPoint[] {
  if (pts.length <= 2) return [...pts];
  const eps2 = epsilon * epsilon;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;

  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let maxD2 = 0;
    let split = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d2 = segDist2(pts[i]!, pts[lo]!, pts[hi]!);
      if (d2 > maxD2) {
        maxD2 = d2;
        split = i;
      }
    }
    if (split < 0) continue;
    if (maxD2 > eps2) {
      keep[split] = true;
      stack.push([lo, split], [split, hi]);
    }
  }

  return pts.filter((_, i) => keep[i]);
}

/** The axis-aligned box the points fill, with the minimum as the origin. */
export function boundsOf(pts: InkPoint[]): { x: number; y: number; w: number; h: number } {
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = pts[0]!.x;
  let minY = pts[0]!.y;
  let maxX = minX;
  let maxY = minY;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Shift the list so its minimum is `0,0`, reporting how far it moved.
 *
 * The node's `x=`/`y=` then carry the position the list used to, which is the whole point of the
 * data shape: a drag rewrites two numbers and never the path.
 */
export function normalise(pts: InkPoint[]): { pts: InkPoint[]; dx: number; dy: number } {
  if (pts.length === 0) return { pts: [], dx: 0, dy: 0 };
  const b = boundsOf(pts);
  if (b.x === 0 && b.y === 0) return { pts, dx: 0, dy: 0 };
  return { pts: pts.map((p) => ({ x: p.x - b.x, y: p.y - b.y })), dx: b.x, dy: b.y };
}
