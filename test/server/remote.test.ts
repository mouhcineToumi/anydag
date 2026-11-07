/** Remote access: the second door, its gate, pairing and devices (`server/remote.ts`). */
import "./sqlite-shim";
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { browserName, deviceName, localOnly, originOf, PAIR_TTL_MS, REMOTE_PORT } from "../../server/remote";
import { makeEnv, sweepTemps, type Env } from "./helpers";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  vi.useRealTimers();
  await env.cleanup();
  sweepTemps();
});

type Call = (method: string, url: string, opts?: { body?: unknown; headers?: Record<string, string> }) => Promise<{ status: number; body: Record<string, unknown>; res: Response }>;

function doors() {
  const session = new Session(env.home, env.vault, "0.1.0", {});
  const local = createApp({ session, token: "t", page: null });
  const remote = createApp({ session, token: "t", page: null, door: "remote" });
  const caller =
    (app: typeof local, base: Record<string, string>): Call =>
    async (method, url, opts = {}) => {
      const res = await app.request(`http://127.0.0.1${url}`, {
        method,
        redirect: "manual",
        headers: { "content-type": "application/json", host: "127.0.0.1", ...base, ...opts.headers },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      });
      const text = await res.clone().text();
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        body = { text };
      }
      return { status: res.status, body, res };
    };
  return { session, desk: caller(local, { "x-anydag-token": "t" }), phone: caller(remote, {}) };
}

/** Remote access on, a code made on the desktop and spent by the phone: the phone's token. */
async function paired(d: ReturnType<typeof doors>, name = "Pixel"): Promise<string> {
  await d.desk("PUT", "/api/remote", { body: { enabled: true } });
  const { code } = (await d.desk("POST", "/api/remote/pair")).body as { code: string };
  const got = await d.phone("POST", "/api/device/pair", { body: { code, name } });
  expect(got.status).toBe(200);
  return (got.body as { token: string }).token;
}

