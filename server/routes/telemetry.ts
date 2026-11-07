/**
 * Logs: the person's answer, and the page's events.
 *
 * | Route | Does |
 * |---|---|
 * | `GET /api/telemetry` | `{consent, destination, answerable}` — `consent` is `null` until somebody answers; `answerable` is false on the remote door |
 * | `PUT /api/telemetry` `{enabled}` | `true`, `false`, or `null` to be asked again |
 * | `POST /api/telemetry/events` `{events}` | the page's events, cleaned; `{accepted}`, `0` unless the answer is yes |
 *
 * All three are about the app rather than a vault (`UNSCOPED` in `app.ts`). See `server/telemetry.ts`.
 */

import type { Hono } from "hono";

import type { Session } from "../context";
import { bodyOf, err } from "../http";

/**
 * `remote` is the phone's door. The answer is this install's and is given on the desktop — `PUT` is
 * `localOnly` there — so the phone is told `answerable: false` and neither asks nor offers the switch:
 * a question it cannot answer is a modal it cannot close.
 */
export function telemetryRoutes(app: Hono, s: Session, remote = false): void {
  app.get("/api/telemetry", (c) => c.json({ ...s.telemetry.status(), answerable: !remote }));

  app.put("/api/telemetry", async (c) => {
    const { enabled } = await bodyOf(c);
    if (enabled !== true && enabled !== false && enabled !== null) throw err(400, "`enabled` is true, false, or null to be asked again");
    return c.json({ ...s.telemetry.setConsent(enabled), answerable: true });
  });

  app.post("/api/telemetry/events", async (c) => {
    const { events } = await bodyOf(c);
    if (!Array.isArray(events)) throw err(400, "expected `events` to be a list");
    return c.json({ accepted: s.telemetry.record(events) });
  });
}
