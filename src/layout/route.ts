import type { Edge, Marker } from "@/dsl/ir";
import type { ThemeMetric } from "@/theme/contract";

import { onHull, onOutline, type Point as HullPoint, type ShapeKind, type Side as HullSide } from "./shapes";
import type { Box, MarkerAt, RoutedEdge } from "./types";

/**
 * Edge routing in the house style.
 *
 * Three things an earlier radial-edge router did not need, and it was rewritten around them:
 *
 * 1. **Per-node sizes.** When every card is one size, the delta between two
 *    top-left corners *is* the delta between centres. Here every rectangle differs and the maths
 *    has to work in centres.
 * 2. **Row anchors.** An edge that belongs to a port leaves at that row's y, not at a fanned point
 *    (rule 9). This is what makes an architecture diagram readable, and it is why ELK's port
 *    coordinates are thrown away — ELK spaces ports evenly, and a row is where the text is.
 * 3. **Buses.** Several sources collapsing into one trunk with a junction dot.
 *
 * What carries over unchanged is the shape: anchors sit exactly on the boundary, control points
 * push along the side's outward normal, and several edges leaving one side fan across its middle
 * 60% sorted by where they are going. That combination is what makes the curves look drawn rather
 * than computed.
 */

type Side = "top" | "right" | "bottom" | "left";

const NORMAL: Record<Side, { x: number; y: number }> = {
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  top: { x: 0, y: -1 },
};

/** The side, as the segment it spans, traversed clockwise on screen — so one angle sorts all four. */
function sideSpan(b: Box, side: Side): [{ x: number; y: number }, { x: number; y: number }] {
  const r = b.x + b.w;
  const bot = b.y + b.h;
  switch (side) {
    case "right":
      return [{ x: r, y: b.y }, { x: r, y: bot }];
    case "bottom":
      return [{ x: r, y: bot }, { x: b.x, y: bot }];
    case "left":
      return [{ x: b.x, y: bot }, { x: b.x, y: b.y }];
    case "top":
      return [{ x: b.x, y: b.y }, { x: r, y: b.y }];
  }
}

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Which side of `from` faces `to`: the centre-to-centre ray, intersected with the rectangle. */
function sideToward(from: Box, to: Box): Side {
  const a = centre(from);
  const b = centre(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) * from.h >= Math.abs(dy) * from.w) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

const SIDE_ANGLE: Record<Side, number> = { right: 0, bottom: Math.PI / 2, left: Math.PI, top: -Math.PI / 2 };

