#!/usr/bin/env node
/**
 * Assemble the icon bundle the app ships with.
 *
 * Three sources feed one file. `simple-icons` gives a monochrome silhouette that already draws in
 * `currentColor`, so it inherits the tile's hue exactly the way a Lucide glyph does and needs no
 * special handling anywhere. `logos` gives the same brand in its real colours. `vendor.json` — AWS,
 * Azure and Google's own architecture packs, built separately by `vendor.mjs` — fills the long tail
 * of cloud services that no CC0 set covers.
 *
 * **A CC0 source always wins.** Where `logos` has an AWS service (it has 63), that is the one that
 * ships, and the vendor pack is only consulted for what is left. This is not a quality judgement:
 * CC0 carries no attribution requirement and no bar on modification, while the vendor packs carry
 * both, so every icon resolved from `logos` is one fewer icon under an obligation. `icons/NOTICE`
 * lists only what actually survived that preference.
 *
 * Why a generated file is committed rather than built on install: the app must boot from a clone
 * with no network and no 470 MB `@iconify/json` in `node_modules`, the same way it boots from a
 * committed `theme.json`. The upstream sets are devDependencies, needed only to run this script.
 *
 * IDs are deliberately NOT made unique here. A colour icon carries `<linearGradient id=…>` whose
 * name is fixed per icon, so two Azure cards on one board would collide — but the fix belongs at
 * the mount point, not in the data: `replaceIDs()` runs per rendered instance in `Icon.tsx`, which
 * is also what makes an exported standalone SVG internally consistent. Prefixing here would make
 * every *instance* of one icon share a namespace, which is precisely the broken case.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildEmoji } from "./emoji.mjs";
import { writeIconIndex } from "./index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const at = (...p) => path.join(root, ...p);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const manifest = readJson(at("icons/manifest.json"));
const upstream = {
  logos: readJson(at("node_modules/@iconify-json/logos/icons.json")),
  "simple-icons": readJson(at("node_modules/@iconify-json/simple-icons/icons.json")),
};

/**
 * Pull one icon out of an Iconify set.
 *
 * A set declares a default `width`/`height` and each icon may override it — 79% of `logos` icons do,
 * because a wordmark is not square and a set-wide 256×256 would letterbox it. Resolving the default
 * here means the renderer never has to know which set an icon came from.
 */
function take(setName, slug) {
  const set = upstream[setName];
  const resolved = set.aliases?.[slug]?.parent ?? slug;
  const icon = set.icons[resolved];
  if (!icon) return null;
  return {
    body: icon.body,
    width: icon.width ?? set.width,
    height: icon.height ?? set.height,
  };
}

/**
 * The mark, never the wordmark.
 *
 * `logos` ships many brands twice: `docker` is the whale *beside the word "docker"*, `docker-icon`
 * is just the whale. The wordmark is the canonical slug, so taking it by name is the obvious thing
 * to do and it is wrong — at 8.8:1, `anthropic` rendered to the tile's height came out 176px wide
 * and printed "ANTHROPIC" straight across the card it belonged to. 63 of the 79 wide marks in the
 * manifest have an `-icon` sibling.
 *
 * Stated as a rule rather than as 63 corrections in `manifest.json` so a brand added next month
 * gets it for free. The threshold is deliberately loose: a mark up to 4:3 still sits inside a tile,
 * and `Icon.tsx` clamps whatever survives this by aspect ratio anyway.
 */
const WORDMARK_ASPECT = 1.35;
function takeColor(slug) {
  const base = take("logos", slug);
  if (!base) return null;
  if (base.width / base.height <= WORDMARK_ASPECT) return base;
  const iconOnly = take("logos", `${slug}-icon`);
  return iconOnly ?? base;
}

const mono = {};
const color = {};
const aliases = {};
const unresolved = [];
let wordmarksSwapped = 0;

for (const [name, entry] of Object.entries(manifest.brands)) {
  const m = entry.mono ? take("simple-icons", entry.mono) : null;
  const c = entry.color ? takeColor(entry.color) : null;
  if (c && entry.color && take("logos", entry.color)?.body !== c.body) wordmarksSwapped++;
  if (m) mono[name] = m;
  if (c) color[name] = c;
  if (!m && !c) unresolved.push(name);
  for (const a of entry.aliases ?? []) aliases[a] = name;
}

for (const [name, entry] of Object.entries(manifest.cloud)) {
  const c = entry.color ? takeColor(entry.color) : null;
  if (c) color[name] = c;
  else unresolved.push(name);
}

