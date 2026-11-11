import { ICON_KINDS, type DiagramType, type Graph, type Node } from "@/dsl/ir";
import type { Theme } from "@/theme/contract";

import { fontOf, getMeasurer } from "./measure";
/* `./ink` from here is `layout/ink.ts` itself — the two new modules share a basename — so the
   point arithmetic is reached by alias, as `shapes.ts` reaches the IR. */
import { boundsOf } from "@/dsl/ink";
import { SQUARE_SHAPES, type ShapeKind } from "./shapes";
import { figureHull, figureParts, figureSize } from "./figure";
import type { SizedNode } from "./types";

/**
 * How big is a node.
 *
 * Every number here is arithmetic over `theme.metric` — never a literal, never a measurement of
 * something already on screen. Two consequences worth the discipline: the same input lays out to
 * the same pixel on every machine, and swapping the theme resizes the diagram instead of
 * overflowing it.
 *
 * The renderer must produce exactly these boxes. A dev-only assertion in `DiagramItem` compares the
 * two and shouts, because a card that renders 3px taller than it was laid out is how diagrams start
 * touching.
 */

/**
 * `h=` is a minimum height for every kind, the same rule the item attribute follows one layer up.
 *
 * A wrapper rather than a line in each of the twelve branches, and it is safe to grow the box from
 * the bottom: `rowY` measures downward from the top, so every row anchor a taller card carries is
 * still where the text is. The renderer honours it for free — every node draws at exactly the box
 * the layout hands back.
 */
export function sizeNode(node: Node, theme: Theme, type?: DiagramType): SizedNode {
  const measured = measureNode(node, theme, type);
  const size = node.h !== undefined && node.h > measured.h ? { ...measured, h: node.h } : measured;
  /* A figure is met on its picture and caption rather than on its box, and the hull is taken from
     the final box, after the minimum above, so the two cannot disagree. */
  return node.kind === "figure" ? { ...size, hull: figureHull(figureParts(node, size, theme), size) } : size;
}

