/**
 * Every `/v1` route and every `ES_*` code, through `app.request` over the real `PgMeta` and
 * `DiskBlobs`. Runs on PGlite always, and on a real Postgres
 * too when `ANYDAG_SYNC_TEST_PG` names one (`npm run sync:test:pg`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_CHANGES, PAIR_MINUTES, type ChangesResponse, type ErrorBody, type HeadsResponse } from "../protocol/wire";
import { collect } from "../server/gc";
import { mintPairCode } from "../server/routes/pair";
import { ADMIN, BACKENDS, call, device, harness, upload, vault, wid, type Harness } from "./helpers";

const bytes = (text: string) => new Uint8Array(Buffer.from(text));
const err = async (res: Response) => (await res.json()) as ErrorBody;

describe.each(BACKENDS)("routes on $name", ({ name, skip }) => {
  let h: Harness;
  beforeAll(async () => {
    if (!skip) h = await harness(name);
  }, 60_000);
  afterAll(async () => {
    if (!skip) await h.close();
  });

  it.skipIf(skip)("answers health without a token", async () => {
    const res = await call(h, "GET", "/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: "test", protocol: 1, mode: "single" });
  });

  it.skipIf(skip)("an unknown route is ES_NOT_FOUND in the error shape", async () => {
    const res = await call(h, "GET", "/nope");
    expect(res.status).toBe(404);
    expect((await err(res)).code).toBe("ES_NOT_FOUND");
  });

  describe("pairing", () => {
    it.skipIf(skip)("a good code pairs, once, read as a person types it", async () => {
      const a = await h.meta.createAccount(`pairing-${name}`);
      const { code } = await mintPairCode(h.meta, a.id, h.clock.now);
      expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
      const typed = code.toLowerCase().replace(/0/g, "o").replace(/1/g, "l").replace("-", " - ");
      const res = await call(h, "POST", "/v1/pair", { json: { code: typed, device: { name: "phone", platform: "android" } } });
      expect(res.status).toBe(200);
      const j = (await res.json()) as { token: string; account: { id: string; name: string }; device: { name: string } };
      expect(j.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(j.account).toEqual({ id: a.id, name: a.name });
      expect(j.device.name).toBe("phone");
      expect(j).not.toHaveProperty("device.account");

      const again = await call(h, "POST", "/v1/pair", { json: { code, device: { name: "x", platform: "y" } } });
      expect(again.status).toBe(400);
      expect((await err(again)).code).toBe("ES_PAIR");
    });

    it.skipIf(skip)("a bad code and an expired code are ES_PAIR", async () => {
      const bad = await call(h, "POST", "/v1/pair", { json: { code: "UUUUU-UUUUU", device: { name: "x", platform: "y" } } });
      expect((await err(bad)).code).toBe("ES_PAIR");
      const a = await h.meta.createAccount(`expiry-${name}`);
      const { code } = await mintPairCode(h.meta, a.id, h.clock.now);
      h.clock.advance((PAIR_MINUTES + 1) * 60_000);
      const late = await call(h, "POST", "/v1/pair", { json: { code, device: { name: "x", platform: "y" } } });
      expect(late.status).toBe(400);
      expect((await err(late)).code).toBe("ES_PAIR");
    });

    it.skipIf(skip)("a malformed body is ES_BAD_REQUEST", async () => {
      const res = await call(h, "POST", "/v1/pair", { json: { code: "X" } });
      expect(res.status).toBe(400);
      expect((await err(res)).code).toBe("ES_BAD_REQUEST");
      const notJson = await h.app.request("/v1/pair", {
        method: "POST",
        body: "{nope",
        headers: { "content-type": "application/json" },
      });
      expect((await err(notJson)).code).toBe("ES_BAD_REQUEST");
    });

    it.skipIf(skip)("a plan's device limit refuses the next pairing with ES_QUOTA", async () => {
      await h.meta.putPlan({ id: `two-${name}`, storage_bytes: null, history_days: null, max_file_bytes: null, devices: 1 });
      const a = await h.meta.createAccount(`limited-${name}`, `two-${name}`);
      await device(h, a.name);
      const { code } = await mintPairCode(h.meta, a.id, h.clock.now);
      const res = await call(h, "POST", "/v1/pair", { json: { code, device: { name: "x", platform: "y" } } });
      expect(res.status).toBe(413);
      expect((await err(res)).code).toBe("ES_QUOTA");
    });
  });

  describe("auth", () => {
    it.skipIf(skip)("no token, a bad token and a revoked device are ES_AUTH", async () => {
      expect((await err(await call(h, "GET", "/v1/vaults"))).code).toBe("ES_AUTH");
      const bad = await call(h, "GET", "/v1/vaults", { token: "x".repeat(43) });
      expect(bad.status).toBe(401);
      expect((await err(bad)).code).toBe("ES_AUTH");

      const me = await device(h);
      const other = await device(h, (await h.meta.account(me.account))!.name);
      const list = await call(h, "GET", "/v1/devices", { token: me.token });
      const devices = ((await list.json()) as { devices: { id: string; current?: boolean }[] }).devices;
      expect(devices).toHaveLength(2);
      expect(devices.find((d) => d.id === me.device)?.current).toBe(true);
      expect(devices.find((d) => d.id === other.device)?.current).toBe(false);

      expect((await call(h, "DELETE", `/v1/devices/${other.device}`, { token: me.token })).status).toBe(200);
      expect((await err(await call(h, "GET", "/v1/vaults", { token: other.token }))).code).toBe("ES_AUTH");
      expect((await err(await call(h, "DELETE", "/v1/devices/zzzzzzzzzz", { token: me.token }))).code).toBe("ES_NOT_FOUND");

      // Revoking yourself works, and the next request is refused.
      expect((await call(h, "DELETE", `/v1/devices/${me.device}`, { token: me.token })).status).toBe(200);
      expect((await call(h, "GET", "/v1/vaults", { token: me.token })).status).toBe(401);
    });

    it.skipIf(skip)("another account's vault is ES_NOT_FOUND, never ES_FORBIDDEN", async () => {
      const a = await device(h);
      const b = await device(h);
      const v = await vault(h, a.token);
      const res = await call(h, "GET", `/v1/vaults/${v}/heads`, { token: b.token });
      expect(res.status).toBe(404);
      expect((await err(res)).code).toBe("ES_NOT_FOUND");
      expect((await call(h, "GET", `/v1/vaults/${v}/heads`, { token: a.token })).status).toBe(200);
    });

    it.skipIf(skip)("devices_active is counted once a day", async () => {
      const me = await device(h);
      await call(h, "GET", "/v1/vaults", { token: me.token });
      await call(h, "GET", "/v1/vaults", { token: me.token });
      const count = async () =>
        (await h.meta.usage({ account: me.account }))
          .filter((r) => r.metric === "devices_active")
          .reduce((n, r) => n + Number(r.value), 0);
      expect(await count()).toBe(1);
      h.clock.advance(24 * 60 * 60 * 1000);
      await call(h, "GET", "/v1/vaults", { token: me.token });
      expect(await count()).toBe(2);
    });
  });

  describe("vaults and keys", () => {
    it.skipIf(skip)("lists, makes, keeps a proposed id, refuses a bad one", async () => {
      const me = await device(h);
      const res = await call(h, "POST", "/v1/vaults", { token: me.token, json: { name: "c2VhbGVk", id: "abcdefgh12" } });
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ id: "abcdefgh12", name: "c2VhbGVk", seq: 0, keyed: false });
      const list = (await (await call(h, "GET", "/v1/vaults", { token: me.token })).json()) as { vaults: { id: string }[] };
      expect(list.vaults.map((v) => v.id)).toEqual(["abcdefgh12"]);
      expect((await err(await call(h, "POST", "/v1/vaults", { token: me.token, json: { name: "x", id: "BAD" } }))).code).toBe(
        "ES_BAD_REQUEST",
      );
      expect((await err(await call(h, "POST", "/v1/vaults", { token: me.token, json: {} }))).code).toBe("ES_BAD_REQUEST");
    });

    it.skipIf(skip)("a key is ES_NOT_FOUND until set, then set once, then changed only with its etag", async () => {
      const me = await device(h);
      const v = await vault(h, me.token);
      expect((await err(await call(h, "GET", `/v1/vaults/${v}/key`, { token: me.token }))).code).toBe("ES_NOT_FOUND");
      const put = {
        wrapped: "d3JhcHBlZA",
        recovery: "cmVjb3Zlcnk",
        params: { kdf: "scrypt", N: 131072, r: 8, p: 1, salt: "c2FsdA" },
      };
      const first = await call(h, "PUT", `/v1/vaults/${v}/key`, { token: me.token, json: put });
      expect(first.status).toBe(200);
      const key = (await first.json()) as { etag: string };
      expect(key.etag).toBeTruthy();
      const got = (await (await call(h, "GET", `/v1/vaults/${v}/key`, { token: me.token })).json()) as typeof put & {
        etag: string;
      };
      expect(got).toMatchObject(put);
      const second = await call(h, "PUT", `/v1/vaults/${v}/key`, { token: me.token, json: put });
      expect(second.status).toBe(409);
      expect((await err(second)).code).toBe("ES_KEY_SET");
      expect(
        (await err(await call(h, "PUT", `/v1/vaults/${v}/key`, { token: me.token, json: { ...put, etag: "nope" } }))).code,
      ).toBe("ES_KEY_SET");
      const changed = await call(h, "PUT", `/v1/vaults/${v}/key`, {
        token: me.token,
        json: { ...put, wrapped: "bmV3", etag: key.etag },
      });
      expect(changed.status).toBe(200);
      expect(((await changed.json()) as { etag: string }).etag).not.toBe(key.etag);
      expect(
        (await err(await call(h, "PUT", `/v1/vaults/${v}/key`, { token: me.token, json: { ...put, params: { kdf: "md5" } } })))
          .code,
      ).toBe("ES_BAD_REQUEST");
      const vaults = (await (await call(h, "GET", "/v1/vaults", { token: me.token })).json()) as { vaults: { keyed: boolean }[] };
      expect(vaults.vaults[0]!.keyed).toBe(true);
    });
  });

  describe("blobs", () => {
    it.skipIf(skip)("put, head, get, idempotent, counted", async () => {
      const me = await device(h);
      const v = await vault(h, me.token);
      const id = wid("blob-one");
      const head0 = await h.app.request(`/v1/vaults/${v}/blobs/${id}`, {
        method: "HEAD",
        headers: { authorization: `Bearer ${me.token}` },
      });
      expect(head0.status).toBe(404);

      const put = await upload(h, me.token, v, id, bytes("sealed bytes"));
      expect(put.status).toBe(200);
      expect(await put.json()).toEqual({ ok: true, size: 12 });
      const head = await h.app.request(`/v1/vaults/${v}/blobs/${id}`, {
        method: "HEAD",
        headers: { authorization: `Bearer ${me.token}` },
      });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe("12");
      const got = await call(h, "GET", `/v1/vaults/${v}/blobs/${id}`, { token: me.token });
      expect(Buffer.from(await got.arrayBuffer()).toString()).toBe("sealed bytes");

      // A second upload of an id held reads nothing and answers the same.
      const again = await upload(h, me.token, v, id, bytes("other bytes!"));
      expect(await again.json()).toEqual({ ok: true, size: 12 });
      expect(
        Buffer.from(await (await call(h, "GET", `/v1/vaults/${v}/blobs/${id}`, { token: me.token })).arrayBuffer()).toString(),
      ).toBe("sealed bytes");

      const usage = await h.meta.usage({ account: me.account });
      const sum = (m: string) => usage.filter((r) => r.metric === m).reduce((n, r) => n + Number(r.value), 0);
      expect(sum("bytes_up")).toBe(12);
      expect(sum("bytes_down")).toBe(24);
    });

    it.skipIf(skip)("a bad id, a missing length, a short body and an oversized upload are refused", async () => {
      const me = await device(h);
      const v = await vault(h, me.token);
      expect((await err(await upload(h, me.token, v, "short", bytes("x")))).code).toBe("ES_BAD_REQUEST");
      expect((await err(await call(h, "GET", `/v1/vaults/${v}/blobs/${wid("absent")}`, { token: me.token }))).code).toBe(
        "ES_NOT_FOUND",
      );
      const noLength = await h.app.request(`/v1/vaults/${v}/blobs/${wid("nolen")}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${me.token}` },
        body: new ReadableStream({ start: (c) => (c.enqueue(bytes("abc")), c.close()) }),
        duplex: "half",
      } as RequestInit);
      expect(noLength.status).toBe(400);
      expect((await err(noLength)).code).toBe("ES_BAD_REQUEST");

      await h.meta.putPlan({ id: `small-${name}`, storage_bytes: null, history_days: null, max_file_bytes: 4, devices: null });
      await h.meta.setAccountPlan(me.account, `small-${name}`);
      const big = await upload(h, me.token, v, wid("big"), bytes("too big"));
      expect(big.status).toBe(413);
      expect((await err(big)).code).toBe("ES_QUOTA");
      // The server's own cap, whatever the plan: refused at the header, before the body.
      const huge = await call(h, "PUT", `/v1/vaults/${v}/blobs/${wid("huge")}`, {
        token: me.token,
        headers: { "content-length": String(h.config.maxBodyBytes + 1) },
      });
      expect((await err(huge)).code).toBe("ES_QUOTA");
    });
  });

  describe("commit, changes, heads", () => {
    it.skipIf(skip)("commits with gapless seqs, pages the log and the heads", async () => {
      const me = await device(h);
      const v = await vault(h, me.token);
      const ids = [wid("c1"), wid("c2"), wid("c3")];
      for (const [i, id] of ids.entries()) await upload(h, me.token, v, id, bytes(`content ${i}`));
      const keys = [wid("k1"), wid("k2"), wid("k3")];
      const one = await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: { changes: keys.map((key, i) => ({ key, parent: null, blob: ids[i], meta: "bWV0YQ" })) },
      });
      expect(one.status).toBe(200);
      expect(await one.json()).toEqual({ seqs: [1, 2, 3] });
      const two = await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: { changes: [{ key: keys[0], parent: 1, blob: null, meta: "ZGVs" }] },
      });
      expect(await two.json()).toEqual({ seqs: [4] });

      const p1 = (await (
        await call(h, "GET", `/v1/vaults/${v}/changes?since=0&limit=3`, { token: me.token })
      ).json()) as ChangesResponse;
      expect(p1.changes.map((c) => c.seq)).toEqual([1, 2, 3]);
      expect(p1).toMatchObject({ next: 3, more: true, head: 4, horizon: 1 });
      expect(p1.changes[0]).toMatchObject({
        key: keys[0],
        parent: null,
        blob: ids[0],
        size: 9,
        meta: "bWV0YQ",
        device: me.device,
      });
      const p2 = (await (
        await call(h, "GET", `/v1/vaults/${v}/changes?since=3&limit=3`, { token: me.token })
      ).json()) as ChangesResponse;
      expect(p2).toMatchObject({ next: 4, more: false });
      expect(p2.changes[0]).toMatchObject({ seq: 4, parent: 1, blob: null });
      const p3 = (await (await call(h, "GET", `/v1/vaults/${v}/changes?since=4`, { token: me.token })).json()) as ChangesResponse;
      expect(p3).toMatchObject({ changes: [], next: 4, more: false });
      expect((await err(await call(h, "GET", `/v1/vaults/${v}/changes?since=-1`, { token: me.token }))).code).toBe(
        "ES_BAD_REQUEST",
      );

      const sorted = [...keys].sort();
      const h1 = (await (await call(h, "GET", `/v1/vaults/${v}/heads?limit=2`, { token: me.token })).json()) as HeadsResponse;
      expect(h1.heads.map((x) => x.key)).toEqual(sorted.slice(0, 2));
      expect(h1.next).toBe(sorted[1]);
      expect(h1.seq).toBe(4);
      const h2 = (await (
        await call(h, "GET", `/v1/vaults/${v}/heads?after=${h1.next}&limit=2`, { token: me.token })
      ).json()) as HeadsResponse;
      expect(h2.heads.map((x) => x.key)).toEqual(sorted.slice(2));
      expect(h2.next).toBeNull();
      const deleted = [...h1.heads, ...h2.heads].find((x) => x.key === keys[0])!;
      expect(deleted).toMatchObject({ seq: 4, blob: null });

      const usage = await h.meta.usage({ account: me.account });
      const sum = (m: string) => usage.filter((r) => r.metric === m).reduce((n, r) => n + Number(r.value), 0);
      expect(sum("commits")).toBe(2);
      expect(sum("changes")).toBe(4);
    });

    it.skipIf(skip)("a stale parent is ES_STALE with every conflict, and writes nothing", async () => {
      const me = await device(h);
      const v = await vault(h, me.token);
      const blob = wid("s-blob");
      await upload(h, me.token, v, blob, bytes("x"));
      const [a, b] = [wid("s-a"), wid("s-b")];
      await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: { changes: [{ key: a, parent: null, blob, meta: "m" }] },
      });
      const res = await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: {
          changes: [
            { key: b, parent: null, blob, meta: "m" },
            { key: a, parent: null, blob, meta: "m" },
          ],
        },
      });
      expect(res.status).toBe(409);
      const e = await err(res);
      expect(e.code).toBe("ES_STALE");
      expect(e.conflicts).toEqual([{ key: a, head: 1, blob }]);
      const log = (await (
        await call(h, "GET", `/v1/vaults/${v}/changes?since=0`, { token: me.token })
      ).json()) as ChangesResponse;
      expect(log.head).toBe(1);
      expect((await h.meta.usage({ account: me.account })).some((r) => r.metric === "conflicts_stale")).toBe(true);
    });

    it.skipIf(skip)("a re-create over a delete head names the delete's seq; null there is stale", async () => {
      const me = await device(h);
      const v = await vault(h, me.token);
      const blob = wid("r-blob");
      await upload(h, me.token, v, blob, bytes("x"));
      const key = wid("r-key");
      await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: { changes: [{ key, parent: null, blob, meta: "m" }] },
      });
      await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: { changes: [{ key, parent: 1, blob: null, meta: "m" }] },
      });
      const wrong = await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: { changes: [{ key, parent: null, blob, meta: "m" }] },
      });
      expect(wrong.status).toBe(409);
      expect((await err(wrong)).conflicts).toEqual([{ key, head: 2, blob: null }]);
      const right = await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: { changes: [{ key, parent: 2, blob, meta: "m" }] },
      });
      expect(await right.json()).toEqual({ seqs: [3] });
    });

    it.skipIf(skip)("a blob not uploaded is ES_NO_BLOB with the missing ids", async () => {
      const me = await device(h);
      const v = await vault(h, me.token);
      const missing = wid("never-uploaded");
      const res = await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: { changes: [{ key: wid("n-key"), parent: null, blob: missing, meta: "m" }] },
      });
      expect(res.status).toBe(422);
      const e = await err(res);
      expect(e.code).toBe("ES_NO_BLOB");
      expect(e.missing).toEqual([missing]);
    });

    it.skipIf(skip)("a key twice, too many changes, or a bad shape is ES_BAD_REQUEST", async () => {
      const me = await device(h);
      const v = await vault(h, me.token);
      const key = wid("dup");
      const post = (changes: unknown) => call(h, "POST", `/v1/vaults/${v}/commit`, { token: me.token, json: { changes } });
      expect(
        (
          await err(
            await post([
              { key, parent: null, blob: null, meta: "m" },
              { key, parent: null, blob: null, meta: "m" },
            ]),
          )
        ).code,
      ).toBe("ES_BAD_REQUEST");
      const many = Array.from({ length: MAX_CHANGES + 1 }, (_, i) => ({
        key: wid(`many-${i}`),
        parent: null,
        blob: null,
        meta: "m",
      }));
      expect((await err(await post(many))).code).toBe("ES_BAD_REQUEST");
      expect((await err(await post([]))).code).toBe("ES_BAD_REQUEST");
      expect((await err(await post([{ key: "short", parent: null, blob: null, meta: "m" }]))).code).toBe("ES_BAD_REQUEST");
      expect((await err(await post([{ key, parent: "1", blob: null, meta: "m" }]))).code).toBe("ES_BAD_REQUEST");
      expect((await err(await post([{ key, parent: null, blob: "x", meta: "m" }]))).code).toBe("ES_BAD_REQUEST");
      expect((await err(await post([{ key, parent: null, blob: null }]))).code).toBe("ES_BAD_REQUEST");
    });

    it.skipIf(skip)("a storage limit refuses a commit past it with ES_QUOTA", async () => {
      const me = await device(h);
      const v = await vault(h, me.token);
      await h.meta.putPlan({ id: `tiny-${name}`, storage_bytes: 10, history_days: null, max_file_bytes: null, devices: null });
      await h.meta.setAccountPlan(me.account, `tiny-${name}`);
      const [small, large] = [wid("q-small"), wid("q-large")];
      await upload(h, me.token, v, small, bytes("12345678"));
      await upload(h, me.token, v, large, bytes("123456789012"));
      const key = wid("q-key");
      const ok = await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: { changes: [{ key, parent: null, blob: small, meta: "m" }] },
      });
      expect(ok.status).toBe(200);
      const over = await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: { changes: [{ key: wid("q-other"), parent: null, blob: large, meta: "m" }] },
      });
      expect(over.status).toBe(413);
      expect((await err(over)).code).toBe("ES_QUOTA");
      // A delete frees what its head held, so it is never refused.
      const replace = await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: { changes: [{ key, parent: 1, blob: null, meta: "m" }] },
      });
      expect(replace.status).toBe(200);
    });

    it.skipIf(skip)("a cursor before the horizon is ES_HORIZON once the collector compacted", async () => {
      const me = await device(h);
      const v = await vault(h, me.token);
      const key = wid("h-key");
      const blobs = [wid("h-1"), wid("h-2"), wid("h-3")];
      for (const b of blobs) await upload(h, me.token, v, b, bytes(b));
      let parent: number | null = null;
      for (const b of blobs) {
        const res = await call(h, "POST", `/v1/vaults/${v}/commit`, {
          token: me.token,
          json: { changes: [{ key, parent, blob: b, meta: "m" }] },
        });
        parent = ((await res.json()) as { seqs: number[] }).seqs[0]!;
      }
      await collect(h.meta, h.blobs, { historyDays: 30, now: new Date(h.clock.now.getTime() + 31 * 86_400_000) });
      const res = await call(h, "GET", `/v1/vaults/${v}/changes?since=0`, { token: me.token });
      expect(res.status).toBe(410);
      const e = await err(res);
      expect(e.code).toBe("ES_HORIZON");
      expect(e.horizon).toBe(3);
      const ok = (await (await call(h, "GET", `/v1/vaults/${v}/changes?since=2`, { token: me.token })).json()) as ChangesResponse;
      expect(ok.changes.map((c) => c.seq)).toEqual([3]);
    });
  });

  describe("poke", () => {
    it.skipIf(skip)("says the seq of a commit to its vault", async () => {
      const me = await device(h);
      const v = await vault(h, me.token);
      const res = await call(h, "GET", `/v1/vaults/${v}/poke`, { token: me.token });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const reader = res.body!.getReader();
      const blob = wid("p-blob");
      await upload(h, me.token, v, blob, bytes("x"));
      await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: { changes: [{ key: wid("p-key"), parent: null, blob, meta: "m" }] },
      });
      let text = "";
      while (!/data: /.test(text)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += Buffer.from(value).toString();
      }
      expect(text).toMatch(/data: \{"seq":1\}\n\n/);
      // And pings while nothing happens (50 ms in the tests).
      while (!/: ping/.test(text)) text += Buffer.from((await reader.read()).value!).toString();
      await reader.cancel();
      await new Promise((r) => setTimeout(r, 10));
      expect(h.hub.open).toBe(0);
    });

    it.skipIf(skip)(
      "is 204 when ANYDAG_SYNC_POKE=off",
      async () => {
        const off = await harness(name, { ANYDAG_SYNC_POKE: "off" });
        try {
          const me = await device(off);
          const v = await vault(off, me.token);
          expect((await call(off, "GET", `/v1/vaults/${v}/poke`, { token: me.token })).status).toBe(204);
        } finally {
          await off.close();
        }
      },
      60_000,
    );
  });

  describe("report and account", () => {
    it.skipIf(skip)("a report bumps the ledger, and the account says its plan and use", async () => {
      const me = await device(h);
      const v = await vault(h, me.token);
      expect((await call(h, "POST", `/v1/vaults/${v}/report`, { token: me.token, json: { copied: 2, merged: 3 } })).status).toBe(
        200,
      );
      expect(
        (await err(await call(h, "POST", `/v1/vaults/${v}/report`, { token: me.token, json: { copied: -1, merged: 0 } }))).code,
      ).toBe("ES_BAD_REQUEST");
      const usage = await h.meta.usage({ account: me.account });
      expect(usage.find((r) => r.metric === "conflicts_copied")).toMatchObject({ vault: v, value: 2 });
      expect(usage.find((r) => r.metric === "merged")).toMatchObject({ vault: v, value: 3 });

      const blob = wid("a-blob");
      await upload(h, me.token, v, blob, bytes("12345"));
      await call(h, "POST", `/v1/vaults/${v}/commit`, {
        token: me.token,
        json: { changes: [{ key: wid("a-key"), parent: null, blob, meta: "m" }] },
      });
      const info = await (await call(h, "GET", "/v1/account", { token: me.token })).json();
      expect(info).toMatchObject({
        id: me.account,
        plan: { id: "free", storage_bytes: null, devices: null },
        used: { storage_live: 5, devices: 1, vaults: 1 },
      });
    });
  });

  describe("admin and metrics", () => {
    const admin = { authorization: `Bearer ${ADMIN}` };

    it.skipIf(skip)(
      "refuses without the admin token, and is off without one configured",
      async () => {
        expect((await err(await call(h, "GET", "/v1/admin/accounts"))).code).toBe("ES_FORBIDDEN");
        const res = await call(h, "GET", "/metrics", { headers: { authorization: "Bearer wrong" } });
        expect(res.status).toBe(403);
        const me = await device(h);
        expect((await call(h, "GET", "/v1/admin/accounts", { token: me.token })).status).toBe(403);
        const off = await harness(name, { ANYDAG_SYNC_ADMIN_TOKEN: "" });
        try {
          expect((await err(await call(off, "GET", "/v1/admin/accounts", { headers: admin }))).code).toBe("ES_FORBIDDEN");
        } finally {
          await off.close();
        }
      },
      60_000,
    );

    it.skipIf(skip)("/metrics is Prometheus text with no ids in it", async () => {
      const me = await device(h);
      const v = await vault(h, me.token);
      const res = await call(h, "GET", "/metrics", { headers: admin });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toMatch(/^anydag_sync_requests_total\{route="\/v1\/vaults",method="POST",status="201"\} \d+$/m);
      expect(text).toMatch(/^anydag_sync_request_duration_seconds_count\{route="\/v1\/pair",method="POST"\} \d+$/m);
      expect(text).toMatch(/^anydag_sync_usage_today\{metric="devices_active",kind="counter"\} \d+$/m);
      expect(text).toContain('route="unmatched"');
      expect(text).not.toContain(v);
      expect(text).not.toContain(me.account);
    });

    it.skipIf(skip)("accounts, pairing, plans, usage and gc", async () => {
      const made = await call(h, "POST", "/v1/admin/accounts", { headers: admin, json: { name: `ops-${name}` } });
      expect(made.status).toBe(201);
      const acct = (await made.json()) as { id: string; plan: string; devices: number };
      expect(acct).toMatchObject({ plan: "free", devices: 0, vaults: 0 });
      expect(
        (await err(await call(h, "POST", "/v1/admin/accounts", { headers: admin, json: { name: `ops-${name}` } }))).code,
      ).toBe("ES_BAD_REQUEST");
      expect(
        (await err(await call(h, "POST", "/v1/admin/accounts", { headers: admin, json: { name: "x", plan: "nope" } }))).code,
      ).toBe("ES_NOT_FOUND");
      const list = (await (await call(h, "GET", "/v1/admin/accounts", { headers: admin })).json()) as {
        accounts: { name: string }[];
      };
      expect(list.accounts.some((a) => a.name === `ops-${name}`)).toBe(true);

      const pair = (await (
        await call(h, "POST", "/v1/admin/pair", { headers: admin, json: { account: `ops-${name}` } })
      ).json()) as { code: string; url: string };
      expect(pair.url).toBe("http://sync.test");
      const paired = await call(h, "POST", "/v1/pair", { json: { code: pair.code, device: { name: "d", platform: "p" } } });
      expect(paired.status).toBe(200);
      expect((await err(await call(h, "POST", "/v1/admin/pair", { headers: admin, json: { account: "nobody" } }))).code).toBe(
        "ES_NOT_FOUND",
      );

      const plan = await call(h, "PUT", `/v1/admin/plans/pro-${name}`, {
        headers: admin,
        json: { storage_bytes: 1000, devices: 5 },
      });
      expect(await plan.json()).toEqual({
        id: `pro-${name}`,
        storage_bytes: 1000,
        history_days: null,
        max_file_bytes: null,
        devices: 5,
      });
      const set = await call(h, "POST", `/v1/admin/accounts/${acct.id}/plan`, { headers: admin, json: { plan: `pro-${name}` } });
      expect(await set.json()).toMatchObject({ plan: `pro-${name}` });
      const both = await call(h, "PUT", "/v1/admin/plan", {
        headers: admin,
        json: { id: `max-${name}`, devices: 9, account: `ops-${name}` },
      });
      expect(both.status).toBe(200);
      expect((await h.meta.accountByName(`ops-${name}`))!.plan).toBe(`max-${name}`);
      expect((await err(await call(h, "PUT", "/v1/admin/plans/bad%20id", { headers: admin, json: {} }))).code).toBe(
        "ES_BAD_REQUEST",
      );

      const usage = (await (
        await call(h, "GET", `/v1/admin/usage?account=ops-${name}&since=2000-01-01`, { headers: admin })
      ).json()) as { usage: { metric: string }[] };
      expect(usage.usage.some((r) => r.metric === "devices_active")).toBe(false); // paired, not yet asked anything
      expect((await err(await call(h, "GET", "/v1/admin/usage?since=yesterday", { headers: admin }))).code).toBe(
        "ES_BAD_REQUEST",
      );

      const gc = await call(h, "POST", "/v1/admin/gc", { headers: admin });
      expect(await gc.json()).toMatchObject({
        compacted: expect.any(Number),
        blobs: expect.any(Number),
        bytes: expect.any(Number),
      });
    });
  });
});
