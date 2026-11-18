/**
 * The routes every kind of caller needs before any feature: `GET /v1`, `GET /v1/ready` and
 * `GET /v1/openapi.json`, open like `/v1/health`.
 *
 * Load-bearing:
 * - **`GET /v1` is how the app tells what this server runs without trying it.** `feedback` there
 *   is the relay's *availability*, not its switch: on without the GitHub token or repo is
 *   reported `false`, answering as the relay would (#50), so a client never sends into a 503.
 * - **`/v1/ready` asks the database, not the process.** `/v1/health` answers when the process is
 *   up; ready answers when it can serve — the check a proxy and a compose healthcheck watch. A
 *   failing database is logged in full on stderr and answered a plain 503, never the error's own
 *   words, which could carry an address.
 * - **`/v1/openapi.json` is this server's own document** (`../openapi.ts`): made once, on the first
 *   request, for the switches it runs with, so a feature that is off is not in it.
 */

import { Hono } from "hono";

import type { Json } from "../../openapi/document";
import { type Info, type Ready } from "../../protocol/wire";
import { syncDocument } from "../openapi";
import type { Deps, Vars } from "./http";

/** The three feature switches, as `GET /v1` reports them. */
function features(deps: Deps): Info["features"] {
  const { sync, logs } = deps.config;
  const feedback = deps.config.feedback && deps.config.feedbackToken !== null && deps.config.feedbackRepo !== null;
  return { sync, logs, feedback };
}

export function serviceRoutes(deps: Deps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();

  app.get("/v1", (c) => c.json({ name: "anydag-api", version: deps.version, features: features(deps) } satisfies Info));

  app.get("/v1/ready", async (c) => {
    try {
      await deps.meta.ping();
      return c.json({ ok: true } satisfies Ready);
    } catch (e) {
      console.error(`anydag-api: /v1/ready failed: ${(e as Error).message}`);
      return c.json({ ok: false } satisfies Ready, 503);
    }
  });

  let document: Json | null = null;
  app.get("/v1/openapi.json", (c) => {
    const { sync, logs, feedback } = deps.config;
    document ??= syncDocument({ sync, logs, feedback });
    return c.json(document);
  });

  return app;
}