/** Into `(-π, π]`, so two angles either side of π do not sort as far apart. */
function wrapPi(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

interface Anchor {
  edge: string;
  end: "from" | "to";
  node: string;
  side: Side;
  /** Where the other end lies, measured from this side's own facing. Sorts the fan. */
  key: number;
  /** The node at the far end, and the edge's place in the input — what breaks a tie in `key`. */
  other: string;
  order: number;
  /** Along the side, 0 → 1 clockwise. Filled by the fan pass, or fixed by a row. */
  t: number;
  fixed?: { x: number; y: number };
}

function pointAt(b: Box, side: Side, t: number): { x: number; y: number } {
  const [s, e] = sideSpan(b, side);
  return { x: s.x + (e.x - s.x) * t, y: s.y + (e.y - s.y) * t };
}

/** How far a control point sits off its anchor: mostly along the normal, a little across. */
function reachOf(n: { x: number; y: number }, dx: number, dy: number, m: ThemeMetric): number {
  const along = n.x ? dx * Math.sign(n.x) : dy * Math.sign(n.y);
  const across = n.x ? Math.abs(dy) : Math.abs(dx);
  return Math.max(m.edge.reach.min, Math.min(m.edge.reach.max, along * m.edge.reach.along + across * m.edge.reach.across));
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** How far back from the card a marker starts, so the shape does not poke through the border. */
function markerInset(kind: Marker, m: ThemeMetric): number {
  switch (kind) {
    case "triangle":
      return m.edge.triangle.h;
    case "diamond":
    case "diamond-hollow":
      return m.edge.diamond.h;
    case "crow":
      return m.edge.crow.len;
    default:
      return 0;
  }
}

export interface RouteNode extends Box {
  id: string;
  /** Absolute y of each row's centre. */
  rows: Record<string, number>;
  surface: "paper" | "group";
  /** A group box is scenery, not an obstacle — routes cross them by design. */
  isGroup?: boolean;
  /**
   * The node is a geometric shape rather than a card, so an edge ends where the outline is and not
   * on the side of the box around it — a quarter of the box short, on a triangle's slanted side.
   */
  outline?: ShapeKind;
  /**
   * A hull of the node's own, in its box's coordinates — a `figure`'s picture over its caption
   * (`layout/figure.ts`). The same meeting as `outline`, for a node whose edge is not one of the
   * sixteen shapes but is also not its box: a caption wider than its picture put the arrow's head
   * a caption's width short of the house it pointed at.
   */
  hull?: HullPoint[];
}

/** Where an edge meets a node whose outline is not its box, and the box's point for every other. */
const meet = (o: RouteNode, side: HullSide, p: Point): Point =>
  o.outline ? onOutline(o.outline, o, side, p) : o.hull ? onHull(o.hull, o, side, p) : p;

export interface RouteInput {
  nodes: Record<string, RouteNode>;
  edges: Edge[];
  /** ELK's own polyline, when it had to route around something. */
  bends: Record<string, { x: number; y: number }[]>;
  /**
   * One point an author bent an edge through, and the only input here that is a person's rather
   * than a layout's.
   *
   * Board links only — `boardRoute.ts` is the one caller that fills it. Inside a diagram the cards
   * are where ELK put them, so a fixed point on the line between two of them is a claim the next
   * relayout would make false; that is the refusal `resizeOf`'s `aspect` already makes about a
   * diagram's box, one drawing element over.
   *
   * It wins outright. An edge with one of these takes neither the bow, nor the dogleg, nor the
   * side arc: those exist to get a line past a card nobody meant it to cross, and somebody who has
   * dragged the line somewhere has already said where it goes.
   */
  via?: Record<string, { x: number; y: number }>;
  /** Measured label boxes, so overlapping labels can be pushed apart. */
  labels?: Record<string, { w: number; h: number }>;
  metric: ThemeMetric;
}

/**
 * Push overlapping labels apart along the direction each was already offset in.
 *
 * ELK reserves room for a label when it routes, which keeps most of them clear, but nothing stops
 * two labels on *different* edges landing on the same spot — and two overlapping 10px mono strings
 * are unreadable in a way a slightly-misplaced one is not. One pass, greedy, in edge order: later
 * labels move, earlier ones stay, so the result is stable rather than oscillating.
 */
function separateLabels(
  edges: RoutedEdge[],
  labels: Record<string, { w: number; h: number }>,
  fallback: number,
): void {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const overlaps = (a: (typeof placed)[number], b: (typeof placed)[number]) =>
    Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

  for (const e of edges) {
    if (!e.label) continue;
    const size = labels[e.id] ?? { w: e.label.text.length * 6, h: fallback };
    /* `x` is where the text is anchored, which is its middle only for a `middle` label: a label
       beside a vertical run starts or ends there, and measuring it as centred put two labels either
       side of a loop's two strokes on top of each other when they were a stroke's width apart. */
    const shift = e.label.anchor === "start" ? size.w / 2 : e.label.anchor === "end" ? -size.w / 2 : 0;
    const box = { x: e.label.x + shift, y: e.label.y, w: size.w + 8, h: size.h + 6 };

    /* Step along the axis the label was offset on — above a horizontal line, beside a vertical one
       — so a nudge never puts the text on top of its own edge. */
    const vertical = e.label.anchor === "middle";
    for (let step = 0; step < 6 && placed.some((p) => overlaps(p, box)); step++) {
      const push = (step + 1) * (size.h + 6) * (step % 2 === 0 ? -1 : 1);
      if (vertical) box.y = e.label.y + push;
      else box.x = e.label.x + shift + push;
    }

    e.label.x = box.x - shift;
    e.label.y = box.y;
    placed.push(box);
  }
}

/**
 * ELK's polyline, checked against the anchors we are actually going to draw from.
 *
 * ELK routed from a port on a side it chose; `route.ts` draws from the row (rule 9) on the side
 * that faces the other card, and the two need not agree. Splicing our endpoints onto a polyline
 * computed for a different exit is what draws the twisted edge: a line that leaves a card on the
 * left, jumps across to bends laid out for an exit on the right, and doubles back.
 *
 * So drop the bends that sit *behind* either anchor — measured along that side's outward normal,
 * which is the only thing that makes a bend reachable without turning round. If what survives is no
 * longer a detour, there was nothing on this route that the house curve has to dodge either, and
 * the curve is the better drawing.
 */
function usableBends(
  bends: { x: number; y: number }[] | undefined,
  start: { x: number; y: number },
  fromSide: Side,
  end: { x: number; y: number },
  toSide: Side,
): { x: number; y: number }[] | undefined {
  if (!bends) return undefined;
  const ahead = (p: { x: number; y: number }, of: { x: number; y: number }, side: Side) =>
    (p.x - of.x) * NORMAL[side].x + (p.y - of.y) * NORMAL[side].y >= 0;
  let lo = 0;
  let hi = bends.length;
  while (lo < hi && !ahead(bends[lo]!, start, fromSide)) lo++;
  while (hi > lo && !ahead(bends[hi - 1]!, end, toSide)) hi--;
  return bends.slice(lo, hi);
}

/**
 * A curve bowed away from a card it has nothing to do with.
 *
 * The router makes one deterministic choice per edge, and for two cards with a third between them
 * that choice is a curve straight through the third — the worst thing a route can do, and the one
 * defect a screenshot never catches, because the line looks perfectly well drawn until you read
 * what it crosses. ELK dodges obstacles for the edges it routes; it does not route these, either
 * because the pair was hoisted or because the curve is ours and it never saw it.
 *
 * There is no search here and there should not be one: push the two control points off the chord in
 * fixed steps of the grid, away from whatever is in the way first, and take the first offset that
 * clears. Same board, same drawing, every time. If nothing clears within a card's width the
 * original is kept — a badly bowed curve that still crosses is worse than a straight one that does.
 */
/** Does an axis-aligned run from `a` to `b` pass through any obstacle? */
function runHits(a: Point, b: Point, obstacles: RouteNode[], margin: number): boolean {
  const x0 = Math.min(a.x, b.x) - margin;
  const x1 = Math.max(a.x, b.x) + margin;
  const y0 = Math.min(a.y, b.y) - margin;
  const y1 = Math.max(a.y, b.y) + margin;
  return obstacles.some((o) => x1 > o.x && x0 < o.x + o.w && y1 > o.y && y0 < o.y + o.h);
}

/**
 * A dogleg around the card a bow cannot clear.
 *
 * Only for a horizontal exit, which is where the problem lives: a row anchor is fixed on the side
 * of its card and the next card over is one `colGap` away, so the chord to anything not in that
 * card runs straight through it and `bowClear` runs out of room. The route leaves the row, turns
 * in the gap, runs along the near side of the blocker, and comes in on the target's own side:
 *
 *     row ─┐            ┌─▶ target        (target reached sideways)
 *          └────────────┘
 *
 * Every leg is checked against every obstacle, and a leg that would double back gives up and
 * leaves the bow as it was. It is drawn as the same rounded polyline ELK's own detours get, so a
 * reader cannot tell which of the two found the way round.
 */
function detour(
  start: Point,
  na: Point,
  to: { side: Side; at: Point },
  alt: { side: Side; at: Point } | undefined,
  inset: number,
  blocker: RouteNode,
  obstacles: RouteNode[],
  m: ThemeMetric,
): { points: Point[]; rawEnd: Point; nb: Point } | undefined {
  /* A vertical exit is the same problem turned on its side — a pill leaving its bottom for one
     three places down the column — so it is solved in the transposed plane and turned back. */
  if (na.x === 0) {
    const t = (p: Point): Point => ({ x: p.y, y: p.x });
    const tSide = (side: Side): Side =>
      side === "top" ? "left" : side === "bottom" ? "right" : side === "left" ? "top" : "bottom";
    const tBox = (o: RouteNode): RouteNode => ({ ...o, x: o.y, y: o.x, w: o.h, h: o.w });
    const found = detour(
      t(start),
      t(na),
      { side: tSide(to.side), at: t(to.at) },
      alt ? { side: tSide(alt.side), at: t(alt.at) } : undefined,
      inset,
      tBox(blocker),
      obstacles.map(tBox),
      m,
    );
    return found ? { points: found.points.map(t), rawEnd: t(found.rawEnd), nb: t(found.nb) } : undefined;
  }
  const clear = m.grid * 3;
  const out = Math.sign(na.x);
  const stub = (gap: number) => Math.max(m.grid, Math.min(gap / 2, m.edge.reach.min));

  /* 1. Out of the row, into the gap before the blocker. */
  const gap = out > 0 ? blocker.x - start.x : start.x - (blocker.x + blocker.w);
  if (gap < m.grid) return undefined;
  const gx = start.x + out * stub(gap);

  /* 2. A row to run along: just past the blocker on the target's side first, then past whichever
     card is stacked beyond it, nearest first. Cards come in columns, and the first clear row is
     usually under the column rather than under the one card the bow happened to hit. */
  const rows = (end: Point): number[] => {
    const seen = new Set<number>();
    const cands: number[] = [];
    for (const o of [blocker, ...obstacles]) {
      for (const cy of [o.y - clear, o.y + o.h + clear]) {
        const k = Math.round(cy);
        if (!seen.has(k)) (seen.add(k), cands.push(k));
      }
    }
    const mid = blocker.y + blocker.h / 2;
    const near = end.y < mid ? -1 : 1;
    /* The blocker's own far side, then by distance from the row we left. */
    return cands.sort((p, q) => {
      const pa = p === Math.round(near < 0 ? blocker.y - clear : blocker.y + blocker.h + clear) ? -1 : 0;
      const qa = q === Math.round(near < 0 ? blocker.y - clear : blocker.y + blocker.h + clear) ? -1 : 0;
      return pa - qa || Math.abs(p - start.y) - Math.abs(q - start.y);
    });
  };

  for (const target of alt ? [to, alt] : [to]) {
    const nb = NORMAL[target.side];
    const end = { x: target.at.x + nb.x * inset, y: target.at.y + nb.y * inset };
    for (const cy of rows(end)) {
      const pts: Point[] = [start, { x: gx, y: start.y }, { x: gx, y: cy }];

      /* 3. In. Sideways: along `cy` to a stub before the target — inside the gap before it, not a
         fixed length, or the stub lands in the card next door — then to its row. From above or
         below: along `cy` to over the target, then straight in. */
      if (nb.x !== 0) {
        const before = obstacles
          .filter((o) => o.y < end.y && o.y + o.h > end.y && (nb.x < 0 ? o.x + o.w <= end.x : o.x >= end.x))
          .map((o) => (nb.x < 0 ? end.x - (o.x + o.w) : o.x - end.x));
        const hx = end.x + nb.x * stub(before.length ? Math.min(...before) : m.edge.reach.min * 2);
        if (Math.sign(hx - gx) !== out || Math.sign(end.x - hx) !== out) continue;
        pts.push({ x: hx, y: cy }, { x: hx, y: end.y }, end);
      } else {
        /* A real approach leg, not a row grazing the target's edge. */
        if (Math.sign(end.y - cy) !== -Math.sign(nb.y) || Math.abs(end.y - cy) < clear) continue;
        if (Math.sign(end.x - gx) !== out) continue;
        pts.push({ x: end.x, y: cy }, end);
      }

      /* With a little room: the rows come from every card's edges, and one card's clearance row
         can fall in the gap between two others. Half a grid step keeps a run off a card's border
         without refusing the 16px gap ELK leaves between two pills, which its own routes thread. */
      if (pts.some((p, i) => i > 0 && runHits(pts[i - 1]!, p, obstacles, m.grid / 2))) continue;
      /* The approach leg can be zero-length when the target's row is on the clearance row. */
      const points = pts.filter((p, i) => i === 0 || p.x !== pts[i - 1]!.x || p.y !== pts[i - 1]!.y);
      return { points, rawEnd: target.at, nb };
    }
  }
  return undefined;
}

/**
 * An arc beside a column: out of one card's side, back in on the same side of the other.
 *
 * Tried right first, then left, and only kept when the whole curve misses every other card. The
 * arms reach a fixed fraction of the drop so a long arc bows wider than a short one, and never
 * less than the router's minimum reach, so the curve clears its own card's corner.
 */
function sideArc(
  a: RouteNode,
  b: RouteNode,
  e: Edge,
  tailInset: number,
  headInset: number,
  obstacles: RouteNode[],
  m: ThemeMetric,
): { spine: Extract<Spine, { kind: "cubic" }>; rawStart: Point; rawEnd: Point; n: Point } | undefined {
  /* Only for two cards that really share a column. Two that merely overlap by a margin got an
     arc from the left of one to the left of the other — a diagonal S with its label off the line. */
  const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  if (overlap < Math.min(a.w, b.w) * 0.75) return undefined;
  for (const side of ["right", "left"] as const) {
    const n = NORMAL[side];
    const on = (o: RouteNode, p: Point) => meet(o, side, p);
    const rawStart = on(a, pointAt(a, side, 0.5));
    const rawEnd = on(b, pointAt(b, side, 0.5));
    const p0 = { x: rawStart.x + n.x * tailInset, y: rawStart.y };
    const p3 = { x: rawEnd.x + n.x * headInset, y: rawEnd.y };
    /* Wider for a longer drop, so a tall arc does not hug the column, but capped: an arc that
       swings out with the whole drop reaches the actor standing beside the system and fails on
       both sides, and the fallback dogleg round the column is worse than a tighter arc. */
    const reach = Math.min(m.edge.reach.max / 2, Math.max(m.edge.reach.min, Math.abs(p3.y - p0.y) * m.edge.reach.across));
    const spine = {
      kind: "cubic" as const,
      p0,
      p1: { x: p0.x + n.x * reach, y: p0.y },
      p2: { x: p3.x + n.x * reach, y: p3.y },
      p3,
    };
    if (!firstHit(spine, obstacles)) return { spine, rawStart, rawEnd, n };
  }
  void e;
  return undefined;
}

function bowClear(
  base: Extract<Spine, { kind: "cubic" }>,
  obstacles: RouteNode[],
  m: ThemeMetric,
): Extract<Spine, { kind: "cubic" }> {
  const blocker = firstHit(base, obstacles);
  if (!blocker) return base;

  const dx = base.p3.x - base.p0.x;
  const dy = base.p3.y - base.p0.y;
  const len = Math.hypot(dx, dy) || 1;
  /* Unit normal of the chord. Bowing along it moves the middle of the curve without touching either
     anchor, so a row keeps its edge (rule 9) and a marker keeps its angle. */
  const nx = -dy / len;
  const ny = dx / len;

  const step = m.grid * 2;

  const mid = { x: (base.p0.x + base.p3.x) / 2, y: (base.p0.y + base.p3.y) / 2 };

  /* One arc, tried outwards from the smallest that could help, the side the obstacle is not on
     first. The curve bows; it does not wriggle. Pushing the two control points *independently*
     would give an S that can dodge twice, and was tried — it clears more obstacles on paper and
     draws worse, because most of what it buys is a route that grazes a corner instead of crossing
     it. Where one arc cannot get past, the answer is not a cleverer curve but a different side to
     leave from, and choosing sides against obstacles is a candidates-and-cost model
     deliberately not built yet. */
  const away =
    (blocker.x + blocker.w / 2 - mid.x) * nx + (blocker.y + blocker.h / 2 - mid.y) * ny > 0 ? -1 : 1;

  /* How far to try. A cubic with both arms pushed by `p` moves its middle by 0.75·p, and the
     blocker is at least the chord's distance from one of its edges — so a fixed dozen steps
     (144px of bow) cleared a plain card and gave up on any card with rows in it, which is
     `arch`'s whole vocabulary: a cross-group edge from a row went straight through the neighbour
     between it and its target, and every hoisted edge is one ELK did not route around anything
     for. The ceiling is the blocker's own extent, so the search stops as soon as a bow *could*
     clear it and never draws a curve wider than the card it is avoiding — its extent *along the
     normal*, since a wide pill in the way of a near-horizontal chord is only as tall as it is
     tall, and measuring its width sent a bow over the diagram's title. */
  const extent = Math.abs(blocker.w * nx) + Math.abs(blocker.h * ny) + m.grid * 2;
  const steps = Math.max(12, Math.ceil(extent / 0.75 / step));
  for (let k = 1; k <= steps; k++) {
    for (const sign of [away, -away]) {
      const push = sign * k * step;
      const bowed = {
        ...base,
        p1: { x: base.p1.x + nx * push, y: base.p1.y + ny * push },
        p2: { x: base.p2.x + nx * push, y: base.p2.y + ny * push },
      };
      if (!firstHit(bowed, obstacles)) return bowed;
    }
  }
  return base;
}

/** The first box the curve passes through, sampled finely enough that no card is stepped over. */
function firstHit(
  spine: Extract<Spine, { kind: "cubic" }>,
  obstacles: RouteNode[],
  margin = 0,
): RouteNode | undefined {
  const { p0, p1, p2, p3 } = spine;
  const rough = Math.hypot(p3.x - p0.x, p3.y - p0.y) + Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const steps = Math.max(24, Math.ceil(rough / 8));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
    const y = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
    for (const o of obstacles) {
      if (x > o.x - margin && x < o.x + o.w + margin && y > o.y - margin && y < o.y + o.h + margin) return o;
    }
  }
  return undefined;
}

/**
 * The order a fan puts its anchors in: by where the far end lies, and — where two anchors point at
 * the same card, so the angle cannot tell them apart — mirrored between the two ends.
 *
 * Two edges between one pair of cards (`a --> b` and `b --> a`, the commonest loop a state machine
 * has) tie exactly on `key` at both ends, and a stable sort then kept the order they were written
 * in on *each* card. Every side is traversed clockwise, so two facing sides run in opposite
 * directions, and the same order on both put each edge's ends on opposite halves: the pair crossed
 * in the gap between the cards, an X with a label at the middle of each stroke. Curves
 * that do not cross meet the two boundaries in opposite clockwise orders, so the tie is broken by
 * the input order on the card whose id sorts first and by its reverse on the other — the same
 * answer from both ends without either knowing what the other decided.
 */
function fanOrder(p: Anchor, q: Anchor): number {
  const by = p.key - q.key;
  if (Math.abs(by) > 1e-9) return by;
  if (p.other !== q.other) return p.order - q.order;
  return (p.node < p.other ? 1 : -1) * (p.order - q.order);
}

/**
 * Which way is *out* of a bundle, for each edge in one: two or more edges joining the same pair of
 * cards, which the fan draws side by side. A label on the line's default side — right of a vertical
 * run, above a horizontal one — lands on its neighbour in a bundle, so each goes on the side away
 * from the others, and the two labels of a loop read as belonging to one stroke each. An edge at the
 * bundle's middle, and every edge outside a bundle, gets no answer and keeps the default.
 */
function bundleOutward(
  live: RouteInput["edges"],
  at: (id: string) => { from: { x: number; y: number }; to: { x: number; y: number } } | undefined,
): Map<string, { x: number; y: number }> {
  const bundles = new Map<string, string[]>();
  for (const e of live) {
    if (e.from.node === e.to.node || !e.label) continue;
    const key = [e.from.node, e.to.node].sort().join("\0");
    const list = bundles.get(key);
    if (list) list.push(e.id);
    else bundles.set(key, [e.id]);
  }
  const out = new Map<string, { x: number; y: number }>();
  for (const ids of bundles.values()) {
    if (ids.length < 2) continue;
    const mids = ids.flatMap((id) => {
      const ends = at(id);
      return ends ? [{ id, x: (ends.from.x + ends.to.x) / 2, y: (ends.from.y + ends.to.y) / 2 }] : [];
    });
    if (mids.length < 2) continue;
    const cx = mids.reduce((s, p) => s + p.x, 0) / mids.length;
    const cy = mids.reduce((s, p) => s + p.y, 0) / mids.length;
    for (const p of mids) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      if (Math.hypot(dx, dy) >= 1) out.set(p.id, { x: dx, y: dy });
    }
  }
  return out;
}

