/**
 * The local server's OpenAPI document: every route `routes()` registers (`server/app.ts`), each a
 * row in its family's file under `server/schema/`, beside the bodies its handler reads through.
 * `GET /api/openapi.json` answers it for the switches this server runs, behind the token and `Host`
 * gate like every route; `npm run openapi` writes it, `cloud` on, to `docs/api/local.openapi.json`
 * with its reference beside it (`docs/api/local.md`). The builder is the sync api server's
 * (`api/openapi/document.ts`): one builder, two tables.
 *
 * Load-bearing:
 * - **The table is held to the code three ways** (`test/server/openapi.test.ts`): every route the
 *   app registers is a row and every row a route; the same against `docs/parity.json`'s `rest`
 *   columns; and every answer the server suites record is one its row declares — the status, and the
 *   body against the row's schema (`test/server/spec.ts`, run on every request the suites make).
 * - **A body's schema is the handler's reader** (`bodyAs` in `server/http.ts`): a field's check
 *   moved into its schema, never copied, so the document says what the route refuses.
 * - **A switch that is off leaves its routes out**: a row with `cloud` is in the document only when
 *   the build's `cloud` switch is on (`server/features.ts`), as `routes()` registers it.
 * - `info.version` is this document's, not the app's: a release that changes no route changes no byte.
 */

import { type Json, openapi } from "../api/openapi/document";
import type { Features } from "./features";
import { CHAT_ROUTES } from "./schema/chat";
import { CLOUD_ROUTES } from "./schema/cloud";
import { DOC_ROUTES } from "./schema/docs";
import { LOCAL } from "./schema/fields";
import { FILE_ROUTES } from "./schema/files";
import { FOLDER_ROUTES } from "./schema/folders";
import { META_ROUTES } from "./schema/meta";
import type { LocalRoute } from "./schema/row";
import { TAG_ROUTES } from "./schema/tags";
import { VAULT_ROUTES } from "./schema/vaults";

export const ROUTES: LocalRoute[] = [
  ...META_ROUTES,
  ...VAULT_ROUTES,
  ...DOC_ROUTES,
  ...FOLDER_ROUTES,
  ...FILE_ROUTES,
  ...TAG_ROUTES,
  ...CHAT_ROUTES,
  ...CLOUD_ROUTES,
];

const INFO = {
  title: "AnyDag local server",
  version: "1",
  description: [
    "The server the AnyDag app runs on this machine (`anydag serve`, the desktop app, `npm run dev`): one vault or several, every file in them, and everything the page, the CLI and the MCP server do to them. It listens on `127.0.0.1` only.",
    "",
    "**Every request carries the launch's token**, as the `X-AnyDag-Token` header (what `anydag` prints, and the desktop app hands its page) or the cookie a browser is given under `/s/<secret>/`, and a `Host` that is this machine (`127.0.0.1`, `localhost` or `[::1]`; anything else is a `421`). A write whose only credential is the cookie must come from the page's own origin.",
    "",
    "**A route about one vault** takes `?vault=<id>`; with none, the vault opened first. `GET /api/vaults` lists them.",
    "",
    "**Every write to a text carries the sha1 it was read at** as `base`. A stale one is a `409` with the text that replaced it and its own `base`, `{error, base, text}`: merge and send again. Every other refusal is `{error, code?}` — branch on `code` where there is one, never on `error`, which is a sentence for a person.",
    "",
    "Generated from the code (`server/openapi.ts`, `server/schema/`): do not edit it by hand.",
  ].join("\n"),
};

const TAGS = [
  { name: "app", description: "The server, the person, and this document." },
  { name: "vaults", description: "The vaults this server serves, and moving between them." },
  {
    name: "documents",
    description: "Boards, notes, quizzes and tables: listing, reading, writing, naming, linking and searching them.",
  },
  { name: "folders", description: "Folders in a vault." },
  { name: "trash", description: "What was deleted, kept until it expires." },
  { name: "files", description: "Attachments, a board's pasted images, and the change feed." },
  { name: "tags", description: "Tags across the vault, and their colours." },
  { name: "templates", description: "Note templates." },
  { name: "settings", description: "The app's preferences, the vault's, and what the page keeps between launches." },
  { name: "library", description: "The component library, icons and the grammar's reference." },
  { name: "models", description: "Prompt cards: the person's model, through their own login or key." },
  { name: "practice", description: "Quiz practice: answers, and the questions a person keeps getting wrong." },
  { name: "assistant", description: "The Assistant: chats, turns, and what a chat may reach." },
  { name: "sync", description: "The vault's link to a sync server. Only when the build's `cloud` switch is on." },
  { name: "logs", description: "Opt-in anonymous logs. Only when the build's `cloud` switch is on." },
  { name: "feedback", description: "Send feedback. Only when the build's `cloud` switch is on." },
];

const SECURITY: Record<string, Json> = {
  token: {
    type: "apiKey",
    in: "header",
    name: "X-AnyDag-Token",
    description: "This launch's token: what `anydag serve` prints, kept in the app's home as `server.json` while it runs.",
  },
  cookie: {
    type: "apiKey",
    in: "cookie",
    name: "anydag_token",
    description: "The token as a browser holds it: set by `/s/<secret>/?token=…`, sent only under that path.",
  },
};

const made = new Map<boolean, Json>();

/** The document for a server whose `cloud` switch is `features.cloud`; made once per value. */
export function localDocument(features: Features = { cloud: true }): Json {
  let doc = made.get(features.cloud);
  if (!doc) {
    doc = openapi({
      info: INFO,
      tags: TAGS,
      securitySchemes: SECURITY,
      registry: LOCAL,
      routes: ROUTES.filter((r) => features.cloud || !r.cloud),
    });
    made.set(features.cloud, doc);
  }
  return doc;
}
