import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ExternalLink, MessageSquarePlus, X } from "lucide-react";

import { startDrag } from "@/ui/pointerDrag";

import type { ChipDoc } from "./DocChip";
import { closeAssistant, showChat, usePanel } from "./panelState";
import { NEW_CHAT } from "./Page";
import { ChatSurface } from "./Surface";
import { useChat, useChats } from "./useChat";
import { ASSISTANT_MAX, ASSISTANT_MIN, ASSISTANT_W, clampWidth, rememberWidth, storedWidth } from "./width";

const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** How far one arrow key moves the edge; Shift takes a longer step. */
const STEP = 16;
const BIG_STEP = 64;

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
 * column of the shell, at a width of its own — the one the person drags its left edge to, which the
 * page beside gives way to live (`--assistant-w`) and which is remembered across a reload.
 */
export function AssistantPanel({
  onOpen,
  onPage,
  beside,
}: {
  onOpen(kind: "board" | "note" | "quiz" | "table", name: string): void;
  onPage(chat: string): void;
  /** The document open beside the panel, which a chat started here works on (#323); `null` on a page that is not one. */
  beside: ChipDoc | null;
}) {
  const { chat: id } = usePanel();
  const chats = useChats();
  const chat = useChat(id);
  /* A chat the server no longer has — deleted on the page, or on another machine — is a new one. */
  useEffect(() => {
    if (chat.missing) showChat(null);
  }, [chat.missing]);
  const title = id ? (chat.meta?.title ?? chats.rows.find((r) => r.id === id)?.title ?? "") : "";

  const panel = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(() => storedWidth(window.innerWidth));
  /* The last width settled, so a held arrow key takes every repeat rather than re-reading a render. */
  const settled = useRef(width);

  /* One landing for the drag and the keys: the value the next reload reads is the value drawn. */
  const settle = useCallback((w: number) => {
    settled.current = rememberWidth(w);
    setWidth(settled.current);
  }, []);

  /*
   * The left edge, pulled. `startDrag` arms on the slop so a press that never moves is a click and
   * the double-click below still arrives; for the length of the drag the width is painted straight
   * onto the panel, which is the inspector's and the sidebar's split — React state here would
   * re-render the whole chat on every move. The page beside reflows from the flex row itself, and
   * `App`'s ResizeObserver on `.dag-viewport` moves the canvas's published box with it.
   */
  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = panel.current;
    if (!el || e.button !== 0) return;
    const startX = e.clientX;
    const startW = el.getBoundingClientRect().width;
    let w = startW;
    let moved = false;
    let dropped = false;
    const paint = (ev: PointerEvent) => {
      w = clampWidth(startW - (ev.clientX - startX), window.innerWidth);
      el.style.setProperty("--assistant-w", `${w}px`);
    };
    startDrag(e, {
      onMove(ev, first) {
        /* `startDrag` marks the document grabbing; a column edge is the one drag that is not. */
        if (first) document.documentElement.dataset.dagAssistantSizing = "";
        moved = true;
        paint(ev);
      },
      onDrop(ev) {
        dropped = true;
        paint(ev);
        settle(w);
      },
      onEnd() {
        delete document.documentElement.dataset.dagAssistantSizing;
        /* A cancelled drag — a system gesture taking the pointer — paints nothing anybody asked for,
           so the panel goes back to the width it had. */
        if (moved && !dropped) el.style.setProperty("--assistant-w", `${settled.current}px`);
      },
    });
  };

  /*
   * The keyboard half of the same edge. Left is wider because the panel is on the right, and the
   * step is the same at every zoom because this is the window rather than the board. The key is
   * stopped here: a focused separator is not somebody typing, so `useEditor`'s window handler would
   * otherwise nudge a selected item with the same arrow (it names this grip's attribute to leave).
   */
  const onGripKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? BIG_STEP : STEP;
    settle(clampWidth(settled.current + (e.key === "ArrowLeft" ? step : -step), window.innerWidth));
  };

  return (
    <aside
      className="dag-assistant-panel"
      data-dag-assistant-panel=""
      aria-label="Assistant"
      ref={panel}
      style={{ "--assistant-w": `${width}px` } as CSSProperties}
    >
      <div
        className="dag-assistant-panel__grip"
        data-dag-assistant-grip=""
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the Assistant panel"
        aria-valuemin={ASSISTANT_MIN}
        aria-valuemax={ASSISTANT_MAX}
        aria-valuenow={width}
        aria-valuetext={`${width} pixels wide`}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        onPointerDown={onGripDown}
        onKeyDown={onGripKey}
        onDoubleClick={() => settle(ASSISTANT_W)}
      />
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
      {chat.missing ? null : (
        <ChatSurface id={id} chat={chat} onId={showChat} onOpen={onOpen} autofocus welcome={id === null} beside={beside} />
      )}
    </aside>
  );
}
