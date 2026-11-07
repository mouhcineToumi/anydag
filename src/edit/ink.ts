import { formatPoints, normalise, simplifyPoints, type InkPoint } from "@/dsl/ink";

/**
 * The pen's release: raw pointer samples in, one `sketch` statement out.
 *
 * This is the meaning of the gesture with no pointer in it — the same split every other drag in
 * `src/edit/` follows, so it can be tested without a browser. `useEditor`'s `onInk` collects the
 * samples through `Viewport` and hands them here; what comes back is exactly what one commit
 * inserts.
 *
 * Two numbers and a path, on purpose. The item's `x=`/`y=` carry where the stroke sits, snapped to
 * the grid like every other item's origin; the points carry what the stroke *is*, normalised so
 * their minimum is `0,0` and never snapped — a snapped stroke is a staircase, and the whole point
 * of the data shape is that moving a stroke rewrites two numbers and never the path. The two are
 * different facts about one drawing, and only one of them is a position.
 */

/**
 * How far a sample may sit from the chord its neighbours make and still be dropped, in *screen*
 * pixels.
 *
 * 3, because it is below what a hand draws on purpose and above what a pointer reports by
 * accident: the jitter between two samples is a screen pixel or two, and a deliberate change of
 * direction almost never is. The caller divides it by the zoom before it reaches
 * `simplifyPoints` — the points are board units, so an epsilon that reads well on the glass
 * destroys a stroke drawn zoomed out and barely touches one drawn zoomed in.
 */
const EPSILON = 3;

/** What one stroke becomes: the fence attributes and the body, nothing else. */
export interface InkStatement {
  attrs: { x: number; y: number };
  body: string;
}

const snap = (v: number, grid: number) => Math.round(v / grid) * grid;

/**
 * Reduce, bound and place a stroke — or refuse it.
 *
 * `null` when the release is not a stroke. Two gates, for the two ways a release can be nothing:
 * fewer than two distinct samples (a stray click with the pen up), and a list that degenerates to
 * a single point once the whole numbers the grammar holds are rounded — two samples half a pixel
 * apart are one click counted twice, not a line. Two distinct *whole* points is the whole test:
 * their bounds cannot then be degenerate, and a flat or vertical stroke is a real stroke.
 */
export function inkStatement(raw: InkPoint[], zoom: number, grid: number, id: string): InkStatement | null {
  /* Duplicate samples happen at a still pointer between moves; one copy each is all the shape needs. */
  const distinct: InkPoint[] = [];
  for (const p of raw) {
    const last = distinct[distinct.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) distinct.push(p);
  }
  if (distinct.length < 2) return null;

  /* Epsilon is a screen measure; the points it meets are board units. */
  const simplified = simplifyPoints(distinct, EPSILON / Math.max(zoom, 0.0001));
  /* The position moves to `x=`/`y=`; the path starts at its own 0,0. */
  const { pts: shifted, dx, dy } = normalise(simplified);
  const pts: InkPoint[] = [];
  for (const p of shifted) {
    const whole = { x: Math.round(p.x), y: Math.round(p.y) };
    const last = pts[pts.length - 1];
    if (!last || last.x !== whole.x || last.y !== whole.y) pts.push(whole);
  }
  if (pts.length < 2) return null;

  return {
    attrs: { x: snap(dx, grid), y: snap(dy, grid) },
    body: `ink ${id} pts="${formatPoints(pts)}"`,
  };
}
