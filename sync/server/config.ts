/**
 * `anydag-sync`'s configuration, read once from the environment.
 *
 * `configFrom(env)` is a pure function over a plain record, so a test hands it any environment it
 * likes and the server, the CLI and the tests all read the same names the same way. A value that
 * is present and wrong is refused with a sentence naming the variable — never quietly replaced by
 * the default, because a server listening on a port somebody did not ask for, or keeping history
 * for zero days, is worse than one that will not start.
 *
 * Load-bearing:
 * - **No `DATABASE_URL` means PGlite** at `<data>/pg`: a self-hoster runs the server with no
 *   Postgres at all, and the same `PgMeta` serves both (`meta/db.ts`). Blobs are always
 *   `<data>/blobs`.
 * - **`mode` is read here and in exactly two other places** — the health answer and `main.ts`'s
 *   first-boot account: no other branch knows the mode.
 * - **No GitHub token means no feedback**: `POST /v1/feedback` answers `ES_UNAVAILABLE`, which the
 *   app's card says in words. Only this environment ever holds that token (`routes/feedback.ts`).
 * - **No admin token means no admin routes**: they answer `ES_FORBIDDEN` rather than accept an
 *   empty secret (`auth.ts`). The CLI talks to the database directly and needs none.
 */

import path from "node:path";

import type { Mode } from "../protocol/wire";

export interface Config {
  mode: Mode;
  /** A Postgres URL, or `null` for PGlite at `<data>/pg`. */
  databaseUrl: string | null;
  /** The server's own folder: `blobs/`, and `pg/` when there is no `databaseUrl`. Absolute. */
  data: string;
  port: number;
  host: string;
  /** `null` turns every `/v1/admin/*` route and `/metrics` off. */
  adminToken: string | null;
  /** How long a superseded blob and a compacted log row are kept, unless the plan says otherwise. */
  historyDays: number;
  /** `false` answers `…/poke` with `204`: the clients poll. */
  poke: boolean;
  /** Where a person reaches this server — printed beside a pairing code. */
  publicUrl: string;
  /** The largest blob upload this server reads at all, whatever the plan allows. */
  maxBodyBytes: number;
  /** Whether `POST /v1/logs` keeps what it is sent; off, it answers `ES_NOT_FOUND`. */
  logs: boolean;
  /** How many days of logs are kept on disk, in `<data>/logs/`. */
  logsDays: number;
  /** Whether `POST /v1/feedback` exists at all; off, it answers `ES_NOT_FOUND`. */
  feedback: boolean;
  /** The fine-grained GitHub token (Issues: write) feedback becomes issues with; `null` answers `ES_UNAVAILABLE`. */
  feedbackToken: string | null;
  /** The repository feedback lands in, `owner/name`. */
  feedbackRepo: string;
}

class ConfigError extends Error {}

const MODES: readonly Mode[] = ["single", "multi"];

function int(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ConfigError(`${name} must be a whole number from ${min} to ${max}, not ${JSON.stringify(raw)}`);
  return n;
}

function text(env: Record<string, string | undefined>, name: string): string | null {
  const raw = env[name]?.trim();
  return raw ? raw : null;
}

export function configFrom(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): Config {
  const mode = (text(env, "ANYDAG_SYNC_MODE") ?? "single") as Mode;
  if (!MODES.includes(mode))
    throw new ConfigError(`ANYDAG_SYNC_MODE must be single or multi, not ${JSON.stringify(env.ANYDAG_SYNC_MODE)}`);

  const databaseUrl = text(env, "DATABASE_URL");
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl))
    throw new ConfigError("DATABASE_URL must be a postgres:// URL (or unset, for PGlite in ANYDAG_SYNC_DATA)");

  const data = path.resolve(cwd, text(env, "ANYDAG_SYNC_DATA") ?? "anydag-sync-data");
  const port = int(env, "ANYDAG_SYNC_PORT", 8790, 0, 65535);
  const host = text(env, "ANYDAG_SYNC_HOST") ?? "127.0.0.1";

  const adminToken = text(env, "ANYDAG_SYNC_ADMIN_TOKEN");
  if (adminToken !== null && adminToken.length < 16)
    throw new ConfigError("ANYDAG_SYNC_ADMIN_TOKEN must be at least 16 characters (or unset, which turns the admin routes off)");

  const historyDays = int(env, "ANYDAG_SYNC_HISTORY_DAYS", 30, 1, 36500);

  const pokeRaw = (text(env, "ANYDAG_SYNC_POKE") ?? "on").toLowerCase();
  if (!["on", "off", "1", "0", "true", "false"].includes(pokeRaw))
    throw new ConfigError(`ANYDAG_SYNC_POKE must be on or off, not ${JSON.stringify(env.ANYDAG_SYNC_POKE)}`);
  const poke = pokeRaw === "on" || pokeRaw === "1" || pokeRaw === "true";

  const shown = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host.includes(":") ? `[${host}]` : host;
  const publicUrl = (text(env, "ANYDAG_SYNC_PUBLIC_URL") ?? `http://${shown}:${port}`).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(publicUrl))
    throw new ConfigError(`ANYDAG_SYNC_PUBLIC_URL must be an http(s) URL, not ${JSON.stringify(publicUrl)}`);

  const maxBodyMb = int(env, "ANYDAG_SYNC_MAX_BODY_MB", 512, 1, 1024 * 1024);

  const logsRaw = (text(env, "ANYDAG_SYNC_LOGS") ?? "on").toLowerCase();
  if (!["on", "off", "1", "0", "true", "false"].includes(logsRaw))
    throw new ConfigError(`ANYDAG_SYNC_LOGS must be on or off, not ${JSON.stringify(env.ANYDAG_SYNC_LOGS)}`);
  const logs = logsRaw === "on" || logsRaw === "1" || logsRaw === "true";
  const logsDays = int(env, "ANYDAG_SYNC_LOGS_DAYS", 30, 1, 3650);

  const feedbackRaw = (text(env, "ANYDAG_FEEDBACK") ?? "on").toLowerCase();
  if (!["on", "off", "1", "0", "true", "false"].includes(feedbackRaw))
    throw new ConfigError(`ANYDAG_FEEDBACK must be on or off, not ${JSON.stringify(env.ANYDAG_FEEDBACK)}`);
  const feedback = feedbackRaw === "on" || feedbackRaw === "1" || feedbackRaw === "true";
  const feedbackToken = text(env, "ANYDAG_FEEDBACK_GITHUB_TOKEN");
  const feedbackRepo = text(env, "ANYDAG_FEEDBACK_REPO") ?? "mouhcineToumi/anydag";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(feedbackRepo))
    throw new ConfigError(`ANYDAG_FEEDBACK_REPO must be owner/name, not ${JSON.stringify(feedbackRepo)}`);

  return {
    mode,
    databaseUrl,
    data,
    port,
    host,
    adminToken,
    historyDays,
    poke,
    publicUrl,
    maxBodyBytes: maxBodyMb * 1024 * 1024,
    logs,
    logsDays,
    feedback,
    feedbackToken,
    feedbackRepo,
  };
}
