#!/usr/bin/env node
/**
 * Every icon a board can name actually exists, and the generated files agree with each other.
 *
 * `check-theme.mjs` proves every `--dag-*` the code reads exists in every theme. This is the same
 * contract one layer over: an `icon=` that resolves to nothing should fail here, loudly, rather
 * than fall through to a generic box on somebody's screen a week later.
 *
 * Three things are checked, and the third is the one that matters most.
 *
 * 1. Every name in `icons/manifest.json` made it into the bundle. A silent drop means an upstream
 *    set renamed a slug — `logos` and `simple-icons` both do this — and the manifest is now lying.
 * 2. `src/dsl/icon-names.ts` matches the bundle it was generated from. It is committed, so it can
 *    go stale, and a stale copy makes `W_UNKNOWN_ICON` fire on names that are perfectly good.
 * 3. Every `icon=` written in `boards/` resolves. This is the check with teeth: the icon vocabulary
 *    is thousands of names deep and dense with near-misses (`groq`/`grok`, `together`/`tether`,
 *    `zookeeper`/`keeper`), so a typo does not draw a box — it draws a different company's logo.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (...p) => path.join(root, ...p);
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const problems = [];
const note = (what, detail) => problems.push({ what, detail });

if (!fs.existsSync(at("icons/data/icons.json"))) {
  console.error("icons/data/icons.json is missing — run `npm run icons:build`");
  process.exit(1);
}

const bundle = readJson(at("icons/data/icons.json"));
const manifest = readJson(at("icons/manifest.json"));
const known = new Set([...Object.keys(bundle.mono), ...Object.keys(bundle.color), ...Object.keys(bundle.aliases)]);

/* The emoji are two files of their own, loaded on demand, and both must hold every name the
   vocabulary promises — a colour cut that drew a house and a mono cut that did not would be
   `icon=mono:emoji:house` falling back to a stick figure on one board in a hundred. */
for (const file of ["icons/data/emoji-color.json", "icons/data/emoji-mono.json"]) {
  if (!fs.existsSync(at(file))) {
    console.error(`${file} is missing — run \`npm run icons:build\``);
    process.exit(1);
  }
}
const emojiColor = readJson(at("icons/data/emoji-color.json"));
const emojiMono = readJson(at("icons/data/emoji-mono.json"));
const shelved = [...fs.readFileSync(at("src/dsl/emoji-names.ts"), "utf8").matchAll(/^ {6}"([^"]+)",$/gm)].map((m) => m[1]);
for (const name of shelved) {
  known.add(`emoji:${name}`);
  if (!emojiColor.icons[name]) note("emoji named in src/dsl/emoji-names.ts with no colour art", name);
  if (!emojiMono.icons[name]) note("emoji named in src/dsl/emoji-names.ts with no mono art", name);
}
for (const name of Object.keys(emojiColor.icons)) {
  if (!shelved.includes(name)) note("emoji art no category names (stale — rebuild)", name);
}

/* 1. The manifest and the bundle say the same thing. */
for (const name of Object.keys(manifest.brands)) {
  if (!(name in bundle.mono) && !(name in bundle.color)) note("manifest name not in the bundle", name);
}
for (const name of Object.keys(manifest.cloud)) {
  if (!(name in bundle.color)) note("manifest cloud name not in the bundle", name);
}

/* 2. The committed name list still describes the committed bundle. Lucide's names are not checked
      against the package here — `icon-names.ts` is regenerated from it, and a mismatch there would
      mean the generator ran against a different `lucide-react` than the one installed, which the
      typecheck would catch anyway. Only the bundle half can drift silently. */
