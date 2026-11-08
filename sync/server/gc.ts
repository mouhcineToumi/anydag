/**
 * The collector: compacts each vault's log, deletes the bytes of blobs
 * nothing names any more, removes orphan files, and snapshots storage into the ledger.
 *
 * Load-bearing:
 * - **The index decides and the store obeys.** `Meta.collect` says which blobs to forget —
 *   superseded before the history window and named by no head and no remaining log row — and only
 *   those ids are deleted from `Blobs`. A blob a head names is never in that list, whatever its age.
 * - **The history window is the plan's when it has one, else `ANYDAG_SYNC_HISTORY_DAYS`.** A
 *   device offline less than that finds every base it needs to merge.
 * - **An orphan is a file the store holds and the index has no row for** — a crash between the
 *   upload's `Blobs.put` and its `Meta.addBlob`. It is removed only when older than an hour, because
 *   an upload in flight looks exactly like one for the moment between the two. The `Blobs` port
 *   carries no file times, so the age comes from `ageOf`; without one, orphans are left alone
 *   (safe, and said in the result's count). `diskAge` is `DiskBlobs`' layout, restated here —
 *   the one place outside `disk.ts` that knows it.
 * - **Storage is a snapshot**, per vault and per account (`vault` null), set rather than added: the
 *   value for a day is the last run's.
 * - **One vault's failure is that vault's**: it is said on stderr and the run goes on, so one
 *   corrupt directory does not stop every other vault's history from being trimmed.
 */

import { stat } from "node:fs/promises";
import path from "node:path";

import type { GcResult } from "../protocol/wire";
import type { Blobs } from "./blobs/types";
import type { Meta } from "./meta/types";
import { dayOf } from "./usage";

export const ORPHAN_MS = 60 * 60 * 1000;

export interface CollectOptions {
  historyDays: number;
  now: Date;
  /** How old a stored blob's file is, in ms, or `null` when it cannot say. */
  ageOf?: (vault: string, id: string) => Promise<number | null>;
  orphanMs?: number;
}

/** `DiskBlobs`' layout, `<root>/<vault>/<id[0:2]>/<id>`, asked for its file's age. */
export function diskAge(root: string, now: () => Date = () => new Date()): (vault: string, id: string) => Promise<number | null> {
  return async (vault, id) => {
    try {
      return now().getTime() - (await stat(path.join(root, vault, id.slice(0, 2), id))).mtimeMs;
    } catch {
      return null;
    }
  };
}

export async function collect(meta: Meta, blobs: Blobs, opts: CollectOptions): Promise<GcResult> {
  const result: GcResult = { compacted: 0, blobs: 0, bytes: 0 };
  const orphanMs = opts.orphanMs ?? ORPHAN_MS;
  const day = dayOf(opts.now);
  const plans = new Map<string, number>();
  const accounts = new Set<string>();

  for (const v of await meta.allVaults()) {
    accounts.add(v.account);
    try {
      let days = plans.get(v.account);
      if (days === undefined) {
        const account = await meta.account(v.account);
        days = (await meta.plan(account?.plan ?? "free")).history_days ?? opts.historyDays;
        plans.set(v.account, days);
      }
      const before = new Date(opts.now.getTime() - days * 86_400_000).toISOString();
      const done = await meta.collect(v.id, before);
      if (done.blobs.length)
        await blobs.delete(
          v.id,
          done.blobs.map((b) => b.id),
        );
      result.compacted += done.compacted;
      result.blobs += done.blobs.length;
      for (const b of done.blobs) result.bytes += Number(b.size);

      if (opts.ageOf) {
        const orphans: string[] = [];
        let bytes = 0;
        for await (const id of blobs.list(v.id)) {
          if ((await meta.blobSize(v.id, id)) !== null) continue;
          const age = await opts.ageOf(v.id, id);
          if (age === null || age < orphanMs) continue;
          orphans.push(id);
          bytes += (await blobs.size(v.id, id)) ?? 0;
        }
        if (orphans.length) {
          await blobs.delete(v.id, orphans);
          result.blobs += orphans.length;
          result.bytes += bytes;
        }
      }

      const s = await meta.storage(v.account, v.id);
      await meta.bump(day, v.account, v.id, "storage_live", Number(s.live));
      await meta.bump(day, v.account, v.id, "storage_history", Number(s.history));
      await meta.bump(day, v.account, v.id, "blobs", Number(s.blobs));
      await meta.bump(day, v.account, v.id, "files", Number(s.files));
    } catch (e) {
      console.error(`anydag-sync: collecting vault ${v.id} failed: ${(e as Error).message}`);
    }
  }

  for (const account of accounts) {
    try {
      const s = await meta.storage(account);
      await meta.bump(day, account, null, "storage_live", Number(s.live));
      await meta.bump(day, account, null, "storage_history", Number(s.history));
      await meta.bump(day, account, null, "blobs", Number(s.blobs));
      await meta.bump(day, account, null, "files", Number(s.files));
    } catch (e) {
      console.error(`anydag-sync: snapshotting account ${account} failed: ${(e as Error).message}`);
    }
  }
  return result;
}
