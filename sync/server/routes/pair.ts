/**
 * Health, pairing and devices: `GET /v1/health`, `POST /v1/pair`, `GET /v1/devices`,
 * `DELETE /v1/devices/{id}` — and the pairing code itself, which the admin route and the CLI mint.
 *
 * Load-bearing:
 * - **A code is 10 Crockford base32 characters, kept as the sha256 of its canonical form** (upper
 *   case, no dashes), and read the way a person types one: any case, dashes and spaces ignored, `O`
 *   as `0`, `I` and `L` as `1`. Fifty bits, used once, dead after `PAIR_MINUTES` — guessing one in
 *   fifteen minutes is not a plan. Shown as `XXXXX-XXXXX`, because it is read aloud.
 * - **A bad, used and expired code are one answer, `ES_PAIR`**: telling them apart tells a guesser
 *   which codes were real.
 * - **A device token is 32 random bytes, base64url, shown once.** The server keeps its sha256.
 * - **The device limit is checked after the code is taken**: the code names the account, and there
 *   is no other way to know which account's limit applies. A refused pairing therefore spends its
 *   code, and the operator mints another once a device is revoked — which is the order a person
 *   does it in anyway.
 */

import { randomBytes, randomInt } from "node:crypto";
import { Hono } from "hono";

import { PAIR_MINUTES, PROTOCOL, type Device, type DevicesResponse, type Health, type PairResponse } from "../../protocol/wire";
import type { DeviceRow, Meta } from "../meta/types";
import { sha256 } from "../auth";
import { body, HttpError, str, type Deps, type Vars } from "./http";

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The canonical form of a typed code, or `null` when it cannot be one. */
export function canonicalCode(typed: string): string | null {
  const clean = typed.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (clean.length !== 10) return null;
  for (const ch of clean) if (!B32.includes(ch)) return null;
  return clean;
}

export const codeHash = (canonical: string): string => sha256(`anydag-sync/pair:${canonical}`);

/** A fresh code for `account`, remembered by its hash. */
export async function mintPairCode(meta: Meta, account: string, now: Date): Promise<{ code: string; expires: string }> {
  let code = "";
  for (let i = 0; i < 10; i++) code += B32[randomInt(32)];
  const expires = new Date(now.getTime() + PAIR_MINUTES * 60_000).toISOString();
  await meta.addPairCode(account, codeHash(code), expires);
  return { code: `${code.slice(0, 5)}-${code.slice(5)}`, expires };
}

/** The wire's `Device`: the row without whose it is. */
export function wireDevice(d: DeviceRow, current?: string): Device {
  const out: Device = { id: d.id, name: d.name, platform: d.platform, created: d.created, seen: d.seen, revoked: d.revoked };
  if (current !== undefined) out.current = d.id === current;
  return out;
}

/** Devices that may still sync: what a plan's `devices` limit counts. */
export const live = (devices: DeviceRow[]): number => devices.filter((d) => !d.revoked).length;

export function pairRoutes(deps: Deps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();

  app.get("/v1/health", (c) => c.json({ version: deps.version, protocol: PROTOCOL, mode: deps.config.mode } satisfies Health));

  app.post("/v1/pair", async (c) => {
    const b = await body(c);
    const typed = str(b.code, "code", 64);
    const dev = b.device;
    if (typeof dev !== "object" || dev === null || Array.isArray(dev)) throw new HttpError("ES_BAD_REQUEST", "device must be {name, platform}");
    const name = str((dev as Record<string, unknown>).name, "device.name", 200);
    const platform = str((dev as Record<string, unknown>).platform, "device.platform", 100);
    const canonical = canonicalCode(typed);
    const now = deps.now();
    const accountId = canonical ? await deps.meta.takePairCode(codeHash(canonical), now.toISOString()) : null;
    if (!accountId) throw new HttpError("ES_PAIR", "that pairing code is unknown, used or expired: ask for a new one");
    const account = await deps.meta.account(accountId);
    if (!account) throw new HttpError("ES_PAIR", "that pairing code's account is gone");
    const plan = await deps.meta.plan(account.plan);
    if (plan.devices !== null && live(await deps.meta.devices(account.id)) >= plan.devices) {
      throw new HttpError("ES_QUOTA", `this account's plan allows ${plan.devices} device${plan.devices === 1 ? "" : "s"}: revoke one first`);
    }
    const token = randomBytes(32).toString("base64url");
    const row = await deps.meta.addDevice(account.id, name, platform, sha256(token));
    return c.json({ token, account: { id: account.id, name: account.name }, device: wireDevice(row) } satisfies PairResponse);
  });

  app.get("/v1/devices", async (c) => {
    const me = c.get("device");
    const devices = (await deps.meta.devices(me.account)).map((d) => wireDevice(d, me.id));
    return c.json({ devices } satisfies DevicesResponse);
  });

  app.delete("/v1/devices/:id", async (c) => {
    const me = c.get("device");
    const ok = await deps.meta.revokeDevice(me.account, c.req.param("id"), deps.now().toISOString());
    if (!ok) throw new HttpError("ES_NOT_FOUND", "no such device");
    return c.json({ ok: true });
  });

  return app;
}
