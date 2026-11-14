/**
 * Attachments, and the pictures pasted onto a board or into a note.
 *
 * The local difference is decision 13: **a pasted picture is an attachment** like any other, kept in
 * the vault's one attachments folder and referred to as `dag:<id>`, never a `<name>.assets/` beside
 * the document — so a vault opened in Obsidian shows it where Obsidian would have put it, and one
 * picture pasted into two notes is two references to one file. The legacy `.assets/` folders are
 * still read (`/assets/<path>`) and still swept, because vaults made by the hosted app have them.
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import type { Hono } from "hono";

import { cleanTitle } from "../../src/note/format";
import type { Session } from "../context";
import { bodyOf, err, Http, mustRead, textKind } from "../http";
import { extOf, fileNameFrom, folderFrom, leafOf } from "../names";
import { byteRange, fileHeaders, megabytes, mimeOf } from "../uploads";
import { Refused, sha1 } from "../vault";
import { fileAnswer } from "./docs";

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

/** An item's id as a fence line writes it; `free_item_id`'s scan. */
const ITEM_ID = /#([\w.-]+)/g;
function freeItemId(text: string, wanted: string): string {
  const taken = new Set([...text.matchAll(ITEM_ID)].map((m) => m[1]));
  if (!taken.has(wanted)) return wanted;
  let n = 2;
  while (taken.has(`${wanted}-${n}`)) n++;
  return `${wanted}-${n}`;
}

const two = (n: number) => String(n).padStart(2, "0");
/** `Pasted image 20261106153012.png` — Obsidian's own name for one, so both apps file it alike. */
function pastedName(ext: string, at = new Date()): string {
  const stamp = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
  return `Pasted image ${stamp}.${ext}`;
}

/**
 * Keep one uploaded file as an attachment, checked against the limits, named from what it was called
 * inside `folder`, numbered when taken. `store_upload`, ported; the refusals are word for word.
 *
 * The bytes are the request body, **streamed into the vault and never held whole**: checked against
 * the limit and hashed as they pass, so an oversized one is refused at its first chunk over, and one
 * that stops half-way — the connection dropped, or fewer bytes than its `Content-Length` said —
 * leaves no file behind (`putFile` removes its temp file).
 */
async function storeUpload(
  s: Session,
  filename: string,
  folder: string,
  body: AsyncIterable<Uint8Array>,
  declared: number | null,
  title?: string | null,
) {
  const limits = s.limits();
  const leaf = leafOf(String(filename ?? "").replace(/\\/g, "/")).trim();
  const ext = extOf(leaf);
  if (!ext) throw err(415, `\`${leaf || "this file"}\` has no extension, so there is no telling what it is`);
  if (!s.vault.types.has(ext)) throw err(415, `\`.${ext}\` files cannot be uploaded here`);
  const where = folderFrom(folder ?? "");
  if (where === null) throw err(400, `\`${folder}\` is not a folder name`);
  if (where === "components" || where.startsWith("components/")) throw err(400, "a file cannot live in components/");
  const name = fileNameFrom(where ? `${where}/${leaf}` : leaf, s.vault.types);
  if (!name) throw err(415, `\`${leaf}\` is not a name a file can have`);
  const said = (title ? cleanTitle(title) : null) ?? null;
  /* And a checksum, so whoever sent the bytes can prove they arrived as sent. */
  const sum = createHash("sha256");
  let size = 0;
  async function* checked(): AsyncGenerator<Uint8Array> {
    try {
      for await (const chunk of body) {
        size += chunk.byteLength;
        if (size > limits.maxBytes) throw err(413, `\`${filename}\` is over the limit of ${megabytes(limits.maxBytes)}`);
        sum.update(chunk);
        yield chunk;
      }
    } catch (e) {
      if (e instanceof Http) throw e;
      throw err(400, `\`${leaf}\` did not arrive whole`);
    }
    if (declared !== null && size !== declared) throw err(400, `\`${leaf}\` did not arrive whole`);
  }
  let settled: string;
  try {
    settled = await s.vault.putFile(name, checked(), said);
  } catch (e) {
    if (e instanceof Refused) throw err(400, e.message);
    throw e;
  }
  const answer = fileAnswer(settled, await s.vault.peekId(settled, "file"), said ?? leafOf(settled), size);
  return { ...answer, sha256: sum.digest("hex") };
}

/** A pasted picture, kept as an attachment in the vault's attachments folder. */
async function storePasted(s: Session, dataUrl: unknown): Promise<{ id: string; name: string; digest: string }> {
  const { data, ext } = decodeImage(dataUrl);
  const folder = s.vault.attachments;
  const name = fileNameFrom(folder ? `${folder}/${pastedName(ext)}` : pastedName(ext), s.vault.types);
  if (!name) throw err(415, `\`.${ext}\` files cannot be kept in this vault`);
  const settled = await s.vault.putFile(name, data, null);
  const id = await s.vault.peekId(settled, "file");
  if (!id) throw err(500, `\`${settled}\` was kept and has no id`);
  return { id, name: settled, digest: sha1(data).slice(0, 8) };
}

