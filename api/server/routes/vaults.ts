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

import { CreateVault, PutVaultKey, Report } from "../../protocol/schema";
import type { AccountInfo, RemoteVault, VaultsResponse } from "../../protocol/wire";
import type { VaultRow } from "../meta/types";
import { HttpError, read, type Deps, type Vars } from "./http";
import { live } from "./pair";

function wireVault(v: VaultRow): RemoteVault {
  return { id: v.id, name: v.name, seq: Number(v.seq), created: v.created, keyed: v.keyed };
}

export function vaultRoutes(deps: Deps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();

  app.get("/v1/vaults", async (c) => {
    const vaults = (await deps.meta.vaults(c.get("device").account)).map(wireVault);
    return c.json({ vaults } satisfies VaultsResponse);
  });

  app.post("/v1/vaults", async (c) => {
    const { name, id } = await read(c, CreateVault);
    const row = await deps.meta.createVault(c.get("device").account, name, id);
    return c.json(wireVault(row) satisfies RemoteVault, 201);
  });

  app.get("/v1/vaults/:v/key", async (c) => {
    const key = await deps.meta.getKey(c.get("vault").id);
    if (!key) throw new HttpError("ES_NOT_FOUND", "this vault has no key yet");
    return c.json(key);
  });

  app.put("/v1/vaults/:v/key", async (c) => {
    const put = await read(c, PutVaultKey);
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
    const { copied, merged } = await read(c, Report);
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
        storage_pending: Number(storage.pending),
        storage_history: Number(storage.history),
        devices: live(devices),
        vaults: vaults.length,
      },
    } satisfies AccountInfo);
  });

  return app;
}
