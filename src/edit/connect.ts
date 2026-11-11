import { endText } from "@/board/links";
import type { BoardLink, LinkEnd } from "@/board/types";
import { addEdgeEnd, appendHop, edgeSpan, removeRefs, retargetRef, type EdgeSpan } from "@/dsl/restate";
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
  /**
   * A row inside `node` — `api.content`. Only a diagram's own edge can name one: a board link
   * splits on the last dot, so `d.api.content` would read as a node called `content` in an item
   * called `d.api`. See `wholeCard`.
   */
  row?: string;
  /**
   * `node` is a group's boundary inside the diagram, not a card: `workspace --> intake`. The same
   * restriction as a row, for the same reason — a link's far end must be a card the diagram declares.
   */
  boundary?: boolean;
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
 * diagram — the collision `docs/architecture/things-that-will-bite.md` records — so it is read off the item element itself here
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
  if (inside && !(lone && group)) {
    /* A row is a port on the card it is in, and it wins over the card the way a card wins over the
       item: the highlight says which, and a drop on the header is still the whole card. */
    const row = el?.closest<HTMLElement>("[data-dag-row]");
    const port = row && node?.contains(row) ? row.dataset.dagRow : undefined;
    return { item: item.dataset.dagItem, node: inside, ...(port ? { row: port } : null) };
  }
  /* A boundary inside the diagram, which is `data-dag-group` on something that is *not* the item —
     `closest` finds the item's own first when the pointer is over bare paper inside it, so the
     answer is only trusted when it is a different element. No card under the pointer, or the card
     would have answered above. */
  const bound = el?.closest<HTMLElement>("[data-dag-group]");
  if (bound && bound !== item && item.contains(bound) && bound.dataset.dagGroup) {
    return { item: item.dataset.dagItem, node: bound.dataset.dagGroup, boundary: true };
  }
  if (group) return { item: group, group: true };
  return { item: item.dataset.dagItem };
}

/**
 * The same end with what only a diagram's own body can say taken off — a row becomes its card, a
 * boundary becomes its diagram — for a link that crosses between items.
 *
 * `d.api.content` and `d.workspace` are not endpoints an `edges` fence can resolve (it splits on the
 * last dot and looks the node up among the cards), so writing them would draw a diagnostic instead
 * of a line. Falling back to the nearest thing it *can* name is what a drop is asking for anyway:
 * the person pointed at that diagram.
 */
export function wholeCard(t: Target): Target {
  if (t.boundary) return { item: t.item };
  if (t.row !== undefined) return { item: t.item, node: t.node };
  return t;
}

/** The id a diagram's own body writes for this end: a card, a boundary, or `card.row`. */
export const bodyText = (t: Target): string => (t.row !== undefined ? `${t.node}.${t.row}` : (t.node ?? t.item));

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

/**
 * Whether a hanging link's loose stub may be dropped on `to` (#173): anything a link can name,
 * except the thing it already hangs from — or a card in the same diagram, which would be a link
 * between two cards of one diagram, and that belongs in the diagram's own body (see `addLink`).
 */
export function reattachable(link: BoardLink, to: Target): boolean {
  if (!link.loose) return false;
  const has = link.loose === "to" ? link.from : link.to;
  return wholeCard(to).item !== has.item;
}

/**
 * A hanging link's statement with its loose end dropped on `to` (#173): the name that is nowhere
 * becomes `to`'s, wherever the line says it, and nothing else on the line changes — the label, the
 * arrow, `via=` and the other ends stay as written. A chain through the missing name is mended at
 * every hop that named it, as #168's `retargetRef` mends a diagram's. `null` when there is nothing
 * to write.
 */
export function reattachLink(src: string, link: BoardLink, to: Target): string | null {
  if (!link.loose || !reattachable(link, to)) return null;
  const next = retargetRef(src, endText(link[link.loose]), endText(wholeCard(to)));
  return next === src ? null : next;
}

/**
 * A fence body with a hanging link taken out (#173): the missing name off its statement by
 * `removeNode`'s rules, which is what `dropLinks` does for a deleted item — a bus loses that
 * source, a chain is split rather than joined, and a statement with nothing left goes. Only this
 * one line; the same name somewhere else is a link nobody picked.
 */
export function removeLooseLink(body: string, line: number, ref: string): string {
  const lines = body.split("\n");
  const src = lines[line - 1];
  if (src === undefined) return body;
  const next = removeRefs(src, (word) => word === ref);
  if (next === src) return removeLinkLine(body, line);
  lines.splice(line - 1, 1, ...(next.trim() === "" ? [] : next.split("\n")));
  return lines.join("\n").trim() === "" ? "" : lines.join("\n");
}

/**
 * How a drop folds into a statement that is already there, instead of adding one of its own.
 *
 * - `bus` — `a --> c` and a drop from `b` onto `c` becomes `a & b --> c`; a drop *from* `f` where
 *   `f --> a` already stands becomes `f --> a & b`. One statement, so state draws one trunk and one
 *   label, which a line per pair cannot say.
 * - `chain` — a drop from the end of `a --> b` (from `b`) onto `c` becomes `a --> b --> c`.
 *
 * `null` when there is no statement to join, and the caller writes a new line the way it always did.
 */
export type Join = "bus" | "chain";

/**
 * A body with the drop folded into a statement of it, or `null` when there is none to fold into, or
 * the body unchanged when the two are already joined.
 *
 * The ends are compared as written — the text a person would have typed — and only a statement
 * whose end is *exactly* the one dropped on (or dragged from) is joined: with `a & b --> c` and `d --> c`
 * both standing, a drop onto `c` could mean either, and picking by file order is the one answer
 * that needs no guess about intent. Converging is tried before fanning out. A middle list of a chain
 * is shared by two arrows, so a bus only ever grows a statement's first list or its last.
 */
export function joinEdge(body: string, from: string, to: string, how: Join): string | null {
  const lines = body.split("\n");
  const parsed: { at: number; e: EdgeSpan }[] = [];
  lines.forEach((text, at) => {
    const e = edgeSpan(text);
    if (e) parsed.push({ at, e });
  });
  const only = (list: EdgeSpan["refs"][number] | undefined, id: string) =>
    list?.tokens.length === 1 && list.tokens[0]!.value === id;
  const put = (at: number, next: string) => lines.map((l, i) => (i === at ? next : l)).join("\n");

  if (how === "chain") {
    for (const { at, e } of parsed) {
      if (only(e.refs[e.refs.length - 1], from)) return put(at, appendHop(lines[at]!, to));
    }
    return null;
  }

  /* Already said, in any statement: nothing to write. Checked first, or a drop that repeats an edge
     would join its source into some *other* statement that happens to end at the same card. */
  for (const { e } of parsed) {
    for (let k = 0; k < e.arrows.length; k++) {
      const [l, r] = [e.refs[k]!, e.refs[k + 1]!];
      if (l.tokens.some((t) => t.value === from) && r.tokens.some((t) => t.value === to)) return body;
    }
  }
  for (const { at, e } of parsed) {
    if (only(e.refs[1], to)) return put(at, addEdgeEnd(lines[at]!, 0, "from", from));
  }
  for (const { at, e } of parsed) {
    if (only(e.refs[e.refs.length - 2], from)) return put(at, addEdgeEnd(lines[at]!, e.arrows.length - 1, "to", to));
  }
  return null;
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
