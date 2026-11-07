import type { AttrValue } from "@/board/attrs";
import type { PatchOp } from "@/board/patch";
import { resizeOfItem, type BoardItem } from "@/board/types";
import { SHAPE_KINDS } from "@/dsl/ir";
import { replaceLine, setGeometry } from "@/dsl/restate";

import { boxesOf, fixedGraph, loneShape, scaleFixed, type LaidOut } from "./build";
import { union, type Box } from "./snap";

/**
 * Resizing a group as one thing: what the eight handles on a group's dashed box mean,
 * with no pointer in it — the half of the gesture `useEditor.resizeGroup` hands its boxes to.
 *
 * A group is a `group=` shared by fence lines and nothing else, so resizing one is resizing every
 * member **by the same factor, about the same corner**: the box around them goes from `g0` to
 * `g1`, and each member keeps its place in the arrangement — a stroke that touched the one beside
 * it still touches it, which is the whole of what somebody grouping a drawing wants from this.
 * What each member does to follow depends on what its own handles would have done, and there are
 * three answers:
 *
 * - **Its box scales** — a note, an image, a chart, a prompt card: the author's `w=`/`h=`, exactly
 *   what the item's own handles write. A note's text does not scale, it reflows; `h=` is a minimum
 *   and the note is as tall as its words need.
 * - **Its drawing scales** — a lone shape or pen stroke, a `sketch`, anything opened
 *   `layout=fixed`: the shapes' own sizes, as `loneShape`'s and `scaleFixed`'s branches of the
 *   single resize write them. The factor is applied to the **drawing**, not to the frame around it:
 *   a frame is the drawing plus a constant padding, and scaling the padding would slide every stroke
 *   in a grouped sketch a few pixels off the one it met — exactly the drawing this was asked for.
 * - **It slides** — a diagram ELK lays out, or one of the five house layouts: its box is the
 *   layout's answer and no factor can be written onto it (`aspect` refolds, it does not scale). It
 *   keeps its size and moves so that it holds the same place in the space around it: one against
 *   the left edge stays against it, one centred stays centred.
 */

/** How one member follows the group's box. */
type Follows = "box" | "drawing" | "slide";

export interface Member {
  id: string;
  /** The member's box on the board when the gesture began. */
  from: Box;
  follows: Follows;
  /**
   * For a drawing: where it sits inside the frame, and how big it is — read off the layout, so the
   * padding is whatever the renderer actually drew rather than a theme number restated here.
   */
  inner?: { left: number; top: number; w: number; h: number };
}

/**
 * A kind whose one given side decides the other — every geometric shape (the square ones keep
 * square on one side, and none has a height anything measured decides) and a figure, whose picture
 * follows its width. `SHAPE_KINDS` rather than `layout/shapes.ts`'s square list, because `src/edit/`
 * reads the grammar and not the layout; writing both sides of an ellipse is merely redundant.
 */
const linked = (kind: string): boolean => kind === "figure" || (SHAPE_KINDS as readonly string[]).includes(kind);

/** What each member follows with, decided once when the gesture begins and read on every move. */
export function memberOf(item: BoardItem, from: Box, laid: LaidOut | null): Member {
  const mode = resizeOfItem(item);
  if (mode !== "box") return { id: item.id, from, follows: "slide" };
  const lone = loneShape(item);
  const node = lone ? laid?.nodes[lone.id] : undefined;
  if (lone && node) {
    /* A bare frame is its one shape plus the same padding all round. */
    return { id: item.id, from, follows: "drawing", inner: { left: (from.w - node.w) / 2, top: (from.h - node.h) / 2, w: node.w, h: node.h } };
  }
  const content = laid && fixedGraph(item) ? boxesOf(laid) : null;
  if (laid && content && content.w > 0 && content.h > 0) {
    /* The padding is the same on three sides round what the layout drew; a header, if the author
       asked for one, is above. What it drew is the boxes and any line or label reaching past them
, so the boxes sit in from it by their corner — `size` says how big it was, and a
       page from before that field had no lines outside the boxes. */
    const drawn = laid.size ?? { w: content.x + content.w, h: content.y + content.h };
    const pad = (from.w - drawn.w) / 2;
    const head = from.h - drawn.h - pad;
    const inner = { left: pad + content.x, top: head + content.y, w: content.w, h: content.h };
    return { id: item.id, from, follows: "drawing", inner };
  }
  return { id: item.id, from, follows: "box" };
}

