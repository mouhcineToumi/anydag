/**
 * The server's state, as a port. One adapter, `pg.ts`, over a `Db` —
 * which `db.ts` gives two ways: a `pg` pool on a real Postgres, and PGlite in this process for the
 * fast tier. **Frozen**.
 *
 * Every timestamp is an ISO-8601 string in UTC; every `day` is `YYYY-MM-DD` in UTC. Ids the server
 * mints are 10 characters of Crockford base32, the app's own shape.
 */

import type { AccountRef, Device, Head, LogEntry, Metric, Plan, RemoteVault, StaleKey, UsageRow, VaultKey, PutVaultKey } from "../../protocol/wire";

/** A connection: a pool or PGlite. Parameters are `$1`, `$2`…, as Postgres spells them. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run `fn` in one transaction; a throw rolls it back and is rethrown. */
  tx<T>(fn: (q: Db) => Promise<T>): Promise<T>;
  /** Several statements with no parameters (a migration). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export interface Account extends AccountRef {
  plan: string;
  created: string;
}

/** A device as the server holds it: the wire's `Device` and whose it is. */
export interface DeviceRow extends Device {
  account: string;
}

export interface VaultRow extends RemoteVault {
  account: string;
  horizon: number;
}

/** What a commit did: the `seq` per change, or why nothing was written. */
export type CommitResult = { ok: true; seqs: number[] } | { ok: false; stale: StaleKey[] } | { ok: false; missing: string[] };

/** A commit's change once the route has checked its shape. */
export interface NewChange {
  key: string;
  parent: number | null;
  blob: string | null;
  meta: string;
}

export interface Storage {
  /** Sealed bytes of every blob a live head names. */
  live: number;
  /** Sealed bytes of every other blob still kept. */
  history: number;
  blobs: number;
  /** Heads that are not deletes. */
  files: number;
}

export interface Meta {
  /** Apply every migration not yet applied, under an advisory lock, so two servers starting at once agree. */
  migrate(): Promise<void>;
  close(): Promise<void>;

  // -- accounts and plans
  createAccount(name: string, plan?: string): Promise<Account>;
  account(id: string): Promise<Account | null>;
  accountByName(name: string): Promise<Account | null>;
  accounts(): Promise<Account[]>;
  /** The plan, or `free` (all limits null) when `id` names none. `free` always exists. */
  plan(id: string): Promise<Plan>;
  putPlan(plan: Plan): Promise<void>;
  setAccountPlan(account: string, plan: string): Promise<void>;

  // -- pairing and devices
  /** Remember a code by its sha256 hex. */
  addPairCode(account: string, codeHash: string, expires: string): Promise<void>;
  /** Use a code once: the account it pairs with, or `null` when unknown, used or expired at `now`. */
  takePairCode(codeHash: string, now: string): Promise<string | null>;
  addDevice(account: string, name: string, platform: string, tokenHash: string): Promise<DeviceRow>;
  /** A device by its token's sha256 hex — a revoked one included, so the route can say why. */
  deviceByToken(tokenHash: string): Promise<DeviceRow | null>;
  devices(account: string): Promise<DeviceRow[]>;
  /** Mark it seen on `day`; `true` when this is its first request that day (for `devices_active`). */
  touchDevice(id: string, day: string): Promise<boolean>;
  revokeDevice(account: string, id: string, at: string): Promise<boolean>;

  // -- vaults and keys
  createVault(account: string, name: string, id?: string): Promise<VaultRow>;
  vaults(account: string): Promise<VaultRow[]>;
  /** A vault of this account's, or `null` — another account's is `null` too. */
  vault(account: string, id: string): Promise<VaultRow | null>;
  getKey(vault: string): Promise<VaultKey | null>;
  /** Set the key; `false` when one is set and `put.etag` is not its etag. A new etag every write. */
  putKey(vault: string, put: PutVaultKey): Promise<VaultKey | false>;

  // -- blobs (the index; the bytes are `Blobs`')
  /**
   * Record a blob the store now holds. A second call for one id is nothing. `at` is the server's
   * clock (the route passes `deps.now()`), the clock the log's `at` and the collector's window are
   * read on; absent, the database's own `now()`.
   */
  addBlob(vault: string, id: string, size: number, at?: string): Promise<void>;
  blobSize(vault: string, id: string): Promise<number | null>;

  // -- the log
  /**
   * Accept every change or none: a change whose `parent` is not its
   * key's head's `seq` (a delete's head included; `null` only for a key with no head at all), or names a blob `addBlob` never recorded, refuses the whole commit. On success the
   * vault's `seq` moves by `changes.length`, gapless, one log row and one head per change, in order.
   * A key changed twice in one commit is refused as `ES_BAD_REQUEST` by the route, never here.
   */
  commit(vault: string, device: string, changes: NewChange[], at: string): Promise<CommitResult>;
  /** Log rows with `seq > since`, ascending, at most `limit`; with the vault's head and horizon. */
  changes(vault: string, since: number, limit: number): Promise<{ changes: LogEntry[]; head: number; horizon: number }>;
  /** Heads with `key > after` (`""` for the first page), key order, at most `limit`; with the vault's seq. */
  heads(vault: string, after: string, limit: number): Promise<{ heads: Head[]; seq: number }>;

  // -- usage
  /** Add `n` to a counter, or set a snapshot metric (`SNAPSHOT_METRICS`). */
  bump(day: string, account: string, vault: string | null, metric: Metric, n: number): Promise<void>;
  usage(filter: { account?: string; since?: string; until?: string }): Promise<UsageRow[]>;
  storage(account: string, vault?: string): Promise<Storage>;

  // -- the collector
  /**
   * Drop every log row older than `before` whose key has a newer row, and every blob that no head
   * and no remaining log row names and that was added before `before`; raise the horizon to the
   * lowest remaining `seq` (or `seq + 1` when nothing remains). Answers the blob ids it forgot, so
   * the caller can delete their bytes.
   */
  collect(vault: string, before: string): Promise<{ compacted: number; blobs: { id: string; size: number }[] }>;
  allVaults(): Promise<VaultRow[]>;
}
