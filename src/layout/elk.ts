import ELK from "elkjs/lib/elk-api.js";
import type { ElkNode } from "elkjs/lib/elk-api";
import ElkWorker from "elkjs/lib/elk-worker.min.js?worker";

import type { Graph } from "@/dsl/ir";
import type { ThemeMetric } from "@/theme/contract";

import { layoutGitgraph } from "./gitgraph";
import { layoutLanes } from "./lanes";
import { layoutTimeline } from "./timeline";
import { labelReach, routeEdges, type RouteNode } from "./route";
import { isFixed, layoutSketch } from "./sketch";
import type { Placed, PlacedGroup, SizedNode } from "./types";

/**
 * IR → ELK → placed boxes → our own edges.
 *
 * ELK decides *where things go*; it does not decide what edges look like. Its orthogonal routes are
 * kept only when they had to dodge something (more than two bends); everything else is redrawn by
 * `route.ts` as the house S-curve. Two reasons: the curve is the look, and ELK's anchors sit at the
 * middle of a side, which throws away rule 9 — a port's edge has to leave from its row.
 *
 * Ports are still declared, with `FIXED_ORDER` rather than `FIXED_POS`: that gets crossing
 * minimisation to order a node's targets the way its rows are ordered, which is the part ELK is
 * genuinely better at, without letting it place anything.
 */

/**
 * ELK runs in **its own** Web Worker, not one of ours.
 *
 * `elk.bundled.js` looks like the obvious import and is a trap twice over: on the main thread its
 * "fake worker" runs the algorithm synchronously and blocks the canvas, and inside a worker of ours
 * it throws — `elk-worker.min.js` stops exporting the fake `Worker` class once it detects it *is*
 * the worker, so the bundle's factory has nothing to construct.
 *
 * Handing `elk-api` a real worker built from `elk-worker.min.js` puts the expensive part off-thread
 * where it belongs and leaves routing here, which is pure arithmetic and costs nothing.
 *
 * **Made when it is first wanted, not when this module is imported**. The renderer is in
 * every page's first chunk, so a worker made at import was a 1.4 MB script fetched and booted on the
 * sign-in card, a note, the Tasks page — pages with no diagram to lay out, on the same connection
 * as the things they were waiting for. `warmLayout` starts it early where a diagram is coming:
 * `main.tsx` calls it straight away for a board, and once the page is idle for everything else, so
 * the first board opened from a note does not wait for it either.
 */
let elk: InstanceType<typeof ELK> | null = null;
const engine = () => (elk ??= new ELK({ workerFactory: () => new ElkWorker() }));

/** Start the layout worker now, if it has not been — so the first diagram does not wait for it. */
export const warmLayout = (): void => void engine();

const BASE: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
  "elk.layered.nodePlacement.favorStraightEdges": "true",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  /* Ties break on the order the author wrote, which makes layout deterministic *and* gives the
     author a way to influence it without a coordinate. */
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.thoroughness": "10",
  "elk.spacing.edgeNode": "24",
  "elk.spacing.edgeEdge": "16",
  "elk.spacing.componentComponent": "64",
  /* Keep an unconnected node inside its group and in reading order rather than exiled to a corner
     as its own component. */
  "elk.separateConnectedComponents": "false",
};

/** ELK places on fractional pixels; the system's base unit is 8. */
const snap = (v: number, grid: number) => Math.round(v / grid) * grid;

