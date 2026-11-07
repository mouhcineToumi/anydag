/**
 * What a chat is, on disk and on the wire. Shared by the server, the page and
 * the CLI, so it imports nothing.
 */

import type { Conflict, Op } from "./record";

export type { Before, Conflict, Image, Op } from "./record";

export type Provider = "claude" | "opencode";
export const PROVIDERS: readonly Provider[] = ["claude", "opencode"];

export type Mode = "ask" | "edit";

/** What another vault was granted: read it, or change it too. `null` is a grant taken back. */
export type Grant = { mode: Mode; at: string } | null;

/**
 * `chat.json`, the one chat file written more than once. Sync merges it **by key**, shallowly, so
 * every value a second machine could change on its own is its own key: a grant is `grant:<vaultId>`,
 * never an entry in a nested object, and a grant taken back is `null`, never a key removed — or the
 * merge would bring it back from the machine that had not heard.
 */
export interface ChatMeta {
  v: 1;
  id: string;
  title: string;
  created: string;
  /** The vault the chat lives in, and reaches without a grant. */
  home: string;
  /** What the next turn is sent to, until somebody picks another. */
  provider: Provider;
  model: string;
  /** Claude's `--effort`, OpenCode's `#variant`; absent for the model's own. */
  effort?: string;
  mode: Mode;
  [grant: `grant:${string}`]: Grant;
}

export const grantsOf = (m: ChatMeta): Record<string, { mode: Mode; at: string }> => {
  const out: Record<string, { mode: Mode; at: string }> = {};
  for (const [k, v] of Object.entries(m)) if (k.startsWith("grant:") && v && typeof v === "object") out[k.slice(6)] = v as { mode: Mode; at: string };
  return out;
};

/** One thing that happened in a turn, in order. */
export type Step =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; output?: string; error?: boolean }
  /** A write that waited for the person. */
  | { kind: "approval"; id: string; what: string; detail: string; answer: "yes" | "no" | "expired" | null }
  /** The agent asked to reach another vault. */
  | { kind: "access"; id: string; vault: string; name: string; why: string; mode: Mode; answer: "yes" | "no" | "expired" | null }
  /** The harness said something went wrong. */
  | { kind: "error"; text: string };

/** A group of a turn's writes that undo together. */
export interface Block {
  id: string;
  title: string;
  ops: Op[];
}

export interface Usage {
  input?: number;
  output?: number;
  cached?: number;
  cost?: number;
}

export type TurnStatus = "running" | "done" | "stopped" | "failed";

/** `<turnId>.json`: written once, when the turn ends. */
export interface Turn {
  v: 1;
  id: string;
  chat: string;
  /** Which machine ran it, for the mark on a turn that came from another device. */
  device: string;
  at: string;
  ended?: string;
  text: string;
  provider: Provider;
  model: string;
  effort?: string;
  mode: Mode;
  steps: Step[];
  blocks: Block[];
  status: TurnStatus;
  usage?: Usage;
}

/** `undo/<id>.json`: one undo or redo of one block, written once. */
export interface UndoRecord {
  v: 1;
  id: string;
  chat: string;
  turn: string;
  block: string;
  /** False for an undo, true for a redo. */
  redo: boolean;
  device: string;
  at: string;
  /** What this undo or redo itself wrote — what the next redo reverses. */
  ops: Op[];
  conflicts: Conflict[];
}

/** A chat read whole: what `GET /__board/chat` answers, and the page and the CLI hold. */
export interface ChatRead {
  chat: ChatMeta;
  /** Where it lives, for a page that has to open it in its own vault. */
  vault: string;
  turns: Turn[];
  undos: UndoRecord[];
  /** The turn in flight, if any, as it stands. */
  live: Turn | null;
  /** This machine's device id, so a page can mark turns that came from elsewhere. */
  device: string;
}

/** A row of the chat list. */
export interface ChatRow {
  id: string;
  title: string;
  vault: string;
  created: string;
  /** The newest turn's time, or `created`. */
  updated: string;
  provider: Provider;
  model: string;
  running: boolean;
}

/** Whether a block is undone now: its newest undo record says. */
export function blockUndone(undos: readonly UndoRecord[], block: string): boolean {
  let last: UndoRecord | undefined;
  for (const u of undos) if (u.block === block && (!last || u.id > last.id)) last = u;
  return !!last && !last.redo;
}

/** What the stream says, one event at a time (`GET /__board/chat/events`). */
export type ChatEvent =
  | { type: "turn"; turn: Turn }
  | { type: "step"; turn: string; index: number; step: Step }
  | { type: "delta"; turn: string; text: string }
  | { type: "blocks"; turn: string; blocks: Block[] }
  | { type: "end"; turn: Turn }
  | { type: "chat"; chat: ChatMeta }
  | { type: "undo"; record: UndoRecord };
