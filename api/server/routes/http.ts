/**
 * What every route shares: the error a handler throws, the context it reads, and the small checks
 * that turn an untrusted body into the shape `wire.ts` promises.
 *
 * Load-bearing:
 * - **A handler refuses by throwing `HttpError` with an `ErrorCode`**, and `app.ts` alone turns it
 *   into `{code, message, ...extra}` at `STATUS[code]`. One table both halves read, so a client
 *   branches on the code and never on a status it guessed.
 * - **Every check here is a refusal, never a repair.** A field of the wrong type is
 *   `ES_BAD_REQUEST`, not coerced: a client that sends a string `parent` has a bug the server must
 *   not paper over, or two devices would disagree about what a commit meant.
 */

import type { Context } from "hono";

import type { ErrorCode } from "../../protocol/wire";
import type { Blobs } from "../blobs/types";
import type { Config } from "../config";
import type { DeviceRow, Meta, VaultRow } from "../meta/types";
import type { Metrics } from "../metrics";
import type { Usage } from "../usage";
import type { PokeHub } from "./poke";

export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** What a route is handed: the ports, the clock, the hub, the ledger. */
export interface Deps {
  meta: Meta;
  blobs: Blobs;
  config: Config;
  now: () => Date;
  hub: PokeHub;
  usage: Usage;
  metrics: Metrics;
  version: string;
  /** How often the poke stream says it is alive; 20 s unless a test wants it sooner. */
  pingMs: number;
  /** A stored blob file's age, for the collector's orphan rule (`gc.ts`); absent leaves orphans alone. */
  ageOf?: (vault: string, id: string) => Promise<number | null>;
}

export interface Vars {
  device: DeviceRow;
  vault: VaultRow;
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The JSON body, or `ES_BAD_REQUEST` — never a 500 for a client that sent nonsense. */
export async function body(c: Context): Promise<Record<string, unknown>> {
  let v: unknown;
  try {
    v = await c.req.json();
  } catch {
    throw new HttpError("ES_BAD_REQUEST", "the body is not JSON");
  }
  if (!isObject(v)) throw new HttpError("ES_BAD_REQUEST", "the body must be a JSON object");
  return v;
}

export function str(v: unknown, what: string, max = 4096, min = 1): string {
  if (typeof v !== "string" || v.length < min || v.length > max)
    throw new HttpError("ES_BAD_REQUEST", `${what} must be a string of ${min} to ${max} characters`);
  return v;
}

export function count(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    throw new HttpError("ES_BAD_REQUEST", `${what} must be a whole number of at least 0`);
  return v;
}

/** A query parameter as a whole number, or `fallback` when absent. */
export function qint(
  raw: string | undefined,
  what: string,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new HttpError("ES_BAD_REQUEST", `${what} must be a whole number from ${min} to ${max}`);
  return n;
}

export const today = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * A fixed window per key, reset every minute: enough to keep one sender from filling a disk, or
 * from filling an issue tracker (`feedback.ts` holds its own, with its own numbers).
 */
export class Rate {
  private minute = 0;
  private seen = new Map<string, number>();
  private all = 0;

  constructor(
    private readonly perMinute: number,
    private readonly allPerMinute: number,
  ) {}

  allow(key: string, now: number): boolean {
    const minute = Math.floor(now / 60_000);
    if (minute !== this.minute) {
      this.minute = minute;
      this.seen.clear();
      this.all = 0;
    }
    const n = (this.seen.get(key) ?? 0) + 1;
    this.seen.set(key, n);
    this.all++;
    return n <= this.perMinute && this.all <= this.allPerMinute;
  }
}

/**
 * Who is asking, for a rate limit: the address the *last trusted proxy* forwarded, or the socket's
 * own when no proxy is configured (`trustProxy` is `off`, header absent, or fewer entries than the
 * hops promised). Every rate-limited route reads the client through this one helper, so a spoofed
 * `X-Forwarded-For` cannot move a bucket: read backwards from the right, the entries a proxy added
 * are the header's rightmost ones, and the address just left of them is the client the nearest
 * trusted proxy saw. `hops` is `config.trustProxy`.
 *
 * With one hop (Caddy is this server's only proxy) a request the client forged to
 * `9.9.9.9` arrives as `9.9.9.9, <real client>` — the proxy appended the true address — so the
 * rightmost entry is the client and the forgery cannot shade another address's limit. Without a
 * proxy (the self-hosted default) the header is untrusted on principle: the socket address is the
 * answer, whatever it says.
 */
export function clientAddress(c: { req: { header(name: string): string | undefined }; env: unknown }, hops: number): string {
  const socket = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  if (hops <= 0) return socket ?? "local";
  const header = c.req.header("x-forwarded-for");
  if (!header) return socket ?? "local";
  const hopsList = header
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const at = hopsList.length - hops;
  return at < 0 ? (socket ?? "local") : (hopsList[at] ?? socket ?? "local");
}
