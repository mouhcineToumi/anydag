import type { Graph, Group, Node } from "@/dsl/ir";
import type { ThemeMetric } from "@/theme/contract";

import { labelReach, routeEdges, routeReach, type RouteNode } from "./route";
import { isShape } from "./shapes";
import type { Placed, PlacedGroup, SizedNode } from "./types";

/**
 * The fixed layout: put everything where the author put it.
 *
 * There is no algorithm here and that is the whole feature. `sketch` is fixed by nature and any
 * fence may become fixed with `layout=fixed`, and in both cases the coordinates in the file are the
 * drawing — a wireframe whose button ELK moved beside the field instead of under it is not a
 * wireframe with a spacing defect, it is a different picture.
 *
 * Four things it still does, because "passthrough" is not the same as "nothing":
 *
 * - **Snaps to `metric.grid`.** Everything else in the system is on the 8px grid, and a shape that
 *   is not is a shape a nudge can never line up with.
 * - **Resolves a container's children against its origin.** A group carries its own `x= y= w= h=`
 *   and its children are written relative to it, so a phone frame can be moved by editing one
 *   line instead of twelve. A group grows to hold what is in it if the declared box is too small:
 *   a container that clips its own contents is never what anybody meant, and `test/layout.test.ts`
 *   holds every layout to "a node stays inside its group".
 * - **Places what has no coordinate.** A fence that has just been switched to `layout=fixed` has
 *   thirty nodes and not one `x=`; a reading-order grid is what lets it draw at all, so the author
 *   can then drag. Placed children are never disturbed — the grid starts below them.
 * - **Routes the edges**, through the same `routeEdges` every other layout uses. It works from
 *   rectangles alone, which `boardRoute.ts` proves by feeding it a whole board's worth of items.
 *
 * **The frame hugs the drawing, on every side.** Everything is translated so the top-left of the
 * content is the origin, whichever sign that corner had in the file. It used to be done only for a
 * negative corner, so a node at `x=-40` stayed inside the frame — and a lone shape dragged 480px to
 * the right came out 480px inside a frame that still started at the file's `0`:
 * an empty rectangle three times the size of the one thing in it, that no resize could reach. Now
 * the coordinates in the file are the drawing's *shape* and the fence's `x=`/`y=` is where it
 * stands; a writer that moves the top-left corner moves the fence by the same amount in the same
 * op (`dropEdit` in `src/edit/drag.ts`), so nothing on the page jumps.
 *
 * `origin` is that translation, published so a writer can go from the layout's coordinates back to
 * the file's: a top-level box the layout placed at `x` is `x + origin.x` in the file.
 */

const snap = (v: number, grid: number) => Math.round(v / grid) * grid;

/** A child of a container, measured but not yet placed. */
interface Kid {
  id: string;
  isGroup: boolean;
  w: number;
  h: number;
  /** What the author wrote, relative to the container. */
  x?: number;
  y?: number;
}

