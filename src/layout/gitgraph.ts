import { gitMetaOf } from "@/dsl/graph/gitgraph";
import type { Graph } from "@/dsl/ir";
import type { ThemeMetric } from "@/theme/contract";

import { routeEdges, type RouteNode } from "./route";
import type { Placed, SizedNode } from "./types";

/**
 * Git graph placement: a column per commit, a lane per branch.
 *
 * Both axes are ordinal, which is what makes this the simplest layout in the system — and why it
 * gets one rather than being handed to ELK, which would reorder the commits to reduce crossings and
 * destroy the only ordering the diagram has.
 */
export function layoutGitgraph(graph: Graph, sizes: Record<string, SizedNode>, metric: ThemeMetric): Placed {
  const meta = gitMetaOf(graph);
  const nodes: Placed["nodes"] = {};
  const rows: Placed["rows"] = {};
  const routeNodes: Record<string, RouteNode> = {};

  const laneIndex = new Map(meta.lanes.map((name, i) => [name, i]));
  const sizeOf = (id: string) => sizes[id] ?? { w: metric.node.stateW, h: metric.node.plainH, rowY: [] };

  /* Pitch from the widest and tallest commit actually present. A fixed pitch was wrong the moment
     a commit message ran past it, and two chips overlapped. */
  const widest = Math.max(140, ...graph.nodes.map((n) => sizeOf(n.id).w));
  const tallest = Math.max(48, ...graph.nodes.map((n) => sizeOf(n.id).h));
  const colPitch = widest + metric.lane.colGap;
  const lanePitch = tallest + metric.lane.padY;

  /* The same left gutter a swimlane reserves: branch names are drawn in the margin, and without it
     the first commit sits under `main`. */
  const gutter = metric.lane.bandLeft + metric.lane.padY;

  for (const n of graph.nodes) {
    const size = sizeOf(n.id);
    const x = gutter + (meta.column[n.id] ?? 0) * colPitch;
    const y = (laneIndex.get(meta.branchOf[n.id] ?? "main") ?? 0) * lanePitch;
    nodes[n.id] = { x, y, w: size.w, h: size.h };
    rows[n.id] = {};
    routeNodes[n.id] = { id: n.id, x, y, w: size.w, h: size.h, rows: {}, surface: "paper" };
  }

  const edges = routeEdges({
    nodes: routeNodes,
    edges: graph.edges.filter((e) => routeNodes[e.from.node] && routeNodes[e.to.node]),
    bends: {},
    metric,
  });

  const boxes = Object.values(nodes);
  const w = boxes.length ? Math.max(...boxes.map((b) => b.x + b.w)) : 1;
  const h = boxes.length ? Math.max(...boxes.map((b) => b.y + b.h)) : 1;

  return {
    kind: "graph",
    size: { w: Math.ceil(w), h: Math.ceil(h) },
    nodes,
    rows,
    groups: [],
    /* Branch names in the margin, the same treatment a swimlane gets — a lane here really is a
       lane, and reusing the band means one component draws both. */
    lanes: meta.lanes.map((name, i) => ({
      id: name,
      x: metric.lane.bandLeft,
      y: i * lanePitch,
      w: Math.ceil(w - metric.lane.bandLeft),
      h: tallest,
      labelY: i * lanePitch + tallest / 2,
    })),
    edges,
  };
}
