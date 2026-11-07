#!/usr/bin/env node
/**
 * No hardcoded style values on the diagram surface.
 *
 * `check-theme.mjs` proves every `--dag-*` the code reads exists in every theme. That is only half
 * the layer rule: it says nothing about a value written straight into the stylesheet, which is
 * invisible to a theme by construction. `CLAUDE.md` claimed this file's job
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
const SVG_ATTR = /\b(strokeWidth|strokeDasharray|strokeOpacity|fillOpacity|opacity|r|rx|ry|cx|cy|x1|x2|y1|y2|width|height)=(?:"[^"]*"|\{\s*-?\d+(?:\.\d+)?\s*\})/g;
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

if (findings.length) {
  console.error(`${findings.length} hardcoded style value(s) — every one of these belongs in a theme:\n`);
  let last = "";
  for (const f of findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    if (f.file !== last) console.error(`  ${f.file}`), (last = f.file);
    console.error(`    ${String(f.line).padStart(4)}  ${f.what.padEnd(18)} ${f.text}`);
  }
  process.exit(1);
}

console.log("ok: no hardcoded colours, lengths or svg style values on the diagram surface");
