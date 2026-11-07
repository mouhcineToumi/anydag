/**
 * Logs, on the app's side: whether the person said yes, what is waiting to go, and where it goes.
 *
 * | Kept | Where |
 * |---|---|
 * | the answer | `telemetry.consent` in the home's `kv`: `1`, `0`, or absent — never asked |
 * | the install | `telemetry.install`: a random UUID made on yes and deleted on no |
 * | what waits | memory only, at most `HELD` events; a restart loses it, which is the right loss |
 *
 * Load-bearing:
 * - **Nothing is held, measured or sent unless the answer is yes.** `record`, `routeDone` and `fail`
 *   return at once otherwise, so an install that said no — or was never asked — does the work of
 *   one `kv` read the first time and a boolean after.
 * - **Every event is `cleanEvent`'s before it is held** (`sync/protocol/logs.ts`), whoever sent it:
 *   the page's batch, the server's own errors and the route summary alike. A page that sent a
 *   title in a prop has it dropped here.
 * - **The answer is the person's, in the app's home**: one per install, not per browser and not per
 *   vault, read by the page, the CLI and Settings. A chat cannot change it — `PUT /api/telemetry` is
 *   not on the Assistant's list of writes, so `chatGuard` refuses it.
 * - **Where it goes**: `ANYDAG_LOGS_URL`, else the address built in (`__ANYDAG_LOGS_URL__`), else the
 *   sync server a vault on this machine is paired with. With none, nothing leaves and nothing is
 *   kept: the Privacy tab says so.
 * - **Only a server that stays up sends** (`start`): `anydag serve`, the desktop app. The CLI's
 *   in-process server lives for one command, and never starts the timer.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  cleanEvent,
  localeOf,
  LOGS_VERSION,
  MAX_EVENTS,
  type EventName,
  type LogBatch,
  type LogEnv,
  type LogEvent,
  type Props,
} from "../sync/protocol/logs";
import type { Home } from "./home";

declare const __ANYDAG_LOGS_URL__: string;
const BUILT_IN = typeof __ANYDAG_LOGS_URL__ === "string" ? __ANYDAG_LOGS_URL__ : "";

/** The most events held between two sends; the oldest go first. */
const HELD = 1000;
/** How often a running server sends what it holds. */
const EVERY_MS = 60_000;
const TIMEOUT_MS = 10_000;

const CONSENT = "telemetry.consent";
const INSTALL = "telemetry.install";

export interface TelemetryStatus {
  /** `null` is never asked: the page asks once, on the first page it opens. */
  consent: boolean | null;
  /** The host logs go to, or `null` when there is nowhere to send them. */
  destination: string | null;
}

interface Timing {
  count: number;
  errors: number;
  ms: number;
  max: number;
}

/** `…/v1/logs` from what somebody configured: a sync server's address, or the endpoint itself. */
export function endpointOf(raw: string): string | null {
  const s = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(s)) return null;
  return /\/v1\/logs$/.test(s) ? s : `${s}/v1/logs`;
}

export class Telemetry {
  private held: LogEvent[] = [];
  private timings = new Map<string, Timing>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private sending: Promise<void> | null = null;
  private said: boolean | null | undefined;

