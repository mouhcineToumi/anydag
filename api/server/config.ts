/**
 * `anydag-api`'s configuration, read once from the environment.
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
 *   `<data>/blobs`, logs `<data>/logs`.
 * - **Every feature has a switch, and the old `ANYDAG_SYNC_*` names still work** for one release
 *   (#99): a name the server spells is read from its old spelling when the new one is unset, which
 *   prints a deprecation warning at boot and never reveals the value. An `off` feature answers 404.
 * - **A secret's value never reaches an error message or the boot line.** `SECRET_VARS` is the
 *   closed list; `value(name, raw)` prints `<redacted>` for one instead of the value, and every
 *   message boot builds goes through it. `describe` is what main.ts prints.
 * - **Production refuses a too-short admin token at boot** (`NODE_ENV=production`, 32 characters).
 *   A feature missing *its* secret is not a boot error: feedback without its GitHub token answers
 *   503 at request time (#50), which is one feature down instead of the server down.
 * - **The client address is trusted only from a configured proxy** (`trustProxy`): `off` is the
 *   socket's own answer, a number is how many hops of `X-Forwarded-For` the rate limiter may read —
 *   one helper behind it, `clientAddress` in `routes/http.ts`, for every rate-limited route.
 */

import path from "node:path";

import type { Mode } from "../protocol/wire";

export interface Config {
  mode: Mode;
  /** A Postgres URL, or `null` for PGlite at `<data>/pg`. */
  databaseUrl: string | null;
  /** The server's own folder: `blobs/`, `logs/`, and `pg/` when there is no `databaseUrl`. Absolute. */
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
  /** One switch per feature; an `off` feature's routes answer 404. */
  sync: boolean;
  logs: boolean;
  feedback: boolean;
  /** The token `POST /v1/feedback` (#50's relay) needs; `null` makes every relay answer 503. */
  feedbackToken: string | null;
  /** The GitHub repo the relay files into; a relay without one is not available either. */
  feedbackRepo: string | null;
  /** How many days of logs are kept on disk, in `<data>/logs/`. */
  logsDays: number;
  /** Client address: `0` is the socket's own answer; `n` is how many hops  of the proxy chain to trust. */
  trustProxy: number;
  /** `NODE_ENV=production`, which decides how long a secret must be. */
  production: boolean;
}

export class ConfigError extends Error {}

/** The variables whose value neither an error message nor the boot line may spell out. */
const SECRET_VARS = new Set(["ANYDAG_API_ADMIN_TOKEN", "ANYDAG_API_FEEDBACK_GITHUB_TOKEN", "DATABASE_URL"]); /**
 * The names the #99 rename left behind. Each still works for one release: the value answers, and
 * boot says so — the name only, never the value, since some of these are secrets.
 */
const RENAMED: Readonly<Record<string, string>> = {
  ANYDAG_API_MODE: "ANYDAG_SYNC_MODE",
  ANYDAG_API_DATA: "ANYDAG_SYNC_DATA",
  ANYDAG_API_PORT: "ANYDAG_SYNC_PORT",
  ANYDAG_API_HOST: "ANYDAG_SYNC_HOST",
  ANYDAG_API_ADMIN_TOKEN: "ANYDAG_SYNC_ADMIN_TOKEN",
  ANYDAG_API_HISTORY_DAYS: "ANYDAG_SYNC_HISTORY_DAYS",
  ANYDAG_API_POKE: "ANYDAG_SYNC_POKE",
  ANYDAG_API_PUBLIC_URL: "ANYDAG_SYNC_PUBLIC_URL",
  ANYDAG_API_MAX_BODY_MB: "ANYDAG_SYNC_MAX_BODY_MB",
  ANYDAG_API_LOGS: "ANYDAG_SYNC_LOGS",
  ANYDAG_API_LOGS_DAYS: "ANYDAG_SYNC_LOGS_DAYS",
};

const maskUrl = (url: string): string => url.replace(/\/\/[^@/]*@/, "//…@");

/** How a value is spelled in anything the server prints back. */
function value(name: string, raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") return "<unset>";
  if (SECRET_VARS.has(name)) return "<redacted>";
  return JSON.stringify(raw);
}

const MODES: readonly Mode[] = ["single", "multi"];

