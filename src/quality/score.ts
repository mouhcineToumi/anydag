import type { Graph } from "@/dsl/ir";
import type { Placed } from "@/layout/types";
import type { Theme } from "@/theme/contract";

import { crossingCount, flatten, meetsRect, overlaps, type Rect, type Segment } from "./geometry";
import { QUALITY_CODES, type QualityCode } from "./codes";

/**
 * What a good set of edges looks like, as a number — and as a list of what to look at.
 *
 * The router makes one deterministic choice per edge and that is the answer: there is no search, no
 * scoring, and nothing that notices when a change makes three boards quietly worse. There are no
 * candidate routes to weigh a good edge against, but a good edge being a *measurable* thing is
 * worth taking anyway.
 *
 * Two consumers, one implementation, which is the whole reason this is a module rather than a
 * closure in a test:
 *
 * - `test/route-quality.test.ts` sums the totals over the reference boards and freezes them, so a
 *   router change that makes three boards worse fails rather than passing quietly.
 * - `DiagramItem` scores the board on screen and publishes the findings, so the board someone just
 *   wrote — the one nobody will ever write an expectation for — reports its own defects.
 *
 * The totals are a *record* of what the router achieves, not a target it aims at. The findings are
 * the actionable half: each names the ids involved, because "two edges cross" is useless and
 * "`ingest→index` crosses `api→cache`" is a thing an author can move.
 */

export interface QualityTotals {
  /** Edges crossing other edges. Two edges that share a node are allowed to meet. */
  crossings: number;
  /** Corners. Every one is an ELK dodge; the house curve has none. */
  bends: number;
  /** Segments passing through a node that is not either endpoint — the worst thing a route can do. */
  throughNode: number;
  /** Labels still overlapping after `separateLabels` has had its six pushes. */
  labelOverlaps: number;
  /** Labels sitting on a card. Ten pixels of mono type on a border is not a label. */
  labelOverNode: number;
  /** Cards overlapping cards. Always zero, or a layout is wrong rather than ugly. */
  nodeOverlaps: number;
}

interface Finding {
  code: QualityCode;
  /** The ids involved, in the order that code's doc comment gives them. */
  ids: string[];
}

export interface Quality {
  totals: QualityTotals;
  findings: Finding[];
}

/**
 * The padding `separateLabels` adds around a label before asking whether two collide, and the width
 * it assumes for a label nobody measured. Mirrored rather than shared: `route.ts` is deciding where
 * to put a thing and this is deciding whether it ended up somewhere reasonable, and a checker that
 * imports the constant it is checking against is checking nothing. If those numbers move in
 * `route.ts`, they move here too, deliberately.
 */
const LABEL_PAD_X = 8;
const LABEL_PAD_Y = 6;
const LABEL_PER_CHAR = 6;

/**
 * How finely a route is broken up before it is asked what cards it hits, and how far inside a card
 * counts as being inside it.
 *
 * Both exist because "does this route pass through that card" has two wrong answers either side of
 * it. Sampling the *joints* of a flattened path — which is what this check did while it lived in a
 * test — misses a polyline entirely: a straight run three hundred pixels long is one segment, and
 * a card in the middle of it touches neither end. Asking instead whether any segment *meets* the
 * box catches that, and then catches too much: a curve clipping two pixels of a card's corner is a
 * route through a card by the letter and nothing anyone would redraw.
 *
 * So the box is shrunk by the grid before the question is asked. A route that genuinely crosses a
 * card crosses its middle; one that grazes a corner is the router doing its job in a tight space.
 * At this inset the eleven reference boards score exactly what they scored under joint-sampling,
 * which is the evidence that this is a sharper instrument and not a looser one.
 */
const NODE_STEPS = 64;
/** Odd, so the middle of a curve is never a joint of its flattening — see the crossing pass. */
const PAIR_STEPS = 17;

/** A label's horizontal middle: its `x` is where the text is anchored, which is the middle only for
 *  a `middle` label — one beside a vertical run starts or ends there. */
const middleOf = (l: { x: number; anchor: "start" | "middle" | "end" }, w: number): number =>
  l.anchor === "start" ? l.x + w / 2 : l.anchor === "end" ? l.x - w / 2 : l.x;

export const emptyTotals = (): QualityTotals => ({
  crossings: 0,
  bends: 0,
  throughNode: 0,
  labelOverlaps: 0,
  labelOverNode: 0,
  nodeOverlaps: 0,
});

export function addTotals(into: QualityTotals, more: QualityTotals): QualityTotals {
  into.crossings += more.crossings;
  into.bends += more.bends;
  into.throughNode += more.throughNode;
  into.labelOverlaps += more.labelOverlaps;
  into.labelOverNode += more.labelOverNode;
  into.nodeOverlaps += more.nodeOverlaps;
  return into;
}

