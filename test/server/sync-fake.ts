/**
 * An in-memory `anydag-sync` for the sync client's tests: one account, one vault, the commit rules
 * exactly as `wire.ts` states them — every parent the key's head's seq, a delete's
 * head included (`null` only when there is none), all or nothing, a blob uploaded before the commit that names it,
 * `seq` gapless — with the log and the heads paged, and a horizon that can be raised to force
 * `ES_HORIZON`. Each device talks to it through `as(deviceId)`, which is what fills a log entry's
 * `device`.
 */

import type {
  AccountInfo,
  Change,
  ChangesResponse,
  CommitResponse,
  CreateVault,
  DevicesResponse,
  ErrorBody,
  ErrorCode,
  Head,
  HeadsResponse,
  Health,
  LogEntry,
  PairRequest,
  PairResponse,
  PutVaultKey,
  RemoteVault,
  Report,
  StaleKey,
  VaultKey,
  VaultsResponse,
} from "../../api/protocol/wire";
import { MAX_CHANGES, MAX_PAGE, PROTOCOL, STATUS } from "../../api/protocol/wire";
import { SyncError, type SyncApi } from "../../server/sync/client";

const fail = (code: ErrorCode, message: string, extra: Partial<ErrorBody> = {}): never => {
  throw new SyncError(STATUS[code], code, message, { code, message, ...extra });
};

export class FakeServer {
  readonly vault = "vault00001";
  readonly blobs = new Map<string, Uint8Array>();
  readonly log: LogEntry[] = [];
  readonly heads = new Map<string, Head>();
  readonly reports: Report[] = [];
  /** Commits accepted, per device. */
  readonly commits = new Map<string, number>();
  /** Every commit asked for, refused ones included. */
  commitCalls = 0;
  seq = 0;
  /** The lowest `seq` still in the log; a cursor below `horizon - 1` is refused `ES_HORIZON`. */
  horizon = 1;
  private key: VaultKey | null = null;

  committed(device?: string): number {
    if (device) return this.commits.get(device) ?? 0;
    let n = 0;
    for (const v of this.commits.values()) n += v;
    return n;
  }

  /** Forget every log row: the heads stay, and a cursor short of the head must resync. */
  compact(): void {
    this.log.length = 0;
    this.horizon = this.seq + 1;
  }

  private checkVault(v: string): void {
    if (v !== this.vault) fail("ES_NOT_FOUND", `no vault ${v}`);
  }

  commit(device: string, v: string, changes: Change[]): CommitResponse {
    this.checkVault(v);
    this.commitCalls++;
    if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_CHANGES) fail("ES_BAD_REQUEST", "changes");
    const keys = new Set<string>();
    for (const c of changes) {
      if (keys.has(c.key)) fail("ES_BAD_REQUEST", `key ${c.key} twice in one commit`);
      keys.add(c.key);
    }
    const stale: StaleKey[] = [];
    for (const c of changes) {
      const head = this.heads.get(c.key);
      const ok = head !== undefined ? c.parent === head.seq : c.parent === null;
      if (!ok) stale.push({ key: c.key, head: head?.seq ?? null, blob: head?.blob ?? null });
    }
    if (stale.length) fail("ES_STALE", "a parent is not its key's head", { conflicts: stale });
    const missing = changes.flatMap((c) => (c.blob !== null && !this.blobs.has(c.blob) ? [c.blob] : []));
    if (missing.length) fail("ES_NO_BLOB", "upload first", { missing });

