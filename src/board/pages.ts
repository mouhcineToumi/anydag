import type { BoardPage } from "./types";

/**
 * The page list with one page moved.
 *
 * `before` is the page it lands in front of, or `null` for the end — the same "before this one"
 * address `insertBefore` uses, and the one a drop computes from which half of a tab it let go
 * over. Nothing else about the board changes: an item names its page by `page=<id>` and the ids
 * are untouched, so a reorder is purely the order of the tabs.
 *
 * A move that changes nothing returns **the same array**, so the caller can skip the write rather
 * than putting an identical frontmatter through `applyPatch` and landing an undo entry that undoes
 * nothing. That covers dropping a tab on itself, on the neighbour it already precedes, and on a
 * page id that is not on this board.
 */
export function reorderPages(pages: BoardPage[], id: string, before: string | null): BoardPage[] {
  const from = pages.findIndex((p) => p.id === id);
  if (from < 0) return pages;
  if (before === id) return pages;

  const rest = pages.filter((p) => p.id !== id);
  const at = before === null ? rest.length : rest.findIndex((p) => p.id === before);
  if (at < 0) return pages;
  if (at === from) return pages;

  const out = rest.slice();
  out.splice(at, 0, pages[from]!);
  return out;
}

/**
 * Where a tab dropped on `target` wants to go, given which half of it the pointer let go over.
 *
 * Separated from the gesture because it is the only arithmetic in it: "after the last tab" is
 * `null` rather than an id, and the tab being dragged is not its own neighbour — dropping on the
 * right half of the tab immediately before you is where you already are, which `reorderPages`
 * then recognises as a non-move.
 */
export function dropBefore(pages: BoardPage[], target: string, after: boolean): string | null {
  const at = pages.findIndex((p) => p.id === target);
  if (at < 0) return null;
  if (!after) return target;
  return pages[at + 1]?.id ?? null;
}
