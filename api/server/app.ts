/**
 * The `anydag-api` Hono app: every `/v1` route, the auth in front of them, error mapping and the
 * per-route measurements. `createApp` takes its ports — `Meta`,
 * `Blobs`, the config, a clock — so a test runs it over PGlite and a temp directory with
 * `app.request(…)`, and `main.ts` over a real Postgres and a socket, with no difference between.
 *
 * Load-bearing:
 * - **Who may ask is decided by path, in one place**: `/v1`, `/v1/health`, `/v1/ready`, `/v1/logs`
 *   and `/v1/feedback` answer without a token of any kind; `/v1/pair` takes its code as its
 *   credential; `/v1/admin/*` and `/metrics` the admin token; every other `/v1/*` a device token, and
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
 * - **Every `/v1` answer says the protocol, and a device's request must say the same one**
 *   (`PROTOCOL_HEADER`), checked before who is asking: a client of another protocol — a 0.2.0 one
 *   sends none — is refused `ES_PROTOCOL`, never served a `meta` it would misread or let commit
 *   one this server's devices would refuse. `/v1`, `/v1/health`, `/v1/ready`, `/v1/logs`,
 *   `/v1/feedback`, the poke stream and `/v1/admin/*` carry nothing whose shape moved, and are not
 *   checked.
 * - **Latency is recorded by route template**, never by path (`metrics.ts`): `routePath(c, -1)`
 *   after the handler ran is the template that answered, and a request no route matched is
 *   `unmatched`.
 */

import { Hono } from "hono";
import { routePath } from "hono/route";

import { PROTOCOL, PROTOCOL_HEADER, STATUS } from "../protocol/wire";
import { admin, device, vault } from "./auth";
import type { Blobs } from "./blobs/types";
import type { Config } from "./config";
import type { Meta } from "./meta/types";
import { Metrics } from "./metrics";
import { adminRoutes } from "./routes/admin";
import { blobRoutes } from "./routes/blobs";
import { changeRoutes } from "./routes/changes";
import { commitRoutes } from "./routes/commit";
import { feedbackRoutes } from "./routes/feedback";
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
  /** How the feedback route reaches GitHub; a test hands in recorded answers. */
  fetch?: typeof fetch;
}

/** Routes any protocol may call: `/v1` and health say the protocol, a readiness probe sends none,
    and the rest carry nothing it changed. */
const ANY_PROTOCOL = new Set(["/v1", "/v1/health", "/v1/ready", "/v1/logs", "/v1/feedback"]);
const anyProtocol = (p: string): boolean =>
  ANY_PROTOCOL.has(p) || p.startsWith("/v1/admin/") || /^\/v1\/vaults\/[^/]+\/poke$/.test(p);

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
    // Here, outside every other layer, so a refusal `onError` answered says it too.
    if (c.req.path.startsWith("/v1/")) c.res.headers.set(PROTOCOL_HEADER, String(PROTOCOL));
  });

  app.use("/v1/*", async (c, next) => {
    if (!anyProtocol(c.req.path)) {
      const said = c.req.header(PROTOCOL_HEADER);
      if (said !== String(PROTOCOL))
        throw new HttpError(
          "ES_PROTOCOL",
          said === undefined
            ? `this sync server speaks sync protocol ${PROTOCOL}, and this client did not say which it speaks (AnyDag 0.2.0 or older): update AnyDag`
            : `this sync server speaks sync protocol ${PROTOCOL}, and this client speaks ${said}: update ${Number(said) > PROTOCOL ? "the sync server" : "AnyDag"}`,
        );
    }
    await next();
  });

  const asDevice = device(deps);
  /* Routes that answer whatever the switches say: /v1 itself, the two checks — and /v1/logs and
     /v1/feedback, which are features of their own (`ANYDAG_API_LOGS=off` and
     `ANYDAG_API_FEEDBACK=off` are their own 404s, and sync's switch is not their business). */
  const always = new Set(["/v1/health", "/v1/ready", "/v1/logs", "/v1/feedback"]);
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
    feedbackRoutes({ ...deps, ...(opts.fetch ? { fetch: opts.fetch } : {}) }),
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
