/**
 * The sync protocol's wire format: every request and answer `anydag-api` (`api/server/`) and the
 * app's sync client (`server/sync/`) exchange. **Frozen**: a
 * change here is a change to both halves in one commit, and `PROTOCOL` moves with a change that an
 * older peer would misread.
 *
 * Plain TypeScript, no imports: the server, the client and the tests all take it verbatim.
 *
 * Everything the server stores about a vault's contents is opaque to it: a `key` is an HMAC of a
 * path, a blob id an HMAC of the bytes, a `meta` and a vault's `name` are sealed (`crypto.ts`). All
 * of them travel as base64url strings.
 */

export const PROTOCOL = 1;

// -- errors --------------------------------------------------------------------------------------

/** Branch on the code; the message is for a person. */
export type ErrorCode =
  /** No token, an unknown one, or a revoked device's. 401. */
  | "ES_AUTH"
  /** A token that is good, asking for another account's vault, or an admin route without the admin token. 403. */
  | "ES_FORBIDDEN"
  /** No such vault, blob, device or account. 404. */
  | "ES_NOT_FOUND"
  /** A body or query that does not have the shape this file says. 400. */
  | "ES_BAD_REQUEST"
  /** A commit whose `parent` is not that key's head: nothing was written. 409, `conflicts`. */
  | "ES_STALE"
  /** A commit naming a blob the server does not hold: upload first. 422, `missing`. */
  | "ES_NO_BLOB"
  /** Over the plan: storage, a file's size, or the number of devices. 413. */
  | "ES_QUOTA"
  /** A cursor older than the compaction horizon: read the heads instead. 410, `horizon`. */
  | "ES_HORIZON"
  /** A pairing code that is unknown, used or expired. 400. */
  | "ES_PAIR"
  /** A vault key that is already set, or a `PUT` whose `etag` is not the current one. 409. */
  | "ES_KEY_SET";

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  /** `ES_STALE`: every key whose parent was wrong, with its head. */
  conflicts?: StaleKey[];
  /** `ES_NO_BLOB`: the blob ids the server lacks. */
  missing?: string[];
  /** `ES_HORIZON`: the lowest `seq` still in the log. */
  horizon?: number;
}

/** HTTP status per code — one table both halves read. */
export const STATUS: Readonly<Record<ErrorCode, number>> = {
  ES_AUTH: 401,
  ES_FORBIDDEN: 403,
  ES_NOT_FOUND: 404,
  ES_BAD_REQUEST: 400,
  ES_STALE: 409,
  ES_NO_BLOB: 422,
  ES_QUOTA: 413,
  ES_HORIZON: 410,
  ES_PAIR: 400,
  ES_KEY_SET: 409,
};

// -- health, pairing, devices ---------------------------------------------------------------------

export type Mode = "single" | "multi";

/** `GET /v1/health` — no token. */
export interface Health {
  version: string;
  protocol: number;
  mode: Mode;
}

/** `POST /v1/pair` — no token: the code is the credential. */
export interface PairRequest {
  code: string;
  device: { name: string; platform: string };
}

export interface PairResponse {
  /** 43 base64url characters; shown once, kept by the device, stored on the server as a sha256. */
  token: string;
  account: AccountRef;
  device: Device;
}

export interface AccountRef {
  id: string;
  name: string;
}

export interface Device {
  id: string;
  name: string;
  platform: string;
  created: string;
  /** The last request this device made, to the day. */
  seen: string | null;
  revoked: string | null;
  /** In `GET /v1/devices`: the device asking. */
  current?: boolean;
}

/** `GET /v1/devices`. `DELETE /v1/devices/{id}` answers `{ ok: true }`. */
export interface DevicesResponse {
  devices: Device[];
}

// -- vaults and their key -------------------------------------------------------------------------

