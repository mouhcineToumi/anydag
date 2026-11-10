/**
 * Blobs on the local disk: the one `Blobs` adapter this repository ships, a directory another
 * store — S3, GCS — fills in later under the same port.
 *
 * The layout is `<root>/<vault>/<id[0..1]>/<id>`, `id[0..1]` the id's first two characters, so
 * `list` reads short directories however many blobs a vault holds. The store knows a vault id and
 * a blob id and nothing about what either means: it never sees a plaintext, and it never checks an
 * id against bytes — it cannot, the id is a keyed hash of the plaintext (`types.ts`).
 *
 * Load-bearing:
 * - **A put is whole-or-not-at-all, and what is held stays as it is (`Blobs`, the port).** The write
 *   is a temp file in the blob's own directory — the same filesystem as the final path, which is
 *   what makes the `rename` atomic — then one `rename` onto it. A blob already held answers from
 *   before any temp exists.
 * - **Two devices uploading one id race harmlessly**: the blob id is an HMAC of the *plaintext*
 *   both uploads share, so every ciphertext of theirs opens to the same bytes. On POSIX `rename`
 *   replaces an existing file and never refuses one, so the narrow window where two writers pass
 *   the early check and both rename still leaves one complete, servable blob. On Windows the
 *   rename itself refuses (`EEXIST`/`EPERM`); the loser clears its temp and answers success, and
 *   first wins as the interface promises.
 * - **A temp file is `<id>.<pid>.<random>.tmp` beside its final path, and `list` never yields
 *   one.** It belongs to a call in flight and is removed however that call ends, so the collector
 *   (`gc.ts` compares `list` against the index) never sees half a blob.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { type Dirent } from "node:fs";
import path from "node:path";

import { BLOB_ID } from "../../protocol/wire";

import type { Blobs } from "./types";

/** The shape of a vault id at this door: `[0-9a-z]{10}`. Routes validate first and say
 * `ES_BAD_REQUEST`; this repeats the guard so nothing outside the store can name a path in it. */
const VAULT = /^[0-9a-z]{10}$/;

const enoent = (err: unknown): boolean => (err as { code?: string } | undefined)?.code === "ENOENT";

/** True when the file is there; `false` only when it is not there — any other error was not a question of absence. */
async function present(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (err) {
    if (enoent(err)) return false;
    throw err;
  }
}

/** The children of a directory, or `null` when it is not there: a vault never written, a branch removed mid-read. */
async function readDir(file: string): Promise<Dirent[] | null> {
  try {
    return await readdir(file, { withFileTypes: true });
  } catch (err) {
    if (enoent(err)) return null;
    throw err;
  }
}

export class DiskBlobs implements Blobs {
  constructor(private readonly root: string) {}

  private final(vault: string, id: string): string {
    if (!VAULT.test(vault)) throw new Error(`not a vault id: ${JSON.stringify(vault)}`);
    if (!BLOB_ID.test(id)) throw new Error(`not a blob id: ${JSON.stringify(id)}`);
    return path.join(this.root, vault, id.slice(0, 2), id);
  }

  async put(vault: string, id: string, bytes: Uint8Array): Promise<void> {
    const final = this.final(vault, id);
    if (await present(final)) return; // held: first wins
    const tmp = `${final}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    let landed = false;
    try {
      await mkdir(path.dirname(final), { recursive: true });
      await writeFile(tmp, bytes, { flag: "wx" });
      try {
        await rename(tmp, final);
        landed = true;
      } catch (err) {
        if (await present(final)) return; // another writer's rename landed: ours has no meaning, the first file wins
        throw err;
      }
    } finally {
      /* Not landed — the store refused, or another writer won — so our temp is litter, and nothing
       * the collector, `list` or a reader may ever see. */
      if (!landed) await rm(tmp, { force: true }).catch(() => {});
    }
  }

  async get(vault: string, id: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.final(vault, id)));
    } catch (err) {
      if (enoent(err)) return null;
      throw err;
    }
  }

  async size(vault: string, id: string): Promise<number | null> {
    try {
      return (await stat(this.final(vault, id))).size;
    } catch (err) {
      if (enoent(err)) return null;
      throw err;
    }
  }

  async delete(vault: string, ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      try {
        await unlink(this.final(vault, id));
      } catch (err) {
        if (!enoent(err)) throw err; // an absent one is nothing
      }
    }
  }

  async *list(vault: string): AsyncIterable<string> {
    if (!VAULT.test(vault)) throw new Error(`not a vault id: ${JSON.stringify(vault)}`);
    const vaultDir = path.join(this.root, vault);
    const groups = await readDir(vaultDir);
    if (!groups) return; // a vault never written has no blobs
    for (const group of groups) {
      const children = await readDir(path.join(vaultDir, group.name));
      if (!children) continue; // the branch went while we were listing
      for (const child of children) {
        /* A temp file is `<id>.<pid>.<random>.tmp` beside the blob it is becoming: not an id, never served. */
        if (!child.isFile() || child.name.endsWith(".tmp")) continue;
        yield child.name;
      }
    }
  }
}
