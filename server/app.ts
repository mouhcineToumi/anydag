/**
 * The local server: the page's own protocol, answered from a vault.
 *
 * The gate comes first and is the whole of the security model a local server has: the `Host` must
 * be this machine's (DNS rebinding), and every request carries the per-launch token — a header from
 * the shell and the CLI, a cookie a browser was handed once. Then the routes, one module per family,
 * all reading one `Session`; then the built page, for a browser that is not behind Vite.
 */

import fs from "node:fs";
import path from "node:path";

import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import { Assistant } from "./chat/live";
import { defaultHarnesses } from "./chat/harnesses";
import type { Session } from "./context";
import { failure } from "./http";
import { chatGuard, chatRoutes } from "./routes/chat";
import { docRoutes } from "./routes/docs";
import { eventRoutes } from "./routes/events";
import { fileRoutes } from "./routes/files";
import { folderRoutes } from "./routes/folders";
import { metaRoutes } from "./routes/meta";
import { syncRoutes } from "./routes/sync";
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
}

const COOKIE = "anydag_token";

/** The routes about the app rather than one vault: they answer with no vault open. */
const UNSCOPED = ["/api/health", "/api/vaults", "/api/settings", "/api/auth/me"];

export function createApp(opts: ServerOptions): Hono {
  const s = opts.session;
  const app = new Hono();

  /* -- the gate: the Host, then the token --------------------------------------------------- */

  app.use("*", async (c, next) => {
    // DNS rebinding: a page on evil.example resolved to 127.0.0.1 still says `Host: evil.example`.
    const host = (c.req.header("host") ?? "").replace(/:\d+$/, "");
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

  app.onError((e, c) => failure(c, e));
  app.notFound((c) => c.json({ error: `no route ${c.req.method} ${c.req.path}` }, 404));

  return app;
}
