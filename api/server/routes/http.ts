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
 * - **A body is read through its schema in `protocol/schema.ts`** (`read`, or `body` then `parse`
 *   where a route looks something up between the two), the one the OpenAPI document is generated
 *   from, so the document and the handler cannot disagree about what a route accepts.
 */

import type { Context } from "hono";
import type { z } from "zod";

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

/**
 * `value` through `schema`, or `ES_BAD_REQUEST` with the first fault's sentence. First is the order
 * the fields are declared in, which is the order a route checked them in by hand — but a fault of a
 * list's element comes before any fault of a later element, and an element's own fault (a key
 * changed twice in one commit) before its fields', because zod says a refinement after everything
 * it found itself.
 */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  let first = r.error.issues[0]!;
  for (const issue of r.error.issues.slice(1)) if (before(issue.path, first.path)) first = issue;
  throw new HttpError("ES_BAD_REQUEST", first.message);
}

/** Whether a fault at `a` comes strictly before one at `b`: an earlier list element, or `b`'s container. */
function before(a: readonly PropertyKey[], b: readonly PropertyKey[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    return typeof x === "number" && typeof y === "number" && x < y;
  }
  return a.length < b.length;
}

/** The JSON body through its schema: `body`, then `parse`. */
export async function read<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  return parse(schema, await body(c));
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
