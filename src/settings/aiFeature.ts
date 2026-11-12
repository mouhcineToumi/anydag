import { modelChoiceText, type ModelChoice } from "./modelChoice";

/** The two AI features Settings draws as one row each on a phone. */
export type AiFeature = "diagrams" | "assistant";

export const AI_FEATURE_LABEL: Readonly<Record<AiFeature, string>> = {
  diagrams: "Diagrams and flashcards",
  assistant: "Assistant",
};

/** The picker's scale in a person's words. `null` is Automatic, which the summary leaves unsaid. */
const EFFORT_WORD: Readonly<Record<string, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
  none: "None",
};

/**
 * One line for an AI feature at phone width: "Claude Code · sonnet · Low".
 *
 * The provider and model are `modelChoiceText`'s, so the row and the chip on a prompt card cannot
 * name a different model. The effort is added only when one is chosen: Automatic is the absence of
 * a decision, and saying it twice would make the row longer without telling anyone more.
 */
export function featureSummary(choice: ModelChoice | null, effort: string | null): string {
  const base = modelChoiceText(choice);
  if (!effort) return base;
  return `${base} · ${EFFORT_WORD[effort] ?? effort}`;
}
