/**
 * `/api/sync` (the contract is `server/sync/types.ts`): the current vault's link to a
 * sync server — its status, pairing, the remote vaults the account holds, linking and unlinking,
 * a sync now, and the account's devices. Every route is the current vault's (`?vault=`).
 *
 * The meaning is in `server/sync/link.ts`; these only read the body and answer. A sync server's
 * refusal comes back with its `ES_*` in `code`, and a passphrase or a recovery code that does not
 * open the key is a 400 in a sentence.
 */

import type { Hono } from "hono";

import type { Session } from "../context";
import { bodyOf } from "../http";
import { devices, link, now, pair, remotes, revoke, unlink } from "../sync/link";

export function syncRoutes(app: Hono, s: Session): void {
  app.get("/api/sync", (c) => c.json(s.sync.status(s.vault)));

  app.post("/api/sync/pair", async (c) => c.json(await pair(s.sync, s.vault, await bodyOf(c))));

  app.get("/api/sync/remotes", async (c) => c.json(await remotes(s.sync, s.vault)));

  app.post("/api/sync/link", async (c) => c.json(await link(s.sync, s, s.vault, await bodyOf(c))));

  app.post("/api/sync/unlink", async (c) => c.json(await unlink(s.sync, s.vault)));

  app.post("/api/sync/now", async (c) => c.json(await now(s.sync, s.vault)));

  app.get("/api/sync/devices", async (c) => c.json(await devices(s.sync, s.vault)));

  app.post("/api/sync/devices/revoke", async (c) => c.json(await revoke(s.sync, s.vault, (await bodyOf(c)).id)));
}
