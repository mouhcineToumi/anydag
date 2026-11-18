/**
 * The attachment routes' schemas and rows (`server/routes/files.ts`): an upload, a file read whole
 * or by range, the listing, a picture pasted onto a board or into a note, and the legacy `.assets/`.
 */

import { z } from "zod";

import { err } from "../http";
import { about, body, field, json, kept, param } from "./fields";
import { route } from "./row";
import { FileAnswer, TextKind } from "./shapes";

const DATA_URL = /^data:([^;]+);base64,(.+)$/s;
const IMAGE_EXT: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

/** A base64 data URL as its bytes and extension; `images.py`'s `decode_image`, same refusals. */
function decodeImage(raw: unknown): { data: Buffer; ext: string } {
  const m = DATA_URL.exec(typeof raw === "string" ? raw : "");
  if (!m) throw err(400, "expected a base64 data URL");
  const ext = IMAGE_EXT[m[1]!];
  if (!ext) throw err(415, `unsupported image type ${m[1]}`);
  const body = m[2]!.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body) || body.length % 4 === 1) throw err(400, "that image could not be decoded");
  return { data: Buffer.from(body, "base64"), ext };
}

const dataUrl = () =>
  field(
    z.string().regex(/^data:image\/(png|jpeg|webp|gif|svg\+xml|avif);base64,/),
    `The picture as a base64 data URL: ${Object.keys(IMAGE_EXT).join(", ")}.`,
    decodeImage,
    "read",
  );

const at = (what: string) => kept(z.number(), what);

export const AssetBody = body(
  "AssetBody",
  "A picture pasted onto a board: kept as an attachment, and an image fence that draws it appended.",
  {
    dataUrl: dataUrl(),
    x: at("Where to draw it."),
    y: at("Where to draw it."),
    w: at("How wide."),
    page: kept(z.string(), "The board's page to put it on; left out, the first."),
  },
  ["dataUrl"],
);

export const UploadBody = body(
  "UploadBody",
  "A picture pasted into a note: kept as an attachment; nothing is written, the editor writes the Markdown.",
  { dataUrl: dataUrl() },
  ["dataUrl"],
);

const Limits = z.object({
  maxBytes: about("The largest file an upload takes.", z.int()),
  types: about("The extensions an upload takes, lower case.", z.array(z.string())),
});

const Unused = z.object({
  files: z.array(z.object({ file: z.string(), bytes: z.int() })),
  bytes: z.int(),
});

const Name = param("The document's name.", z.string());
const BYTES = "*/*";

