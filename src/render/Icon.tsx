import { iconToHTML, iconToSVG, replaceIDs, defaultIconProps } from "@iconify/utils";
import { useMemo } from "react";

import { ICON_NAMES } from "@/dsl/icon-names";
import type { NodeKind } from "@/dsl/ir";
import type { Theme } from "@/theme/contract";

import { brandGlyph, cutOf, emojiGlyph, lucideGlyph, useArtReady, type ArtCut } from "./art";
import { ALIASES, COLOR, LUCIDE, MONO } from "./icon-index";

/**
 * Icons, at one size and one weight, stated here and nowhere else.
 *
 * There are three kinds of glyph and the difference is not decorative.
 *
 * A **concept** glyph is Lucide: a server, a queue, a person. It draws in `currentColor`, so the
 * tile's own token decides the colour and "never hard-code a colour" holds with nothing to enforce.
 * The kind → glyph table lives in the theme, so a theme that wants a different icon language
 * changes a JSON rather than the renderer. This is rule 8: in an architecture diagram the icon
 * carries the kind, and uniform boxes are what made the first attempt read as a data model.
 *
 * A **mono** glyph is a brand reduced to one silhouette — Simple Icons, also `currentColor`, so it
 * behaves exactly like a concept glyph and inherits the hue. Postgres' elephant is still Postgres
 * at 20px without borrowing Postgres' blue.
 *
 * A **brand** glyph is the logo in its own colours, and it is the one case where a colour enters a
 * diagram from outside the theme. It therefore gets a neutral tile rather than a hue-tinted one
 * (`.dag-tile--brand`) and the node's hue moves to the card border: two colour systems fighting
 * inside one 36px square reads as noise, and the hue still has to mean "which group is this".
 * Keeping the artwork unmodified is also what keeps the vendor packs licit — see `icons/README.md`.
 *
 * **What a name draws is decided from the index, and drawn from art that loads late.** `iconFor`
 * reads `./icon-index.ts` — which names each set holds — and never the art, so it is synchronous and
 * the drawing is unchanged; the art is `./art.ts`'s, fetched the first time something draws from it.
 */

type IconMode = "concept" | "mono" | "brand";
export interface IconRef {
  mode: IconMode;
  name: string;
}

/** `icon=key-round` in the DSL, `KeyRound` in Lucide. Authors should not have to know the casing. */
const pascalOf = (name: string): string => name.replace(/(^|[-_])([a-z])/g, (_, __, c: string) => c.toUpperCase());

/**
 * Whether Lucide draws this spelling — the question `icon=lucide:<name>` asks.
 *
 * Exported because the answer is emphatically *not* "every name the brand bundle does not have".
 * The names both vocabularies claim are in the bundle **and** in Lucide, and they are the only
 * names for which the prefix is the sole route to the glyph — so a set derived by subtracting the
 * bundle loses precisely the six that need it most. `check-icons.mjs` prints that overlap on every
 * run; this is the same fact, asked of the registry rather than inferred from its complement.
 */
export const hasLucide = (name: string): boolean => LUCIDE.has(pascalOf(name));

/**
 * What `icon=` resolves to, in the order a name is tried.
 *
 * A brand beats Lucide, and that ordering was chosen the other way round first. The argument for
 * Lucide-first was that `icon=server` has meant a Lucide server since M1a and a brand set acquiring
 * that slug must not silently redraw old boards. The argument is sound and the ordering it produced
 * was still wrong, because the overlap turned out to be five names — `figma`, `github`, `gitlab`,
 * `slack`, `vault` — every one of which is a *brand*, and on each of them Lucide's approximation
 * was shadowing the real logo. None of the kinds a theme maps (`Server`, `Database`, `Monitor`,
 * `User`, `Network`, …) is a brand name, so the case the old ordering protected does not arise.
 * `check-icons.mjs` prints the overlap on every run, so a sixth name cannot appear unnoticed.
 *
 * Two prefixes settle it explicitly either way: `mono:` asks for a brand as a tinted silhouette,
 * `lucide:` asks for the concept glyph even where a brand owns the name.
 *
 * **An emoji is a brand that loads late**. `emoji:house` is a picture in its own colours,
 * so it is `brand` — a neutral tile on a card, untinted — and `mono:emoji:house` is the same subject
 * in `currentColor`, so it is `mono`. The mode is the whole of what a tile, the picker and the
 * `/icons` route need to know; *where* the art comes from is `Icon`'s business, below. The name keeps
 * its namespace, which is how `Icon` tells it apart from a brand of the same spelling.
 *
 * An unresolvable name falls back to the kind's default rather than throwing. It is not silent —
 * `finalize()` has already reported `W_UNKNOWN_ICON` against the line that wrote it — and a diagram
 * that still draws is more useful than one replaced by an error card over a typo.
 */
