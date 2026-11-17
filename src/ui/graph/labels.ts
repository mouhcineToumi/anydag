/**
 * The Graph page's names (#459), on a 2D canvas over the WebGL one.
 *
 * **The most linked first, each only where there is room, more as you zoom in.** A name is drawn
 * under its dot when the dot is big enough on screen to deserve one, in order of links, and only if
 * the cells of a coarse grid it would cover are free; a name that does not fit is skipped, never
 * squeezed. While a file is lit, its name and its neighbours' are drawn first and the rest fade.
 * **A group's name sits over its group while you are zoomed out**, and fades as you come in to
 * where the files' own names take over.
 *
 * Every colour and size is handed in, from the theme.
 */

/** The occupancy grid's cell, in CSS px: coarse on purpose, so names keep a little air between them. */
const CELL_W = 24;
const CELL_H = 16;
/** At most this many names a frame, whatever the zoom: past it a frame costs more than it shows. */
const MOST = 220;
/** At most this many groups are named. */
const GROUPS = 40;
/** A group smaller than this is not named. */
const GROUP_MIN = 4;

export interface LabelStyle {
  font: string;
  regular: number;
  strong: number;
  size: number;
  gap: number;
  halo: number;
  /** The dot's radius on screen from which its name is drawn. */
  from: number;
  groupSize: number;
  groupHalo: number;
  paper: string;
  ink: string;
  slate: string;
}

export interface LabelScene {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  dpr: number;
  /** Camera. */
  z: number;
  x: number;
  y: number;
  /** `dotZoom(z)`. */
  dot: number;
  dotMin: number;
  /** The hover's fade, and the file lit (`-1`: none). */
  hover: number;
  focus: number;
  n: number;
  pos: Float32Array;
  radius: Float32Array;
  byDegree: Int32Array;
  start: Int32Array;
  near: Int32Array;
  /** A shown file's name. */
  name(i: number): string;
  /** A width cache, one slot per shown file (0: not measured yet). */
  widths: Float32Array;
  /** Groups, when they have names. */
  group: Int32Array | null;
  groupNames: readonly string[] | null;
  groupSizes: Int32Array | null;
  /** The radius the simulation packs a group of `size` files into, at zoom 1. */
  groupRadius(size: number): number;
}

export function drawLabels(s: LabelScene, st: LabelStyle): void {
  const { ctx, w, h } = s;
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!s.n) return;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.strokeStyle = st.paper;
  const taken = new Set<number>();
  const cellKey = (r: number, c: number) => r * 8192 + c;
  const regular = `${st.regular} ${st.size}px ${st.font}`;
  const strong = `${st.strong} ${st.size}px ${st.font}`;

  const put = (i: number, alpha: number, lead: boolean): void => {
    const x = s.pos[2 * i]! * s.z + s.x;
    const y = s.pos[2 * i + 1]! * s.z + s.y;
    if (x < -80 || x > w + 80 || y < -24 || y > h + 24) return;
    const name = s.name(i);
    ctx.font = lead ? strong : regular;
    let width = s.widths[i]!;
    if (lead || !width) {
      width = ctx.measureText(name).width;
      if (!lead) s.widths[i] = width;
    }
    const top = y + Math.max(s.radius[i]! * s.dot, s.dotMin) + st.gap;
    const c0 = Math.floor((x - width / 2) / CELL_W);
    const c1 = Math.floor((x + width / 2) / CELL_W);
    const row = Math.floor(top / CELL_H);
    if (!lead) for (let c = c0; c <= c1; c++) if (taken.has(cellKey(row, c))) return;
    for (let c = c0; c <= c1; c++) taken.add(cellKey(row, c));
    ctx.globalAlpha = alpha;
    ctx.lineWidth = st.halo;
    ctx.strokeText(name, x, top);
    ctx.fillStyle = lead ? st.ink : st.slate;
    ctx.fillText(name, x, top);
  };

  /* Groups first, while far enough out to see groups rather than files. */
  const far = Math.min(1, Math.max(0, (1.9 - s.z) / 0.7)) * (1 - 0.8 * s.hover);
  if (s.group && s.groupNames && s.groupSizes && far > 0.02) {
    const most = Math.min(s.groupNames.length, GROUPS);
    const sx = new Float64Array(most);
    const sy = new Float64Array(most);
    for (let i = 0; i < s.n; i++) {
      const g = s.group[i]!;
      if (g >= 0 && g < most) {
        sx[g] += s.pos[2 * i]!;
        sy[g] += s.pos[2 * i + 1]!;
      }
    }
    ctx.font = `${st.strong} ${st.groupSize}px ${st.font}`;
    ctx.textBaseline = "bottom";
    ctx.globalAlpha = far;
    ctx.lineWidth = st.groupHalo;
    for (let g = 0; g < most; g++) {
      const size = s.groupSizes[g]!;
      if (size < GROUP_MIN) break;
      const x = (sx[g]! / size) * s.z + s.x;
      const y = (sy[g]! / size - s.groupRadius(size)) * s.z + s.y - st.gap;
      if (x < -120 || x > w + 120 || y < 0 || y > h + 24) continue;
      const name = s.groupNames[g]!;
      const width = ctx.measureText(name).width;
      const c0 = Math.floor((x - width / 2) / CELL_W);
      const c1 = Math.floor((x + width / 2) / CELL_W);
      const row = Math.floor((y - CELL_H) / CELL_H);
      let free = true;
      for (let c = c0; c <= c1 && free; c++) if (taken.has(cellKey(row, c))) free = false;
      if (!free) continue;
      for (let c = c0; c <= c1; c++) {
        taken.add(cellKey(row, c));
        taken.add(cellKey(row + 1, c));
      }
      ctx.strokeText(name, x, y);
      ctx.fillStyle = st.ink;
      ctx.fillText(name, x, y);
    }
    ctx.textBaseline = "top";
  }

  /* The lit file and its neighbours. */
  if (s.focus >= 0 && s.focus < s.n && s.hover > 0) {
    put(s.focus, s.hover, true);
    const from = s.start[s.focus]!;
    const to = s.start[s.focus + 1]!;
    const fade = to - from > 12 ? 0.85 : 1;
    for (let k = from; k < to && k < from + 40; k++) put(s.near[k]!, s.hover * fade, false);
  }

  /* Then the rest, most linked first, while their dots are big enough to deserve a name. */
  let drawn = 0;
  for (let o = 0; o < s.n && drawn < MOST; o++) {
    const i = s.byDegree[o]!;
    const alpha = Math.min(1, (s.radius[i]! * s.dot - st.from) / 2.4) * (1 - 0.9 * s.hover);
    if (alpha <= 0.02) break;
    if (i === s.focus) continue;
    put(i, alpha, false);
    drawn++;
  }
  ctx.globalAlpha = 1;
}
