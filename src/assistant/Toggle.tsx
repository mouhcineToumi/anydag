import { Sparkles } from "lucide-react";

import { chordFor } from "@/edit/bindings";

import { toggleAssistant, usePanel } from "./panelState";

/** The top bar's sparkle: the Assistant's panel, on or off, beside whatever page is open. */
export function AssistantToggle() {
  const { open } = usePanel();
  const chord = chordFor("assistant");
  return (
    <button
      type="button"
      className="dag-icon dag-toolbar__assistant"
      data-dag-assistant-toggle=""
      aria-pressed={open}
      aria-label="Assistant"
      title={chord ? `Assistant (${chord})` : "Assistant"}
      onClick={toggleAssistant}
    >
      <Sparkles size={16} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" />
    </button>
  );
}
