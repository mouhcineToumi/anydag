/**
 * `Meta`'s contract (sync/server/meta/types.ts), written once and run against both backends the
 * port has: PGlite in this process, and — when `ANYDAG_SYNC_TEST_PG` holds a URL — the same suite
 * over `pgDb` against a real Postgres on a schema of its own. The suite seeds itself: every test
 * mints its own ids, because the Postgres run shares one schema, and so asserts only what it made.
 *
 * What is load-bearing here is atomicity and order: a commit's stale check comes before its
 * missing-blob check, a refused commit writes nothing, seqs are gapless under concurrent commits,
 * and the horizon only ever rises in the same write that forgets the rows and blobs beneath it.
 */
import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mint, validId } from "../../server/ids";
import { pgDb, pgliteDb } from "../server/meta/db";
import { PgMeta } from "../server/meta/pg";
import type { Account, Meta, VaultRow } from "../server/meta/types";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ID = /^[a-z0-9]{10}$/;
const ETAG = /^[A-Za-z0-9_-]{22}$/;
const CROCKFORD = /^[0123456789abcdefghjkmnpqrstvwxyz]{10}$/;

/** Calendar days far outside any real traffic, distinct per use, so a shared database stays clean. */
const D1 = "2099-01-01";
const D2 = "2099-01-02";
const D3 = "2099-01-03";

const FREE_PLAN = { id: "free", storage_bytes: null, history_days: null, max_file_bytes: null, devices: null };
const ARGO = { kdf: "argon2id", m: 65536, t: 3, p: 1, salt: "c2FsdA" } as const;

const u = (): string => mint(() => false);
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const isoNow = (): string => new Date().toISOString();
const later = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();
const day = (d: string): string => `${d}T00:00:00.000Z`;
/** After every commit the tests date (they are in 2099, so they are never "old" by the wall clock). */
const AFTER = "2099-12-31T00:00:00.000Z";

/** A key or a blob id is any token to the port; the padded shape keeps them unique and orderable. */
const oid = (tag: string): string => tag.padEnd(43, "-");

/** `commit` answers a union; the seeded ones always land, and the tests that seed say so loudly. */
const seqsOf = (r: Awaited<ReturnType<Meta["commit"]>>): number[] => {
  if (!r.ok) throw new Error(`a seeded commit was refused: ${JSON.stringify(r)}`);
  return r.seqs;
};

interface Suite {
  meta: Meta;
  close(): Promise<void>;
}

// -- the two backends -------------------------------------------------------------------------------

/** PGlite: a whole Postgres in this process, everything of its own, gone when the run ends. */
const pgliteSuite = async (): Promise<Suite> => {
  const db = await pgliteDb();
  const meta = new PgMeta(db);
  await meta.migrate();
  return { meta, close: () => db.close() };
};

/**
 * Postgres: one schema made and dropped for this run, so the shared `anydag_sync` stays untouched
 * and `pgDb(url, { schema })` puts every connection of the pool straight into it.
 */
const pgSuite = async (url: string): Promise<Suite> => {
  const root = pgDb(url);
  try {
    await root.query("select 1");
  } catch (cause) {
    await root.close().catch(() => {});
    throw new Error(
      `ANYDAG_SYNC_TEST_PG=${url} did not answer — is the compose database up? (docker compose -f sync/compose.yaml up -d --wait db)`,
    );
  }
  const schema = `t_${Math.random().toString(36).slice(2, 12)}`;
  await root.exec(`create schema ${schema}`);
  const db = pgDb(url, { schema });
  const meta = new PgMeta(db);
  await meta.migrate();
  return {
    meta,
    close: async () => {
      await db.close();
      await root.exec(`drop schema ${schema} cascade`);
      await root.close();
    },
  };
};

// -- the contract -----------------------------------------------------------------------------------

