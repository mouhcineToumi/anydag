/**
 * Uploading an attachment, and where one is drawn from.
 *
 * **The file is the request body**: `POST /__board/file?name=&folder=`, with the bytes as they are.
 * The server decides what it is from its extension and refuses what this deployment does not take,
 * with a sentence; the page asks the same two questions first (`refusal`), off the limits the server
 * reported, so somebody dropping a 200 MB video is told at once rather than after it has been sent.
 *
 * Every function resolves rather than throws — a refusal comes back as `{ error }` — because these
 * are reached from a drop or a click, where an exception has nowhere useful to go.
 */
import { scopeUrl } from "@/vault/current";

import { extOf } from "./types";

/** One attachment, as every file route describes it. */
export interface Uploaded {
  name: string;
  id: string;
  title: string | null;
  ext: string;
  mime: string;
  bytes: number;
}

/** What this deployment accepts: the largest file, and the extensions. */
export interface Limits {
  maxBytes: number;
  types: string[];
}

let limits: Promise<Limits | null> | null = null;

/** The deployment's limits, asked once per page: they are the process's and do not move while it lives. */
export function readLimits(): Promise<Limits | null> {
  limits ??= fetch("/__board/files")
    .then(async (r) => (r.ok ? (((await r.json()) as { limits?: Limits }).limits ?? null) : null))
    .catch(() => null)
    .then((got) => {
      /* A failed ask is asked again next time rather than remembered as "no limits". */
      if (!got) limits = null;
      return got;
    });
  return limits;
}

/** A size as a refusal says it: `25 MB`, `300 KB` — the server's `megabytes`, word for word. */
export function megabytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return mb >= 10 || mb === Math.trunc(mb) ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** Why this deployment would refuse a file, in the server's own words, or `null` when it would take it. */
export function refusal(file: { name: string; size: number }, got: Limits | null): string | null {
  const ext = extOf(file.name);
  if (!ext) return `\`${file.name}\` has no extension, so there is no telling what it is`;
  if (!got) return null;
  if (!got.types.includes(ext)) return `\`.${ext}\` files cannot be uploaded here`;
  if (file.size > got.maxBytes) return `\`${file.name}\` is ${megabytes(file.size)}; the limit is ${megabytes(got.maxBytes)}`;
  return null;
}

/** Tell every list on the page that there is a file it has not seen, as a folder made does. */
const told = <T>(v: T): T => (dispatchEvent(new CustomEvent("dag:boards")), v);

/**
 * Upload one file into `folder` (`""` the top level). Resolves to what the server kept — under the
 * name it settled on, numbered when taken — or `{ error }` with the sentence to show.
 */
export async function uploadFile(file: File, folder = "", title?: string): Promise<Uploaded | { error: string }> {
  const early = refusal(file, await readLimits());
  if (early) return { error: early };
  const q = new URLSearchParams({ name: file.name, folder, ...(title ? { title } : {}) });
  try {
    const r = await fetch(`/__board/file?${q}`, { method: "POST", body: file });
    const got = (await r.json().catch(() => null)) as (Uploaded & { error?: string }) | null;
    if (!r.ok || !got || got.error) return { error: got?.error ?? `\`${file.name}\` could not be uploaded. Try again.` };
    return told(got);
  } catch {
    return { error: `\`${file.name}\` could not be uploaded. Check the connection and try again.` };
  }
}

/**
 * Upload several, one after another — a drop of ten files is ten requests, never ten at once over a
 * connection the page shares with everything else — and say what became of each.
 */
export async function uploadFiles(files: readonly File[], folder = ""): Promise<{ done: Uploaded[]; errors: string[] }> {
  const done: Uploaded[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const got = await uploadFile(f, folder);
    if ("error" in got) errors.push(got.error);
    else done.push(got);
  }
  return { done, errors };
}

/**
 * Where an attachment's bytes are, for an `<img>`, a player, pdf.js or a download: by id, which is
 * what a reference holds and what survives a rename, or by name. Scoped to this tab's workspace,
 * because an `<img src>` cannot carry a header (`workspace/current.ts`).
 */
export function fileUrl(ref: { id?: string | null; name?: string | null }, download = false): string {
  const q = new URLSearchParams(ref.id ? { id: ref.id } : { name: ref.name ?? "" });
  if (download) q.set("download", "1");
  return scopeUrl(`/__board/file?${q}`);
}

/** The files a drag carries from the operating system, or `null` when it carries none. */
export function draggedFiles(data: DataTransfer | null): File[] | null {
  if (!data || !Array.from(data.types).includes("Files")) return null;
  return Array.from(data.files);
}
