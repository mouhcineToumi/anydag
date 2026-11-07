/**
 * What Tailscale says about this machine, for the remote door: the address a phone opens, and
 * whether `tailscale serve` is already passing it to the door.
 *
 * Asked of the `tailscale` CLI, never of its local API: the CLI is the documented surface, and it is
 * what a person would type. A desktop app started from a menu has no login shell's `PATH`, so the
 * installers' own places are tried after it (`findClaude`'s reason).
 *
 * Nothing here is required: no Tailscale is an answer (`installed: false`), and the person can type
 * an address instead. A hosted bridge later is another way to the same door.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";

/** What the Devices tab shows about Tailscale. */
export interface TailscaleState {
  /** A `tailscale` CLI was found. */
  installed: boolean;
  /** Logged in and connected. */
  running: boolean;
  /** `https://<machine>.<tailnet>.ts.net`, or `null`. */
  address: string | null;
  /** Whether `tailscale serve` passes that address to the door's port; `null` when it could not tell. */
  serving: boolean | null;
}

const TIMEOUT_MS = 3_000;
/** How long an answer is good for: the tab polls, and a CLI call a second is a CLI call too many. */
const FRESH_MS = 5_000;

const PLACES: Record<string, string[]> = {
  darwin: ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale"],
  win32: ["C:\\Program Files\\Tailscale\\tailscale.exe"],
  linux: ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/usr/sbin/tailscale"],
};

/** The `tailscale` CLI: `ANYDAG_TAILSCALE_BIN`, else the name on the `PATH`, else where installers put it. */
export function tailscaleBin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ANYDAG_TAILSCALE_BIN) return env.ANYDAG_TAILSCALE_BIN;
  for (const dir of (env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")) {
    const at = `${dir}/${process.platform === "win32" ? "tailscale.exe" : "tailscale"}`;
    if (dir && fs.existsSync(at)) return at;
  }
  return (PLACES[process.platform] ?? []).find((p) => fs.existsSync(p)) ?? "tailscale";
}

export type Run = (args: string[]) => Promise<{ ok: boolean; out: string; err: string; missing: boolean }>;

export function runner(bin: string = tailscaleBin()): Run {
  return (args) =>
    new Promise((resolve) => {
      execFile(bin, args, { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (e, out, err) => {
        const missing = (e as NodeJS.ErrnoException | null)?.code === "ENOENT";
        resolve({ ok: !e, out: String(out ?? ""), err: String(err ?? "").trim() || (e?.message ?? ""), missing });
      });
    });
}

/** `https://<DNSName>` out of `tailscale status --json`, or `null`. */
export function addressOf(status: unknown): string | null {
  const name = (status as { Self?: { DNSName?: unknown } } | null)?.Self?.DNSName;
  if (typeof name !== "string" || !name) return null;
  return `https://${name.replace(/\.$/, "")}`;
}

/**
 * Whether `tailscale serve status --json` sends `host` (on 443) to the door: a handler whose proxy
 * is `127.0.0.1`, `localhost` or `[::1]` on `port`.
 */
export function servesPort(serve: unknown, host: string, port: number): boolean {
  const web = (serve as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: unknown }> }> } | null)?.Web ?? {};
  const re = new RegExp(`^(?:https?://)?(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}/?$`);
  for (const [at, site] of Object.entries(web)) {
    if (at !== `${host}:443` && at !== host) continue;
    for (const h of Object.values(site.Handlers ?? {})) if (typeof h.Proxy === "string" && re.test(h.Proxy)) return true;
  }
  return false;
}

export class Tailscale {
  private cached: { at: number; port: number; state: TailscaleState } | null = null;

  constructor(
    private readonly run: Run = runner(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  async state(port: number): Promise<TailscaleState> {
    const c = this.cached;
    if (c && c.port === port && this.now() - c.at < FRESH_MS) return c.state;
    const state = await this.ask(port);
    this.cached = { at: this.now(), port, state };
    return state;
  }

  private async ask(port: number): Promise<TailscaleState> {
    const got = await this.run(["status", "--json"]);
    if (got.missing) return { installed: false, running: false, address: null, serving: null };
    let status: { BackendState?: unknown } | null = null;
    try {
      status = JSON.parse(got.out) as { BackendState?: unknown };
    } catch {
      /* stopped, or logged out: it prints prose */
    }
    const address = addressOf(status);
    const running = status?.BackendState === "Running" && address !== null;
    if (!running) return { installed: true, running: false, address, serving: null };
    const serve = await this.run(["serve", "status", "--json"]);
    let serving: boolean | null = null;
    try {
      serving = servesPort(JSON.parse(serve.out || "{}"), new URL(address).hostname, port);
    } catch {
      serving = null;
    }
    return { installed: true, running, address, serving };
  }

  /**
   * `tailscale serve --bg <port>`: the tailnet's HTTPS address passed to the door. The person asked
   * for it with a button; what Tailscale says when it refuses — HTTPS not enabled on the tailnet, or
   * this user not its operator — is the answer, word for word.
   */
  async serve(port: number): Promise<{ ok: boolean; message: string }> {
    this.cached = null;
    const got = await this.run(["serve", "--bg", String(port)]);
    if (got.missing) return { ok: false, message: "Tailscale is not installed on this machine" };
    return { ok: got.ok, message: got.ok ? got.out.trim() : got.err };
  }
}
