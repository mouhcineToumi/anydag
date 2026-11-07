/**
 * The emoji half of the icon bundle: Microsoft's Fluent Emoji, twice.
 *
 * Every other set here names a *technology* — a database, a cloud service, a queue. What a person
 * illustrating something reaches for is different: a person, a house, a book, a truck, a tree. An
 * emoji set is exactly that vocabulary, already drawn, already named by Unicode's own short names
 * (`house`, `office-building`, `man-technologist`), and consistent across fifteen hundred subjects
 * in a way no hand-picked list of icons could be.
 *
 * **Fluent, because of its licence and its look.** MIT — attribution, and nothing else — where
 * Twemoji and OpenMoji are CC-BY and CC-BY-SA, and Noto's detail runs to 7 MB. The *flat* cut is
 * clean shapes without gradients, which is what reads as part of a diagram rather than a sticker
 * pasted on one. It comes in two cuts with the same names, and both ship:
 *
 * - `emoji-color.json` — Fluent Emoji Flat, in its own colours. `icon=emoji:house`. A colour the
 *   theme does not own, which is why it lives here beside the brand logos and is drawn the way a
 *   brand is: untinted.
 * - `emoji-mono.json` — Fluent Emoji High Contrast, the same subjects drawn in `currentColor`.
 *   `icon=mono:emoji:house`. It takes the node's hue exactly as a Simple Icons silhouette does,
 *   which is how an illustration stays in the theme's palette when the author wants it to.
 *
 * **Skin-tone variants are left out.** The set carries five of every person and hand, and they are
 * a choice about a real person that a diagram's generic "customer" is not making — 1,581 icons of
 * the 3,174 are variants. The default (the yellow Unicode figure) is what ships; the names stay
 * Unicode's, so a variant is one entry here away if it is ever wanted.
 *
 * **Separate files, loaded when a board first names one.** Each is about a megabyte gzipped, the
 * whole brand bundle's weight again, and a board with no emoji on it must not pay for them.
 * `src/render/art.ts` imports them on demand; the names, which the parser needs to say
 * `W_UNKNOWN_ICON`, go into `src/dsl/icon-names.ts` like every other name, and their categories
 * into `src/dsl/emoji-names.ts` for the library's shelves.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getIconData } from "@iconify/utils";

const TONES = ["light", "medium-light", "medium", "medium-dark", "dark"];

/**
 * A name is a skin-tone variant when it ends in a tone *and* the name without it exists. The second
 * half is what keeps `horizontal-traffic-light` — which ends in `-light` and is a traffic light.
 */
const variantOf = (name, names) => TONES.some((t) => name.endsWith(`-${t}`) && names.has(name.slice(0, -(t.length + 1))));

/** One cut of the set, reduced to the names the colour cut defines and resolved through its aliases. */
function cut(set, names) {
  const icons = {};
  for (const name of names) {
    const data = getIconData(set, name);
    if (!data) continue;
    /* Every Fluent icon is 32×32, so the size is stated once at the top rather than 1,600 times. A
       `hFlip` survives because `backhand-index-pointing-right` is the left hand mirrored. */
    icons[name] = data.hFlip ? { body: data.body, hFlip: true } : { body: data.body };
  }
  return icons;
}

export function buildEmoji(root) {
  const at = (...p) => path.join(root, ...p);
  const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
  const flat = readJson(at("node_modules/@iconify-json/fluent-emoji-flat/icons.json"));
  const mono = readJson(at("node_modules/@iconify-json/fluent-emoji-high-contrast/icons.json"));
  const meta = readJson(at("node_modules/@iconify-json/fluent-emoji-flat/metadata.json"));
  const pkg = (p) => readJson(at(`node_modules/@iconify-json/${p}/package.json`)).version;

  const every = new Set([...Object.keys(flat.icons), ...Object.keys(flat.aliases ?? {})]);
  /* The categories are the metadata's own, in its order, minus the variants — and only names both
     cuts can draw, so `emoji:x` and `mono:emoji:x` are one vocabulary with two looks. */
  const categories = [];
  const names = [];
  for (const [category, list] of Object.entries(meta.categories)) {
    const icons = list.filter((n) => every.has(n) && !variantOf(n, every) && getIconData(mono, n));
    if (icons.length === 0) continue;
    categories.push({ name: category, icons });
    names.push(...icons);
  }

  const write = (file, set, source) => {
    const out = {
      generated: new Date().toISOString(),
      source,
      licence: "MIT",
      width: set.width ?? 16,
      height: set.height ?? 16,
      icons: cut(set, names),
    };
    writeFileSync(at(file), JSON.stringify(out));
    return out;
  };
  const color = write("icons/data/emoji-color.json", flat, `@iconify-json/fluent-emoji-flat@${pkg("fluent-emoji-flat")}`);
  const silhouette = write(
    "icons/data/emoji-mono.json",
    mono,
    `@iconify-json/fluent-emoji-high-contrast@${pkg("fluent-emoji-high-contrast")}`,
  );
  const missing = names.filter((n) => !color.icons[n] || !silhouette.icons[n]);
  if (missing.length) throw new Error(`emoji without both cuts: ${missing.join(" ")}`);

  writeFileSync(
    at("src/dsl/emoji-names.ts"),
    `/* GENERATED by scripts/icons/emoji.mjs — do not edit. Run \`npm run icons:build\`. */\n\n` +
      `/**\n * Fluent Emoji's subjects, by the set's own category, without the \`emoji:\` namespace.\n *\n` +
      ` * \`icon=emoji:<name>\` draws one in its own colours and \`icon=mono:emoji:<name>\` in the node's hue.\n` +
      ` * The artwork is in \`icons/data/emoji-*.json\` and is loaded only when a board names one.\n */\n` +
      `export const EMOJI_CATEGORIES: readonly { name: string; icons: readonly string[] }[] = [\n` +
      categories
        .map(
          (c) =>
            `  {\n    name: ${JSON.stringify(c.name)},\n    icons: [\n${c.icons.map((n) => `      ${JSON.stringify(n)},`).join("\n")}\n    ],\n  },`,
        )
        .join("\n") +
      `\n];\n`,
  );

  return { names, categories, bytes: { color: JSON.stringify(color).length, mono: JSON.stringify(silhouette).length } };
}
