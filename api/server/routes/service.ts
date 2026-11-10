/**
 * The routes every kind of caller needs before any feature: `GET /v1` and `GET /v1/ready`, open
 * like `/v1/health`.
 *
 * Load-bearing:
 * - **`GET /v1` is how the app tells what this server runs without trying it.** `feedback` there
 *   is the relay's *availability*, not its switch: on without the GitHub token or repo is
 *   reported `false`, answering as the relay would (#50), so a client never sends into a 503.
 * - **`/v1/ready` asks the database, not the process.** `/v1/health` answers when the process is
 *   up; ready answers when it can serve — the check a proxy and a compose healthcheck watch. A
 *   failing database is logged in full on stderr and answered a plain 503, never the error's own
 *   words, which could carry an address.
 */

import { Hono } from "hono";

import { type Info, type Ready } from "../../protocol/wire";
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

  return app;
}
