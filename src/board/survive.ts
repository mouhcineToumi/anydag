import { parseItem } from "../dsl/diagnose";

import { nodeIdsOf } from "./parseBoard";
import type { Board, BoardItem } from "./types";

/**
 * What a rewrite of one diagram's body would break elsewhere on the board.
 *
 * A model rewriting an item sees only that item. The rest of the board can point INTO it — an
 * `edges` statement ending on `arch1.db` — and a rewrite that drops or renames an id leaves that link
 * hanging from a loose end (#173), with an error the person did not cause by hand. A model's rewrite
 * breaking a link it never saw is the failure mode this module exists for, and it answers before
 * the rewrite lands: which ids does something else point at, and does the new body still declare them.
 *
 * The declared-ids half is `nodeIdsOf` — the same function `resolveLinks` will judge the landed
 * body with one parse later — so this answer cannot disagree with what the board then decides. The
 * only cross-item references on a board are an item's own `#id` and the statements in `edges`
 * fences; a link naming the item itself has no node to lose (only the `#id` matters, and a rewrite
 * keeps that), so only `item.node` endpoints are endangered.
 *
 * Pure and relative-imported: the dev server's plugin loads this layer, and a proposed rewrite is
 * checked server-side in the fix loop before anything reaches the file.
 */

/** An id the rest of the board points at, and whether the new body still declares it. */
export interface Endangered {
  item: string;
  node: string;
}

/**
 * Every `{item, node}` endpoint that some `edges` statement points INTO one of these items.
 *
 * Both ends of every link, from every `edges` fence on the board; deduped, because a chain says its
 * middle twice and two links can end on the same card. Endpoints naming an item itself carry no
 * `node` and are not here — there is nothing in a body for them to lose.
 */
export function referencedInto(board: Board, itemIds: ReadonlySet<string>): Endangered[] {
  const out = new Map<string, Endangered>();
  for (const link of board.links) {
    for (const [side, end] of [
      ["from", link.from],
      ["to", link.to],
    ] as const) {
      /* A loose end already names nothing, so a rewrite has nothing of it left to lose. */
      if (link.loose === side || end.node === undefined || !itemIds.has(end.item)) continue;
      out.set(`${end.item}\0${end.node}`, { item: end.item, node: end.node });
    }
  }
  return [...out.values()];
}

/**
 * What a proposed rewrite of `item` does to the ids the rest of the board points at.
 *
 * `parsed: false` says the new body does not parse — reported *distinctly* from ids being lost,
 * because the caller wants to tell the model "your diagram does not parse" separately from "you
 * deleted db". A parse that fails only partially would otherwise read as every id dropped at once,
 * which is a diagnosis of the symptom rather than the cause. The new body is checked with the
 * item's own `dir`/`aspect`/`layout`, which a rewrite keeps on the fence line and which change
 * what the parser says.
 */
export type Survival = { parsed: false } | { parsed: true; lost: string[] };

/** Of the endpoints pointing into `item`, the ones `newBody` no longer declares. */
export function lost(board: Board, item: BoardItem, newBody: string, newType: BoardItem["type"] = item.type): Survival {
  /* A rewrite may change the type as well, and the new body means something only to the
     new type's parser. A retype drops `layout` with it — see `retyped` in `src/edit/rewrite.ts`. */
  const fields = { type: newType, dir: item.dir, aspect: item.aspect, layout: newType === item.type ? item.layout : undefined };
  const parsed = parseItem({ ...fields, body: newBody });
  if (parsed?.diagnostics.some((d) => d.severity === "error")) return { parsed: false };

  const declared = nodeIdsOf({ ...fields, body: newBody });
  if (!declared) return { parsed: true, lost: [] };

  const gone = referencedInto(board, new Set([item.id]))
    .map((e) => e.node)
    .filter((n) => !declared.has(n));
  return { parsed: true, lost: [...new Set(gone)] };
}
