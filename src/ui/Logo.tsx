import type { CSSProperties } from "react";

/**
 * The AnyDag mark: a frame that does not close, and a stroke that leaves through the gap.
 *
 * The drawing is one 64-unit square. Three sides of a rounded frame, then up the right edge to
 * `y=20`, where it stops; the top edge stops at `x=38`. Between those two ends is a hole, and the
 * stroke — a coil that unwinds, drawn with the pen's `ink` grammar — crosses `x=44` at `y≈15.6` and `y=14`
 * at `x≈48`, so it passes *through* the hole rather than over a line. That is the whole idea and it
 * is why the frame is an open path rather than a `<rect>` with something drawn on top: an overlap
 * reads as a drawing mistake, a gap reads as an escape.
 *
 * Two constraints decided how it is coloured, and both come from `scripts/check-literals.mjs`:
 *
 * - **Rule 1, no colour anywhere in `src/`, admits no exceptions.** So the frame and the stroke are
 *   `currentColor` and the node is `var(--dag-color-accent)`. The mark therefore inherits whatever
 *   it is placed in — ink on the toolbar, paper on a dark ground — and the accent comes from the
 *   active theme rather than from the brand's design, which is the same split `chrome.css` already
 *   makes: the brand's design document owns the mark's geometry, `themes/<name>/theme.json` owns what
 *   colour anything in `src/` is drawn in.
 * - **Rule 3, no SVG style literals, is scoped to `src/render/`.** `src/ui/` is chrome and exempt,
 *   which is the reason this file is here and not beside the node views. A `strokeWidth="4.5"` in a
 *   diagram component is a theme key somebody bypassed; here it is the logo's own construction, and
 *   no theme has an opinion about it — the same argument that exempts the height of a zoom button.
 *
 * `size` is the box, not the stroke: the drawing scales as one. Below about 20px the gap closes up
 * and the coil fills in, which is what `public/favicon.svg` is for — a
 * heavier, opened-up cut of the same drawing. Do not reach for this component at favicon sizes.
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
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M 38 14 L 16 14 Q 6 14 6 24 L 6 42 Q 6 52 16 52 L 34 52 Q 44 52 44 42 L 44 20" />
        <path d="M 16 44 C 16 30 24 24 32 28 C 38 31 36 40 30 40 C 24 40 24 32 30 26 C 36 20 45 15 53 11" />
      </g>
      <circle cx="57" cy="8" r="4.5" fill="var(--dag-color-accent)" />
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
