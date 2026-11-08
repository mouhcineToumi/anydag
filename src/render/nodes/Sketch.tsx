import type { Node } from "@/dsl/ir";
import { figureParts } from "@/layout/figure";
import { inkPath } from "@/layout/ink";
import { outlineOf, textBoxOf, type ShapeKind } from "@/layout/shapes";
import type { Box } from "@/layout/types";
import type { Theme } from "@/theme/contract";

import { hueVars } from "../hue";
import { Icon, iconFor } from "../Icon";
import { emOf } from "./em";

/**
 * The sketch shapes: a wireframe's vocabulary, drawn in the theme's greys.
 *
 * Every other node component says something about a system — a tile that carries a kind glyph, a
 * header band over rows, a chip that names a type. These say nothing at all, on purpose. A box is a
 * box. What makes them look considered rather than crude is that the greys are the same greys the
 * diagrams use (`outline`, `outlineSoft`, `paper200`, `slate`, `muted`), so a wireframe beside an
 * architecture diagram reads as the same drawing rather than as an import.
 *
 * **A hue is bound, never defaulted** — the rule the whole renderer follows. `hueVars()` sets
 * `--dag-h` only when the node has one, and CSS falls back to the theme's default; a sticky is
 * yellow because `sketch.finish()` binds `hue = "ochre"` in the *parser*, which is a fact about
 * the model rather than a colour a component reached for.
 *
 * **Every shape draws at exactly `box`.** `width`/`height` are written inline with `box-sizing:
 * border-box`, so no padding, border or overflowing label can move the outer rectangle — which is
 * what keeps the dev size assertion in `DiagramItem` quiet whatever anyone types into a label.
 */

interface Props {
  node: Node;
  box: Box;
}

const place = (box: Box) => ({ left: box.x, top: box.y, width: box.w, height: box.h });

const shape = (node: Node, modifier: string) =>
  `dag-sketch dag-sketch--${modifier}${node.status === "muted" ? " dag-sketch--muted" : ""}`;

const shell = (node: Node, box: Box, modifier: string) => ({
  className: shape(node, modifier),
  "data-dag-node": node.id,
  "data-dag-kind": node.kind,
  style: { ...place(box), ...hueVars(node.hue) },
});

/** A plain rectangle. Its title sits in it and its meta under that, both clipped rather than wrapped. */
export function SketchBox({ node, box }: Props) {
  return (
    <div {...shell(node, box, "box")}>
      <span className="dag-sketch__text">
        <span className="dag-sketch__title" data-dag-title="" {...emOf(node)}>
          {node.title}
        </span>
        {node.meta ? <span className="dag-sketch__meta">{node.meta}</span> : null}
      </span>
    </div>
  );
}

/** A line of text with no chrome at all — a heading, a label, a caption standing on its own. */
export function SketchText({ node, box }: Props) {
  return (
    <div {...shell(node, box, "text")}>
      <span className="dag-sketch__title" data-dag-title="" {...emOf(node)}>
        {node.title}
      </span>
    </div>
  );
}

/** A filled pill: the one shape on a wireframe that is meant to look pressable. */
export function SketchButton({ node, box }: Props) {
  return (
    <div {...shell(node, box, "button")}>
      <span className="dag-sketch__label" data-dag-title="" {...emOf(node)}>
        {node.title}
      </span>
    </div>
  );
}

/** An outlined field. Its title is the placeholder, which is why it draws in placeholder grey. */
export function SketchInput({ node, box }: Props) {
  return (
    <div {...shell(node, box, "input")}>
      <span className="dag-sketch__placeholder" data-dag-title="" {...emOf(node)}>
        {node.title}
      </span>
    </div>
  );
}

/**
 * A picture that is not there yet: a rectangle with a diagonal cross, and a caption.
 *
 * The cross is drawn in percentages rather than in the box's own pixels so the SVG needs no
 * geometry from the layout — one less place for the drawing and the box to disagree. The caption is
 * the `meta`, falling back to the title, because `img hero "Hero shot"` should say something.
 */
export function SketchImg({ node, box }: Props) {
  const caption = node.meta ?? node.title;
  return (
    <div {...shell(node, box, "img")}>
      <svg className="dag-sketch__cross" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="0" x2="100%" y2="100%" />
        <line x1="100%" y1="0" x2="0" y2="100%" />
      </svg>
      {caption ? <span className="dag-sketch__caption">{caption}</span> : null}
    </div>
  );
}

/**
 * A geometric shape — a circle, a diamond, a cylinder, a speech bubble — with its words inside it.
 *
 * One component for all sixteen, because what differs between them is an outline and the outline
 * is data: `layout/shapes.ts` computes it from the box, and the router reads the same function to
 * know where an edge meets it. The `<svg>` is drawn at the box's own pixels rather than stretched
 * from a unit square, so a circle pulled wide is an ellipse with an even stroke, not an egg drawn in
 * calligraphy.
 *
 * The words sit in `textBoxOf` — the part of the box the shape can actually hold — centred, wrapping
 * and clipped. They never size the shape: the box is the author's, as for every sketch shape, and
 * the dev size assertion measures this `div`, which is exactly the box.
 */
