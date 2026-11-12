import { defaultIconProps, iconToHTML, iconToSVG, replaceIDs } from "@iconify/utils";
import { useMemo } from "react";

import { providerName } from "@/settings/providerNames";

import marks from "../../icons/data/providers.json";

/**
 * The mark a provider draws beside its model: the provider's own logo, not a letter badge.
 *
 * The art is `icons/data/providers.json`, four logos generated beside the brand bundle by
 * `scripts/icons/build.mjs`. It is imported here rather than drawn through `Icon`, because `Icon`
 * fetches the whole 2.5 MB bundle (`src/render/art.ts`), and opening Settings must not cost the
 * diagram vocabulary. The artwork carries its own colours, which is why it lives in `icons/` and
 * not in `src/`.
 *
 * Z.ai is the one in the app's provider table with no mark in either source, so it falls back to
 * its name until one is added. OpenAI-compatible borrows OpenAI's mark because that is the dialect
 * it speaks.
 */
interface Glyph {
  body: string;
  width?: number;
  height?: number;
}

/* Anthropic's and OpenAI's marks are one colour, and their colour-set art is that colour — black —
   so on a dark theme they vanished. The mono art draws in `currentColor`, the ink of the text beside
   it, in every theme. Gemini's mark is its gradient, which reads on light and dark alike. */
const MARKS: Readonly<Record<string, { set: "color" | "mono"; name: string }>> = {
  claude: { set: "mono", name: "anthropic" },
  gemini: { set: "color", name: "google-gemini" },
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
  /* `replaceIDs` per instance: the Gemini mark has gradients, and two of it on one page must not
     share their ids. The file is generated from vetted icon sets, never from anything typed. */
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