/**
 * How far the routed labels reach on every side — the part of a drawing no box accounts for.
 *
 * A label beside a vertical run starts `labelOffset` right of the line and runs on from there, so on
 * a diagram one card wide its text ends well past the card, and a size taken from the boxes alone
 * put the frame's edge through the middle of it (where "further reduction loses meaning"
 * was cut by the border it overhung). A bundle's outer label hangs *left* of its stroke
 * (`bundleOutward`), so the left and top are reported too: past the origin it is drawn outside the
 * item, and `content-visibility` clips it there — "report the status back" came out ":he status back".
 */
export function labelReach(
  edges: RoutedEdge[],
  labels: Record<string, { w: number; h: number }>,
): { left: number; top: number; right: number; bottom: number } {
  let left = 0;
  let top = 0;
  let right = 0;
  let bottom = 0;
  for (const e of edges) {
    if (!e.label) continue;
    const size = labels[e.id];
    if (!size) continue;
    const x0 = e.label.anchor === "start" ? e.label.x : e.label.anchor === "end" ? e.label.x - size.w : e.label.x - size.w / 2;
    /* `y` is the baseline of the last line, and a second line stacks above it (`labelFor`'s lift). */
    const mid = e.label.y - (e.label.text2 ? size.h / 4 : 0);
    left = Math.min(left, x0);
    top = Math.min(top, mid - size.h / 2);
    right = Math.max(right, x0 + size.w);
    bottom = Math.max(bottom, mid + size.h / 2);
  }
  return { left, top, right, bottom };
}