export function scoreGraph(
  graph: Graph,
  placed: Placed,
  labels: Record<string, { w: number; h: number }>,
  theme: Theme,
): Quality {
  const totals = emptyTotals();
  const findings: Finding[] = [];

  const paths = new Map<string, Segment[]>();
  for (const e of placed.edges) paths.set(e.id, flatten(e.d));
  /* The node pass is flattened finer than the crossing pass, and pays nothing for it: flattening
     is linear, and it is the *crossing* pass that is quadratic in segments. It needs the accuracy
     more, too — a chord drawn under a convex curve cuts the corner the curve went round, and at
     the default resolution that error is about a pixel on a long edge. */
  const traced = new Map<string, Segment[]>();
  for (const e of placed.edges) traced.set(e.id, flatten(e.d, NODE_STEPS));

  /* Which nodes an edge belongs to, taken from the graph rather than guessed from geometry. An
     earlier version inferred it by looking for a node boundary near each end, which is wrong for
     every edge carrying a marker: `markerInset` pulls the endpoint back by the marker's length, so
     the path stops short of the node it points at and the node reads as a stranger the route
     happens to pass through. */
  const ownersOf = new Map(graph.edges.map((e) => [e.id, new Set([e.from.node, e.to.node])]));
  const boxes: (Rect & { id: string })[] = Object.entries(placed.nodes).map(([id, b]) => ({ id, ...b }));

  const ids = [...paths.keys()];
  const pathOf = new Map(placed.edges.map((e) => [e.id, e.d]));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ownersOf.get(ids[i]!);
      const b = ownersOf.get(ids[j]!);
      /* Sharing a card, two edges meet at it and that is not a crossing. Sharing *both* is the
         exception: the fan puts the pair side by side, so they never have to touch, and a pair
         between the same two cards that crosses anyway is the X a loop drew — which scored
         zero here, being excused on the grounds that its edges share a node. */
      const both = a && b && a.size === 2 && [...a].every((n) => b.has(n));
      if (a && b && !both && [...a].some((n) => b.has(n))) continue;
      /* Flattening means one crossing of two curves can score more than one segment intersection.
         The total keeps that — it is the number the reference boards are frozen on — while the
         finding is said once per pair, which is how many times an author would want to hear it. */
      /* A pair between the same two cards is usually drawn symmetrically, so where it crosses is
         the middle of both curves — a joint of both flattenings, which `crosses` does not count
         as touching. An odd count of steps puts no joint at the middle. */
      const n = both
        ? crossingCount(flatten(pathOf.get(ids[i]!)!, PAIR_STEPS), flatten(pathOf.get(ids[j]!)!, PAIR_STEPS))
        : crossingCount(paths.get(ids[i]!)!, paths.get(ids[j]!)!);
      totals.crossings += n;
      if (n > 0) findings.push({ code: QUALITY_CODES.Q_EDGE_CROSSING, ids: [ids[i]!, ids[j]!] });
    }
  }

  for (const [id, segs] of traced) {
    const own = ownersOf.get(id) ?? new Set<string>();
    for (const b of boxes) {
      if (own.has(b.id)) continue;
      if (segs.some((s) => meetsRect(s, b, theme.metric.grid))) {
        totals.throughNode++;
        findings.push({ code: QUALITY_CODES.Q_EDGE_OVER_NODE, ids: [id, b.id] });
      }
    }
  }

  totals.bends = placed.edges.reduce((n, e) => n + (e.d.match(/Q/g)?.length ?? 0), 0);

  const sizeOf = (id: string, text: string) =>
    labels[id] ?? { w: text.length * LABEL_PER_CHAR, h: theme.metric.edge.labelOffset };

  const placedLabels: (Rect & { id: string })[] = [];
  for (const e of placed.edges) {
    if (!e.label) continue;
    const size = sizeOf(e.id, e.label.text);
    /* `label.x/y` is the text anchor, not a corner. */
    const w = size.w + LABEL_PAD_X;
    const h = size.h + LABEL_PAD_Y;
    const box: Rect = { x: middleOf(e.label, size.w) - w / 2, y: e.label.y - h / 2, w, h };
    const hit = placedLabels.find((p) => overlaps(p, box));
    if (hit) {
      totals.labelOverlaps++;
      findings.push({ code: QUALITY_CODES.Q_LABEL_OVERLAP, ids: [e.id, hit.id] });
    }
    placedLabels.push({ id: e.id, ...box });
  }

  for (const e of placed.edges) {
    if (!e.label) continue;
    const size = sizeOf(e.id, e.label.text);
    const box: Rect = { x: middleOf(e.label, size.w) - size.w / 2, y: e.label.y - size.h / 2, w: size.w, h: size.h };
    const hit = boxes.find((b) => overlaps(b, box));
    if (hit) {
      totals.labelOverNode++;
      findings.push({ code: QUALITY_CODES.Q_LABEL_OVER_NODE, ids: [e.id, hit.id] });
    }
  }

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (!overlaps(a, b)) continue;
      totals.nodeOverlaps++;
      findings.push({ code: QUALITY_CODES.Q_NODE_OVERLAP, ids: [a.id, b.id] });
    }
  }

  /* What is drawn past the item's box is drawn where nobody sees it. The frame's own padding is
     still the item's, so that much overhang is drawn; past it, the page clips. A finding and no
     total: the totals are frozen per reference board, and none of them reaches past its frame. */
  const slack = theme.metric.frame.barePad;
  const outside = (x: number, y: number) => x < -slack || y < -slack || x > placed.size.w + slack || y > placed.size.h + slack;
  for (const e of placed.edges) {
    const segs = paths.get(e.id) ?? [];
    let out = segs.some((s) => outside(s.a.x, s.a.y) || outside(s.b.x, s.b.y));
    if (!out && e.label) {
      const size = sizeOf(e.id, e.label.text);
      const x = middleOf(e.label, size.w) - size.w / 2;
      const y = e.label.y - size.h / 2;
      out = outside(x, y) || outside(x + size.w, y + size.h);
    }
    if (out) findings.push({ code: QUALITY_CODES.Q_EDGE_OUTSIDE, ids: [e.id] });
  }

  /* The layout knows which boxes are narrower than their words; it measured both. */
  for (const id of placed.clipped ?? []) findings.push({ code: QUALITY_CODES.Q_TEXT_CLIPPED, ids: [id] });

  return { totals, findings };
}
