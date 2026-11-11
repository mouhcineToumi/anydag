import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { Placement } from "@/board/flow";
import { resizeOfItem, type BoardItem } from "@/board/types";
import type { Side as ConnectSide } from "@/edit/connect";
import type { Dir, EditorCtl } from "@/edit/useEditor";
import { itemToSvg } from "@/export/svg";
import type { InnerBox } from "@/layout/types";
import type { Theme } from "@/theme/contract";

import { DiagramItem, type DiagramProps } from "./DiagramItem";
import { ImageItem } from "./ImageItem";
import { MarkdownItem } from "./MarkdownItem";
import { PromptItem } from "./PromptItem";

/**
 * Which card inside a diagram an event landed on, if any.
 *
 * Read out of the DOM rather than hit-tested against the layout, for the reason `connect.ts` gives:
 * the page already holds the answer the reader can see, and a second copy of the geometry is a
 * second chance to disagree with it.
 *
 * `data-dag-title-of` is the second answer and it is a chart's alone: SVG has no z-index, so a
 * chart draws every label after every mark and a legend row is therefore *outside* the `<g>`
 * carrying its id. Clicking the words "Mobile" in a legend is asking for that series, and the
 * only thing that can say so is the label itself.
 */
function nodeUnder(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined;
  /* A sequence fragment's tab is picked by a click as a card is, so it comes back as the "card" under
     the pointer; `data-dag-frag` is only ever drawn there. */
  const hit = target.closest<HTMLElement>("[data-dag-node],[data-dag-title-of],[data-dag-frag]");
  if (hit) return hit.dataset.dagNode ?? hit.dataset.dagTitleOf ?? hit.dataset.dagFrag ?? undefined;
  /* A group, a frame or a lane is picked by a click on it as a card is (#145) — it used to take a
     double-click and an Escape. Asked after the cards, which sit over it, and only inside the
     drawing: the item's own box carries `data-dag-group` too, and that one is the *board's* group. */
  const box = target.closest<HTMLElement>("[data-dag-group],[data-dag-lane],[data-dag-lane-label]");
  if (!box?.closest(".dag-item__body")) return undefined;
  return box.dataset.dagGroup ?? box.dataset.dagLane ?? box.dataset.dagLaneLabel ?? undefined;
}

/** Every side and corner, as draw.io has them — for an item whose box is its own. */
const HANDLES: Dir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
/**
 * A diagram gets the two that mean something.
 *
 * Its box is the layout's answer, and the handle writes `aspect=` — the shape ELK folds towards.
 * Width is the whole of that instruction, so the four corners and the two horizontal edges would be
 * four ways of asking the same question and two that cannot be answered at all.
 */
const ASPECT_HANDLES: Dir[] = ["e", "w"];
/* Four, one per side, sitting outside the resize handles. A corner has no outward direction a link
   would sensibly leave from, and eight dots around a card is a thicket rather than an affordance. */
const CONNECT: ConnectSide[] = ["n", "s", "e", "w"];

interface Props {
  item: BoardItem;
  place: Placement;
  boardName: string;
  theme: Theme;
  /**
   * Reports the intrinsic size of a self-sizing item back to the flow, and — for a diagram — where
   * each of its nodes sits inside it, which is what a board-level link needs to end on one.
   */
  onMeasure(id: string, size: { w: number; h: number }, nodes?: Record<string, InnerBox>): void;
  /**
   * The editor, or nothing under `?snapshot=1`, where the page is being photographed rather than
   * used. One stable object: `Item` is memoised, and a new identity every render would re-render
   * every item on the board on every keystroke Claude writes.
   */
  ctl?: EditorCtl;
  /**
   * The app is locked: selectable, never movable. No handles, no grab cursor, and a prompt
   * card drawn read-only. The editor refuses a write underneath; this is what stops one being offered.
   */
  locked?: boolean;
  selected: boolean;
  /** The only selected item — the one that gets the handles. Its toolbar is `SelectionBar`'s. */
  solo: boolean;
  /**
   * Whether something inside this diagram is picked — which takes the item's own handles away.
   *
   * A boolean rather than the pick itself, and that is the whole reason it is allowed to be a prop
   * at all. `pickedNode` is an object with a fresh identity on every pick, so `Item` would
   * re-render every diagram on the board whenever anybody clicked a card in one of them; this is
   * `false` for every item but the one involved, so the memo bails out exactly as it does for
   * `selected`. The *ring* is still painted rather than rendered — a gesture cannot wait a render
   * — and the handles that replace these are drawn by `NodeHandles` in the layer, where they can
   * be positioned in board coordinates without this component knowing anything about a layout.
   *
   * They are taken away rather than shown alongside because they would be two answers to one
   * question: eight squares and four dots around the frame, and four more around the card, with
   * nothing on either set saying which thing it would resize or connect.
   *
   * Which is also why this is *not* simply "a card is picked in here". A picked card wears handles
   * only in a dialect that has an edge to write (`growable()`), so a picked chart series hands
   * nothing over — and `App` passes false, or the chart would be left with no handles at all.
   */
  picked: boolean;
}

