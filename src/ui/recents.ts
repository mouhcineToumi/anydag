import { FILE_KINDS, type FileKind } from "@/board/useBoard";
import { RECENT_FILES, readPref, writeLocal } from "@/settings/prefs";

/**
 * What Home remembers: the files this browser opened last, in this vault.
 *
 * **A recent file is this browser's, not the vault's.** Which files somebody opened is not a fact
 * about the folder and writing it there would break the rule that opening a vault never writes a
 * byte of it; a note on the account would be a second list to keep in step with a rename. It is
 * kept in `localStorage` under a key scoped to the vault (`RECENT_FILES` in `PER_VAULT`), so two
 * tabs in two vaults never read each other's — and a browser with site data blocked simply has no
 * recents, which is the honest answer.
 *
 * The list is `kind` + `name`, never a title: a title is the file's and can change without the path
 * moving. A name that no longer exists is filtered against the list when Home draws it, so a
 * deleted file leaves nothing behind to press.
 */

/** One file Home can offer: what it is, and the name that opens it. */
export interface RecentFile {
  kind: FileKind;
  name: string;
}

/** The last five, as the issue says: enough to get back to the work, short enough to scan. */
export const RECENT_LIMIT = 5;

const isKind = (value: unknown): value is FileKind =>
  typeof value === "string" && (FILE_KINDS as readonly string[]).includes(value);

/**
 * What a stored value reads as, and nothing more.
 *
 * The key is a browser's, so it may hold what somebody typed into a console, a value from an older
 * build, or a truncated write. A malformed entry is dropped rather than drawn as a row that opens
 * nothing; the rest of the list is still worth having. Deduped and capped here too, because the
 * same key can have been written by a version that did not.
 */
export function parseRecent(raw: string | null): RecentFile[] {
  const kept: RecentFile[] = [];
  try {
    const data: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(data)) return kept;
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const { kind, name } = item as { kind?: unknown; name?: unknown };
      if (!isKind(kind) || typeof name !== "string" || name === "") continue;
      if (kept.some((entry) => entry.kind === kind && entry.name === name)) continue;
      kept.push({ kind, name });
      if (kept.length === RECENT_LIMIT) break;
    }
  } catch {
    /* Not JSON: no recents is the honest answer, and it is one Home can draw. */
  }
  return kept;
}

/** `file` at the front, its old place gone, five at most — the newest first and no duplicates. */
export function rememberRecent(entries: readonly RecentFile[], file: RecentFile): RecentFile[] {
  return [file, ...entries.filter((entry) => entry.kind !== file.kind || entry.name !== file.name)].slice(0, RECENT_LIMIT);
}

/** The last five files this browser opened in this vault, newest first. */
export function readRecent(): RecentFile[] {
  return parseRecent(readPref(RECENT_FILES));
}

/** Remember a file the page has just opened — a write to this browser alone, never to the vault. */
export function rememberOpened(kind: FileKind, name: string): void {
  if (!name) return;
  writeLocal(RECENT_FILES, JSON.stringify(rememberRecent(readRecent(), { kind, name })));
}
