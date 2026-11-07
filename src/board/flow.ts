import { isLinkType, type Board, type BoardItem } from "./types";

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  /** True when the author pinned it; a pinned item never moves when a neighbour resizes. */
  pinned: boolean;
}

/**
 * Where every item sits.
 *
 * Two populations share one plane: items the author pinned with `x`/`y`, and items that carry no
 * position at all. Claude should be able to write a board with no coordinates and get a readable
 * layout, and to pin the one thing whose position matters without the rest jumping around.
 *
 * So: pinned items keep their coordinates and are never consulted; unpinned items flow in reading
 * order into rows below the lowest pinned item, wrapping at `flow.width`. The flow starts below
 * rather than around the pinned block because packing into the gaps looks arbitrary — the reader
 * cannot tell why an item landed where it did.
 */
export function placeItems(board: Board, page: string, sizes: Map<string, { w: number; h: number }>): Map<string, Placement> {
  const out = new Map<string, Placement>();
  /* An `edges` fence is an item in the file and nothing on the paper: it draws no box, so giving it
     a place would leave a hole in the flow the size of an item nobody can see. */
  const items = board.items.filter((it) => it.page === page && !it.hidden && !isLinkType(it.type));

  const sizeOf = (it: BoardItem): { w: number; h: number } => {
    const measured = sizes.get(it.id);
    return {
      w: it.w ?? measured?.w ?? 520,
      /* A measured height already honours `h=` — the item draws it as a minimum — so the measure
         wins where there is one; `h` is the guess before there is. */
      h: measured?.h ?? it.h ?? 200,
    };
  };

  let flowTop = 0;
  const pinned = items.filter((it) => it.x !== undefined || it.y !== undefined);
  for (const it of pinned) {
    const s = sizeOf(it);
    const x = it.x ?? 0;
    const y = it.y ?? 0;
    out.set(it.id, { x, y, ...s, pinned: true });
    flowTop = Math.max(flowTop, y + s.h);
  }

  const loose = items.filter((it) => it.x === undefined && it.y === undefined);
  if (loose.length === 0) return out;

  const gap = board.flow.gap;
  let cx = 0;
  let cy = pinned.length ? flowTop + gap : 0;
  let rowH = 0;

  for (const it of loose) {
    const s = sizeOf(it);
    if (cx > 0 && cx + s.w > board.flow.width) {
      cx = 0;
      cy += rowH + gap;
      rowH = 0;
    }
    out.set(it.id, { x: cx, y: cy, ...s, pinned: false });
    cx += s.w + gap;
    rowH = Math.max(rowH, s.h);
  }

  return out;
}

export function contentBounds(places: Map<string, Placement>): { x: number; y: number; w: number; h: number } {
  if (places.size === 0) return { x: 0, y: 0, w: 1, h: 1 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of places.values()) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + p.w);
    y1 = Math.max(y1, p.y + p.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
