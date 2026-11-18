/** The folder and trash routes' schemas and rows (`server/routes/folders.ts`, `server/routes/trash.ts`). */

import { z } from "zod";

import { err } from "../http";
import { folderFrom, folderMove } from "../names";
import { about, body, bodyThen, field, json, kept } from "./fields";
import { route } from "./row";
import { Relinked, Removed, TrashEntry } from "./shapes";

const folderName = kept(z.string(), "The folder: a path in the vault, `/` between its parts.");

export const MkdirBody = body(
  "MkdirBody",
  "A folder to make, and every folder above it that is not there.",
  {
    name: field(
      z.string(),
      "The folder: a path in the vault, `/` between its parts. No part may start with `.`.",
      (raw) => {
        const stem = folderFrom(raw);
        if (stem === null) throw err(400, `\`${String(raw)}\` is not a folder name`);
        if (!stem) throw err(400, "expected `name`");
        return stem;
      },
      "read",
    ),
  },
  ["name"],
);

export const RmdirBody = body(
  "RmdirBody",
  "A folder to move to the trash, as one entry.",
  {
    name: field(
      z.string(),
      "The folder.",
      (raw) => {
        const stem = folderFrom(raw);
        if (!stem) throw err(400, "expected `name`");
        return stem;
      },
      "read",
    ),
    recursive: kept(z.boolean(), "`true` (the boolean) takes everything in it too; otherwise only an empty folder goes."),
  },
  ["name"],
);

export const MvdirBody = bodyThen(
  "MvdirBody",
  "A folder to move, whole, and where.",
  { name: folderName, to: kept(z.string(), "Its new path. Not inside itself; the top level is not a folder.") },
  ["name", "to"],
  (b) => {
    const ends = folderMove(b.name, b.to);
    if (typeof ends === "string") throw err(400, ends);
    return { ...b, ends };
  },
);

export const TrashIdBody = body(
  "TrashIdBody",
  "A trash entry, by its id (`id` of `GET /__board/trash`'s entries).",
  { id: kept(z.string(), "The entry's id.") },
  ["id"],
);

export const FOLDER_ROUTES = [
  route({
    method: "post",
    path: "/__board/mkdir",
    operationId: "mkdir",
    summary: "Make a folder",
    tag: "folders",
    body: { schema: MkdirBody },
    answers: { 200: json("The folder as made.", z.object({ folder: z.string() })) },
    refuses: { 400: "No name, a name that is not a folder's, or one the vault refuses." },
  }),
  route({
    method: "post",
    path: "/__board/rmdir",
    operationId: "rmdir",
    summary: "Move a folder to the trash",
    tag: "folders",
    body: { schema: RmdirBody },
    answers: {
      200: json("What it held, and the trash entry.", z.object({ folder: z.string(), ...Removed.shape, trash: TrashEntry })),
    },
    refuses: { 400: "No name.", 404: "No such folder.", 409: "The folder is not empty and `recursive` was not `true`." },
  }),
  route({
    method: "post",
    path: "/__board/mvdir",
    operationId: "mvdir",
    summary: "Move or rename a folder",
    description: "Everything under it has a new name: the links to all of it are kept (`server/relink.ts`).",
    tag: "folders",
    body: { schema: MvdirBody },
    answers: { 200: json("Where it is now, and the links kept.", z.object({ folder: z.string(), relinked: Relinked })) },
    refuses: {
      400: "A name that is not a folder's, the top level, or a folder moved inside itself.",
      404: "No such folder.",
      409: "The vault refused the move: the name is taken.",
    },
  }),
  route({
    method: "get",
    path: "/__board/trash",
    operationId: "trash",
    summary: "What is in the trash",
    description: "Newest first. An entry is kept for `days` (`ANYDAG_TRASH_DAYS`) and then gone for good.",
    tag: "trash",
    answers: { 200: json("The entries.", z.object({ days: z.number(), entries: z.array(TrashEntry) })) },
  }),
  route({
    method: "post",
    path: "/__board/trash/restore",
    operationId: "trashRestore",
    summary: "Put a trash entry back",
    description: "Under its old name, numbered if that is taken, with its id.",
    tag: "trash",
    body: { schema: TrashIdBody },
    answers: { 200: json("The entry, as it was restored.", TrashEntry) },
    refuses: { 404: "No such entry: never there, or expired." },
  }),
  route({
    method: "post",
    path: "/__board/trash/delete",
    operationId: "trashDelete",
    summary: "Delete a trash entry for good",
    tag: "trash",
    body: { schema: TrashIdBody },
    answers: { 200: json("Gone.", z.object({ id: z.string() })) },
    refuses: { 404: "No such entry: never there, or expired." },
  }),
  route({
    method: "post",
    path: "/__board/trash/empty",
    operationId: "trashEmpty",
    summary: "Delete everything in the trash for good",
    tag: "trash",
    answers: { 200: json("The entries that went.", z.object({ ids: about("Each entry deleted.", z.array(z.string())) })) },
  }),
];
