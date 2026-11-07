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

/**
 * **Deliberately does not round.** A trackpad sends deltas of one or two pixels; rounded, each one
 * lands back on the value it started from and the canvas never moves.
 */
export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** The button and keyboard path, where a tidy number is worth more than precision. */
export const stepZoom = (z: number, dir: 1 | -1): number =>
  clampZoom(Math.round((z + dir * ZOOM_STEP) * 100) / 100);

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

/** The zoom and offset that put `content` in the middle of `view` with a margin. */
export function fitTo(content: Rect, view: { w: number; h: number }): { zoom: number; off: Point } {
  const zoom = clampZoom(
    Math.min((view.w - FIT_MARGIN * 2) / Math.max(content.w, 1), (view.h - FIT_MARGIN * 2) / Math.max(content.h, 1)),
  );
  return {
    zoom,
    off: {
      x: (view.w - content.w * zoom) / 2 - content.x * zoom,
      y: (view.h - content.h * zoom) / 2 - content.y * zoom,
    },
  };
}

/** A window narrower than this is a phone's: the sidebar is a sheet there and never docks. */
export const NARROW = 720;
/** The least zoom a board opens at on a phone: below it a card's title is too small to read. */
export const READABLE = 0.6;
/** The margin round what a phone opens on: a desktop's sixty-four pixels are a sixth of its width. */
const NARROW_MARGIN = 16;

/**
 * Where a board opens: the whole of it, fitted — unless the window is a phone's and the whole of it
 * would be too small to read. Then it opens on `first`, the item a reader starts with, as wide as the
 * window allows and never smaller than {@link READABLE}, its top-left corner at the margin, and the
 * rest is a pan or a pinch away. A drawing nobody can read is not an overview of anything.
 */
export function openOn(content: Rect, first: Rect | null, view: { w: number; h: number }): { zoom: number; off: Point } {
  const whole = fitTo(content, view);
  if (view.w >= NARROW || !first || whole.zoom >= READABLE) return whole;
  const across = (view.w - NARROW_MARGIN * 2) / Math.max(first.w, 1);
  const zoom = clampZoom(Math.max(READABLE, Math.min(1, across)));
  /* Centred when it fits across, held at the left margin when it does not. */
  const x = first.w * zoom <= view.w - NARROW_MARGIN * 2 ? (view.w - first.w * zoom) / 2 : NARROW_MARGIN;
  return { zoom, off: { x: x - first.x * zoom, y: NARROW_MARGIN - first.y * zoom } };
}

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
