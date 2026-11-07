/**
 * Remote access: a second door onto the same server, for a phone.
 *
 * The local door — `127.0.0.1`, a `Host` of this machine, the per-launch token — is not widened. A
 * person who turns remote access on gets a **second listener**, on a fixed port so a phone can find
 * it again, behind a gate of its own (`app.ts`, `door: "remote"`):
 *
 * | | Local door | Remote door |
 * |---|---|---|
 * | port | the system's pick, per launch | `remote.port`, 4319 unless changed |
 * | `Host` | this machine | this machine, or the host of `remote.url` |
 * | credential | the launch token | a **device token**, one per paired device, kept hashed |
 * | routes | all | all but {@link localOnly} |
 *
 * The remote door listens on `127.0.0.1` too. What reaches it from a phone is a proxy that terminates
 * TLS in front of it — `tailscale serve`, today — so this process never listens on a network
 * interface and never holds a certificate. A hosted bridge later is one more proxy of the same kind.
 *
 * Load-bearing:
 * - **The device token is the gate**; the `Host` check is DNS-rebinding defence behind it. A page that
 *   rebinds a name to `127.0.0.1:4319` has no device token, and the device cookie is scoped to the
 *   remote host, never to its name.
 * - **A token is shown once and kept as its SHA-256.** The `devices` table in the home's SQLite holds
 *   the hash; a stolen copy of the home cannot be replayed.
 * - **Pairing is a one-time code**, 128 random bits, five minutes, single use, and only one live at a
 *   time: making a new one burns the last. Five wrong tries burn it too.
 * - **Revoking a device cuts it off now**: its next request is a 401, and every socket it holds —
 *   the change feed included — is destroyed. Turning remote access off closes the listener and every
 *   connection on it (`main.ts`).
 * - **What a phone may not do** is what changes who can reach the desktop, or takes a path or a
 *   passphrase on it: the `/api/remote` routes, opening, making and closing a vault, linking sync,
 *   answering the logs question.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Socket } from "node:net";

import type { Home } from "./home";
import { err } from "./http";

/** The port the remote door listens on unless the person chose another. */
export const REMOTE_PORT = 4319;

/** How long a pairing code lasts. */
export const PAIR_TTL_MS = 5 * 60_000;
/** Wrong tries a pairing code survives. */
const PAIR_TRIES = 5;
/** How often a device's `seen` is written: a phone polling must not be a write a second. */
const SEEN_EVERY_MS = 60_000;
/** The longest a device's name may be. */
const NAME_MAX = 60;

export const DEVICE_HEADER = "x-anydag-device";
export const DEVICE_COOKIE = "anydag_device";

const KEYS = { enabled: "remote.enabled", port: "remote.port", url: "remote.url" } as const;

export interface RemoteStatus {
  /** The person turned it on. */
  enabled: boolean;
  port: number;
  /** The address a phone opens, `https://desk.tail1234.ts.net`, or `null` until somebody says. */
  url: string | null;
  /** The door is up and answering. */
  listening: boolean;
  /** Why it is not, when it should be: the port is taken, there is no built page. */
  problem: string | null;
}

export interface Device {
  id: string;
  name: string;
  created: string;
  /** The last request it made, to a minute. */
  seen: string;
}

export interface PairCode {
  code: string;
  expires: string;
  /** What the QR code holds: `<url>/?pair=<code>`, or `null` with no `url` set. */
  link: string | null;
}

/** The tables this module owns, in the home's database. */
export const REMOTE_SCHEMA = `
create table if not exists devices (
  id text primary key,
  name text not null,
  hash text not null unique,
  created text not null,
  seen text not null
);
`;

const sha = (token: string): string => createHash("sha256").update(token).digest("hex");

/** An address a phone can open: `http(s)://host[:port]`, with no path. The origin, or `null`. */
export function originOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/** What a device calls itself: trimmed, one line, at most {@link NAME_MAX} characters. */
/**
 * What a browser that spent a code by link is called when nobody named it: the kind of device its
 * `User-Agent` says, never the string itself, which is long and changes with every update.
 */
export function browserName(agent: string | undefined): string {
  const ua = agent ?? "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows computer";
  if (/Linux|CrOS/.test(ua)) return "Linux computer";
  return "A browser";
}

export function deviceName(raw: unknown): string {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
  return s || "A device";
}

/**
 * A route the remote door refuses, by method and path. What changes who can reach this machine, or
 * hands it a path or a passphrase, is the desktop's own to do.
 */
export function localOnly(method: string, path: string): boolean {
  if (path === "/api/remote" || path.startsWith("/api/remote/")) return true;
  if (method === "POST" && /^\/api\/vaults\/(open|create|close)$/.test(path)) return true;
  if (method === "POST" && /^\/api\/sync\/(pair|link|unlink)$/.test(path)) return true;
  if (method === "PUT" && path === "/api/telemetry") return true;
  return false;
}

