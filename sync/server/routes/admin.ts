/**
 * The operator's routes, behind the admin token (`auth.ts`): `/v1/admin/accounts`, `…/pair`,
 * `…/plans/{id}` and `…/plan`, `…/accounts/{id}/plan`, `…/usage`, `…/gc` — and `GET /metrics`.
 *
 * The CLI (`cli.ts`) does each of these against the database directly, with the same helpers, so a
 * server need not be running to make an account; these are the same acts for an operator who only
 * has the server's URL and its admin token.
 *
 * Load-bearing:
 * - **An account is named by its id or its name**, whichever the operator has: an id is looked up
 *   first. A name is unique (the table says so), so the two cannot disagree.
 * - **A plan is data and nothing else**: `PUT …/plans/{id}` writes the limits (null is unlimited),
 *   and only `…/plan` assigns one. An unknown plan id is `ES_NOT_FOUND` on assignment rather than a
 *   foreign-key 500 — `Meta.plan` answers `free` for an unknown id, so the check is that the plan
 *   that came back is the one asked for.
 * - **`PUT /v1/admin/plan`** is the one-call form the CLI's `plan set --account` mirrors: a `Plan`,
 *   and an optional `account` to put on it. `wire.ts` names the two-call form; both are here.
 */

import { Hono } from "hono";

import type { AdminAccount, AdminPair, Plan, UsageResponse } from "../../protocol/wire";
import type { Account, Meta } from "../meta/types";
import { collect } from "../gc";
import { body, HttpError, str, type Deps } from "./http";
import { live, mintPairCode } from "./pair";

export async function findAccount(meta: Meta, ref: string): Promise<Account | null> {
  return (await meta.account(ref)) ?? (await meta.accountByName(ref));
}

export async function adminAccount(meta: Meta, a: Account): Promise<AdminAccount> {
  const [devices, vaults] = await Promise.all([meta.devices(a.id), meta.vaults(a.id)]);
  return { id: a.id, name: a.name, plan: a.plan, created: a.created, devices: live(devices), vaults: vaults.length };
}

/** Whether a plan by this id exists (not merely `free` answering for it). */
export async function planExists(meta: Meta, id: string): Promise<boolean> {
  return (await meta.plan(id)).id === id;
}

const LIMITS = ["storage_bytes", "history_days", "max_file_bytes", "devices"] as const;

export function parsePlan(id: string, v: Record<string, unknown>): Plan {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id)) throw new HttpError("ES_BAD_REQUEST", "a plan id is 1 to 64 letters, digits, dots, dashes or underscores");
  const plan: Plan = { id, storage_bytes: null, history_days: null, max_file_bytes: null, devices: null };
  for (const k of LIMITS) {
    const x = v[k];
    if (x === undefined || x === null) continue;
    if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 0) throw new HttpError("ES_BAD_REQUEST", `${k} must be a whole number of at least 0, or null for unlimited`);
    plan[k] = x;
  }
  return plan;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function adminRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get("/v1/admin/accounts", async (c) => {
    const accounts = await Promise.all((await deps.meta.accounts()).map((a) => adminAccount(deps.meta, a)));
    return c.json({ accounts });
  });

  app.post("/v1/admin/accounts", async (c) => {
    const b = await body(c);
    const name = str(b.name, "name", 100);
    if (!/^[A-Za-z0-9_.@-]+$/.test(name)) throw new HttpError("ES_BAD_REQUEST", "an account name is letters, digits, dots, dashes, underscores and @");
    const plan = b.plan === undefined || b.plan === null ? undefined : str(b.plan, "plan", 64);
    if (plan !== undefined && !(await planExists(deps.meta, plan))) throw new HttpError("ES_NOT_FOUND", `no plan ${plan}`);
    if (await deps.meta.accountByName(name)) throw new HttpError("ES_BAD_REQUEST", `an account called ${name} exists`);
    const a = await deps.meta.createAccount(name, plan);
    return c.json(await adminAccount(deps.meta, a), 201);
  });

  app.post("/v1/admin/pair", async (c) => {
    const b = await body(c);
    const a = await findAccount(deps.meta, str(b.account, "account", 100));
    if (!a) throw new HttpError("ES_NOT_FOUND", "no such account");
    const { code, expires } = await mintPairCode(deps.meta, a.id, deps.now());
    return c.json({ code, expires, url: deps.config.publicUrl } satisfies AdminPair);
  });

  app.put("/v1/admin/plans/:id", async (c) => {
    const plan = parsePlan(c.req.param("id"), await body(c));
    await deps.meta.putPlan(plan);
    return c.json(plan);
  });

  app.put("/v1/admin/plan", async (c) => {
    const b = await body(c);
    const plan = parsePlan(str(b.id, "id", 64), b);
    await deps.meta.putPlan(plan);
    if (b.account !== undefined && b.account !== null) {
      const a = await findAccount(deps.meta, str(b.account, "account", 100));
      if (!a) throw new HttpError("ES_NOT_FOUND", "no such account");
      await deps.meta.setAccountPlan(a.id, plan.id);
    }
    return c.json(plan);
  });

  app.post("/v1/admin/accounts/:id/plan", async (c) => {
    const b = await body(c);
    const a = await findAccount(deps.meta, c.req.param("id"));
    if (!a) throw new HttpError("ES_NOT_FOUND", "no such account");
    const plan = str(b.plan, "plan", 64);
    if (!(await planExists(deps.meta, plan))) throw new HttpError("ES_NOT_FOUND", `no plan ${plan}`);
    await deps.meta.setAccountPlan(a.id, plan);
    return c.json(await adminAccount(deps.meta, { ...a, plan }));
  });

  app.get("/v1/admin/usage", async (c) => {
    const filter: { account?: string; since?: string; until?: string } = {};
    const account = c.req.query("account");
    if (account) {
      const a = await findAccount(deps.meta, account);
      if (!a) throw new HttpError("ES_NOT_FOUND", "no such account");
      filter.account = a.id;
    }
    for (const k of ["since", "until"] as const) {
      const d = c.req.query(k);
      if (!d) continue;
      if (!DAY.test(d)) throw new HttpError("ES_BAD_REQUEST", `${k} must be YYYY-MM-DD`);
      filter[k] = d;
    }
    const usage = (await deps.meta.usage(filter)).map((r) => ({ ...r, value: Number(r.value) }));
    return c.json({ usage } satisfies UsageResponse);
  });

  app.post("/v1/admin/gc", async (c) => {
    const opts = { historyDays: deps.config.historyDays, now: deps.now(), ...(deps.ageOf ? { ageOf: deps.ageOf } : {}) };
    return c.json(await collect(deps.meta, deps.blobs, opts));
  });

  app.get("/metrics", async (c) => {
    const text = await deps.metrics.text(deps.meta, deps.now(), deps.version);
    return c.body(text, 200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
  });

  return app;
}
