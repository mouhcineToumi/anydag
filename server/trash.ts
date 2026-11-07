/**
 * The trash's rules that are not the vault's: how long a thing is kept,
 * and how an entry is said. `app/trash.py`, ported.
 *
 * **Expiry is lazy, and from the person's side it is exact.** An entry older than the days is never
 * listed and never restored from the moment it expires; its bytes go the next time the trash is listed
 * (`live`). There is no scheduler: a vault nobody opens keeps its trash as long as it keeps everything.
 */

import type { Trashed, Vault } from "./vault";

const DEFAULT_DAYS = 30;
const DAY = 86_400_000;

/**
 * `ANYDAG_TRASH_DAYS` read: a whole number of days above zero, else thirty. Zero is not "no trash": a
 * delete with nothing to take it back is what this exists to end.
 */
export function trashDays(raw: string | undefined = process.env.ANYDAG_TRASH_DAYS): number {
  const n = raw === undefined ? DEFAULT_DAYS : Number(raw.trim());
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAYS;
}

/** When `entry` leaves the trash for good, as an instant. */
function expiresAt(entry: Trashed, days: number): string {
  return new Date(Date.parse(entry.deleted) + days * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const expired = (entry: Trashed, days: number, now: number): boolean => now >= Date.parse(entry.deleted) + days * DAY;

/** One entry as every trash route and tool says it. */
export function trashAnswer(entry: Trashed, days: number): Record<string, unknown> {
  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    title: entry.title,
    deleted: entry.deleted,
    expires: expiresAt(entry, days),
    doc: entry.doc,
    holds: entry.kind === "folder" ? entry.holds : null,
  };
}

/** Everything in the trash that has not expired, newest first — forgetting what has on the way. */
export async function live(vault: Vault, days: number, now = Date.now()): Promise<Trashed[]> {
  const out: Trashed[] = [];
  for (const entry of await vault.trashList()) {
    if (!expired(entry, days, now)) {
      out.push(entry);
      continue;
    }
    try {
      await vault.forget(entry.id);
    } catch {
      /* one that would not go is not listed either way; the next listing tries again */
    }
  }
  return out;
}
