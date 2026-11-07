import { boundsOf, type InkPoint } from "@/dsl/ink";

/**
 * The stroke's path: points in, one SVG `d` out.
 *
 * The mirror of `shapes.ts`'s argument, from the other side. The *file* holds a simplified
 * polyline (the facts of where the pen went); the *drawing* is a Catmull-Rom curve through it (a
 * rendering decision). Keeping the smoothing out of the file means retuning it later changes no
 * byte a board carries, and keeping it out of `src/dsl/` means the grammar never learns what a
 * bezier is. Arithmetic here is exempt from `check-literals.mjs` the same way `shapes.ts` is —
 * a tension constant is a geometric relationship, not a style value.
 *
 * The path is scaled from the points' own bounds into the box the layout hands over. A stroke
 * stores its points normalised to a minimum of `0,0` with the position on the node's `x=`/`y=`,
 * so the box is the whole truth: `w=`/`h=` are normally absent and come from the bounds, and a
 * resize or `scaleFixed` writes them — whereupon the path fills the new box, exactly as a shape's
 * outline fills the box it is recomputed from.
 */

/** A one-point stroke is a dot, and this is its radius in the box's pixels. */
const DOT_R = 2;

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The points, scaled from their bounds into `w × h`.
 *
 * A perfectly flat stroke is the *common* case — a line ruled across the page — and its bound has
 * a zero extent on one axis, so dividing by it is how a NaN gets into a path. That is not a
 * cosmetic defect: a NaN in a `d` makes the browser draw nothing and log an error naming no edge.
 * A degenerate axis has nothing to scale, so it is centred in the box instead.
 */
function scaleInto(pts: InkPoint[], w: number, h: number): InkPoint[] {
  const b = boundsOf(pts);
  return pts.map((p) => ({
    x: b.w > 0 ? ((p.x - b.x) / b.w) * w : w / 2,
    y: b.h > 0 ? ((p.y - b.y) / b.h) * h : h / 2,
  }));
}

/**
 * The Catmull-Rom spline through `pts`, as cubic beziers, filling the given box.
 *
 * Catmull-Rom is chosen over a plain polyline because a stroke drawn with a pen is not corners,
 * and over a fitting algorithm because it passes *through* every point the author left — nothing
 * between the stored points and the drawn curve to disagree about. The `1/6` tension is the
 * standard uniform Catmull-Rom: each segment's control points come from its neighbours, and the
 * two ends duplicate their inner neighbour so the curve neither overshoots nor leaves the line.
 */
export function inkPath(pts: InkPoint[], w: number, h: number): string {
  if (pts.length === 0) return "";
  const scaled = scaleInto(pts, w, h);

  /* One point: a dot — an `M` and nothing else draws nothing, whatever the line cap says. */
  if (scaled.length === 1) {
    const p = scaled[0]!;
    return `M${r1(p.x - DOT_R)} ${r1(p.y)} a${DOT_R} ${DOT_R} 0 1 0 ${DOT_R * 2} 0 a${DOT_R} ${DOT_R} 0 1 0 ${-DOT_R * 2} 0`;
  }

  const first = scaled[0]!;
  const last = scaled[scaled.length - 1]!;

  /* Two points: a line. The spline below handles it, but its control points would add a wiggle
     the pen never drew, and a ruled line is the one stroke whose shape nobody wants improved. */
  if (scaled.length === 2) return `M${r1(first.x)} ${r1(first.y)} L${r1(last.x)} ${r1(last.y)}`;

  let d = `M${r1(first.x)} ${r1(first.y)}`;
  for (let i = 0; i < scaled.length - 1; i++) {
    const p0 = scaled[Math.max(i - 1, 0)]!;
    const p1 = scaled[i]!;
    const p2 = scaled[i + 1]!;
    const p3 = scaled[Math.min(i + 2, scaled.length - 1)]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${r1(c1x)} ${r1(c1y)}, ${r1(c2x)} ${r1(c2y)}, ${r1(p2.x)} ${r1(p2.y)}`;
  }
  return d;
}