/**
 * How far the drawn lines reach on every side — what `labelReach` is to the labels.
 *
 * A layout that places its boxes and then routes between them knows where the boxes are and not
 * where the lines went: a back edge along a row of a sketch bows above the row, past the top of
 * every box, and a frame sized from the boxes cut the bow off with the label on it. This
 * reads the path the router wrote, whose grammar is its own and closed — absolute `M`, `L`, `C`
 * and `Q`, from `pathOf` and `roundedPolyline` — and samples each curve, since a cubic's control
 * points reach further than the curve does and a frame grown to them would be grown for nothing.
 */
export function routeReach(edges: RoutedEdge[]): { left: number; top: number; right: number; bottom: number } {
  let left = 0;
  let top = 0;
  let right = 0;
  let bottom = 0;
  const take = (x: number, y: number) => {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  };
  const STEPS = 16;
  for (const e of edges) {
    let cur = { x: 0, y: 0 };
    for (const m of e.d.matchAll(/([MLCQ])([^MLCQ]*)/g)) {
      const n = m[2]!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      const end = { x: n[n.length - 2]!, y: n[n.length - 1]! };
      if (m[1] === "C" || m[1] === "Q") {
        const ps = [cur];
        for (let i = 0; i + 1 < n.length; i += 2) ps.push({ x: n[i]!, y: n[i + 1]! });
        for (let s = 1; s < STEPS; s++) {
          /* De Casteljau, which is the same arithmetic for a quadratic and a cubic. */
          let pts = ps;
          const t = s / STEPS;
          while (pts.length > 1) pts = pts.slice(1).map((p, i) => ({ x: pts[i]!.x + (p.x - pts[i]!.x) * t, y: pts[i]!.y + (p.y - pts[i]!.y) * t }));
          take(pts[0]!.x, pts[0]!.y);
        }
      }
      take(end.x, end.y);
      cur = end;
    }
  }
  return { left, top, right, bottom };
}