  constructor(
    private readonly home: Home,
    private readonly version: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /* -- the answer ---------------------------------------------------------------------------- */

  consent(): boolean | null {
    if (this.said === undefined) {
      const v = this.home.get(CONSENT);
      this.said = v === "1" ? true : v === "0" ? false : null;
    }
    return this.said;
  }

  /** Yes, no, or back to never asked. A no forgets the install and drops whatever was waiting. */
  setConsent(yes: boolean | null): TelemetryStatus {
    this.home.set(CONSENT, yes === null ? null : yes ? "1" : "0");
    this.said = yes;
    if (yes) {
      if (!this.home.get(INSTALL)) this.home.set(INSTALL, randomUUID());
    } else {
      this.home.set(INSTALL, null);
      this.held = [];
      this.timings.clear();
    }
    return this.status();
  }

  status(): TelemetryStatus {
    const to = this.destination();
    let host: string | null = null;
    if (to) {
      try {
        host = new URL(to).host;
      } catch {
        host = null;
      }
    }
    return { consent: this.consent(), destination: host };
  }

  /**
   * Where a batch goes, decided when it is sent: a vault paired after the server started counts.
   * `ANYDAG_LOGS_URL=off` sends nowhere whatever else is set.
   */
  destination(): string | null {
    const set = this.env.ANYDAG_LOGS_URL?.trim();
    if (set === "off" || set === "0") return null;
    if (set) return endpointOf(set);
    if (BUILT_IN) return endpointOf(BUILT_IN);
    return this.paired();
  }

  /** The sync server of the first vault on this machine that is paired with one. */
  private paired(): string | null {
    const dir = path.join(this.home.dir, "sync");
    let ids: string[];
    try {
      ids = fs.readdirSync(dir).sort();
    } catch {
      return null;
    }
    for (const id of ids) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(dir, id, "pair.json"), "utf8")) as { server?: unknown };
        if (typeof p.server === "string") {
          const url = endpointOf(p.server);
          if (url) return url;
        }
      } catch {
        /* not paired, or not readable */
      }
    }
    return null;
  }

  /* -- what is held ---------------------------------------------------------------------------- */

  /** Events from the page or the server: each cleaned, the unknown dropped. Answers how many were kept. */
  record(raw: readonly unknown[]): number {
    if (this.consent() !== true) return 0;
    let kept = 0;
    for (const r of raw.slice(0, MAX_EVENTS)) {
      const e = cleanEvent(r);
      if (!e) continue;
      this.held.push(e);
      kept++;
    }
    if (this.held.length > HELD) this.held.splice(0, this.held.length - HELD);
    return kept;
  }

  event(name: EventName, props: Props): void {
    if (this.consent() !== true) return;
    this.record([{ name, at: new Date().toISOString(), props }]);
  }

  /** One request answered, by its route's template — summed until the next send. */
  routeDone(route: string, status: number, ms: number): void {
    if (this.consent() !== true) return;
    const t = this.timings.get(route) ?? { count: 0, errors: 0, ms: 0, max: 0 };
    t.count++;
    if (status >= 500) t.errors++;
    t.ms += ms;
    t.max = Math.max(t.max, ms);
    this.timings.set(route, t);
  }

  /** Something the server did not expect. Only the message and the stack, and both scrubbed. */
  fail(e: unknown, route?: string): void {
    if (this.consent() !== true) return;
    const err = e instanceof Error ? e : new Error(String(e));
    this.event("error", {
      where: "server",
      kind: route ? "route" : "error",
      message: `${err.name}: ${err.message}`,
      stack: err.stack ?? "",
      ...(route ? { route } : {}),
    });
  }

  /* -- sending --------------------------------------------------------------------------------- */

  envOf(): LogEnv | null {
    const install = this.home.get(INSTALL);
    if (!install) return null;
    const arch = os.arch();
    return {
      version: this.version,
      shell: this.env.ANYDAG_DESKTOP === "1" ? "desktop" : "browser",
      os: process.platform === "linux" || process.platform === "darwin" || process.platform === "win32" ? process.platform : "other",
      arch: arch === "x64" || arch === "arm64" ? arch : "other",
      locale: localeOf(Intl.DateTimeFormat().resolvedOptions().locale),
      install,
    };
  }

  /** What would be sent now, taken out of what is held. */
  take(): LogBatch | null {
    const now = new Date().toISOString();
    for (const [route, t] of this.timings) {
      this.held.push({ name: "route.timing", at: now.replace(/\.\d{3}Z$/, "Z"), props: { route, count: t.count, errors: t.errors, ms: Math.round(t.ms / t.count), max: Math.round(t.max) } });
    }
    this.timings.clear();
    const env = this.envOf();
    if (!env || !this.held.length) return null;
    const events = this.held.splice(0, MAX_EVENTS);
    return { v: LOGS_VERSION, env, events };
  }

  /** Send what is held, once; a failure loses that batch rather than retrying it for ever. */
  async flush(): Promise<void> {
    if (this.sending) return this.sending;
    if (this.consent() !== true) return;
    const to = this.destination();
    if (!to) {
      /* Nowhere to send: nothing is kept for later either. */
      this.held = [];
      this.timings.clear();
      return;
    }
    const batch = this.take();
    if (!batch) return;
    this.sending = (async () => {
      try {
        await this.fetchImpl(to, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        /* Offline, or the server is down: these are logs, not documents. */
      } finally {
        this.sending = null;
      }
    })();
    return this.sending;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), EVERY_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }
}
