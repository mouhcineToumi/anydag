/**
 * The `anydag-api` Hono app: every `/v1` route, the auth in front of them, error mapping and the
 * per-route measurements. `createApp` takes its ports — `Meta`,
 * `Blobs`, the config, a clock — so a test runs it over PGlite and a temp directory with
 * `app.request(…)`, and `main.ts` over a real Postgres and a socket, with no difference between.
 *
 * Load-bearing:
 * - **Who may ask is decided by path, in one place**: `/v1`, `/v1/health`, `/v1/ready` and
 *   `/v1/logs` answer without a token of any kind; `/v1/pair` takes its code as its credential;
 *   `/v1/admin/*` and `/metrics` the admin token; every other `/v1/*` a device token, and
 *   `/v1/vaults/{v}/*` also a vault of that device's account. A route added under `/v1/` is behind
 *   a device token by default; forgetting is never a hole.
 * - **A feature that is `off` does not exist**: with `ANYDAG_API_SYNC=off` every sync route —
 *   pairing, devices, vaults, and `/v1/admin/*` and `/metrics`, which only look at sync's data —
 *   answers `ES_NOT_FOUND` before any token is read, so discovery of what is switched off does not
 *   start with a `401`. `ANYDAG_API_LOGS=off` and `ANYDAG_API_FEEDBACK=off` are their routes' own gates.
 * - **Errors are answered by one handler**: an `HttpError` becomes `{code, message, ...extra}` at
 *   `STATUS[code]`; anything else is a 500 carrying a message and no `code` (no `ES_*` describes
 *   it, and the client retries a 5xx without one) and never the stack, which goes to stderr. An unknown route is
 *   `ES_NOT_FOUND`, in the same shape, so a client never parses an HTML page.
 * - **Latency is recorded by route template**, never by path (`metrics.ts`): `routePath(c, -1)`
 *   after the handler ran is the template that answered, and a request no route matched is
 *   `unmatched`.
 */

import { Hono } from "hono";
import { routePath } from "hono/route";

import { STATUS } from "../protocol/wire";
import { admin, device, vault } from "./auth";
import type { Blobs } from "./blobs/types";
import type { Config } from "./config";
import type { Meta } from "./meta/types";
import { Metrics } from "./metrics";
import { adminRoutes } from "./routes/admin";
import { blobRoutes } from "./routes/blobs";
import { changeRoutes } from "./routes/changes";
import { commitRoutes } from "./routes/commit";
import { HttpError, type Deps, type Vars } from "./routes/http";
import { logRoutes } from "./routes/logs";
import { pairRoutes } from "./routes/pair";
import { PokeHub, pokeRoutes } from "./routes/poke";
import { serviceRoutes } from "./routes/service";
import { vaultRoutes } from "./routes/vaults";
import { Usage } from "./usage";

declare const __ANYDAG_API_VERSION__: string;
export const VERSION = typeof __ANYDAG_API_VERSION__ === "string" ? __ANYDAG_API_VERSION__ : "dev";

export interface AppOptions {
  meta: Meta;
  blobs: Blobs;
  config: Config;
  now?: () => Date;
  hub?: PokeHub;
  metrics?: Metrics;
  version?: string;
  pingMs?: number;
  ageOf?: (vault: string, id: string) => Promise<number | null>;
}

export function createApp(opts: AppOptions): Hono<{ Variables: Vars }> & { deps: Deps } {
  const now = opts.now ?? (() => new Date());
  const metrics = opts.metrics ?? new Metrics();
  const hub = opts.hub ?? new PokeHub();
  metrics.pokes = () => hub.open;
  const deps: Deps = {
    meta: opts.meta,
    blobs: opts.blobs,
    config: opts.config,
    now,
    hub,
    usage: new Usage(opts.meta, now),
    metrics,
    version: opts.version ?? VERSION,
    pingMs: opts.pingMs ?? 20_000,
    ...(opts.ageOf ? { ageOf: opts.ageOf } : {}),
  };

  const app = new Hono<{ Variables: Vars }>();

  app.use("*", async (c, next) => {
    const start = performance.now();
    await next();
    const template = routePath(c, -1);
    const route = !template || template === "*" || template.endsWith("/*") ? "unmatched" : template;
    metrics.record(route, c.req.method, c.res.status, (performance.now() - start) / 1000);
  });

  const asDevice = device(deps);
  /* Routes that answer whatever the switches say: /v1 itself, the two checks — and /v1/logs,
     which is its own feature (`ANYDAG_API_LOGS=off` is the 404 of its own, and sync's switch is
     not its business). */
  const always = new Set(["/v1/health", "/v1/ready", "/v1/logs"]);
  app.use("/v1/*", async (c, next) => {
    const p = c.req.path;
    if (p === "/v1" || always.has(p)) return next();
    if (!deps.config.sync) throw new HttpError("ES_NOT_FOUND", "this server does not run sync");
    /* Pairing carries its code as its credential; the admin routes the admin token. */
    if (p === "/v1/pair" || p.startsWith("/v1/admin/")) return next();
    return asDevice(c, next);
  });
  app.use("/v1/vaults/:v/*", vault(deps));
  const asAdmin = admin(deps);
  app.use("/v1/admin/*", asAdmin);
  app.use("/metrics", async (c, next) => {
    if (!deps.config.sync) throw new HttpError("ES_NOT_FOUND", "this server does not run sync");
    return asAdmin(c, next);
  });

  for (const sub of [
    serviceRoutes(deps),
    pairRoutes(deps),
    logRoutes(deps),
    vaultRoutes(deps),
    blobRoutes(deps),
    commitRoutes(deps),
    changeRoutes(deps),
    pokeRoutes(deps),
  ])
    app.route("/", sub);
  app.route("/", adminRoutes(deps) as unknown as Hono<{ Variables: Vars }>);

  app.notFound((c) => c.json({ code: "ES_NOT_FOUND", message: `no route ${c.req.method} ${c.req.path}` }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ ...err.extra, code: err.code, message: err.message }, STATUS[err.code] as 400);
    console.error(`anydag-api: ${c.req.method} ${c.req.path}:`, err);
    return c.json({ message: "the server failed to answer this request" }, 500);
  });

  return Object.assign(app, { deps });
}
