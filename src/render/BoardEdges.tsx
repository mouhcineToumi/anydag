import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { BoardLink } from "@/board/types";
import { routeLinks } from "@/layout/boardRoute";
import type { Box, InnerBox } from "@/layout/types";
import type { Theme } from "@/theme/contract";

import { Edges } from "./Edges";

/**
 * The links between items, drawn on the paper.
 *
 * One layer for the whole board rather than one per link, emitted *after* the items so DOM order
 * alone puts the lines over the cards — the opposite of how `Edges` stacks inside a diagram, and
 * still no `z-index` anywhere. A frame paints an opaque `paper` background, so underneath it a link
 * that ends on a card *inside* a diagram was drawn and then covered, and appeared to stop dead at
 * an edge nobody can see. Over the top is safe here in a way it would not be inside a diagram: the
 * board router has every item as an obstacle, so a link never crosses a card it has no business
 * with, and the only thing it draws over is the padding of a frame it was asked to enter.
 *
 * It is positioned rather than full-bleed. `routeLinks` returns its coordinates relative to an
 * origin it chose, and this moves the layer there; a `viewBox` cannot start at a negative number
 * without arithmetic somewhere, and the board is infinite in all four directions.
 *
 * **It follows a drag, and it is the one layer allowed to do that in React.** Everywhere else a
 * gesture paints `transform` and nothing reaches React until the pointer lifts, because `Item` is
 * memoised and re-rendering every item on the board sixty times a second is what that rule exists
 * to prevent. This tree is a handful of paths, so the drag publishes the boxes it is moving on
 * `dag:links-preview` and the routing is simply done again. A line left hanging off a card that has
 * moved is worse than the frames it costs.
 */

/** What a drag publishes while it is in flight: where the moving items are now, or nothing. */
export interface LinkPreview {
  moves: Map<string, { x: number; y: number }> | null;
}

/**
 * What bending a line publishes while the handle is held: the point it is being pulled through.
 *
 * Its own event rather than a second field on `LinkPreview`, because the two gestures clear
 * independently — an item drag ends with `moves: null` and would take a standing bend with it.
 * One event, one thing it says.
 */
export interface BendPreview {
  id: string;
  at: { x: number; y: number } | null;
}

export function BoardEdges({
  links,
  boxes,
  nodeBoxes,
  solo,
  groups,
  theme,
  onPick,
  picked,
  onBend,
  onStraighten,
  onLoose,
}: {
  links: BoardLink[];
  boxes: Map<string, Box>;
  nodeBoxes: Map<string, Record<string, InnerBox>>;
  /** Items that are one node, and which: a link naming the item lands on it. See `routeLinks`. */
  solo?: ReadonlyMap<string, string>;
  /**
   * Board-level groups on this page: the name, and the items that carry it.
   *
   * The *members* rather than a finished box, because the union has to be taken from `live` — a
   * group being dragged publishes its members' moving boxes on `dag:links-preview` like anything
   * else, and a union computed one layer up from `places` would sit still while the drawing under
   * it moved. It is the same argument the preview itself makes, one derivation further in.
   */
  groups?: ReadonlyMap<string, readonly string[]>;
  theme: Theme;
  /** Absent under `?snapshot=1`, where the page is being photographed rather than used. */
  onPick?(id: string): void;
  picked?: string | null;
  /** Bend the picked line through a point, and straighten it again. Absent under `?snapshot=1`. */
  onBend?(id: string, e: ReactPointerEvent<SVGCircleElement>): void;
  onStraighten?(id: string): void;
  /** Pull a hanging link's loose stub onto something (#173). Absent where nothing may be written. */
  onLoose?(link: string, e: ReactPointerEvent<SVGGElement>): void;
}) {
  const [moves, setMoves] = useState<LinkPreview["moves"]>(null);
  const [bend, setBend] = useState<BendPreview | null>(null);

  useEffect(() => {
    const onMove = (e: Event) => setMoves((e as CustomEvent<LinkPreview>).detail.moves);
    const onBendPreview = (e: Event) => setBend((e as CustomEvent<BendPreview | null>).detail);
    document.addEventListener("dag:links-preview", onMove);
    document.addEventListener("dag:link-bend", onBendPreview);
    return () => {
      document.removeEventListener("dag:links-preview", onMove);
      document.removeEventListener("dag:link-bend", onBendPreview);
    };
  }, []);

  /* The handle's own answer wins while it is held, for `live`'s reason one derivation along: the
     file has not been written yet and the curve has to be under the pointer all the same. */
  const drawn = useMemo(() => {
    if (!bend) return links;
    return links.map((l) => (l.id === bend.id ? { ...l, via: bend.at ?? undefined } : l));
  }, [links, bend]);

  /* The drag's own answer wins while it is in flight; when it commits, `boxes` catches up and this
     falls back to it. Nothing has to clear the preview in the right order for that to be true. */
  const live = useMemo(() => {
    if (!moves) return boxes;
    const next = new Map(boxes);
    for (const [id, p] of moves) {
      const b = next.get(id);
      if (b) next.set(id, { ...b, x: p.x, y: p.y });
    }
    return next;
  }, [boxes, moves]);

  /*
   * A group's union box, filed under the group's own name, beside the items.
   *
   * An item id wins a collision, because that is the order `resolveLinks` has already decided in:
   * an item is a thing somebody named and a group name is generated, so a link that resolved to
   * the item must not find a group's box here. A group with nothing placed — every member hidden,
   * or on another page — contributes nothing, and `routeLinks` then drops the link for the same
   * reason it drops one naming an item that is not on the page.
   */
  const { boxes: withGroups, names } = useMemo(() => {
    if (!groups?.size) return { boxes: live, names: undefined };
    const next = new Map(live);
    const names = new Set<string>();
    for (const [name, members] of groups) {
      if (next.has(name)) continue;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const id of members) {
        const b = live.get(id);
        if (!b) continue;
        x0 = Math.min(x0, b.x);
        y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.w);
        y1 = Math.max(y1, b.y + b.h);
      }
      if (x0 === Infinity) continue;
      next.set(name, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      names.add(name);
    }
    return { boxes: next, names: names.size ? names : undefined };
  }, [live, groups]);

  const routed = useMemo(
    () => routeLinks({ links: drawn, boxes: withGroups, nodeBoxes, solo, groups: names, metric: theme.metric }),
    [drawn, withGroups, nodeBoxes, solo, names, theme],
  );

  if (routed.edges.length === 0) return null;

  return (
    <div
      className="dag-board-edges"
      style={{
        transform: `translate(${routed.origin.x}px, ${routed.origin.y}px)`,
        width: routed.size.w,
        height: routed.size.h,
      }}
    >
      <Edges
        edges={routed.edges}
        width={routed.size.w}
        height={routed.size.h}
        theme={theme}
        onPick={onPick}
        picked={picked}
        onBend={onBend}
        onStraighten={onStraighten}
        loose={routed.loose}
        onLoose={onLoose}
      />
    </div>
  );
}
