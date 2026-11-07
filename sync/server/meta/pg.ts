/**
 * `Meta` on Postgres — the one adapter of the port (sync/server/meta/types.ts), given its `Db` by
 * db.ts, so the same statements run against a real Postgres and against PGlite. Everything the
 * contract calls atomic lives inside ONE transaction here: a commit is refused whole or written
 * whole, the vault's `seq` only ever moves by the commit that landed, and the collector raises the
 * horizon in the same transaction that forgets. All of the arithmetic is in the SQL — one statement
 * deciding under a lock is the contract, not a re-stage in JavaScript.
 *
 * Ids are the app's (ten characters of Crockford base32, `mint` from the app's own module); a key's
 * etag is 16 random bytes base64url, new on every write; the ledger's vault column is `''` for what
 * the port calls `null`. The order of a commit's checks is the plan's: stale first, missing blobs
 * second, writes last.
 */
import { randomBytes } from "node:crypto";

import { mint, validId } from "../../../server/ids";
import type { Head, KdfParams, LogEntry, Metric, Plan, PutVaultKey, StaleKey, UsageRow, VaultKey } from "../../protocol/wire";
import { SNAPSHOT_METRICS } from "../../protocol/wire";
import { MIGRATIONS } from "./migrations";
import type { Account, CommitResult, Db, DeviceRow, Meta, NewChange, Storage, VaultRow } from "./types";

type Row = Record<string, unknown>;

// -- the port's row shapes, read off the adapters' normalised values --------------------------------

const accountOf = (r: Row): Account => ({
  id: String(r.id),
  name: String(r.name),
  plan: String(r.plan),
  created: String(r.created),
});

const planOf = (r: Row): Plan => ({
  id: String(r.id),
  storage_bytes: (r.storage_bytes as number | null) ?? null,
  history_days: (r.history_days as number | null) ?? null,
  max_file_bytes: (r.max_file_bytes as number | null) ?? null,
  devices: (r.devices as number | null) ?? null,
});

/** The plan the port answers for anything `plans(id)` does not have: unlimited, always there. */
const FREE: Plan = { id: "free", storage_bytes: null, history_days: null, max_file_bytes: null, devices: null };

const vaultOf = (r: Row): VaultRow => ({
  id: String(r.id),
  name: String(r.name),
  seq: Number(r.seq),
  horizon: Number(r.horizon),
  created: String(r.created),
  keyed: r.keyed === true,
  account: String(r.account),
});

const deviceOf = (r: Row): DeviceRow => ({
  id: String(r.id),
  account: String(r.account),
  name: String(r.name),
  platform: String(r.platform),
  created: String(r.created),
  seen: (r.seen as string | null) ?? null,
  revoked: (r.revoked as string | null) ?? null,
});

const keyOf = (r: Row): VaultKey => ({
  wrapped: String(r.wrapped),
  recovery: String(r.recovery),
  params: typeof r.params === "string" ? (JSON.parse(r.params) as KdfParams) : (r.params as KdfParams),
  etag: String(r.etag),
});

const logOf = (r: Row): LogEntry => ({
  seq: Number(r.seq),
  key: String(r.key),
  parent: (r.parent as number | null) ?? null,
  blob: (r.blob as string | null) ?? null,
  size: Number(r.size),
  meta: String(r.meta),
  device: String(r.device),
  at: String(r.at),
});

const headOf = (r: Row): Head => ({
  key: String(r.key),
  seq: Number(r.seq),
  blob: (r.blob as string | null) ?? null,
  size: Number(r.size),
  meta: String(r.meta),
});

const usageOf = (r: Row): UsageRow => ({
  day: String(r.day),
  account: String(r.account),
  /** The row's `''` is the ledger's account-wide figure; the port says `null`. */
  vault: r.vault === "" || r.vault === null ? null : String(r.vault),
  metric: String(r.metric) as Metric,
  value: Number(r.value),
});

/** `mint` checks a synchronous `taken`; ours is one query per loop, and the shape stays the app's. */
const mintFor = async (free: (id: string) => Promise<boolean>): Promise<string> => {
  for (;;) {
    const id = mint(() => false);
    if (await free(id)) return id;
  }
};

