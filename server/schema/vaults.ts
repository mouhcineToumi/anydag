/** The vault and template routes' schemas and rows (`server/routes/vaults.ts`, `server/routes/templates.ts`). */

import { z } from "zod";

import { err } from "../http";
import { body, field, json, kept, named } from "./fields";
import { route } from "./row";
import { AnyKind, Removed } from "./shapes";

const text = (description: string, refusal: string, blank = false) =>
  field(
    blank ? z.string() : z.string().min(1),
    description,
    (raw) => {
      if (typeof raw !== "string" || (!blank && !raw.trim())) throw err(400, refusal);
      return raw;
    },
    "read",
  );

export const OpenVaultBody = body(
  "OpenVaultBody",
  "A folder on this machine to open as a vault; `~` is the home folder.",
  { path: text("The folder.", "expected `path`: the folder to open") },
  ["path"],
);

export const CreateVaultBody = body(
  "CreateVaultBody",
  "A vault to make, as a new folder, and open.",
  {
    parent: text("The folder to make it in; `~` is the home folder.", "expected `parent` and `name`", true),
    name: text("The new folder's name.", "expected `parent` and `name`", true),
  },
  ["parent", "name"],
);

export const CloseVaultBody = body(
  "CloseVaultBody",
  "A vault to stop serving. Its folder is never touched.",
  {
    id: text("The vault's id.", "expected `id`", true),
    forget: kept(z.boolean(), "`true` takes it off the recent list as well."),
  },
  ["id"],
);

export const TransferBody = body(
  "TransferBody",
  "A document `{name, kind, to}`, or a folder with everything in it `{folder, to}`, to move to another open vault — ids and created dates with them.",
  {
    to: field(
      z.string().min(1),
      "The open vault to move it to, by id.",
      (raw) => {
        if (typeof raw !== "string" || !raw) throw err(400, "expected `to`: the vault to move it to");
        return raw;
      },
      "read",
    ),
    folder: kept(z.string().nullable(), "A folder to move whole; left out or `null`, a document."),
    name: kept(z.string(), "The document's name."),
    kind: kept(AnyKind, "Which kind; left out, a board."),
  },
  ["to"],
);

export const FromTemplateBody = body(
  "FromTemplateBody",
  "A new note made from a template: its variables filled once, filed the way `/__board/create` files a text.",
  {
    template: kept(z.string(), "The template's name, in the templates folder."),
    title: kept(z.string(), "The new note's title; left out, *Untitled*."),
    folder: kept(z.string(), "The folder to file it in, inside the vault; left out, the top."),
  },
  ["template"],
);

const Vault = named(
  "Vault",
  "An open vault: its id, its folder's name and its path.",
  z.object({ id: z.string(), name: z.string(), path: z.string() }),
);

const Recent = named(
  "RecentVault",
  "A vault on the recent list: whether it is open, the one a request naming none means, and whether its folder is gone.",
  z.object({
    id: z.string(),
    path: z.string(),
    name: z.string(),
    opened: z.string(),
    open: z.boolean(),
    default: z.boolean(),
    missing: z.boolean(),
  }),
);

export const VAULT_ROUTES = [
  route({
    method: "get",
    path: "/api/vaults",
    operationId: "vaults",
    summary: "The recent vaults",
    description: "The open ones first.",
    tag: "vaults",
    answers: { 200: json("The list, and this machine's home folder.", z.object({ vaults: z.array(Recent), home: z.string() })) },
  }),
  route({
    method: "post",
    path: "/api/vaults/open",
    operationId: "openVault",
    summary: "Open a folder as a vault",
    description: "Opening never writes a byte of it. A vault inside another, or around one, is refused.",
    tag: "vaults",
    body: { schema: OpenVaultBody },
    answers: { 200: json("The vault.", z.object({ vault: Vault })) },
    refuses: { 400: "No path, or a folder that cannot be a vault." },
  }),
  route({
    method: "post",
    path: "/api/vaults/create",
    operationId: "createVault",
    summary: "Make a folder and open it as a vault",
    tag: "vaults",
    body: { schema: CreateVaultBody },
    answers: { 200: json("The vault.", z.object({ vault: Vault })) },
    refuses: { 400: "No parent or name, or a folder that cannot be made or be a vault." },
  }),
  route({
    method: "post",
    path: "/api/vaults/close",
    operationId: "closeVault",
    summary: "Stop serving a vault",
    description: "Never deletes it: its change feed says `dag:vault-gone`, so every tab on it goes to the picker.",
    tag: "vaults",
    body: { schema: CloseVaultBody },
    answers: { 200: json("The recent vaults now.", z.object({ vaults: z.array(Recent) })) },
    refuses: { 400: "No id." },
  }),
  route({
    method: "post",
    path: "/__board/transfer",
    operationId: "transfer",
    summary: "Move a document or a folder to another open vault",
    description:
      "Copy, then delete: a failure leaves two copies, never none. A name taken there is numbered; a folder taken there is a 409.",
    tag: "vaults",
    body: { schema: TransferBody },
    answers: {
      200: json(
        "Where it landed: a document's name, kind and id, or a folder's every folder and document.",
        z.union([
          z.object({ name: z.string(), kind: AnyKind, id: z.string().nullable(), to: z.string() }),
          z.object({ folder: z.string(), ...Removed.shape, to: z.string() }),
        ]),
      ),
    },
    refuses: {
      400: "No vault to move to, the vault it is in already, a `kind` that is not one, or no folder.",
      404: "No such document or folder, or a vault that is not open.",
      409: "The folder exists in that vault.",
    },
  }),
  route({
    method: "get",
    path: "/__board/templates",
    operationId: "templates",
    summary: "The note templates",
    description:
      "The notes in the templates folder — Settings' `dag:templates`, or `Templates` when that exists — and what each makes.",
    tag: "templates",
    answers: {
      200: json(
        "The folder (`null` when there is none), whether it was set, and the templates by title.",
        z.object({
          folder: z.string().nullable(),
          configured: z.boolean(),
          templates: z.array(z.object({ name: z.string(), title: z.string(), makes: z.enum(["note", "task", "event"]) })),
        }),
      ),
    },
  }),
  route({
    method: "post",
    path: "/__board/from-template",
    operationId: "fromTemplate",
    summary: "Make a note from a template",
    tag: "templates",
    body: { schema: FromTemplateBody },
    answers: {
      200: json(
        "The note as filed, and the template it came from.",
        z.object({ name: z.string(), id: z.string().nullable(), base: z.string(), text: z.string(), template: z.string() }),
      ),
    },
    refuses: { 400: "A folder outside the vault, or a name the vault refuses.", 404: "No such template." },
  }),
  route({
    method: "post",
    path: "/__board/templates/starters",
    operationId: "starters",
    summary: "Write the starter templates",
    description: "Only when asked, and never over a file that is there.",
    tag: "templates",
    answers: {
      200: json(
        "The folder, and the starters written and skipped.",
        z.object({ folder: z.string(), created: z.array(z.string()), skipped: z.array(z.string()) }),
      ),
    },
    refuses: { 400: "A name the vault refuses." },
  }),
];
