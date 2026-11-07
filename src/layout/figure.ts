import type { Node } from "@/dsl/ir";
import type { Theme } from "@/theme/contract";

import { fontOf, getMeasurer } from "./measure";
import type { Point } from "./shapes";
import type { Box } from "./types";

/**
 * A `figure` — a picture with a caption under it — as arithmetic, read by two readers.
 *
 * `size.ts` asks how big one is when nobody said, and `render/nodes/Sketch.tsx` asks where, inside
 * whatever box it was given, the picture and the words go. The same split `shapes.ts` makes for a
 * triangle's outline and the text box inside it, and for the same reason: a renderer that did its
 * own sums would one day disagree with the layout about where the caption starts, and the picture
 * would be clipped by the words it is labelling.
 *
 * **The picture is a square, and the caption decides the rest.** Left alone, a figure is
 * `figureSide` of picture over its caption, as wide as the picture or the caption — whichever is
 * wider, up to `figureCaptionW`, past which the words wrap and the figure grows down instead of
 * across. Its longest *word* is never broken: a single word wider than that widens the figure,
 * because the measurer's greedy wrap (`measure.lines`) keeps a word whole and a caption that CSS
 * broke mid-word would come out a line taller than the box.
 *
 * **Given a box, the picture takes what the words leave.** A resize writes `w=` and `h=`; the
 * caption is wrapped at the new width, and the picture is the largest square that fits above it.
 * The two together are centred vertically, so a box pulled taller than it needs keeps its picture
 * and its words together rather than parking the words at the foot of an empty rectangle.
 *
 * **No caption is a picture and nothing else.** The title is optional — the brief's own word — and
 * with none the figure is exactly its square, which is what makes a row of them a row of pictures.
 * The meta, when there is one, is a second line in the meta's mono under the caption, never wrapped.
 */

export interface FigureParts {
  /** The picture's square. */
  pic: Box;
  /** The title's lines, when there is a title. */
  caption: Box | null;
  /** The meta's one line, when there is a meta. */
  meta: Box | null;
}

/** The font the caption is measured in — and, through `fontOf`, the string the CSS draws it in. */
const captionFont = (node: Node, theme: Theme): string =>
  fontOf(theme, theme.type.figureCaption, node.bold === true ? theme.type.weightBold : 600, false, node.italic === true);

const metaFont = (theme: Theme): string => fontOf(theme, theme.type.nodeMeta, 400, true);

/** The widest single word, which the wrap will never break. */
const longestWord = (text: string, font: string): number =>
  Math.max(0, ...text.split(/\s+/).map((w) => (w ? getMeasurer().width(w, font) : 0)));

/**
 * How tall the words are in a box this wide: the gap, the caption's lines, the meta's one.
 *
 * Wrapped at the width *less* `textPad` either side — the inset a bare `text` shape keeps — because a
 * line measured to fill its box exactly paints a hair past it at any zoom but 100%: the canvas and
 * the page agree about the advance, not about where antialiasing puts the last glyph, and a caption
 * clipped to "Orders on the apr" at 74% was the result.
 */
function wordsHeight(node: Node, theme: Theme, w: number): { lines: number; h: number } {
  const s = theme.metric.sketch;
  const lines = node.title ? getMeasurer().lines(node.title, captionFont(node, theme), w - s.textPad * 2) : 0;
  const rows = lines + (node.meta ? 1 : 0);
  return { lines, h: rows > 0 ? s.figureGap + rows * s.figureLineH : 0 };
}

/**
 * The box a figure takes when nobody sized it — or sized one side of it.
 *
 * Not rounded to the grid, the way no card's text-derived size is: the layout snaps where a figure
 * *stands*, and a height rounded up would be slack `figureParts` hands straight to the picture,
 * which then comes out a few pixels bigger than `figureSide` for no reason anybody could see.
 */
