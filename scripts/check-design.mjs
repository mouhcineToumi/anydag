#!/usr/bin/env node
/**
 * `DESIGN.md`'s names, checked against the code (#218).
 *
 * `DESIGN.md` says which token to reach for and which component to use, and it is only worth
 * reading while every name in it is real. A renamed token or a deleted class would leave it
 * confidently wrong, and nothing would fail. `check-skill.mjs` handles `SKILL.md` the same way: it
 * does not try to judge the prose, only the closed sets the prose names, and a list of names is
 * the part that goes stale.
 *
 * What is checked, wherever it appears in the file:
 *
 * - **Every `--dag-*` variable** is one every theme provides. The names come from the same walk
 *   over `theme.json` that `check-theme.mjs` does, which mirrors `src/theme/applyTheme.ts`.
 * - **Every theme path in backticks** (`color.shadow`, `ui.layer.toast`, `metric.radius.chip`)
 *   resolves in every theme.
 * - **Every class and data attribute in backticks** (`dag-toast`, `.dag-button--primary`,
 *   `data-dag-toast-dismiss`) appears somewhere under `src/`.
 * - **Every repository path in backticks** (`src/ui/Toast.tsx`) exists.
 *
 * A trailing `*` or `…`, or a `<placeholder>`, makes a name a prefix (`--dag-ui-text-*`,
 * `var(--dag-color-…)`, `dag-button--<variant>`): at least one real name has to start with it.
 *
 * `PROPOSED` lists the names `DESIGN.md` mentions because they do not exist yet: its open decisions.
 * Those names must stay missing. When one is added to the themes, this check fails until
 * `DESIGN.md` stops calling it an open question.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (...p) => path.join(root, ...p);

/** Names `DESIGN.md` records as not existing, each an open decision for the owner. */
const PROPOSED = new Set(["color.scrim", "--dag-color-scrim"]);

const designPath = at("DESIGN.md");
if (!fs.existsSync(designPath)) {
  console.error("DESIGN.md is missing: it is the chrome's design system, and src/styles/chrome.css cites it");
  process.exit(1);
}
const design = fs.readFileSync(designPath, "utf8");

const themeNames = fs
  .readdirSync(at("themes"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
const themes = themeNames.map((name) => ({ name, json: JSON.parse(fs.readFileSync(at("themes", name, "theme.json"), "utf8")) }));

/* ---- What exists ---- */

/** Every `--dag-*` a theme provides: the walk `check-theme.mjs` does, which mirrors `applyTheme.ts`. */
function provides(theme) {
  const out = new Set();
  const walk = (prefix, value) => {
    if (value === null || value === undefined) return;
    if (typeof value === "string" || typeof value === "number") out.add(prefix);
    else if (Array.isArray(value)) value.forEach((v, i) => walk(`${prefix}-${i}`, v));
    else for (const [k, v] of Object.entries(value)) walk(`${prefix}-${k}`, v);
  };
  walk("--dag-color", theme.color);
  walk("--dag-type", theme.type);
  walk("--dag-metric", theme.metric);
  walk("--dag-ui", theme.ui);
  out.add("--dag-font-sans");
  out.add("--dag-font-mono");
  for (const hue of Object.keys(theme.color.hues)) out.add(`--dag-tint-${hue}`);
  return out;
}
const vars = themes.map((t) => ({ name: t.name, has: provides(t.json) }));

/** Every leaf path of a theme, dotted: `color.shadow`, `ui.layer.toast`. Objects count too. */
function paths(theme) {
  const out = new Set();
  const walk = (prefix, value) => {
    out.add(prefix);
    if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(`${prefix}.${k}`, v);
  };
  for (const [k, v] of Object.entries(theme)) walk(k, v);
  return out;
}
const tokens = themes.map((t) => ({ name: t.name, has: paths(t.json) }));

/** Every source file under `src/`, as one string, for the classes and attributes in it. */
function sourceText(dir) {
  let text = "";
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) text += sourceText(p);
    else if (/\.(css|tsx?)$/.test(e.name)) text += `\n${fs.readFileSync(p, "utf8")}`;
  }
  return text;
}
/* Whole names only: `dag-toast__act` is not there just because `dag-toast__acts` is. */
const classes = new Set(sourceText(at("src")).match(/(?:data-)?dag-[a-z0-9_-]*[a-z0-9]/g));

/* ---- What DESIGN.md names ---- */

const problems = [];
const note = (what, name) => problems.push(`${what}: ${name}`);

/** `--dag-ui-text-*`, `--dag-color-…` and `dag-button--<variant>` are prefixes; anything else is a whole name. */
const prefixOf = (name) => {
  const cut = name.search(/[*<…]/);
  return cut === -1 ? null : name.slice(0, cut);
};

const matches = (name, set) => {
  const prefix = prefixOf(name);
  if (prefix === null) return set.has(name);
  for (const n of set) if (n.startsWith(prefix)) return true;
  return false;
};

const spans = [...design.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());

/* Variables: anywhere in the file, in backticks or not. */
const named = new Set([...design.matchAll(/--dag-[A-Za-z0-9-]+(?:\*|…|<[a-z-]+>(?:-<[a-z-]+>)*)?/g)].map((m) => m[0]));
for (const name of named) {
  if (PROPOSED.has(name)) {
    for (const t of vars) if (t.has.has(name)) note(`DESIGN.md calls this an open decision, but ${t.name} has it now`, name);
    continue;
  }
  for (const t of vars) if (!matches(name, t.has)) note(`no such variable in ${t.name}`, name);
}

for (const span of spans) {
  /* Theme paths: `color.shadow`, `ui.layer.toast`, `ui.text.*`. */
  const token = /^(color|type|metric|ui|fonts|icons)\.[A-Za-z0-9.]+(?:\.\*|\.<[a-z-]+>)?$/.exec(span);
  if (token) {
    if (PROPOSED.has(span)) {
      for (const t of tokens) if (t.has.has(span)) note(`DESIGN.md calls this an open decision, but ${t.name} has it now`, span);
      continue;
    }
    const name = span.replace(/\.(\*|<[a-z-]+>)$/, ".*");
    for (const t of tokens) {
      const ok = name.endsWith(".*") ? [...t.has].some((p) => p.startsWith(name.slice(0, -1))) : t.has.has(name);
      if (!ok) note(`no such token in ${t.name}`, span);
    }
    continue;
  }

  /* Classes and data attributes: `dag-toast`, `.dag-button--primary`, `data-dag-toast-dismiss`. */
  const cls = /^\.?((?:data-)?dag-[a-z0-9_-]+(?:<[a-z-]+>|\*)?(?:[a-z0-9_-]*)?)(?:=.*)?$/.exec(span);
  if (cls) {
    if (!matches(cls[1], classes)) note("no such class or attribute under src/", span);
    continue;
  }

  /* Repository paths. */
  const file = /^((?:src|scripts|themes|docs|e2e|test|icons|desktop|server)\/[A-Za-z0-9_./-]+?)(?::\d+)?$/.exec(span);
  if (file && !file[1].includes("*") && !fs.existsSync(at(file[1]))) note("no such file", file[1]);
}

if (problems.length) {
  console.error(`DESIGN.md names ${problems.length} thing(s) the code does not have:\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nRename them in DESIGN.md to what the code calls them now, or add the name to PROPOSED in");
  console.error("scripts/check-design.mjs if DESIGN.md is proposing it.");
  process.exit(1);
}
console.log(
  `ok: DESIGN.md names ${named.size} variable(s) and ${spans.length} code span(s), all present in ${themeNames.length} theme(s) and the source`,
);
