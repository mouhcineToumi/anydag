import { useSyncExternalStore } from "react";

/**
 * Whether the Assistant's panel is open, and which chat it shows.
 *
 * A tiny store rather than state in `Shell`, because three things reach it from outside: the leader
 * chord `space A` (heard by the board's editor and by the pages with no canvas), the top bar's
 * sparkle, and the page's own link. It is **not remembered across a reload**: a remembered key would
 * be a preference, and `test/prefs.test.ts` holds that set closed — a panel that opens by itself on
 * a cold load is also something the person did not ask for.
 */
interface State {
  open: boolean;
  /** The chat the panel shows; `null` is the vault's newest, or a new one when it has none. */
  chat: string | null;
}

let state: State = { open: false, chat: null };
const listeners = new Set<() => void>();

const set = (next: State) => {
  if (next.open === state.open && next.chat === state.chat) return;
  state = next;
  for (const l of listeners) l();
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const usePanel = (): State => useSyncExternalStore(subscribe, () => state, () => state);

/** `space A`, and the sparkle. */
export const toggleAssistant = (): void => set({ ...state, open: !state.open });
export const closeAssistant = (): void => set({ ...state, open: false });
/** The panel's chat, once it has made or chosen one — so the page it opens onto is the same chat. */
export const showChat = (chat: string | null): void => set({ ...state, chat });
