/**
 * The plaintext of every current base:
 * `~/.anydag/sync/<vault>/bases/<sha1[0..1]>/<sha1>`, content-addressed by sha1.
 *
 * Load-bearing: **a base is what makes a three-way merge possible without a round trip.** The
 * server keeps the blob too (thirty days), so a base missing here is fetched, never fatal — which
 * is why `trim` may be generous and a crash between a write and its base costs nothing. Written to
 * a temp file and renamed, so a base is never half there.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const sha1Of = (bytes: Uint8Array): string => createHash("sha1").update(bytes).digest("hex");

export class Bases {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(sha1: string): string {
    return path.join(this.dir, sha1.slice(0, 2), sha1);
  }

  /** Keep `bytes`; answers their sha1. A second put of the same bytes writes nothing. */
  put(bytes: Uint8Array): string {
    const sha1 = sha1Of(bytes);
    const file = this.file(sha1);
    if (fs.existsSync(file)) return sha1;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
    return sha1;
  }

  get(sha1: string): Uint8Array | null {
    try {
      const bytes = new Uint8Array(fs.readFileSync(this.file(sha1)));
      return sha1Of(bytes) === sha1 ? bytes : null;
    } catch {
      return null;
    }
  }

  /** Delete every base not in `keep`. */
  trim(keep: Set<string>): void {
    let shards: string[];
    try {
      shards = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const shard of shards) {
      const dir = path.join(this.dir, shard);
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) if (!keep.has(name)) fs.rmSync(path.join(dir, name), { force: true });
      try {
        fs.rmdirSync(dir);
      } catch {
        /* not empty */
      }
    }
  }
}