/**
 * One thing on the board.
 *
 * Memoised on the item's hash and its box, because the board re-parses on every keystroke Claude
 * writes and all but one item is unchanged. Position is a `transform` on the wrapper rather than
 * `left`/`top` so a move never triggers layout in the browser.
 *
 * The gestures live in `useEditor`: a press here is handed to it with the element, and it paints
 * the drag onto every selected item and commits once on release. What stays here is the choice of
 * body, the size report, and the chrome a selected item wears.
 */
export const Item = memo(
  function Item({ item, place, boardName, theme, onMeasure, ctl, locked = false, selected, solo, picked }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const box = useRef<HTMLDivElement>(null);

    /* `md` and `image` size themselves from their content: the width is known (author or default),
       the height is whatever the text wraps to. A diagram is the other way round — it reports both,
       from the layout — so it goes through `onSize` instead and this observer skips it. */
    const selfSizing = item.type === "md" || item.type === "image" || item.type === "prompt";
    useEffect(() => {
      const el = ref.current;
      /* An `h=` is drawn as a minimum height by the body, so the measure already includes it —
         and it must still be reported, or a board with one such item never becomes ready. */
      if (!el || !selfSizing) return;
      const report = () => onMeasure(item.id, { w: place.w, h: el.offsetHeight });
      report();
      const ro = new ResizeObserver(report);
      ro.observe(el);
      return () => ro.disconnect();
    }, [item.id, item.h, place.w, selfSizing, onMeasure]);

    /* Stable, so the body's own memo holds while only this wrapper changes — selected, moved, a
       card picked in it. As fresh closures they re-rendered every card of a diagram on
       each of those, and re-ran its size report, which re-rendered the page. */
    const onSize = useCallback<DiagramProps["onSize"]>((size, nodes) => onMeasure(item.id, size, nodes), [onMeasure, item.id]);
    const onPickEdge = useCallback((edge: string, extend: boolean) => ctl?.pickEdge(item.id, edge, extend), [ctl, item.id]);

    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = box.current;
      if (!ctl || !el) return;
      /* False means the press is a pan: let it bubble to the viewport, which is listening for
         exactly this. Otherwise the viewport must never see it, or it would pan at the same time.
         The card under the pointer goes with it — the editor picks one out on a second click, and
         reading the DOM is this side's job, not the editor's. */
      if (ctl.press(item.id, e, el, nodeUnder(e.target))) e.stopPropagation();
    };

    const onConnect = (side: ConnectSide) => (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = box.current;
      if (ctl && el) ctl.connect(item.id, e, el, side);
    };

    const onResize = (dir: Dir) => (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = box.current;
      if (!ctl || !el) return;
      e.stopPropagation();
      ctl.resize(item.id, e, el, dir);
    };

    /**
     * Double-click: rename what is under the pointer, in place.
     *
     * F1 made this open the *controls* for the card, which was the right move away from opening
     * forty lines of DSL and was still one indirection too many — a person who double-clicks a
     * label is asking to retype the label, in every drawing tool there is. So the gesture is the
     * inline input now, and Enter and the chip are what open the panel; `ctl.open` did not change.
     * A double-click on the frame, the padding or the header still opens the panel, because there
     * is nothing there to rename — the item's title is a fence attribute, and it has a field.
     */
    const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!ctl) return;
      e.stopPropagation();
      if (!ctl.rename(item.id, e.target as Element)) ctl.open(item.id);
    };

    /*
     * Export this item as a standalone SVG.
     *
     * Sized from the placement rather than from the DOM, because the DOM box is the item at
     * whatever the canvas is zoomed to and the file should be the diagram at 1:1. The height comes
     * from the measured element, since `place.h` is the flow's idea of it.
     */
    const exportSvg = async (): Promise<string | null> => {
      const el = box.current;
      if (!el) return null;
      const inner = el.querySelector<HTMLElement>(".dag-item__body");
      const zoom = Number((el.closest(".dag-viewport") as HTMLElement | null)?.dataset.zoom ?? 1) || 1;
      return itemToSvg(el, {
        width: Math.ceil(place.w),
        height: Math.ceil((inner?.getBoundingClientRect().height ?? place.h) / zoom),
        title: `${item.title ?? item.id} · ${item.type}`,
      });
    };

    /*
     * `window.__anydagSvg[id]`: this item's export, for everything that is not this component — the
     * selection toolbar's Export menu, and a headless caller with no toolbar to click, which is what
     * `anydag board export --format svg` evaluates after the page reports `data-dag-ready`. Re-registered every render so the handle always exports the current diagram,
     * not the one that existed when the item first mounted; removed on unmount so a deleted item
     * cannot leave a stale handle behind for a later item that reuses its id.
     */
    useEffect(() => {
      const w = window as unknown as { __anydagSvg?: Record<string, () => Promise<string | null>> };
      const registry = (w.__anydagSvg ??= {});
      registry[item.id] = exportSvg;
      return () => {
        if (registry[item.id] === exportSvg) delete registry[item.id];
      };
    });

    const resize = resizeOfItem(item);

    return (
      <div
        ref={box}
        className="dag-item"
        data-dag-item={item.id}
        data-dag-type={item.type}
        data-dag-movable={ctl && !locked ? "" : undefined}
        data-dag-selected={selected ? "" : undefined}
        data-dag-group={item.group}
        style={{ transform: `translate(${place.x}px, ${place.y}px)`, width: place.w }}
        onPointerDown={onPointerDown}
        onDoubleClick={ctl ? onDoubleClick : undefined}
      >
        <div className="dag-item__body" ref={ref}>
          {item.type === "md" ? (
            <MarkdownItem item={item} />
          ) : item.type === "image" ? (
            <ImageItem item={item} boardName={boardName} />
          ) : item.type === "prompt" ? (
            <PromptItem item={item} ctl={locked ? null : (ctl ?? null)} selected={selected} />
          ) : (
            <DiagramItem
              item={item}
              theme={theme}
              onSize={onSize}
              /* One prop, and the pick that answers it is *painted* rather than passed back down:
                 `Item` is memoised and a per-node prop would re-render every diagram on the board
                 whenever anybody clicked a card in one of them. See `paint()` in `useEditor`. */
              onPickEdge={ctl ? onPickEdge : undefined}
            />
          )}
        </div>
        {ctl && !locked && solo && !picked
          ? (resize === "box" ? HANDLES : resize === "aspect" ? ASPECT_HANDLES : []).map((dir) => (
              <div
                key={dir}
                className="dag-handle"
                data-dag-handle={dir}
                title={resize === "aspect" ? "Drag to reshape: the diagram folds to fit" : "Drag to resize"}
                onPointerDown={onResize(dir)}
              />
            ))
          : null}
        {ctl && !locked && solo && !picked
          ? CONNECT.map((side) => (
              <div
                key={`c-${side}`}
                className="dag-connect-handle"
                data-dag-connect={side}
                title="Drag to link this to something"
                onPointerDown={onConnect(side)}
              />
            ))
          : null}
      </div>
    );
  },
  (a, b) =>
    a.item.hash === b.item.hash &&
    a.item.note === b.item.note &&
    a.item.title === b.item.title &&
    a.item.subtitle === b.item.subtitle &&
    /* Not in the hash, and it cannot be: the hash keys the layout cache, and turning a header on
       and off does not change where ELK puts anything. It changes what is drawn, so it belongs
       here — without it a `frame=` edit is written to the file and nothing on screen moves. */
    a.item.frame === b.item.frame &&
    /* A prompt card's type select draws `as`, and `as` is in no hash: nothing is laid out from it. */
    a.item.as === b.item.as &&
    a.item.group === b.item.group &&
    /* A note's, a paragraph's or an image's colour: a fence attribute in no hash, like `frame`. It
       was missing here, so a hue picked in the panel was written and not drawn until something else
       redrew the item — deselecting it, usually. */
    a.item.hue === b.item.hue &&
    a.item.src === b.item.src &&
    a.item.w === b.item.w &&
    a.item.h === b.item.h &&
    a.place.x === b.place.x &&
    a.place.y === b.place.y &&
    a.place.w === b.place.w &&
    a.theme === b.theme &&
    a.boardName === b.boardName &&
    a.ctl === b.ctl &&
    a.locked === b.locked &&
    a.selected === b.selected &&
    a.solo === b.solo &&
    a.picked === b.picked,
);
