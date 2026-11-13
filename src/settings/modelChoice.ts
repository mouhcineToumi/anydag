import { providerName } from "./providerNames";
import type { Settings } from "./store";
import type { Providers } from "./useProviders";

/**
 * Which provider and model the next prompt-card request would use — the same answer the request
 * gets from `readSettings().llm`, `GET /__board/llm`'s default and that provider's `defaultModel`.
 *
 * Pure, so a test holds the rule without a browser, and one place decides it for the chip on the
 * prompt card, in the Rewrite bar and in the Generate flashcards dialog.
 */
export interface ModelChoice {
  provider: string;
  /** The provider's name for a person, never its id. */
  name: string;
  model: string;
}

export function modelChoice(llm: Settings["llm"], list: Providers | null): ModelChoice | null {
  const provider = llm.provider ?? list?.default;
  if (!provider) return null;
  const known = list?.providers.find((p) => p.id === provider);
  const name = known?.label ?? providerName(provider);
  if (!name) return null;
  return { provider, name, model: llm.model ?? known?.defaultModel ?? "" };
}

/** The chip's words: `<Provider name> · <model>`, or "Automatic" while nothing is known yet. */
export function modelChoiceText(choice: ModelChoice | null): string {
  if (!choice) return "Automatic";
  return choice.model ? `${choice.name} · ${choice.model}` : choice.name;
}