/** `type` decides what `db` and `container` are: a C4 box in `c4`, an ordinary card elsewhere. */
function measureNode(node: Node, theme: Theme, type?: DiagramType): SizedNode {
  const m = theme.metric;
  const t = theme.type;
  const measure = getMeasurer();

  /**
   * The font a node's title is *measured* in.
   *
   * The emphasis flags ride along (`bold` → the theme's bold weight, `italic` → the slant), and
   * they have to be in this string rather than applied by CSS afterwards: sizing is what decides
   * the card's box, and a box decided against a regular weight while the drawing renders a bold
   * one is the disagreement the dev size assertion in `DiagramItem` exists to catch. Every place
   * that measures `node.title` to decide a box goes through this.
   *
   * `weight` is what the title measured at before there were flags, and it is a parameter because
   * it is not 600 everywhere: a sketch input's placeholder is drawn in the meta's regular weight.
   * A node carrying no emphasis has to measure byte-identically to what it measured before this
   * existed, or every board moves — so the flag is what changes the weight, never this helper.
   */
  const titleFontFor = (size: number, mono = false, weight = 600): string =>
    fontOf(theme, size, node.bold === true ? t.weightBold : weight, mono, node.italic === true);

  const titleFont = titleFontFor(t.nodeTitle);
  const metaFont = fontOf(theme, t.nodeMeta, 400, true);
  const rowNameFont = fontOf(theme, t.rowName, 500, true);
  const rowDetailFont = fontOf(theme, t.rowDetail, 400, true);

  const rowY: SizedNode["rowY"] = [];
  const w = (text: string | undefined, font: string) => (text ? measure.width(text, font) : 0);

  /**
   * Whether words this wide fit the width the author wrote, for the sketch kinds that draw one line
   * and clip it. `lead` is what stands between the box's left edge and the first glyph —
   * its padding, and a border where it has one — and the words may run on into the right padding,
   * which is where `overflow: hidden` keeps them: past the border is where they are cut off. Half a
   * pixel of slack, since canvas and page agree on an advance to a fraction.
   */
  const fits = (text: number, lead: number, border = 0): { clipped: true } | null =>
    node.w !== undefined && lead + text > node.w - border + 0.5 ? { clipped: true } : null;

  /* A C4 box is the one card whose description wraps, and only `c4` draws one. `db` was missing
     from this branch, so a C4 database *with* a description was sized as a plain card and drawn as
     a box; and `container`/`db` in an `arch` diagram were the other way round. The renderer makes
     the same choice on the same input. */
  const c4 = node.kind === "extsystem" || (type === "c4" && (node.kind === "container" || node.kind === "db"));
  const kind = c4 ? "extsystem" : node.kind === "container" || node.kind === "db" ? "service" : node.kind;

  switch (kind) {
    case "start":
      return { w: m.node.start, h: m.node.start, rowY };
    case "end":
    case "loose":
      return { w: m.node.end, h: m.node.end, rowY };
    case "fork":
    case "join":
      /* The bar's length is set by the router once it knows how many lines it collects; this is the
         floor it never goes below. */
      return { w: m.node.bar, h: m.node.barMin, rowY };

    case "decision": {
      const text = w(node.title, titleFontFor(t.decision));
      return { w: Math.max(m.node.stepW, text + m.node.decisionPadX * 2), h: m.node.decisionH, rowY };
    }

    case "usecase": {
      const id = w(node.id, fontOf(theme, t.ucId, 600, true));
      const title = w(node.title, titleFontFor(t.ucTitle));
      return {
        w: Math.max(m.node.ucW, id + m.node.gap + title + m.node.ucPadX * 2),
        h: m.node.ucH,
        rowY,
      };
    }

    case "step":
    case "action": {
      /* A step is a fixed-width card so a column of them lines up — but its meta line is mono and
         does not wrap, so \`kubectl apply --context prod\` was clipped mid-word and every agent that
         hit it went back to add \`w=\`. The card grows to its meta, up to the same cap as any card;
         a lane column is as wide as its widest step, so the rhythm survives. */
      const metaW = node.meta ? w(node.meta, metaFont) + m.group.dot + m.node.stepRowGap + m.node.stepPadX * 2 : 0;
      return { w: node.w ?? Math.min(m.node.plainMaxW, Math.max(m.node.stepW, Math.ceil(metaW))), h: m.node.stepH, rowY };
    }

    case "state":
      return { w: node.w ?? m.node.stateW, h: m.node.stateH, rowY };

    /*
     * The sketch vocabulary: `w=`/`h=` are the box, and what is measured is only the floor under it.
     *
     * The other way round from everything above — a card is as big as its content and `w=` caps it
     * — because these shapes are not describing anything. A button is 96px wide because that is how
     * wide the author drew a button, and the text inside it is what has to fit, not what decides.
     */
    case "box": {
      const text = Math.max(w(node.title, titleFont), w(node.meta, metaFont));
      return {
        w: node.w ?? Math.max(m.sketch.boxMinW, Math.ceil(text + m.sketch.padX * 2)),
        h: node.h ?? m.sketch.boxMinH,
        rowY,
        ...fits(text, m.sketch.padX + m.line.hair, m.line.hair),
      };
    }

    case "text":
      return {
        w: node.w ?? Math.ceil(w(node.title, titleFont) + m.sketch.textPad * 2),
        h: node.h ?? m.sketch.textH,
        rowY,
        ...fits(w(node.title, titleFont), m.sketch.textPad),
      };

    case "button":
      return {
        w: node.w ?? Math.max(m.sketch.buttonMinW, Math.ceil(w(node.title, titleFont) + m.sketch.buttonPadX * 2)),
        h: node.h ?? m.sketch.buttonH,
        rowY,
        /* Centred, so it spills out of both sides at once and is cut the moment it is wider. */
        ...fits(w(node.title, titleFont), 0),
      };

    case "input": {
      /* An input's title is its placeholder, which draws in the meta's mono at the meta's size —
         only the emphasis follows the node, as it does on every other title. */
      const text = w(node.title, titleFontFor(t.nodeMeta, true, 400));
      return {
        w: node.w ?? Math.max(m.sketch.inputMinW, Math.ceil(text + m.sketch.inputPadX * 2)),
        h: node.h ?? m.sketch.inputH,
        rowY,
        ...fits(text, m.sketch.inputPadX + m.line.hair, m.line.hair),
      };
    }

    case "img":
      /* A placeholder has nothing to measure: it is a rectangle with a cross through it, and the
         caption underneath is clipped rather than allowed to decide how big the picture is. */
      return { w: node.w ?? m.sketch.imgMinW, h: node.h ?? m.sketch.imgMinH, rowY };

    case "sticky":
      /* Square by default, like the paper. It does not grow to its text — a sticky you cannot fit
         your sentence on is a sticky that says the sentence is too long. */
      return { w: node.w ?? m.sketch.stickyW, h: node.h ?? m.sketch.stickyH, rowY };

    case "circle":
    case "ellipse":
    case "triangle":
    case "diamond":
    case "hexagon":
    case "pentagon":
    case "octagon":
    case "star":
    case "parallelogram":
    case "trapezoid":
    case "cylinder":
    case "document":
    case "stadium":
    case "cloud":
    case "callout":
    case "arrow": {
      /* The geometric shapes: the box is the shape, and nothing measured decides it — the text wraps
         inside `textBoxOf` and is clipped there, like a sticky's. A circle given one side is a
         circle: the missing one follows it, so `circle c "x" w=200` is not a 200×120 egg. */
      const square = SQUARE_SHAPES.has(node.kind as ShapeKind);
      const dw = square ? m.sketch.shapeSide : m.sketch.shapeW;
      const dh = square ? m.sketch.shapeSide : m.sketch.shapeH;
      if (square && node.w !== undefined && node.h === undefined) return { w: node.w, h: node.w, rowY };
      if (square && node.h !== undefined && node.w === undefined) return { w: node.h, h: node.h, rowY };
      return { w: node.w ?? dw, h: node.h ?? dh, rowY };
    }

    case "figure":
      /* A picture with its caption under it: the square and the words, measured in
         `layout/figure.ts`, which the renderer reads back to know where each one goes. */
      return { ...figureSize(node, theme), rowY };

    case "ink": {
      /* A stroke is its points: the box is their bounds, and `w=`/`h=` arrive only from a resize or
         `scaleFixed`, when the path scales from those bounds into the new box (`layout/ink.ts`).
         A statement with no `pts=` — a stroke the parser can still see but not yet measure — still
         reports a box a pointer can reach: one grid step, the floor image placement uses. */
      const b = boundsOf(node.pts ?? []);
      return { w: node.w ?? Math.max(b.w, m.grid), h: node.h ?? Math.max(b.h, m.grid), rowY };
    }

    case "commit": {
      /* A commit is a label on a branch line, not a card: it takes the width of its message and a
         height that keeps two lanes visually apart without shouting. */
      const label = w(node.title, titleFontFor(t.stepTitle));
      /* The tag is a pill *beside* the label, in mono, with its own padding — so the width is the
         sum of the two, not the longer. Taking the longer left every tagged commit overflowing by
         the shorter of them, and \`v1.2.0-rc1\` read as \`v1 rc\`. */
      const tag = node.meta ? m.node.gap + w(node.meta, fontOf(theme, t.pill, 600, true)) + m.node.keyPadX * 2 : 0;
      /* A dot and a label, so the width is the text plus the dot plus padding — no icon tile. */
      return {
        w: node.w ?? Math.max(120, label + tag + m.group.dot + m.node.gap + m.node.padX * 2),
        h: Math.round(m.node.plainH * 0.62),
        rowY,
      };
    }

    case "extsystem": {
      /* C4 is the one kind whose description wraps. Width is fixed so a row of containers lines up;
         height follows the text, which is why C4 boards are tall. */
      const width = node.w ?? m.node.c4W;
      const inner = width - m.node.c4PadX * 2;
      const descLines = measure.lines(node.desc ?? "", fontOf(theme, t.c4Desc), inner);
      const h = m.node.c4Pad * 2 + m.tile.sizeC4 + 7 + t.c4Type + 7 + descLines * Math.round(t.c4Desc * t.c4DescLeading);
      return { w: width, h: Math.round(h), rowY };
    }

    case "person":
    case "actor": {
      if (node.desc) {
        const width = node.w ?? m.node.c4W;
        const inner = width - m.node.c4PadX * 2;
        const descLines = measure.lines(node.desc, fontOf(theme, t.c4Desc), inner);
        const h = m.node.c4Pad * 2 + m.tile.sizeC4 + 7 + t.c4Type + 7 + descLines * Math.round(t.c4Desc * t.c4DescLeading);
        return { w: width, h: Math.round(h), rowY };
      }
      break;
    }

    case "class":
    case "interface":
    case "abstract":
    case "enum": {
      const header = node.stereotype ? m.node.headerClassStereo : m.node.headerClass;
      let widest = w(node.title, titleFontFor(t.nodeTitle));
      let h = header + 2;
      for (const comp of node.compartments ?? [node.rows]) {
        if (comp.length === 0) continue;
        h += 1 + m.node.rowPad;
        for (const row of comp) {
          rowY.push({ id: row.id, y: h + m.node.rowClass / 2 });
          h += m.node.rowClass;
          const text = `${row.vis ?? ""} ${row.name} ${row.detail ?? ""}`;
          widest = Math.max(widest, measure.width(text, rowNameFont));
        }
        h += m.node.rowPad;
      }
      return { w: node.w ?? Math.max(m.node.classMinW, widest + m.node.padX * 2), h: Math.round(h), rowY };
    }

    case "entity": {
      let widest = w(node.title, titleFontFor(t.nodeTitle)) + m.group.dot + m.node.gap;
      let h = 1 + m.node.headerEntity + 1 + m.node.rowPad;
      for (const row of node.rows) {
        rowY.push({ id: row.id, y: h + m.node.rowEntity / 2 });
        h += m.node.rowEntity;
        widest = Math.max(
          widest,
          measure.width(row.name, rowNameFont) + m.node.gap + measure.width(row.detail ?? "", rowDetailFont) + 34,
        );
      }
      h += m.node.rowPad + 1;
      return { w: node.w ?? Math.max(m.node.entityMinW, widest + m.node.padXEntity * 2), h: Math.round(h), rowY };
    }
  }

  /* The default: an icon-first card, with rows when it declares ports. This is `arch`'s whole
     vocabulary and the shape rule 8 is about — the glyph carries the kind. */
  const hasIcon = ICON_KINDS.has(node.kind);
  const lead = hasIcon ? m.tile.size + m.node.gap : 0;
  const textW = Math.max(w(node.title, titleFont), w(node.meta, metaFont));
  let width = node.w ?? Math.min(m.node.plainMaxW, Math.max(m.node.plainMinW, lead + textW + m.node.padX * 2));

  if (node.rows.length === 0) return { w: width, h: m.node.plainH, rowY };

  let widest = 0;
  for (const row of node.rows) {
    widest = Math.max(widest, measure.width(row.name, rowNameFont) + m.node.gap + measure.width(row.detail ?? "", rowDetailFont));
  }
  width = node.w ?? Math.min(m.node.plainMaxW, Math.max(width, widest + m.node.padX * 2));

  let h = 1 + m.node.headerArch + 1 + m.node.rowPad;
  for (const row of node.rows) {
    rowY.push({ id: row.id, y: h + m.node.rowArch / 2 });
    h += m.node.rowArch;
  }
  h += m.node.rowPad + 1;

  return { w: width, h: Math.round(h), rowY };
}

export function sizeGraph(graph: Graph, theme: Theme): Record<string, SizedNode> {
  const out: Record<string, SizedNode> = {};
  for (const node of graph.nodes) out[node.id] = sizeNode(node, theme, graph.type);
  return out;
}

/** Edge labels need a box too, so ELK can reserve room rather than routing through them. */
export function sizeLabels(graph: Graph, theme: Theme): Record<string, { w: number; h: number }> {
  const measure = getMeasurer();
  const font = fontOf(theme, theme.type.edgeLabel, 600, true);
  const out: Record<string, { w: number; h: number }> = {};
  for (const e of graph.edges) {
    if (!e.label) continue;
    const w = Math.max(measure.width(e.label, font), measure.width(e.label2 ?? "", font));
    out[e.id] = { w: Math.ceil(w), h: e.label2 ? theme.type.edgeLabel * 2 + 4 : theme.type.edgeLabel + 2 };
  }
  return out;
}
