import type { Edge } from "@/dsl/ir";
import { endText } from "@/board/links";
import type { BoardLink } from "@/board/types";
import type { ThemeMetric } from "@/theme/contract";

import { routeEdges, type RouteNode } from "./route";
import type { Box, InnerBox, RoutedEdge } from "./types";

/**
 * Routing the links between items, in board space.
 *
 * A link is an edge between two *items* rather than between two nodes of one diagram, and it is
 * the only thing on the board that no dialect owns: an actor from a use case diagram pointing at a
 * service from an architecture diagram belongs to neither grammar. What it is not is a second
 * router. `routeEdges` is pure geometry over rectangles — it takes boxes, row anchors and a theme
 * metric, and ELK's polyline is optional input it discards when it disagrees — so handing it every
 * item on the page as a node gives the house curves, the dogleg past a card in the way and the
 * fan across a shared side, with nothing added here but the translation.
 *
 * Three decisions are worth writing down.
 *
 * **A link into a diagram lands on the card, and the frame becomes scenery.** The first attempt
 * anchored `item.node` on the *frame*, level with the node, the way a port row works inside a
 * diagram — which is defensible on paper and wrong on screen. A frame is `paper` on `paper` with no
 * border: the arrow stopped at an edge nobody can see, forty pixels of padding short of the card it
 * named, and read as pointing at nothing. So the node's own box joins the route as a node, and its
 * diagram is declared `isGroup` — which is exactly what `routeEdges` already means by a group box,
 * "scenery, not an obstacle, routes cross them by design". The diagram's *other* cards go in as
 * real obstacles, so the line threads between them rather than over them.
 *
 * **Only a diagram something links into becomes scenery.** A frame is large, and making every one
 * of them crossable would let an unrelated link cut across a diagram it has nothing to do with. A
 * frame is only transparent to the router once a link has business inside it.
 *
 * **Everything is routed in local space and the overlay is moved.** The board is infinite in all
 * four directions and an SVG `viewBox` starting at a negative origin is a fight nobody needs, so
 * the bounding box of the placed items becomes the overlay's origin, every box is translated by it
 * before routing, and the caller positions the layer. Routing is translation-invariant, which is
 * what makes that free.
 */

export interface LinkRouteInput {
  links: BoardLink[];
  /** Where each item sits on the board, and how big it is. */
  boxes: Map<string, Box>;
  /** Each diagram item's node and group boxes, in that item's own coordinates. */
  nodeBoxes: Map<string, Record<string, InnerBox>>;
  /**
   * Items that are one node and nothing else, and which node — a link naming the item lands on it.
   * Computed by the caller, which knows the item's type: a chart of one series is still a chart.
   */
  solo?: ReadonlyMap<string, string>;
  /**
   * Which entries in `boxes` are board-level groups rather than items — the union of their
   * members, filed under the group's own name.
   *
   * They are scenery, exactly as a diagram a link points into is, and for the same reason: left
   * as an obstacle a group's box walls off every member inside it, so a link naming one member
   * would have no way in. An endpoint anchors on a scenery box perfectly well — that is already
   * how a link into a *diagram's* own group works, one level down.
   */
  groups?: ReadonlySet<string>;
  metric: ThemeMetric;
}

/**
 * Where a link that names nothing at one end stops (#173): a loose stub, in the overlay's
 * coordinates, beside the end it has. `ref` is the name the missing end was written with.
 */
export interface LooseStub {
  /** The link's id: what a click on the stub picks, and what a drop on a card rewrites. */
  link: string;
  ref: string;
  x: number;
  y: number;
  size: number;
}

export interface LinkRoute {
  edges: RoutedEdge[];
  /** The loose stubs, one per hanging link. */
  loose: LooseStub[];
  /** Board-space position of the overlay; every coordinate in `edges` is relative to it. */
  origin: { x: number; y: number };
  size: { w: number; h: number };
}

const EMPTY: LinkRoute = { edges: [], loose: [], origin: { x: 0, y: 0 }, size: { w: 0, h: 0 } };

