/**
 * Viewport maths.
 *
 * The zoom range is wide, because a board is many items of wildly different scale — you zoom out
 * to find the diagram and in to read a row.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  w: number;
  h: number;
}

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.15;
export const WHEEL_ZOOM = 0.0015;
/** What a line and a page of wheel are worth, for the browsers that report in those units. */
const WHEEL_LINE = 16;
const WHEEL_PAGE = 400;
export const PAN_STEP = 88;
export const DRAG_SLOP = 4;
const FIT_MARGIN = 64;
/** The most the view a board opens with may magnify — see `firstFit`. */
const FIRST_FIT_MAX = 1;

/**
 * **Deliberately does not round.** A trackpad sends deltas of one or two pixels; rounded, each one
 * lands back on the value it started from and the canvas never moves.
 */
export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** The button and keyboard path, where a tidy number is worth more than precision. */
export const stepZoom = (z: number, dir: 1 | -1): number => clampZoom(Math.round((z + dir * ZOOM_STEP) * 100) / 100);

/**
 * Keep the content reachable without pinning it.
 *
 * An infinite canvas that clamps to its content cannot be panned aside to think; one that clamps to
 * nothing loses the board behind you with no way back. The bound is the content plus a full
 * viewport of slack on every side, so you can always push the work off-screen and always find it.
 */
export function clampPan(off: Point, content: Rect, zoom: number, view: { w: number; h: number }): Point {
  const axis = (v: number, lo0: number, hi0: number): number => Math.min(hi0, Math.max(lo0, v));
  const cw = content.w * zoom;
  const ch = content.h * zoom;
  const cx = content.x * zoom;
  const cy = content.y * zoom;
  return {
    x: axis(off.x, -cx - cw, view.w - cx + view.w),
    y: axis(off.y, -cy - ch, view.h - cy + view.h),
  };
}

/**
 * The zoom and offset that put `content` in the middle of `view` with a margin.
 *
 * `maxZoom` is the automatic fit's ceiling. The explicit Fit action leaves it at the range's own
 * top: a person asking to frame one small card means to look at it closely.
 */
export function fitTo(content: Rect, view: { w: number; h: number }, maxZoom: number = ZOOM_MAX): { zoom: number; off: Point } {
  const zoom = Math.min(
    maxZoom,
    clampZoom(Math.min((view.w - FIT_MARGIN * 2) / Math.max(content.w, 1), (view.h - FIT_MARGIN * 2) / Math.max(content.h, 1))),
  );
  return {
    zoom,
    off: {
      x: (view.w - content.w * zoom) / 2 - content.x * zoom,
      y: (view.h - content.h * zoom) / 2 - content.y * zoom,
    },
  };
}

/**
 * **The view a board opens with never magnifies past 100%.**
 *
 * Fitting answers "show me everything on the board", and on a small one that means blowing it up
 * until it fills the glass. A new board's prompt card came up at 215% — the person read it as "too
 * much zoom", not as a fitted board, and the note a blank board used to carry did the same before
 * it. So the automatic fit shrinks a large board and leaves a small one at 100%, with the paper
 * around it. The person still reaches every zoom above 100% with `+`, the wheel or the bar, and
 * the explicit Fit action still frames content of any size.
 */
export const firstFit = (content: Rect, view: { w: number; h: number }) => fitTo(content, view, FIRST_FIT_MAX);

/**
 * A wheel delta in CSS pixels, whatever unit the browser chose to report it in.
 *
 * Chrome reports pixels, Firefox reports lines, and a page-mode wheel exists on paper if not often
 * in the wild. The zoom path always normalised; the pan path did not, because a plain wheel used to
 * mean zoom and so the pan branch only ever saw a trackpad, which is pixel-mode by construction.
 * Now that a plain wheel pans, a Firefox mouse would have moved the board three pixels a notch.
 */
export const wheelPixels = (delta: number, mode: number): number =>
  delta * (mode === 1 ? WHEEL_LINE : mode === 2 ? WHEEL_PAGE : 1);
