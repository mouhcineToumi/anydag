import { endText } from "@/board/links";
import type { LinkEnd } from "@/board/types";
import type { Box } from "./snap";

/**
 * Drawing a link with the pointer: what a drop means, and what it writes.
 *
 * The gesture lives in `useEditor` like every other one. What is here is the part with no pointer
 * in it — which end the drop landed on, what statement that is, and where a statement sits in the
 * fence's body — so it can be tested without a browser and read without one.
 *
 * **A drop is resolved from the DOM, not from geometry.** Every card inside a diagram already
 * carries `data-dag-node` and every item carries `data-dag-item`, so `document.elementFromPoint` and
 * two `closest()` calls say exactly what is under the pointer, including which card inside which
 * diagram. Hit-testing the boxes ourselves would mean keeping a second copy of a layout the page
 * already has, and getting a different answer from the one the reader can see.
 */

export interface Target {
  /** An item's id, or — with `group` set — a board-level group's name. Matches `LinkEnd`. */
  item: string;
  node?: string;
  /** `item` names a group. See `targetAt`, and `LinkEnd` for what the link then anchors on. */
  group?: boolean;
}

/**
 * What a pointer is over: a card inside a diagram, a board-level group, an item, or nothing.
 *
 * **A member of a group answers for the group**, which is the rule a *click* has followed since
 * M19 — `withGroups` widens a press on any member to the whole family — and doing anything else
 * here would mean a group could be dropped onto only in the gaps between the things in it. The
 * cost is that a member cannot be singled out as an endpoint while it is grouped, and ungrouping
 * is the way to it; a click has a second press to pick a member out and a drop has no equivalent
 * to spend.
 *
 * A card inside a diagram still wins, because it is the more specific thing and because a
 * diagram's own group vocabulary is a different grammar one level down — **unless it is the item's
 * only card**, in which case the card *is* the item. That is the `solo` rule `routeLinks` already
 * applies from the other side, counted off the DOM here rather than taken from the parse, which is
 * this function's whole premise. It is not a corner: a pen stroke is a `sketch` holding one `ink`
 * node, so without it a drop on the drawing somebody had just grouped resolved to the stroke and
 * the group could be reached only in the gaps between its strokes.
 *
 * `data-dag-group` is on `.dag-item` for the board-level group *and* on a boundary inside a
 * diagram — the collision `CLAUDE.md` records — so it is read off the item element itself here
 * rather than through a `closest()` that could escape the item and find the wrong one.
 */
export function targetAt(el: Element | null): Target | null {
  const item = el?.closest<HTMLElement>("[data-dag-item]");
  if (!item?.dataset.dagItem) return null;
  const node = el?.closest<HTMLElement>("[data-dag-node]");
  /* A `data-dag-node` in some *other* item cannot happen — an item's subtree is its own — but the
     check costs nothing and says what the pair means. */
  const inside = node && item.contains(node) ? node.dataset.dagNode : undefined;
  const group = item.dataset.dagGroup;
  const lone = inside !== undefined && item.querySelectorAll("[data-dag-node]").length === 1;
  if (inside && !(lone && group)) return { item: item.dataset.dagItem, node: inside };
  if (group) return { item: group, group: true };
  return { item: item.dataset.dagItem };
}

/** The line an `edges` fence gains when a link is drawn. */
export const linkStatement = (from: LinkEnd, to: LinkEnd): string => `${endText(from)} --> ${endText(to)}`;

/** That line appended to a fence body, with one blank line only where the body already has content. */
export function appendLink(body: string, statement: string): string {
  const kept = body.replace(/\s+$/, "");
  return kept ? `${kept}\n${statement}` : statement;
}

/**
 * A fence body with one 1-based line taken out.
 *
 * **A statement is the unit, not a link.** `a --> b --> c` is one line and two links, so deleting
 * either takes the line and both. Every link the pointer draws is a line of its own, so the two
 * only diverge on text somebody wrote by hand — where seeing the whole statement go is the honest
 * behaviour anyway, since half a chain is not a thing the grammar can say.
 */
export function removeLinkLine(body: string, line: number): string {
  const lines = body.split("\n");
  if (line < 1 || line > lines.length) return body;
  lines.splice(line - 1, 1);
  /* A body that is now nothing but blank lines is nothing: the fence stays, empty, rather than
     accumulating the whitespace of every link that was ever deleted from it. */
  return lines.join("\n").trim() === "" ? "" : lines.join("\n");
}

/** Whether a link may be drawn between these two ends: not to itself, and not to its own card. */
export const connectable = (from: Target, to: Target): boolean =>
  from.item !== to.item || (from.node !== undefined && to.node !== undefined && from.node !== to.node);

export type Side = "n" | "s" | "e" | "w";

const NORMAL: Record<Side, { x: number; y: number }> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  e: { x: 1, y: 0 },
  w: { x: -1, y: 0 },
};

/** Where a connect handle sits on its item, in board coordinates. */
export function handleAt(box: Box, side: Side): { x: number; y: number } {
  switch (side) {
    case "n":
      return { x: box.x + box.w / 2, y: box.y };
    case "s":
      return { x: box.x + box.w / 2, y: box.y + box.h };
    case "e":
      return { x: box.x + box.w, y: box.y + box.h / 2 };
    case "w":
      return { x: box.x, y: box.y + box.h / 2 };
  }
}

/**
 * The line drawn while a link is being pulled, as markup for the guides overlay.
 *
 * Not the real router. The router needs both boxes and there is no second box until the pointer
 * lands on one; what a person needs mid-gesture is a line that leaves the handle the way the real
 * one will and follows the pointer, so the arm off the handle uses the side's own normal and the
 * far end simply aims. On release the real route replaces it, and the two agree closely enough
 * that nothing visibly jumps.
 */
export function connectSvg(
  from: { x: number; y: number },
  to: { x: number; y: number },
  side: Side,
  over: boolean,
  dotR: number,
): string {
  const n = NORMAL[side];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const reach = Math.max(40, Math.min(160, Math.hypot(dx, dy) * 0.4));
  const c1 = { x: from.x + n.x * reach, y: from.y + n.y * reach };
  const len = Math.hypot(dx, dy) || 1;
  const c2 = { x: to.x - (dx / len) * reach * 0.5, y: to.y - (dy / len) * reach * 0.5 };
  const r = (v: number) => Math.round(v * 10) / 10;
  return [
    `<path class="dag-connect" d="M${r(from.x)},${r(from.y)} C${r(c1.x)},${r(c1.y)} ${r(c2.x)},${r(c2.y)} ${r(to.x)},${r(to.y)}"/>`,
    `<circle class="dag-connect__end${over ? " dag-connect__end--over" : ""}" cx="${r(to.x)}" cy="${r(to.y)}" r="${dotR}"/>`,
  ].join("");
}
