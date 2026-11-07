/**
 * The Assistant's routes, as plain functions over
 * `fetch`. Every one is a `/__board` route, so the page's `fetch` wrapper names this tab's vault for
 * it, and a chat is found by its id in whichever open vault holds it.
 */

import type { ChatMeta, ChatRead, ChatRow, Mode, Provider, ProviderModels, Turn, UndoRecord } from "./types";

/** A refused request, with the server's own words and its `code` when it gave one. */
export class AssistantError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new AssistantError(typeof data.error === "string" ? data.error : `that did not work (${r.status})`, r.status, typeof data.code === "string" ? data.code : undefined);
  return data as T;
}

const q = (id: string) => encodeURIComponent(id);

export const listChats = async (): Promise<ChatRow[]> => (await call<{ chats: ChatRow[] }>("/__board/chats")).chats;

export const loadModels = async (): Promise<ProviderModels[]> => (await call<{ providers: ProviderModels[] }>("/__board/chat/models")).providers;

export const makeChat = async (o: { provider: Provider; model: string; effort?: string; mode?: Mode; title?: string }): Promise<ChatMeta> =>
  (await call<{ chat: ChatMeta }>("/__board/chat", o)).chat;

export const readChat = (id: string): Promise<ChatRead> => call<ChatRead>(`/__board/chat?id=${q(id)}`);

export const renameChat = async (id: string, title: string): Promise<ChatMeta> => (await call<{ chat: ChatMeta }>("/__board/chat/rename", { id, title })).chat;

export const deleteChat = async (id: string): Promise<void> => void (await call("/__board/chat/delete", { id }));

export interface TurnAsk {
  id: string;
  text: string;
  provider?: Provider;
  model?: string;
  /** `null` is the harness's own; absent leaves what the chat had. */
  effort?: string | null;
  mode?: Mode;
}

export const sayTurn = async (ask: TurnAsk): Promise<Turn> => (await call<{ turn: Turn }>("/__board/chat/turn", ask)).turn;

export const stopTurn = async (id: string): Promise<void> => void (await call("/__board/chat/stop", { id }));

export const answerStep = async (id: string, step: string, yes: boolean): Promise<void> => void (await call("/__board/chat/approve", { id, step, yes }));

export const grantVault = async (id: string, vault: string, mode: Mode | null): Promise<ChatMeta> =>
  (await call<{ chat: ChatMeta }>("/__board/chat/grant", { id, vault, mode })).chat;

export const undoBlock = async (id: string, turn: string, block: string, redo: boolean): Promise<UndoRecord> =>
  (await call<{ record: UndoRecord }>(redo ? "/__board/chat/redo" : "/__board/chat/undo", { id, turn, block })).record;
