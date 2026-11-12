import { askPage } from "@/ui/chrome";

import { modelChoice, modelChoiceText } from "./modelChoice";
import { useProviders } from "./useProviders";
import { useSettings } from "./useSettings";

/**
 * Who would answer an AI surface: the provider and model, in a small chip that opens Settings → AI
 * and agents. It reads the same settings and `GET /__board/llm` answer a request does, so a person
 * can see the choice without opening the settings tab — and change it in one press.
 *
 * Text only for now; the provider's mark arrives with #182.
 */
export function ModelChip({
  where,
  onOpen,
}: {
  /** The surface the chip sits on, for the page and its checks: prompt, rewrite or flashcards. */
  where: "prompt" | "rewrite" | "flashcards";
  /** A dialog that must close before Settings opens can pass its own; Settings is the default. */
  onOpen?(): void;
}) {
  const [list] = useProviders();
  const settings = useSettings();
  const text = modelChoiceText(modelChoice(settings.llm, list));
  return (
    <button
      type="button"
      className="dag-modelchip"
      data-dag-model-chip={where}
      title="Which model answers here. Open AI settings"
      onClick={(e) => {
        e.stopPropagation();
        if (onOpen) onOpen();
        else askPage("settings", "agents");
      }}
    >
      {text}
    </button>
  );
}
