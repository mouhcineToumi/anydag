/**
 * Which rows of a long list are in the DOM, with no DOM in it.
 *
 * The sidebar's tree draws the rows in view and a margin either side, so what it costs is the
 * window's height and not the folder's size. **A hand-written window rather than a library**: the
 * rows have two heights (a row, and an open empty folder's row with its *Empty* line under it),
 * both known from the list alone, so a prefix sum is the whole of what a virtualiser would add; and
 * the tree's other code (the drag, the roving focus, the reveal) has to ask *where is row i*
 * and *which rows are drawn*, which a library keeps behind its own element and observer.
 *
 * Rows are positioned from `offsets`, so a row's place never depends on the rows before it being in
 * the DOM — which is what lets one that is pinned (focused, being renamed) stay where it is while
 * the rows around it come and go.
 */

/** The rows `[start, end)` that are drawn. */
export interface Window {
  start: number;
  end: number;
}

/** How many rows are drawn past the edge of the view on each side. */
export const OVERSCAN = 12;
/** A window is kept while the view stays this many rows inside it: a re-render per row scrolled is the cost avoided. */
const SLACK = 4;

/**
 * The top of every row, and the total height at `[n]`: `heights` summed as they go. `n + 1` numbers
 * for `n` rows, so a row's bottom is the next row's top.
 */
export function offsetsOf(heights: ArrayLike<number>): Float64Array {
  const out = new Float64Array(heights.length + 1);
  for (let i = 0; i < heights.length; i++) out[i + 1] = out[i]! + heights[i]!;
  return out;
}

/** The row that holds the point `y` (from the top of the list): the first when above it, the last when below. */
export function rowAt(offsets: ArrayLike<number>, y: number): number {
  const n = offsets.length - 1;
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The window for a view `height` tall whose top is `top` down the list: the rows it shows and
 * `OVERSCAN` either side. `prev` is returned as it was (the same object, so a state setter sees no
 * change) while the view is still well inside it and it has not grown far past what is needed.
 */
export function windowFor(offsets: ArrayLike<number>, top: number, height: number, prev?: Window | null): Window {
  const n = offsets.length - 1;
  if (n <= 0) return { start: 0, end: 0 };
  const first = rowAt(offsets, Math.max(0, top));
  const last = rowAt(offsets, Math.max(0, top) + Math.max(0, height));
  if (
    prev &&
    prev.end <= n &&
    (prev.start === 0 || prev.start <= first - SLACK) &&
    (prev.end === n || prev.end >= last + 1 + SLACK) &&
    prev.end - prev.start <= last - first + 1 + 4 * OVERSCAN
  )
    return prev;
  return { start: Math.max(0, first - OVERSCAN), end: Math.min(n, last + 1 + OVERSCAN) };
}

/**
 * The `top` a list must scroll to for row `i` to be in view: where it already is when the row is
 * showing, the least that shows it for `"nearest"`, and the row centred for `"center"` — which is
 * also what it does for a row that is out of view and `"nearest"` would leave flush against an edge.
 * Clamped to the list, since a browser would clamp it anyway and the answer is compared with what it did.
 */
export function scrollFor(
  offsets: ArrayLike<number>,
  i: number,
  top: number,
  height: number,
  block: "nearest" | "center",
): number {
  const n = offsets.length - 1;
  const max = Math.max(0, offsets[n]! - height);
  const a = offsets[i]!;
  const b = offsets[i + 1]!;
  if (a >= top && b <= top + height) return top;
  if (block === "center") return Math.min(max, Math.max(0, a + (b - a) / 2 - height / 2));
  return Math.min(max, Math.max(0, a < top ? a : b - height));
}

/** The indices to draw: the window and every pinned row, each once, in order. */
export function drawn(win: Window, count: number, pinned: Iterable<number>): number[] {
  const out = new Set<number>();
  for (let i = win.start; i < Math.min(win.end, count); i++) out.add(i);
  for (const i of pinned) if (i >= 0 && i < count) out.add(i);
  return [...out].sort((a, b) => a - b);
}