export function iconFor(kind: NodeKind, theme: Theme, override?: string): IconRef {
  const fallback = (): IconRef => ({ mode: "concept", name: theme.icons[kind] ?? theme.icons.default ?? "Box" });
  if (!override) return fallback();

  const prefix = ["mono:", "lucide:"].find((p) => override.startsWith(p));
  const raw = prefix ? override.slice(prefix.length) : override;
  const name = ALIASES[raw] ?? raw;

  if (name.startsWith("emoji:")) {
    if (!ICON_NAMES.has(name) || prefix === "lucide:") return fallback();
    return { mode: prefix === "mono:" ? "mono" : "brand", name };
  }

  if (prefix === "mono:") return MONO.has(name) ? { mode: "mono", name } : fallback();
  if (prefix === "lucide:") return LUCIDE.has(pascalOf(name)) ? { mode: "concept", name: pascalOf(name) } : fallback();

  if (COLOR.has(name)) return { mode: "brand", name };
  if (MONO.has(name)) return { mode: "mono", name };
  if (LUCIDE.has(pascalOf(name))) return { mode: "concept", name: pascalOf(name) };
  return fallback();
}

/**
 * The file a glyph is drawn from (`./art.ts`): Lucide for a concept glyph — the kind's default
 * included — an emoji cut for a picture, the brand bundle for a logo or a silhouette.
 */
export function artOf(icon: IconRef): ArtCut {
  if (icon.mode === "concept") return "lucide";
  return cutOf(icon.mode === "mono" && icon.name.startsWith("emoji:") ? `mono:${icon.name}` : icon.name) ?? "brand";
}

/**
 * The classes a tile needs for the glyph it is about to hold.
 *
 * A brand logo brings its own colours, so its tile drops the hue tint and goes neutral. Stated once
 * here because all three cards that carry a tile — arch, C4, sequence — have to agree, and a fourth
 * would otherwise get it wrong by omission.
 */
export const tileClass = (icon: IconRef, extra?: string): string =>
  `dag-tile${extra ? ` ${extra}` : ""}${icon.mode === "brand" ? " dag-tile--brand" : ""}`;

/**
 * Render one glyph as inline markup.
 *
 * `replaceIDs` runs here, per mounted instance, and that placement is the whole point. A colour
 * icon carries `<linearGradient id=…>` under a name fixed in the data, so two Azure cards on one
 * board would both define it and the second would resolve `url(#…)` to the first one's element.
 * Rewriting the ids once at build time would not help — every instance would still share them.
 *
 * Exactly one axis is pinned, and which one depends on the glyph. 79% of the colour icons declare
 * their own content box because a brand mark is not square, and pinning both would squash them —
 * but pinning height alone lets a wide mark grow sideways out of the tile and across the card. The
 * build already swaps a wordmark for its `-icon` sibling where `logos` has one; a dozen brands have
 * no such sibling, so the wider axis is the one constrained here and the glyph fits a square box
 * whatever its shape. `.dag-tile` is a centring flex box, so the short axis takes care of itself.
 */
export function Icon({ icon, size, stroke }: { icon: IconRef; size: number; stroke: number }) {
  /* Every glyph's art is a chunk of its own, fetched on first use (`./art.ts`). A missing glyph
     falls back to Lucide's box, so Lucide is asked for too — it is the smaller file, and nearly every
     diagram that draws a logo draws a concept glyph beside it. */
  const cut = artOf(icon);
  const landed = useArtReady(cut === "lucide" ? ["lucide"] : [cut, "lucide"]);

  const markup = useMemo(() => {
    if (icon.mode === "concept") return null;
    const emoji = cutOf(icon.mode === "mono" && icon.name.startsWith("emoji:") ? `mono:${icon.name}` : icon.name);
    const glyph = emoji ? emojiGlyph(emoji, icon.name) : brandGlyph(icon.mode, icon.name);
    if (!glyph) return null;
    const fit = glyph.width > glyph.height ? { width: String(size) } : { height: String(size) };
    const built = iconToSVG({ ...defaultIconProps, ...glyph }, fit);
    return iconToHTML(replaceIDs(built.body), built.attributes);
  }, [icon.mode, icon.name, size, landed]);

  /* Not landed yet: a blank of the glyph's size, so nothing around it moves when the art arrives. */
  if (!landed) return <span className="dag-glyph" aria-hidden={true} style={{ width: size, height: size }} />;

  if (icon.mode === "concept" || !markup) {
    const Glyph = (icon.mode === "concept" ? lucideGlyph(icon.name) : null) ?? lucideGlyph("Box")!;
    return <Glyph size={size} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden={true} />;
  }
  /* The bundle is generated from vetted icon sets by `scripts/icons/build.mjs`, never from board
     input, so this is markup we produced rather than markup a board author can reach. */
  return <span className="dag-glyph" aria-hidden={true} dangerouslySetInnerHTML={{ __html: markup }} />;
}