export function routeEdges(input: RouteInput): RoutedEdge[] {
  const { nodes, edges, metric: m } = input;
  const anchors: Anchor[] = [];
  const live = edges.filter((e) => nodes[e.from.node] && nodes[e.to.node]);
  const obstacles = Object.values(nodes).filter((n) => !n.isGroup);

  for (const [order, e] of live.entries()) {
    const a = nodes[e.from.node]!;
    const b = nodes[e.to.node]!;

    if (e.from.node === e.to.node) {
      /* A self-loop arcs out of the top and back into it. Two fixed points rather than a fan: with
         one edge the fan would put both at the centre and the loop would have no width. */
      anchors.push({ edge: e.id, end: "from", node: a.id, side: "top", key: 0, other: a.id, order, t: m.edge.selfLoop.t0 });
      anchors.push({ edge: e.id, end: "to", node: a.id, side: "top", key: 0, other: a.id, order, t: m.edge.selfLoop.t1 });
      continue;
    }

    const fromSide = sideToward(a, b);
    const toSide = sideToward(b, a);
    const ca = centre(a);
    const cb = centre(b);

    /* A row anchor only holds on a horizontal exit: a row is a horizontal band, so its y is
       meaningful on the left and right edges and says nothing about where to leave the bottom.
       Going down, the row joins the fan like any other edge. */
    const fromRowY = e.from.row !== undefined ? a.rows[e.from.row] : undefined;
    const toRowY = e.to.row !== undefined ? b.rows[e.to.row] : undefined;

    anchors.push({
      edge: e.id,
      end: "from",
      node: a.id,
      side: fromSide,
      key: wrapPi(Math.atan2(cb.y - ca.y, cb.x - ca.x) - SIDE_ANGLE[fromSide]),
      other: b.id,
      order,
      t: 0.5,
      fixed:
        fromRowY !== undefined && (fromSide === "left" || fromSide === "right")
          ? { x: fromSide === "right" ? a.x + a.w : a.x, y: fromRowY }
          : undefined,
    });
    anchors.push({
      edge: e.id,
      end: "to",
      node: b.id,
      side: toSide,
      key: wrapPi(Math.atan2(ca.y - cb.y, ca.x - cb.x) - SIDE_ANGLE[toSide]),
      other: a.id,
      order,
      t: 0.5,
      fixed:
        toRowY !== undefined && (toSide === "left" || toSide === "right")
          ? { x: toSide === "right" ? b.x + b.w : b.x, y: toRowY }
          : undefined,
    });
  }

  /* Fan: every anchor sharing a node and a side spreads across the middle of it, ordered by where
     its far end lies. Incoming and outgoing share the group — an edge in and an edge out on the
     same side should not land on the same point. */
  const groups = new Map<string, Anchor[]>();
  for (const a of anchors) {
    if (a.fixed) continue;
    const key = `${a.node}\0${a.side}`;
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }
  for (const list of groups.values()) {
    if (list.length === 1) continue;
    list.sort(fanOrder);
    const span = m.edge.fanSpan;
    list.forEach((a, i) => {
      a.t = 0.5 - span / 2 + (span * (i + 0.5)) / list.length;
    });
  }

  const byEdge = new Map<string, { from?: Anchor; to?: Anchor }>();
  for (const a of anchors) {
    const slot = byEdge.get(a.edge) ?? {};
    slot[a.end] = a;
    byEdge.set(a.edge, slot);
  }

  const outward = bundleOutward(live, (id) => {
    const slot = byEdge.get(id);
    const e = live.find((x) => x.id === id);
    if (!slot?.from || !slot.to || !e) return undefined;
    return {
      from: slot.from.fixed ?? pointAt(nodes[e.from.node]!, slot.from.side, slot.from.t),
      to: slot.to.fixed ?? pointAt(nodes[e.to.node]!, slot.to.side, slot.to.t),
    };
  });

  const out: RoutedEdge[] = [];

  for (const e of live) {
    const slot = byEdge.get(e.id);
    if (!slot?.from || !slot.to) continue;
    const a = nodes[e.from.node]!;
    const b = nodes[e.to.node]!;

    let rawStart = slot.from.fixed ?? pointAt(a, slot.from.side, slot.from.t);
    let rawEnd = slot.to.fixed ?? pointAt(b, slot.to.side, slot.to.t);
    /* A shape is met at its outline. The anchor keeps its place along the side, so a fan is still
       a fan, and moves in along the side's normal — which is also the direction the curve leaves
       in, so nothing downstream has to know it moved. */
    if (!slot.from.fixed) rawStart = meet(a, slot.from.side, rawStart);
    if (!slot.to.fixed) rawEnd = meet(b, slot.to.side, rawEnd);

    let nb = NORMAL[slot.to.side];
    const inset = markerInset(e.head, m);
    let end = { x: rawEnd.x + nb.x * inset, y: rawEnd.y + nb.y * inset };

    /* The line starts where a tail marker ends, as it stops where a head marker begins — or a
       hollow diamond has the line drawn through it. */
    let na = NORMAL[slot.from.side];
    const tailInset = markerInset(e.tail, m);
    let start = { x: rawStart.x + na.x * tailInset, y: rawStart.y + na.y * tailInset };
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    const bends = usableBends(input.bends[e.id], start, slot.from.side, end, slot.to.side);
    const via = input.via?.[e.id];
    let spine: Spine;

    if (via) {
      /* The line goes through the point, exactly, and stays a curve.
         A quadratic through `via` at its own halfway mark is `2·via − (p0 + p3)/2`, and elevating
         it to a cubic is what keeps one spine type for the whole router — `pathOf`, `pointOn`,
         `labelFor` and the marker angles all read a cubic already and none of them had to learn a
         third shape. Two straight legs would have been the cheaper drawing and the wrong one: a
         board of S-curves with one elbow in it reads as two diagrams. */
      const c = { x: 2 * via.x - (start.x + end.x) / 2, y: 2 * via.y - (start.y + end.y) / 2 };
      spine = {
        kind: "cubic",
        p0: start,
        p1: { x: start.x + (2 / 3) * (c.x - start.x), y: start.y + (2 / 3) * (c.y - start.y) },
        p2: { x: end.x + (2 / 3) * (c.x - end.x), y: end.y + (2 / 3) * (c.y - end.y) },
        p3: end,
      };
    } else if (e.from.node === e.to.node) {
      const reach = m.edge.selfLoop.reach;
      spine = {
        kind: "cubic",
        p0: start,
        p1: { x: start.x, y: start.y - reach },
        p2: { x: end.x, y: end.y - reach },
        p3: end,
      };
    } else if (bends && bends.length > 2) {
      /* ELK went around something. Its polyline is the only route that misses the obstacle, so keep
         it — but round the corners, because a right angle in a board of S-curves reads as a
         different diagram. */
      spine = { kind: "polyline", points: [start, ...bends, end] };
    } else {
      /*
       * Two sides that face each other share an axis, and on that axis the two control arms are
       * competing for the same gap. The default reach does not know that: its floor is 56px, an
       * ERD stacks cards `rowGap` apart, which is 32, and 112px of arm in a 32px gap sends each
       * control point past the other one. The curve doubles back through itself and a connector
       * that should read as a short straight hop comes out as a wiggle.
       *
       * So scale both arms back until they meet at most in the middle. Scale rather than clamp,
       * because the ratio between the two is the shape — an edge leaving a wide card for a narrow
       * one should still lean the way it leaned.
       */
      const facing = na.x * nb.x + na.y * nb.y < 0;
      const reachA = reachOf(na, dx, dy, m);
      const reachB = reachOf(nb, -dx, -dy, m);
      const gap = Math.abs(na.x !== 0 ? dx : dy);
      const squeeze = facing && reachA + reachB > gap ? gap / (reachA + reachB) : 1;
      const ra = reachA * squeeze;
      const rb = reachB * squeeze;
      const others = obstacles.filter((o) => o.id !== e.from.node && o.id !== e.to.node);
      const bowed = bowClear(
        {
          kind: "cubic",
          p0: start,
          p1: { x: start.x + na.x * ra, y: start.y + na.y * ra },
          p2: { x: end.x + nb.x * rb, y: end.y + nb.y * rb },
          p3: end,
        },
        others,
        m,
      );
      /* A bow that could not clear the card in the way is still drawn through it. That is the
         edge from a row port to a target two layers over: the neighbour starts 24px from the
         anchor, and no curve leaving horizontally from a fixed point rises fast enough. What
         gets past it is a dogleg — the shape ELK itself would have routed had the edge not been
         hoisted out of its sight. */
      const blocker = firstHit(bowed, others);
      const arc = blocker && na.x === 0 && nb.x === 0 ? sideArc(a, b, e, tailInset, inset, others, m) : undefined;
      if (arc) {
        /* Two cards in one column with a third between them: the line leaves one side and comes
           back in on the same side of the other, the way an «include» is drawn beside a column
           of use cases — never through the pill between them, never round the whole box. */
        spine = arc.spine;
        rawStart = arc.rawStart;
        na = arc.n;
        start = arc.spine.p0;
        rawEnd = arc.rawEnd;
        nb = arc.n;
        end = arc.spine.p3;
      } else if (blocker) {
        /* The side the fan chose for the target faces the source, which is also the side the
           blocker is on; a detour may do better coming in from the target's own near side, at
           the row if the edge names one. */
        const altSide: Side = na.x > 0 ? "left" : na.x < 0 ? "right" : na.y > 0 ? "top" : "bottom";
        const toRowY = e.to.row !== undefined ? b.rows[e.to.row] : undefined;
        const alt =
          slot.to.side === altSide
            ? undefined
            : {
                side: altSide,
                at:
                  toRowY !== undefined && na.x !== 0
                    ? { x: altSide === "left" ? b.x : b.x + b.w, y: toRowY }
                    : meet(b, altSide, pointAt(b, altSide, 0.5)),
              };
        const around = detour(start, na, { side: slot.to.side, at: rawEnd }, alt, inset, blocker, others, m);
        if (around) {
          spine = { kind: "polyline", points: around.points };
          rawEnd = around.rawEnd;
          nb = around.nb;
          end = around.points[around.points.length - 1]!;
        } else spine = bowed;
      } else spine = bowed;
    }

    const d = pathOf(spine, m.edge.corner);

    /*
     * A bent line arrives from wherever the bend put it, so its markers have to read the curve
     * rather than the side they anchored on.
     *
     * Everywhere else the two agree by construction: the control arms leave along the outward
     * normal, so the tangent at either end *is* that normal, and `nb` is the cheaper way to say
     * so — and where a detour or a side arc changed the route it also reassigned `nb`, which is
     * why this is not simply made uniform. Only the `via` branch leaves the two able to disagree,
     * and an arrowhead pointing along a side the line no longer comes in on is the one thing a
     * reader would notice about it.
     */
    /* A cubic's tangent at an end is `3·(p1−p0)`, which is zero when the control point sits on the
       end itself — here, exactly when the bend is dragged to a quarter of the way along the chord
       from one side. `atan2(0, 0)` is 0 rather than `NaN`, so nothing breaks and the arrowhead
       simply points east, which is the kind of defect that survives a suite. Step a hundredth in
       when that happens; the chord is the last resort and cannot itself be zero, since the two
       anchors are on two different boxes. */
    const heading = (u: number) => {
      for (const at of [u, u === 1 ? 0.99 : 0.01]) {
        const t = pointOn(spine, at).tangent;
        if (Math.abs(t.x) + Math.abs(t.y) > 1e-6) return t;
      }
      return { x: end.x - start.x, y: end.y - start.y };
    };
    const t1 = via ? heading(1) : null;
    const t0 = via ? heading(0) : null;

    const head: MarkerAt | undefined =
      e.head === "none"
        ? undefined
        : {
            kind: e.head,
            x: rawEnd.x,
            y: rawEnd.y,
            angle: t1 ? Math.atan2(t1.y, t1.x) : Math.atan2(-nb.y, -nb.x),
            surface: b.surface === "group" ? "group" : "paper",
          };
    const tail: MarkerAt | undefined =
      e.tail === "none"
        ? undefined
        : {
            kind: e.tail,
            x: rawStart.x,
            y: rawStart.y,
            /* Into the card, as the head's is: a marker is drawn with its tip at the origin and
               its body along -x, so +x has to point at the card for the body to lie along the
               edge. With the outward normal the composition diamond was drawn *inside* its
               card, under it, and every \`*--\` in every class diagram had no diamond at all. */
            angle: t0 ? Math.atan2(-t0.y, -t0.x) : Math.atan2(-na.y, -na.x),
            surface: a.surface === "group" ? "group" : "paper",
          };

    out.push({
      id: e.id,
      d,
      mid: pointOn(spine, 0.5).at,
      hue: e.hue,
      dash: e.dash,
      quiet: e.quiet,
      danger: e.danger === true,
      head,
      tail,
      label: e.label
        ? labelFor(
            spine,
            e.label,
            e.label2,
            m,
            a.surface,
            input.labels?.[e.id] ?? { w: e.label.length * m.edge.labelOffset, h: m.edge.labelOffset },
            obstacles,
            outward.get(e.id),
          )
        : undefined,
    });
  }

  /* One statement, one label. `a & b & c --> d "reject"` is three edges sharing a `bus` id, and
     each carried its own copy of the label — three "reject"s converging on one card, which reads
     as three different events. The family keeps one, on the edge of median chord length: the
     middle of the fan, where the others run beside it. (The collector with a junction dot the
     header promises is still not built; this is the half of it a reader notices.) */
  const families = new Map<string, { id: string; len: number }[]>();
  for (const e of live) {
    if (!e.bus || !e.label) continue;
    const r = out.find((o) => o.id === e.id);
    if (!r?.label) continue;
    const a = nodes[e.from.node]!;
    const b = nodes[e.to.node]!;
    const ca = centre(a);
    const cb = centre(b);
    const list = families.get(e.bus) ?? [];
    list.push({ id: e.id, len: Math.hypot(cb.x - ca.x, cb.y - ca.y) });
    families.set(e.bus, list);
  }
  for (const list of families.values()) {
    if (list.length < 2) continue;
    list.sort((p, q) => p.len - q.len);
    const keep = list[Math.floor((list.length - 1) / 2)]!.id;
    for (const { id } of list) if (id !== keep) delete out.find((o) => o.id === id)!.label;
  }

  if (input.labels) separateLabels(out, input.labels, m.edge.labelOffset);

  return out;
}

