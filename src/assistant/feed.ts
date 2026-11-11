/**
 * The Assistant's live channel: one `EventSource` per key — a chat's id, or `*` for every chat — shared
 * by whoever listens and shut when the last one lets go. `/__board/chat/events` names a chat with
 * `?id=` and answers for the whole vault without one; the panel and the page may both be up, and two
 * connections for one chat would be two of the six a browser allows an origin.
 *
 * The server writes each event as `chat:<type>` with the whole `ChatEvent` as its data, so one
 * listener per name is all there is. An `EventSource` reconnects by itself, and says so with `open`:
 * `onOpen` is how a hook fetches again what it may have missed while it was away.
 */

import { scopeUrl } from "@/vault/current";

import type { ChatEvent } from "./types";

const TYPES = ["chat", "turn", "step", "delta", "blocks", "end", "undo", "gone"] as const;

interface Channel {
  source: EventSource;
  listeners: Set<(e: ChatEvent) => void>;
  opens: Set<() => void>;
}

const channels = new Map<string, Channel>();

export function subscribeChat(key: string, on: (e: ChatEvent) => void, onOpen?: () => void): () => void {
  if (typeof EventSource === "undefined") return () => undefined;
  let ch = channels.get(key);
  if (!ch) {
    const source = new EventSource(
      scopeUrl(key === "*" ? "/__board/chat/events" : `/__board/chat/events?id=${encodeURIComponent(key)}`),
    );
    ch = { source, listeners: new Set(), opens: new Set() };
    const made = ch;
    for (const t of TYPES) {
      source.addEventListener(`chat:${t}`, (m) => {
        let e: ChatEvent;
        try {
          e = JSON.parse((m as MessageEvent<string>).data) as ChatEvent;
        } catch {
          return;
        }
        for (const l of made.listeners) l(e);
      });
    }
    /* Every open, the first included. A hook reads the chat as it subscribes, while the stream is
       still connecting, and that read can answer before the server is listening: whatever was said
       in between — the `end` of a first message, the `chat` that adds a row to the history — was in
       neither. The server listens before it writes the first byte, so a read after `open` covers the
       gap. A later open is a reconnect, and the gap it covers is the time it was away. */
    source.addEventListener("open", () => {
      for (const f of made.opens) f();
    });
    channels.set(key, ch);
  }
  ch.listeners.add(on);
  if (onOpen) ch.opens.add(onOpen);
  const held = ch;
  return () => {
    held.listeners.delete(on);
    if (onOpen) held.opens.delete(onOpen);
    if (held.listeners.size === 0) {
      held.source.close();
      if (channels.get(key) === held) channels.delete(key);
    }
  };
}
