/**
 * Smart guides: where a box being dragged would like to land, given the boxes around it.
 *
 * Two families of candidate, per axis, the way draw.io does it:
 *
 * - **Alignment.** The mover's left, centre or right meets another box's left, centre or right
 *   (top, middle, bottom on the other axis). Drawn as a line through both boxes.
 * - **Spacing.** The mover sits exactly between two boxes, or exactly as far from a box as that box
 *   is from its neighbour. Drawn as the two equal gaps.
 *
 * On each axis the nearest candidate within `threshold` wins; a spacing candidate wins a tie,
 * because it is the rarer thing to hit by accident. An axis with nothing near returns `null` and
 * the caller falls back to the grid. Pure geometry, no DOM, so it is tested as arithmetic.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Guide {
  /** `x`: a vertical line at `at`, from `from` to `to` in y. `y`: the other way round. */
  axis: "x" | "y";
  kind: "align" | "gap";
  at: number;
  from: number;
  to: number;
}

export interface Snap {
  /** The x the mover should take, or `null` when nothing is near. */
  x: number | null;
  y: number | null;
  guides: Guide[];
}

interface Candidate {
  /** The mover's new position on this axis. */
  value: number;
  delta: number;
  kind: "align" | "gap";
  guides: Guide[];
}

/** One axis of a box: start, size, and the other axis's extent for drawing. */
interface Span {
  a: number;
  size: number;
  /** Cross-axis start and end, so a guide can be drawn through both boxes. */
  c0: number;
  c1: number;
}

const span = (b: Box, axis: "x" | "y"): Span =>
  axis === "x" ? { a: b.x, size: b.w, c0: b.y, c1: b.y + b.h } : { a: b.y, size: b.h, c0: b.x, c1: b.x + b.w };

const overlaps = (p: Span, q: Span): boolean => p.c0 < q.c1 && p.c1 > q.c0;

function axisCandidates(axis: "x" | "y", mover: Span, others: Span[], threshold: number): Candidate[] {
  const out: Candidate[] = [];

  /* Alignment: each of the mover's three lines against each of the other's three. */
  const lines = (s: Span) => [s.a, s.a + s.size / 2, s.a + s.size];
  const mine = lines(mover);
  for (const o of others) {
    const theirs = lines(o);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const value = theirs[j]! - (mine[i]! - mover.a);
        const delta = Math.abs(value - mover.a);
        if (delta > threshold) continue;
        out.push({
          value,
          delta,
          kind: "align",
          guides: [
            {
              axis,
              kind: "align",
              at: theirs[j]!,
              from: Math.min(mover.c0, o.c0),
              to: Math.max(mover.c1, o.c1),
            },
          ],
        });
      }
    }
  }

  /* Spacing: pairs of others that the mover is roughly in line with. */
  const inLine = others.filter((o) => overlaps(mover, o)).sort((p, q) => p.a - q.a);
  const cross = (a: Span, b: Span) => {
    const lo = Math.max(a.c0, b.c0, mover.c0);
    const hi = Math.min(a.c1, b.c1, mover.c1);
    return lo < hi ? (lo + hi) / 2 : (mover.c0 + mover.c1) / 2;
  };
  const gap = (at: number, from: number, to: number): Guide => ({ axis, kind: "gap", at, from, to });

  for (let i = 0; i < inLine.length; i++) {
    for (let j = i + 1; j < inLine.length; j++) {
      const A = inLine[i]!;
      const B = inLine[j]!;
      const aEnd = A.a + A.size;
      const g = B.a - aEnd;
      const y = cross(A, B);
      if (g >= mover.size) {
        /* Between the two, with equal room on each side. */
        const value = aEnd + (g - mover.size) / 2;
        const delta = Math.abs(value - mover.a);
        if (delta <= threshold) {
          out.push({
            value,
            delta,
            kind: "gap",
            guides: [gap(y, aEnd, value), gap(y, value + mover.size, B.a)],
          });
        }
      }
      if (g > 0) {
        /* Beyond B, or before A, at the same distance A and B keep from each other. */
        const bEnd = B.a + B.size;
        const after = bEnd + g;
        const dAfter = Math.abs(after - mover.a);
        if (dAfter <= threshold) {
          out.push({ value: after, delta: dAfter, kind: "gap", guides: [gap(y, aEnd, B.a), gap(y, bEnd, after)] });
        }
        const before = A.a - g - mover.size;
        const dBefore = Math.abs(before - mover.a);
        if (dBefore <= threshold) {
          out.push({ value: before, delta: dBefore, kind: "gap", guides: [gap(y, before + mover.size, A.a), gap(y, aEnd, B.a)] });
        }
      }
    }
  }

  return out;
}

function best(cands: Candidate[]): Candidate | null {
  let win: Candidate | null = null;
  for (const c of cands) {
    if (!win || c.delta < win.delta - 1e-9 || (Math.abs(c.delta - win.delta) <= 1e-9 && c.kind === "gap" && win.kind !== "gap"))
      win = c;
  }
  return win;
}

/**
 * Where `mover` snaps, given `others`. Every box is in board coordinates; `threshold` is how close
 * is close enough, in the same units — a few screen pixels divided by the zoom.
 *
 * The guides for an alignment are widened to every other box that shares the line, so three cards
 * on one baseline draw one line through all three.
 */
export function snapBox(mover: Box, others: Box[], threshold: number): Snap {
  if (others.length === 0 || threshold <= 0) return { x: null, y: null, guides: [] };
  const out: Snap = { x: null, y: null, guides: [] };
  for (const axis of ["x", "y"] as const) {
    const m = span(mover, axis);
    const os = others.map((o) => span(o, axis));
    const win = best(axisCandidates(axis, m, os, threshold));
    if (!win) continue;
    if (axis === "x") out.x = win.value;
    else out.y = win.value;
    for (const g of win.guides) {
      if (g.kind === "align") {
        /* Every box with a line at `at` extends the guide. */
        for (const o of os) {
          if ([o.a, o.a + o.size / 2, o.a + o.size].some((v) => Math.abs(v - g.at) < 0.5)) {
            g.from = Math.min(g.from, o.c0);
            g.to = Math.max(g.to, o.c1);
          }
        }
      }
      out.guides.push(g);
    }
  }
  return out;
}

/** The bounding box of several boxes. */
export function union(boxes: Box[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The guides as SVG markup, for the painted overlay. Board coordinates; the layer scales them. */
export function guidesToSvg(guides: Guide[], tick: number): string {
  const line = (x1: number, y1: number, x2: number, y2: number, cls: string) =>
    `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  return guides
    .map((g) => {
      const cls = g.kind === "align" ? "dag-guide" : "dag-guide dag-guide--gap";
      if (g.axis === "x") {
        /* An alignment on x is a vertical line at `at`; a gap on x runs along x from `from` to
           `to`, drawn at the cross position `at`, with a tick at each end. */
        if (g.kind === "align") return line(g.at, g.from, g.at, g.to, cls);
        return (
          line(g.from, g.at, g.to, g.at, cls) +
          line(g.from, g.at - tick, g.from, g.at + tick, cls) +
          line(g.to, g.at - tick, g.to, g.at + tick, cls)
        );
      }
      if (g.kind === "align") return line(g.from, g.at, g.to, g.at, cls);
      return (
        line(g.at, g.from, g.at, g.to, cls) +
        line(g.at - tick, g.from, g.at + tick, g.from, cls) +
        line(g.at - tick, g.to, g.at + tick, g.to, cls)
      );
    })
    .join("");
}
