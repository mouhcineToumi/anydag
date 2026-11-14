import { Sparkles } from "lucide-react";

import { chordFor } from "@/edit/bindings";
import { useAi } from "@/settings/useAi";
import { IconButton } from "@/ui/controls";

import { toggleAssistant, usePanel } from "./panelState";

/**
 * The top bar's sparkle: the Assistant's panel, on or off, beside whatever page is open. Not drawn
 * at all with the Assistant turned off (#296).
 */
export function AssistantToggle() {
  const { open } = usePanel();
  const on = useAi().assistant;
  const chord = chordFor("assistant");
  if (!on) return null;
  return (
    <IconButton
      className="dag-toolbar__assistant"
      data-dag-assistant-toggle=""
      aria-pressed={open}
      aria-label="Assistant"
      shortcut={chord}
      onClick={toggleAssistant}
    >
      <Sparkles size={16} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" />
    </IconButton>
  );
}