const idFree = async (db: Db, table: "accounts" | "vaults" | "devices", id: string): Promise<boolean> =>
  (await db.query(`select id from ${table} where id = $1`, [id])).length === 0;

const ATTACH_LOCK = "select pg_advisory_xact_lock(hashtext('anydag-sync-migrate'))";

export class PgMeta implements Meta {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  // -- migrations -----------------------------------------------------------------------------------

  /**
   * The migrate lock (`pg_advisory_xact_lock`) lives only for its transaction, so every transaction
   * that decides anything below takes it and re-checks inside it: two servers starting at once
   * serialise, and the one that recorded `001` last waits for the other rather than half-copying.
   */
  async migrate(): Promise<void> {
    await this.db.tx(async (q) => {
      await q.exec(ATTACH_LOCK);
      await q.exec("create table if not exists schema_migrations (name text primary key, at timestamptz not null default now())");
    });
    for (const migration of MIGRATIONS) {
      await this.db.tx(async (q) => {
        await q.exec(ATTACH_LOCK);
        const applied = await q.query("select name from schema_migrations where name = $1", [migration.name]);
        if (applied.length > 0) return;
        await q.exec(migration.sql);
        await q.query("insert into schema_migrations (name) values ($1)", [migration.name]);
      });
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  // -- accounts and plans ---------------------------------------------------------------------------

  async createAccount(name: string, plan = "free"): Promise<Account> {
    const id = await mintFor((id) => idFree(this.db, "accounts", id));
    const rows = await this.db.query(
      "insert into accounts (id, name, plan) values ($1, $2, $3) returning id, name, plan, created",
      [id, name, plan],
    );
    return accountOf(rows[0]!);
  }

  async account(id: string): Promise<Account | null> {
    const rows = await this.db.query("select id, name, plan, created from accounts where id = $1", [id]);
    return rows.length === 0 ? null : accountOf(rows[0]!);
  }

  async accountByName(name: string): Promise<Account | null> {
    const rows = await this.db.query("select id, name, plan, created from accounts where name = $1", [name]);
    return rows.length === 0 ? null : accountOf(rows[0]!);
  }

  async accounts(): Promise<Account[]> {
    const rows = await this.db.query("select id, name, plan, created from accounts order by name");
    return rows.map(accountOf);
  }

  /** The plan asked for, or `free` when `plans(id)` has nothing — every limit null is unlimited. */
  async plan(id: string): Promise<Plan> {
    const rows = await this.db.query(
      "select id, storage_bytes, history_days, max_file_bytes, devices from plans where id = $1",
      [id],
    );
    if (rows.length > 0) return planOf(rows[0]!);
    const free = await this.db.query(
      "select id, storage_bytes, history_days, max_file_bytes, devices from plans where id = 'free'",
    );
    return free.length === 0 ? { ...FREE } : planOf(free[0]!);
  }

  async putPlan(plan: Plan): Promise<void> {
    await this.db.query(
      `insert into plans (id, storage_bytes, history_days, max_file_bytes, devices)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update
         set storage_bytes = excluded.storage_bytes,
             history_days = excluded.history_days,
             max_file_bytes = excluded.max_file_bytes,
             devices = excluded.devices`,
      [plan.id, plan.storage_bytes, plan.history_days, plan.max_file_bytes, plan.devices],
    );
  }

  async setAccountPlan(account: string, plan: string): Promise<void> {
    // A plan `plans` does not have is the key check's answer (a foreign key), not a silent default.
    await this.db.query("update accounts set plan = $2 where id = $1", [account, plan]);
  }

  // -- pairing and devices --------------------------------------------------------------------------

  async addPairCode(account: string, codeHash: string, expires: string): Promise<void> {
    await this.db.query(
      "insert into pair_codes (code_sha256, account, expires) values ($1, $2, $3::timestamptz)",
      [codeHash, account, expires],
    );
  }

  /** One code, one use: claiming sets `used` and a second claimer finds it gone. */
  async takePairCode(codeHash: string, now: string): Promise<string | null> {
    const rows = await this.db.query<{ account: string }>(
      `update pair_codes set used = $2::timestamptz
        where code_sha256 = $1 and used is null and expires > $2::timestamptz
        returning account`,
      [codeHash, now],
    );
    return rows.length === 0 ? null : String(rows[0]!.account);
  }

  async addDevice(account: string, name: string, platform: string, tokenHash: string): Promise<DeviceRow> {
    const id = await mintFor((id) => idFree(this.db, "devices", id));
    const rows = await this.db.query(
      "insert into devices (id, account, name, platform, token_sha256) values ($1, $2, $3, $4, $5) returning id, account, name, platform, created",
      [id, account, name, platform, tokenHash],
    );
    return deviceOf({ ...rows[0]!, seen: null, revoked: null });
  }

  /** A revoked device is still a device: the route reads `revoked` to say exactly why it refused. */
  async deviceByToken(tokenHash: string): Promise<DeviceRow | null> {
    const rows = await this.db.query(
      "select id, account, name, platform, created, seen, revoked from devices where token_sha256 = $1",
      [tokenHash],
    );
    return rows.length === 0 ? null : deviceOf(rows[0]!);
  }

  async devices(account: string): Promise<DeviceRow[]> {
    const rows = await this.db.query(
      "select id, account, name, platform, created, seen, revoked from devices where account = $1 order by created, id",
      [account],
    );
    return rows.map(deviceOf);
  }

  /** The day is what the ledger counts, and the flag is the first request of that day. */
  async touchDevice(id: string, day: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      "update devices set seen = $2::date where id = $1 and seen is distinct from $2::date returning id",
      [id, day],
    );
    return rows.length > 0;
  }

  async revokeDevice(account: string, id: string, at: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      "update devices set revoked = $3::timestamptz where account = $1 and id = $2 and revoked is null returning id",
      [account, id, at],
    );
    return rows.length > 0;
  }