export function fileRoutes(app: Hono, s: Session): void {
  app.post("/__board/file", async (c) => {
    const name = c.req.query("name") ?? "";
    const length = c.req.header("content-length");
    const declared = length !== undefined && length.trim() !== "" && Number.isFinite(Number(length)) ? Number(length) : null;
    const limits = s.limits();
    if (declared !== null && declared > limits.maxBytes) {
      throw err(413, `\`${name}\` is ${megabytes(declared)}; the limit is ${megabytes(limits.maxBytes)}`);
    }
    const body: AsyncIterable<Uint8Array> = c.req.raw.body ?? (async function* () {})();
    return c.json(await storeUpload(s, name, c.req.query("folder") ?? "", body, declared, c.req.query("title") ?? null));
  });

  /** An attachment, read from disk as it is sent; a `Range` reads only its range. */
  app.get("/__board/file", async (c) => {
    const id = c.req.query("id") ?? "";
    const asked = c.req.query("name") ?? "";
    let name: string | null = asked || null;
    if (id) {
      const found = await s.vault.resolve(id);
      name = found?.kind === "file" ? found.name : null;
    }
    const missing = () => err(404, `no file \`${id || asked}\``);
    if (!name) throw missing();
    const info = await s.vault.fileInfo(name);
    if (!info) throw missing();
    const size = info.bytes;
    const ext = extOf(name);
    const download = ["1", "true", "yes"].includes(c.req.query("download") ?? "");
    const head: Record<string, string> = { ...fileHeaders(ext, info.title ?? leafOf(name), download), "accept-ranges": "bytes" };
    const want = byteRange(c.req.header("range"), size);
    if (want === false) return c.body(null, 416, { ...head, "content-range": `bytes */${size}` });
    if (size === 0) return c.body(new Uint8Array(0), 200, { ...head, "content-type": mimeOf(ext) });
    const [first, last] = want ?? [0, size - 1];
    const stream = s.vault.fileStream(name, want ? { start: first, end: last } : undefined);
    if (!stream) throw missing();
    const sent = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
    const type = { "content-type": mimeOf(ext), "content-length": String(last - first + 1) };
    if (want) return c.body(sent, 206, { ...head, ...type, "content-range": `bytes ${first}-${last}/${size}` });
    return c.body(sent, 200, { ...head, ...type });
  });

  app.get("/__board/files", async (c) => {
    const t = await s.vault.tree();
    return c.json({ files: t.files.map((n) => fileAnswer(n, t.ids[n], t.titles[n], t.sizes[n] ?? 0)), limits: s.limits() });
  });

  /** A picture pasted onto a board: kept as an attachment, and the fence that draws it appended. */
  app.post("/__board/asset", async (c) => {
    const name = c.req.query("name") ?? "";
    const current = await mustRead(s.vault, name, "board");
    const body = await bodyOf(c);
    const kept = await storePasted(s, body.dataUrl);
    const itemId = freeItemId(current.text, `image-${kept.digest}`);
    const parts = [`#${itemId}`];
    for (const key of ["x", "y", "w"] as const) {
      const v = body[key];
      if (v !== undefined && v !== null && Number.isFinite(Number(v))) parts.push(`${key}=${Math.round(Number(v))}`);
    }
    if (typeof body.page === "string" && body.page && body.page !== "page-1") parts.push(`page=${body.page}`);
    const src = `dag:${kept.id}`;
    parts.push(`src="${src}"`); // quoted: a bare `:` ends an unquoted attribute value
    // Written against the version it was read at: a write that lost to another writer is the 409 the
    // page already knows, and the attachment stays, unreferenced, for the sweep to find.
    const text = current.text;
    const sep = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : text ? "\n\n" : "";
    const after = await s.vault.write(name, "board", `${text}${sep}\`\`\`image {${parts.join(" ")}}\n\`\`\`\n`, current.base);
    return c.json({ src, id: itemId, base: after.base });
  });

  /** A picture pasted into a note: kept as an attachment, nothing written — the editor writes the Markdown. */
  app.post("/__board/upload", async (c) => {
    const kind = textKind(c.req.query("kind"));
    await mustRead(s.vault, c.req.query("name") ?? "", kind);
    const body = await bodyOf(c);
    const kept = await storePasted(s, body.dataUrl);
    return c.json({ src: `dag:${kept.id}` });
  });

  const unused = async (name: string) => {
    await mustRead(s.vault, name, "board");
    const texts = Object.values(await s.vault.texts());
    const files = await s.vault.assetFiles(name);
    return files.filter((f) => !texts.some((t) => t.includes(leafOf(f.path)))).sort((a, b) => (a.path < b.path ? -1 : 1));
  };
  const answer = (files: { path: string; bytes: number }[]) => ({
    files: files.map((f) => ({ file: f.path, bytes: f.bytes })),
    bytes: files.reduce((n, f) => n + f.bytes, 0),
  });

  app.get("/__board/assets/unused", async (c) => c.json(answer(await unused(c.req.query("name") ?? ""))));

  app.post("/__board/assets/sweep", async (c) => {
    const going = await unused(c.req.query("name") ?? "");
    await s.vault.dropAssets(going.map((f) => f.path));
    return c.json(answer(going));
  });

  app.get("/__board/assets/*", async (c) => {
    const rel = decodeURIComponent(c.req.path.slice("/__board/assets/".length));
    let data: Buffer | null;
    try {
      data = await s.vault.getAsset(rel);
    } catch (e) {
      if (e instanceof Refused) throw err(403, "not a picture of a document");
      throw e;
    }
    if (!data) throw err(404, "not found");
    return c.body(new Uint8Array(data), 200, { "content-type": mimeOf(extOf(rel)), "cache-control": "no-cache" });
  });
}