/** What a member draws: a drawing's shapes without the frame's padding, anything else its box. */
const contentOf = (m: Member): Box =>
  m.follows === "drawing" && m.inner ? { x: m.from.x + m.inner.left, y: m.from.y + m.inner.top, w: m.inner.w, h: m.inner.h } : m.from;

/**
 * The box the group is scaled about: the union of what its members **draw**, not of their frames.
 * A bare frame is padding nobody can see, so a stroke on the far side of a pull that was anchored
 * to its frame's corner still moved by the padding times the factor less one — the corner that
 * held still was eight pixels outside anything drawn. Anchored to the drawing, it does not move.
 */
export const groupOf = (members: readonly Member[]): Box => union(members.map(contentOf));

/** Where the dashed box goes: around every member's frame as `place` puts it — what `App` draws from the places after. */
export const framesOf = (members: readonly Member[], g0: Box, g1: Box): Box => union(members.map((m) => place(m, g0, g1)));

/**
 * The smallest the group's box may be pulled to, per axis.
 *
 * **The clamp is on the factor, never on a member** — `scaleFixed`'s rule, one level up: flooring
 * one member at a minimum while the rest keep shrinking is the arrangement quietly changing shape.
 * So no factor is ever small enough to take any member that scales under one grid step (a stroke
 * already that thin, a flat line's degenerate axis, is left out of the question: it has nothing to
 * lose), and a sliding member — whose size cannot follow — is never wider than the box around it.
 */
export function minimum(members: readonly Member[], g0: Box, grid: number): { w: number; h: number } {
  let fx = 0;
  let fy = 0;
  let w = grid * 4;
  let h = grid * 4;
  for (const m of members) {
    if (m.follows === "slide") {
      w = Math.max(w, m.from.w);
      h = Math.max(h, m.from.h);
      continue;
    }
    const sw = m.inner?.w ?? m.from.w;
    const sh = m.inner?.h ?? m.from.h;
    if (sw > grid) fx = Math.max(fx, grid / sw);
    if (sh > grid) fy = Math.max(fy, grid / sh);
  }
  return { w: Math.max(w, g0.w * fx), h: Math.max(h, g0.h * fy) };
}

/** Along one axis: where something `len` long at `p` goes when the span `a0`+`l0` becomes `a1`+`l1`, keeping its size. */
const slack = (p: number, len: number, a0: number, l0: number, a1: number, l1: number): number =>
  l0 > len ? a1 + ((p - a0) * (l1 - len)) / (l0 - len) : a1 + (p - a0);

/** The factors the group was scaled by, per axis — `1` on an axis the handle did not pull. */
const factors = (g0: Box, g1: Box): { sx: number; sy: number } => ({
  sx: g0.w > 0 ? g1.w / g0.w : 1,
  sy: g0.h > 0 ? g1.h / g0.h : 1,
});

/** Where one member's frame goes when the group's box goes from `g0` to `g1`. */
export function place(m: Member, g0: Box, g1: Box): Box {
  const { sx, sy } = factors(g0, g1);
  const { from } = m;
  if (m.follows === "slide") {
    return { x: slack(from.x, from.w, g0.x, g0.w, g1.x, g1.w), y: slack(from.y, from.h, g0.y, g0.h, g1.y, g1.h), w: from.w, h: from.h };
  }
  if (m.follows === "drawing" && m.inner) {
    const { left, top, w, h } = m.inner;
    /* The drawing's corner is what scales about the group's; the frame is put back around it. */
    return {
      x: g1.x + (from.x + left - g0.x) * sx - left,
      y: g1.y + (from.y + top - g0.y) * sy - top,
      w: from.w + w * (sx - 1),
      h: from.h + h * (sy - 1),
    };
  }
  return { x: g1.x + (from.x - g0.x) * sx, y: g1.y + (from.y - g0.y) * sy, w: from.w * sx, h: from.h * sy };
}