/**
 * How far outside the items the overlay reaches.
 *
 * A curve bows off its chord and a marker sits on the far side of its anchor, so the layer has to
 * be bigger than the boxes it connects. `.dag-edges` is `overflow: visible` and would paint outside
 * regardless; the margin is what keeps the *element* honest, which matters to the SVG export, where
 * the overlay becomes a real `<svg>` of its own and anything outside its box is gone.
 */
const marginOf = (m: ThemeMetric) => m.edge.reach.max;

/**
 * The route key for a node inside an item.
 *
 * `\0` rather than the `.` the DSL writes, because an item id may contain a dot — `resolveLinks`
 * settles which half is which and hands over the two names, and joining them back with a character
 * an id can hold would put `a.b` and `a` + `b` in the same slot.
 */
const inner = (item: string, node: string) => `${item}\0${node}`;

/** The route key for a link's loose stub: `\0` again, which no item id or node id can hold. */
const stubKey = (link: string) => `\0loose\0${link}`;

export function routeLinks({ links, boxes, nodeBoxes, solo, groups, metric }: LinkRouteInput): LinkRoute {
  if (links.length === 0 || boxes.size === 0) return EMPTY;

  /* Only links whose ends are on the page can be drawn — both, or for a hanging link the one it has
     (#173). `parseBoard` has already reported the names that are nowhere; this is the same test
     against what is *placed*, which is a smaller set — an item can be hidden, or on another page. */
  const placed = (l: BoardLink, side: "from" | "to") => l.loose === side || boxes.has(l[side].item);
  const live = links.filter((l) => placed(l, "from") && placed(l, "to"));
  if (live.length === 0) return EMPTY;

  /* Which end of a link resolves to a card inside a diagram, and which to the diagram itself. A
     node the page has not measured (or one this item does not have) falls back to the whole item,
     which is the same shape the router would draw for a link that never named a node.

     A link to an item that *is* one node — a shape dropped on the paper, an atom — ends on that
     node, exactly as `item.node` would. Its frame is bare padding nobody can see, so ending there
     left a line stopping short of the only thing drawn; for a triangle, short by a quarter of it. */
  const at = (item: string, named: string | undefined): string => {
    const node = named ?? solo?.get(item);
    return node !== undefined && nodeBoxes.get(item)?.[node] ? inner(item, node) : item;
  };

  const hosts = new Set<string>();
  for (const l of live) {
    if (l.loose !== "from" && at(l.from.item, l.from.node) !== l.from.item) hosts.add(l.from.item);
    if (l.loose !== "to" && at(l.to.item, l.to.node) !== l.to.item) hosts.add(l.to.item);
  }

  /*
   * A hanging link's stub, in board space: beside the item its known end is in, on the side the
   * missing end would have been — after it for a missing target, before it for a missing source —
   * level with the card it leaves when it leaves one, and a curve's shortest reach out from the
   * frame, so the line reads as leaving rather than as a mark on the item. Several from one item on
   * one side stack down, a card's gap apart, so none hides another.
   */
  const size = metric.node.end;
  const stubs: { link: BoardLink; ref: string; x: number; y: number }[] = [];
  const stacked = new Map<string, number>();
  for (const l of live) {
    if (!l.loose) continue;
    const has = l.loose === "to" ? l.from : l.to;
    const b = boxes.get(has.item)!;
    const nb = has.node === undefined ? undefined : nodeBoxes.get(has.item)?.[has.node];
    const cy = nb ? b.y + nb.y + nb.h / 2 : b.y + b.h / 2;
    const key = `${has.item}\0${l.loose}`;
    const k = stacked.get(key) ?? 0;
    stacked.set(key, k + 1);
    stubs.push({
      link: l,
      ref: endText(l[l.loose]),
      x: l.loose === "to" ? b.x + b.w + metric.edge.reach.min : b.x - metric.edge.reach.min - size,
      y: cy - size / 2 + k * (size + metric.node.gap),
    });
  }

  const margin = marginOf(metric);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes.values()) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  /* A bend counts towards the extent, because a line pulled out past both its items goes there and
     the overlay is the element an SVG export becomes. `overflow: visible` hides the omission on
     screen, which is exactly how it would have reached a file with the curve cut off. */
  for (const l of live) {
    if (!l.via) continue;
    minX = Math.min(minX, l.via.x);
    minY = Math.min(minY, l.via.y);
    maxX = Math.max(maxX, l.via.x);
    maxY = Math.max(maxY, l.via.y);
  }
  /* A stub sits outside every item, so it counts towards the extent for the bend's reason. */
  for (const st of stubs) {
    minX = Math.min(minX, st.x);
    minY = Math.min(minY, st.y);
    maxX = Math.max(maxX, st.x + size);
    maxY = Math.max(maxY, st.y + size);
  }
  const origin = { x: minX - margin, y: minY - margin };

  const nodes: Record<string, RouteNode> = {};
  for (const [id, b] of boxes) {
    nodes[id] = {
      id,
      x: b.x - origin.x,
      y: b.y - origin.y,
      w: b.w,
      h: b.h,
      rows: {},
      surface: "paper",
      /* Transparent to the router, because a link is going inside it. Its own cards go in below.
         A board-level group is transparent for the other half of the same reason: what is inside
         it is the members, which are items in their own right and are already in this map. */
      isGroup: hosts.has(id) || groups?.has(id) === true,
    };
    if (!hosts.has(id)) continue;
    for (const [nodeId, nb] of Object.entries(nodeBoxes.get(id) ?? {})) {
      const key = inner(id, nodeId);
      nodes[key] = {
        id: key,
        x: b.x - origin.x + nb.x,
        y: b.y - origin.y + nb.y,
        w: nb.w,
        h: nb.h,
        rows: {},
        /* Inside a frame rather than on the paper, which is what a hollow marker fills itself with. */
        surface: "group",
        /* A boundary inside the diagram is scenery here too. Left as an obstacle, a group's box
           walls off everything in it and a link asked for a card inside one has no way in. */
        isGroup: nb.group === true,
        /* A geometric shape is met on its outline, as an edge inside the sketch meets it. */
        ...(nb.shape ? { outline: nb.shape } : null),
        /* And a figure on its picture and caption. */
        ...(nb.hull ? { hull: nb.hull } : null),
      };
    }
  }

  /* A stub is a circle, and met on its ring. */
  for (const st of stubs) {
    const id = stubKey(st.link.id);
    nodes[id] = { id, x: st.x - origin.x, y: st.y - origin.y, w: size, h: size, rows: {}, surface: "paper", outline: "circle" };
  }

  const end = (l: BoardLink, side: "from" | "to") => (l.loose === side ? stubKey(l.id) : at(l[side].item, l[side].node));
  const edges: Edge[] = live.map((l) => ({
    id: l.id,
    from: { node: end(l, "from") },
    to: { node: end(l, "to") },
    dash: l.dash,
    quiet: l.quiet === true,
    head: l.head,
    tail: l.tail,
    label: l.label,
    label2: l.label2,
    hue: l.hue,
    line: l.line,
  }));

  /* A bend is written in board coordinates, like every other coordinate in the file, and the
     router works in the overlay's — so it is translated here with everything else. This is the one
     caller that passes any: see `RouteInput.via`. */
  const via: Record<string, { x: number; y: number }> = {};
  for (const l of live) {
    if (l.via) via[l.id] = { x: l.via.x - origin.x, y: l.via.y - origin.y };
  }

  return {
    edges: routeEdges({ nodes, edges, bends: {}, via, metric }),
    loose: stubs.map((st) => ({ link: st.link.id, ref: st.ref, x: st.x - origin.x, y: st.y - origin.y, size })),
    origin,
    size: { w: maxX - minX + margin * 2, h: maxY - minY + margin * 2 },
  };
}