  // -- vaults and keys ------------------------------------------------------------------------------

  /**
   * A vault handed an id keeps it when the id is the app's shape and free; otherwise it is minted.
   * **An unfinished upload is taken up again**: an id that names this account's own vault with no key
   * and nothing committed — a create whose key never arrived — is that vault, its sealed name
   * replaced (it was sealed under a vault key nobody kept). Without this every failed upload left a
   * remote nobody could open, and the retry made a second one under a new id.
   */
  async createVault(account: string, name: string, id?: string): Promise<VaultRow> {
    if (id !== undefined && validId(id)) {
      const again = await this.db.query(
        `update vaults v set name_sealed = $3 where v.id = $1 and v.account = $2 and v.seq = 0
           and not exists (select 1 from vault_keys k where k.vault = v.id)
         returning ${VAULT_COLUMNS}`,
        [id, account, name],
      );
      if (again.length > 0) return vaultOf(again[0]!);
    }
    let chosen: string | null = null;
    if (id !== undefined && validId(id)) {
      const taken = await this.db.query("select id from vaults where id = $1", [id]);
      if (taken.length === 0) chosen = id;
    }
    const real = chosen ?? (await mintFor((x) => idFree(this.db, "vaults", x)));
    const rows = await this.db.query(
      "insert into vaults (id, account, name_sealed) values ($1, $2, $3) returning id, account, name_sealed, seq, horizon, created",
      [real, account, name],
    );
    // A fresh vault cannot have a key: `createVault` only writes rows the check above made free.
    return vaultOf({ ...rows[0]!, name: rows[0]!.name_sealed, keyed: false });
  }

  async vaults(account: string): Promise<VaultRow[]> {
    const rows = await this.db.query(VAULT_SELECT_BY, [account]);
    return rows.map(vaultOf);
  }

  /** Another account's vault is not this account's vault: it answers `null`, and nothing more. */
  async vault(account: string, id: string): Promise<VaultRow | null> {
    const rows = await this.db.query(`select ${VAULT_COLUMNS} from vaults v where v.account = $1 and v.id = $2`, [account, id]);
    return rows.length === 0 ? null : vaultOf(rows[0]!);
  }

