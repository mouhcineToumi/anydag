import type { TrashEntry } from "@/board/useBoard";
import { isLocked, refuseLocked } from "@/settings/lock";

/**
 * The trash, from the page: what is in it, and the three things done to
 * it. The delete itself is `deleteBoard` and `deleteFolder` in `useBoard.ts`, beside the rest of what
 * the sidebar does to a file; these are the Trash page's and the Undo's.
 *
 * Every call says `dag:trash` on the window when it changed something, `onBoards`' rule: the feed
 * says so too, a moment later, and a page must not wait on the feed for its own change.
 */

export interface TrashList {
  /** How many days a thing stays — the server's `ANYDAG_TRASH_DAYS`. */
  days: number;
  entries: TrashEntry[];
}

const DAY = 86_400_000;

const told = () => dispatchEvent(new CustomEvent("dag:trash"));

/** What is in the trash, newest first, or `null` when it could not be read. */
export async function readTrash(): Promise<TrashList | null> {
  try {
    const r = await fetch("/__board/trash");
    return r.ok ? ((await r.json()) as TrashList) : null;
  } catch {
    return null;
  }
}

async function post(route: string, body?: object): Promise<{ ok: true; got: unknown } | { ok: false; error: string }> {
  /* A restore and a delete for good both change files, so the lock stops all three here —
     the floor under the page, which does not offer them while locked, and under the notice's Undo. */
  if (isLocked()) {
    refuseLocked();
    return { ok: false, error: "Read only: unlock to change the trash." };
  }
  try {
    const r = await fetch(`/__board/trash/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const got = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) return { ok: false, error: got.error ?? "It could not be done. Try again." };
    told();
    return { ok: true, got };
  } catch {
    return { ok: false, error: "The server did not answer. Try again." };
  }
}

/**
 * Put an entry back where it was. Resolves to the entry as it landed — its `name` numbered when the
 * old one was taken since — or to the sentence saying why it could not be.
 */
export async function restoreFromTrash(id: string): Promise<TrashEntry | string> {
  const done = await post("restore", { id });
  return done.ok ? (done.got as TrashEntry) : done.error;
}

/** Delete an entry for good. Resolves to `null`, or to the sentence saying why it could not be. */
export async function deleteForever(id: string): Promise<string | null> {
  const done = await post("delete", { id });
  return done.ok ? null : done.error;
}

/** Delete everything in the trash for good. Resolves to `null`, or to the sentence saying why not. */
export async function emptyTrash(): Promise<string | null> {
  const done = await post("empty");
  return done.ok ? null : done.error;
}

/** Days until it goes for good, counted up — thirty the moment it is deleted, one on its last day. */
export const daysLeft = (expires: string, now = Date.now()): number => Math.max(0, Math.ceil((Date.parse(expires) - now) / DAY));
