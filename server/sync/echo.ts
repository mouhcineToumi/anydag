/**
 * What sync itself last left at a path, so the watcher's report of that write is not taken for a
 * change (#36).
 *
 * The loop starts the vault's watcher with itself, so every file a pull, a download or a merge
 * writes comes back as a watcher event, often after the call that wrote it has returned. Handed to
 * `touch`, each one raised `pending` and woke the push debounce for a run that found the disk equal
 * to its base and pushed nothing — `idle` → `syncing` → `idle`, a couple of seconds after the
 * person's last action, for every batch a pull applied. *No echo* held for the push; the wake-up
 * did not.
 *
 * Load-bearing:
 * - **A note is a claim that sync was the last to write a path**, with what it left there: the sha1
 *   of the bytes, `null` for nothing, `FOLDER` for a folder it made. An event whose disk is still
 *   exactly that is the echo of sync's own write, and is not a change: whatever that write left to
 *   push (a merge, a conflict copy) the engine marked itself when it decided. Anything else on disk
 *   is somebody else's write since, and is touched as before. Every write sync makes is a
 *   compare-and-set against what it read, so a write that came in between either made sync's fail
 *   (no note) or was what sync decided on.
 * - **Every event spends its path's note**, echo or not, so a note never outlives the first write
 *   after it. A note no event spends — a write that changed nothing reports nothing, and a folder
 *   that was already there was not made — lapses after `ECHO_MS`.
 * - **A folder is never read**: `SyncFs` (frozen) cannot tell a folder from nothing. A folder sync
 *   made is implied by what it holds, so its event says nothing a file's event does not; the engine
 *   still touches one the state holds as an empty-folder marker.
 * - **Only the watcher's channel is filtered.** `touch` (the harness calls it directly) and `scan`
 *   know nothing of this: a scan decides against the base and is right whatever a note says.
 */

import { dirSyncs } from "./scope";
import type { SyncFs } from "./types";

/** What a note says sync left at a folder it made. Never a sha1, which is hex. */
export const FOLDER = "/";

/** How long a note no event spent is believed: far longer than a busy watcher takes to report. */
const ECHO_MS = 30_000;

/** The sha1 of the bytes sync left at a path, `null` for nothing, or `FOLDER`. */
export type Left = string | null;

export class Echoes {
  /** rel → what sync left there and when, oldest first (a note is re-inserted when renewed). */
  private readonly notes = new Map<string, { left: Left; at: number }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Sync left `left` at `rel`. */
  note(rel: string, left: Left): void {
    const at = this.now();
    this.notes.delete(rel);
    this.notes.set(rel, { left, at });
    for (const [r, n] of this.notes) {
      if (at - n.at <= ECHO_MS) break;
      this.notes.delete(r);
    }
  }

  /** What sync last left at `rel`, if it is still believed — `undefined` when nothing is. Spends it. */
  take(rel: string): Left | undefined {
    const n = this.notes.get(rel);
    if (!n) return undefined;
    this.notes.delete(rel);
    return this.now() - n.at <= ECHO_MS ? n.left : undefined;
  }

  /** `fs`, noting every write, removal and folder that succeeds through it. Reads pass through. */
  wrap(fs: SyncFs, sha1Of: (bytes: Uint8Array) => string): SyncFs {
    const folders = (rel: string): void => {
      const parts = rel.split("/");
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        if (dirSyncs(dir)) this.note(dir, FOLDER);
      }
    };
    // Every member named, not spread: an `fs` that is a class instance keeps its methods.
    return {
      root: fs.root,
      scan: () => fs.scan(),
      read: (rel) => fs.read(rel),
      spelled: (rel) => fs.spelled(rel),
      watch: (on) => fs.watch(on),
      createdOf: (rel) => fs.createdOf(rel),
      adoptCreated: (rel, created) => fs.adoptCreated(rel, created),
      writeIf: async (rel, bytes, expect) => {
        const ok = await fs.writeIf(rel, bytes, expect);
        if (ok) {
          folders(rel);
          this.note(rel, sha1Of(bytes));
        }
        return ok;
      },
      removeIf: async (rel, expect) => {
        const ok = await fs.removeIf(rel, expect);
        if (ok) this.note(rel, null);
        return ok;
      },
      mkdir: async (rel) => {
        await fs.mkdir(rel);
        folders(rel);
        this.note(rel, FOLDER);
      },
      rmdirIfEmpty: async (rel) => {
        const ok = await fs.rmdirIfEmpty(rel);
        if (ok) this.note(rel, null);
        return ok;
      },
    };
  }
}
