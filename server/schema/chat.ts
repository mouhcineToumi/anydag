/**
 * The Assistant's routes' schemas and rows (`server/routes/chat.ts`): a chat made, read, renamed and
 * deleted, a turn, its approvals and grants, undo and redo of what a block changed, the event stream,
 * and the two routes only a chat's own MCP server calls (`/block`, `/access`, with `X-AnyDag-Chat`).
 */

import { z } from "zod";

import { DOC_KINDS, type DocKind, type Mode, type Provider, PROVIDERS } from "../chat/types";
import { err } from "../http";
import { about, body, bodyThen, field, json, kept, named, param } from "./fields";
import { route } from "./row";

/** A string a route needs, trimmed: blank is a 400 naming it. */
export const required = (v: unknown, what: string): string => {
  if (typeof v !== "string" || !v.trim()) throw err(400, `\`${what}\` is required`);
  return v.trim();
};
const providerOf = (v: unknown): Provider | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (!PROVIDERS.includes(v as Provider)) throw err(400, `\`${String(v)}\` is not a provider`);
  return v as Provider;
};
const modeOf = (v: unknown): Mode | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (v !== "ask" && v !== "edit") throw err(400, "`mode` is `ask` or `edit`");
  return v;
};

/** A turn's `subject`: absent keeps the chat's, `null` drops it, `{name, kind}` names a document of this vault. */
const subjectOf = (v: unknown): { name: string; kind: DocKind } | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const o = v as { name?: unknown; kind?: unknown };
  if (!o || typeof o !== "object" || typeof o.name !== "string" || !o.name || !DOC_KINDS.includes(o.kind as DocKind))
    throw err(400, "`subject` is `{name, kind}` or null");
  return { name: o.name, kind: o.kind as DocKind };
};

/** A turn's `mentions`: absent or `[]` is none, and each is a document of this vault. */
const mentionsOf = (v: unknown): { name: string; kind: DocKind }[] | undefined => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 20) throw err(400, "`mentions` is a list of at most 20 `{name, kind}`");
  return v.map((x) => {
    const o = x as { name?: unknown; kind?: unknown };
    if (!o || typeof o !== "object" || typeof o.name !== "string" || !o.name || !DOC_KINDS.includes(o.kind as DocKind))
      throw err(400, "each mention is `{name, kind}`");
    return { name: o.name, kind: o.kind as DocKind };
  });
};

const Doc = z.object({ name: z.string().min(1), kind: z.enum(DOC_KINDS) });
const need = (what: string, description: string) => field(z.string().min(1), description, (v) => required(v, what), "read");
const Id = () => need("id", "The chat's id.");
const providerField = (description: string) => field(z.enum(PROVIDERS), description, providerOf, "skip");

export const NewChatBody = body(
  "NewChatBody",
  "A new chat in this request's vault.",
  {
    provider: field(
      z.enum(PROVIDERS),
      "The harness that answers: the person's own Claude Code, OpenCode or Codex.",
      (v) => {
        const p = providerOf(v);
        if (!p) throw err(400, "`provider` is required");
        return p;
      },
      "read",
    ),
    model: need("model", "The model (`GET /__board/chat/models`)."),
    effort: kept(z.string(), "How hard it thinks; left out, the model's own."),
    title: kept(z.string(), "Its title; left out, its first message."),
  },
  ["provider", "model"],
);

export const RenameChatBody = body("RenameChatBody", "A chat's new title.", { id: Id(), title: need("title", "The title.") }, [
  "id",
  "title",
]);

export const ChatIdBody = body("ChatIdBody", "A chat, by its id.", { id: Id() }, ["id"]);

export const TurnBody = body(
  "TurnBody",
  "A message to a chat; the answer streams on `/__board/chat/events`.",
  {
    id: Id(),
    text: need("text", "What the person said."),
    provider: providerField("Another harness for this turn and the next; left out, the chat's."),
    model: kept(z.string(), "Another model; left out, the chat's."),
    effort: kept(z.string().nullable(), "Another effort; `null` for the model's own; left out, the chat's."),
    subject: field(
      Doc.nullable(),
      "The document the chat works on: left out keeps the chat's, `null` drops it.",
      subjectOf,
      "skip",
    ),
    mentions: field(z.array(Doc).max(20), "Documents the message names with `@`, at most 20.", mentionsOf, "skip"),
  },
  ["id", "text"],
);

export const ApproveBody = body(
  "ApproveBody",
  "The person's answer to a step waiting for approval.",
  {
    yes: field(
      z.boolean(),
      "Whether the step may go ahead.",
      (v) => {
        if (typeof v !== "boolean") throw err(400, "`yes` is true or false");
        return v;
      },
      "read",
    ),
    id: Id(),
    step: need("step", "The step's id."),
  },
  ["yes", "id", "step"],
);

