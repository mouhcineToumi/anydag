/**
 * What drawing a board needs and editing one does not — shared by the canvas (`App`) and the
 * read-only view (`BoardView`), so the two cannot come to disagree about when a board is finished
 * or which node a link lands on.
 *
 * Nothing here imports `src/edit/`: this module is on the read-only view's path, which is the path
 * that must not load the editor.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { BoardItem } from "@/board/types";
import { isDiagramType } from "@/board/types";
import { hasGraph } from "@/dsl/parse";
import type { InnerBox } from "@/layout/types";
import { drawnSettled } from "@/render/settled";

export type Sizes = Map<string, { w: number; h: number }>;
export type NodeBoxes = Map<string, Record<string, InnerBox>>;

/**
 * The sizes items report once drawn, and where each diagram's nodes sit inside it.
 *
 * Items that size themselves report back here; the flow reruns and the ones after them shift. Two
 * passes settle it: an unmeasured item is placed at a guess, measured, then placed for real. The node
 * boxes are kept apart from the sizes because the flow has no use for them, and re-running the layout
 * on every node that shifted a pixel is exactly what the sizes' own guard is there to prevent.
 */
export function useMeasures() {
  const [sizes, setSizes] = useState<Sizes>(new Map());
  const [nodeBoxes, setNodeBoxes] = useState<NodeBoxes>(new Map());
  const onMeasure = useCallback((id: string, size: { w: number; h: number }, nodes?: Record<string, InnerBox>) => {
    setSizes((prev) => {
      const was = prev.get(id);
      if (was && was.w === size.w && Math.abs(was.h - size.h) < 1) return prev;
      const next = new Map(prev);
      next.set(id, size);
      return next;
    });
    if (!nodes) return;
    setNodeBoxes((prev) => {
      const was = prev.get(id);
      if (was && sameBoxes(was, nodes)) return prev;
      const next = new Map(prev);
      next.set(id, nodes);
      return next;
    });
  }, []);
  return { sizes, nodeBoxes, onMeasure };
}

/**
 * The items that are one node and nothing else — a shape dropped on the paper, an atom — so a link
 * naming the item ends on the node rather than on the bare padding around it (`routeLinks`). Graph
 * dialects only: a chart of one series or a sequence of one participant is still a chart or a
 * sequence, and a link to it means the whole of it.
 */
export function useSolo(items: BoardItem[], nodeBoxes: NodeBoxes) {
  return useMemo(() => {
    const out = new Map<string, string>();
    for (const it of items) {
      if (!isDiagramType(it.type) || !hasGraph(it.type)) continue;
      const inner = Object.entries(nodeBoxes.get(it.id) ?? {});
      if (inner.length === 1 && !inner[0]![1].group) out.set(it.id, inner[0]![0]);
    }
    return out;
  }, [items, nodeBoxes]);
}

/**
 * Every group on the page and the items in it — what a link may name. Not derived
 * from a selection: a link to a group is drawn whether or not anybody has it selected.
 */
export function useGroups(items: BoardItem[]) {
  return useMemo(() => {
    const out = new Map<string, string[]>();
    for (const it of items) {
      if (!it.group) continue;
      const m = out.get(it.group);
      if (m) m.push(it.id);
      else out.set(it.group, [it.id]);
    }
    return out;
  }, [items]);
}

/**
 * `data-dag-ready` means *finished*, and the bar is higher than it looks.
 *
 * An item gets a placeholder box the moment it is parsed, so "every item has a position" is true
 * long before any diagram has been through ELK — a snapshot taken then catches a board of empty
 * frames. The real signal is that every item has reported its own measured size, which for a diagram
 * happens only once its layout comes back. `ready` is that, computed by the caller; this publishes
 * it, after the fonts, the equations and the code's colours (`drawnSettled`) and a frame, with the board's bounds beside it so a snapshot can size itself.
 *
 * Only one board on a page may publish: an embedded board passes `false`.
 */
export function usePublishReady(publish: boolean, ready: boolean, sizes: Sizes, bounds: unknown) {
  useEffect(() => {
    if (!publish) return;
    if (!ready) {
      delete document.documentElement.dataset.dagReady;
      return;
    }
    let live = true;
    /* A text card's equations are drawn once KaTeX lands, and the card's height with them. */
    void drawnSettled()
      .then(() => document.fonts.ready)
      .then(() => {
        if (!live) return;
        requestAnimationFrame(() => {
          document.documentElement.dataset.dagBounds = JSON.stringify(bounds);
          document.documentElement.dataset.dagReady = "1";
        });
      });
    return () => {
      live = false;
    };
  }, [publish, ready, sizes, bounds]);
}

/**
 * Whether two readings of a diagram's node boxes say the same thing.
 *
 * A diagram re-reports its nodes on every layout, and an identical reading arriving as a fresh
 * object would replace the map, change `nodeBoxes`' identity, and re-route every link on the board
 * for nothing. The same tolerance as the sizes' guard: ELK places on fractional pixels and
 * everything is snapped afterwards, so sub-pixel is not a move.
 */
function sameBoxes(a: Record<string, InnerBox>, b: Record<string, InnerBox>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const p = a[k];
    const q = b[k];
    if (!q || !p) return false;
    if (Math.abs(p.x - q.x) >= 1 || Math.abs(p.y - q.y) >= 1 || Math.abs(p.w - q.w) >= 1 || Math.abs(p.h - q.h) >= 1)
      return false;
    /* A circle turned into a diamond in the same box is a different outline for a link to meet. */
    if (p.shape !== q.shape || p.group !== q.group) return false;
    /* A figure's caption rewrapped in the same box moves where a link meets it. */
    if (JSON.stringify(p.hull) !== JSON.stringify(q.hull)) return false;
  }
  return true;
}