export class Remote {
  private code: { code: string; expires: number; tries: number } | null = null;
  private seenAt = new Map<string, number>();
  private sockets = new Map<string, Set<Socket>>();
  private up = false;
  private why: string | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly home: Home,
    private readonly now: () => number = () => Date.now(),
  ) {
    home.db.exec(REMOTE_SCHEMA);
  }

  /* -- the setting ------------------------------------------------------------------------- */

  status(): RemoteStatus {
    return { enabled: this.enabled(), port: this.port(), url: this.url(), listening: this.up, problem: this.why };
  }

  enabled(): boolean {
    return this.home.get(KEYS.enabled) === "1";
  }

  port(): number {
    const n = Number(this.home.get(KEYS.port));
    return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : REMOTE_PORT;
  }

  url(): string | null {
    return originOf(this.home.get(KEYS.url));
  }

  /** Change what was given, and say so to whoever runs the door. */
  configure(patch: { enabled?: unknown; port?: unknown; url?: unknown }): RemoteStatus {
    if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") throw err(400, "`enabled` is true or false");
    if (patch.port !== undefined && patch.port !== null) {
      const n = patch.port;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1024 || n > 65535) throw err(400, "`port` is a whole number from 1024 to 65535");
    }
    let url: string | null | undefined;
    if (patch.url === null || patch.url === "") url = null;
    else if (patch.url !== undefined) {
      url = originOf(patch.url);
      if (!url) throw err(400, "`url` is the address a phone opens, `https://…`, with no path");
    }
    if (patch.enabled !== undefined) this.home.set(KEYS.enabled, patch.enabled ? "1" : null);
    if (patch.port !== undefined) this.home.set(KEYS.port, patch.port === null ? null : String(patch.port));
    if (url !== undefined) this.home.set(KEYS.url, url);
    /* Off is off for every device at once: the door closes, and with it every connection. */
    if (patch.enabled === false) this.code = null;
    this.changed();
    return this.status();
  }

  /** `main.ts` says whether the door is up, and why not. */
  listening(up: boolean, problem: string | null = null): void {
    this.up = up;
    this.why = problem;
  }

  /** Called when the setting changes — `main.ts` opens, moves or closes the door. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** Whether a `Host` (port stripped) may reach the remote door. */
  hostAllowed(host: string): boolean {
    const h = host.toLowerCase();
    if (h === "127.0.0.1" || h === "localhost" || h === "[::1]") return true;
    const url = this.url();
    return url !== null && new URL(url).hostname.toLowerCase() === h;
  }

  /* -- pairing ------------------------------------------------------------------------------ */

  /** A fresh one-time code; the last one, if any, stops working. */
  pairCode(): PairCode {
    if (!this.enabled()) throw err(409, "remote access is off — turn it on first", { code: "remote-off" });
    const code = randomBytes(16).toString("base64url");
    const expires = this.now() + PAIR_TTL_MS;
    this.code = { code, expires, tries: 0 };
    const url = this.url();
    return { code, expires: new Date(expires).toISOString(), link: url ? `${url}/?pair=${encodeURIComponent(code)}` : null };
  }

  /** Spend a code: a new device and the one copy of its token there will ever be. */
  pair(code: unknown, name: unknown): { device: Device; token: string } {
    const live = this.code;
    if (!this.enabled() || !live || live.expires <= this.now()) {
      this.code = null;
      throw err(401, "that pairing code has expired — make a new one on the desktop", { code: "pair" });
    }
    if (typeof code !== "string" || code !== live.code) {
      if (++live.tries >= PAIR_TRIES) this.code = null;
      throw err(401, "that is not the pairing code the desktop is showing", { code: "pair" });
    }
    this.code = null;
    const token = `adv_${randomBytes(32).toString("base64url")}`;
    const at = new Date(this.now()).toISOString();
    const device: Device = { id: randomUUID(), name: deviceName(name), created: at, seen: at };
    this.home.sql("insert into devices (id, name, hash, created, seen) values (?, ?, ?, ?, ?)").run(device.id, device.name, sha(token), at, at);
    return { device, token };
  }

  /* -- devices ----------------------------------------------------------------------------- */

  devices(): Device[] {
    return this.home.sql("select id, name, created, seen from devices order by created").all() as unknown as Device[];
  }

  /** The device a token belongs to, or `null`. Notes that it was seen, at most once a minute. */
  identify(token: string | undefined): Device | null {
    if (!token) return null;
    const row = this.home.sql("select id, name, created, seen from devices where hash = ?").get(sha(token)) as unknown as Device | undefined;
    if (!row) return null;
    const now = this.now();
    if (now - (this.seenAt.get(row.id) ?? 0) >= SEEN_EVERY_MS) {
      this.seenAt.set(row.id, now);
      row.seen = new Date(now).toISOString();
      this.home.sql("update devices set seen = ? where id = ?").run(row.seen, row.id);
    }
    return row;
  }

  /** Forget a device, and cut every connection it has open but `keep`. `false` when there was none. */
  revoke(id: unknown, keep?: Socket): boolean {
    if (typeof id !== "string" || !id) throw err(400, "expected the `id` of a device");
    const gone = Number(this.home.sql("delete from devices where id = ?").run(id).changes) > 0;
    this.seenAt.delete(id);
    for (const socket of this.sockets.get(id) ?? []) if (socket !== keep) socket.destroy();
    this.sockets.delete(id);
    return gone;
  }

  /** A socket a device's request arrived on, cut when the device is revoked. */
  hold(id: string, socket: Socket | undefined): void {
    if (!socket || socket.destroyed) return;
    let set = this.sockets.get(id);
    if (!set) this.sockets.set(id, (set = new Set()));
    if (set.has(socket)) return;
    set.add(socket);
    socket.once("close", () => {
      set.delete(socket);
      if (set.size === 0 && this.sockets.get(id) === set) this.sockets.delete(id);
    });
  }
}
