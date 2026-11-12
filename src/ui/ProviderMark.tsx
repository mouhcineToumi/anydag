import { Icon, type IconRef } from "@/render/Icon";
import { providerName } from "@/settings/providerNames";

/**
 * The mark a provider draws beside its model: the provider's own logo, not a letter badge.
 *
 * Z.ai is the one in the app's provider table with no brand in `icons/`, so it falls back to its
 * name until one is added — the same fallback the icon picker uses for a name the bundle does not
 * have. OpenAI-compatible borrows OpenAI's mark because that is the dialect it speaks.
 */
const MARKS: Readonly<Record<string, IconRef>> = {
  claude: { mode: "brand", name: "anthropic" },
  gemini: { mode: "brand", name: "google-gemini" },
  opencode: { mode: "mono", name: "opencode" },
  custom: { mode: "brand", name: "openai" },
};

export function ProviderMark({
  provider,
  size = 14,
  nameFallback = true,
}: {
  provider: string | null | undefined;
  size?: number;
  /** When the bundle has no mark: draw the provider's name, or nothing where a heading shows it. */
  nameFallback?: boolean;
}) {
  if (!provider) return null;
  const icon = MARKS[provider];
  const name = providerName(provider);
  if (!icon) {
    if (!nameFallback) return null;
    return (
      <span className="dag-provider-mark dag-provider-mark--name" title={name}>
        {name ?? provider}
      </span>
    );
  }
  return (
    <span className="dag-provider-mark" title={name} aria-hidden="true">
      <Icon icon={icon} size={size} stroke={2} />
    </span>
  );
}
