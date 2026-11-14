import type { Settings } from "./store";

/**
 * The AI features a person can turn off (#296), each one switch under the AI tab's master switch.
 *
 * **Off means gone, not disabled.** A feature that is off draws no button, no shortcut, no model
 * chip and no page, and the layout closes up around it; nothing about it asks to be explained. A
 * file that already holds one of its things — a prompt card on a board — still opens, and draws it
 * read-only: turning a feature off never writes a byte of a vault.
 *
 * - `prompts`: the prompt card — the dock's button, `space P`, *Describe a diagram* on an empty
 *   board, the library's *Generate* entry, and running a card.
 * - `rewrite`: *Change with AI* in the selection bar, its model chip and its dialog.
 * - `flashcards`: *Generate flashcards* in the quiz editor.
 * - `assistant`: the sidebar's entry, the top bar's sparkle, `space A`, the panel and the page.
 *
 * No React here, so the rule is a unit test; `useAi.ts` is the hook over it.
 */
export type AiSwitch = "prompts" | "rewrite" | "flashcards" | "assistant";

/** In the order the AI tab draws them. */
export const AI_SWITCHES: readonly AiSwitch[] = ["prompts", "rewrite", "flashcards", "assistant"];

export const AI_SWITCH_LABEL: Readonly<Record<AiSwitch, string>> = {
  prompts: "Prompt cards",
  rewrite: "Change with AI",
  flashcards: "Generate flashcards",
  assistant: "Assistant",
};

/** What each switch hides, in a person's words: the row's hint. */
export const AI_SWITCH_HINT: Readonly<Record<AiSwitch, string>> = {
  prompts: "Describe a diagram on a card and a model draws it.",
  rewrite: "Describe a change to a selected diagram and a model rewrites it.",
  flashcards: "A model writes flashcards for a quiz from a topic or a note.",
  assistant: "The chat in the side panel and on its own page.",
};

/**
 * Whether one feature is drawn: its own switch, and the master's. The master off wins over every
 * feature's switch without changing it, so turning the master back on restores each as it was.
 */
export function aiOn(s: Pick<Settings, "features">, feature: AiSwitch): boolean {
  return s.features.ai && s.features[feature];
}

/** Whether any AI feature is drawn: what the AI providers tab and the model pickers are for. */
export function anyAiOn(s: Pick<Settings, "features">): boolean {
  return AI_SWITCHES.some((f) => aiOn(s, f));
}
