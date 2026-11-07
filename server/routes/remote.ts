/**
 * Remote access: the desktop's half, and a paired device's.
 *
 * | Route | Does |
 * |---|---|
 * | `GET /api/remote` | `{enabled, port, url, listening, problem}` |
 * | `PUT /api/remote` `{enabled?, port?, url?}` | changes it; the door opens, moves or closes at once |
 * | `POST /api/remote/pair` | a one-time code, `{code, expires, link}` — `link` is what the QR code holds |
 * | `GET /api/remote/tailscale` | `{installed, running, address, serving}` — what Tailscale says about this machine |
 * | `POST /api/remote/tailscale/serve` | `tailscale serve --bg <port>`: `{ok, message}`, Tailscale's own words |
 * | `GET /api/remote/devices` | `{devices: [{id, name, created, seen}]}` |
 * | `POST /api/remote/devices/revoke` `{id}` | `{revoked}`; the device is cut off now |
 * | `POST /api/device/pair` `{code, name?}` | the native app spending a code: `{device, token}` — the remote door only |
 * | `GET /api/device` | which device this is; `{device: null}` on the desktop's own door, so a page asks which door it is on without a 4xx |
 * | `POST /api/device/forget` | this device unpairs itself — the remote door only |
 *
 * The `/api/remote` routes are the local door's alone (`localOnly` in `server/remote.ts`): a phone
 * cannot pair another phone or switch the door it is standing in off.
 */

import type { IncomingMessage } from "node:http";

import type { Context, Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";

import type { Session } from "../context";
import { bodyOf, err } from "../http";
import { DEVICE_COOKIE, DEVICE_HEADER, type Device } from "../remote";
import { Tailscale } from "../tailscale";

export function remoteRoutes(app: Hono, s: Session, tailscale: Tailscale = new Tailscale()): void {
  app.get("/api/remote", (c) => c.json(s.remote.status()));

  app.get("/api/remote/tailscale", async (c) => c.json(await tailscale.state(s.remote.port())));

  app.post("/api/remote/tailscale/serve", async (c) => c.json(await tailscale.serve(s.remote.port())));

  app.put("/api/remote", async (c) => c.json(s.remote.configure(await bodyOf(c))));

  app.post("/api/remote/pair", (c) => c.json(s.remote.pairCode()));

  app.get("/api/remote/devices", (c) => c.json({ devices: s.remote.devices() }));

  app.post("/api/remote/devices/revoke", async (c) => c.json({ revoked: s.remote.revoke((await bodyOf(c)).id) }));
}

/** The desktop's own door is no paired device: the Devices tab asks this first, and a 4xx would be a console error. */
export function localDeviceRoute(app: Hono): void {
  app.get("/api/device", (c) => c.json({ device: null }));
}

/** The device a request on the remote door comes from; the gate has already said there is one. */
function deviceOf(c: Context, s: Session): Device {
  const device = s.remote.identify(c.req.header(DEVICE_HEADER) ?? getCookie(c, DEVICE_COOKIE));
  if (!device) throw err(401, "this device is not paired with this desktop", { code: "device" });
  return device;
}

/** A paired device's own routes. Registered on the remote door only. */
export function deviceRoutes(app: Hono, s: Session): void {
  app.post("/api/device/pair", async (c) => {
    const { code, name } = await bodyOf(c);
    return c.json(s.remote.pair(code, name));
  });

  app.get("/api/device", (c) => c.json({ device: deviceOf(c, s) }));

  app.post("/api/device/forget", (c) => {
    const device = deviceOf(c, s);
    deleteCookie(c, DEVICE_COOKIE, { path: "/" });
    /* Every other connection it holds is cut; this one answers first, and its next request is a 401. */
    s.remote.revoke(device.id, (c.env as { incoming?: IncomingMessage } | undefined)?.incoming?.socket);
    return c.json({ forgot: true });
  });
}
