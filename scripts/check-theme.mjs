#!/usr/bin/env node
/**
 * Every `--dag-*` the code reaches for must exist in every theme.
 *
 * This is the gate that keeps the theme layer honest. Without it a new `var(--dag-color-teal)` in a
 * component works fine against `paper`, resolves to nothing against `neutral`, and the element
 * silently loses its colour — the exact failure a swappable theme is supposed to make impossible.
 *
 * The flattening below mirrors `src/theme/applyTheme.ts`. Two implementations of one rule can
 * drift, so if you change the naming there, change it here — a mismatch shows up as a whole family
 * of variables reported missing, which is a loud enough signal.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Mirrors `UNITLESS` in `src/theme/applyTheme.ts`. Keys are leaf names — the last path segment. */
const UNITLESS = new Set([
  "tintMix",
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
  "donutInner",
  "minLabelPct",
  "maxTicks",
  "markerMax",
]);

/* The mirror above was declared and never read, so the drift CLAUDE.md says it guards against was
   guarded by nothing. Read the real set out of `applyTheme.ts` and fail when the two differ. */
{
  const source = fs.readFileSync(path.join(root, "src", "theme", "applyTheme.ts"), "utf8");
  const body = /const UNITLESS = new Set\(\[([\s\S]*?)\]\);/.exec(source)?.[1] ?? "";
  const actual = new Set([...body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const drift = [
    ...[...actual].filter((k) => !UNITLESS.has(k)).map((k) => `\`${k}\` is in applyTheme.ts and not here`),
    ...[...UNITLESS].filter((k) => !actual.has(k)).map((k) => `\`${k}\` is here and not in applyTheme.ts`),
  ];
  if (actual.size === 0 || drift.length > 0) {
    console.error(`UNITLESS has drifted from src/theme/applyTheme.ts:\n  ${drift.join("\n  ") || "could not read it"}`);
    process.exit(1);
  }
}

function walk(prefix, value, out) {
  if (value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number") {
    out.add(prefix);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(`${prefix}-${i}`, v, out));
    return;
  }
  for (const [k, v] of Object.entries(value)) walk(`${prefix}-${k}`, v, out);
}

function provides(theme) {
  const out = new Set();
  walk("--dag-color", theme.color, out);
  walk("--dag-type", theme.type, out);
  walk("--dag-metric", theme.metric, out);
  out.add("--dag-font-sans");
  out.add("--dag-font-mono");
  for (const hue of Object.keys(theme.color.hues)) out.add(`--dag-tint-${hue}`);

  /* Derived by `applyTheme()` from `color.defaultHue`, so every theme has them by construction. */
  out.add("--dag-h-default");
  out.add("--dag-t-default");

  /* Element-scoped: `hueVars()` binds these on the element that has a hue, and only then, so the
     `var()` fallbacks above them can fire. No theme declares them and none should — they are how a
     component says "this one is teal", not something a look decides. */
  out.add("--dag-h");
  out.add("--dag-t");
  return out;
}

/**
 * Files that *read* variables: styles and any inline `var(--dag-…)` in a component.
 *
 * `applyTheme.ts` is excluded because it is the file that *writes* them — it holds the prefixes
 * (`--dag-color`, `--dag-tint-`) that every real name is built from, and scanning it reports those
 * prefixes as five missing variables in every theme.
 */
const GENERATOR = path.join(root, "src", "theme", "applyTheme.ts");

function sources(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (full === GENERATOR) continue;
    if (entry.isDirectory()) sources(full, acc);
    else if (/\.(css|tsx?|mjs)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const themes = fs
  .readdirSync(path.join(root, "themes"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => ({
    name: e.name,
    json: JSON.parse(fs.readFileSync(path.join(root, "themes", e.name, "theme.json"), "utf8")),
  }));

if (themes.length === 0) {
  console.error("no themes found");
  process.exit(1);
}

/* Interpolated names (`--dag-color-hues-${hue}`) cannot be read statically, so the check treats a
   template hole as "any hue" and verifies the family exists in every theme instead. */
const DYNAMIC = [
  [/--dag-color-hues-\$\{[^}]+\}/g, (t) => Object.keys(t.color.hues).map((h) => `--dag-color-hues-${h}`)],
  [/--dag-tint-\$\{[^}]+\}/g, (t) => Object.keys(t.color.hues).map((h) => `--dag-tint-${h}`)],
];

const used = new Set();
const dynamicFamilies = new Set();
for (const file of sources(path.join(root, "src"))) {
  const text = fs.readFileSync(file, "utf8");
  for (const [re, key] of DYNAMIC) {
    if (re.test(text)) dynamicFamilies.add(key);
    re.lastIndex = 0;
  }
  for (const m of text.matchAll(/--dag-[A-Za-z0-9-]+/g)) {
    /* A trailing dash means the name was cut off by a template hole — the dynamic families above
       already cover those. */
    if (!m[0].includes("$") && !m[0].endsWith("-")) used.add(m[0]);
  }
}

/**
 * The shape checks the `Theme` type cannot make.
 *
 * `theme.json` reaches the app through an unchecked cast (`import.meta.glob<{ default: Theme }>`),
 * so TypeScript proves nothing about it at runtime. These are the mistakes that would otherwise
 * fail silently: a hue the parsers assign but the theme never defines (the node renders with no
 * colour), and a diagram type misspelled in `elk` (every lookup has a `?? default`, so a typo means
 * the diagram quietly lays out with the wrong spacing and nothing says so).
 *
 * Both lists are read out of `src/dsl/ir.ts` rather than restated here, so adding a diagram type or
 * a hue cannot leave this file behind.
 */
const ir = fs.readFileSync(path.join(root, "src", "dsl", "ir.ts"), "utf8");
const between = (start, end) => {
  const from = ir.indexOf(start);
  if (from < 0) return "";
  const to = ir.indexOf(end, from);
  return to < 0 ? "" : ir.slice(from, to);
};
const quoted = (text) => [...text.matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]);
/* Both lists, because `metric.elk` is keyed by *fence type* and two of those live outside
   `DiagramType` — their models are not a `Graph`. Read rather than appended by hand, for the reason
   `OWN_MODEL_TYPES` exists at all: a literal beside a list is how the list stops being the list. */
const DIAGRAM_TYPES = new Set([
  ...quoted(between("export type DiagramType =", ";")),
  ...quoted(between("export const OWN_MODEL_TYPES", ";")),
]);
const HUE_ORDER = quoted(between("export const HUE_ORDER", "];"));
if (DIAGRAM_TYPES.size < 5 || HUE_ORDER.length < 5) {
  console.error("could not read DiagramType / HUE_ORDER out of src/dsl/ir.ts — has its shape changed?");
  process.exit(1);
}

/* The chart palette's ceiling, read out of the parser the same way and for the same reason: seven
   is where the dataviz validator stops finding a set that separates, and it is a constant there so
   `W_CHART_MANY` can count to it without a theme. A literal here would be the eighth copy of a
   number whose whole value is that there is one. */
const chartHuesMax = Number(
  /export const CHART_HUES_MAX\s*=\s*(\d+)/.exec(fs.readFileSync(path.join(root, "src", "dsl", "chart.ts"), "utf8"))?.[1],
);
if (!(chartHuesMax > 0)) {
  console.error("could not read CHART_HUES_MAX out of src/dsl/chart.ts — has its shape changed?");
  process.exit(1);
}

/**
 * The alpha of a shadow colour, or `null` when it is not a form this gate can read.
 *
 * A shadow has to be translucent: opaque, it is a second outline painted outside the border rather
 * than depth under it. Eight-digit hex and `rgba()` are the forms the themes use; six-digit hex and
 * `rgb()` are refused for exactly that reason.
 */
function shadowAlpha(value) {
  if (typeof value !== "string") return null;
  const hex = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(value.trim());
  if (hex) return Number.parseInt(hex[1], 16) / 255;
  const rgba = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/i.exec(value.trim());
  if (rgba) return Number(rgba[1]);
  return null;
}

function shapeErrors(theme) {
  const out = [];
  for (const hue of HUE_ORDER) {
    if (!theme.color?.hues?.[hue]) out.push(`color.hues.${hue} is missing — parsers assign it by name`);
  }
  if (!(theme.type?.base > 0)) out.push("type.base must be a positive number");

  const shadow = shadowAlpha(theme.color?.shadow);
  if (shadow === null || !(shadow > 0 && shadow < 1)) {
    out.push("color.shadow must be a translucent colour (8-digit hex or rgba) — an opaque shadow paints over the surface");
  }

  /*
   * `color.chartHues` — the one hue list a theme owns rather than the parser (the charts
   * milestone's decision 5). Three claims, all of which fail silently otherwise: a name outside
   * `HUE_ORDER` binds `--dag-h` to a custom property nobody set and the series draws with no colour
   * at all; more than `CHART_HUES_MAX` and `W_CHART_MANY` warns about a fold that never happens;
   * and a theme that omits it draws every chart muted the moment somebody switches looks.
   */
  const chartHues = theme.color?.chartHues;
  if (!Array.isArray(chartHues) || chartHues.length === 0) {
    out.push("color.chartHues is missing — a chart assigns its hues from it");
  } else {
    if (chartHues.length > chartHuesMax) {
      out.push(`color.chartHues has ${chartHues.length} hues — CHART_HUES_MAX is ${chartHuesMax}`);
    }
    for (const hue of chartHues) {
      if (!HUE_ORDER.includes(hue)) out.push(`color.chartHues has \`${hue}\`, which is not a hue (${HUE_ORDER.join(", ")})`);
    }
    if (new Set(chartHues).size !== chartHues.length) out.push("color.chartHues repeats a hue — the list is never cycled");
  }
  for (const [group, table] of Object.entries(theme.metric?.elk ?? {})) {
    for (const key of Object.keys(table)) {
      if (!DIAGRAM_TYPES.has(key)) out.push(`metric.elk.${group}.${key} is not a diagram type`);
    }
  }
  for (const [key, value] of Object.entries(theme.metric?.elk?.hierarchy ?? {})) {
    if (value !== "include" && value !== "separate") {
      out.push(`metric.elk.hierarchy.${key} is \`${value}\`, not \`include\` or \`separate\``);
    }
  }
  return out;
}

/* Themes must also agree with each other. A key one theme has and another does not is a value that
   silently disappears the moment someone switches looks. */
const keySets = themes.map(({ name, json }) => ({ name, keys: provides(json) }));
const union = new Set(keySets.flatMap((t) => [...t.keys]));

let failed = false;
for (const { name, json } of themes) {
  for (const problem of shapeErrors(json)) {
    failed = true;
    console.error(`theme \`${name}\`: ${problem}`);
  }
  const mine = keySets.find((t) => t.name === name).keys;
  const extra = [...union].filter((k) => !mine.has(k)).sort();
  if (extra.length) {
    failed = true;
    console.error(`theme \`${name}\` is missing ${extra.length} key(s) other themes define:`);
    for (const k of extra) console.error(`  ${k}`);
  }
}

for (const { name, json } of themes) {
  const have = provides(json);
  const missing = [...used].filter((v) => !have.has(v)).sort();
  for (const family of dynamicFamilies) {
    for (const v of family(json)) if (!have.has(v)) missing.push(v);
  }
  if (missing.length) {
    failed = true;
    console.error(`theme \`${name}\` is missing ${missing.length}:`);
    for (const v of missing) console.error(`  ${v}`);
  }
}

const names = themes.map((t) => t.name).join(", ");
if (failed) process.exit(1);
console.log(`ok: ${used.size} variables, all present in ${themes.length} theme(s) — ${names}`);
