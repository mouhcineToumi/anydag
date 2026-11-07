import type { Theme } from "./contract";

/**
 * Turn an authored theme into the one the rest of the app reads.
 *
 * Exactly one thing is derived: `type.base` scales every font size, so a theme can move the whole
 * ramp by one number instead of editing eighteen sizes consistently and hoping. Everything else is
 * passed through — a theme is data, and the less of it is computed the less of it can surprise you.
 *
 * Resolution happens here rather than in CSS because CSS cannot serve the other consumer.
 * `layout/measure.ts` builds a canvas font string (`600 15px Inter`) and measures with it; a size
 * expressed as `calc(var(--dag-type-base) * 15)` would reach that string as text the canvas cannot
 * parse. Worse, `TableMeasurer` — the Node path the unit tests run on — pulls the number back out
 * with a regex and falls back to 14 when there isn't one, so the tests would keep passing while the
 * browser drew something else. One resolution, one set of numbers, both consumers.
 */

/**
 * Keys the ramp does not touch. Mostly ratios — a line-height of 1.45 is 1.45 whatever the base is —
 * and one weight, because a font weight is a point on the face's own axis: 700 scaled to 770 is a
 * number no face carries, and the browser would synthesize the difference.
 */
const RATIOS = new Set(["base", "c4DescLeading", "mdLeading", "mdCodeLeading", "weightBold"]);

/**
 * Half a pixel.
 *
 * Font sizes are measured, and a measured width that is not reproducible makes the renderer's box
 * disagree with the layout's — which `DiagramItem`'s dev assertion reports as a console error and
 * the e2e gate then fails on. Rounding keeps an arbitrary `base` from producing 14.376543px.
 */
const round = (n: number): number => Math.round(n * 2) / 2;

export function resolveTheme(theme: Theme): Theme {
  const base = theme.type.base;
  if (!(base > 0)) throw new Error(`theme \`${theme.name}\`: type.base must be a positive number`);
  if (base === 1) return theme;

  const type = { ...theme.type };
  for (const [key, value] of Object.entries(type)) {
    if (RATIOS.has(key) || typeof value !== "number") continue;
    (type as unknown as Record<string, number>)[key] = round(value * base);
  }
  return { ...theme, type };
}