const namesSrc = fs.readFileSync(at("src/dsl/icon-names.ts"), "utf8");
const listed = new Set([...namesSrc.matchAll(/^ {2}"([^"]+)",$/gm)].map((m) => m[1]));
for (const name of known) {
  if (!listed.has(name)) note("in the bundle but missing from src/dsl/icon-names.ts (stale — rebuild)", name);
}

/* 2b. The index `iconFor()` decides with, now that the art loads late, says what the bundle and the
       installed Lucide say. */
{
  const { renderIconIndex, INDEX_FILE } = await import("./icons/index.mjs");
  if (fs.readFileSync(INDEX_FILE, "utf8") !== (await renderIconIndex()))
    note("src/render/icon-index.ts does not match the bundle and lucide-react (stale — rebuild)", "icon-index.ts");
}

/* 3. Every `icon=` any board actually writes. Board files are the thing a person edits by hand, so
      this is where a typo is born. */
const boards = [];
const walk = (dir) => {
  if (!fs.existsSync(at(dir))) return;
  for (const entry of fs.readdirSync(at(dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    /* `boards/components/` is what a person saved off their own board, not part of this
       repository's content. A typo in one is theirs to see as a `W_UNKNOWN_ICON` under the
       diagram; it must not be able to fail the gate. */
    if (entry.isDirectory() && rel === path.join("boards", "components")) continue;
    if (entry.isDirectory()) walk(rel);
    else if (entry.name.endsWith(".board.md")) boards.push(rel);
  }
};
walk("boards");

/* Only inside a diagram fence. A `md` or `note` block is prose, and this file's own board writes
   `icon=mono:postgresql` in a sentence explaining the syntax — scanning that would make documenting
   an icon impossible without also owning it. Prose fences are skipped rather than matched loosely,
   because the alternative is a gate that fails on a paragraph. */
const PROSE = new Set(["md", "note", "table", "image", "img"]);
let used = 0;
for (const file of boards) {
  const lines = fs.readFileSync(at(file), "utf8").split("\n");
  let inFence = null;
  lines.forEach((line, i) => {
    const open = line.match(/^```(\w+)/);
    if (open) {
      inFence = inFence === null ? open[1] : inFence;
      return;
    }
    if (line.startsWith("```")) {
      inFence = null;
      return;
    }
    if (inFence === null || PROSE.has(inFence)) return;
    /* Icon names are `[a-z0-9-]` plus one `:` namespace, so a tight class stops the match before a
       closing quote — the first version took `\S+` and reported `postgresql"` as unknown. */
    for (const m of line.matchAll(/\bicon=([A-Za-z0-9:_-]+)/g)) {
      const raw = m[1];
      const prefix = ["mono:", "lucide:"].find((p) => raw.startsWith(p));
      const bare = prefix ? raw.slice(prefix.length) : raw;
      used++;
      /* A Lucide name is legal too, and `icon-names.ts` is the union of both — so that list, not
         the bundle, is the authority for what a board may say. */
      if (!listed.has(bare)) note(`unknown icon in ${file}:${i + 1}`, raw);
    }
  });
}

/*
 * 4. Which names two vocabularies both claim.
 *
 * Reported, never failed. `iconFor` resolves a brand before a Lucide glyph, so every name below
 * draws the logo and not the concept glyph. Most of them are brands Lucide also has a glyph for —
 * `figma`, `github`, `gitlab`, `slack`, `vault` — where Lucide's version was an approximation
 * shadowing the real mark, and the logo is plainly what you want. `snowflake` is the one that is
 * genuinely both: Lucide drew the ❄ weather glyph and a data-warehouse company joined the manifest
 * under the same name. The brand wins there too, on purpose — a diagram asking for `snowflake`
 * almost always means the company, no board asks for the weather by name, and
 * `icon=lucide:snowflake` forces the glyph back.
 *
 * It is printed on every run so the next name of this kind cannot arrive quietly: the day a brand
 * called `shield` or `activity` enters the manifest, some board's concept glyph silently becomes
 * a logo, and this line is the only warning anyone gets. The test for a new name is not a count
 * but the question above — is it a brand that also has a glyph, or a concept that also has a
 * company?
 */
const kebab = (p) =>
  p
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
const lucideNames = new Set(
  Object.keys(await import("lucide-react"))
    .filter((k) => /^[A-Z]/.test(k) && !k.startsWith("Lucide") && !k.endsWith("Icon"))
    .map(kebab),
);
const ambiguous = [...known].filter((n) => lucideNames.has(n)).sort();

if (problems.length) {
  console.error(`${problems.length} icon problem(s):\n`);
  for (const p of problems) console.error(`  ${p.what.padEnd(52)} ${p.detail}`);
  console.error("\nRun `npm run icons:build` if the bundle is stale, or fix the name.");
  process.exit(1);
}

if (ambiguous.length) {
  console.log(`note: ${ambiguous.length} name(s) claimed by both Lucide and a brand set — the brand wins`);
  console.log(`      ${ambiguous.join(" ")}`);
  console.log(`      use \`icon=lucide:<name>\` for the concept glyph`);
}

console.log(
  `ok: ${bundle.counts.color} colour + ${bundle.counts.mono} mono icons, ${shelved.length} emoji, ` +
    `${listed.size} names, ${used} \`icon=\` use(s) across ${boards.length} board(s) all resolve`,
);
