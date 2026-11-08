/**
 * What the server keeps beside a key, sealed: the path as typed, what it is, and the facts a second
 * device needs that the bytes do not carry.
 */

import { b64, open, seal, unb64 } from "./crypto";

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

export const sealMeta = (kEnc: Uint8Array, key: string, meta: Meta): string =>
  b64(seal(kEnc, Buffer.from(JSON.stringify(meta), "utf8"), `meta:${key}`));

export function openMeta(kEnc: Uint8Array, key: string, sealed: string): Meta {
  const raw = JSON.parse(
    Buffer.from(open(kEnc, unb64(sealed), `meta:${key}`, "a path's metadata")).toString("utf8"),
  ) as Partial<Meta>;
  if (typeof raw.path !== "string" || (raw.kind !== "file" && raw.kind !== "dir")) throw new Error("metadata of the wrong shape");
  return {
    path: raw.path,
    kind: raw.kind,
    created: typeof raw.created === "string" ? raw.created : null,
    mtime: typeof raw.mtime === "number" ? raw.mtime : 0,
    size: typeof raw.size === "number" ? raw.size : 0,
  };
}