/** A remote vault. Its `name` is sealed under the vault's own key, so a device lists names it can open. */
export interface RemoteVault {
  id: string;
  /** Sealed (`sealText(enc, "vault-name", …)`), base64url. */
  name: string;
  /** The last `seq` assigned: 0 for a vault nothing was committed to. */
  seq: number;
  created: string;
  /** Whether `PUT …/key` has been made: a vault with no key is one an upload never finished. */
  keyed: boolean;
}

/** `GET /v1/vaults`. */
export interface VaultsResponse {
  vaults: RemoteVault[];
}

/** `POST /v1/vaults` → `RemoteVault`. The id is the server's (10 Crockford base32, as a vault's own). */
export interface CreateVault {
  name: string;
  /** Optional: the id the device's own `vault.json` already has, kept when free on the server. */
  id?: string;
}

export type KdfParams =
  | { kdf: "argon2id"; m: number; t: number; p: number; salt: string }
  | { kdf: "scrypt"; N: number; r: number; p: number; salt: string };

/** `GET /v1/vaults/{v}/key` (404 `ES_NOT_FOUND` when unset). */
export interface VaultKey {
  /** The vault key sealed under the passphrase's key. */
  wrapped: string;
  /** The vault key sealed under the recovery key. */
  recovery: string;
  params: KdfParams;
  etag: string;
}

/** `PUT /v1/vaults/{v}/key` — refused `ES_KEY_SET` when a key exists and `etag` is not its current one. */
export interface PutVaultKey {
  wrapped: string;
  recovery: string;
  params: KdfParams;
  etag?: string;
}

// -- blobs ----------------------------------------------------------------------------------------

/*
 * `HEAD /v1/vaults/{v}/blobs/{id}`: 200 with `Content-Length`, or 404.
 * `PUT  /v1/vaults/{v}/blobs/{id}`: the sealed bytes as the body (`application/octet-stream`),
 *   `Content-Length` required; answers `{ ok: true, size }`. Idempotent: a second PUT of an id it
 *   holds reads nothing more than it must and answers the same.
 * `GET  /v1/vaults/{v}/blobs/{id}`: the sealed bytes.
 */

/** A blob id: 43 base64url characters (an HMAC-SHA256). */
export const BLOB_ID = /^[A-Za-z0-9_-]{43}$/;

// -- the log --------------------------------------------------------------------------------------

/** One change in a commit. */
export interface Change {
  key: string;
  /**
   * The `seq` of the head this change was based on — a delete's head too, which is a head like any
   * other — or `null` for "this key has never had a head". The commit is refused whole unless every
   * parent is right. (A delete's head accepting `null` would let two devices re-create one path after
   * it and the second silently replace the first.)
   */
  parent: number | null;
  /** The new content's blob, or `null` for a delete. */
  blob: string | null;
  /** `Meta`, sealed with the key as associated data (`sealMeta`). Carried on a delete too. */
  meta: string;
}

/** The answer to `POST /v1/vaults/{v}/commit`, whose body is `{ changes: Change[] }`: the `seq` given to each change, in order. */
export interface CommitResponse {
  seqs: number[];
}

/** In `ES_STALE`: where a key's head really is. */
export interface StaleKey {
  key: string;
  /** The head's `seq`, `null` when the key has never existed. */
  head: number | null;
  /** The head's blob, `null` when it is a delete or there is none. */
  blob: string | null;
}

/** A row of the log as it is read back. */
export interface LogEntry {
  seq: number;
  key: string;
  parent: number | null;
  blob: string | null;
  /** The sealed blob's size in bytes, 0 for a delete. */
  size: number;
  meta: string;
  /** The device that committed it: a client skips its own. */
  device: string;
  at: string;
}

/** `GET /v1/vaults/{v}/changes?since=<seq>&limit=<n>` — entries with `seq > since`, ascending. */
export interface ChangesResponse {
  changes: LogEntry[];
  /** The cursor to ask with next: the last `seq` returned, or `since` when none was. */
  next: number;
  /** Whether more entries are waiting past `next`. */
  more: boolean;
  /** The vault's last `seq`. */
  head: number;
  horizon: number;
}