export function SketchShape({ node, box, kind }: Props & { kind: ShapeKind }) {
  const o = outlineOf(kind, box.w, box.h);
  const t = textBoxOf(kind, box.w, box.h);
  return (
    <div {...shell(node, box, "shape")} data-dag-shape={kind}>
      <svg className="dag-sketch__outline" width={box.w} height={box.h} aria-hidden="true">
        <path className="dag-sketch__fill" d={o.d} />
        {o.detail ? <path className="dag-sketch__rim" d={o.detail} /> : null}
      </svg>
      <span className="dag-sketch__inside" style={{ left: t.x, top: t.y, width: t.w, height: t.h }}>
        <span className="dag-sketch__title" data-dag-title="" {...emOf(node)}>
          {node.title}
        </span>
        {node.meta ? <span className="dag-sketch__meta">{node.meta}</span> : null}
      </span>
    </div>
  );
}

/** A square of coloured paper. Ochre unless the author says otherwise — see `dsl/graph/sketch.ts`. */
export function Sticky({ node, box }: Props) {
  return (
    <div {...shell(node, box, "sticky")}>
      <span className="dag-sketch__note" data-dag-title="" {...emOf(node)}>
        {node.title}
      </span>
      {node.meta ? <span className="dag-sketch__hand">{node.meta}</span> : null}
    </div>
  );
}

/**
 * A freehand stroke — what the pen leaves behind.
 *
 * The path is all there is, so it draws like `SketchShape`'s outline draws: an `<svg>` at the box's
 * own pixels, no text, no fill, nothing for a title span to hold. `ink` takes no title — the shared
 * grammar would let one be written and the renderer draws nothing for it, which is why there is no
 * `data-dag-title` here and nothing for `{...emOf(node)}` to reach. The `d` comes whole from
 * `inkPath` (the Catmull-Rom smoothing is a render concern one layer down) and the stroke's *weight*
 * is the theme's, like every mark in the system.
 *
 * `overflow: visible` for the reason `.dag-sketch__outline` has it: a stroke running along the box's
 * own edge is clipped by half its width without it, and the half that disappears is exactly where a
 * pen was told it was drawing.
 */
export function SketchInk({ node, box }: Props) {
  return (
    <div {...shell(node, box, "ink")}>
      <svg className="dag-sketch__stroke" width={box.w} height={box.h} aria-hidden="true">
        <path d={inkPath(node.pts ?? [], box.w, box.h)} />
      </svg>
    </div>
  );
}

/**
 * A picture with a caption under it — a person, a house, a book.
 *
 * The picture is whatever `icon=` names, through the one resolver every card uses (`iconFor`): an
 * emoji in its own colours, the same emoji or a Lucide glyph in the node's hue, or a brand logo.
 * With no `icon=` the theme's `figure` glyph — a stick figure — is what a figure is. Where the
 * picture and the words go is `layout/figure.ts`'s answer, read here rather than worked out again,
 * so the caption can never start somewhere the layout did not leave room for it.
 *
 * **Nothing here draws a box.** No fill, no border: a picture on a whiteboard is the picture, and a
 * card around it would say "this is a component of a system", which is the one thing a figure is
 * not claiming. The hover ring and the pick outline every node wears are what say it is one thing.
 *
 * The caption span is drawn even when there is no caption, at no height, at the foot of the
 * picture: it is what the inline rename measures, and a double-click on a bare picture should open
 * the box where a caption would go rather than over the picture itself.
 */
export function SketchFigure({ node, box, theme }: Props & { theme: Theme }) {
  const parts = figureParts(node, box, theme);
  const icon = iconFor("figure", theme, node.icon);
  const at = (b: Box) => ({ left: b.x, top: b.y, width: b.w, height: b.h });
  return (
    <div {...shell(node, box, "figure")} data-dag-art={icon.mode}>
      <span className="dag-figure__pic" style={at(parts.pic)}>
        {parts.pic.w > 0 ? <Icon icon={icon} size={parts.pic.w} stroke={theme.metric.sketch.figureStroke} /> : null}
      </span>
      <span
        className="dag-figure__caption"
        data-dag-title=""
        style={at(parts.caption ?? { x: 0, y: parts.pic.y + parts.pic.h, w: box.w, h: 0 })}
        {...emOf(node)}
      >
        {node.title}
      </span>
      {parts.meta ? (
        <span className="dag-figure__meta" style={at(parts.meta)}>
          {node.meta}
        </span>
      ) : null}
    </div>
  );
}