export const GrantBody = bodyThen(
  "GrantBody",
  "Give a chat another vault to read or change, or take it back.",
  {
    mode: kept(
      z.enum(["ask", "edit"]).nullable(),
      "`ask` (read it) or `edit` (change it too); `null` takes the grant back. Left out, `ask`.",
    ),
    on: kept(z.boolean(), "`false` takes the grant back, as `mode: null` does."),
    id: kept(z.string(), "The chat's id."),
    vault: kept(z.string(), "The vault to grant."),
  },
  ["id", "vault"],
  (b) => ({
    ...b,
    mode: b.mode === null || b.on === false ? null : (modeOf(b.mode) ?? "ask"),
    id: required(b.id, "id"),
    vault: required(b.vault, "vault"),
  }),
);

export const UndoBody = body(
  "UndoBody",
  "One block of a turn, whose changes to undo or redo.",
  { id: Id(), turn: need("turn", "The turn's id."), block: need("block", "The block's id.") },
  ["id", "turn", "block"],
);

export const BlockBody = body("BlockBody", "A block to start in the running turn.", {
  title: kept(z.string(), "What the block does, as the person reads it."),
});

export const AccessBody = body(
  "AccessBody",
  "A chat asking the person for another vault.",
  {
    vault: need("vault", "The vault it asks for."),
    why: kept(z.string(), "Why, as the person reads it."),
    mode: field(z.enum(["ask", "edit"]), "What it asks for; left out, `ask`.", modeOf, "skip"),
  },
  ["vault"],
);

// -- the answers -------------------------------------------------------------------------------

const Chat = named(
  "Chat",
  "A chat's `chat.json`, as this server answers it: each `grant:<vault>` key is a grant given here (`null` taken back).",
  z.looseObject({
    v: z.literal(1),
    id: z.string(),
    title: z.string(),
    created: z.string(),
    home: about("The vault the chat lives in.", z.string()),
    provider: z.enum(PROVIDERS),
    model: z.string(),
    effort: z.string().optional(),
  }),
);

const Turn = named(
  "Turn",
  "One message and what answered it: its steps, the blocks it changed things in, its status.",
  z.looseObject({ v: z.literal(1), id: z.string(), chat: z.string(), text: z.string(), status: z.string() }),
);

const ChatRow = z.object({
  id: z.string(),
  title: z.string(),
  vault: z.string(),
  created: z.string(),
  updated: z.string(),
  provider: z.enum(PROVIDERS),
  model: z.string(),
  running: z.boolean(),
});

const Ok = z.object({ ok: z.literal(true) });

const NOT_FOUND = "No such chat, turn, step or block.";
const TAG = "assistant";

