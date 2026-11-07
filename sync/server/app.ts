/**
 * The `anydag-sync` Hono app: every `/v1` route, the auth in front of them, error mapping and the
 * per-route measurements. `createApp` takes its ports — `Meta`,
 * `Blobs`, the config, a clock — so a test runs it over PGlite and a temp directory with
 * `app.request(…)`, and `main.ts` over a real Postgres and a socket, with no difference between.
 *
 * Load-bearing:
 * - **Who may ask is decided by path, in one place**: `/v1/health`, `/v1/pair` and `/v1/logs` are open,
 *   `/v1/admin/*` and `/metrics` take the admin token, every other `/v1/*` a device token, and
 *   `/v1/vaults/{v}/*` also a vault of that device's account. A route added under `/v1/` is behind
 *   a device token by default; forgetting is never a hole.
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
import { vaultRoutes } from "./routes/vaults";
import { Usage } from "./usage";

declare const __ANYDAG_SYNC_VERSION__: string;
export const VERSION = typeof __ANYDAG_SYNC_VERSION__ === "string" ? __ANYDAG_SYNC_VERSION__ : "dev";

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

const OPEN = new Set(["/v1/health", "/v1/pair", "/v1/logs"]);

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
  app.use("/v1/*", async (c, next) => {
    const p = c.req.path;
    if (OPEN.has(p) || p.startsWith("/v1/admin/")) return next();
    return asDevice(c, next);
  });
  app.use("/v1/vaults/:v/*", vault(deps));
  const asAdmin = admin(deps);
  app.use("/v1/admin/*", asAdmin);
  app.use("/metrics", asAdmin);

  for (const sub of [pairRoutes(deps), logRoutes(deps), vaultRoutes(deps), blobRoutes(deps), commitRoutes(deps), changeRoutes(deps), pokeRoutes(deps)]) app.route("/", sub);
  app.route("/", adminRoutes(deps) as unknown as Hono<{ Variables: Vars }>);

  app.notFound((c) => c.json({ code: "ES_NOT_FOUND", message: `no route ${c.req.method} ${c.req.path}` }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ ...err.extra, code: err.code, message: err.message }, STATUS[err.code] as 400);
    console.error(`anydag-sync: ${c.req.method} ${c.req.path}:`, err);
    return c.json({ message: "the server failed to answer this request" }, 500);
  });

  return Object.assign(app, { deps });
}