  async allVaults(): Promise<VaultRow[]> {
    const rows = await this.db.query(VAULT_SELECT_ALL);
    return rows.map(vaultOf);
  }

  async getKey(vault: string): Promise<VaultKey | null> {
    const rows = await this.db.query("select wrapped, recovery, params, etag from vault_keys where vault = $1", [vault]);
    return rows.length === 0 ? null : keyOf(rows[0]!);
  }

  /** Setting while none is set is free; replacing takes the current etag, and a fresh one is minted
   * on every write, so a device that read a key before the change cannot pretend it did not. */
  async putKey(vault: string, put: PutVaultKey): Promise<VaultKey | false> {
    const etag = randomBytes(16).toString("base64url");
    const current = await this.db.query("select etag from vault_keys where vault = $1", [vault]);
    if (current.length > 0 && put.etag !== current[0]!.etag) return false;
    if (current.length === 0) {
      await this.db.query(
        "insert into vault_keys (vault, wrapped, recovery, params, etag) values ($1, $2, $3, $4::jsonb, $5)",
        [vault, put.wrapped, put.recovery, put.params, etag],
      );
    } else {
      await this.db.query(
        "update vault_keys set wrapped = $2, recovery = $3, params = $4::jsonb, etag = $5 where vault = $1",
        [vault, put.wrapped, put.recovery, put.params, etag],
      );
    }
    return { wrapped: put.wrapped, recovery: put.recovery, params: put.params, etag };
  }

  // -- blobs (the index; the bytes are `Blobs`') ----------------------------------------------------

  /** Two devices uploading one id race harmlessly: the first row stands, the second is nothing. */
  async addBlob(vault: string, id: string, size: number): Promise<void> {
    await this.db.query(
      "insert into blobs (vault, id, size) values ($1, $2, $3) on conflict (vault, id) do nothing",
      [vault, id, size],
    );
  }

  async blobSize(vault: string, id: string): Promise<number | null> {
    const rows = await this.db.query<{ size: number }>("select size from blobs where vault = $1 and id = $2", [vault, id]);
    return rows.length === 0 ? null : Number(rows[0]!.size);
  }

  // -- the log --------------------------------------------------------------------------------------

  /**
   * The row lock on `vaults` is what serialises commits to one vault, so the head checks below see
   * one truth each. Every refusing key is collected — the caller answers each conflict once — and
   * only when none refuses does anything get written: stale first, then blobs it would name that
   * `addBlob` never took, then the seqs, one log row and one head per change.
   */
  async commit(vault: string, device: string, changes: NewChange[], at: string): Promise<CommitResult> {
    return this.db.tx(async (q) => {
      const open = await q.query<{ seq: number }>("select seq from vaults where id = $1 for update", [vault]);
      if (open.length === 0) throw new Error(`no vault ${vault}`);
      if (changes.length === 0) return { ok: true, seqs: [] };

      // A key with a head is based on that head's seq — a delete's head included, since a delete is
      // not an absence: accepting `null` over one would let two devices re-create a path and the
      // second silently replace the first. `null` is only ever a key with no head at all.
      const stale: StaleKey[] = [];
      for (const change of changes) {
        const rows = await q.query<{ seq: number; blob: string | null }>(
          "select seq, blob from heads where vault = $1 and key = $2",
          [vault, change.key],
        );
        const head = rows.length === 0 ? null : rows[0]!;
        const based = head === null
          ? change.parent === null
          : change.parent === head.seq;
        if (!based) stale.push({ key: change.key, head: head === null ? null : Number(head.seq), blob: (head?.blob as string | null) ?? null });
      }
      if (stale.length > 0) return { ok: false, stale };

      // Every blob a change names must be uploaded first (blobs before the commit that names them).
      const sizeOf = new Map<string, number>();
      const missing: string[] = [];
      for (const change of changes) {
        if (change.blob === null || missing.includes(change.blob) || sizeOf.has(change.blob)) continue;
        const rows = await q.query<{ size: number }>("select size from blobs where vault = $1 and id = $2", [
          vault,
          change.blob,
        ]);
        if (rows.length === 0) missing.push(change.blob);
        else sizeOf.set(change.blob, Number(rows[0]!.size));
      }
      if (missing.length > 0) return { ok: false, missing };

      // `for update` above holds the row: seq + n lands whole, and the last seq answers after it.
      const landed = await q.query<{ seq: number }>(
        "update vaults set seq = seq + $2 where id = $1 returning seq",
        [vault, changes.length],
      );
      const last = Number(landed[0]!.seq);
      const seqs: number[] = [];
      for (let i = 0; i < changes.length; i += 1) {
        const seq = last - changes.length + i + 1;
        const change = changes[i]!;
        const size = change.blob === null ? 0 : sizeOf.get(change.blob)!;
        await q.query(
          `insert into log (vault, seq, key, parent, blob, size, meta_sealed, device, at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)`,
          [vault, seq, change.key, change.parent, change.blob, size, change.meta, device, at],
        );
        await q.query(
          `insert into heads (vault, key, seq, blob, size, meta_sealed)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (vault, key) do update
             set seq = excluded.seq, blob = excluded.blob, size = excluded.size, meta_sealed = excluded.meta_sealed`,
          [vault, change.key, seq, change.blob, size, change.meta],
        );
        seqs.push(seq);
      }
      return { ok: true, seqs };
    });
  }

