#!/usr/bin/env node
/**
 * No hardcoded style values on the diagram surface.
 *
 * `check-theme.mjs` proves every `--dag-*` the code reads exists in every theme. That is only half
 * the layer rule: it says nothing about a value written straight into the stylesheet, which is
 * invisible to a theme by construction. `docs/architecture/layers.md` claimed this file's job
 * was already being done — it was not, and 99 px literals had accumulated on the diagram surface,
 * including two font sizes bypassing the type ramp entirely and a legend drawing the wrong stroke
 * under `neutral`.
 *
 * What counts as the diagram surface: the stylesheets a board draws with, and the components that
 * render one. The app chrome — toolbar, board picker, error and pending cards, the viewport itself
 * — is deliberately exempt. It is not themed, it is never exported, and nothing about a diagram's
 * look depends on it.
 *
 * What this does NOT check: arithmetic in `src/layout/`. A `+ 7` in `size.ts` is a geometric
 * relationship between a box and its contents, not a style value, and forcing those through the
 * theme would put the sizing algorithm's structure in a JSON file. The line is: a number that
 * decides how something *looks* belongs to the theme; a number that decides how a shape is
 * *computed* belongs to the code.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Diagram-surface stylesheets. Chrome lives in `chrome.css` and is not listed. */
const STYLES = ["src/styles/nodes.css", "src/styles/markdown.css", "src/styles/items.css"];

/** Components that draw a diagram. `src/ui/` and `src/canvas/` are chrome. */
const RENDER_DIRS = ["src/render"];

/** Every source file, for the colour rule, which admits no exceptions anywhere. */
const ALL_DIRS = ["src"];

/**
 * Strip comments before matching.
 *
 * Several doc comments legitimately discuss px — `route.ts` explains why a 10px chip was pulled —
 * and a checker that cannot tell prose from code would push those explanations out of the codebase,
 * which is the opposite of what it is for.
 */
function strip(text, ext) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  if (ext !== ".css") out = out.replace(/(^|[^:])\/\/[^\n]*/g, (_m, p) => p + " ");
  return out;
}

function walk(dir, test, acc = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, test, acc);
    else if (test(entry.name)) acc.push(rel);
  }
  return acc;
}

const findings = [];
const report = (file, text, re, what) => {
  for (const m of text.matchAll(re)) {
    const line = text.slice(0, m.index).split("\n").length;
    findings.push({ file, line, what, text: m[0].trim() });
  }
};

/* 1. A colour is never written in a source file. Ten hues plus a paper and an ink are a theme's
      whole identity; one hex in a component is a colour a theme cannot reach. */