export function figureSize(node: Node, theme: Theme): { w: number; h: number } {
  const s = theme.metric.sketch;
  const grid = theme.metric.grid;
  const measure = getMeasurer();

  /* As wide as the picture or the words, whichever is wider, up to the caption's own measure. */
  const font = captionFont(node, theme);
  const title = node.title ? measure.width(node.title, font) : 0;
  const meta = node.meta ? measure.width(node.meta, metaFont(theme)) : 0;
  const words = Math.max(Math.min(title, s.figureCaptionW), Math.min(meta, s.figureCaptionW));
  const natural = Math.ceil(Math.max(words, node.title ? longestWord(node.title, font) : 0)) + (words > 0 ? s.textPad * 2 : 0);

  /* One side given: the picture follows it. `figure f w=128` is a bigger picture, not a 128-wide
     strip over a 64px one, and `h=200` is a taller figure because its picture grew — which is the
     rule a circle given one side follows, one file over. */
  if (node.w !== undefined && node.h !== undefined) return { w: node.w, h: node.h };
  if (node.w !== undefined) return { w: node.w, h: node.w + wordsHeight(node, theme, node.w).h };
  if (node.h !== undefined) {
    const side = Math.max(grid, node.h - wordsHeight(node, theme, Math.max(natural, s.figureSide)).h);
    return { w: Math.max(natural, side), h: node.h };
  }
  const w = Math.max(s.figureSide, natural);
  return { w, h: s.figureSide + wordsHeight(node, theme, w).h };
}

/** Where the picture and the words go inside a figure's box. */
export function figureParts(node: Node, box: { w: number; h: number }, theme: Theme): FigureParts {
  const s = theme.metric.sketch;
  const words = wordsHeight(node, theme, box.w);
  const side = Math.max(0, Math.min(box.w, box.h - words.h));
  const top = Math.max(0, (box.h - side - words.h) / 2);
  const pic = { x: (box.w - side) / 2, y: top, w: side, h: side };
  const below = top + side + (words.h > 0 ? s.figureGap : 0);
  /* The full width: the inset the wrap was measured without is the CSS's padding (`nodes.css`), so
     a glyph painted a hair wide lands in the padding, inside what `overflow: hidden` keeps. */
  const caption = words.lines > 0 ? { x: 0, y: below, w: box.w, h: words.lines * s.figureLineH } : null;
  const meta = node.meta ? { x: 0, y: below + (caption ? caption.h : 0), w: box.w, h: s.figureLineH } : null;
  return { pic, caption, meta };
}

/**
 * Where a line meets a figure: the picture's square, and under it the caption's band.
 *
 * A figure's box is as wide as its caption, and the caption is usually wider than the picture —
 * "Orders on the app" under a 64px phone — so a line stopping at the box stopped a caption's
 * width short of the thing it pointed at. The router casts its anchor in along the side's normal to
 * this polygon instead (`onHull`), the way it meets a triangle on its slanted side: at the height
 * of the picture a line reaches the picture, at the height of the words it reaches the words, and
 * from above it lands on the picture's top. In the box's own coordinates, for `route.ts`.
 */
export function figureHull(parts: FigureParts, box: { w: number; h: number }): Point[] {
  const { pic } = parts;
  const words = [parts.caption, parts.meta].filter((b): b is Box => b !== null);
  const square = [
    { x: pic.x, y: pic.y },
    { x: pic.x + pic.w, y: pic.y },
    { x: pic.x + pic.w, y: pic.y + pic.h },
    { x: pic.x, y: pic.y + pic.h },
  ];
  if (words.length === 0 || pic.w === 0) return square;
  /* The band runs from the foot of the picture to the foot of the last line, the box's full width —
     the lines are centred in it and the widest of them is what made the box that wide. */
  const top = pic.y + pic.h;
  const bottom = Math.min(box.h, Math.max(...words.map((b) => b.y + b.h)));
  return [
    { x: pic.x, y: pic.y },
    { x: pic.x + pic.w, y: pic.y },
    { x: pic.x + pic.w, y: top },
    { x: box.w, y: top },
    { x: box.w, y: bottom },
    { x: 0, y: bottom },
    { x: 0, y: top },
    { x: pic.x, y: top },
  ];
}
