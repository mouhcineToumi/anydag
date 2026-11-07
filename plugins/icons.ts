import bundle from "../icons/data/icons.json";
import { ICON_NAMES } from "../src/dsl/icon-names";

/**
 * The icon vocabulary, off the wire: `GET /__board/icons`.
 *
 * `ICON_NAMES` was imported by exactly two validators, and both only ever used it to say "no" —
 * `W_UNKNOWN_ICON` in the parsers and `check-icons.mjs` over `boards/`. So `dbt` and
 * `gcp:bigquery` exist and nothing outside one person's memory said so: an agent writing a board,
 * or the model behind a prompt card, could not ask the dev server what is legal after `icon=`,
 * the way `/dsl` lets it ask what is legal for the grammar and `/library` what is legal for the
 * parts. This is that third vocabulary, served from the running server.
 *
 * The **mode** is the half a name does not carry. `brand` draws the logo in its own colours on a
 * neutral tile, `mono` draws the silhouette that inherits the hue, `concept` draws Lucide's glyph
 * in `currentColor` — and `postgresql` is the first, `server` the third, with nothing in the
 * spellings to tell them apart. `iconFor()` in `src/render/Icon.tsx` is the authority on the
 * order, and the order is *derived* here rather than restated: the generated name set is exactly
 * the union of Lucide's names, the bundle's `mono` and `color` maps and its aliases, so asking
 * those maps in `iconFor`'s order — alias first, then colour, then silhouette, then concept by
 * elimination — is the same question the renderer answers at draw time, with no second table to
 * fall out of step with it.
 */

const BUNDLE = bundle as unknown as {
  mono: Record<string, unknown>;
  color: Record<string, unknown>;
  aliases: Record<string, string | undefined>;
};

export type IconMode = "brand" | "mono" | "concept";

/** The values `?mode=` may take — the route's 400 names this list. */
export const ICON_MODES: readonly IconMode[] = ["brand", "mono", "concept"];

const modeOf = (raw: string): IconMode => {
  /* An emoji is a picture in its own colours, drawn the way a brand is — untinted on a
     neutral tile. `mono:emoji:<name>` is the same subject in the hue, the way `mono:` is for a brand,
     and like a brand's silhouette it is a spelling of this name rather than a name of its own. */
  if (raw.startsWith("emoji:")) return "brand";
  const name = BUNDLE.aliases[raw] ?? raw;
  if (BUNDLE.color[name]) return "brand";
  if (BUNDLE.mono[name]) return "mono";
  return "concept";
};

export interface ServedIcon {
  name: string;
  mode: IconMode;
}

export interface IconVocabulary {
  icons: ServedIcon[];
  /** Every name the query matches, however many are listed. */
  total: number;
  /** How many of them are in `icons`. */
  returned: number;
  /** `icons` is a truncation of the matches, not all of them. */
  truncated: boolean;
}

/* The whole set, once, at plugin load — one pass over ~4,500 names, so a request is a filter and
   never a rebuild. Sorted because truncation and `?q=` are only readable when the order is stable
   whatever the generated file did. */
const VOCABULARY: ServedIcon[] = [...ICON_NAMES]
  .sort()
  .map((name) => ({ name, mode: modeOf(name) }));

/** The cap on an unfiltered answer: enough to see the shape of the vocabulary, small enough to read. */
export const ICON_LIMIT = 500;

/** The vocabulary, optionally narrowed by substring (`q`) and by the way it draws (`mode`). */
export function iconVocabulary(opts: { q?: string; mode?: string; limit?: number } = {}): IconVocabulary {
  const needle = opts.q?.toLowerCase();
  const mode = opts.mode as IconMode | undefined;
  const hits = VOCABULARY.filter(
    (icon) => (!needle || icon.name.toLowerCase().includes(needle)) && (!mode || icon.mode === mode),
  );
  const icons = hits.slice(0, opts.limit ?? ICON_LIMIT);
  return { icons, total: hits.length, returned: icons.length, truncated: icons.length < hits.length };
}
