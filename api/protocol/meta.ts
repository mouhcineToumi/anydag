/**
 * What the server keeps beside a key, sealed: the path as typed, what it is, and the facts a second
 * device needs that the bytes do not carry.
 *
 * Load-bearing:
 * - **A sealed `meta` is bound to the log entry it travels in** — its key, its blob and its parent,
 *   sealed inside it beside the path (protocol 2). The server holds every sealed `meta` and blob a
 *   vault ever had, and so does anybody holding a device token: bound to the key alone, a `meta`
 *   could be committed again over another blob (a re-pointed file), or again after newer versions
 *   (a replayed version, or a replayed delete), and every device would open it. `openMeta` refuses
 *   a `meta` under any entry but its own, with `MetaRefused` naming what disagreed.
 * - **The associated data names the format** (`meta/v2:<key>`), so a protocol-1 peer cannot open a
 *   protocol-2 `meta` at all, and a protocol-2 peer that meets a protocol-1 `meta` says so rather
 *   than "wrong key".
 */

import { b64, open, seal, Unsealed, unb64 } from "./crypto";

export interface Meta {
  /** The vault-relative path as the device that wrote it spelled it (`normalise`d). */
  path: string;
  /**
   * `dir` is an empty-folder marker. It carries the blob of the empty plaintext, so a head's blob is
   * `null` for a delete and for nothing else.
   */
  kind: "file" | "dir";
  /** The document's created instant from the app's index, so a second device dates it the same. */
  created: string | null;
  /** Milliseconds since the epoch, the writer's. Informational. */
  mtime: number;
  /** The plaintext's size in bytes; 0 for a delete or a folder. */
  size: number;
}

/** The log entry a `meta` belongs to: a `Change`'s `key`, `blob` and `parent`, as committed. */
export interface Binding {
  key: string;
  blob: string | null;
  parent: number | null;
}

/** A `meta` that opened but does not belong where it was found, or that an older protocol sealed. */
export class MetaRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaRefused";
  }
}

const FORMAT = 2;
const aad = (key: string): string => `meta/v${FORMAT}:${key}`;
/** Protocol 1's associated data, tried only to say why a `meta` did not open. */
const aadV1 = (key: string): string => `meta:${key}`;

export const sealMeta = (kEnc: Uint8Array, at: Binding, meta: Meta): string =>
  b64(
    seal(
      kEnc,
      Buffer.from(JSON.stringify({ v: FORMAT, key: at.key, blob: at.blob, parent: at.parent, ...meta }), "utf8"),
      aad(at.key),
    ),
  );

const show = (v: unknown): string => (v === null || v === undefined ? "none" : String(v));

export function openMeta(kEnc: Uint8Array, at: Binding, sealed: string): Meta {
  const bytes = unb64(sealed);
  let plain: Uint8Array;
  try {
    plain = open(kEnc, bytes, aad(at.key), "a path's metadata");
  } catch (e) {
    if (!(e instanceof Unsealed)) throw e;
    let old = false;
    try {
      open(kEnc, bytes, aadV1(at.key));
      old = true;
    } catch {
      /* not protocol 1's either: the key is wrong, or the bytes were changed */
    }
    if (old)
      throw new MetaRefused(
        "a path's metadata was sealed by an older AnyDag (sync protocol 1), which bound it to its key alone: upload this vault again from a device that has it",
      );
    throw e;
  }
  const raw = JSON.parse(Buffer.from(plain).toString("utf8")) as Partial<Meta> & Partial<Binding> & { v?: unknown };
  if (typeof raw.path !== "string" || (raw.kind !== "file" && raw.kind !== "dir")) throw new Error("metadata of the wrong shape");
  if (raw.v !== FORMAT || raw.key !== at.key)
    throw new MetaRefused(`the metadata of ${JSON.stringify(raw.path)} was sealed for another key`);
  if ((raw.blob ?? null) !== at.blob)
    throw new MetaRefused(
      `the metadata of ${JSON.stringify(raw.path)} names blob ${show(raw.blob)}, but the log gives it ${show(at.blob)}: a re-pointed file`,
    );
  if ((raw.parent ?? null) !== at.parent)
    throw new MetaRefused(
      `the metadata of ${JSON.stringify(raw.path)} was written over version ${show(raw.parent)}, but the log puts it over ${show(at.parent)}: a replayed version`,
    );
  return {
    path: raw.path,
    kind: raw.kind,
    created: typeof raw.created === "string" ? raw.created : null,
    mtime: typeof raw.mtime === "number" ? raw.mtime : 0,
    size: typeof raw.size === "number" ? raw.size : 0,
  };
}
