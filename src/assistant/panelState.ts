import { useSyncExternalStore } from "react";

/**
 * Whether the Assistant's panel is open, which chat it shows, and the document it belongs to.
 *
 * A tiny store rather than state in `Shell`, because three things reach it from outside: the leader
 * chord `space A` (heard by the board's editor and by the pages with no canvas), the top bar's
 * sparkle, and the page's own link. It is **not remembered across a reload**: a remembered key would
 * be a preference, and `test/prefs.test.ts` holds that set closed — a panel that opens by itself on
 * a cold load is also something the person did not ask for.
 *
 * **A chat belongs to the document it was chosen on** (#321). The panel used to open on the vault's
 * newest chat, so the sparkle on a note could continue a conversation about a different document.
 * It opens on a new chat instead; closing and reopening it on the same document keeps the chat it
 * had, and `setPanelDocument` clears it once the window moves to another page. The chat is made by
 * its first message, so opening the panel writes nothing, and the older chats stay in the page's
 * history.
 */
interface State {
  open: boolean;
  /** The chat the panel shows; `null` is a new one, made by its first message. */
  chat: string | null;
  /** The document `chat` was chosen on: `board:<name>`, `note:<name>`, a page's name, or `home`. */
  document: string;
}

let state: State = { open: false, chat: null, document: "" };
const listeners = new Set<() => void>();

const set = (next: State) => {
  if (next.open === state.open && next.chat === state.chat && next.document === state.document) return;
  state = next;
  for (const l of listeners) l();
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const usePanel = (): State =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );

/** The store as it is, for the tests: a render reads it through {@link usePanel}. */
export const readPanel = (): Readonly<State> => state;

/** `space A`, and the sparkle. */
export const toggleAssistant = (): void => set({ ...state, open: !state.open });
export const closeAssistant = (): void => set({ ...state, open: false });
/** The panel's chat, once it has made or chosen one — so the page it opens onto is the same chat. */
export const showChat = (chat: string | null): void => set({ ...state, chat });

/**
 * The page the window is on, as the panel sees it. A different one means the chat it held was about
 * the document left behind, so the panel goes back to a new chat; the old one is still in the
 * history. Called by `Shell`, which is the one place that knows what is open.
 */
export const setPanelDocument = (document: string): void => {
  if (document === state.document) return;
  set({ ...state, chat: null, document });
};
