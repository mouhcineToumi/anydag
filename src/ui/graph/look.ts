/**
 * The Graph page's look, read from the theme (#459): every colour a uniform from `theme.color.*`,
 * every size that decides the look from `theme.metric.graph`. A file carries a palette slot
 * (`src/graph/palette.ts`), never a colour; this resolves the slots' tokens for the theme drawn in,
 * so a theme switch is a new set of uniforms and nothing else.
 */
import { SLOT_TOKENS } from "@/graph/palette";
import type { Theme } from "@/theme/contract";

import type { Look } from "./scene";

/** The value a theme gives a colour token: `slate` is `color.slate`, `hues-indigo` is `color.hues.indigo`. */
function tokenValue(theme: Theme, token: string): string {
  let at: unknown = theme.color;
  for (const part of token.split("-")) at = at && typeof at === "object" ? (at as Record<string, unknown>)[part] : undefined;
  return typeof at === "string" ? at : theme.color.slate;
}

/** A theme's `#rrggbb` or `#rrggbbaa` as three channels from 0 to 1. */
function channels(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 || h.length === 4 ? [...h.slice(0, 3)].map((c) => c + c).join("") : h.slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n) || full.length !== 6) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The CSS colour a palette slot is drawn in, for the legend's dots: the theme's own variable. */
export const slotColour = (slot: number): string => `var(--dag-color-${SLOT_TOKENS[slot] ?? "slate"})`;

export function lookOf(theme: Theme): Look {
  const c = theme.color;
  const m = theme.metric.graph;
  const palette = new Float32Array(3 * SLOT_TOKENS.length);
  SLOT_TOKENS.forEach((token, i) => palette.set(channels(tokenValue(theme, token)), 3 * i));
  return {
    paint: {
      palette,
      paper: channels(c.paper),
      accent: channels(c.accent),
      edge: channels(c.muted),
      edgeAlpha: c.opacity.edgeQuiet,
    },
    sizes: {
      dot: m.dot,
      dotGrow: m.dotGrow,
      dotMax: m.dotMax,
      dotMin: m.dotMin,
      ring: m.ring,
      halo: m.halo,
      link: m.link,
      hit: m.hit,
    },
    labels: {
      font: theme.fonts.sans,
      regular: theme.ui.weight.regular,
      strong: theme.ui.weight.strong,
      size: m.label,
      gap: m.labelGap,
      halo: m.labelHalo,
      from: m.labelFrom,
      groupSize: m.groupLabel,
      groupHalo: m.groupHalo,
      paper: c.paper,
      ink: c.ink,
      slate: c.slate,
    },
  };
}