describe("the setting", () => {
  it("is off, on 4319, with no address, until somebody says", async () => {
    const d = doors();
    expect((await d.desk("GET", "/api/remote")).body).toEqual({ enabled: false, port: REMOTE_PORT, url: null, listening: false, problem: null });
    const on = await d.desk("PUT", "/api/remote", { body: { enabled: true, port: 5000, url: "https://desk.tail1234.ts.net/anything" } });
    expect(on.body).toMatchObject({ enabled: true, port: 5000, url: "https://desk.tail1234.ts.net" });
    /* A new session on the same home reads it back. */
    expect((await doors().desk("GET", "/api/remote")).body).toMatchObject({ enabled: true, port: 5000 });
    expect((await d.desk("PUT", "/api/remote", { body: { port: 80 } })).status).toBe(400);
    expect((await d.desk("PUT", "/api/remote", { body: { url: "ftp://x" } })).status).toBe(400);
    expect((await d.desk("PUT", "/api/remote", { body: { enabled: "yes" } })).status).toBe(400);
    expect((await d.desk("PUT", "/api/remote", { body: { url: null, port: null } })).body).toMatchObject({ url: null, port: REMOTE_PORT });
  });

  it("tells whoever runs the door when it changes", () => {
    const d = doors();
    const heard = vi.fn();
    d.session.remote.onChange(heard);
    d.session.remote.configure({ enabled: true });
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("the remote door", () => {
  it("is closed while remote access is off, and wants a device once it is on", async () => {
    const d = doors();
    expect((await d.phone("GET", "/api/health")).status).toBe(503);
    await d.desk("PUT", "/api/remote", { body: { enabled: true } });
    expect((await d.phone("GET", "/api/health")).body.code).toBe("device");
    /* The launch token is the local door's, and opens nothing here. */
    expect((await d.phone("GET", "/api/health", { headers: { "x-anydag-token": "t" } })).status).toBe(401);
  });

  it("answers a paired device, by header", async () => {
    const d = doors();
    const token = await paired(d);
    expect(token).toMatch(/^adv_/);
    const me = await d.phone("GET", "/api/device", { headers: { "x-anydag-device": token } });
    expect((me.body.device as { name: string }).name).toBe("Pixel");
    expect((await d.phone("GET", "/__board/list", { headers: { "x-anydag-device": token } })).status).toBe(200);
  });

  it("takes only this machine's names and the address a phone opens", async () => {
    const d = doors();
    const token = await paired(d);
    const as = (host: string) => d.phone("GET", "/api/health", { headers: { "x-anydag-device": token, host } });
    expect((await as("evil.example")).status).toBe(421);
    expect((await as("desk.tail1234.ts.net")).status).toBe(421);
    await d.desk("PUT", "/api/remote", { body: { url: "https://desk.tail1234.ts.net" } });
    expect((await as("desk.tail1234.ts.net")).status).toBe(200);
    expect((await as("DESK.tail1234.ts.net:443")).status).toBe(200);
    expect((await as("localhost:4319")).status).toBe(200);
  });

  it("refuses what only the desktop may do", async () => {
    const d = doors();
    const headers = { "x-anydag-device": await paired(d) };
    for (const [method, url] of [
      ["GET", "/api/remote"],
      ["PUT", "/api/remote"],
      ["POST", "/api/remote/pair"],
      ["GET", "/api/remote/devices"],
      ["POST", "/api/vaults/open"],
      ["POST", "/api/vaults/close"],
      ["POST", "/api/sync/link"],
      ["PUT", "/api/telemetry"],
    ] as const) {
      const got = await d.phone(method, url, { headers, ...(method === "GET" ? {} : { body: {} }) });
      expect([url, got.body.code]).toEqual([url, "local-only"]);
    }
    /* Reading the same things is the phone's too. */
    const logs = await d.phone("GET", "/api/telemetry", { headers });
    expect([logs.status, logs.body.answerable]).toEqual([200, false]);
    expect((await d.phone("GET", "/api/vaults", { headers })).status).toBe(200);
  });

  it("refuses a chat's header, which only the desktop's own harness sends", async () => {
    const d = doors();
    const headers = { "x-anydag-device": await paired(d), "x-anydag-chat": "c1" };
    expect((await d.phone("GET", "/api/health", { headers })).status).toBe(400);
  });

  it("is no device on the local door, and spends no code there", async () => {
    const d = doors();
    const me = await d.desk("GET", "/api/device");
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ device: null });
    expect((await d.desk("POST", "/api/device/pair", { body: {} })).status).toBe(404);
  });
});

describe("pairing", () => {
  it("swaps the QR code's address for a cookie, in a browser", async () => {
    const d = doors();
    await d.desk("PUT", "/api/remote", { body: { enabled: true, url: "https://desk.tail1234.ts.net" } });
    const made = (await d.desk("POST", "/api/remote/pair")).body as { code: string; link: string };
    expect(made.link).toBe(`https://desk.tail1234.ts.net/?pair=${made.code}`);
    const opened = await d.phone("GET", `/?board=plan&pair=${made.code}&name=Safari`);
    expect(opened.status).toBe(302);
    expect(opened.res.headers.get("location")).toBe("/?board=plan");
    const cookie = opened.res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/anydag_device=adv_[^;]+; Max-Age=\d+; Path=\/; HttpOnly; Secure; SameSite=Strict/);
    const jar = cookie.split(";")[0]!;
    expect((await d.phone("GET", "/api/device", { headers: { cookie: jar } })).body.device).toMatchObject({ name: "Safari" });
  });

  it("is one use, one live code, and five minutes", async () => {
    vi.useFakeTimers();
    const d = doors();
    await d.desk("PUT", "/api/remote", { body: { enabled: true } });
    const first = ((await d.desk("POST", "/api/remote/pair")).body as { code: string }).code;
    const second = ((await d.desk("POST", "/api/remote/pair")).body as { code: string }).code;
    expect((await d.phone("POST", "/api/device/pair", { body: { code: first } })).status).toBe(401);
    expect((await d.phone("POST", "/api/device/pair", { body: { code: second } })).status).toBe(200);
    expect((await d.phone("POST", "/api/device/pair", { body: { code: second } })).status).toBe(401);
    const third = ((await d.desk("POST", "/api/remote/pair")).body as { code: string }).code;
    vi.advanceTimersByTime(PAIR_TTL_MS + 1);
    expect((await d.phone("POST", "/api/device/pair", { body: { code: third } })).status).toBe(401);
  });

  it("burns a code after five wrong tries", async () => {
    const d = doors();
    await d.desk("PUT", "/api/remote", { body: { enabled: true } });
    const { code } = (await d.desk("POST", "/api/remote/pair")).body as { code: string };
    for (let i = 0; i < 5; i++) expect((await d.phone("POST", "/api/device/pair", { body: { code: `nope${i}` } })).status).toBe(401);
    expect((await d.phone("POST", "/api/device/pair", { body: { code } })).status).toBe(401);
  });

  it("makes no code while remote access is off, and turning it off burns the live one", async () => {
    const d = doors();
    expect((await d.desk("POST", "/api/remote/pair")).body.code).toBe("remote-off");
    await d.desk("PUT", "/api/remote", { body: { enabled: true } });
    const { code } = (await d.desk("POST", "/api/remote/pair")).body as { code: string };
    await d.desk("PUT", "/api/remote", { body: { enabled: false } });
    await d.desk("PUT", "/api/remote", { body: { enabled: true } });
    expect((await d.phone("POST", "/api/device/pair", { body: { code } })).status).toBe(401);
  });

  it("keeps only the token's hash", async () => {
    const d = doors();
    const token = await paired(d);
    const rows = env.home.db.prepare("select * from devices").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});

describe("devices", () => {
  it("lists, and revoking one shuts it out at once", async () => {
    const d = doors();
    const token = await paired(d);
    const other = await paired(d, "iPad");
    const { devices } = (await d.desk("GET", "/api/remote/devices")).body as { devices: { id: string; name: string }[] };
    expect(devices.map((x) => x.name)).toEqual(["Pixel", "iPad"]);
    expect((await d.desk("POST", "/api/remote/devices/revoke", { body: { id: devices[0]!.id } })).body).toEqual({ revoked: true });
    expect((await d.phone("GET", "/api/health", { headers: { "x-anydag-device": token } })).status).toBe(401);
    expect((await d.phone("GET", "/api/health", { headers: { "x-anydag-device": other } })).status).toBe(200);
    expect((await d.desk("POST", "/api/remote/devices/revoke", { body: { id: devices[0]!.id } })).body).toEqual({ revoked: false });
  });

  it("can forget itself", async () => {
    const d = doors();
    const token = await paired(d);
    expect((await d.phone("POST", "/api/device/forget", { headers: { "x-anydag-device": token } })).body).toEqual({ forgot: true });
    expect((await d.phone("GET", "/api/health", { headers: { "x-anydag-device": token } })).status).toBe(401);
    expect(((await d.desk("GET", "/api/remote/devices")).body.devices as unknown[]).length).toBe(0);
  });

  it("cuts every connection a revoked device holds", () => {
    const d = doors();
    d.session.remote.configure({ enabled: true });
    const { device } = d.session.remote.pair(d.session.remote.pairCode().code, "Pixel");
    const sockets = [0, 1, 2].map(() => Object.assign(new EventEmitter(), { destroyed: false, destroy: vi.fn() }) as unknown as Socket);
    for (const s of sockets) d.session.remote.hold(device.id, s);
    sockets[2]!.emit("close");
    d.session.remote.revoke(device.id, sockets[1]);
    expect(sockets.map((s) => (s.destroy as unknown as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 0, 0]);
  });
});

describe("the rules", () => {
  it("reads an address down to its origin", () => {
    expect(originOf(" https://desk.ts.net:8443/x?y ")).toBe("https://desk.ts.net:8443");
    expect(originOf("https://u:p@desk.ts.net")).toBeNull();
    expect(originOf("desk.ts.net")).toBeNull();
    expect(originOf(42)).toBeNull();
  });

  it("names a device on one short line", () => {
    expect(deviceName("  My\nphone ")).toBe("My phone");
    expect(deviceName("")).toBe("A device");
    expect(deviceName("x".repeat(100))).toHaveLength(60);
  });

  it("calls a browser that paired by link what its user agent says it is, never the string", () => {
    expect(browserName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe("iPhone");
    expect(browserName("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36")).toBe("Android phone");
    expect(browserName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18 Mobile/15E148 Safari/604.1")).toBe("iPad");
    expect(browserName(undefined)).toBe("A browser");
  });

  it("keeps the desktop's own routes to the desktop", () => {
    expect(localOnly("GET", "/api/vaults")).toBe(false);
    expect(localOnly("POST", "/api/vaults/open")).toBe(true);
    expect(localOnly("GET", "/api/remote/devices")).toBe(true);
    expect(localOnly("POST", "/api/sync/now")).toBe(false);
    expect(localOnly("GET", "/api/telemetry")).toBe(false);
  });
});

describe("a file somebody else put in the vault", () => {
  /* An SVG is a document that can carry script. Opened as a page on the remote door it would run on the
     app's own origin with the device's cookie, so every route that serves vault bytes sends it
     sandboxed — the legacy picture folders included, which had no guard at all. */
  it("is sandboxed on the legacy picture route, and anything but a picture is a download", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = env.vault.root;
    fs.mkdirSync(path.join(root, "plan.assets"), { recursive: true });
    fs.writeFileSync(path.join(root, "plan.assets", "x.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    fs.writeFileSync(path.join(root, "plan.assets", "x.txt"), "text");
    const d = doors();
    const token = await paired(d);
    const svg = await d.phone("GET", "/__board/assets/plan.assets/x.svg", { headers: { "x-anydag-device": token } });
    expect(svg.status).toBe(200);
    expect(svg.res.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect(svg.res.headers.get("content-security-policy")).not.toMatch(/script-src/);
    expect(svg.res.headers.get("x-content-type-options")).toBe("nosniff");
    const txt = await d.desk("GET", "/__board/assets/plan.assets/x.txt");
    expect(txt.res.headers.get("content-disposition")).toMatch(/^attachment/);
  });
});
