/**
 * A device's account and its vaults: `GET/POST /v1/vaults`, `GET/PUT /v1/vaults/{v}/key`,
 * `POST /v1/vaults/{v}/report` and `GET /v1/account`.
 *
 * Load-bearing:
 * - **Everything a vault says about itself is sealed**: its `name`, its key's two wraps and its
 *   KDF salt are strings the server stores and hands back, and never reads. The checks here are of
 *   shape and size only.
 * - **The key is set once, then changed only by whoever holds its etag** (`ES_KEY_SET`
 *   otherwise): a second device uploading the same vault at the same moment must lose loudly,
 *   never overwrite the first one's key, or every file the first pushed would stop opening.
 * - **A vault id a device proposes is kept only when it has the server's shape** (ten characters
 *   of lower-case Crockford base32, the app's own); anything else is `ES_BAD_REQUEST`, because the
 *   id becomes a directory name in the blob store.
 */

import { Hono } from "hono";

import type { AccountInfo, KdfParams, PutVaultKey, RemoteVault, VaultsResponse } from "../../protocol/wire";
import type { VaultRow } from "../meta/types";
import { body, count, HttpError, isObject, str, type Deps, type Vars } from "./http";
import { live } from "./pair";

const SEALED_MAX = 64 * 1024;

function wireVault(v: VaultRow): RemoteVault {
  return { id: v.id, name: v.name, seq: Number(v.seq), created: v.created, keyed: v.keyed };
}

function params(v: unknown): KdfParams {
  if (!isObject(v)) throw new HttpError("ES_BAD_REQUEST", "params must be an object");
  const salt = str(v.salt, "params.salt", 1024);
  const n = (k: string): number => {
    const x = v[k];
    if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 1)
      throw new HttpError("ES_BAD_REQUEST", `params.${k} must be a whole number of at least 1`);
    return x;
  };
  if (v.kdf === "argon2id") return { kdf: "argon2id", m: n("m"), t: n("t"), p: n("p"), salt };
  if (v.kdf === "scrypt") return { kdf: "scrypt", N: n("N"), r: n("r"), p: n("p"), salt };
  throw new HttpError("ES_BAD_REQUEST", "params.kdf must be argon2id or scrypt");
}

export function vaultRoutes(deps: Deps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();

  app.get("/v1/vaults", async (c) => {
    const vaults = (await deps.meta.vaults(c.get("device").account)).map(wireVault);
    return c.json({ vaults } satisfies VaultsResponse);
  });

  app.post("/v1/vaults", async (c) => {
    const b = await body(c);
    const name = str(b.name, "name", SEALED_MAX);
    let id: string | undefined;
    if (b.id !== undefined && b.id !== null) {
      id = str(b.id, "id", 10, 10);
      if (!/^[0-9a-z]{10}$/.test(id))
        throw new HttpError("ES_BAD_REQUEST", "id must be ten characters of lower-case Crockford base32");
    }
    const row = await deps.meta.createVault(c.get("device").account, name, id);
    return c.json(wireVault(row) satisfies RemoteVault, 201);
  });

  app.get("/v1/vaults/:v/key", async (c) => {
    const key = await deps.meta.getKey(c.get("vault").id);
    if (!key) throw new HttpError("ES_NOT_FOUND", "this vault has no key yet");
    return c.json(key);
  });

  app.put("/v1/vaults/:v/key", async (c) => {
    const b = await body(c);
    const put: PutVaultKey = {
      wrapped: str(b.wrapped, "wrapped", SEALED_MAX),
      recovery: str(b.recovery, "recovery", SEALED_MAX),
      params: params(b.params),
    };
    if (b.etag !== undefined && b.etag !== null) put.etag = str(b.etag, "etag", 200);
    const key = await deps.meta.putKey(c.get("vault").id, put);
    if (!key)
      throw new HttpError(
        "ES_KEY_SET",
        put.etag
          ? "that etag is not the key's current one: read the key again"
          : "this vault already has a key: send its etag to change it",
      );
    return c.json(key);
  });

  app.post("/v1/vaults/:v/report", async (c) => {
    const b = await body(c);
    const copied = count(b.copied ?? 0, "copied");
    const merged = count(b.merged ?? 0, "merged");
    const v = c.get("vault");
    if (copied) await deps.usage.bump(v.account, v.id, "conflicts_copied", copied);
    if (merged) await deps.usage.bump(v.account, v.id, "merged", merged);
    return c.json({ ok: true });
  });

  app.get("/v1/account", async (c) => {
    const id = c.get("device").account;
    const account = await deps.meta.account(id);
    if (!account) throw new HttpError("ES_NOT_FOUND", "this device's account is gone");
    const [plan, storage, devices, vaults] = await Promise.all([
      deps.meta.plan(account.plan),
      deps.meta.storage(id),
      deps.meta.devices(id),
      deps.meta.vaults(id),
    ]);
    return c.json({
      id: account.id,
      name: account.name,
      plan,
      used: {
        storage_live: Number(storage.live),
        storage_history: Number(storage.history),
        devices: live(devices),
        vaults: vaults.length,
      },
    } satisfies AccountInfo);
  });

  return app;
}
