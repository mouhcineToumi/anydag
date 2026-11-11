import type { CSSProperties } from "react";
import { MARK_DOT, MARK_FRAME, MARK_LINE } from "./markPaths";

/**
 * The AnyDag mark: a frame that does not close, and a line drawn with a brush pen that leaves
 * through the gap toward a dot.
 *
 * The drawing is one 64-unit square. Three sides of a rounded frame, then up the right edge, where
 * it stops short of the top; the top edge stops short of the corner too. Between those two ends is
 * a hole, and the line, a coil that unwinds, passes *through* the hole rather than over the frame.
 * That is the whole idea, and it is why the frame is open rather than a `<rect>` with something
 * drawn on top: an overlap reads as a drawing mistake, a gap reads as an escape.
 *
 * Both the frame and the line are drawn with one pen whose width changes as it goes. The line lands
 * light, swells through the loop and lifts off to a point short of the dot; the frame tapers where
 * it starts and ends at the opening. A `stroke-width` cannot vary along a path, so each is a filled
 * outline, and the outlines are generated: `scripts/brand/mark.mjs` writes them to `markPaths.ts`
 * along with every other copy of the mark in the repository. Change the mark there, never here.
 *
 * Two constraints decided how it is coloured, and both come from `scripts/check-literals.mjs`:
 *
 * - **Rule 1, no colour anywhere in `src/`, admits no exceptions.** So the frame and the line are
 *   `currentColor` and the dot is `var(--dag-color-accent)`. The mark therefore inherits whatever
 *   it is placed in — ink on the toolbar, paper on a dark ground — and the accent comes from the
 *   active theme rather than from the brand's design, which is the same split `chrome.css` already
 *   makes: the brand's design document owns the mark's geometry, `themes/<name>/theme.json` owns what
 *   colour anything in `src/` is drawn in.
 * - **Rule 3, no SVG style literals, is scoped to `src/render/`.** `src/ui/` is chrome and exempt,
 *   which is the reason this file is here and not beside the node views.
 *
 * `size` is the box, not the line: the drawing scales as one. Below about 20px the line's thin ends
 * disappear and the coil fills in, which is what `public/favicon.svg` is for — a heavier cut of the
 * same drawing, from the same script. Do not reach for this component at favicon sizes.
 */
export function Logo({
  size = 20,
}: {
  /** Width and height in px. The mark is square. */
  size?: number;
}) {
  return (
    <svg
      className="dag-logo"
      data-dag-logo
      viewBox="0 0 64 64"
      width={size}
      height={size}
      /* Always hidden, and there is no prop to override it. Every placement either sits beside
         the name as live text (`Lockup`) or
         under a heading that says where you are, so a labelled mark could only ever make a
         screen reader say "AnyDag AnyDag". */
      aria-hidden
      focusable="false"
    >
      <path fill="currentColor" d={MARK_FRAME} />
      <path fill="currentColor" d={MARK_LINE} />
      <circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={MARK_DOT.r} fill="var(--dag-color-accent)" />
    </svg>
  );
}

/**
 * The mark with the product's name beside it, as
 * chrome rather than as a fourth copy of the artwork.
 *
 * The name is **live text, not a path**. The mark's source drawing sets it as a `<text>` element,
 * which is right
 * for an asset somebody drops into a slide and wrong here: a path could not be selected, could not
 * be read out, would not take the theme's ink, and would be a fourth drawing to keep in step with
 * the three `docs/architecture/overview.md` already warns about. What is worth carrying over from that drawing is not the
 * outlines but the two numbers that make it a lockup rather than a logo with a word after it — the
 * size of the name against the mark, and the air between them. Both are written as fractions of
 * the mark in `chrome.css`, off its own 64-unit box: the name is its `font-size: 44`, the
 * gap its `x=86` less the box.
 *
 * So the mark is `aria-hidden` here whatever it is placed in, because the name it would announce
 * is the text sitting next to it. That is the case `Logo`'s `label` exists to cover and this is
 * the reason it is usually not passed.
 */
export function Lockup({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className ? `dag-lockup ${className}` : "dag-lockup"}
      style={{ "--lockup-mark": `${size}px` } as CSSProperties}
    >
      <Logo size={size} />
      <span className="dag-lockup__name">AnyDag</span>
    </span>
  );
}
