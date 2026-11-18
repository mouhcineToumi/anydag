/**
 * The local server: the page's own protocol, answered from a vault.
 *
 * The gate comes first and is the whole of the security model a local server has: the `Host` must
 * be this machine's (DNS rebinding), and every request to the API carries the per-launch token — a
 * header from the shell, the CLI, MCP and the Vite proxy, or the cookie a browser was handed once.
 * Then the routes, one module per family, all reading one `Session`; then the built page, for a
 * browser that is not behind Vite.
 *
 * **The cookie is bound to a secret path, not to the port** (#339). A cookie reaches every port of
 * `127.0.0.1`, so another local user listening on one could read it and replay it. The API is
 * therefore served twice: at the root, where only the header is taken, and under `/s/<secret>/`, a
 * path minted per launch that only the page `/?token=` sent there knows, where the cookie — set with
 * that `Path` — is taken too. The prefix is taken off before routing, so no route, log or error ever
 * sees it.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { routePath } from "hono/route";

import { Assistant } from "./chat/live";
import { defaultHarnesses } from "./chat/harnesses";
import type { Session } from "./context";
import { cloudOn } from "./features";
import { failure } from "./http";
import { scoped } from "./scope";
import { chatGuard, chatRoutes } from "./routes/chat";
import { docRoutes } from "./routes/docs";
import { eventRoutes } from "./routes/events";
import { feedbackRoutes } from "./routes/feedback";
import { fileRoutes } from "./routes/files";
import { folderRoutes } from "./routes/folders";
import { metaRoutes } from "./routes/meta";
import { syncRoutes } from "./routes/sync";
import { telemetryRoutes } from "./routes/telemetry";
import { tagRoutes } from "./routes/tags";
import { templateRoutes } from "./routes/templates";
import { vaultRoutes } from "./routes/vaults";
import { trashRoutes } from "./routes/trash";

export interface ServerOptions {
  session: Session;
  /** The per-launch secret every request to the API carries (`X-AnyDag-Token`, or the cookie a
   *  browser was handed once). */
  token: string;
  /** Where the built page is, or `null` to serve the API alone (behind Vite's dev server). */
  page: string | null;
  /** The Assistant's runtime; made here when not given. `main.ts` tells it the port once it listens. */
  assistant?: Assistant;
  /** How the server reaches the feedback relay (`server/feedback.ts`); a test hands in the relay itself. */
  fetch?: typeof fetch;
}

const COOKIE = "anydag_token";

/** The methods that change nothing: a page elsewhere may send them, and cannot read the answer. */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a browser says this request came from the page this server serves. `Sec-Fetch-Site` is
 * the browser's own answer and cannot be set by script; `Origin`, which every browser sends on a
 * cross-origin write, is the fallback for one that sends no `Sec-Fetch-*`. A client that sends
 * neither is not a browser on another page, which is the only sender of the cookie this guards.
 */
function ownOrigin(site: string | undefined, origin: string | undefined, host: string | undefined): boolean {
  if (site !== undefined && site !== "same-origin" && site !== "none") return false;
  if (origin !== undefined && origin !== `http://${host ?? ""}`) return false;
  return true;
}

/** The API under the launch's secret path: `/s/<secret>/__board/…`, `/s/<secret>/api/…`. */
const UNDER = /^\/s\/([^/]*)(\/.*)?$/;

/**
 * What a path is, read the way the router will read it and stricter: percent-decoded, every run of
 * slashes one slash, any case. A string test on the raw path is not enough — the router decodes, so
 * `/%61pi/vaults` was `/api/vaults` to the routes and a page path to the gate.
 *
 * - `api` — the routes', and spelled the one way they are (`/api/…`, `/__board/…`): the gate asks
 *   for a credential, then hands it to the routes.
 * - `odd` — the API any other way (`/%61pi`, `//api`, `/API`, `/api%2F…`), the secret path any way
 *   but its own, or a path that does not decode: refused whatever it carries. No client sends one.
 * - `page` — everything else, which only the page's own app answers.
 */
type Kind = "api" | "odd" | "page";
function kindOf(raw: string): Kind {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return "odd";
  }
  const seen = decoded.replace(/[\\/]+/g, "/").toLowerCase();
  /* The secret path spelled any way but its own (`/%73/…`, `//s/…`) is never the page either. */
  if (seen.startsWith("/s/")) return "odd";
  if (!(seen.startsWith("/api") || seen.startsWith("/__board"))) return "page";
  return raw.startsWith("/api/") || raw.startsWith("/__board/") ? "api" : "odd";
}

