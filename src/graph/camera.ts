/**
 * The Graph page's camera (#459): a zoom and an offset, so a point of the layout at (x, y) is drawn
 * at (x·z + cx, y·z + cy) CSS px from the canvas's corner. A pan or a zoom changes these three
 * numbers and nothing else — two uniforms, no upload.
 *
 * Pure: no DOM, no React, no `@/` alias.
 */

export interface Camera {
  z: number;
  x: number;
  y: number;
}

/** A box, in layout or screen units. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** How far out and in the camera goes. */
const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 8;
/** A fit never zooms in past this: a graph of three files is not drawn the size of the window. */
const FIT_MOST = 1.6;

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** The box round the first `n` positions (x then y), or a unit box round the middle when there are none. */
export function boundsOf(pos: Float32Array, n: number): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[2 * i]!;
    const y = pos[2 * i + 1]!;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return n > 0 && Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -1, y0: -1, x1: 1, y1: 1 };
}

/** The camera that shows all of `b` inside `room` (screen px), `pad` px from its edges, centred. */
export function fitTo(b: Box, room: Box, pad: number): Camera {
  const w = Math.max(1, room.x1 - room.x0 - 2 * pad);
  const h = Math.max(1, room.y1 - room.y0 - 2 * pad);
  const z = clampZoom(Math.min(FIT_MOST, w / Math.max(1, b.x1 - b.x0), h / Math.max(1, b.y1 - b.y0)));
  return {
    z,
    x: (room.x0 + room.x1) / 2 - ((b.x0 + b.x1) / 2) * z,
    y: (room.y0 + room.y1) / 2 - ((b.y0 + b.y1) / 2) * z,
  };
}

/** `c` zoomed by `by` about the screen point (px, py), which stays where it is. */
export function zoomAbout(c: Camera, px: number, py: number, by: number): Camera {
  const z = clampZoom(c.z * by);
  const wx = (px - c.x) / c.z;
  const wy = (py - c.y) / c.z;
  return { z, x: px - wx * z, y: py - wy * z };
}

/** The camera with layout point (wx, wy) at the screen point (px, py), at zoom `z`. */
export const centreOn = (wx: number, wy: number, px: number, py: number, z: number): Camera => ({
  z: clampZoom(z),
  x: px - wx * clampZoom(z),
  y: py - wy * clampZoom(z),
});

/**
 * How much bigger a dot is drawn at zoom `z`: less than the zoom itself, so far out a file is still a
 * dot and close in it does not fill the screen.
 */
export const dotZoom = (z: number): number => z ** 0.6;

/**
 * `from` moved towards `to` by `k` (0 to 1) — or onto it when it is within a hair, so an easing
 * camera arrives and stops asking for frames. Returns whether it is still on its way.
 */
export function ease(from: Camera, to: Camera, k: number): boolean {
  const near = Math.abs(to.z - from.z) <= 1e-4 * from.z && Math.abs(to.x - from.x) <= 0.05 && Math.abs(to.y - from.y) <= 0.05;
  if (near || k >= 1) {
    from.z = to.z;
    from.x = to.x;
    from.y = to.y;
    return false;
  }
  from.z += (to.z - from.z) * k;
  from.x += (to.x - from.x) * k;
  from.y += (to.y - from.y) * k;
  return true;
}
