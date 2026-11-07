import { useEffect, useSyncExternalStore } from "react";

import { onVaultSync } from "@/board/events";

import { syncStatus } from "./api";
import type { SyncStatus } from "./types";

/**
 * The open vault's sync status: asked for once, then whatever the change feed says
 * (`dag:vault-sync`). One copy for the page, shared by the sidebar's row and the Sync tab, and
 * kept while anything shows it.
 */
let current: SyncStatus | null = null;
let asked = false;
const subscribers = new Set<() => void>();

function set(next: SyncStatus | null): void {
  current = next;
  for (const s of [...subscribers]) s();
}

/** Take a status the page learned some other way — the answer to Sync now, to a link, to an unlink. */
export function adoptSyncStatus(s: SyncStatus): void {
  set(s);
}

async function first(): Promise<void> {
  if (asked) return;
  asked = true;
  try {
    set(await syncStatus());
  } catch {
    asked = false;
  }
}

export function useSyncStatus(): SyncStatus | null {
  useEffect(() => {
    void first();
    return onVaultSync((s) => set(s));
  }, []);
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => void subscribers.delete(cb);
    },
    () => current,
    () => null,
  );
}
