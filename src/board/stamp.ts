import { str } from "./attrs";
import { locateItems } from "./locate";
import { applyPatch, type SetOp } from "./patch";
import { isItemType } from "./types";

/**
 * Every item on a board carries its id in the file.
 *
 * An item nobody named has always had an id: `locateItems` numbers it `md-2`, and that number is
 * what a selection, an `edges` line and a patch op address. But it is a *position*, recomputed on
 * every parse, so it is only stable for as long as nothing anonymous of that type is added above
 * it. A reference from somewhere else — a search hit, a share link to one card — needs more than
 * that, so the stamp writes each item's current id onto its fence: exactly the id it already had,
 * which is what makes stamping invisible to everything that was already pointing at it.
 *
 * Three cases, and the stamp is `applyPatch`'s own pinning in each, not a second writer:
 *
 * - **A fence with no `#id`** gets the one it was parsed with.
 * - **Loose prose** is wrapped in an `md` fence to have somewhere to carry it — which is what a
 *   drag has always done to it.
 * - **A written id somebody else already has** — the second of two pasted copies — keeps the fresh
 *   one `locateItems` gave it, written down, so two items never answer to one name.
 *
 * Nothing else changes: no position, no body, no attribute order beyond the id going first. A
 * stamped board stamps to itself, which is what lets every write run it without a diff.
 *
 * Browser-free, like everything the local server imports.
 */
export function stampItems(text: string): string {
  const { items } = locateItems(text, isItemType);
  const ops: SetOp[] = items
    .filter((it) => it.prose || it.duplicateOf !== undefined || !str(it.attrs, "id"))
    /* An empty `attrs` is `applyPatch`'s pin, which writes the parsed id *first*, where a person
       writes `#id`; only a duplicate names its replacement outright, in the place the old one was. */
    .map((it): SetOp => ({ id: it.id, attrs: it.duplicateOf !== undefined ? { id: it.id } : {} }));
  if (!ops.length) return text;
  const done = applyPatch(text, ops);
  /* Every op names an item the same scan just found, so this cannot refuse; if it ever did, the
     text as it was is the right answer — an unstamped item still has its positional id. */
  return done.ok ? done.text : text;
}
