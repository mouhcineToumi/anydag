import type { PointerEvent as ReactPointerEvent } from "react";

import { growable } from "./build";
import type { Side as ConnectSide } from "./connect";
import type { EditorCtl } from "./useEditor";

/** The four sides, which is all a link or a `+` has an opinion about. A corner points nowhere. */
const SIDES: ConnectSide[] = ["n", "s", "e", "w"];

/**
 * The handles on a picked card: four to link from, four to grow from.
 *
 * **In the layer, not in the item**, and that is the load-bearing decision. `Item` is memoised and
 * knows nothing about layouts, so it has no way to position anything over one card inside its own
 * diagram; `App` already holds every diagram's node boxes — it needs them to route a board link
 * into a card — so it can place this in board coordinates the same way it places the dashed box
 * around a selected group. Nothing about `Item`'s props or its memo comparator has to know a card
 * can be picked, beyond the one boolean that hides the item's own handles while these are up.
 *
 * The two families share the four side midpoints with the item's, thirty pixels and ten pixels out
 * respectively, so a person moving between an item and a card inside it finds the same controls in
 * the same places. That is also why the item's are hidden rather than drawn alongside: eight
 * squares and four dots around the frame plus eight more around the card is not an affordance, it
 * is a thicket, and nothing on either set would say which thing it acted on.
 *
 * The container takes no pointer, so the card underneath is still clickable everywhere the handles
 * themselves are not — a pick has to be able to move to the next card without letting go first.
 *
 * **Both families are the dialect's to have**, which is `growable()`: each writes an edge, and two
 * dialects have nothing to write one with. A picked series therefore wears no handles at all, and
 * the item's own are still there once Escape lets go of the pick.
 */
export function NodeHandles({
  ctl,
  item,
  type,
  node,
  box,
}: {
  ctl: EditorCtl;
  item: string;
  /** The item's type: whether a card here can grow a neighbour at all. */
  type: string;
  node: string;
  box: { x: number; y: number; w: number; h: number };
}) {
  const onConnect = (side: ConnectSide) => (e: ReactPointerEvent<HTMLDivElement>) =>
    ctl.connect(item, e, e.currentTarget, side, { node, box });
  const onGrow = (side: ConnectSide) => (e: ReactPointerEvent<HTMLDivElement>) =>
    ctl.grow(item, e, e.currentTarget, side);

  if (!growable(type)) return null;

  return (
    <div
      className="dag-nodetools"
      data-dag-node-tools={node}
      style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}
    >
      {SIDES.map((side) => (
        <div
          key={`c-${side}`}
          className="dag-connect-handle"
          data-dag-connect={side}
          title="Drag to link this card to another"
          onPointerDown={onConnect(side)}
        />
      ))}
      {SIDES.map((side) => (
        <div
          key={`p-${side}`}
          className="dag-plus"
          data-dag-plus={side}
          role="button"
          aria-label={`Add a card to the ${side === "n" ? "top" : side === "s" ? "bottom" : side === "e" ? "right" : "left"}`}
          title="Click or pull to add a card here"
          onPointerDown={onGrow(side)}
        >
          +
        </div>
      ))}
    </div>
  );
}
