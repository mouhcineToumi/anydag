import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { Point } from "@/canvas/geometry";

import type { Renaming } from "./useEditor";

/**
 * Renaming a card, a container, a band or an edge label in place.
 *
 * **An input over the drawing, not `contentEditable` in it**, and there are four reasons rather
 * than one:
 *
 * - A card's box is the layout's answer, computed by arithmetic in `layout/size.ts` before anything
 *   exists in the DOM, and the renderer is obliged to produce exactly that box. An editable card
 *   would grow with what is typed into it, and the dev size assertion in `DiagramItem` would fire
 *   on every keystroke — which is not a false alarm, because the cards around it really would be
 *   in the wrong places.
 * - `Item` is memoised, and text typed into a node would have to reach it as a prop; every
 *   keystroke would re-render the whole diagram.
 * - The board file is the document. A `contentEditable` holds a second copy of the text, in the
 *   DOM, with its own idea of when it is finished — and this codebase has exactly one rule about
 *   that (there is no editor state that is not also in the file).
 * - What is drawn is not always what is written. A group draws a dot, a label and a sublabel in one
 *   element; an `img` draws its `meta` and falls back to its title. The box opens with the value
 *   read out of the *parse*, which is the thing being edited.
 *
 * It lives in the layer, so it pans and zooms with the board for free and needs no `data-zoom`
 * arithmetic of its own: the layer carries the transform, and everything below is in board units.
 * The element it covers is found in the DOM and measured through `toBoard`, which is the only
 * honest way to get from "the title of this card" to a rectangle — `size.ts` sizes a card, never
 * the text inside it.
 */

/** Where a name is *drawn*, which is not always inside the thing that carries the id. */
function nameElement(r: Renaming): HTMLElement | null {
  const scope = `[data-dag-item="${CSS.escape(r.item)}"]`;
  const q = CSS.escape(r.id);
  const find = (sel: string) => document.querySelector<HTMLElement>(`${scope} ${sel}`);
  if (r.what === "edge") return find(`[data-dag-edge-label="${q}"]`) ?? find(`[data-dag-edge="${q}"] .dag-edge-hit`);
  /* A lane's label is the band's *sibling* — it sits outside the band so a one-node lane still
     reads as one — so looking inside `[data-dag-lane]` finds nothing at all. */
  if (r.what === "lane") return find(`[data-dag-lane-label="${q}"]`);
  /* A chart's labels are drawn *after* every mark — SVG has no z-index — so the name of a series is
     not inside the `<g>` that carries its id, and the search below would find the marks and open the
     box over the bars. `data-dag-title-of` is where that name actually is. Asked before the host, and
     not as a fallback after it, for exactly that reason. */
  const labelled = find(`[data-dag-title-of="${q}"]`);
  /* A sequence fragment's branches are tabs of one frame: the one being renamed is `seg`. */
  const tab = find(`[data-dag-frag="${q}"][data-dag-branch="${r.seg}"]`);
  if (tab) return tab.querySelector<HTMLElement>("[data-dag-title]") ?? tab;
  if (labelled) return labelled;
  const host = find(`[data-dag-${r.what}="${q}"]`);
  /* A topic chip and the two pseudostates draw their text as the element itself, or draw none;
     covering the whole card is right in both cases. */
  return host?.querySelector<HTMLElement>("[data-dag-title]") ?? host;
}

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  font: string;
  weight: string;
  align: string;
}

const same = (a: Placed | null, b: Placed): boolean =>
  a !== null && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && a.w === b.w && a.h === b.h && a.font === b.font;

export function Rename({
  renaming,
  toBoard,
  onCommit,
  onCancel,
}: {
  renaming: Renaming;
  toBoard(clientX: number, clientY: number): Point;
  onCommit(text: string): void;
  onCancel(): void;
}) {
  const [at, setAt] = useState<Placed | null>(null);
  const input = useRef<HTMLInputElement>(null);
  /* Escape blurs the box, and blur commits; without this the cancel would be undone by its own
     side effect one tick later. Also stops a commit firing twice when Enter blurs. */
  const done = useRef(false);

  /*
   * After every render, deliberately, rather than when the target changes.
   *
   * The `+` gesture opens this on a card that does not exist yet: the body is written, the file
   * comes back, the parse runs and ELK answers, and only then is there an element to measure —
   * several renders later with nothing about `renaming` having changed. The same argument
   * `paint()` in `useEditor` makes, and the same answer: one `querySelector` per render is cheaper
   * than inventing a signal from inside a memoised, asynchronously laid out subtree.
   */
  useEffect(() => {
    const el = nameElement(renaming);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const style = getComputedStyle(el);
    const pad = 6;
    let a = toBoard(rect.left, rect.top);
    let b = toBoard(rect.right, rect.bottom);
    /* An edge with no label yet has no `<text>` to measure, so the fallback is its hit stroke —
       whose box is the whole curve. A fixed box on the curve's centre is the honest reading of
       "somewhere along this line", and a 400px-wide input over a long edge is not. */
    if (renaming.what === "edge" && !el.dataset.dagEdgeLabel) {
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      a = { x: cx - 70, y: cy - 12 };
      b = { x: cx + 70, y: cy + 12 };
    }
    const next: Placed = {
      x: a.x - pad,
      y: a.y - pad / 2,
      w: Math.max(96, b.x - a.x + pad * 2),
      h: Math.max(22, b.y - a.y + pad),
      font: style.font || `${style.fontSize} ${style.fontFamily}`,
      weight: style.fontWeight,
      align: style.textAlign === "center" ? "center" : "left",
    };
    setAt((was) => (same(was, next) ? was : next));
  });

  /* Focus once there is a box to focus, and select what is in it: a rename usually replaces. */
  useEffect(() => {
    if (!at) return;
    const el = input.current;
    if (el && document.activeElement !== el) {
      el.focus();
      el.select();
    }
  }, [at]);

  if (!at) return null;

  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(input.current?.value ?? "");
  };

  return (
    <input
      ref={input}
      className="dag-rename"
      /* Not `data-dag-rename`: the board list has owned that since M27 for the button that renames a
         *file*, and a selector meant to find one input found forty buttons. The exact hazard
         docs/architecture/things-that-will-bite.md names, and it does not need CSS to bite. */
      data-dag-rename-box={renaming.id}
      aria-label={`Rename ${renaming.id}`}
      defaultValue={renaming.text}
      spellCheck={false}
      style={
        {
          transform: `translate(${at.x}px, ${at.y}px)`,
          width: at.w,
          height: at.h,
          font: at.font,
          fontWeight: at.weight,
          textAlign: at.align,
        } as CSSProperties
      }
      /* The press must not reach the card underneath, which would move the pick or start a drag. */
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          done.current = true;
          onCancel();
        }
      }}
      onBlur={commit}
    />
  );
}
