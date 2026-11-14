import { useEffect } from "react";
import { ExternalLink, MessageSquarePlus, X } from "lucide-react";

import { closeAssistant, showChat, usePanel } from "./panelState";
import { NEW_CHAT } from "./Page";
import { ChatSurface } from "./Surface";
import { useChat, useChats } from "./useChat";

const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * The Assistant down the right of any page (`space A`): a new chat, or the one this document was
 * already in, with the composer at the foot, and a way out to the page, which keeps the same chat.
 * A chat belongs to the document it was chosen on — `panelState` clears it when the window moves
 * elsewhere — so the panel never continues a conversation about a document that is no longer open.
 * It is a column of the window beside whatever page is open, so what the Assistant writes reaches
 * an open board or note through the change feed like anybody else's write.
 *
 * It is not the inspector's column, though the plan says it should be: the inspector belongs to the
 * board page, and this has to sit beside a note, the Tasks page and the Calendar too. It is a
 * column of the shell, at a width of its own.
 */
export function AssistantPanel({
  onOpen,
  onPage,
}: {
  onOpen(kind: "board" | "note" | "quiz" | "table", name: string): void;
  onPage(chat: string): void;
}) {
  const { chat: id } = usePanel();
  const chats = useChats();
  const chat = useChat(id);
  /* A chat the server no longer has — deleted on the page, or on another machine — is a new one. */
  useEffect(() => {
    if (chat.missing) showChat(null);
  }, [chat.missing]);
  const title = id ? (chat.meta?.title ?? chats.rows.find((r) => r.id === id)?.title ?? "") : "";
  return (
    <aside className="dag-assistant-panel" aria-label="Assistant" data-dag-assistant-panel="">
      <header className="dag-assistant-panel__head">
        <strong className="dag-assistant-panel__title" data-dag-assistant-panel-title="">
          {title || "Assistant"}
        </strong>
        <button
          type="button"
          className="dag-icon"
          data-dag-assistant-panel-new=""
          aria-label="New chat"
          title="New chat"
          onClick={() => showChat(null)}
        >
          <MessageSquarePlus {...ICON} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="dag-icon"
          data-dag-assistant-panel-page=""
          aria-label="Open in Assistant"
          title="Open in Assistant"
          onClick={() => onPage(id ?? NEW_CHAT)}
        >
          <ExternalLink {...ICON} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="dag-icon"
          data-dag-assistant-panel-close=""
          aria-label="Close the Assistant"
          title="Close (Space A)"
          onClick={closeAssistant}
        >
          <X {...ICON} aria-hidden="true" />
        </button>
      </header>
      {chat.missing ? null : <ChatSurface id={id} chat={chat} onId={showChat} onOpen={onOpen} autofocus welcome={id === null} />}
    </aside>
  );
}
