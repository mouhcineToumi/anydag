import type { CSSProperties } from "react";

import type { Hue } from "@/dsl/ir";

/**
 * Bind an element's hue as two custom properties, or bind nothing at all.
 *
 * Thirteen components used to write `` `var(--dag-color-hues-${node.hue ?? "indigo"})` `` inline,
 * each carrying its own copy of the default. Two things were wrong with that. The default lived in
 * the renderer, where a stylesheet cannot see it or override it; and thirteen copies is thirteen
 * chances for one of them to drift — one already had, defaulting a decision node to `teal` because
 * that happened to be the hue of the lane on the board someone was looking at.
 *
 * The rule that makes this work: **when there is no hue, set nothing.** A CSS `var()` fallback does
 * not fire for a property set to the empty string — `--dag-h: ;` is a value, not an absence — so a
 * component that always wrote the property would have to compute the fallback itself, which is the
 * situation we are leaving. Returning an empty object leaves the property unset, `var(--dag-h,
 * var(--dag-h-default))` resolves to the theme's default, and the decision belongs to the theme.
 *
 * `--dag-t` is the same hue's tint. It is bound here rather than derived in CSS so that the tint
 * family stays exactly the one the artboards specify — see `ThemeColor.tintMix`.
 */
export function hueVars(hue: Hue | undefined): CSSProperties {
  if (!hue) return {};
  return {
    "--dag-h": `var(--dag-color-hues-${hue})`,
    "--dag-t": `var(--dag-tint-${hue})`,
  } as CSSProperties;
}

/**
 * A diagram's own hue, bound for its frame — **not** `hueVars()`.
 *
 * `--dag-h` and `--dag-t` are read by every card, band and chip inside a diagram through
 * inheritance, with the theme's default hue behind them. Binding them on the frame would recolour
 * every card in it that has no hue of its own, which is the opposite of what a person who tints a
 * diagram's frame meant. These two names are read by the frame's border and its title band and by
 * nothing else; they carry no `--dag-` prefix for the reason `--inspector-w` does not — a theme has
 * no opinion about them, it only has the hues they point at.
 */
export function frameHueVars(hue: Hue | undefined): CSSProperties {
  if (!hue) return {};
  return {
    "--frame-h": `var(--dag-color-hues-${hue})`,
    "--frame-t": `var(--dag-tint-${hue})`,
  } as CSSProperties;
}
