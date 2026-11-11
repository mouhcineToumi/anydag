import { nodeIdsOf } from "@/board/parseBoard";
import { isDiagramType, isLinkType, itemName, type BoardItem } from "@/board/types";

import type { EndChoices } from "./EdgeEnds";

/**
 * What a board link's ends may name, for the menus in its panel (#145).
 *
 * The same three things `resolveLinks` in `parseBoard.ts` accepts, on the same page, in the same
 * spelling, so a choice made here is never one the parse then refuses:
 *
 * - **an item**, by its id — the whole card, frame or note;
 * - **a card inside a diagram**, as `item.node`, one section per diagram so a page of five
 *   diagrams that each have an `api` stays readable;
 * - **a board group**, by its name.
 *
 * An `edges` fence is not on the list: it draws nothing a line could end on.
 */
export function linkEndChoices(items: readonly BoardItem[], page: string): EndChoices {
  const here = items.filter((it) => it.page === page && !isLinkType(it.type));
  const out: [string, string[]][] = [["Items", here.map((it) => it.id)]];
  for (const it of here) {
    if (!isDiagramType(it.type)) continue;
    const ids = nodeIdsOf(it);
    if (ids && ids.size > 0)
      out.push([`In ${it.title ?? `${itemName(it.type)} ${it.id}`}`, [...ids].map((n) => `${it.id}.${n}`)]);
  }
  const groups = [...new Set(here.flatMap((it) => (it.group ? [it.group] : [])))];
  if (groups.length > 0) out.push(["Groups", groups]);
  return out;
}
