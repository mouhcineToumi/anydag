import type { Theme } from "./contract";

/**
 * Flatten the theme onto `<html>` as `--dag-*` custom properties.
 *
 * The path becomes the name: `color.hues.indigo` → `--dag-color-hues-indigo`, camelCase kept as-is
 * (`color.successSoft` → `--dag-color-successSoft`) so a reader can go from the CSS back to the JSON
 * without a lookup table. One name means the checker
 * is a set comparison rather than a translation.
 *
 * Numbers get `px` unless the key is in `UNITLESS`. Opacities, line-heights and mix percentages are
 * numbers that must stay numbers; everything else in `metric` is a length.
 */

const UNITLESS = new Set([
  "tintMix",
  /* `color.opacity.*` — the leaf name is the last path segment, so these are the keys, not
     "opacity". No length shares any of these names. */
  "edge",
  "marker",
  "edgeQuiet",
  "markerQuiet",
  "bus",
  "junction",
  "stripRule",
  "fanSpan",
  "along",
  "across",
  "t0",
  "t1",
  "base",
  "c4DescLeading",
  "mdLeading",
  "mdCodeLeading",
  "weightBold",
  "grid",
  /* `metric.chart` — two ratios and two counts among two dozen lengths. */
  "donutInner",
  "minLabelPct",
  "maxTicks",
  "markerMax",
]);

/** Strings that are already CSS values (dash arrays, font stacks) pass through untouched. */
function toCss(key: string, value: string | number): string {
  if (typeof value === "string") return value;
  if (UNITLESS.has(key)) return String(value);
  return `${value}px`;
}

function walk(prefix: string, value: unknown, out: Map<string, string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number") {
    const key = prefix.slice(prefix.lastIndexOf("-") + 1);
    out.set(prefix, toCss(key, value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(`${prefix}-${i}`, v, out));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(`${prefix}-${k}`, v, out);
}

function themeVars(theme: Theme): Map<string, string> {
  const out = new Map<string, string>();
  walk("--dag-color", theme.color, out);
  walk("--dag-type", theme.type, out);
  walk("--dag-metric", theme.metric, out);
  out.set("--dag-font-sans", theme.fonts.sans);
  out.set("--dag-font-mono", theme.fonts.mono);

  /* One derived family: the icon tile's wash, `hue` mixed into the card at `tintMix`. Derived
     rather than authored because ten hues × every theme is ten chances to pick a pale colour by
     hand that is nearly but not quite the same as its neighbour's. A theme that wants an exact
     value overrides it in its own `theme.css`. */
  for (const [name, value] of Object.entries(theme.color.hues)) {
    out.set(`--dag-tint-${name}`, `color-mix(in srgb, ${value} ${theme.color.tintMix}%, ${theme.color.card})`);
  }

  /* What an unhued element falls back to. Published as its own pair so the CSS can say
     `var(--dag-h, var(--dag-h-default))` without naming a hue. */
  out.set("--dag-h-default", `var(--dag-color-hues-${theme.color.defaultHue})`);
  out.set("--dag-t-default", `var(--dag-tint-${theme.color.defaultHue})`);

  return out;
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  /* Clear the previous theme's variables before writing the new one's. Two themes need not declare
     the same set — the neutral theme has no `hues.crimson` if it never uses it — and a stale
     variable from the theme before would silently resolve. */
  for (const name of Array.from(root.style)) {
    if (name.startsWith("--dag-")) root.style.removeProperty(name);
  }
  for (const [name, value] of themeVars(theme)) root.style.setProperty(name, value);
  root.dataset.theme = theme.name;
  root.style.colorScheme = theme.color.scheme;
}

/**
 * What the layout cache keys on. Two themes with the same metrics reuse a layout; a colour-only
 * change (light → a hypothetical dark) must not re-run ELK.
 */
export function metricsHash(theme: Theme): string {
  return JSON.stringify([theme.metric, theme.type, theme.fonts]);
}