export const CHAT_ROUTES = [
  route({
    method: "get",
    path: "/__board/chats",
    operationId: "chats",
    summary: "The chats",
    tag: TAG,
    query: z.object({ all: param("Anything: every open vault's chats, not this one's.", z.string().optional()) }),
    answers: { 200: json("Newest first.", z.object({ chats: z.array(ChatRow) })) },
  }),
  route({
    method: "get",
    path: "/__board/chat/models",
    operationId: "chatModels",
    summary: "Which harnesses are installed, and their models",
    tag: TAG,
    answers: {
      200: json(
        "Each harness, whether it is installed, its models and efforts; `fake` when the scripted harness answers (the e2e suite).",
        z.object({
          providers: z.array(
            z.object({
              provider: z.enum(PROVIDERS),
              label: z.string(),
              available: z.boolean(),
              why: z.string().optional(),
              models: z.array(z.looseObject({})),
              efforts: z.array(z.string()),
              default: z.string(),
            }),
          ),
          fake: z.boolean().optional(),
        }),
      ),
    },
  }),
  route({
    method: "post",
    path: "/__board/chat",
    operationId: "newChat",
    summary: "Start a chat",
    tag: TAG,
    body: { schema: NewChatBody },
    answers: { 200: json("The chat.", z.object({ chat: Chat })) },
    refuses: { 400: "No provider, one that is not available here, or no model." },
  }),
  route({
    method: "get",
    path: "/__board/chat",
    operationId: "chat",
    summary: "A chat, whole",
    description: "Found by its id in whichever open vault holds it.",
    tag: TAG,
    query: z.object({ id: param("The chat's id.", z.string()) }),
    answers: {
      200: json(
        "The chat, its turns, what was undone, the turn running, and this machine's device.",
        z.object({
          chat: Chat,
          vault: z.string(),
          turns: z.array(Turn),
          undos: z.array(z.looseObject({})),
          live: z.looseObject({}).nullable(),
          device: z.string(),
        }),
      ),
    },
    refuses: { 400: "No id, or not a chat's.", 404: NOT_FOUND },
  }),
  route({
    method: "post",
    path: "/__board/chat/rename",
    operationId: "renameChat",
    summary: "Rename a chat",
    tag: TAG,
    body: { schema: RenameChatBody },
    answers: { 200: json("The chat.", z.object({ chat: Chat })) },
    refuses: { 400: "No id or title.", 404: NOT_FOUND },
  }),
  route({
    method: "post",
    path: "/__board/chat/delete",
    operationId: "deleteChat",
    summary: "Delete a chat",
    tag: TAG,
    body: { schema: ChatIdBody },
    answers: { 200: json("Gone.", Ok) },
    refuses: { 400: "No id.", 404: NOT_FOUND },
  }),
  route({
    method: "post",
    path: "/__board/chat/turn",
    operationId: "turn",
    summary: "Send a chat a message",
    tag: TAG,
    body: { schema: TurnBody },
    answers: { 200: json("The turn, running.", z.object({ turn: Turn })) },
    refuses: {
      400: "No id or text, a provider that is not one, or a subject or mention that is not `{name, kind}`.",
      404: `${NOT_FOUND} A subject or mention that is not a document of this vault.`,
      409: 'The chat is answering already: `{code: "running"}`.',
    },
  }),
  route({
    method: "post",
    path: "/__board/chat/stop",
    operationId: "stopTurn",
    summary: "Stop a chat's running turn",
    tag: TAG,
    body: { schema: ChatIdBody },
    answers: { 200: json("Stopped, or there was nothing running.", Ok) },
    refuses: { 400: "No id." },
  }),
  route({
    method: "post",
    path: "/__board/chat/approve",
    operationId: "approve",
    summary: "Answer a step waiting for approval",
    tag: TAG,
    body: { schema: ApproveBody },
    answers: { 200: json("Answered.", Ok) },
    refuses: { 400: "`yes` is not a boolean, or no id or step.", 404: NOT_FOUND },
  }),
  route({
    method: "post",
    path: "/__board/chat/grant",
    operationId: "grant",
    summary: "Grant a chat another vault, or take it back",
    tag: TAG,
    body: { schema: GrantBody },
    answers: { 200: json("The chat, with its grants.", z.object({ chat: Chat })) },
    refuses: { 400: "A mode that is not one, no id or vault, or the chat's own vault.", 404: NOT_FOUND },
  }),
  ...([false, true] as const).map((redo) =>
    route({
      method: "post",
      path: redo ? "/__board/chat/redo" : "/__board/chat/undo",
      operationId: redo ? "redo" : "undo",
      summary: redo ? "Redo what a block of a turn changed" : "Undo what a block of a turn changed",
      description: "What another writer changed since is left alone, and said in `conflicts`.",
      tag: TAG,
      body: { schema: UndoBody },
      answers: {
        200: json(
          "The undo record: what was put back, and what could not be.",
          z.object({
            record: z.looseObject({
              v: z.literal(1),
              id: z.string(),
              redo: z.boolean(),
              ops: z.array(z.looseObject({})),
              conflicts: z.array(z.looseObject({})),
            }),
          }),
        ),
      },
      refuses: {
        400: "No id, turn or block.",
        404: NOT_FOUND,
        409: `The block is ${redo ? "not undone" : "undone already"}, or its turn is running: \`{code: "state"}\`.`,
      },
    }),
  ),
  route({
    method: "post",
    path: "/__board/chat/block",
    operationId: "block",
    summary: "Start a block in the running turn (a chat's tools only)",
    tag: TAG,
    header: z.object({ "x-anydag-chat": param("The chat whose turn is running.", z.string()) }),
    body: { schema: BlockBody },
    answers: {
      200: json(
        "The block.",
        z.object({ block: z.object({ id: z.string(), title: z.string(), ops: z.array(z.looseObject({})) }) }),
      ),
    },
    refuses: { 403: 'Not a chat\'s own tools: `{code: "chat-only"}`.' },
  }),
  route({
    method: "post",
    path: "/__board/chat/access",
    operationId: "access",
    summary: "Ask the person for another vault (a chat's tools only)",
    tag: TAG,
    header: z.object({ "x-anydag-chat": param("The chat whose turn is running.", z.string()) }),
    body: { schema: AccessBody },
    answers: {
      200: json(
        "Whether the person granted it, and how.",
        z.object({ granted: z.boolean(), mode: z.enum(["ask", "edit"]).optional(), error: z.string().optional() }),
      ),
    },
    refuses: { 400: "No vault, or a mode that is not one.", 403: 'Not a chat\'s own tools: `{code: "chat-only"}`.' },
  }),
  route({
    method: "get",
    path: "/__board/chat/events",
    operationId: "chatEvents",
    summary: "A chat's events, or every chat's",
    description:
      "Server-sent events: `chat:<type>` with the event as JSON, a `: ping` comment every twenty seconds. With no `id`, every chat's — the list redraws on `chat` and `end`.",
    tag: TAG,
    query: z.object({ id: param("One chat's.", z.string().optional()) }),
    answers: { 200: { description: "The stream, open until the page goes.", type: "text/event-stream" } },
  }),
];