export const FILE_ROUTES = [
  route({
    method: "post",
    path: "/__board/file",
    operationId: "upload",
    summary: "Upload a file",
    description:
      "The bytes are the body, streamed into the vault and never held whole: checked against the limit and hashed as they pass. One that stops half-way, or that is not the `Content-Length` it said, leaves nothing behind.",
    tag: "files",
    query: z.object({
      name: param("What it was called: its extension says what it is.", z.string()),
      folder: param("The folder to keep it in; left out, the top.", z.string().optional()),
      title: param("Its title; left out, its name.", z.string().optional()),
    }),
    body: { type: "application/octet-stream", description: "The file's bytes." },
    answers: {
      200: json("The attachment as kept, and the sha256 of what arrived.", FileAnswer.extend({ sha256: z.string() })),
    },
    refuses: {
      400: "A folder that is not one, a file under `components/`, a name the vault refuses, or bytes that did not arrive whole.",
      413: "Over the upload limit.",
      415: "No extension, one this vault does not take, or a name a file cannot have.",
    },
  }),
  route({
    method: "get",
    path: "/__board/file",
    operationId: "file",
    summary: "An attachment's bytes",
    description: "Read from disk as it is sent; a `Range` reads only its range. Served with a sandbox CSP and `nosniff`.",
    tag: "files",
    query: z.object({
      id: param("The attachment's id; it wins over `name`.", z.string().optional()),
      name: param("The attachment's name.", z.string().optional()),
      download: param("`1`, `true` or `yes`: as a download.", z.enum(["1", "true", "yes"]).optional()),
    }),
    header: z.object({ range: param("`bytes=<first>-<last>`.", z.string().optional()) }),
    answers: {
      200: { description: "The whole file.", type: BYTES },
      206: { description: "The range asked for.", type: BYTES },
      416: { description: "A range outside the file: `Content-Range: bytes */<size>`." },
    },
    refuses: { 404: "No such attachment." },
  }),
  route({
    method: "get",
    path: "/__board/files",
    operationId: "files",
    summary: "Every attachment",
    tag: "files",
    answers: {
      200: json("The attachments, and what an upload takes.", z.object({ files: z.array(FileAnswer), limits: Limits })),
    },
  }),
  route({
    method: "post",
    path: "/__board/asset",
    operationId: "pasteOnBoard",
    summary: "Paste a picture onto a board",
    description:
      "Written against the version the board was read at: a write that lost to another writer is the 409 with the text that won, and the attachment stays, unreferenced, for the sweep to find.",
    tag: "files",
    query: z.object({ name: param("The board's name.", z.string()) }),
    body: { schema: AssetBody },
    answers: {
      200: json(
        "The picture's `dag:` address, the image item's id, and the board's new sha1.",
        z.object({ src: z.string(), id: z.string(), base: z.string() }),
      ),
    },
    refuses: {
      400: "Not a base64 data URL, or one that does not decode.",
      404: "No such board.",
      415: "A picture of a type this vault does not take.",
    },
    conflict: true,
  }),
  route({
    method: "post",
    path: "/__board/upload",
    operationId: "pasteInNote",
    summary: "Paste a picture into a document",
    tag: "files",
    query: z.object({ name: Name, kind: param("Which kind; left out, a board.", TextKind.optional()) }),
    body: { schema: UploadBody },
    answers: { 200: json("The picture's `dag:` address.", z.object({ src: z.string() })) },
    refuses: {
      400: "A `kind` that is not one; not a base64 data URL, or one that does not decode.",
      404: "No such document.",
      415: "A picture of a type this vault does not take.",
    },
  }),
  route({
    method: "get",
    path: "/__board/assets/unused",
    operationId: "assetsUnused",
    summary: "A board's legacy pictures no text names",
    description: "The `<board>.assets/` folders the hosted app made; a pasted picture is an attachment now.",
    tag: "files",
    query: z.object({ name: param("The board's name.", z.string()) }),
    answers: { 200: json("The pictures, and their bytes in all.", Unused) },
    refuses: { 404: "No such board." },
  }),
  route({
    method: "post",
    path: "/__board/assets/sweep",
    operationId: "assetsSweep",
    summary: "Delete a board's legacy pictures no text names",
    tag: "files",
    query: z.object({ name: param("The board's name.", z.string()) }),
    answers: { 200: json("What went, and its bytes in all.", Unused) },
    refuses: { 404: "No such board." },
  }),
  route({
    method: "get",
    path: "/__board/assets/*",
    operationId: "asset",
    summary: "A legacy picture of a document",
    description:
      "Served with the headers every attachment goes out with: an SVG served bare would be a document on the app's origin (#10).",
    tag: "files",
    answers: { 200: { description: "The picture.", type: BYTES } },
    refuses: { 403: "Not a picture of a document.", 404: "Not found." },
  }),
  route({
    method: "get",
    path: "/__board/events",
    operationId: "events",
    summary: "The vault's change feed",
    description:
      "Server-sent events, one `EventSource` per page: `dag:board`, `dag:note`, `dag:quiz`, `dag:table`, `dag:file` for a document (`{name, sha1, title, …}`, `sha1: null` when it went), `dag:boards` when the folders changed, `dag:trash`, `dag:tags`, `dag:vault-sync` with a sync status, and `dag:vault-gone` when the vault was closed. A `: ping` comment every twenty seconds.",
    tag: "documents",
    answers: { 200: { description: "The stream, open until the page goes.", type: "text/event-stream" } },
  }),
];
