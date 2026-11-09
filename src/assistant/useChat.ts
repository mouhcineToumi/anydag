import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { listChats, loadModels, readChat } from "./api";
import { subscribeChat } from "./feed";
import type { ChatEvent, ChatMeta, ChatRead, ChatRow, ProviderModels, Step, Turn, UndoRecord } from "./types";

/** One chat as the page holds it: what is on disk, the turn in flight, and the words it is typing. */
export interface ChatState {
  meta: ChatMeta | null;
  /** The vault the chat lives in, for a page that has to name it. */
  vault: string;
  turns: Turn[];
  undos: UndoRecord[];
  /** The turn running now, as the stream has built it. */
  live: Turn | null;
  /** The words of the step being written, which become a text step when it is finished. */
  typing: string;
  /** This machine's device id, so a turn from another machine can be marked. */
  device: string;
  loaded: boolean;
  /** The server says there is no such chat. */
  missing: boolean;
  /** It was deleted while this page had it open, rather than never having existed. */
  gone: boolean;
}

const EMPTY: ChatState = {
  meta: null,
  vault: "",
  turns: [],
  undos: [],
  live: null,
  typing: "",
  device: "",
  loaded: false,
  missing: false,
  gone: false,
};

type Act = { t: "reset" } | { t: "loaded"; read: ChatRead } | { t: "missing" } | { t: "event"; e: ChatEvent };

/** Turns and undos in the order they happened, by id — which is time-based and sorts as it reads. */
const union = <T extends { id: string }>(a: readonly T[], b: readonly T[]): T[] => {
  const by = new Map<string, T>();
  for (const x of [...a, ...b]) by.set(x.id, x);
  return [...by.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
};

function reduce(s: ChatState, a: Act): ChatState {
  switch (a.t) {
    case "reset":
      return EMPTY;
    case "missing":
      return { ...EMPTY, loaded: true, missing: true };
    case "loaded": {
      const turns = union(s.turns, a.read.turns);
      const done = new Set(turns.map((t) => t.id));
      /* The read's turn in flight is newer than what the stream built before it answered; a turn the
         stream already ended is in `turns` and is not in flight any more. */
      const live = a.read.live && !done.has(a.read.live.id) ? a.read.live : s.live && !done.has(s.live.id) ? s.live : null;
      return {
        meta: a.read.chat,
        vault: a.read.vault,
        turns,
        undos: union(s.undos, a.read.undos),
        live,
        typing: live && live === s.live ? s.typing : "",
        device: a.read.device,
        loaded: true,
        missing: false,
        gone: false,
      };
    }
    case "event": {
      const e = a.e;
      switch (e.type) {
        case "chat":
          return { ...s, meta: e.chat };
        case "turn":
          return { ...s, live: e.turn, typing: "" };
        case "step": {
          if (!s.live || s.live.id !== e.turn) return s;
          const steps: Step[] = s.live.steps.slice();
          steps[e.index] = e.step;
          /* A step the harness has finished is the end of what was being typed: a text step is the
             words themselves, and a tool call ends the sentence before it. An approval does not. */
          const typed = e.step.kind === "text" || e.step.kind === "tool";
          const fresh = e.index >= s.live.steps.length;
          return { ...s, live: { ...s.live, steps }, typing: typed && fresh ? "" : s.typing };
        }
        case "delta":
          return s.live && s.live.id === e.turn ? { ...s, typing: s.typing + e.text } : s;
        case "blocks":
          return s.live && s.live.id === e.turn ? { ...s, live: { ...s.live, blocks: e.blocks } } : s;
        case "end":
          return {
            ...s,
            turns: union(s.turns, [e.turn]),
            live: s.live?.id === e.turn.id ? null : s.live,
            typing: s.live?.id === e.turn.id ? "" : s.typing,
          };
        case "undo":
          return { ...s, undos: union(s.undos, [e.record]) };
        case "gone":
          return s.meta?.id === e.chat ? { ...EMPTY, loaded: true, missing: true, gone: true } : s;
      }
    }
  }
}

/**
 * One chat, live: read once, then kept by the stream. `id` null is no chat yet — the first message
 * of a new one makes it — and draws nothing.
 */
export function useChat(id: string | null): ChatState & { reload(): void } {
  const [state, dispatch] = useReducer(reduce, EMPTY);
  const wanted = useRef(id);
  wanted.current = id;
  const load = useCallback(() => {
    const asked = wanted.current;
    if (!asked) return;
    readChat(asked).then(
      (read) => wanted.current === asked && dispatch({ t: "loaded", read }),
      () => wanted.current === asked && dispatch({ t: "missing" }),
    );
  }, []);
  useEffect(() => {
    dispatch({ t: "reset" });
    if (!id) return;
    const off = subscribeChat(id, (e) => dispatch({ t: "event", e }), load);
    load();
    return off;
  }, [id, load]);
  return { ...state, reload: load };
}

/**
 * This vault's chats, newest first, kept as they change: a chat made, a turn begun or ended in any
 * tab. The list is asked for again on each such event — a chat per turn is a list of tens, and the
 * server's answer is a directory listing.
 */
export function useChats(): { rows: ChatRow[]; loaded: boolean; reload(): void } {
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const load = useCallback(() => {
    listChats().then(
      (got) => {
        setRows(got);
        setLoaded(true);
      },
      () => setLoaded(true),
    );
  }, []);
  useEffect(() => {
    load();
    const again = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(load, 150);
    };
    const off = subscribeChat(
      "*",
      (e) => {
        /* A deleted chat is gone now, in this tab and every other: drop its row before the list is
           asked for again, so a stale row is never clickable. */
        if (e.type === "gone") {
          setRows((had) => had.filter((r) => r.id !== e.chat));
          return;
        }
        if (e.type === "chat" || e.type === "end" || e.type === "turn") again();
      },
      load,
    );
    return () => {
      off();
      window.clearTimeout(timer.current);
    };
  }, [load]);
  return { rows, loaded, reload: load };
}

let models: { at: number; list: ProviderModels[] } | null = null;

/** What the picker offers, asked once a minute at most: `opencode models` is a process. */
export function useModels(): ProviderModels[] | null {
  const [list, setList] = useState<ProviderModels[] | null>(models?.list ?? null);
  useEffect(() => {
    if (models && Date.now() - models.at < 60_000) return;
    let live = true;
    loadModels().then(
      (got) => {
        models = { at: Date.now(), list: got };
        if (live) setList(got);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return list;
}