export async function layoutGraph(
  graph: Graph,
  sizes: Record<string, SizedNode>,
  labels: Record<string, { w: number; h: number }>,
  metric: ThemeMetric,
): Promise<Placed> {
  /* Fixed comes first, and it outranks the diagram's own type: `layout=fixed` on a `flow` fence
     means the bands are not what places things any more, and a check made after the lane branch
     would never be reached. */
  if (isFixed(graph)) return layoutSketch(graph, sizes, metric, labels);

  /* Four layouts are ours rather than ELK's, each because the diagram has an axis ELK has no
     concept of: a lane, a date, or a commit order it must not reorder. */
  if (graph.type === "timeline") return layoutTimeline(graph, sizes, metric);
  if (graph.type === "gitgraph") return layoutGitgraph(graph, sizes, metric);
  if (graph.lanes.length > 0 || graph.type === "flow" || graph.type === "activity") {
    return layoutLanes(graph, sizes, metric, labels);
  }

  const dir = graph.dir === "TB" ? "DOWN" : "RIGHT";
  const colGap = metric.elk.colGap[graph.type] ?? 80;
  const rowGap = metric.elk.rowGap[graph.type] ?? 32;
  const aspect = graph.aspect ?? metric.elk.aspect[graph.type] ?? 1.6;
  const separate = (metric.elk.hierarchy[graph.type] ?? "include") === "separate";
  /* Groups stack their members across the flow: domains side by side, members down each one.

     Except a use-case system, which runs *with* the diagram. Its members are ordered by the
     actors that reach them (below), and that order is ELK's model order — which only decides the
     axis *across* the layers. Stacked DOWN, the layers were the rows and the include/extend chain
     decided which use case sat at which height, while the actors fanned in from the side to
     wherever that put each one. Run RIGHT, the chain reads sideways and the actors' order comes
     down the column, which is the picture a use-case diagram is. */
  const innerDir = graph.type === "usecase" ? dir : dir === "RIGHT" ? "DOWN" : "RIGHT";

  /* Under `separate` a group lays its own members out, so everything that depends on "which way is
     forward" has to ask the group, not the diagram. */
  const dirOfGroup = new Map(graph.groups.map((g) => [g.id, g.dir ?? innerDir]));
  const dirOf = (group: string | undefined): "RIGHT" | "DOWN" =>
    separate && group !== undefined ? (dirOfGroup.get(group) ?? innerDir) : dir;

  /*
   * `colGap` is horizontal and `rowGap` is vertical, whichever way the layout happens to run.
   *
   * ELK's two spacings are named for the algorithm — between layers, and within one — and which of
   * those is horizontal depends on the direction. A group running DOWN inside a diagram running
   * RIGHT therefore got the pair transposed: its cards sat `rowGap` apart *horizontally*, which for
   * an ERD is 32px, and an edge between two of them had nowhere to be drawn. The gap a reader sees
   * between two cards side by side should be the same gap whichever pass produced them.
   */
  const spacing = (d: "RIGHT" | "DOWN") => ({
    "elk.spacing.nodeNode": String(d === "RIGHT" ? rowGap : colGap),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(d === "RIGHT" ? colGap : rowGap),
  });

  const childrenOf = new Map<string | undefined, ElkNode[]>();
  const push = (parent: string | undefined, node: ElkNode) => {
    const list = childrenOf.get(parent);
    if (list) list.push(node);
    else childrenOf.set(parent, [node]);
  };
  const insertGroup = (parent: string | undefined, node: ElkNode) => {
    const list = childrenOf.get(parent);
    if (list) list.splice(nodeCount.get(parent) ?? 0, 0, node);
    else childrenOf.set(parent, [node]);
  };

  /* Ports exist to be ordered, never to be positioned: `route.ts` computes the real anchor from the
     row's y. Giving them a 1×1 box keeps them from perturbing the node's size.

     And only where the row can be honoured. A row is a horizontal band, so its y means something
     on the left and right of a card and nothing at all on the bottom — `route.ts` drops the row
     anchor on a vertical exit and fans the edge like any other. Declaring EAST ports on a card
     inside a group that runs DOWN therefore bought nothing and cost twice: ELK ordered the targets
     down a side no edge would leave from, and routed each one out sideways and back around, which
     `route.ts` then spliced its own anchors onto. That is the twisted edge, and it starts here. */
  /*
   * `col=` is the one thing a person can say about where ELK puts a card, and it is a *layer*
   * rather than a coordinate — see `Node.col`. ELK's partitioning constrains only the nodes that
   * carry a partition and leaves everything else free, so the whole feature is switched on by the
   * presence of one `col=` and is a no-op on every board that has none. That is deliberate: the
   * frozen `route-quality` totals over the reference boards are what says this changed nothing,
   * and they can only say it if the option is genuinely absent when nobody asked for it.
   */
  const partitioned = new Set(graph.nodes.filter((n) => n.col !== undefined).map((n) => n.group));

  const hasPorts = new Set<string>();
  for (const n of graph.nodes) {
    const size = sizes[n.id] ?? { w: 120, h: 60, rowY: [] };
    const ports = (dirOf(n.group) === "RIGHT" ? size.rowY : []).map((r, i) => ({
      id: `${n.id}::${r.id}`,
      width: 1,
      height: 1,
      layoutOptions: {
        "elk.port.side": "EAST",
        "elk.port.index": String(i),
      },
    }));
    if (ports.length) hasPorts.add(n.id);
    const options: Record<string, string> = {
      ...(ports.length ? { "elk.portConstraints": "FIXED_ORDER" } : {}),
      ...(n.col !== undefined ? { "elk.partitioning.partition": String(n.col) } : {}),
    };
    push(n.group, {
      id: n.id,
      width: size.w,
      height: size.h,
      ...(ports.length ? { ports } : {}),
      ...(Object.keys(options).length ? { layoutOptions: options } : {}),
    });
  }

  /* Reversed so a nested group's box exists before its parent reads `childrenOf.get(g.id)` — a
     group is declared before anything inside it. But pushing in that order put the *siblings* in
     reverse too, and ELK's model order is the children list: under `forceNodeModelOrder` three
     groups declared A, B, C stacked C, B, A, and an author who reordered the file to fix it found
     the layout flip the other way. Nodes keep their place at the front of the list; each group goes
     in behind them, ahead of the groups already inserted, which is the order it was written in. */
  const nodeCount = new Map<string | undefined, number>();
  for (const [parent, list] of childrenOf) nodeCount.set(parent, list.length);

  /*
   * Under `separate` a group is laid out on its own, and the edges that leave it are hoisted to
   * the group's box before ELK sees them — so nothing about *where an outside node sits* reaches
   * the pass that orders the group's children. A use-case system stacked its eight use cases by
   * their two include/extend edges and nothing else, and the four actors' lines went to wherever
   * that put each one: sixteen crossings on a diagram with eleven associations.
   *
   * The children are ordered here instead, by the barycentre of their outside neighbours'
   * declaration order — the use cases the first actor uses come first — and ELK is told to keep
   * that order within a layer. Declaration order stays the tie-break, and a child nothing outside
   * touches goes after the ones something does.
   */
  const groupParent = new Map(graph.groups.map((g) => [g.id, g.parent]));
  const groupOf = new Map(graph.nodes.map((n) => [n.id, n.group]));
  const declared = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const inside = (node: string, group: string): boolean => {
    for (let at = groupOf.get(node); at !== undefined; at = groupParent.get(at)) if (at === group) return true;
    return false;
  };
  const orderChildren = (g: string): boolean => {
    const list = childrenOf.get(g);
    const n = nodeCount.get(g) ?? 0;
    if (!list || n < 2) return false;
    const bary = new Map<string, number>();
    for (const e of graph.edges) {
      const [a, b] = [e.from.node, e.to.node];
      for (const [self, other] of [[a, b], [b, a]] as const) {
        if (groupOf.get(self) !== g || inside(other, g) || !declared.has(other)) continue;
        const so = bary.get(self);
        const at = declared.get(other)!;
        bary.set(self, so === undefined ? at : (so + at) / 2);
      }
    }
    if (bary.size < 2) return false;
    const head = list.slice(0, n).sort((p, q) => {
      const bp = bary.get(p.id) ?? Number.POSITIVE_INFINITY;
      const bq = bary.get(q.id) ?? Number.POSITIVE_INFINITY;
      return bp - bq || declared.get(p.id)! - declared.get(q.id)!;
    });
    list.splice(0, n, ...head);
    return true;
  };

  for (const g of [...graph.groups].reverse()) {
    const ordered = separate && orderChildren(g.id);
    insertGroup(g.parent, {
      id: g.id,
      children: childrenOf.get(g.id) ?? [],
      layoutOptions: {
        "elk.padding": `[top=${metric.group.padTop},left=${metric.group.padSide},bottom=${metric.group.padBottom},right=${metric.group.padSide}]`,
        /* Root-only until now, and ELK's default is the opposite: inside a group, children with no
           edge between them were three separate components, packed by size in a grid, and no
           model-order option could reach them — three groups nested in a Kubernetes box came out
           Comms, Money, Trips for a file that said Trips, Money, Comms. */
        "elk.separateConnectedComponents": "false",
        /* Partitioning is a property of the pass that lays out a set of siblings, so a group whose
           own children carry `col=` has to switch it on for itself. Under `hierarchy: separate`
           that pass really is the group's; under `include` the option is harmless where nothing
           is partitioned. */
        ...(partitioned.has(g.id) ? { "elk.partitioning.activate": "true" } : {}),
        ...(separate
          ? {
              "elk.algorithm": "layered",
              "elk.direction": g.dir ?? innerDir,
              ...spacing(g.dir ?? innerDir),
              ...(ordered
                ? {
                    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
                    "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
                  }
                : {}),
            }
          : {
              /* A group's own children are ordered by the group's options, not the root's:
                 three groups nested in a Kubernetes box under \`aspect=0\` came out Comms, Money,
                 Trips for a file that said Trips, Money, Comms, while their top-level siblings
                 kept their order. The root's model-order settings apply one level down too. */
              "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
              ...(aspect > 0 ? {} : { "elk.layered.crossingMinimization.forceNodeModelOrder": "true" }),
            }),
      },
    });
    childrenOf.delete(g.id);
  }

  const known = new Set([...graph.nodes.map((n) => n.id), ...graph.groups.map((g) => g.id)]);
  const external = new Set(graph.nodes.filter((n) => n.external === true).map((n) => n.id));
  const rowsOf = new Map(graph.nodes.map((n) => [n.id, new Set(n.rows.map((r) => r.id))]));

  /*
   * Under `SEPARATE_CHILDREN`, ELK only lays out edges whose endpoints are siblings — an edge from
   * a node inside one group to a node inside another is simply not seen, and the two groups come
   * out looking unconnected and get stacked in a column.
   *
   * So a cross-boundary edge is **hoisted** to the nearest pair of ancestors that *are* siblings:
   * `workspace → intake` becomes `tenancy → intake` as far as ELK is concerned. Only the layout
   * sees this; the router still anchors the real endpoints, so the drawn edge starts on the entity
   * it belongs to.
   *
   * This applies to every diagram, not just the `separate` ones. `SEPARATE_CHILDREN` is ELK's
   * default and nothing here ever sets `hierarchyHandling`, so an `include` diagram is in exactly
   * the same mode — `include` only decides whether a group gets its own direction and spacing.
   * Hoisting was gated on it anyway, so an `arch` diagram whose flow crossed group boundaries had
   * every one of those edges dropped from layout: a pipeline's source group was placed below the
   * cloud it feeds, because as far as ELK could see nothing connected them.
   */
  const parentOf = new Map<string, string | undefined>([
    ...graph.nodes.map((n) => [n.id, n.group] as const),
    ...graph.groups.map((g) => [g.id, g.parent] as const),
  ]);
  const chainOf = (id: string): string[] => {
    const chain: string[] = [];
    let at: string | undefined = id;
    while (at !== undefined) {
      chain.unshift(at);
      at = parentOf.get(at);
    }
    return chain;
  };
  const hoist = (from: string, to: string): [string, string] => {
    const a = chainOf(from);
    const b = chainOf(to);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    /* `i` is the first level where they diverge; those two are siblings under a shared parent. */
    return [a[i] ?? from, b[i] ?? to];
  };

  /* A hoisted edge's bends describe a route between two *groups*; the drawn edge runs between two
     entities inside them, which may be anywhere in those boxes. Splicing one onto the other is how
     a tenancy line ends up as a rectangle around the whole diagram. ELK's polyline is only ever
     evidence about the pair ELK actually routed. */
  const hoisted = new Set<string>();

  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      ...BASE,
      "elk.direction": dir,
      ...spacing(dir),
      /* `include` has to say so to ELK. Without this option ELK stays in `SEPARATE_CHILDREN` and
         drops every edge whose endpoints are not siblings — and `hoist()`, the other way to survive
         that, only runs under `separate`. So the `include` types were getting neither: an `arch`
         diagram's cross-group edges were invisible to layout, and the group boxes were placed with
         no idea the flow ran through them. A source group sat *below* the cloud it feeds. */
      /* Without this an architecture diagram is one very long row: the five-step delivery chain
         sits beside the cloud and the whole thing is 2400px of mostly nothing. Wrapping folds a
         long chain into rows until the shape is roughly `aspect`, which is what the hand-drawn
         boards did by eye.
     
         `aspect: 0` turns it off, which is what a state machine wants: a funnel that wraps stops
         reading as a funnel, and ELK reorders the states to fit the target rather than leaving them
         in the order they were written. */
      ...(aspect > 0
        ? { "elk.aspectRatio": String(aspect), "elk.layered.wrapping.strategy": "MULTI_EDGE" }
        : { "elk.layered.crossingMinimization.forceNodeModelOrder": "true" }),
      ...(partitioned.has(undefined) ? { "elk.partitioning.activate": "true" } : {}),
    },
    children: childrenOf.get(undefined) ?? [],
    edges: graph.edges
      .filter((e) => known.has(e.from.node) && known.has(e.to.node) && e.from.node !== e.to.node)
      /* A use-case system is one column of pills in the order the actors reach them (the
         barycentre above), and an «include» between two of them is drawn between the pills. Fed
         to ELK it would layer the column into columns, which is a chain of arrows a reader has
         to follow sideways while every actor's line comes in from the left across it. */
      .filter((e) => !(graph.type === "usecase" && groupOf.get(e.from.node) !== undefined && groupOf.get(e.from.node) === groupOf.get(e.to.node)))
      .map((e) => {
        let [from, to] = hoist(e.from.node, e.to.node);
        if (from !== e.from.node || to !== e.to.node) hoisted.add(e.id);
        /* A secondary actor stands on the far side of the system, as UML draws it. ELK reads the
           edge's direction as "left of"; an association has no direction of its own, so the
           external actor's is turned round for layout only. */
        if (graph.type === "usecase" && external.has(e.from.node) && from === e.from.node && to !== e.to.node) [from, to] = [to, from];
        const usePort =
          from === e.from.node && hasPorts.has(from) && e.from.row && rowsOf.get(e.from.node)?.has(e.from.row);
        const useTargetPort =
          to === e.to.node && hasPorts.has(to) && e.to.row && rowsOf.get(e.to.node)?.has(e.to.row);
        return {
          id: e.id,
          sources: [usePort ? `${from}::${e.from.row}` : from],
          targets: [useTargetPort ? `${to}::${e.to.row}` : to],
          ...(labels[e.id] ? { labels: [{ text: " ", width: labels[e.id]!.w, height: labels[e.id]!.h }] } : {}),
        };
      })
      /* A hoisted edge can collapse to a self-loop (two entities in one group); ELK rejects those
         at the root and the layout is fine without them — the router still draws the real edge. */
      .filter((e) => e.sources[0] !== e.targets[0]),
  };

  const laid = await engine().layout(root);

  const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const bends: Record<string, { x: number; y: number }[]> = {};
  const grid = metric.grid;

  (function walk(node: ElkNode, ox: number, oy: number): void {
    for (const c of node.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      boxes[c.id] = { x: snap(x, grid), y: snap(y, grid), w: c.width ?? 0, h: c.height ?? 0 };
      walk(c, x, y);
    }
    /* An edge's sections are expressed relative to whichever node ELK chose to hang them on, which
       for a cross-group edge is the common ancestor — hence the offset walk rather than a flat
       read. */
    for (const e of node.edges ?? []) {
      const section = e.sections?.[0];
      if (!section) continue;
      bends[e.id] = (section.bendPoints ?? []).map((p) => ({ x: ox + p.x, y: oy + p.y }));
    }
  })(laid, 0, 0);

  const groupLevel = new Map(graph.groups.map((g) => [g.id, g.level]));
  for (const id of hoisted) delete bends[id];

  /* Once to route, and — only when a label hangs past the top or the left — once more with every
     box and bend moved clear of it. Routing is translation-invariant, so the second pass is the
     first one moved, and no label is left drawn outside the item where `content-visibility` cuts it. */
  let placed = place();
  let reach = labelReach(placed.edges, labels);
  const dx = reach.left < 0 ? Math.ceil(-reach.left / grid) * grid : 0;
  const dy = reach.top < 0 ? Math.ceil(-reach.top / grid) * grid : 0;
  if (dx || dy) {
    for (const b of Object.values(boxes)) {
      b.x += dx;
      b.y += dy;
    }
    for (const list of Object.values(bends)) for (const p of list) (p.x += dx), (p.y += dy);
    placed = place();
    reach = labelReach(placed.edges, labels);
  }
  const { nodes, rows, groups, edges } = placed;

  /* The frame is drawn around the content by the renderer; the size here is the content's own
     extent, padded, so nothing sits on the boundary. */
  let w = 0;
  let h = 0;
  for (const b of Object.values(boxes)) {
    w = Math.max(w, b.x + b.w);
    h = Math.max(h, b.y + b.h);
  }
  /* …and the labels, which hang off a line rather than sit in a box. */
  w = Math.max(w, reach.right);
  h = Math.max(h, reach.bottom);

  return {
    kind: "graph",
    size: { w: Math.ceil(w), h: Math.ceil(h) },
    nodes,
    rows,
    groups,
    lanes: [],
    edges,
  };

  function place() {
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
      routeNodes[n.id] = { id: n.id, ...box, rows: rowMap, surface: n.group ? "group" : "paper" };
    }

    const groups: PlacedGroup[] = [];
    for (const g of graph.groups) {
      const box = boxes[g.id];
      if (!box) continue;
      groups.push({ id: g.id, ...box, level: groupLevel.get(g.id) ?? 0 });
      /* An edge may land on a whole group (the ERD's one tenancy line per domain), so groups are
         routable targets too. */
      routeNodes[g.id] = { id: g.id, ...box, rows: {}, surface: g.parent ? "group" : "paper", isGroup: true };
    }
    groups.sort((a, b) => a.level - b.level);

    const edges = routeEdges({
      nodes: routeNodes,
      edges: graph.edges.filter((e) => routeNodes[e.from.node] && routeNodes[e.to.node]),
      bends,
      labels,
      metric,
    });
    return { nodes, rows, groups, edges };
  }
}
