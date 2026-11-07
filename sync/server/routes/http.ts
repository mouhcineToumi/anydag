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