for (const file of ALL_DIRS.flatMap((d) => walk(d, (n) => /\.(css|tsx?)$/.test(n)))) {
  const text = strip(fs.readFileSync(path.join(root, file), "utf8"), path.extname(file));
  report(file, text, /#[0-9a-fA-F]{3,8}\b(?![\w-])/g, "a colour");
  report(file, text, /\b(?:rgba?|hsla?)\s*\(/g, "a colour");
}

/* 2. A length on the diagram surface comes from `theme.metric`, a font size from `theme.type`. */
for (const file of STYLES) {
  const text = strip(fs.readFileSync(path.join(root, file), "utf8"), ".css");
  report(file, text, /(?<![\w-])\d+(?:\.\d+)?px/g, "a length");
}

/* 3. SVG presentation attributes are style, and a diagram is mostly SVG. An `opacity="0.72"` in a
      component is the same failure as one in a stylesheet — it is how `Legend.tsx` came to draw a
      line that does not match the edges it explains. Expressions are fine; literals are not. */
const SVG_ATTR =
  /\b(strokeWidth|strokeDasharray|strokeOpacity|fillOpacity|opacity|r|rx|ry|cx|cy|x1|x2|y1|y2|width|height)=(?:"[^"]*"|\{\s*-?\d+(?:\.\d+)?\s*\})/g;
for (const file of RENDER_DIRS.flatMap((d) => walk(d, (n) => /\.tsx?$/.test(n)))) {
  const text = strip(fs.readFileSync(path.join(root, file), "utf8"), ".tsx");
  for (const m of text.matchAll(SVG_ATTR)) {
    /* `strokeWidth={m.edge.stroke}` and `width="100%"` are both fine; a bare number is not. */
    const value = m[0].slice(m[0].indexOf("=") + 1);
    if (!/^(?:"-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?)*"|\{\s*-?\d+(?:\.\d+)?\s*\})$/.test(value)) continue;
    /* Zero is structural, not stylistic: an origin, or a stroke explicitly turned off. No theme
       would ever want to change it, and routing one through a variable only obscures the shape. */
    if (/^["{]?\s*0\s*[}"]?$/.test(value)) continue;
    const line = text.slice(0, m.index).split("\n").length;
    findings.push({ file, line, what: "an svg style value", text: m[0] });
  }
}

/* 4. The chrome's scale (#205). In `chrome.css`, a font size, a corner, a shadow, a layer or a
      duration reads `--dag-ui-*`. The chrome had none of these and typed its own (26 font sizes,
      28 shadows, 19 z-indexes) or borrowed the diagram's (`--dag-metric-radius-chip` as every
      button's corner, which counts as a literal here: it is the diagram's number, not the
      chrome's). The rules that still type one are counted per property against
      `scripts/chrome-literals.json`, and the count may only go down: a new literal fails, and a
      migration that removes some lowers the file in the same commit. */
const CHROME = "src/styles/chrome.css";
const CHROME_ALLOW = "scripts/chrome-literals.json";
const STRUCTURAL = {
  "font-size": /^(?:inherit|initial|unset|1em|100%)$/,
  "border-radius": /^(?:0|inherit|initial|unset|50%)$/,
  "box-shadow": /^(?:none|inherit|initial|unset|inset\b.*)$/,
  "z-index": /^(?:auto|-?\d)$/,
  transition: /^(?:none|inherit|initial|unset)$|^(?:(?!\d*\.?\d+m?s\b).)*$/,
};
const chromeCounts = Object.fromEntries(Object.keys(STRUCTURAL).map((k) => [k, 0]));
const chromeText = strip(fs.readFileSync(path.join(root, CHROME), "utf8"), ".css");
for (const m of chromeText.matchAll(
  /(?<![\w-])(font-size|border-radius|box-shadow|z-index|transition|animation)\s*:\s*([^;{}]+)/g,
)) {
  const prop = m[1] === "animation" ? "transition" : m[1];
  const value = m[2].trim().replace(/\s*!important$/, "");
  if (value.includes("var(--dag-ui-")) continue;
  if (STRUCTURAL[prop].test(value)) continue;
  chromeCounts[prop] += 1;
}
const chromeAllowed = JSON.parse(fs.readFileSync(path.join(root, CHROME_ALLOW), "utf8"));
const lowered = [];
for (const [prop, count] of Object.entries(chromeCounts)) {
  const allowed = chromeAllowed[prop] ?? 0;
  if (count > allowed) {
    findings.push({
      file: CHROME,
      line: 0,
      what: `a ${prop} literal`,
      text: `${count} rules type their own ${prop}; ${allowed} allowed — read a --dag-ui-* variable instead`,
    });
  } else if (count < allowed) lowered.push(`${prop} ${allowed} → ${count}`);
}

if (findings.length) {
  console.error(`${findings.length} hardcoded style value(s) — every one of these belongs in a theme:\n`);
  let last = "";
  for (const f of findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    if (f.file !== last) console.error(`  ${f.file}`), (last = f.file);
    console.error(`    ${String(f.line).padStart(4)}  ${f.what.padEnd(18)} ${f.text}`);
  }
  process.exit(1);
}

if (lowered.length) {
  console.log(
    `note: chrome.css types fewer literals than ${CHROME_ALLOW} allows (${lowered.join(", ")}); lower it in this commit`,
  );
}
console.log("ok: no hardcoded colours, lengths or svg style values on the diagram surface");
