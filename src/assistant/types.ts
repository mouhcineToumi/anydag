/**
 * What a chat is, on the wire. The server's file is the source (`server/chat/types.ts`), which
 * imports nothing at run time, so the page takes the types — and the three small functions beside
 * them — from it rather than keeping a second copy that could drift from what `GET /__board/chat`
 * answers.
 */
export { PROVIDERS, blockUndone, grantsOf } from "../../server/chat/types";
export type {
  Block,
  ChatEvent,
  ChatMeta,
  ChatRead,
  ChatRow,
  Mode,
  Provider,
  Step,
  Turn,
  UndoRecord,
} from "../../server/chat/types";

/** What `GET /__board/chat/models` answers, per provider (`server/chat/models.ts`). */
export interface ProviderModels {
  provider: "claude" | "opencode";
  label: string;
  available: boolean;
  why?: string;
  models: { id: string; label: string }[];
  /** The first is the harness's own default, written as the empty string. */
  efforts: string[];
  default: string;
}
