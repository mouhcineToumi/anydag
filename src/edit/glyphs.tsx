import type { LucideProps } from "lucide-react";

/**
 * The two shape glyphs Lucide does not have, drawn on its 24-unit grid with its stroke, so they sit
 * beside its triangle and hexagon as one set. Until these, both shapes wore Lucide's generic
 * `Shapes` glyph — a circle, a square and a triangle — which says "some shapes", not which one.
 */
function glyph(points: string) {
  return function Glyph({ size = 24, strokeWidth = 2, ...rest }: LucideProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...(rest as object)}
      >
        <polygon points={points} />
      </svg>
    );
  };
}

export const Parallelogram = glyph("7 5 22 5 17 19 2 19");
export const Trapezoid = glyph("7 5 17 5 22 19 2 19");