/**
 * The curve an edge is actually drawn as.
 *
 * It exists so that the path and its label cannot disagree. They used to: the label was always
 * placed at the midpoint of the S-curve, computed from the two boundary normals, even when the edge
 * had taken the ELK branch and been drawn as a polyline around an obstacle. On those edges the
 * label sat on a curve that was never drawn — sometimes most of the way across the diagram from its
 * own line. `pathOf` and `labelFor` now read the same value.
 */
type Point = { x: number; y: number };
type Spine = { kind: "cubic"; p0: Point; p1: Point; p2: Point; p3: Point } | { kind: "polyline"; points: Point[] };

function pathOf(spine: Spine, corner: number): string {
  if (spine.kind === "polyline") return roundedPolyline(spine.points, corner);
  const { p0, p1, p2, p3 } = spine;
  return (
    `M${r1(p0.x)},${r1(p0.y)} ` +
    `C${r1(p1.x)},${r1(p1.y)} ` +
    `${r1(p2.x)},${r1(p2.y)} ` +
    `${r1(p3.x)},${r1(p3.y)}`
  );
}

/** Where the curve is halfway along, and which way it is heading there. */
function pointOn(spine: Spine, u: number): { at: Point; tangent: Point } {
  if (spine.kind === "cubic") {
    const { p0, p1, p2, p3 } = spine;
    const v = 1 - u;
    return {
      at: {
        x: v * v * v * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u * u * u * p3.x,
        y: v * v * v * p0.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u * u * u * p3.y,
      },
      /* B'(0.5) = 0.75(P1-P0) + 1.5(P2-P1) + 0.75(P3-P2). The previous version weighted all three
         terms at 0.75, which is not the derivative of anything; it only ever fed a
         more-horizontal-than-vertical test, so the error stayed invisible until a curve was close
         to diagonal. */
      tangent: {
        x: 3 * v * v * (p1.x - p0.x) + 6 * v * u * (p2.x - p1.x) + 3 * u * u * (p3.x - p2.x),
        y: 3 * v * v * (p1.y - p0.y) + 6 * v * u * (p2.y - p1.y) + 3 * u * u * (p3.y - p2.y),
      },
    };
  }

  /* Half the way along the polyline by arc length, which is where a reader's eye lands — not the
     middle vertex, which on an L-shaped dodge is the corner. */
  const pts = spine.points;
  const segments = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y));
  const half = segments.reduce((a, b) => a + b, 0) * u;
  let walked = 0;
  for (let i = 0; i < segments.length; i++) {
    const len = segments[i]!;
    if (walked + len >= half && len > 0) {
      const t = (half - walked) / len;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      return {
        at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        tangent: { x: b.x - a.x, y: b.y - a.y },
      };
    }
    walked += len;
  }
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  return { at: a, tangent: { x: b.x - a.x, y: b.y - a.y } };
}