/**
 * What the drag paints on one member, so the preview is the answer rather than a guess at it: a box
 * is its new rectangle, a drawing is scaled in place about its corner — strokes and all, which only
 * lasts until the write lands and the layout draws it at its new size — and a slide is only moved.
 */
export function paintOf(m: Member, g0: Box, g1: Box): { x: number; y: number; w?: number; h?: number; sx?: number; sy?: number } {
  const at = place(m, g0, g1);
  if (m.follows === "box") return at;
  if (m.follows === "slide" || !m.inner) return { x: at.x, y: at.y };
  const { sx, sy } = factors(g0, g1);
  /* Scaled about the frame's corner, the padding scales with it, so the frame is put where the
     drawing lands less the scaled padding. */
  return { x: at.x + m.inner.left - m.inner.left * sx, y: at.y + m.inner.top - m.inner.top * sy, sx, sy };
}

/**
 * Every write the gesture makes: one op per member that changed, or none. The caller adds the pins
 * and commits them together, so one ctrl+Z puts the whole group back.
 *
 * `laid` is the member's own `data-dag-layout`, which a drawing's writers need to know where the
 * layout put each shape. A member whose drawing will not parse any more is written as a box — the
 * bar every writer here holds: never a body that does not parse.
 */
export function memberOps(item: BoardItem, m: Member, g0: Box, g1: Box, laid: LaidOut | null, grid: number): PatchOp | null {
  const { sx, sy } = factors(g0, g1);
  const at = place(m, g0, g1);
  const attrs: Record<string, AttrValue | null> = {};
  const x = Math.round(at.x);
  const y = Math.round(at.y);
  /* A position is written whole or not at all: a height with no place to hang it is the case the
     single resize pins for, and a member half-placed is a member that moves on the next reflow. */
  if (x !== Math.round(m.from.x) || y !== Math.round(m.from.y)) {
    attrs.x = x;
    attrs.y = y;
  }
  let body: string | undefined;
  if (m.follows === "box") {
    if (sx !== 1) attrs.w = Math.max(grid, Math.round(at.w));
    if (sy !== 1) attrs.h = Math.max(grid, Math.round(at.h));
  } else if (m.follows === "drawing" && m.inner && laid) {
    const lone = loneShape(item);
    const fixed = lone ? null : fixedGraph(item);
    if (lone) {
      /* Only the axes that moved: a side pull that wrote the other one would freeze a shape's
         text-derived height for good — `scaleFixed`'s rule, for the one-shape case. **Except where
         one side alone is not an answer about one side**: a square shape given only `w=` stays
         square and a figure's picture follows its width (`size.ts`), so a pull east written as
         `w=` alone came out taller as well — a circle doubled both ways while the group's height
         held still and the preview drew it stretched. For those both sides are written, which is
         what the shape's own handles write (`resizeShape`), and nothing measured decides a
         geometric shape's height for the second write to freeze. */
      const both = (sx !== 1 || sy !== 1) && linked(lone.kind);
      const geom = {
        ...(sx !== 1 || both ? { w: Math.max(grid, m.inner.w * sx) } : {}),
        ...(sy !== 1 || both ? { h: Math.max(grid, m.inner.h * sy) } : {}),
      };
      const line = item.body.split("\n")[lone.line - 1];
      if (line !== undefined && (geom.w !== undefined || geom.h !== undefined)) body = replaceLine(item.body, lone.line, setGeometry(line, geom));
    } else if (fixed) {
      body = scaleFixed(fixed, laid, item.body, sx, sy, grid);
    }
    /* The frame hugs what it holds, so a fence box left over from before goes on the scaled axes —
       the single resize's rule, and for the same reason. */
    if (sx !== 1) attrs.w = null;
    if (sy !== 1) attrs.h = null;
    if (body === item.body) body = undefined;
  }
  /* Clearing a box the fence never had is no change, and a member with no change is no write. */
  for (const k of ["w", "h"] as const) if (attrs[k] === null && item[k] === undefined) delete attrs[k];
  if (body === undefined && Object.keys(attrs).length === 0) return null;
  return body === undefined ? { id: item.id, attrs } : { id: item.id, attrs, body };
}