    const seqs: number[] = [];
    const at = new Date().toISOString();
    for (const c of changes) {
      const seq = ++this.seq;
      const size = c.blob ? this.blobs.get(c.blob)!.byteLength : 0;
      this.log.push({ seq, key: c.key, parent: c.parent, blob: c.blob, size, meta: c.meta, device, at });
      this.heads.set(c.key, { key: c.key, seq, blob: c.blob, size, meta: c.meta });
      seqs.push(seq);
    }
    this.commits.set(device, (this.commits.get(device) ?? 0) + 1);
    return { seqs };
  }

  changes(v: string, since: number, limit = MAX_PAGE): ChangesResponse {
    this.checkVault(v);
    if (since < this.horizon - 1) fail("ES_HORIZON", "cursor past the horizon", { horizon: this.horizon });
    const after = this.log.filter((e) => e.seq > since);
    const page = after.slice(0, limit);
    return {
      changes: page.map((e) => ({ ...e })),
      next: page.length ? page[page.length - 1]!.seq : since,
      more: after.length > page.length,
      head: this.seq,
      horizon: this.horizon,
    };
  }

  headsPage(v: string, after = "", limit = MAX_PAGE): HeadsResponse {
    this.checkVault(v);
    const all = [...this.heads.values()]
      .filter((h) => h.key > after)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const page = all.slice(0, limit);
    return {
      heads: page.map((h) => ({ ...h })),
      next: all.length > page.length ? page[page.length - 1]!.key : null,
      seq: this.seq,
    };
  }

  /** One device's view of this server. */
  as(device: string): SyncApi {
    const self = this;
    const vaultRow = (): RemoteVault => ({
      id: self.vault,
      name: "sealed",
      seq: self.seq,
      created: "2026-11-06T00:00:00.000Z",
      keyed: self.key !== null,
    });
    return {
      async health(): Promise<Health> {
        return { version: "test", protocol: PROTOCOL, mode: "single" };
      },
      async pair(_req: PairRequest): Promise<PairResponse> {
        return fail("ES_PAIR", "the fake pairs nobody");
      },
      async devices(): Promise<DevicesResponse> {
        return { devices: [] };
      },
      async revokeDevice(): Promise<void> {},
      async vaults(): Promise<VaultsResponse> {
        return { vaults: [vaultRow()] };
      },
      async createVault(_body: CreateVault): Promise<RemoteVault> {
        return vaultRow();
      },
      async getKey(v: string): Promise<VaultKey | null> {
        self.checkVault(v);
        return self.key;
      },
      async putKey(v: string, body: PutVaultKey): Promise<VaultKey> {
        self.checkVault(v);
        if (self.key && body.etag !== self.key.etag) fail("ES_KEY_SET", "a key is set");
        self.key = { wrapped: body.wrapped, recovery: body.recovery, params: body.params, etag: String(Date.now()) };
        return self.key;
      },
      async hasBlob(v: string, id: string): Promise<number | null> {
        self.checkVault(v);
        return self.blobs.get(id)?.byteLength ?? null;
      },
      async putBlob(v: string, id: string, bytes: Uint8Array): Promise<number> {
        self.checkVault(v);
        if (!self.blobs.has(id)) self.blobs.set(id, new Uint8Array(bytes));
        return self.blobs.get(id)!.byteLength;
      },
      async getBlob(v: string, id: string): Promise<Uint8Array> {
        self.checkVault(v);
        const b = self.blobs.get(id);
        if (!b) return fail("ES_NOT_FOUND", `no blob ${id}`);
        return new Uint8Array(b);
      },
      async commit(v: string, changes: Change[]): Promise<CommitResponse> {
        return self.commit(device, v, changes);
      },
      async changes(v: string, since: number, limit?: number): Promise<ChangesResponse> {
        return self.changes(v, since, limit);
      },
      async heads(v: string, after?: string, limit?: number): Promise<HeadsResponse> {
        return self.headsPage(v, after, limit);
      },
      async report(v: string, report: Report): Promise<void> {
        self.checkVault(v);
        self.reports.push(report);
      },
      async account(): Promise<AccountInfo> {
        return {
          id: "owner00001",
          name: "owner",
          plan: { id: "free", storage_bytes: null, history_days: null, max_file_bytes: null, devices: null },
          used: { storage_live: 0, storage_history: 0, devices: 0, vaults: 1 },
        };
      },
    };
  }
}