/**
 * A label beside its line, never on it.
 *
 * The chip-on-the-line version was tried on the artboards and pulled: at 10px the chip's own
 * padding is as wide as the gap it sits in, and every one had to be nudged by hand. Bare text
 * offset along the curve's normal needs no background and no nudging.
 */
/**
 * The label, on its own line, at the point nearest the middle that is not on top of a card.
 *
 * The middle of the line is where a reader looks, so that is where it starts — but an edge whose
 * middle happens to pass a card leaves ten pixels of mono type sitting on the card's border, which
 * is unreadable in a way a slightly-off-centre label is not. `separateLabels` cannot fix it: that
 * pass pushes a label *off* its line to clear another label, and pushing far enough to clear a card
 * would leave it belonging to nothing. Sliding along the spine keeps the label exactly as far from
 * its own line as it ever was, which is what the drift check in `route-quality` exists to hold.
 */
function labelFor(
  spine: Spine,
  text: string,
  text2: string | undefined,
  m: ThemeMetric,
  surface: "paper" | "group",
  size: { w: number; h: number },
  obstacles: RouteNode[],
  /** Away from the other edges of a bundle (`bundleOutward`): the side of the line to put it on. */
  outward?: { x: number; y: number },
): RoutedEdge["label"] {
  /* `y` is the baseline of the last line; a second line stacks above it, so the block's centre
     sits half a line higher than the anchor. */
  const lift = text2 ? size.h / 4 : 0;
  const place = (u: number) => {
    const { at, tangent } = pointOn(spine, u);
    /* Offset perpendicular to the line rather than to the chord. Above a horizontal run and right
       of a vertical one, unless the bundle this edge is in says the other side is outside it. */
    const horizontal = Math.abs(tangent.x) >= Math.abs(tangent.y);
    if (horizontal) {
      /* Below the line, the block's top has to clear it: a second line stacks upwards from `y`. */
      const y = outward && outward.y > 0 ? at.y + m.edge.labelOffset + lift * 2 : at.y - m.edge.labelOffset;
      return { x: at.x, y, text, text2, anchor: "middle" as const, surface };
    }
    return outward && outward.x < 0
      ? { x: at.x - m.edge.labelOffset, y: at.y, text, text2, anchor: "end" as const, surface }
      : { x: at.x + m.edge.labelOffset, y: at.y, text, text2, anchor: "start" as const, surface };
  };

  /* Where the block's middle is, whichever end of it `x` names. */
  const centreX = (l: { x: number; anchor: "start" | "middle" | "end" }) =>
    l.anchor === "start" ? l.x + size.w / 2 : l.anchor === "end" ? l.x - size.w / 2 : l.x;
  const clear = (l: { x: number; y: number; anchor: "start" | "middle" | "end" }) =>
    !obstacles.some(
      (o) =>
        Math.abs(centreX(l) - (o.x + o.w / 2)) * 2 < size.w + o.w &&
        Math.abs(l.y - lift - (o.y + o.h / 2)) * 2 < size.h + o.h,
    );

  const middle = place(0.5);
  if (clear(middle)) return middle;

  /* Outwards from the middle in both directions, stopping well short of either end so the label
     never reads as belonging to the card it points at. */
  for (let step = 1; step <= 6; step++) {
    for (const u of [0.5 - step * 0.06, 0.5 + step * 0.06]) {
      const candidate = place(u);
      if (clear(candidate)) return candidate;
    }
  }
  return middle;
}

