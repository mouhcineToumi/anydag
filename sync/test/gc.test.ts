/**
 * The collector (`sync/server/gc.ts`) over the real `PgMeta` and `DiskBlobs`: compaction keeps each
 * key's newest row, a superseded blob goes only once it is past the history window, a blob a head
 * names never goes, an orphan file goes only when older than an hour, and storage is snapshotted
 * into the ledger — set, not added.
 */

import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChangesResponse } from "../protocol/wire";
import { collect, diskAge, ORPHAN_MS } from "../server/gc";
import { BACKENDS, call, device, harness, upload, vault, wid, type Harness } from "./helpers";

const DAY = 86_400_000;
const bytes = (text: string) => new Uint8Array(Buffer.from(text));

describe.each(BACKENDS)("the collector on $name", ({ name, skip }) => {
  let h: Harness;
  let token: string;
  let account: string;
  let v: string;

  beforeEach(async () => {
    if (skip) return;
    h = await harness(name);
    ({ token, account } = await device(h));
    v = await vault(h, token);
  }, 60_000);
  afterEach(async () => {
    if (!skip) await h.close();
  });

  /** One key written three times, another once: seqs 1–3 for `key`, 4 for `other`. */
  async function history() {
    const ids = [wid("g-1"), wid("g-2"), wid("g-3"), wid("g-other")];
    for (const id of ids) await upload(h, token, v, id, bytes(`${id}-bytes`));
    const [key, other] = [wid("g-key"), wid("g-otherkey")];
    let parent: number | null = null;
    for (const blob of ids.slice(0, 3)) {
      const res = await call(h, "POST", `/v1/vaults/${v}/commit`, { token, json: { changes: [{ key, parent, blob, meta: "m" }] } });
      parent = ((await res.json()) as { seqs: number[] }).seqs[0]!;
    }
    await call(h, "POST", `/v1/vaults/${v}/commit`, { token, json: { changes: [{ key: other, parent: null, blob: ids[3], meta: "m" }] } });
    return { ids, key, other };
  }

  it.skipIf(skip)("keeps everything inside the history window", async () => {
    const { ids } = await history();
    const r = await collect(h.meta, h.blobs, { historyDays: 30, now: new Date(h.clock.now.getTime() + 29 * DAY) });
    expect(r).toEqual({ compacted: 0, blobs: 0, bytes: 0 });
    for (const id of ids) expect(await h.blobs.get(v, id)).not.toBeNull();
  });

  it.skipIf(skip)("past it, keeps each key's newest row and the blobs heads name, and deletes the rest", async () => {
    const { ids, key, other } = await history();
    const r = await collect(h.meta, h.blobs, { historyDays: 30, now: new Date(h.clock.now.getTime() + 31 * DAY) });
    expect(r.compacted).toBe(2);
    expect(r.blobs).toBe(2);
    expect(r.bytes).toBe(Buffer.byteLength(`${ids[0]}-bytes`) + Buffer.byteLength(`${ids[1]}-bytes`));
    expect(await h.blobs.get(v, ids[0]!)).toBeNull();
    expect(await h.blobs.get(v, ids[1]!)).toBeNull();
    expect(await h.blobs.get(v, ids[2]!)).not.toBeNull();
    expect(await h.blobs.get(v, ids[3]!)).not.toBeNull();
    expect(await h.meta.blobSize(v, ids[0]!)).toBeNull();

    const log = (await (await call(h, "GET", `/v1/vaults/${v}/changes?since=2`, { token })).json()) as ChangesResponse;
    expect(log.horizon).toBe(3);
    expect(log.changes.map((c) => [c.seq, c.key])).toEqual([
      [3, key],
      [4, other],
    ]);

    // A second run finds nothing more to do.
    expect(await collect(h.meta, h.blobs, { historyDays: 30, now: new Date(h.clock.now.getTime() + 32 * DAY) })).toEqual({ compacted: 0, blobs: 0, bytes: 0 });
  });

  it.skipIf(skip)("a plan's history window beats the server's", async () => {
    await history();
    await h.meta.putPlan({ id: `short-${name}`, storage_bytes: null, history_days: 1, max_file_bytes: null, devices: null });
    await h.meta.setAccountPlan(account, `short-${name}`);
    const r = await collect(h.meta, h.blobs, { historyDays: 30, now: new Date(h.clock.now.getTime() + 2 * DAY) });
    expect(r.compacted).toBe(2);
  });

  it.skipIf(skip)("removes an orphan file older than an hour, and keeps a younger one", async () => {
    const [old, young] = [wid("o-old"), wid("o-young")];
    await h.blobs.put(v, old, bytes("orphaned"));
    await h.blobs.put(v, young, bytes("in flight"));
    const now = new Date(h.clock.now.getTime() + 5 * 60_000);
    const root = path.join(h.root, "blobs");
    const back = (ms: number) => new Date(now.getTime() - ms);
    fs.utimesSync(path.join(root, v, old.slice(0, 2), old), back(ORPHAN_MS + 60_000), back(ORPHAN_MS + 60_000));
    fs.utimesSync(path.join(root, v, young.slice(0, 2), young), back(60_000), back(60_000));

    // Without a way to tell age, orphans are left alone.
    expect(await collect(h.meta, h.blobs, { historyDays: 30, now })).toMatchObject({ blobs: 0 });
    expect(await h.blobs.get(v, old)).not.toBeNull();

    const r = await collect(h.meta, h.blobs, { historyDays: 30, now, ageOf: diskAge(root, () => now) });
    expect(r).toEqual({ compacted: 0, blobs: 1, bytes: 8 });
    expect(await h.blobs.get(v, old)).toBeNull();
    expect(await h.blobs.get(v, young)).not.toBeNull();
  });

  it.skipIf(skip)("never takes a recorded blob for an orphan, however old its file", async () => {
    const id = wid("o-recorded");
    await upload(h, token, v, id, bytes("recorded"));
    const r = await collect(h.meta, h.blobs, { historyDays: 30, now: h.clock.now, ageOf: async () => 10 * ORPHAN_MS });
    expect(r.blobs).toBe(0);
    expect(await h.blobs.get(v, id)).not.toBeNull();
  });

  it.skipIf(skip)("snapshots storage per vault and per account, set rather than added", async () => {
    await history();
    const now = h.clock.now;
    await collect(h.meta, h.blobs, { historyDays: 30, now });
    await collect(h.meta, h.blobs, { historyDays: 30, now });
    const rows = (await h.meta.usage({ account })).filter((r) => ["storage_live", "storage_history", "blobs", "files"].includes(r.metric));
    const at = (metric: string, vaultId: string | null) => Number(rows.find((r) => r.metric === metric && r.vault === vaultId)?.value);
    const live = Buffer.byteLength(`${wid("g-3")}-bytes`) + Buffer.byteLength(`${wid("g-other")}-bytes`);
    for (const scope of [v, null]) {
      expect(at("storage_live", scope)).toBe(live);
      expect(at("files", scope)).toBe(2);
      expect(at("blobs", scope)).toBe(4);
      expect(at("storage_history", scope)).toBeGreaterThan(0);
    }
  });
});
