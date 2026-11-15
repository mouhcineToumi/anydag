import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeAssistant, readPanel, setPanelDocument, showChat, toggleAssistant } from "@/assistant/panelState";

/**
 * Which chat the Assistant's panel opens on (#321).
 *
 * The panel used to fall back to the vault's newest chat whenever it had none of its own, so the
 * sparkle on a note could continue a conversation about a different document. Now `null` is a new
 * chat; the chat it holds belongs to one document, and moving to another clears it. The store is a
 * module shared by every file in a worker (`isolate: false`), so each test puts it back.
 */

const FIRST = "note:first";
const SECOND = "note:second";

function reset(): void {
  closeAssistant();
  setPanelDocument("reset");
  showChat(null);
}

describe("the Assistant's panel chat", () => {
  beforeEach(reset);
  afterEach(reset);

  it("opens on a new chat, never on the vault's newest", () => {
    setPanelDocument(FIRST);
    toggleAssistant();
    expect(readPanel()).toEqual({ open: true, chat: null, document: FIRST });
  });

  it("keeps the chat when the panel is closed and reopened on the same document", () => {
    setPanelDocument(FIRST);
    showChat("c1");
    closeAssistant();
    toggleAssistant();
    expect(readPanel()).toEqual({ open: true, chat: "c1", document: FIRST });
  });

  it("starts a new chat after moving to another document, and does not bring the old one back", () => {
    setPanelDocument(FIRST);
    showChat("c1");
    setPanelDocument(SECOND);
    expect(readPanel().chat).toBeNull();

    /* Back on the first note: the person has moved since, so this is a new chat too. */
    setPanelDocument(FIRST);
    toggleAssistant();
    expect(readPanel()).toEqual({ open: true, chat: null, document: FIRST });
  });

  it("keeps the chat when the document is set to the one it already is", () => {
    setPanelDocument(FIRST);
    showChat("c1");
    setPanelDocument(FIRST);
    expect(readPanel().chat).toBe("c1");
  });

  it("clears the chat for New chat without leaving the document", () => {
    setPanelDocument(FIRST);
    showChat("c1");
    showChat(null);
    closeAssistant();
    toggleAssistant();
    expect(readPanel()).toEqual({ open: true, chat: null, document: FIRST });
  });

  it("keeps a chat made on the new document", () => {
    setPanelDocument(FIRST);
    showChat("c1");
    setPanelDocument(SECOND);
    showChat("c2");
    closeAssistant();
    toggleAssistant();
    expect(readPanel()).toEqual({ open: true, chat: "c2", document: SECOND });
  });
});