function roundedPolyline(raw: { x: number; y: number }[], radius: number): string {
  /* A zero-length leg divides by its own length and writes \`NaN\` into the path — the browser
     then draws nothing and logs an error naming no edge. A dogleg whose target row sits exactly
     on its clearance row produces one; so would any two coincident points. */
  const points = raw.filter((p, i) => i === 0 || Math.abs(p.x - raw[i - 1]!.x) > 1e-6 || Math.abs(p.y - raw[i - 1]!.y) > 1e-6);
  if (points.length < 3) return `M${r1(points[0]!.x)},${r1(points[0]!.y)} L${r1(points[points.length - 1]!.x)},${r1(points[points.length - 1]!.y)}`;
  let d = `M${r1(points[0]!.x)},${r1(points[0]!.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const a = { x: cur.x + ((prev.x - cur.x) / inLen) * r, y: cur.y + ((prev.y - cur.y) / inLen) * r };
    const c = { x: cur.x + ((next.x - cur.x) / outLen) * r, y: cur.y + ((next.y - cur.y) / outLen) * r };
    d += ` L${r1(a.x)},${r1(a.y)} Q${r1(cur.x)},${r1(cur.y)} ${r1(c.x)},${r1(c.y)}`;
  }
  const last = points[points.length - 1]!;
  d += ` L${r1(last.x)},${r1(last.y)}`;
  return d;
}