/** The contract's tests, called once per backend. `make` runs once per call and is closed after. */
function contract(label: string, make: () => Promise<Suite>): void {
  describe(label, () => {
    let meta!: Meta;
    let suite!: Suite;

    beforeAll(async () => {
      suite = await make();
      meta = suite.meta;
    });
    afterAll(async () => {
      await suite.close();
    });

    /** A fresh account, given a minted name; nothing else ever runs under it. */
    const account = async (): Promise<Account> => meta.createAccount(`account ${u()}`);
    const vault = async (forAccount: Account): Promise<VaultRow> => meta.createVault(forAccount.id, `sealed-name ${u()}`);

    it("migrates twice without complaint, and `free` is there", async () => {
      await meta.migrate();
      expect(await meta.plan("free")).toEqual(FREE_PLAN);
    });

    it("accounts: create, read, duplicate name rejected; the plan answers and can be replaced", async () => {
      const a = await account();
      expect(a.plan).toBe("free");
      expect(a.created).toMatch(ISO);
      expect(ID.test(a.id)).toBe(true);
      expect(CROCKFORD.test(a.id)).toBe(true);
      expect((await meta.account(a.id))?.name).toBe(a.name);
      expect(await meta.account(u())).toBeNull();
      expect((await meta.accountByName(a.name))?.id).toBe(a.id);
      expect(await meta.accountByName(`no such name ${u()}`)).toBeNull();
      expect((await meta.accounts()).some((row) => row.id === a.id)).toBe(true);
      await expect(meta.createAccount(a.name)).rejects.toThrow(); // the duplicate name's key check
      await expect(meta.createAccount(`account ${u()}`, `no-such-plan-${u()}`)).rejects.toThrow();
      await expect(meta.setAccountPlan(a.id, `no-such-plan-${u()}`)).rejects.toThrow();

      const b = await account();
      const paid = `plan-${u()}`;
      await meta.putPlan({ id: paid, storage_bytes: 10_000_000, history_days: 90, max_file_bytes: 1000, devices: 5 });
      expect(await meta.plan(paid)).toEqual({
        id: paid,
        storage_bytes: 10_000_000,
        history_days: 90,
        max_file_bytes: 1000,
        devices: 5,
      });
      await meta.putPlan({ id: paid, storage_bytes: 20_000_000, history_days: 30, max_file_bytes: 2000, devices: 6 });
      expect((await meta.plan(paid)).storage_bytes).toBe(20_000_000); // upserted, not second-installed
      expect(await meta.plan(`no such plan ${u()}`)).toEqual(FREE_PLAN); // `free`, naming none, limits null
      await meta.setAccountPlan(b.id, paid);
      expect((await meta.account(b.id))?.plan).toBe(paid);
    });

    it("pair codes: single use, the second and the unknown ones null", async () => {
      const a = await account();
      const hash = sha(`code ${u()}`);
      await meta.addPairCode(a.id, hash, later(10));
      expect(await meta.takePairCode(hash, isoNow())).toBe(a.id);
      expect(await meta.takePairCode(hash, isoNow())).toBeNull();
      expect(await meta.takePairCode(sha(`another ${u()}`), isoNow())).toBeNull();
    });

    it("pair codes: the expired one is refused at `now`", async () => {
      const a = await account();
      const hash = sha(`stale code ${u()}`);
      await meta.addPairCode(a.id, hash, new Date(Date.now() - 1000).toISOString());
      expect(await meta.takePairCode(hash, isoNow())).toBeNull();
    });

    it("devices: added unseen, found by token, touched once a day, revoked by its account only", async () => {
      const a = await account();
      const other = await account();
      const token = sha(`token ${u()}`);
      const d = await meta.addDevice(a.id, "laptop", "linux", token);
      expect(d).toEqual({
        id: d.id,
        account: a.id,
        name: "laptop",
        platform: "linux",
        created: d.created,
        seen: null,
        revoked: null,
      });
      expect(d.created).toMatch(ISO);
      expect(ID.test(d.id)).toBe(true);
      expect((await meta.deviceByToken(token))?.id).toBe(d.id);
      expect(await meta.deviceByToken(sha(`token ${u()}`))).toBeNull();

      expect(await meta.touchDevice(d.id, D1)).toBe(true);
      expect(await meta.touchDevice(d.id, D1)).toBe(false); // the day's flag is the first request
      expect((await meta.deviceByToken(token))?.seen).toBe(D1);
      expect(await meta.touchDevice(d.id, D2)).toBe(true);
      expect((await meta.deviceByToken(token))?.seen).toBe(D2);
      expect((await meta.devices(a.id)).map((x) => x.id)).toEqual([d.id]);
      expect((await meta.devices(other.id)).map((x) => x.id)).toEqual([]);

      expect(await meta.revokeDevice(other.id, d.id, isoNow())).toBe(false);
      expect(await meta.revokeDevice(a.id, d.id, isoNow())).toBe(true);
      expect(await meta.revokeDevice(a.id, d.id, isoNow())).toBe(false); // once was enough
      const after = (await meta.deviceByToken(token))!;
      expect(after.id).toBe(d.id);
      expect(after.revoked).toMatch(ISO); // still found by token, so a route can say why it refused
    });

    it("vaults: minted or kept, scoped to the account, and keyed only once a key lands", async () => {
      const a = await account();
      const b = await account();
      const v1 = await vault(a); // no id: minted
      expect(ID.test(v1.id)).toBe(true);
      expect(v1.seq).toBe(0);
      expect(v1.horizon).toBe(1);
      expect(v1.keyed).toBe(false);
      expect(validId(v1.id)).toBe(true);
      expect(v1.name).toMatch(/^sealed-name /);
      expect(v1.created).toMatch(ISO);
      expect(v1.account).toBe(a.id);

      const asked = u();
      expect(validId(asked)).toBe(true);
      const v2 = await meta.createVault(a.id, `sealed-name ${u()}`, asked);
      expect(v2.id).toBe(asked); // the id the caller has is kept when it is free
      await meta.putKey(v2.id, { wrapped: `w-${u()}`, recovery: `r-${u()}`, params: { ...ARGO } });
      const v3 = await meta.createVault(a.id, `sealed-name ${u()}`, asked);
      expect(v3.id).not.toBe(asked); // taken, and finished: minted instead of colliding
      const v4 = await meta.createVault(a.id, `sealed-name ${u()}`, "not-an-id");
      expect(validId(v4.id)).toBe(true); // not our shape: minted
      expect(v4.id).not.toBe(asked);

      expect((await meta.vaults(a.id)).map((x) => x.id).sort()).toEqual([v1.id, v2.id, v3.id, v4.id].sort());
      expect((await meta.vaults(b.id)).map((x) => x.id)).toEqual([]);
      expect((await meta.vault(a.id, v1.id))?.id).toBe(v1.id);
      expect(await meta.vault(b.id, v1.id)).toBeNull(); // another account's is nobody's
      const all = await meta.allVaults();
      expect(all.some((x) => x.id === v1.id)).toBe(true);
      const vb = await vault(b);
      expect((await meta.allVaults()).some((x) => x.id === vb.id && x.account === b.id)).toBe(true); // the sweep reaches every account's
    });

    it("an upload that never set its key is taken up again under its id, and only that", async () => {
      const [a, b] = [await account(), await account()];
      const asked = u();
      const first = await meta.createVault(a.id, "sealed-name first", asked);
      const again = await meta.createVault(a.id, "sealed-name again", asked);
      expect(again.id).toBe(asked); // the same vault, not a second remote
      expect(again.name).toBe("sealed-name again"); // the old name was sealed under a key nobody kept
      expect(again.keyed).toBe(false);
      expect(again.created).toBe(first.created);
      expect((await meta.vaults(a.id)).filter((x) => x.id === asked)).toHaveLength(1);
      // Another account's unfinished vault is not this one's to take.
      const theirs = await meta.createVault(b.id, "sealed-name b", asked);
      expect(theirs.id).not.toBe(asked);
      // Keyed, it is finished, and a create under its id mints.
      await meta.putKey(asked, { wrapped: `w-${u()}`, recovery: `r-${u()}`, params: { ...ARGO } });
      expect((await meta.createVault(a.id, "sealed-name third", asked)).id).not.toBe(asked);
    });

    it("vault keys: set once with any etag, replaced on the current one, a fresh etag every write", async () => {
      const a = await account();
      const v = await vault(a);
      expect(await meta.getKey(v.id)).toBeNull();
      const put = { wrapped: `w-${u()}`, recovery: `r-${u()}`, params: { ...ARGO }, etag: "nobody-has-me" };

      const first = await meta.putKey(v.id, put);
      if (first === false) throw new Error("the first put refused");
      expect(ETAG.test(first.etag)).toBe(true); // the caller's etag is ignored on a first write
      const stored = (await meta.getKey(v.id))!;
      expect(stored).toEqual({ wrapped: put.wrapped, recovery: put.recovery, params: { ...ARGO }, etag: first.etag });
      expect((await meta.vault(a.id, v.id))?.keyed).toBe(true);

      expect(await meta.putKey(v.id, { ...put, etag: "stale" })).toBe(false); // refused, and wrote nothing
      expect((await meta.getKey(v.id))?.etag).toBe(stored.etag);
      const again = await meta.putKey(v.id, { ...put, etag: stored.etag });
      if (again === false) throw new Error("the etag was the current one");
      expect(again.etag).not.toBe(stored.etag); // minted again, so a device cannot pretend to be fresh
      expect((await meta.getKey(v.id))?.etag).toBe(again.etag);
    });

    it("blobs: indexed, idempotent, per vault", async () => {
      const a = await account();
      const v = await vault(a);
      const v2 = await vault(a);
      const b = oid("b1");
      expect(await meta.blobSize(v.id, b)).toBeNull();
      await meta.addBlob(v.id, b, 30);
      await meta.addBlob(v.id, b, 30); // a second upload of one id changes nothing
      expect(await meta.blobSize(v.id, b)).toBe(30);
      await meta.addBlob(v2.id, b, 9);
      expect(await meta.blobSize(v2.id, b)).toBe(9); // one vault's blob is not another vault's
    });

    it("commit: accepted whole, one log row and one head per change, in order", async () => {
      const a = await account();
      const v = await vault(a);
      const d = u();
      const kA = oid("ka");
      const bA = oid("ba");
      const m1 = `meta ${u()}`;
      const m2 = `meta ${u()}`;
      const m3 = `meta ${u()}`;
      const bB = oid("bb");
      const bC = oid("bc");
      await meta.addBlob(v.id, bA, 25);
      await meta.addBlob(v.id, bB, 7);
      await meta.addBlob(v.id, bC, 3);

      const c1 = await meta.commit(v.id, d, [{ key: kA, parent: null, blob: bA, meta: m1 }], day(D1));
      expect(c1).toEqual({ ok: true, seqs: [1] });
      expect(await meta.heads(v.id, "", 10)).toEqual({
        heads: [{ key: kA, seq: 1, blob: bA, size: 25, meta: m1 }],
        seq: 1,
      });
      expect(await meta.changes(v.id, 0, 10)).toEqual({
        changes: [{ seq: 1, key: kA, parent: null, blob: bA, size: 25, meta: m1, device: d, at: day(D1) }],
        head: 1,
        horizon: 1,
      });

      // a change against its own head: parent is that head's seq, the size is the blob's answer
      const c2 = await meta.commit(v.id, d, [{ key: kA, parent: 1, blob: bB, meta: m2 }], day(D2));
      expect(c2).toEqual({ ok: true, seqs: [2] });
      expect(await meta.changes(v.id, 1, 10)).toEqual({
        changes: [{ seq: 2, key: kA, parent: 1, blob: bB, size: 7, meta: m2, device: d, at: day(D2) }],
        head: 2,
        horizon: 1,
      });

      // two keys in one commit land adjacent, a dir marker on its side carrying size 0
      const c3 = await meta.commit(
        v.id,
        d,
        [
          { key: oid("kc"), parent: null, blob: bC, meta: m3 },
          { key: oid("kd"), parent: null, blob: null, meta: m3 },
        ],
        day(D3),
      );
      expect(c3).toEqual({ ok: true, seqs: [3, 4] });
      const heads = await meta.heads(v.id, "", 10);
      expect(heads.seq).toBe(4);
      expect(heads.heads).toEqual([
        { key: kA, seq: 2, blob: bB, size: 7, meta: m2 },
        { key: oid("kc"), seq: 3, blob: bC, size: 3, meta: m3 },
        { key: oid("kd"), seq: 4, blob: null, size: 0, meta: m3 },
      ]);
    });

    it("commit: refused whole when one change is stale, every stale key named with its head", async () => {
      const a = await account();
      const v = await vault(a);
      const d = u();
      const kA = oid("ka");
      const kB = oid("kb");
      const kC = oid("kc");
      const bA = oid("ba");
      const bB = oid("bb");
      await meta.addBlob(v.id, bA, 11);
      await meta.addBlob(v.id, bB, 3);
      seqsOf(await meta.commit(v.id, d, [{ key: kA, parent: null, blob: bA, meta: "m" }], day(D1)));
      seqsOf(await meta.commit(v.id, d, [{ key: kB, parent: null, blob: bB, meta: "m" }], day(D1)));
      seqsOf(await meta.commit(v.id, d, [{ key: kA, parent: 1, blob: null, meta: "m" }], day(D2))); // the delete

      const before = await meta.changes(v.id, 0, 100);
      const refusal = await meta.commit(
        v.id,
        u(),
        [
          { key: kA, parent: 1, blob: bA, meta: "m" }, // parent older than its head
          { key: kB, parent: null, blob: bA, meta: "m" }, // parent none against a head that holds content
          { key: kC, parent: 4, blob: bA, meta: "m" }, // parent on a head the device was never told of
        ],
        day(D3),
      );
      expect(refusal).toEqual({
        ok: false,
        stale: [
          { key: kA, head: 3, blob: null }, // its head is the delete
          { key: kB, head: 2, blob: bB },
          { key: kC, head: null, blob: null },
        ],
      });
      expect(await meta.changes(v.id, 0, 100)).toEqual(before); // nothing written anywhere
    });

    it("commit: a delete's head counts, so create-after-delete bases on null or on its seq", async () => {
      const a = await account();
      const v = await vault(a);
      const d = u();
      const k = oid("k-recreate");
      const bA = oid("b-create");
      const bB = oid("b-after-delete");
      await meta.addBlob(v.id, bA, 5);
      await meta.addBlob(v.id, bB, 6);
      seqsOf(await meta.commit(v.id, d, [{ key: k, parent: null, blob: bA, meta: "m" }], day(D1))); // 1: create
      seqsOf(await meta.commit(v.id, d, [{ key: k, parent: 1, blob: null, meta: "m" }], day(D2))); // 2: delete
      // a delete's head is a head: null over it is stale, its seq is the parent
      expect(await meta.commit(v.id, d, [{ key: k, parent: null, blob: bB, meta: "m" }], day(D3))).toEqual({ ok: false, stale: [{ key: k, head: 2, blob: null }] });
      seqsOf(await meta.commit(v.id, d, [{ key: k, parent: 2, blob: bB, meta: "m" }], day(D3))); // 3: re-created
      seqsOf(await meta.commit(v.id, d, [{ key: k, parent: 3, blob: null, meta: "m" }], day(D3))); // 4: delete again
      seqsOf(await meta.commit(v.id, d, [{ key: k, parent: 4, blob: bA, meta: "m" }], day(D3))); // 5: by its seq

      // a head holding content wants its own seq: a device whose base is "nothing there" is stale
      const wrong = await meta.commit(v.id, d, [{ key: k, parent: null, blob: bB, meta: "m" }], day(D3));
      expect(wrong).toEqual({ ok: false, stale: [{ key: k, head: 5, blob: bA }] });
      const right = await meta.commit(v.id, d, [{ key: k, parent: 5, blob: bB, meta: "m" }], day(D3));
      expect(right).toEqual({ ok: true, seqs: [6] });
      // and a parent on a key that never was is stale against nothing, at zero
      const stranger = await meta.commit(v.id, d, [{ key: oid("k3"), parent: 2, blob: bA, meta: "m" }], day(D3));
      expect(stranger).toEqual({ ok: false, stale: [{ key: oid("k3"), head: null, blob: null }] });
    });

    it("commit: a missing blob refuses the whole commit, and stale wins the order of checks", async () => {
      const a = await account();
      const v = await vault(a);
      const d = u();
      const kA = oid("k-missing");
      const kB = oid("k-missing-too");
      const bMissing = oid("b-never-uploaded");

      const missing = await meta.commit(v.id, d, [{ key: kA, parent: null, blob: bMissing, meta: "m" }], day(D1));
      expect(missing).toEqual({ ok: false, missing: [bMissing] });
      expect(await meta.changes(v.id, 0, 10)).toEqual(expect.objectContaining({ head: 0, horizon: 1 }));

      const both = await meta.commit(
        v.id,
        d,
        [
          { key: kA, parent: null, blob: bMissing, meta: "m" }, // would be fine once the blob lands
          { key: kB, parent: 99, blob: bMissing, meta: "m" }, // and is stale regardless
        ],
        day(D2),
      );
      expect(both).toEqual({ ok: false, stale: [{ key: kB, head: null, blob: null }] });
      expect(await meta.changes(v.id, 0, 10)).toEqual(expect.objectContaining({ head: 0, horizon: 1 }));
    });

    it("changes: pages after a cursor; a fresh vault is an empty log between horizons 0 and 1", async () => {
      const a = await account();
      const v = await vault(a);
      const d = u();
      expect(await meta.changes(v.id, 0, 10)).toEqual({ changes: [], head: 0, horizon: 1 });
      const expected = [
        { seq: 1, key: oid("ka"), parent: null, blob: oid("ba"), size: 3, meta: "m0", device: d, at: day(D1) },
        { seq: 2, key: oid("kb"), parent: null, blob: oid("bb"), size: 6, meta: "m1", device: d, at: day(D1) },
        { seq: 3, key: oid("kc"), parent: null, blob: oid("bc"), size: 9, meta: "m2", device: d, at: day(D1) },
      ];
      for (const e of expected) await meta.addBlob(v.id, e.blob, e.size);
      seqsOf(
        await meta.commit(
          v.id,
          d,
          expected.map((e) => ({ key: e.key, parent: e.parent, blob: e.blob, meta: e.meta })),
          day(D1),
        ),
      );

      const page1 = await meta.changes(v.id, 0, 2);
      expect(page1.changes).toEqual([expected[0]!, expected[1]!]);
      expect(page1.head).toBe(3);
      expect(page1.horizon).toBe(1);
      const page2 = await meta.changes(v.id, 2, 2);
      expect(page2.changes).toEqual([expected[2]!]);
      expect(await meta.changes(v.id, 3, 2)).toEqual({ changes: [], head: 3, horizon: 1 });
    });

    it("heads: pages in key order, and the seq a reader pages through and then pulls from", async () => {
      const a = await account();
      const v = await vault(a);
      const d = u();
      const evens = [
        { key: oid("ka"), blob: oid("ba"), size: 11, meta: "m0" },
        { key: oid("kb"), blob: oid("bb"), size: 22, meta: "m1" },
        { key: oid("kc"), blob: oid("bc"), size: 33, meta: "m2" },
      ];
      for (const e of evens) await meta.addBlob(v.id, e.blob, e.size);
      seqsOf(
        await meta.commit(
          v.id,
          d,
          evens.map((e) => ({ key: e.key, parent: null, blob: e.blob, meta: e.meta })),
          day(D1),
        ),
      );

      const first = await meta.heads(v.id, "", 2);
      expect(first).toEqual({
        heads: [
          { key: oid("ka"), seq: 1, blob: oid("ba"), size: 11, meta: "m0" },
          { key: oid("kb"), seq: 2, blob: oid("bb"), size: 22, meta: "m1" },
        ],
        seq: 3,
      });
      expect(await meta.heads(v.id, oid("kb"), 2)).toEqual({
        heads: [{ key: oid("kc"), seq: 3, blob: oid("bc"), size: 33, meta: "m2" }],
        seq: 3,
      });
      expect(await meta.heads(v.id, "z", 2)).toEqual({ heads: [], seq: 3 });
    });

    it("usage: counters add, snapshots replace, the account-wide vault is null, the bounds are inclusive", async () => {
      const a = await account();
      const v = await vault(a);
      const empty = null;

      await meta.bump(D1, a.id, v.id, "commits", 1);
      await meta.bump(D1, a.id, v.id, "commits", 1); // a counter adds
      await meta.bump(D1, a.id, empty, "devices_active", 1); // account-wide: no vault
      await meta.bump(D1, a.id, v.id, "storage_live", 100);
      await meta.bump(D1, a.id, v.id, "storage_live", 250); // a snapshot replaces, the day keeps its last
      await meta.bump(D2, a.id, v.id, "bytes_up", 5);
      await meta.bump(D3, a.id, v.id, "commits", 1);

      const all = await meta.usage({ account: a.id });
      expect(all.map((r) => [r.day, r.vault, r.metric, r.value])).toEqual([
        [D1, null, "devices_active", 1],
        [D1, v.id, "commits", 2],
        [D1, v.id, "storage_live", 250],
        [D2, v.id, "bytes_up", 5],
        [D3, v.id, "commits", 1],
      ]);

      expect((await meta.usage({ account: a.id, since: D2, until: D2 })).map((r) => [r.day, r.metric])).toEqual([
        [D2, "bytes_up"],
      ]);
      expect((await meta.usage({ account: a.id, until: D2 })).map((r) => [r.day, r.vault])).toEqual([
        [D1, null],
        [D1, v.id],
        [D1, v.id],
        [D2, v.id],
      ]);
      expect((await meta.usage({ account: a.id, since: D3 })).map((r) => r.day)).toEqual([D3]);
      expect(await meta.usage({ account: `no account ${u()}` })).toEqual([]);
    });

    it("storage: a blob named by several heads is once, and a foreign account's is not ours", async () => {
      const a = await account();
      const foreign = await account();
      const v1 = await vault(a);
      const v2 = await vault(a);
      const v3 = await vault(foreign);
      const bOld = oid("b-historic");
      const bLive = oid("b-live");
      const bOther = oid("b-live-2");
      const bForeign = oid("b-foreign");
      const uploads = [
        { vault: v1.id, id: bOld, size: 100 },
        { vault: v1.id, id: bLive, size: 40 },
        { vault: v2.id, id: bOther, size: 30 },
        { vault: v3.id, id: bForeign, size: 999 },
      ];
      for (const up of uploads) await meta.addBlob(up.vault, up.id, up.size);
      // v1: bOld (superseded), bLive named by two heads of that vault; v2: bOther; v3: bForeign
      seqsOf(await meta.commit(v1.id, u(), [{ key: oid("k1"), parent: null, blob: bOld, meta: "m" }], day(D1)));
      seqsOf(
        await meta.commit(
          v1.id,
          u(),
          [
            { key: oid("k1"), parent: 1, blob: bLive, meta: "m" },
            { key: oid("k2"), parent: null, blob: bLive, meta: "m" }, // the same blob: one bytes' worth
          ],
          day(D2),
        ),
      );
      seqsOf(await meta.commit(v2.id, u(), [{ key: oid("k3"), parent: null, blob: bOther, meta: "m" }], day(D3)));
      seqsOf(await meta.commit(v3.id, u(), [{ key: oid("kf"), parent: null, blob: bForeign, meta: "m" }], day(D3)));

      expect(await meta.storage(a.id, v1.id)).toEqual({ live: 40, history: 100, blobs: 2, files: 2 });
      expect(await meta.storage(a.id, v2.id)).toEqual({ live: 30, history: 0, blobs: 1, files: 1 });
      expect(await meta.storage(a.id)).toEqual({ live: 70, history: 100, blobs: 3, files: 3 });
      expect(await meta.storage(foreign.id)).toEqual({ live: 999, history: 0, blobs: 1, files: 1 });
      expect(await meta.storage(`no such account ${u()}`)).toEqual({ live: 0, history: 0, blobs: 0, files: 0 });
    });

    it("collect: forgets an unnamed blob old enough, keeps the live heads' one, raises the horizon", async () => {
      const a = await account();
      const v = await vault(a);
      const bGone = oid("b-unkept");
      const bKeeper = oid("b-kept");
      await meta.addBlob(v.id, bGone, 10);
      await meta.addBlob(v.id, bKeeper, 20);
      // k1 created at 1 and deleted at 2; k2 holds bKeeper at 3
      seqsOf(await meta.commit(v.id, u(), [{ key: oid("k1"), parent: null, blob: bGone, meta: "m" }], day(D1)));
      seqsOf(await meta.commit(v.id, u(), [{ key: oid("k1"), parent: 1, blob: null, meta: "m" }], day(D2)));
      seqsOf(await meta.commit(v.id, u(), [{ key: oid("k2"), parent: null, blob: bKeeper, meta: "m" }], day(D3)));

      const result = await meta.collect(v.id, AFTER);
      expect(result).toEqual({ compacted: 1, blobs: [{ id: bGone, size: 10 }] });
      expect(await meta.blobSize(v.id, bGone)).toBeNull(); // forgotten in the index; its bytes go next
      expect(await meta.blobSize(v.id, bKeeper)).toBe(20);
      const after = await meta.changes(v.id, 0, 100);
      expect(after.changes.map((r) => r.seq)).toEqual([2, 3]);
      expect(after.horizon).toBe(2);
      expect((await meta.vault(a.id, v.id))?.horizon).toBe(2);
    });

    it("collect: a blob a live head names is never forgotten, even when its log row is", async () => {
      const a = await account();
      const v = await vault(a);
      const shared = oid("b-shared");
      await meta.addBlob(v.id, shared, 15);
      // k1 created at 1, k2 created at 2 naming the same blob, k1 deleted at 3
      seqsOf(await meta.commit(v.id, u(), [{ key: oid("k1"), parent: null, blob: shared, meta: "m" }], day(D1)));
      seqsOf(await meta.commit(v.id, u(), [{ key: oid("k2"), parent: null, blob: shared, meta: "m" }], day(D2)));
      seqsOf(await meta.commit(v.id, u(), [{ key: oid("k1"), parent: 1, blob: null, meta: "m" }], day(D3)));

      const result = await meta.collect(v.id, AFTER);
      expect(result).toEqual({ compacted: 1, blobs: [] }); // the head still names it
      expect(await meta.blobSize(v.id, shared)).toBe(15);
      expect(await meta.changes(v.id, 0, 100)).toEqual(expect.objectContaining({ horizon: 2 }));
    });

    it("collect: a vault nothing was committed to keeps its horizon at 1 and forgets nothing", async () => {
      const a = await account();
      const v = await vault(a);
      expect(await meta.collect(v.id, AFTER)).toEqual({ compacted: 0, blobs: [] });
      expect(await meta.changes(v.id, 0, 10)).toEqual({ changes: [], head: 0, horizon: 1 });
    });

    it("concurrent commits: disjoint keys land with gapless seqs; one key one parent, one lands", async () => {
      const a = await account();
      const v = await vault(a);
      const bA = oid("b-race-a");
      const bB = oid("b-race-b");
      await meta.addBlob(v.id, bA, 2);
      await meta.addBlob(v.id, bB, 3);
      const dA = u();
      const dB = u();
      const kA = oid("ka-race");
      const kB = oid("kb-race");

      const apart = await Promise.all([
        meta.commit(v.id, dA, [{ key: kA, parent: null, blob: bA, meta: "m" }], day(D1)),
        meta.commit(v.id, dB, [{ key: kB, parent: null, blob: bB, meta: "m" }], day(D1)),
      ]);
      expect(apart.flatMap((r) => seqsOf(r)).sort((x, y) => x - y)).toEqual([1, 2]);
      expect((await meta.vault(a.id, v.id))?.seq).toBe(2);

      const same = oid("kc-race");
      const race = await Promise.all([
        meta.commit(v.id, dA, [{ key: same, parent: null, blob: bA, meta: "m" }], day(D1)),
        meta.commit(v.id, dB, [{ key: same, parent: null, blob: bA, meta: "m" }], day(D1)),
      ]);
      expect(race.filter((r) => r.ok).length).toBe(1);
      const refused = race.find((r) => !r.ok)!;
      expect(refused).toEqual({ ok: false, stale: [{ key: same, head: 3, blob: bA }] });
      expect((await meta.vault(a.id, v.id))?.seq).toBe(3);
      const log = await meta.changes(v.id, 0, 100);
      expect(log.changes.length).toBe(3);
      expect(log.head).toBe(3);
    });
  });
}

// -- the backends -----------------------------------------------------------------------------------

const PG_URL = process.env.ANYDAG_SYNC_TEST_PG ?? "";

contract("the Meta contract on PGlite", pgliteSuite);
if (PG_URL !== "") contract("the Meta contract on Postgres", () => pgSuite(PG_URL));
