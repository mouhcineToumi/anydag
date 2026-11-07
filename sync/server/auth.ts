/**
 * Who is asking: a device by its bearer token, a vault it may
 * touch, or the operator by the admin token.
 *
 * Load-bearing:
 * - **A token is never stored, only its sha256**, so a copy of the database pairs nobody. The
 *   lookup is by that hash; there is no secret to compare in constant time on the device side,
 *   because a hash index answers the same way whatever prefix matched.
 * - **Unknown and revoked are one answer, `ES_AUTH`.** A revoked device stops at its next request
 *   — its own revocation included — and the client's loop pauses on the 401 and says so.
 * - **Another account's vault does not exist for you**: `Meta.vault(account, id)` answers `null`
 *   for it, and that is `ES_NOT_FOUND`, never `ES_FORBIDDEN`. A 403 would confirm the id is real.
 * - **`devices_active` is counted on the first request of the day**, which `touchDevice` decides
 *   in the database, so two requests racing at midnight count once.
 * - **The admin token is compared in constant time**, over sha256s of both sides so the lengths
 *   match. No admin token configured means the admin routes answer `ES_FORBIDDEN` to everybody.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

import { HttpError, today, type Deps, type Vars } from "./routes/http";

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function bearer(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1]! : null;
}

/** Every device route: the token → a live device, put on the context, and seen today. */
export function device(deps: Deps): MiddlewareHandler<{ Variables: Vars }> {
  return async (c, next) => {
    const token = bearer(c.req.header("authorization"));
    if (!token) throw new HttpError("ES_AUTH", "this route needs a device token (Authorization: Bearer …)");
    const found = await deps.meta.deviceByToken(sha256(token));
    if (!found) throw new HttpError("ES_AUTH", "this device token is not known here");
    if (found.revoked) throw new HttpError("ES_AUTH", "this device was revoked: pair it again");
    if (await deps.meta.touchDevice(found.id, today(deps.now()))) await deps.usage.bump(found.account, null, "devices_active", 1);
    c.set("device", found);
    await next();
  };
}

/** Every `/v1/vaults/:v/*` route: the vault, if it is this device's account's. */
export function vault(deps: Deps): MiddlewareHandler<{ Variables: Vars }> {
  return async (c, next) => {
    const id = c.req.param("v") ?? "";
    const found = /^[0-9a-z]{10}$/.test(id) ? await deps.meta.vault(c.get("device").account, id) : null;
    if (!found) throw new HttpError("ES_NOT_FOUND", "no such vault");
    c.set("vault", found);
    await next();
  };
}

/** `/v1/admin/*` and `/metrics`: the operator's token, compared in constant time. */
export function admin(deps: Deps): MiddlewareHandler {
  return async (c, next) => {
    const want = deps.config.adminToken;
    if (!want) throw new HttpError("ES_FORBIDDEN", "the admin routes are off: set ANYDAG_SYNC_ADMIN_TOKEN to turn them on");
    const got = bearer(c.req.header("authorization")) ?? "";
    const a = createHash("sha256").update(want).digest();
    const b = createHash("sha256").update(got).digest();
    if (!timingSafeEqual(a, b)) throw new HttpError("ES_FORBIDDEN", "this route needs the admin token");
    await next();
  };
}
