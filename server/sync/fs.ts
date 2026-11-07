/**
 * `SyncFs` over a `Vault`: the sync client's only way into a folder.
 *
 * Load-bearing: **what syncs is `syncs()`/`dirSyncs()` and nothing else** — the Vault's own walk
 * ignores `.anydag` and `*.assets`, so the scan here is a walk of its own; every write goes through
 * the vault's compare-and-set raw methods, which never mint an id or change a byte; and `watch` is
 * the vault's second channel on its one watcher, never a watcher of this file's own.
 */

import fs from "node:fs";
import path from "node:path";

import type { Vault } from "../vault";
import { dirSyncs, syncs } from "./scope";
import type { Entry, SyncFs } from "./types";

export function vaultFs(vault: Vault): SyncFs {
  const types = vault.types;

  function scan(): Entry[] {
    const out: Entry[] = [];
    /** Whether anything under `rel` syncs. */
    const walk = (rel: string): boolean => {
      let found = false;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(vault.abs(rel), { withFileTypes: true });
      } catch {
        return false;
      }
      for (const e of entries) {
        const child = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (rel === "" && e.name === ".anydag") {
            if (walk(child)) found = true;
            continue;
          }
          // A segment that cannot sync is never entered; a legacy picture folder can.
          if (!e.name.endsWith(".assets") && !dirSyncs(child) && !inAnydag(child)) continue;
          const sub = walk(child);
          found ||= sub;
          if (!sub && dirSyncs(child)) {
            const st = fs.statSync(vault.abs(child), { throwIfNoEntry: false });
            out.push({ rel: child, kind: "dir", size: 0, mtime: st?.mtimeMs ?? 0 });
            found = true;
          }
        } else if (e.isFile() && syncs(child, types)) {
          const st = fs.statSync(vault.abs(child), { throwIfNoEntry: false });
          if (!st) continue;
          out.push({ rel: child, kind: "file", size: st.size, mtime: st.mtimeMs });
          found = true;
        }
      }
      return found;
    };
    walk("");
    return out;
  }

  return {
    root: vault.root,
    scan: async () => scan(),
    read: async (rel) => {
      const b = vault.readRaw(rel);
      return b ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : null;
    },
    spelled: async (rel) => otherCase(vault.abs(rel), rel),
    writeIf: async (rel, bytes, expect) => vault.writeRawIf(rel, bytes, expect),
    removeIf: async (rel, expect) => vault.removeRawIf(rel, expect),
    mkdir: async (rel) => vault.mkdirRaw(rel),
    rmdirIfEmpty: async (rel) => vault.rmdirRawIfEmpty(rel),
    watch: (on) => vault.subscribeRaw(on),
    createdOf: (rel) => vault.createdOf(rel),
    adoptCreated: (rel, created) => vault.adoptCreated(rel, created),
  };
}

/** A file beside `abs` named as it is but in another case, as a vault-relative path, or `null`. */
export function otherCase(abs: string, rel: string): string | null {
  const base = path.basename(abs);
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(path.dirname(abs), { withFileTypes: true });
  } catch {
    return null;
  }
  const hit = names.find((e) => e.isFile() && e.name !== base && e.name.toLowerCase() === base.toLowerCase());
  return hit ? path.posix.join(path.posix.dirname(rel), hit.name).replace(/^\.\//, "") : null;
}

/** Whether a path under `.anydag/` may hold something that syncs: its allowed folders. */
function inAnydag(rel: string): boolean {
  const [head, second, ...rest] = rel.split("/");
  if (head !== ".anydag" || path.posix.basename(rel) === "") return false;
  return second === "files" ? rest.length === 0 : second === "components" || second === "trash";
}
