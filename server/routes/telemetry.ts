/**
 * Logs: the person's answer, and the page's events.
 *
 * | Route | Does |
 * |---|---|
 * | `GET /api/telemetry` | `{consent, destination}` — `consent` is `null` until somebody answers |
 * | `PUT /api/telemetry` `{enabled}` | `true`, `false`, or `null` to be asked again |
 * | `POST /api/telemetry/events` `{events}` | the page's events, cleaned; `{accepted}`, `0` unless the answer is yes |
 *
 * All three are about the app rather than a vault (`UNSCOPED` in `app.ts`). See `server/telemetry.ts`.
 */

import type { Hono } from "hono";

import type { Session } from "../context";
import { bodyOf, err } from "../http";

export function telemetryRoutes(app: Hono, s: Session): void {
  app.get("/api/telemetry", (c) => c.json(s.telemetry.status()));

  app.put("/api/telemetry", async (c) => {
    const { enabled } = await bodyOf(c);
    if (enabled !== true && enabled !== false && enabled !== null)
      throw err(400, "`enabled` is true, false, or null to be asked again");
    return c.json(s.telemetry.setConsent(enabled));
  });

  app.post("/api/telemetry/events", async (c) => {
    const { events } = await bodyOf(c);
    if (!Array.isArray(events)) throw err(400, "expected `events` to be a list");
    return c.json({ accepted: s.telemetry.record(events) });
  });
}
