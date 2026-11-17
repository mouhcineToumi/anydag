import type { Graph } from "@/dsl/ir";
import type { ThemeMetric } from "@/theme/contract";

import { labelReach, type Reach, routeEdges, routeReach, type RouteNode } from "./route";
import type { Placed, SizedNode } from "./types";

/**
 * Lane layout for `flow` and `activity` — **deliberately not ELK**.
 *
 * A swimlane diagram has two independent axes: the column is how far along the flow you are, and
 * the band is who does it. ELK's layered algorithm owns the first and has no concept of the second;
 * its `partitioning` option orders layers *along* the flow, not bands across it, and forcing it
 * produces a diagram where lanes interleave.
 *
 * Sixty lines of longest-path layering gets the columns exactly right, keeps the one-node-per-
 * column rhythm the hand-drawn workflow board has, and is deterministic without an option to tune.
 */
export function layoutLanes(
  graph: Graph,
  sizes: Record<string, SizedNode>,
  metric: ThemeMetric,
  labels?: Record<string, { w: number; h: number }>,
): Placed {
  const m = metric;
  const nodes = graph.nodes;
  const sizeOf = (id: string): SizedNode => sizes[id] ?? { w: m.node.stepW, h: m.node.stepH, rowY: [] };

  /* Column = longest path from any node nothing points at. Longest rather than shortest so a fork's
     three branches land in one column and the join after them lands past the deepest of the three,
     which is what "nothing continues until all of it finishes" looks like. */
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (e.from.node === e.to.node) continue;
    outgoing.get(e.from.node)?.push(e.to.node);
    incoming.get(e.to.node)?.push(e.from.node);
  }

  /* A cycle (a flow's retry loop, a state machine's re-screen) has no longest path. Break it
     first: walk forward from every root in declaration order, and an edge into a node still on
     the stack is the loop's back edge. Dropping those from `incoming` leaves a DAG in which the
     loop's body sits *after* its entry — `fix` and `retry` one and two columns past `setupok` —
     and the back edge is drawn as the loop it is.

     The earlier rule cut the cycle where the recursion happened to meet itself, and memoised
     whatever depth the nodes inside it had reached by then. Compute the entry before the body
     and the body came out at columns one and two, on the far side of the diagram from the
     decision it retries, with a long edge across every lane to say so. */
  const back = new Set<string>();
  const seen = new Set<string>();
  const stack = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    stack.add(id);
    for (const to of outgoing.get(id) ?? []) {
      if (stack.has(to)) back.add(`${id}\0${to}`);
      else walk(to);
    }
    stack.delete(id);
  };
  for (const n of nodes) if ((incoming.get(n.id) ?? []).length === 0) walk(n.id);
  for (const n of nodes) walk(n.id);
  for (const [id, list] of incoming)
    incoming.set(
      id,
      list.filter((from) => !back.has(`${from}\0${id}`)),
    );

  const depth = new Map<string, number>();
  const depthOf = (id: string): number => {
    const hit = depth.get(id);
    if (hit !== undefined) return hit;
    let best = 0;
    for (const from of incoming.get(id) ?? []) best = Math.max(best, depthOf(from) + 1);
    depth.set(id, best);
    return best;
  };
  for (const n of nodes) depthOf(n.id);

  /* Lanes in the order they were declared; anything without one goes to an unlabelled band at the
     end rather than being dropped. */
  const laneIds = graph.lanes.map((l) => l.id);
  const orphan = nodes.some((n) => !n.lane);
  if (orphan) laneIds.push("__orphan");
  const laneIndex = new Map(laneIds.map((id, i) => [id, i]));

  const columns = Math.max(0, ...nodes.map((n) => depthOf(n.id) + 1));

  /* Column width is the widest node in it, so a column of pills does not reserve a card's width. */
  const colW: number[] = Array.from({ length: columns }, () => 0);
  for (const n of nodes) colW[depthOf(n.id)] = Math.max(colW[depthOf(n.id)]!, sizeOf(n.id).w);

  const colX: number[] = [];
  let x = m.lane.bandLeft + m.lane.padY;
  for (let c = 0; c < columns; c++) {
    colX.push(x);
    x += colW[c]! + m.lane.colGap;
  }
  let contentRight = x - m.lane.colGap + m.lane.padY;

  /* A cell is one (lane, column) pair. Several nodes in one cell stack. */
  const cell = new Map<string, string[]>();
  const cellKey = (lane: string, col: number) => `${lane}|${col}`;
  for (const n of nodes) {
    const key = cellKey(n.lane ?? "__orphan", depthOf(n.id));
    const list = cell.get(key);
    if (list) list.push(n.id);
    else cell.set(key, [n.id]);
  }

  const bandH: number[] = laneIds.map((lane) => {
    let tallest = 0;
    for (let c = 0; c < columns; c++) {
      const ids = cell.get(cellKey(lane, c)) ?? [];
      const stacked = ids.reduce((sum, id) => sum + sizeOf(id).h, 0) + Math.max(0, ids.length - 1) * m.lane.padY;
      tallest = Math.max(tallest, stacked);
    }
    return Math.max(m.lane.minH, tallest + m.lane.padY * 2);
  });

  const bandY: number[] = [];
  let y = 0;
  for (let i = 0; i < laneIds.length; i++) {
    bandY.push(y);
    y += bandH[i]! + m.lane.bandGap;
  }
  let totalH = Math.max(0, y - m.lane.bandGap);

  const placedNodes: Placed["nodes"] = {};
  const rows: Placed["rows"] = {};
  const routeNodes: Record<string, RouteNode> = {};

  for (const [key, ids] of cell) {
    const [lane, colText] = key.split("|");
    const li = laneIndex.get(lane!) ?? 0;
    const col = Number(colText);
    const stacked = ids.reduce((sum, id) => sum + sizeOf(id).h, 0) + Math.max(0, ids.length - 1) * m.lane.padY;
    let cy = bandY[li]! + (bandH[li]! - stacked) / 2;

    for (const id of ids) {
      const s = sizeOf(id);
      /* Centred in the column, so a narrow pill sits under the middle of the card before it rather
         than left-aligned against a gap. */
      const nx = Math.round(colX[col]! + (colW[col]! - s.w) / 2);
      const ny = Math.round(cy);
      placedNodes[id] = { x: nx, y: ny, w: s.w, h: s.h };
      const rowMap: Record<string, number> = {};
      for (const r of s.rowY) rowMap[r.id] = ny + r.y;
      rows[id] = rowMap;
      routeNodes[id] = { id, x: nx, y: ny, w: s.w, h: s.h, rows: rowMap, surface: "group" };
      cy += s.h + m.lane.padY;
    }
  }

  /*
   * A fork bar is only a fork if it visibly spans what it splits into. Its height is not knowable
   * when the node is sized — it depends on where its branches ended up — so it is set here, once
   * everything else is placed, from the extent of the nodes on the far side of its edges.
   */
  for (const n of nodes) {
    if (n.kind !== "fork" && n.kind !== "join") continue;
    const box = placedNodes[n.id];
    if (!box) continue;
    const branches = graph.edges
      .filter((e) => (n.kind === "fork" ? e.from.node === n.id : e.to.node === n.id))
      .map((e) => placedNodes[n.kind === "fork" ? e.to.node : e.from.node])
      .filter((b): b is NonNullable<typeof b> => b !== undefined);
    if (branches.length < 2) continue;

    const top = Math.min(...branches.map((b) => b.y));
    const bottom = Math.max(...branches.map((b) => b.y + b.h));
    box.y = Math.round(top - m.node.rowPad * 2);
    box.h = Math.round(bottom - top + m.node.rowPad * 4);
    const rn = routeNodes[n.id];
    if (rn) {
      rn.y = box.y;
      rn.h = box.h;
    }
  }

  const route = () =>
    routeEdges({
      nodes: routeNodes,
      edges: graph.edges.filter((e) => routeNodes[e.from.node] && routeNodes[e.to.node]),
      bends: {},
      labels,
      metric,
    });

  /*
   * The bands hold the lines as well as the cards.
   *
   * The bands are sized from the cards, and the lines are routed after: a back edge from the last
   * column to the first bows over the top band, and a self-loop stands above its card, so a box
   * taken from the bands alone ended through the loop and its label. Past the item's box a drawing
   * is where `content-visibility` cuts it — "around" came out half a word, and `Q_EDGE_OUTSIDE`
   * fired on a layout it says can never earn it (#407). So: once to route, and — only when a line
   * or a label reaches past the bands — once more with the bands grown to hold it. Room above or
   * to the left moves every card by that much, and routing is translation-invariant, so the second
   * pass is the first one moved; room below or to the right moves nothing. The overhang goes to
   * the outer bands, which is where it is drawn, rather than out of the item's frame beside them.
   */
  let edges = route();
  const box: Reach = { left: m.lane.bandLeft, top: 0, right: contentRight, bottom: totalH };
  const lines = routeReach(edges, box);
  const words = labelReach(edges, labels ?? {}, box);
  /* A grid step clear of the band's edge as well, so a label pushed in is not left sitting on the
     border it was cut by. Nothing that already fits moves. */
  const room = (past: number) => (past > 0 ? Math.ceil((past + m.grid) / m.grid) * m.grid : 0);
  const left = room(box.left - Math.min(lines.left, words.left));
  const top = room(box.top - Math.min(lines.top, words.top));
  const right = room(Math.max(lines.right, words.right) - box.right);
  const bottom = room(Math.max(lines.bottom, words.bottom) - box.bottom);
  if (laneIds.length > 0 && (left || top || right || bottom)) {
    for (const id of Object.keys(placedNodes)) {
      const b = placedNodes[id]!;
      b.x += left;
      b.y += top;
      const rn = routeNodes[id]!;
      rn.x = b.x;
      rn.y = b.y;
      for (const r of Object.keys(rows[id] ?? {})) rows[id]![r]! += top;
    }
    bandH[0]! += top;
    for (let i = 1; i < bandY.length; i++) bandY[i]! += top;
    bandH[bandH.length - 1]! += bottom;
    contentRight += left + right;
    totalH += top + bottom;
    if (left || top) edges = route();
  }

  return {
    kind: "graph",
    size: { w: Math.ceil(contentRight), h: Math.ceil(totalH) },
    nodes: placedNodes,
    rows,
    groups: [],
    lanes: laneIds.map((id, i) => ({
      id,
      x: m.lane.bandLeft,
      y: bandY[i]!,
      w: Math.ceil(contentRight - m.lane.bandLeft),
      h: bandH[i]!,
      labelY: bandY[i]! + bandH[i]! / 2,
    })),
    edges,
  };
}