/** A key's current state. */
export interface Head {
  key: string;
  seq: number;
  blob: string | null;
  size: number;
  meta: string;
}

/**
 * `GET /v1/vaults/{v}/heads?after=<key>&limit=<n>` — every head, deletes included, in key order.
 * `seq` is the vault's last `seq` when the page was read: a device that reads every page and then
 * pulls `changes?since=<the first page's seq>` has missed nothing.
 */
export interface HeadsResponse {
  heads: Head[];
  /** The `after` to ask with next, `null` on the last page. */
  next: string | null;
  seq: number;
}

/* `GET /v1/vaults/{v}/poke` is `text/event-stream`: `data: {"seq":N}` per commit, `: ping` every 20 s. */

/** `POST /v1/vaults/{v}/report` — counts a client saw, for the usage ledger only. */
export interface Report {
  /** Conflict copies written. */
  copied: number;
  /** Three-way merges that succeeded. */
  merged: number;
}

// -- the account, plans and usage -----------------------------------------------------------------

/** Every limit `null` is unlimited, which is the default plan (`free`) and every plan until somebody sets one. */
export interface Plan {
  id: string;
  storage_bytes: number | null;
  history_days: number | null;
  max_file_bytes: number | null;
  devices: number | null;
}

/** `GET /v1/account`. */
export interface AccountInfo {
  id: string;
  name: string;
  plan: Plan;
  used: { storage_live: number; storage_history: number; devices: number; vaults: number };
}

/** The metrics the ledger counts. */
export const METRICS = [
  "bytes_up",
  "bytes_down",
  "commits",
  "changes",
  "conflicts_stale",
  "conflicts_copied",
  "merged",
  "devices_active",
  "storage_live",
  "storage_history",
  "blobs",
  "files",
] as const;
export type Metric = (typeof METRICS)[number];

/**
 * Bumped (added to) as the server works, versus snapshot (replaced) by the collector. A snapshot
 * metric's value for a day is the last one written that day.
 */
export const SNAPSHOT_METRICS: ReadonlySet<Metric> = new Set(["storage_live", "storage_history", "blobs", "files"]);

export interface UsageRow {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  account: string;
  /** `null` for an account-wide figure (`devices_active`). */
  vault: string | null;
  metric: Metric;
  value: number;
}

// -- admin (the `anydag-api` CLI against a running server; `Authorization: Bearer <admin token>`) --

/** `GET /v1/admin/accounts` → `{ accounts }`; `POST` `{ name, plan? }` → `AdminAccount`. */
export interface AdminAccount {
  id: string;
  name: string;
  plan: string;
  created: string;
  devices: number;
  vaults: number;
}

/** `POST /v1/admin/pair` `{ account }` → a code a device exchanges at `/v1/pair`. */
export interface AdminPair {
  code: string;
  expires: string;
  /** `ANYDAG_SYNC_PUBLIC_URL`, so a person can be handed one line. */
  url: string;
}

/** `PUT /v1/admin/plans/{id}` `Plan`; `POST /v1/admin/accounts/{id}/plan` `{ plan }`. */

/** `GET /v1/admin/usage?account=&since=&until=` → `{ usage: UsageRow[] }`. */
export interface UsageResponse {
  usage: UsageRow[];
}

/** `POST /v1/admin/gc` → what the collector did. */
export interface GcResult {
  compacted: number;
  blobs: number;
  bytes: number;
}

// -- limits shared by both halves -----------------------------------------------------------------

/** Most changes in one commit; a client with more sends several. */
export const MAX_CHANGES = 1000;
/** Most rows a `changes` or `heads` page holds. */
export const MAX_PAGE = 1000;
/** A pairing code's life. */
export const PAIR_MINUTES = 15;