/* The vendor packs are additive and never overwrite: anything already resolved above came from a
   CC0 set, and taking the vendor's version instead would trade a free icon for an encumbered one. */
const vendorPath = at("icons/data/vendor.json");
let vendorAdded = 0;
let vendorSources = null;
if (existsSync(vendorPath)) {
  const vendor = readJson(vendorPath);
  vendorSources = vendor.sources ?? null;
  for (const [name, icon] of Object.entries(vendor.icons ?? {})) {
    if (name in color) continue;
    color[name] = icon;
    vendorAdded++;
  }
} else {
  console.warn("! icons/data/vendor.json not found — building CC0 icons only");
}

const bundle = {
  generated: new Date().toISOString(),
  counts: { mono: Object.keys(mono).length, color: Object.keys(color).length, aliases: Object.keys(aliases).length },
  mono,
  color,
  aliases,
};

const out = at("icons/data/icons.json");
writeFileSync(out, JSON.stringify(bundle));
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

/*
 * Every name `icon=` may legally take, as a TypeScript module inside the DSL layer.
 *
 * `finalize()` needs this to report `W_UNKNOWN_ICON`, and the DSL is the one layer that must stay
 * loadable by plain Node: `plugins/board.ts` imports `src/dsl/parse` so the dev server can answer
 * `/__board/diagnostics` with the same parse the browser runs. A JSON import would need an import
 * attribute to survive that trip, and an `@/` alias would take the dev server down at startup — a
 * generated `.ts` file has neither problem. It holds names and nothing else, so the colour and
 * length rules `check-literals.mjs` enforces over `src/` are untouched.
 */
const kebab = (pascal) => pascal.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase();
const lucide = Object.keys(await import("lucide-react"))
  .filter((k) => /^[A-Z]/.test(k) && !k.startsWith("Lucide") && !k.endsWith("Icon"))
  .map(kebab);

/* The emoji are the one set named under a namespace of their own, and it is not decoration: a bare
   `house` has meant Lucide's house since M11, and a colour emoji answering to the same word would
   redraw every board that wrote it. `emoji:house` is a new name, so nothing old changes meaning. */
const emoji = buildEmoji(root);
const every = [
  ...new Set([...lucide, ...Object.keys(mono), ...Object.keys(color), ...Object.keys(aliases), ...emoji.names.map((n) => `emoji:${n}`)]),
].sort();
writeFileSync(
  at("src/dsl/icon-names.ts"),
  `/* GENERATED by scripts/icons/build.mjs — do not edit. Run \`npm run icons:build\`. */\n\n` +
    `/** Every value \`icon=\` accepts: Lucide's glyphs, the brand bundle, its aliases, and the emoji. */\n` +
    `export const ICON_NAMES: ReadonlySet<string> = new Set([\n` +
    every.map((n) => `  ${JSON.stringify(n)},`).join("\n") +
    `\n]);\n`,
);

console.log(`src/dsl/icon-names.ts    ${every.length} names (lucide ${lucide.length} + bundle ${every.length - lucide.length})`);

/* What `iconFor()` needs to decide a name, without the art: `src/render/icon-index.ts`. */
const index = await writeIconIndex();
console.log(`src/render/icon-index.ts ${kb(index.length)}`);
console.log(`icons/data/icons.json  ${kb(readFileSync(out).byteLength)}`);
console.log(`  mono    ${bundle.counts.mono.toString().padStart(4)}  (simple-icons, currentColor)`);
console.log(`  color   ${bundle.counts.color.toString().padStart(4)}  (logos: ${bundle.counts.color - vendorAdded}, vendor packs: ${vendorAdded})`);
console.log(`  aliases ${bundle.counts.aliases.toString().padStart(4)}`);
console.log(`  ${wordmarksSwapped} wordmark(s) swapped for their \`-icon\` sibling`);
console.log(
  `icons/data/emoji-*.json  ${emoji.names.length} emoji in ${emoji.categories.length} categories ` +
    `(colour ${kb(emoji.bytes.color)}, mono ${kb(emoji.bytes.mono)} — loaded on demand)`,
);
if (vendorSources) for (const [v, s] of Object.entries(vendorSources)) console.log(`    ${v}: ${s.count ?? "?"} available`);
if (unresolved.length) {
  console.error(`\n${unresolved.length} manifest name(s) resolved to nothing:`);
  for (const n of unresolved) console.error(`  ${n}`);
  process.exit(1);
}
