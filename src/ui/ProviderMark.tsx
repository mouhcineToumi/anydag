import { defaultIconProps, iconToHTML, iconToSVG, replaceIDs } from "@iconify/utils";
import { useMemo } from "react";

import { providerName } from "@/settings/providerNames";

import marks from "../../icons/data/providers.json";

/**
 * The mark a provider draws beside its model: the provider's own logo, not a letter badge.
 *
 * The art is `icons/data/providers.json`, three logos generated beside the brand bundle by
 * `scripts/icons/build.mjs`. It is imported here rather than drawn through `Icon`, because `Icon`
 * fetches the whole 2.5 MB bundle (`src/render/art.ts`), and opening Settings must not cost the
 * diagram vocabulary. The artwork is a generated icon set, which is why it lives in `icons/` and
 * not in `src/`.
 *
 * A provider with no mark in either source falls back to its name. OpenAI-compatible borrows
 * OpenAI's mark because that is the dialect it speaks.
 */
interface Glyph {
  body: string;
  width?: number;
  height?: number;
}

/* All three marks are one colour, and their colour-set art is that same colour — black — so on a
   dark theme they vanished. The mono art draws in `currentColor`, the ink of the text beside it, in
   every theme. */
const MARKS: Readonly<Record<string, { set: "color" | "mono"; name: string }>> = {
  claude: { set: "mono", name: "anthropic" },
  opencode: { set: "mono", name: "opencode" },
  custom: { set: "mono", name: "openai" },
};

function glyphOf(provider: string): Glyph | null {
  const mark = MARKS[provider];
  if (!mark) return null;
  const set = marks[mark.set] as Readonly<Record<string, Glyph>>;
  return set[mark.name] ?? null;
}

export function ProviderMark({
  provider,
  size = 14,
  nameFallback = true,
}: {
  provider: string | null | undefined;
  size?: number;
  /** When there is no mark: draw the provider's name, or nothing where a heading shows it. */
  nameFallback?: boolean;
}) {
  const glyph = provider ? glyphOf(provider) : null;
  /* `replaceIDs` per instance: a mark's SVG fragment ids must not be shared between two of it on
     one page. The file is generated from vetted icon sets, never from anything typed. */
  const markup = useMemo(() => {
    if (!glyph) return null;
    const fit = (glyph.width ?? 0) > (glyph.height ?? 0) ? { width: String(size) } : { height: String(size) };
    const built = iconToSVG({ ...defaultIconProps, ...glyph }, fit);
    return iconToHTML(replaceIDs(built.body), built.attributes);
  }, [glyph, size]);
  if (!provider) return null;
  const name = providerName(provider);
  if (!markup) {
    if (!nameFallback) return null;
    return (
      <span className="dag-provider-mark dag-provider-mark--name" title={name}>
        {name ?? provider}
      </span>
    );
  }
  return (
    <span
      className="dag-provider-mark"
      title={name}
      aria-hidden="true"
      data-dag-provider-mark={provider}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