  /** The log after a cursor, and the head and horizon that cursor is judged against, in one read. */
  async changes(vault: string, since: number, limit: number): Promise<{ changes: LogEntry[]; head: number; horizon: number }> {
    return this.db.tx(async (q) => {
      const rows = await q.query(
        "select seq, key, parent, blob, size, meta_sealed as meta, device, at from log where vault = $1 and seq > $2 order by seq limit $3",
        [vault, since, limit],
      );
      const state = await q.query<{ seq: number; horizon: number }>("select seq, horizon from vaults where id = $1", [vault]);
      if (state.length === 0) throw new Error(`no vault ${vault}`);
      return { changes: rows.map(logOf), head: Number(state[0]!.seq), horizon: Number(state[0]!.horizon) };
    });
  }

  /** Heads in key order, then the vault's seq; reading seq after the heads is what makes a device
   * that pages through and then pulls `changes(since=seq)` miss nothing. */
  async heads(vault: string, after: string, limit: number): Promise<{ heads: Head[]; seq: number }> {
    return this.db.tx(async (q) => {
      const rows = await q.query(
        "select key, seq, blob, size, meta_sealed as meta from heads where vault = $1 and key > $2 order by key limit $3",
        [vault, after, limit],
      );
      const state = await q.query<{ seq: number }>("select seq from vaults where id = $1", [vault]);
      if (state.length === 0) throw new Error(`no vault ${vault}`);
      return { heads: rows.map(headOf), seq: Number(state[0]!.seq) };
    });
  }

  // -- usage ----------------------------------------------------------------------------------------

  /** Counters add; the collector's snapshots (SNAPSHOT_METRICS) replace, a day holding its last. */
  async bump(day: string, account: string, vault: string | null, metric: Metric, n: number): Promise<void> {
    const conflict = SNAPSHOT_METRICS.has(metric)
      ? "do update set value = excluded.value"
      : "do update set value = usage_daily.value + excluded.value";
    await this.db.query(
      `insert into usage_daily (day, account, vault, metric, value)
       values ($1::date, $2, $3, $4, $5)
       on conflict (day, account, vault, metric) ${conflict}`,
      [day, account, vault === null ? "" : vault, metric, n],
    );
  }