export function layoutSketch(
  graph: Graph,
  sizes: Record<string, SizedNode>,
  metric: ThemeMetric,
  labels: Record<string, { w: number; h: number }> = {},
): Placed {
  const grid = metric.grid;
  const pad = metric.sketch.groupPad;
  const gap = metric.sketch.gap;

  /* Declaration order across both families, so a group written between two boxes is auto-placed
     between them. `line` is the only thing that orders a group against a node. */
  const childrenOf = new Map<string | undefined, (Node | Group)[]>();
  for (const thing of [...graph.nodes, ...graph.groups].sort((a, b) => a.line - b.line)) {
    const parent = "kind" in thing ? thing.group : thing.parent;
    const list = childrenOf.get(parent);
    if (list) list.push(thing);
    else childrenOf.set(parent, [thing]);
  }

  const sizeOf = (id: string): { w: number; h: number } => {
    const s = sizes[id];
    return { w: s?.w ?? metric.sketch.boxMinW, h: s?.h ?? metric.sketch.boxMinH };
  };

  /**
   * A container's children, positioned in its own coordinates, and the extent they reach.
   *
   * Memoised because a group is measured to size its parent and then walked again to emit it, and
   * doing the arithmetic twice is how the two answers start disagreeing.
   */
  const laid = new Map<string | undefined, { kids: Kid[]; w: number; h: number }>();

  const layoutOf = (container: string | undefined): { kids: Kid[]; w: number; h: number } => {
    const had = laid.get(container);
    if (had) return had;

    const kids: Kid[] = (childrenOf.get(container) ?? []).map((thing) => {
      if ("kind" in thing) {
        const box = sizeOf(thing.id);
        return { id: thing.id, isGroup: false, w: box.w, h: box.h, x: thing.x, y: thing.y };
      }
      const inner = layoutOf(thing.id);
      return {
        id: thing.id,
        isGroup: true,
        /* Declared, or what it takes to hold the contents — whichever is larger. */
        w: Math.max(thing.w ?? 0, inner.w + pad),
        h: Math.max(thing.h ?? 0, inner.h + pad),
        x: thing.x,
        y: thing.y,
      };
    });

    /* Reading order for whatever has no coordinate, starting under everything that has one. A
       square-ish grid rather than one long row: an undecorated `layout=fixed` conversion is
       something to drag from, and thirty cards in a line is 6000px of nothing. */
    const free = kids.filter((k) => k.x === undefined || k.y === undefined);
    if (free.length > 0) {
      const below = kids
        .filter((k) => k.x !== undefined && k.y !== undefined)
        .reduce((acc, k) => Math.max(acc, k.y! + k.h + gap), 0);
      const cols = Math.max(1, Math.ceil(Math.sqrt(free.length)));
      const colW = Math.max(...free.map((k) => k.w)) + gap;
      const rowH = Math.max(...free.map((k) => k.h)) + gap;
      free.forEach((k, i) => {
        k.x = (i % cols) * colW;
        k.y = below + Math.floor(i / cols) * rowH;
      });
    }

    for (const k of kids) {
      k.x = snap(k.x ?? 0, grid);
      k.y = snap(k.y ?? 0, grid);
    }

    const answer = {
      kids,
      w: kids.reduce((acc, k) => Math.max(acc, k.x! + k.w), 0),
      h: kids.reduce((acc, k) => Math.max(acc, k.y! + k.h), 0),
    };
    laid.set(container, answer);
    return answer;
  };

  const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};

  (function emit(container: string | undefined, ox: number, oy: number): void {
    for (const k of layoutOf(container).kids) {
      const x = ox + k.x!;
      const y = oy + k.y!;
      boxes[k.id] = { x, y, w: k.w, h: k.h };
      if (k.isGroup) emit(k.id, x, y);
    }
  })(undefined, 0, 0);

  /* The drawing's top-left becomes the frame's, whichever side of the file's origin it was on —
     see the note at the top. Snapped values shift by a snapped amount, so nothing comes off the
     grid; an empty fence has no corner and stays where it is. */
  const all = Object.values(boxes);
  const dx = all.length > 0 ? Math.min(...all.map((b) => b.x)) : 0;
  const dy = all.length > 0 ? Math.min(...all.map((b) => b.y)) : 0;
  if (dx !== 0 || dy !== 0) for (const b of all) (b.x -= dx), (b.y -= dy);

  /* Once to route, and — only when a line or its label reaches past the top or the left — once
     more with every box moved clear of it, `layoutGraph`'s rule. A back edge along a row
     bows above the row, and a frame taken from the boxes alone cut the bow off and its label with
     it: past the frame's corner a drawing is outside the item, where `content-visibility` clips it.
     Routing is translation-invariant, so the second pass is the first one moved. The move is the
     drawing's and not the file's, so it comes off `origin`: a writer still turns a laid-out box
     back into the file's number by adding it. */
  let placed = place(boxes, graph, sizes, metric);
  let reach = reachOf(placed.edges, labels);
  const sx = reach.left < 0 ? Math.ceil(-reach.left / grid) * grid : 0;
  const sy = reach.top < 0 ? Math.ceil(-reach.top / grid) * grid : 0;
  if (sx || sy) {
    for (const b of all) (b.x += sx), (b.y += sy);
    placed = place(boxes, graph, sizes, metric);
    reach = reachOf(placed.edges, labels);
  }
  const { nodes, rows, groups, edges } = placed;

  /* Words a box was drawn too narrow for. The box is the author's, so it is said, never grown. */
  const clipped = graph.nodes.filter((n) => sizes[n.id]?.clipped).map((n) => n.id);

  /* …and the lines and labels, which no box accounts for. */
  const w = Math.max(reach.right, all.reduce((acc, b) => Math.max(acc, b.x + b.w), 0));
  const h = Math.max(reach.bottom, all.reduce((acc, b) => Math.max(acc, b.y + b.h), 0));

  return {
    kind: "graph",
    /* An empty fixed fence is still an item and still has to report a box; `1` is what a gitgraph
       with nothing on it reports, for the same reason. */
    size: { w: Math.ceil(w) || 1, h: Math.ceil(h) || 1 },
    nodes,
    rows,
    groups,
    lanes: [],
    edges,
    origin: { x: dx - sx, y: dy - sy },
    ...(clipped.length > 0 ? { clipped } : null),
  };
}