export function configFrom(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
  warn: (message: string) => void = (message) => console.error(message),
): Config {
  const warned = new Set<string>();
  const pick = (name: string): string | undefined => {
    const raw = env[name];
    if (raw !== undefined) return raw;
    const old = RENAMED[name];
    return old !== undefined && env[old] !== undefined ? env[old] : undefined;
  };

  function text(name: string): string | null {
    const raw = pick(name)?.trim();
    return raw ? raw : null;
  }

  function int(name: string, fallback: number, min: number, max: number): number {
    const raw = pick(name);
    if (raw === undefined || raw.trim() === "") return fallback;
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n < min || n > max)
      throw new ConfigError(`${name} must be a whole number from ${min} to ${max}, not ${value(name, raw)}`);
    return n;
  }

  function onOff(name: string, fallback: boolean): boolean {
    const raw = (pick(name) ?? "").trim();
    const word = raw === "" ? (fallback ? "on" : "off") : raw.toLowerCase();
    if (raw !== "" && !["on", "off", "1", "0", "true", "false"].includes(word))
      throw new ConfigError(`${name} must be on or off, not ${value(name, raw)}`);
    return ["on", "1", "true"].includes(word);
  }

  const mode = (text("ANYDAG_API_MODE") ?? "single") as Mode;
  if (!MODES.includes(mode))
    throw new ConfigError(`ANYDAG_API_MODE must be single or multi, not ${value("ANYDAG_API_MODE", env.ANYDAG_API_MODE)}`);

  const databaseUrl = text("DATABASE_URL");
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl))
    throw new ConfigError("DATABASE_URL must be a postgres:// URL (or unset, for PGlite in ANYDAG_API_DATA/pg)");

  const data = path.resolve(cwd, text("ANYDAG_API_DATA") ?? "anydag-api-data");
  const port = int("ANYDAG_API_PORT", 8790, 0, 65535);
  const host = text("ANYDAG_API_HOST") ?? "127.0.0.1";

  const adminToken = text("ANYDAG_API_ADMIN_TOKEN");
  if (adminToken !== null && adminToken.length < 16)
    throw new ConfigError(
      "ANYDAG_API_ADMIN_TOKEN must be at least 16 characters, and 32 in production (or unset, which turns the admin routes off)",
    );

  const historyDays = int("ANYDAG_API_HISTORY_DAYS", 30, 1, 36500);
  const poke = onOff("ANYDAG_API_POKE", true);

  const shown = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host.includes(":") ? `[${host}]` : host;
  const publicUrl = (text("ANYDAG_API_PUBLIC_URL") ?? `http://${shown}:${port}`).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(publicUrl))
    throw new ConfigError(`ANYDAG_API_PUBLIC_URL must be an http(s) URL, not ${JSON.stringify(publicUrl)}`);

  const maxBodyMb = int("ANYDAG_API_MAX_BODY_MB", 512, 1, 1024 * 1024);
  const logsDays = int("ANYDAG_API_LOGS_DAYS", 30, 1, 3650);

  const trustRaw = (pick("ANYDAG_API_TRUST_PROXY") ?? "off").trim().toLowerCase();
  if (trustRaw !== "off" && trustRaw !== "0" && !/^[1-8]$/.test(trustRaw))
    throw new ConfigError(`ANYDAG_API_TRUST_PROXY must be off or a hop count of at most 8, not ${JSON.stringify(trustRaw)}`);

  const production = env.NODE_ENV === "production";
  if (production && adminToken !== null && adminToken.length < 32)
    throw new ConfigError(
      `ANYDAG_API_ADMIN_TOKEN must be at least 32 characters when NODE_ENV is production, and ${value("ANYDAG_API_ADMIN_TOKEN", adminToken)} is shorter`,
    );

  /* The old names say themselves goodbye, with the names and never a value: every old name the
     environment still carries is named here once, whether its new spelling was set too or not. */
  for (const [name, old] of Object.entries(RENAMED)) {
    if (env[old] === undefined || warned.has(old)) continue;
    warned.add(old);
    warn(
      env[name] !== undefined
        ? `${old} is the old name of ${name} and both are set: the new name is used`
        : `${old} is the old name of ${name}; it is accepted for one release, then ignored`,
    );
  }

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
    sync: onOff("ANYDAG_API_SYNC", true),
    logs: onOff("ANYDAG_API_LOGS", true),
    feedback: onOff("ANYDAG_API_FEEDBACK", true),
    feedbackToken: text("ANYDAG_API_FEEDBACK_GITHUB_TOKEN"),
    feedbackRepo: text("ANYDAG_API_FEEDBACK_REPO"),
    logsDays,
    trustProxy: trustRaw === "off" ? 0 : Number(trustRaw),
    production,
  };
}

/** The config as boot prints it: every row a reader needs, and no secret value anywhere. */
export function describe(config: Config): string[] {
  const feature = (on: boolean) => (on ? "on" : "off");
  const rows = [
    `features: sync ${feature(config.sync)}, logs ${feature(config.logs)}, feedback ${feature(config.feedback)}`,
    `database: ${config.databaseUrl ? maskUrl(config.databaseUrl) : `PGlite in ${path.join(config.data, "pg")}`}`,
    `data: ${config.data}`,
    `admin: ${config.adminToken ? "<redacted>" : "off"}`,
    `public url: ${config.publicUrl}`,
    `trust proxy: ${config.trustProxy === 0 ? "off" : config.trustProxy}`,
  ];
  if (config.feedback)
    rows.splice(
      1,
      0,
      `feedback relay: ${config.feedbackRepo ?? "<no repo>"}, token ${config.feedbackToken ? "<redacted>" : "<unset>"}` +
        (config.feedbackToken && config.feedbackRepo ? "" : " — without repo and token the relay answers 503"),
    );
  return rows;
}
