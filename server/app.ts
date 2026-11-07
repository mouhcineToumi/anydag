/**
 * The local server: the page's own protocol, answered from a vault.
 *
 * The gate comes first and is the whole of the security model a local server has: the `Host` must
 * be this machine's (DNS rebinding), and every request carries the per-launch token — a header from
 * the shell and the CLI, a cookie a browser was handed once. Then the routes, one module per family,
 * all reading one `Session`; then the built page, for a browser that is not behind Vite.
 *
 * The same routes answer a second door, `door: "remote"`, behind a gate of its own: a paired
 * device's token instead of the launch token, and a few routes refused (`server/remote.ts`).
 */

import fs from "node:fs";
import path from "node:path";

import type { IncomingMessage } from "node:http";

import { Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { routePath } from "hono/route";

import { Assistant } from "./chat/live";
import { defaultHarnesses } from "./chat/harnesses";
import type { Session } from "./context";
import { failure, Http } from "./http";
import { browserName, DEVICE_COOKIE, DEVICE_HEADER, localOnly } from "./remote";
import { chatGuard, chatRoutes } from "./routes/chat";
import { docRoutes } from "./routes/docs";
import { eventRoutes } from "./routes/events";
import { fileRoutes } from "./routes/files";
import { folderRoutes } from "./routes/folders";
import { metaRoutes } from "./routes/meta";
import { deviceRoutes, localDeviceRoute, remoteRoutes } from "./routes/remote";
import { syncRoutes } from "./routes/sync";
import { telemetryRoutes } from "./routes/telemetry";
import { vaultRoutes } from "./routes/vaults";
import { trashRoutes } from "./routes/trash";

export interface ServerOptions {
  session: Session;
  /** The per-launch secret every request carries (`X-AnyDag-Token`, or the cookie a browser was
   *  handed once). */
  token: string;
  /** Where the built page is, or `null` to serve the API alone (behind Vite's dev server). */
  page: string | null;
  /** The Assistant's runtime; made here when not given. `main.ts` tells it the port once it listens. */
  assistant?: Assistant;
  /** Which door this is: the local one (the default), or the one a paired phone reaches. */
  door?: "local" | "remote";
}

const COOKIE = "anydag_token";

/** The routes about the app rather than one vault: they answer with no vault open. */
const UNSCOPED = ["/api/health", "/api/vaults", "/api/settings", "/api/auth/me", "/api/telemetry", "/api/remote", "/api/device"];

/** A device cookie lasts as long as a browser lets one: Chromium caps it at 400 days. */
const DEVICE_COOKIE_DAYS = 400;

const hostOf = (raw: string | undefined): string => (raw ?? "").replace(/:\d+$/, "");

export function createApp(opts: ServerOptions): Hono {
  const s = opts.session;
  const app = new Hono();

  /* -- the gate: the Host, then the token --------------------------------------------------- */

  const remote = opts.door === "remote";
  if (remote) app.use("*", remoteGate(s));
  else app.use("*", async (c, next) => {
    // DNS rebinding: a page on evil.example resolved to 127.0.0.1 still says `Host: evil.example`.
    const host = hostOf(c.req.header("host"));
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") return c.text("wrong host", 421);
    // A browser cannot send a header, so `anydag serve` prints a URL with the token once; it is
    // swapped for a cookie and the address cleaned.
    const once = c.req.query("token");
    if (once !== undefined && c.req.method === "GET" && !c.req.path.startsWith("/__board") && !c.req.path.startsWith("/api")) {
      if (once !== opts.token) return c.text("wrong token", 401);
      setCookie(c, COOKIE, opts.token, { httpOnly: true, sameSite: "Strict", path: "/" });
      const url = new URL(c.req.url);
      url.searchParams.delete("token");
      return c.redirect(url.pathname + url.search);
    }
    const said = c.req.header("x-anydag-token") ?? getCookie(c, COOKIE);
    if (said !== opts.token) return c.json({ error: "this server needs its token", code: "token" }, 401);
    await next();
  });

  /* -- logs: how each route answered, by its template, and only once somebody said yes ---------- */

  const logs = s.telemetry;
  app.use("*", async (c, next) => {
    if (logs.consent() !== true) return next();
    const start = performance.now();
    await next();
    const template = routePath(c, -1);
    if (!template || template === "*" || template.endsWith("/*") || !(template.startsWith("/__board") || template.startsWith("/api"))) return;
    logs.routeDone(`${c.req.method} ${template}`, c.res.status, performance.now() - start);
  });

  /* -- a chat's own requests: its vault, its mode, its approvals, the recorder (`chat/live.ts`) -- */

  const assistant = opts.assistant ?? new Assistant({ session: s, token: opts.token, harnesses: defaultHarnesses(s.env) });
  chatGuard(app, assistant);

  /* -- which vault: `?vault=<id>`, or the one opened last (`context.ts`) ----------------------- */

  app.use("*", async (c, next) => {
    const p = c.req.path;
    const scoped = p.startsWith("/__board") || (p.startsWith("/api/") && !UNSCOPED.some((u) => p === u || p.startsWith(`${u}/`)));
    if (!scoped) return next();
    return s.within(c.req.query("vault"), () => next());
  });

  docRoutes(app, s);
  folderRoutes(app, s);
  fileRoutes(app, s);
  metaRoutes(app, s);
  eventRoutes(app, s);
  vaultRoutes(app, s);
  trashRoutes(app, s);
  syncRoutes(app, s);
  telemetryRoutes(app, s);
  remoteRoutes(app, s);
  if (remote) deviceRoutes(app, s);
  else localDeviceRoute(app);
  chatRoutes(app, assistant);

  /* -- the page ---------------------------------------------------------------------------- */

  if (opts.page) {
    const root = opts.page;
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
    app.get("*", (c, next) => {
      if (c.req.path.startsWith("/__board") || c.req.path.startsWith("/api")) return next();
      const rel = decodeURIComponent(c.req.path).replace(/^\/+/, "");
      let file = path.resolve(root, rel);
      if (!file.startsWith(root) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) file = path.join(root, "index.html");
      const ext = path.extname(file);
      return c.body(fs.readFileSync(file), 200, {
        "content-type": TYPES[ext] ?? "application/octet-stream",
        "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
      });
    });
  }

  app.onError((e, c) => {
    try {
      return failure(c, e);
    } catch (unknown) {
      /* Not a refusal any route meant: a defect, and the one kind of error worth a log. */
      const template = routePath(c, -1);
      logs.fail(unknown, template && template !== "*" ? `${c.req.method} ${template}` : undefined);
      throw unknown;
    }
  });
  app.notFound((c) => c.json({ error: `no route ${c.req.method} ${c.req.path}` }, 404));

  return app;
}

/**
 * The remote door's gate: the `Host`, the setting, then a paired device — or a pairing code being
 * spent. What the local door's gate is to the launch token, this is to a device's (`remote.ts`).
 */
function remoteGate(s: Session): MiddlewareHandler {
  return async (c, next) => {
    const r = s.remote;
    if (!r.hostAllowed(hostOf(c.req.header("host")))) return c.text("wrong host", 421);
    if (!r.enabled()) return c.json({ error: "remote access is off on this desktop", code: "remote-off" }, 503);
    /* A chat's requests come over loopback on the local door; on this one the header is a forgery. */
    if (c.req.header("x-anydag-chat") !== undefined) return c.json({ error: "a chat's requests are the desktop's own", code: "chat" }, 400);
    const path = c.req.path;
    const api = path.startsWith("/__board") || path.startsWith("/api");
    /* The one route open without a device: the native app spending a code. */
    if (c.req.method === "POST" && path === "/api/device/pair") return next();
    /* A browser spends one by opening the address in the QR code; it is swapped for a cookie. */
    const once = c.req.query("pair");
    if (once !== undefined && c.req.method === "GET" && !api) {
      let token: string;
      try {
        token = r.pair(once, c.req.query("name") || browserName(c.req.header("user-agent"))).token;
      } catch (e) {
        if (e instanceof Http) return c.text(e.message, e.status as 401);
        throw e;
      }
      const https = r.url()?.startsWith("https:") || c.req.header("x-forwarded-proto") === "https";
      setCookie(c, DEVICE_COOKIE, token, { httpOnly: true, sameSite: "Strict", secure: https, path: "/", maxAge: DEVICE_COOKIE_DAYS * 86_400 });
      const url = new URL(c.req.url);
      url.searchParams.delete("pair");
      url.searchParams.delete("name");
      return c.redirect(url.pathname + url.search);
    }
    const device = r.identify(c.req.header(DEVICE_HEADER) ?? getCookie(c, DEVICE_COOKIE));
    if (!device) return c.json({ error: "this device is not paired with this desktop", code: "device" }, 401);
    if (localOnly(c.req.method, path)) return c.json({ error: "only the desktop itself can do this", code: "local-only" }, 403);
    /* Held, so revoking the device cuts this connection — the change feed's included. */
    r.hold(device.id, (c.env as { incoming?: IncomingMessage } | undefined)?.incoming?.socket);
    await next();
  };
}
