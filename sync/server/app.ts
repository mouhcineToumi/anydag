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
 * - **Every `/v1` answer says the protocol, and a device's request must say the same one**
 *   (`PROTOCOL_HEADER`), checked before who is asking: a client of another protocol — a 0.2.0 one
 *   sends none — is refused `ES_PROTOCOL`, never served a `meta` it would misread or let commit
 *   one this server's devices would refuse. `/v1/health`, `/v1/logs`, the poke stream and
 *   `/v1/admin/*` carry nothing whose shape moved, and are not checked.
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
/** Routes any protocol may call: health says the protocol, and the rest carry nothing it changed. */
const ANY_PROTOCOL = new Set(["/v1/health", "/v1/logs"]);
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
  app.use("/v1/*", async (c, next) => {
    const p = c.req.path;
    if (OPEN.has(p) || p.startsWith("/v1/admin/")) return next();
    return asDevice(c, next);
  });
  app.use("/v1/vaults/:v/*", vault(deps));
  const asAdmin = admin(deps);
  app.use("/v1/admin/*", asAdmin);
  app.use("/metrics", asAdmin);

  for (const sub of [
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
    console.error(`anydag-sync: ${c.req.method} ${c.req.path}:`, err);
    return c.json({ message: "the server failed to answer this request" }, 500);
  });

  return Object.assign(app, { deps });
}