/** Two secrets compared in a time that does not say how much of one was right. */
function same(said: string | undefined, secret: string): boolean {
  if (said === undefined) return false;
  const a = Buffer.from(said);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The same request at another address. Spelled out rather than `new Request(url, raw)`: a request
 * `@hono/node-server` made is not the runtime's own, and the runtime's `Request` refuses to read one
 * as its init (`duplex`, Node 26).
 */
function moved(raw: Request, url: URL): Request {
  const init: RequestInit & { duplex?: "half" } = { method: raw.method, headers: raw.headers, signal: raw.signal };
  if (raw.method !== "GET" && raw.method !== "HEAD") {
    init.body = raw.body;
    init.duplex = "half";
  }
  return new Request(url, init);
}

const refused = (c: Context) => c.json({ error: "this server needs its token", code: "token" }, 401);
const odd = (c: Context) => c.json({ error: "not a path this server answers", code: "path" }, 400);

/**
 * The server: the gate, in front of the routes and the page. **It denies by default**: the routes are
 * reached only through the two branches below that have checked a credential, and they refuse any
 * request the gate did not hand them; everything else goes to the page's own app, which has no route
 * but the built page's files.
 *
 * - **`/s/<secret>/<api path>`** — the API for a browser on `anydag serve`. The secret must be this
 *   launch's, then the token comes as the header or as the cookie, whose `Path` is this prefix and
 *   which therefore no other port is sent; a write the cookie alone vouches for must still come from
 *   the page's own origin (#336). The prefix is taken off and the routes see the path they know.
 * - **`/<api path>`** — the API for the shell, the CLI, MCP and the Vite proxy: the header only. A
 *   cookie here is no credential, so one that reached another port is worth nothing as a cookie.
 * - **the API spelled any other way** (`kindOf`) — a 400, token or not.
 * - **`/?token=<token>`** — the address `anydag serve` prints. It answers with the cookie and a
 *   redirect to the same address without the token and with `#s=<secret>`, which the page keeps.
 * - **anything else** — the page and its assets, which hold nothing and answer without a credential;
 *   a 404 with no page.
 *
 * The secret is minted here, per app, and lives nowhere else: not in `server.json`, a log, the
 * console, a route's template or an error, and `Referrer-Policy: no-referrer` keeps an address under
 * it out of every `Referer`. A wrong one is a 401 that says nothing about the right one.
 */
export function createApp(opts: ServerOptions): Hono {
  /* The requests the gate let through, and only those: the routes refuse any other. */
  const passed = new WeakSet<Request>();
  const inner = routes(opts, passed);
  const page = pageApp(opts.page);
  const secret = randomBytes(24).toString("base64url");
  const scope = `/s/${secret}/`;
  const app = new Hono();
  const through = (c: Context, request: Request) => {
    passed.add(request);
    return inner.fetch(request, c.env);
  };

  app.use("*", async (c, next) => {
    await next();
    c.header("Referrer-Policy", "no-referrer");
  });

  app.all("*", async (c) => {
    // DNS rebinding: a page on evil.example resolved to 127.0.0.1 still says `Host: evil.example`.
    const host = (c.req.header("host") ?? "").replace(/:\d+$/, "");
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") return c.text("wrong host", 421);
    const url = new URL(c.req.url);
    const header = c.req.header("x-anydag-token");

    const under = UNDER.exec(url.pathname);
    if (under) {
      const rest = under[2] ?? "/";
      if (!same(under[1], secret)) return refused(c);
      const kind = kindOf(rest);
      if (kind === "odd") return odd(c);
      if (kind !== "api") return refused(c);
      if (!same(header ?? getCookie(c, COOKIE), opts.token)) return refused(c);
      // The page's own origin, still: the cookie is sent with a request a page on another port of
      // this host makes to the secret path, should that page ever learn it (#336).
      if (
        header === undefined &&
        !SAFE.has(c.req.method) &&
        !ownOrigin(c.req.header("sec-fetch-site"), c.req.header("origin"), c.req.header("host"))
      )
        return c.json({ error: "a write with the cookie must come from this page", code: "origin" }, 403);
      url.pathname = rest;
      return through(c, moved(c.req.raw, url));
    }

    const kind = kindOf(url.pathname);
    if (kind === "odd") return odd(c);
    if (kind === "api") {
      if (!same(header, opts.token)) return refused(c);
      return through(c, c.req.raw);
    }

    // A browser cannot send a header, so `anydag serve` prints an address with the token once. It is
    // swapped for the cookie on the secret path, the secret is handed to the page in the fragment —
    // never sent to a server, and kept by the page in its own origin's storage — and the token is
    // taken off the address.
    const once = c.req.query("token");
    if (once !== undefined && c.req.method === "GET") {
      if (!same(once, opts.token)) return c.text("wrong token", 401);
      setCookie(c, COOKIE, opts.token, { httpOnly: true, sameSite: "Strict", path: scope });
      // The cookie an older server set on `/`, which every port is sent: gone.
      deleteCookie(c, COOKIE, { path: "/" });
      url.searchParams.delete("token");
      return c.redirect(`${url.pathname}${url.search}#s=${secret}`);
    }
    return page.fetch(c.req.raw, c.env);
  });

  return app;
}

/**
 * The built page and nothing else: its files, and `index.html` for any other address, so a reload of
 * `/?board=…` draws the app. A file is served only from inside the folder, by its real path — no
 * `..`, link or neighbouring folder whose name begins the same reaches past it. No routes, no vault:
 * it holds nothing, which is why it answers without a credential. With no page, a 404.
 */
function pageApp(root: string | null): Hono {
  const app = new Hono();
  if (!root) {
    app.all("*", (c) => c.json({ error: "no page here" }, 404));
    return app;
  }
  const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".ico": "image/x-icon",
    ".mjs": "text/javascript; charset=utf-8",
  };
  const base = fs.realpathSync(root);
  const shell = path.join(base, "index.html");
  const inside = (rel: string): string | null => {
    try {
      const file = fs.realpathSync(path.resolve(base, rel));
      return file.startsWith(base + path.sep) && fs.statSync(file).isFile() ? file : null;
    } catch {
      return null;
    }
  };
  app.get("*", (c) => {
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+/, "");
    } catch {
      rel = "";
    }
    const file = (rel && inside(rel)) || shell;
    const ext = path.extname(file);
    return c.body(fs.readFileSync(file), 200, {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
    });
  });
  app.all("*", (c) => c.json({ error: "not found" }, 404));
  return app;
}