type Boxes = Record<string, { x: number; y: number; w: number; h: number }>;

/** The boxes as the router and the renderer read them, and the edges routed between them. */
function place(
  boxes: Boxes,
  graph: Graph,
  sizes: Record<string, SizedNode>,
  metric: ThemeMetric,
): Pick<Placed, "nodes" | "rows" | "groups" | "edges"> {
  const nodes: Placed["nodes"] = {};
  const rows: Placed["rows"] = {};
  const routeNodes: Record<string, RouteNode> = {};

  for (const n of graph.nodes) {
    const box = boxes[n.id];
    if (!box) continue;
    nodes[n.id] = box;
    const rowMap: Record<string, number> = {};
    for (const r of sizes[n.id]?.rowY ?? []) rowMap[r.id] = box.y + r.y;
    rows[n.id] = rowMap;
    routeNodes[n.id] = {
      id: n.id,
      ...box,
      rows: rowMap,
      surface: n.group ? "group" : "paper",
      /* A circle is met on its circle, a triangle on its slanted side: `layout/shapes.ts`. */
      ...(isShape(n.kind) ? { outline: n.kind } : null),
      /* A figure on its picture and its caption, not on the box around both: `layout/figure.ts`. */
      ...(sizes[n.id]?.hull ? { hull: sizes[n.id]!.hull } : null),
    };
  }

  const groups: PlacedGroup[] = [];
  for (const g of graph.groups) {
    const box = boxes[g.id];
    if (!box) continue;
    groups.push({ id: g.id, ...box, level: g.level });
    /* Scenery, not an obstacle — the same thing `isGroup` means everywhere else the router runs.
       A container walled off its own contents otherwise, and a line into one gave up. */
    routeNodes[g.id] = { id: g.id, ...box, rows: {}, surface: g.parent ? "group" : "paper", isGroup: true };
  }
  groups.sort((a, b) => a.level - b.level);

  const edges = routeEdges({
    nodes: routeNodes,
    edges: graph.edges.filter((e) => routeNodes[e.from.node] && routeNodes[e.to.node]),
    bends: {},
    metric,
  });

  return { nodes, rows, groups, edges };
}

/** How far the lines and their labels reach, on every side. */
function reachOf(edges: Placed["edges"], labels: Record<string, { w: number; h: number }>) {
  const a = routeReach(edges);
  const b = labelReach(edges, labels);
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/** Whether this graph's coordinates are the author's. Read by `layoutGraph` and nobody else. */
export const isFixed = (graph: Graph): boolean => graph.type === "sketch" || graph.layout === "fixed";
