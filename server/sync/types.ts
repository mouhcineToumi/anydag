/**
 * The sync client's boundary with the vault. **Frozen**.
 *
 * The client never touches `fs` itself: it reads and writes a vault through `SyncFs`, which
 * `fs.ts` implements over `Vault`'s raw methods (`readRaw`, `writeRawIf`, `removeRawIf`,
 * `subscribeRaw`, `adoptCreated`, `createdOf`) and the tests implement over a temp folder. Every
 * write is a compare-and-set against bytes the client has seen — the sha1 base, applied to sync —
 * so the page or an agent writing in between always wins, and sync decides again.
 *
 * Paths are vault-relative, `/`-separated, as `normalise` (sync/protocol/crypto.ts) leaves them.
 */

/** One thing the scan found. */
export interface Entry {
  rel: string;
  kind: "file" | "dir";
  /** Bytes; 0 for a folder. */
  size: number;
  /** Milliseconds since the epoch. */
  mtime: number;
}

export interface SyncFs {
  readonly root: string;
  /**
   * Every path that syncs (`syncs()` in `scope.ts`): each file, and each folder that holds nothing
   * that syncs (an empty folder is a `dir` entry; a folder with a file in it is implied by the file).
   */
  scan(): Promise<Entry[]>;
  /** The bytes at `rel`, or `null` when nothing (or a folder) is there. */
  read(rel: string): Promise<Uint8Array | null>;
  /**
   * Another file in `rel`'s folder whose name is `rel`'s in another case, or `null`: one listing of
   * one folder, so a key arriving for the first time can ask it where a full scan would cost too much.
   */
  spelled(rel: string): Promise<string | null>;
  /**
   * Write `bytes` at `rel` only if what is there now has sha1 `expect` (hex), or — `expect` `null` —
   * only if nothing is there. Folders are made as needed. `false`, writing nothing, when the
   * condition does not hold. Atomic: a temp file beside it, then a rename.
   */
  writeIf(rel: string, bytes: Uint8Array, expect: string | null): Promise<boolean>;
  /**
   * Remove the file at `rel` only if its sha1 is `expect`. The folder it was in stays, even empty:
   * a folder somebody emptied is still a folder on their screen, and syncs as a `dir` from there.
   */
  removeIf(rel: string, expect: string): Promise<boolean>;
  /** Make a folder (and its parents). */
  mkdir(rel: string): Promise<void>;
  /** Remove a folder if it is empty; `false` when it is not, or is not there. */
  rmdirIfEmpty(rel: string): Promise<boolean>;
  /**
   * Every path the watcher reports under the vault — documents, attachments, `.anydag/` — before any
   * filtering by kind, batched as the watcher batches them. Unchanged writes report nothing.
   */
  watch(on: (rels: string[]) => void): Promise<() => void>;
  /** The created instant the app's index holds for a document at `rel`, or `null`. */
  createdOf(rel: string): string | null;
  /** Give the document sync is about to create at `rel` this created instant, before it exists. */
  adoptCreated(rel: string, created: string): void;
}

/** What the page and the CLI learn about one linked vault (`GET /api/sync`). */
export interface SyncStatus {
  vault: string;
  linked: boolean;
  state: "idle" | "syncing" | "offline" | "paused" | "error" | "unlinked";
  /** Why, when `paused` or `error`: a revoked device, out of quota, a key that will not open. */
  reason: string | null;
  server: string | null;
  remote: string | null;
  device: string | null;
  /** Paths changed here and not yet committed. */
  pending: number;
  /** Conflict copies written by this device and still on disk. */
  conflicts: string[];
  /** The last time a pull and a push both finished. */
  last: string | null;
}

// -- `/api/sync`: the app's own routes, which the page, the CLI and MCP call ---------------------
//
// Every route is the current vault's (`?vault=`, as every route is). A failure is the app's usual
// `{error}` with a status; a sync server's refusal keeps its `ES_*` in `code` beside the sentence.
// The change feed says `dag:vault-sync` with a `SyncStatus` whenever one changes — **not** `dag:sync`,
// which is the old preference-sync key (`src/settings/prefs.ts`, `e2e/global-setup.ts`).

/** `POST /api/sync/pair` — a server and its one-time code. Answers `SyncPaired`. */
export interface SyncPairRequest {
  server: string;
  code: string;
  /** What this device is called on the server; the machine's host name when absent. */
  device?: string;
}
export interface SyncPaired {
  server: string;
  account: string;
  device: string;
}

/** One remote vault the paired account holds (`GET /api/sync/remotes`). Its name is sealed. */
export interface SyncRemote {
  id: string;
  created: string;
  /** Changes committed so far: an empty remote is 0. */
  seq: number;
  keyed: boolean;
  /** The current vault's own remote (same id). */
  mine: boolean;
}
export interface SyncRemotes {
  remotes: SyncRemote[];
}

/**
 * `POST /api/sync/link`. `upload`: a new remote under this vault's id, a new vault key, sealed under
 * `passphrase` and a recovery code, every file pushed — answers the recovery code, **once**.
 * `download`: this vault must hold no document; it adopts `remote`'s id and pulls every head.
 * `merge`: a non-empty vault onto `remote`, by path, anything differing a conflict copy.
 * `download` and `merge` open the key with `passphrase` or `recovery`.
 */
export type SyncLinkRequest =
  | { mode: "upload"; passphrase: string }
  | { mode: "download" | "merge"; remote: string; passphrase?: string; recovery?: string };
export interface SyncLinked {
  status: SyncStatus;
  /** `upload` only: the recovery code, shown once and kept nowhere. */
  recovery?: string;
  /** `download` re-keys the vault: the page reloads onto `?vault=<this>`. */
  vault: string;
}

/** `GET /api/sync/devices`; `POST /api/sync/devices/revoke {id}` answers the same list. */
export interface SyncDevices {
  devices: {
    id: string;
    name: string;
    platform: string;
    created: string;
    seen: string | null;
    revoked: string | null;
    me: boolean;
  }[];
}

// `GET /api/sync` → SyncStatus · `POST /api/sync/now` → SyncStatus once a pull and a push finished ·
// `POST /api/sync/unlink` → SyncStatus (`unlinked`; the vault, its files and the remote are kept;
// the token, the vault key at rest and the state are forgotten).