/**
 * The routes. {@link createApp}'s gate is the only way in, and they hold it to that: a request it did
 * not hand them (`passed`) is a 401 before any route, whatever its path says. Exported only so the
 * OpenAPI document's test can list what they register (`test/server/openapi.test.ts`): handed an
 * empty `passed`, they answer nothing but that 401.
 */
export function routes(opts: ServerOptions, passed: WeakSet<Request>): Hono {
  const s = opts.session;
  /* Read once per app: every route this app serves answers for the same process, whose environment
     does not change beneath it. A second app (a CLI's in-process serve) decides for itself. */
  const cloud = cloudOn(s.env);
  const app = new Hono();

  app.use("*", async (c, next) => {
    if (!passed.has(c.req.raw)) return refused(c);
    passed.delete(c.req.raw);
    await next();
  });

  /* -- logs: how each route answered, by its template, and only once somebody said yes --
     behind the `cloud` switch (`server/features.ts`), whose being off is "no server": not even the
     timings' template is recorded, and nothing is asked. */

  if (cloud) {
    const logs = s.telemetry;
    app.use("*", async (c, next) => {
      if (logs.consent() !== true) return next();
      const start = performance.now();
      await next();
      const template = routePath(c, -1);
      if (
        !template ||
        template === "*" ||
        template.endsWith("/*") ||
        !(template.startsWith("/__board") || template.startsWith("/api"))
      )
        return;
      logs.routeDone(`${c.req.method} ${template}`, c.res.status, performance.now() - start);
    });
  }

  /* -- a chat's own requests: its vault, its mode, its approvals, the recorder (`chat/live.ts`) -- */

  const assistant = opts.assistant ?? new Assistant({ session: s, token: opts.token, harnesses: defaultHarnesses(s.env) });
  chatGuard(app, assistant);

  /* -- which vault: `?vault=<id>`, or the one opened last (`context.ts`) ----------------------- */

  app.use("*", async (c, next) => {
    if (!scoped(c.req.path)) return next();
    return s.within(c.req.query("vault"), () => next());
  });

  docRoutes(app, s);
  folderRoutes(app, s);
  fileRoutes(app, s);
  metaRoutes(app, s);
  eventRoutes(app, s);
  vaultRoutes(app, s);
  trashRoutes(app, s);
  templateRoutes(app, s);
  tagRoutes(app, s);
  if (cloud) {
    syncRoutes(app, s);
    telemetryRoutes(app, s);
    feedbackRoutes(app, s, opts.fetch);
  }
  chatRoutes(app, assistant);

  app.onError((e, c) => {
    try {
      return failure(c, e);
    } catch (unknown) {
      /* Not a refusal any route meant: a defect, and the one kind of error worth a log. Behind the
         `cloud` switch (`server/features.ts`) the recorder is inert, so even with a stored consent
         of yes nothing is held or sent — `Telemetry.fail` reads the switch first. */
      const template = routePath(c, -1);
      s.telemetry.fail(unknown, template && template !== "*" ? `${c.req.method} ${template}` : undefined);
      throw unknown;
    }
  });
  app.notFound((c) => c.json({ error: `no route ${c.req.method} ${c.req.path}` }, 404));

  return app;
}
