import type { SyncStatus } from "./types";

/**
 * What a linked vault's state is called, in words. No React and no DOM,
 * so `test/sync-page.test.ts` holds the wording and the recovery code's comparison.
 */

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The short line for the sidebar's foot and the tab's headline. A vault not linked says so. */
export function statusWords(s: SyncStatus | null): string {
  if (!s || !s.linked) return "Not synced";
  if (s.conflicts.length > 0) return plural(s.conflicts.length, "conflict");
  switch (s.state) {
    case "syncing":
      return "Syncing…";
    case "offline":
      return "Offline";
    case "paused":
      return s.reason ? `Paused: ${s.reason}` : "Paused";
    case "error":
      return s.reason ? `Error: ${s.reason}` : "Error";
    case "unlinked":
      return "Not synced";
    case "idle":
      return s.pending > 0 ? `${plural(s.pending, "change")} waiting` : "Synced";
  }
}

/** Which of three looks the sidebar's mark wears. */
export function statusTone(s: SyncStatus | null): "ok" | "busy" | "warn" {
  if (!s || !s.linked) return "ok";
  if (s.state === "syncing") return "busy";
  if (s.state === "idle" && s.conflicts.length === 0 && s.pending === 0) return "ok";
  return "warn";
}

/** A recovery code as it is compared: upper case, no spaces, no dashes. */
export function normaliseRecovery(code: string): string {
  return code.replace(/[\s-]+/g, "").toUpperCase();
}

export function sameRecovery(a: string, b: string): boolean {
  const x = normaliseRecovery(a);
  return x.length > 0 && x === normaliseRecovery(b);
}

export const MIN_PASSPHRASE = 8;

/** The sentence refusing a passphrase pair, or `null` when it will do. */
export function passphraseProblem(a: string, b: string): string | null {
  if (a.length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`;
  if (a !== b) return "The two passphrases differ.";
  return null;
}

/** The address that opens a vault-relative path, by what its name says it is. */
export function hrefForPath(rel: string): string {
  const q = (k: string, v: string) => `?${k}=${encodeURIComponent(v)}`;
  const strip = (suffix: string) => rel.slice(0, -suffix.length);
  if (rel.endsWith(".board.md")) return q("board", strip(".board.md"));
  if (rel.endsWith(".quiz.md")) return q("quiz", strip(".quiz.md"));
  if (rel.endsWith(".table.md")) return q("table", strip(".table.md"));
  if (rel.endsWith(".note.md")) return q("note", strip(".note.md"));
  if (rel.endsWith(".md")) return q("note", strip(".md"));
  return q("file", rel);
}
