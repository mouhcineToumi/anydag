/**
 * A `SyncFs` over a plain temp folder, for the sync client's tests: the same compare-and-set
 * contract `server/sync/fs.ts` gives over a `Vault` — the same scope (`syncs`/`dirSyncs`), a write
 * through a temp file and a rename, a folder left in place when its last file goes — with no index
 * and no watcher. `createdOf` reads an in-memory map that `write` fills for a document the test
 * makes, and `adoptCreated` fills for one sync makes. Tests call `engine.scan()` and `touch()`
 * themselves.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { otherCase } from "../../server/sync/fs";
import { dirSyncs, syncs } from "../../server/sync/scope";
import type { Entry, SyncFs } from "../../server/sync/types";

export interface TmpFs extends SyncFs {
  readonly root: string;
  readonly created: Map<string, string>;
  /** Write from "outside": a person or an agent, not sync. */
  write(rel: string, data: string | Uint8Array, created?: string): void;
  remove(rel: string): void;
  mkdirp(rel: string): void;
  rmdir(rel: string): void;
  readText(rel: string): string | null;
  /** Every path that syncs and its bytes as base64, sorted: two vaults that agree print the same. */
  snapshot(): Promise<Record<string, string>>;
  dispose(): void;
}

export const TYPES: ReadonlySet<string> = new Set(["png", "pdf", "jpg"]);

const sha1 = (b: Uint8Array): string => createHash("sha1").update(b).digest("hex");

let stamp = Date.UTC(2026, 0, 1);

export function tmpFs(types: ReadonlySet<string> = TYPES): TmpFs {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-sync-"));
  const created = new Map<string, string>();
  const abs = (rel: string): string => path.join(root, ...rel.split("/"));

  const readNow = (rel: string): Uint8Array | null => {
    try {
      const st = fs.statSync(abs(rel));
      return st.isFile() ? new Uint8Array(fs.readFileSync(abs(rel))) : null;
    } catch {
      return null;
    }
  };

  function scanSync(): Entry[] {
    const out: Entry[] = [];
    const walk = (rel: string): boolean => {
      let found = false;
      let names: fs.Dirent[];
      try {
        names = fs.readdirSync(rel ? abs(rel) : root, { withFileTypes: true });
      } catch {
        return false;
      }
      for (const d of names) {
        const child = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) {
          const sub = walk(child);
          found ||= sub;
          if (!sub && dirSyncs(child)) {
            out.push({ rel: child, kind: "dir", size: 0, mtime: fs.statSync(abs(child)).mtimeMs });
            found = true;
          }
        } else if (d.isFile() && syncs(child, types)) {
          const st = fs.statSync(abs(child));
          out.push({ rel: child, kind: "file", size: st.size, mtime: st.mtimeMs });
          found = true;
        }
      }
      return found;
    };
    walk("");
    return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  }

  const atomic = (rel: string, bytes: Uint8Array): void => {
    const file = abs(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  };

  return {
    root,
    created,
    async scan() {
      return scanSync();
    },
    async spelled(rel) {
      return otherCase(abs(rel), rel);
    },
    async read(rel) {
      return readNow(rel);
    },
    async writeIf(rel, bytes, expect) {
      const now = readNow(rel);
      if (expect === null ? now !== null || fs.existsSync(abs(rel)) : !now || sha1(now) !== expect) return false;
      atomic(rel, bytes);
      return true;
    },
    async removeIf(rel, expect) {
      const now = readNow(rel);
      if (!now || sha1(now) !== expect) return false;
      fs.rmSync(abs(rel));
      return true;
    },
    async mkdir(rel) {
      fs.mkdirSync(abs(rel), { recursive: true });
    },
    async rmdirIfEmpty(rel) {
      try {
        fs.rmdirSync(abs(rel));
        return true;
      } catch {
        return false;
      }
    },
    async watch() {
      return () => undefined;
    },
    createdOf(rel) {
      return created.get(rel) ?? null;
    },
    adoptCreated(rel, instant) {
      created.set(rel, instant);
    },
    write(rel, data, at) {
      if (!created.has(rel)) created.set(rel, at ?? new Date((stamp += 60_000)).toISOString());
      atomic(rel, typeof data === "string" ? new Uint8Array(Buffer.from(data, "utf8")) : data);
    },
    remove(rel) {
      fs.rmSync(abs(rel));
    },
    mkdirp(rel) {
      fs.mkdirSync(abs(rel), { recursive: true });
    },
    rmdir(rel) {
      fs.rmdirSync(abs(rel));
    },
    readText(rel) {
      const b = readNow(rel);
      return b ? Buffer.from(b).toString("utf8") : null;
    },
    async snapshot() {
      const out: Record<string, string> = {};
      for (const e of scanSync()) out[e.rel] = e.kind === "dir" ? "<dir>" : Buffer.from(readNow(e.rel)!).toString("base64");
      return out;
    },
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