  /** Inclusive on both day bounds; the account-wide rows read back as the port's `null`. */
  async usage(filter: { account?: string; since?: string; until?: string }): Promise<UsageRow[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.since !== undefined) {
      params.push(filter.since);
      clauses.push(`day >= $${params.length}::date`);
    }
    if (filter.until !== undefined) {
      params.push(filter.until);
      clauses.push(`day <= $${params.length}::date`);
    }
    if (filter.account !== undefined) {
      params.push(filter.account);
      clauses.push(`account = $${params.length}`);
    }
    const where = clauses.length === 0 ? "" : ` where ${clauses.join(" and ")}`;
    const rows = await this.db.query(
      `select day, account, vault, metric, value from usage_daily${where} order by day, account, vault, metric`,
      params,
    );
    return rows.map(usageOf);
  }

  /**
   * One statement, one snapshot: live is what a head still names (a blob named by several heads of
   * one vault is one row in `blobs`, so it is summed once), history is every other blob row, and
   * the counts ride the same scope.
   */
  async storage(account: string, vault?: string): Promise<Storage> {
    const scope = vault === undefined ? "v.account = $1" : "v.account = $1 and v.id = $2";
    const rows = await this.db.query(
      `select
         coalesce((select sum(b.size) from blobs b join vaults v on v.id = b.vault
                    where ${scope} and exists (select 1 from heads h where h.vault = b.vault and h.blob = b.id)), 0)::int8 live,
         coalesce((select sum(b.size) from blobs b join vaults v on v.id = b.vault
                    where ${scope} and not exists (select 1 from heads h where h.vault = b.vault and h.blob = b.id)), 0)::int8 history,
         coalesce((select count(*) from blobs b join vaults v on v.id = b.vault
                    where ${scope}), 0)::int8 blobs,
         coalesce((select count(*) from heads h join vaults v on v.id = h.vault
                    where ${scope} and h.blob is not null), 0)::int8 files`,
      vault === undefined ? [account] : [account, vault],
    );
    return {
      live: Number(rows[0]!.live),
      history: Number(rows[0]!.history),
      blobs: Number(rows[0]!.blobs),
      files: Number(rows[0]!.files),
    };
  }

  // -- the collector --------------------------------------------------------------------------------

  /**
   * The horizon is a promise to the devices: `changes(since=horizon-1)` sees nothing more. It is
   * raised inside the same transaction that forgets the log rows and the blobs beneath it.
   */
  async collect(vault: string, before: string): Promise<{ compacted: number; blobs: { id: string; size: number }[] }> {
    return this.db.tx(async (q) => {
      const exists = await q.query("select id from vaults where id = $1", [vault]);
      if (exists.length === 0) throw new Error(`no vault ${vault}`);

      // 1. Log rows older than `before` that are not their key's newest row. The newest row of a key
      //    is never dropped, so an offline device's head survives to be read.
      const dropped = await q.query<{ blob: string | null }>(
        `delete from log
          where vault = $1 and at < $2::timestamptz
            and exists (select 1 from log newer where newer.vault = log.vault and newer.key = log.key and newer.seq > log.seq)
          returning blob`,
        [vault, before],
      );

      // 2. Blob rows old enough that no head and no remaining log row names them. `created` keeps a
      //    blob's birth for the whole of its idempotence window, so a re-upload is still "before".
      const forgotten = await q.query<{ id: string; size: number }>(
        `delete from blobs
          where vault = $1 and created < $2::timestamptz
            and not exists (select 1 from heads h where h.vault = $1 and h.blob = blobs.id)
            and not exists (select 1 from log l where l.vault = $1 and l.blob = blobs.id)
          returning id, size`,
        [vault, before],
      );

      // 3. Nothing left in the log means no cursor older than the next seq can pull anything.
      await q.query(
        `update vaults
            set horizon = coalesce((select min(seq) from log where vault = vaults.id), vaults.seq + 1)
          where id = $1`,
        [vault],
      );

      return {
        compacted: dropped.length,
        blobs: forgotten
          .map((r) => ({ id: String(r.id), size: Number(r.size) }))
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
      };
    });
  }
}

/** The vault row every vault query reads: its key's presence is the fact the port calls `keyed`. */
const VAULT_COLUMNS = "v.id, v.account, v.name_sealed as name, v.seq, v.horizon, v.created, exists (select 1 from vault_keys k where k.vault = v.id) as keyed";
const VAULT_SELECT_BY = `select ${VAULT_COLUMNS} from vaults v where v.account = $1 order by v.created, v.id`;
const VAULT_SELECT_ALL = `select ${VAULT_COLUMNS} from vaults v order by v.id`;
