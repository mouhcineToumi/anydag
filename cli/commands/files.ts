import fs from "node:fs";
import path from "node:path";

import { bundle, zipBundle } from "../../src/export/bundle";

import { ApiError, type Api } from "../api";
import { UsageError, bool, str } from "../args";
import { emit, table, type Command, type Ctx } from "../context";
import type { Refs } from "./docs";

/**
 * Attachments, from a terminal: any file, kept as a document of its own beside the boards
 * and notes, with a permanent id a note or a board refers to it by.
 *
 * `upload` sends the bytes as the request body, the one route in the API that takes something other
 * than JSON, because a PDF of twenty megabytes is twenty-seven as base64. The rest are the operations
 * every document has — list, get, move, delete — through the routes the sidebar calls, with
 * `kind=file`; `rm` says what uses a file, as the sidebar used to ask.
 */

interface FileRow {
  name: string;
  id: string | null;
  title: string | null;
  ext: string;
  mime: string;
  bytes: number;
}

interface Limits {
  maxBytes: number;
  types: string[];
}

interface IndexDoc {
  id: string;
  name: string;
  kind: string;
  title?: string | null;
  refs: { id: string; type: "link" | "embed"; text: string }[];
}

/** The documents whose text names the attachment `id` — what a delete would leave pointing at nothing. */
async function usesOf(ctx: Ctx, name: string): Promise<{ id: string | null; used: { name: string; kind: string; title: string | null }[] }> {
  try {
    const me = await ctx.api.get<Refs>("/__board/refs", { name, kind: "file" });
    return { id: me.id, used: me.backlinks.map((d) => ({ name: d.name, kind: d.kind, title: d.title })) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { id: null, used: [] };
    throw e;
  }
}

/** Bytes to a path, or to stdout when there is none. */
function deliver(ctx: Ctx, bytes: Uint8Array, out: string | undefined): void {
  if (out) {
    fs.writeFileSync(out, bytes);
    ctx.io.err(`wrote ${out} (${kb(bytes.length)})`);
  } else ctx.io.write(bytes);
}

/** A size a person reads. */
const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

const fileStem = (s: string) => s.replace(/[^\w.-]+/g, "-");

/**
 * A board or a note and everything it names, as the zip the Export menu saves (`src/export/bundle.ts`,
 * the page's own function): the Markdown with each attachment's `dag:` rewritten to its path, the
 * attachments beside it, and every pasted picture at the path its text gives it. Written to `out`,
 * or to `<name>.zip`; the path is printed.
 */
export async function exportZip(ctx: Ctx, name: string, kind: "board" | "note", text: string, out: string | undefined): Promise<void> {
  const { docs } = await ctx.api.get<{ docs: IndexDoc[] }>("/__board/index");
  const byId = new Map(docs.map((d) => [d.id, d]));
  const folder = name.includes("/") ? `${name.slice(0, name.lastIndexOf("/"))}/` : "";
  const bytesOf = async (api: Api, route: string, query?: Record<string, string>): Promise<Uint8Array | null> => {
    try {
      return new Uint8Array(await (await api.raw(route, { query })).arrayBuffer());
    } catch {
      return null;
    }
  };
  const mdPath = `${fileStem(name)}.${kind}.md`;
  const made = await bundle(
    mdPath,
    text,
    async (id) => {
      const d = byId.get(id);
      if (d?.kind !== "file") return null;
      const data = await bytesOf(ctx.api, "/__board/file", { id });
      return data ? { name: d.name, data } : null;
    },
    (p) => bytesOf(ctx.api, `/__board/assets/${(folder + p).split("/").map(encodeURIComponent).join("/")}`),
  );
  const file = out ?? `${fileStem(name)}.zip`;
  const zip = zipBundle(mdPath, made);
  fs.writeFileSync(file, zip);
  emit(ctx, { out: file, bytes: zip.length, files: made.files.map((f) => f.path) }, () => {
    ctx.io.out(file);
    ctx.io.err(`${mdPath} and ${made.files.length} file${made.files.length === 1 ? "" : "s"} beside it`);
  });
}

export const FILES: Command[] = [
  {
    name: ["file", "upload"],
    args: "<path…>",
    min: 1,
    summary: "keep files as attachments — a PDF, a picture, a sheet, anything this deployment accepts",
    help:
      "Each file is sent as it is and listed with the boards and notes, under a name made from its own (`Q3 " +
      "Report.pdf` is `q3-report.pdf`, numbered if taken) and titled what it was called. Prints each name and " +
      "its permanent id: a note refers to it as `![Title](dag:<id>)`, which draws a picture inline and anything " +
      "else as a card, and a board draws a picture with an `image` fence whose `src=\"dag:<id>\"`. The largest " +
      "file and the types this deployment takes are `anydag file ls`'s last line; anything else is refused, with why.",
    flags: [
      { name: "folder", type: "string", value: "<folder>", help: "where they go (default: the top level)" },
      { name: "title", type: "string", value: "<title>", help: "what one file is called, when it is one" },
    ],
    routes: ["POST /__board/file"],
    async run(ctx, p) {
      const title = str(p, "title");
      if (title !== undefined && p.pos.length > 1) throw new UsageError("--title names one file; upload them one at a time");
      const done: FileRow[] = [];
      for (const file of p.pos) {
        let bytes: Buffer;
        try {
          bytes = fs.readFileSync(file);
        } catch {
          throw new UsageError(`cannot read \`${file}\``);
        }
        const res = await ctx.api.raw("/__board/file", {
          method: "POST",
          query: { name: path.basename(file), folder: str(p, "folder") ?? "", title },
          headers: { "content-type": "application/octet-stream" },
          body: new Uint8Array(bytes),
        });
        done.push((await res.json()) as FileRow);
      }
      emit(ctx, done.length === 1 ? done[0] : { files: done }, () => {
        for (const line of table(done.map((f) => [f.name, f.id ?? "", kb(f.bytes)]))) ctx.io.out(line);
      });
    },
  },
  {
    name: ["file", "ls"],
    args: "[<folder>]",
    summary: "every attachment, its size and what it is called — and what this deployment accepts",
    flags: [{ name: "ids", type: "boolean", help: "show each file's permanent id" }],
    routes: ["GET /__board/files"],
    async run(ctx, p) {
      const got = await ctx.api.get<{ files: FileRow[]; limits: Limits }>("/__board/files");
      const under = p.pos[0]?.replace(/\/+$/, "");
      const rows = got.files.filter((f) => !under || f.name.startsWith(`${under}/`));
      emit(ctx, { ...got, files: rows }, () => {
        for (const line of table(rows.map((f) => (bool(p, "ids") ? [f.name, f.id ?? "", kb(f.bytes), f.title ?? ""] : [f.name, kb(f.bytes), f.title ?? ""]))))
          ctx.io.out(line);
        ctx.io.err(`${rows.length} file${rows.length === 1 ? "" : "s"}; up to ${kb(got.limits.maxBytes)} each, of: ${got.limits.types.join(" ")}`);
      });
    },
  },
  {
    name: ["file", "get"],
    args: "<name>",
    min: 1,
    summary: "download an attachment, by name or with --id by its permanent id",
    flags: [
      { name: "id", type: "boolean", help: "<name> is a permanent id" },
      { name: "out", short: "o", type: "string", value: "<file>", help: "where to write it (default: stdout)" },
    ],
    routes: ["GET /__board/file"],
    async run(ctx, p) {
      const which = p.pos[0]!;
      const res = await ctx.api.raw("/__board/file", { query: bool(p, "id") ? { id: which } : { name: which } });
      deliver(ctx, new Uint8Array(await res.arrayBuffer()), str(p, "out"));
    },
  },
  {
    name: ["file", "mv"],
    args: "<name> <to>",
    min: 2,
    summary: "rename an attachment, or move it into a folder with a / — its extension stays its own",
    help: "`<to>` without an extension keeps the file's: `work/final` for `deck.pptx` is `work/final.pptx`. Its id, and every reference to it, survive.",
    routes: ["POST /__board/rename"],
    async run(ctx, p) {
      const done = await ctx.api.post<{ name: string; id: string }>("/__board/rename", { name: p.pos[0], to: p.pos[1], kind: "file" });
      emit(ctx, done, () => ctx.io.out(done.name));
    },
  },
  {
    name: ["file", "rm"],
    args: "<name>",
    min: 1,
    summary: "move an attachment to the trash — saying what uses it, and `anydag trash restore` brings it back",
    help:
      "Every board and note that names it shows it as missing until it is restored, and they are listed. " +
      "--yes is accepted and does nothing: a delete can be taken back now, so nothing is asked.",
    flags: [{ name: "yes", short: "y", type: "boolean", help: "accepted, and not needed" }],
    routes: ["GET /__board/refs", "POST /__board/delete"],
    async run(ctx, p) {
      const name = p.pos[0]!;
      const { used } = await usesOf(ctx, name);
      const done = await ctx.api.post<{ trash: { id: string } }>("/__board/delete", { name, kind: "file" });
      emit(ctx, { name, kind: "file", was_used_in: used, trash: done.trash }, () => {
        const where = used.length ? `; ${used.length} document${used.length === 1 ? "" : "s"} use${used.length === 1 ? "s" : ""} it: ${used.map((u) => u.name).join(", ")}` : "";
        ctx.io.err(`moved ${name} to the trash${where} — anydag trash restore ${done.trash.id} brings it back`);
      });
    },
  },
];
