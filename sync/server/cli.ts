/**
 * `anydag-sync` — the server's one binary: `serve` runs it, and every
 * other command is an operator's act done **against the database directly**, with the same config,
 * so making an account or minting a pairing code needs no running server and no admin token.
 *
 *     anydag-sync serve | migrate
 *     anydag-sync account add <name> [--plan <id>] | account ls
 *     anydag-sync pair <account>
 *     anydag-sync device ls <account> | device revoke <account> <id>
 *     anydag-sync plan set <id> [--storage-bytes N] [--history-days N] [--history-bytes N] [--max-file-bytes N] [--devices N] [--account <name>]
 *     anydag-sync usage [--account <name>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--json]
 *     anydag-sync gc
 *
 * Load-bearing:
 * - **Exit codes are a contract**: 0 done, 1 refused (an unknown account, a busy PGlite folder, a
 *   bad config), 2 usage. A script branches on them.
 * - **The acts are the admin routes' helpers**, called with a `Meta` instead of a request, so the
 *   CLI and `/v1/admin/*` cannot drift: one `mintPairCode`, one `parsePlan`, one `collect`.
 * - **`plan set` keeps what it is not told**: a limit not given is the plan's current one, and
 *   `none` sets it back to unlimited. Writing every unspecified limit as null would make raising
 *   one limit quietly lift the rest.
 * - **The bundle runs `main` itself** (the entry check below); imported by a test, it does not.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { configFrom, type Config } from "./config";
import { collect, diskAge } from "./gc";
import { openStore, serve } from "./main";
import { adminAccount, findAccount, parsePlan, planExists } from "./routes/admin";
import { HttpError } from "./routes/http";
import { mintPairCode, wireDevice } from "./routes/pair";

const HELP = `anydag-sync — the AnyDag sync server

  serve                              run the server (config from the environment)
  migrate                            apply the database migrations and exit
  account add <name> [--plan <id>]   make an account
  account ls                         list accounts
  pair <account>                     print a one-time pairing code for an account
  device ls <account>                list an account's devices
  device revoke <account> <id>       revoke a device
  plan set <id> [--storage-bytes N] [--history-days N] [--history-bytes N] [--max-file-bytes N] [--devices N] [--account <name>]
                                     write a plan (N or "none"), and put an account on it
  usage [--account <name>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--json]
                                     print the usage ledger
  gc                                 run the collector once

Environment: ANYDAG_SYNC_MODE, DATABASE_URL (unset: PGlite in ANYDAG_SYNC_DATA/pg), ANYDAG_SYNC_DATA,
ANYDAG_SYNC_PORT, ANYDAG_SYNC_HOST, ANYDAG_SYNC_ADMIN_TOKEN, ANYDAG_SYNC_HISTORY_DAYS, ANYDAG_SYNC_POKE,
ANYDAG_SYNC_PUBLIC_URL, ANYDAG_SYNC_MAX_BODY_MB.
Exit codes: 0 done, 1 refused, 2 usage.`;

class Usage extends Error {}

interface Parsed {
  words: string[];
  flags: Map<string, string | true>;
}

const VALUED = new Set([
  "plan",
  "storage-bytes",
  "history-days",
  "history-bytes",
  "max-file-bytes",
  "devices",
  "account",
  "since",
  "until",
]);

function parse(argv: string[]): Parsed {
  const words: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h") flags.set("help", true);
    else if (a.startsWith("--")) {
      const [name, inline] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (VALUED.has(name)) {
        const v = inline ?? argv[++i];
        if (v === undefined) throw new Usage(`--${name} needs a value`);
        flags.set(name, v);
      } else if (["json", "help"].includes(name)) flags.set(name, true);
      else throw new Usage(`unknown flag --${name}`);
    } else words.push(a);
  }
  return { words, flags };
}

function flag(p: Parsed, name: string): string | undefined {
  const v = p.flags.get(name);
  return typeof v === "string" ? v : undefined;
}

function limit(raw: string, name: string): number | null {
  if (raw === "none" || raw === "null" || raw === "unlimited") return null;
  if (!/^\d+$/.test(raw)) throw new Usage(`--${name} takes a whole number or "none"`);
  return Number(raw);
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows
    .map((r) =>
      r
        .map((c, i) => c.padEnd(widths[i]!))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  out: (s: string) => void = console.log,
): Promise<number> {
  let p: Parsed;
  try {
    p = parse(argv);
  } catch (e) {
    console.error(`anydag-sync: ${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  const [cmd, sub, ...rest] = p.words;
  if (p.flags.has("help") || cmd === "help") {
    out(HELP);
    return 0;
  }
  if (!cmd) {
    console.error(HELP);
    return 2;
  }

  let config: Config;
  try {
    config = configFrom(env);
  } catch (e) {
    console.error(`anydag-sync: ${(e as Error).message}`);
    return 1;
  }

  if (cmd === "serve") {
    try {
      await serve(config);
      return 0;
    } catch (e) {
      console.error(`anydag-sync: ${(e as Error).message}`);
      return 1;
    }
  }

  const known = new Set(["migrate", "account", "pair", "device", "plan", "usage", "gc"]);
  if (!known.has(cmd)) {
    console.error(`anydag-sync: no command ${cmd}\n\n${HELP}`);
    return 2;
  }

  let store;
  try {
    store = await openStore(config);
  } catch (e) {
    console.error(`anydag-sync: ${(e as Error).message}`);
    return 1;
  }
  const { meta } = store;
  const need = (word: string | undefined, what: string): string => {
    if (!word) throw new Usage(`missing ${what}`);
    return word;
  };
  const account = async (ref: string) => {
    const a = await findAccount(meta, ref);
    if (!a) throw new HttpError("ES_NOT_FOUND", `no account ${ref}`);
    return a;
  };
  const json = p.flags.has("json");

  try {
    switch (cmd) {
      case "migrate":
        out("migrated");
        return 0;

      case "account": {
        if (sub === "add") {
          const name = need(rest[0], "the account's name");
          if (!/^[A-Za-z0-9_.@-]{1,100}$/.test(name))
            throw new Usage("an account name is letters, digits, dots, dashes, underscores and @");
          if (await meta.accountByName(name)) throw new HttpError("ES_BAD_REQUEST", `an account called ${name} exists`);
          const plan = flag(p, "plan");
          if (plan && !(await planExists(meta, plan))) throw new HttpError("ES_NOT_FOUND", `no plan ${plan}`);
          const a = await meta.createAccount(name, plan);
          out(json ? JSON.stringify(await adminAccount(meta, a)) : `${a.id}  ${a.name}  plan ${a.plan}`);
          return 0;
        }
        if (sub === "ls") {
          const all = await Promise.all((await meta.accounts()).map((a) => adminAccount(meta, a)));
          if (json) out(JSON.stringify(all, null, 2));
          else if (!all.length) out("no accounts");
          else
            out(
              table([
                ["ID", "NAME", "PLAN", "DEVICES", "VAULTS", "CREATED"],
                ...all.map((a) => [a.id, a.name, a.plan, String(a.devices), String(a.vaults), a.created]),
              ]),
            );
          return 0;
        }
        throw new Usage("account add <name> | account ls");
      }

      case "pair": {
        const a = await account(need(sub, "an account"));
        const { code, expires } = await mintPairCode(meta, a.id, new Date());
        if (json) out(JSON.stringify({ code, expires, url: config.publicUrl }));
        else out(`server: ${config.publicUrl}\ncode:   ${code}\nvalid until ${expires}, once`);
        return 0;
      }

      case "device": {
        if (sub === "ls") {
          const a = await account(need(rest[0], "an account"));
          const devices = (await meta.devices(a.id)).map((d) => wireDevice(d));
          if (json) out(JSON.stringify(devices, null, 2));
          else if (!devices.length) out("no devices");
          else
            out(
              table([
                ["ID", "NAME", "PLATFORM", "CREATED", "SEEN", "REVOKED"],
                ...devices.map((d) => [d.id, d.name, d.platform, d.created, d.seen ?? "-", d.revoked ?? "-"]),
              ]),
            );
          return 0;
        }
        if (sub === "revoke") {
          const a = await account(need(rest[0], "an account"));
          const id = need(rest[1], "a device id");
          if (!(await meta.revokeDevice(a.id, id, new Date().toISOString())))
            throw new HttpError("ES_NOT_FOUND", `no device ${id} in ${a.name}`);
          out(`revoked ${id}`);
          return 0;
        }
        throw new Usage("device ls <account> | device revoke <account> <id>");
      }

      case "plan": {
        if (sub !== "set")
          throw new Usage(
            "plan set <id> [--storage-bytes N] [--history-days N] [--history-bytes N] [--max-file-bytes N] [--devices N] [--account <name>]",
          );
        const id = need(rest[0], "a plan id");
        const current = await meta.plan(id);
        const base: Record<string, unknown> = current.id === id ? { ...current } : {};
        for (const [f, k] of [
          ["storage-bytes", "storage_bytes"],
          ["history-days", "history_days"],
          ["history-bytes", "history_bytes"],
          ["max-file-bytes", "max_file_bytes"],
          ["devices", "devices"],
        ] as const) {
          const v = flag(p, f);
          if (v !== undefined) base[k] = limit(v, f);
        }
        const plan = parsePlan(id, base);
        await meta.putPlan(plan);
        const onto = flag(p, "account");
        if (onto) await meta.setAccountPlan((await account(onto)).id, plan.id);
        out(
          json
            ? JSON.stringify(plan)
            : `plan ${plan.id}: ${["storage_bytes", "history_days", "history_bytes", "max_file_bytes", "devices"].map((k) => `${k}=${plan[k as keyof typeof plan] ?? "unlimited"}`).join(" ")}${onto ? ` — ${onto} is on it` : ""}`,
        );
        return 0;
      }

      case "usage": {
        const filter: { account?: string; since?: string; until?: string } = {};
        const ref = flag(p, "account");
        if (ref) filter.account = (await account(ref)).id;
        for (const k of ["since", "until"] as const) {
          const d = flag(p, k);
          if (d === undefined) continue;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Usage(`--${k} is YYYY-MM-DD`);
          filter[k] = d;
        }
        const rows = (await meta.usage(filter)).map((r) => ({ ...r, value: Number(r.value) }));
        if (json) out(JSON.stringify(rows, null, 2));
        else if (!rows.length) out("no usage recorded");
        else
          out(
            table([
              ["DAY", "ACCOUNT", "VAULT", "METRIC", "VALUE"],
              ...rows.map((r) => [r.day, r.account, r.vault ?? "-", r.metric, String(r.value)]),
            ]),
          );
        return 0;
      }

      case "gc": {
        const r = await collect(meta, store.blobs, {
          historyDays: config.historyDays,
          now: new Date(),
          ageOf: diskAge(store.blobRoot),
        });
        out(json ? JSON.stringify(r) : `${r.compacted} log rows compacted, ${r.blobs} blobs (${r.bytes} bytes) removed`);
        return 0;
      }
    }
    return 2;
  } catch (e) {
    if (e instanceof Usage) {
      console.error(`anydag-sync: ${e.message}`);
      return 2;
    }
    console.error(`anydag-sync: ${(e as Error).message}`);
    return 1;
  } finally {
    await store.close();
  }
}

/* The bundle's entry: run when this file (or the bundle made from it) is the program, not when imported. */
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  void main(process.argv.slice(2)).then((code) => {
    if (process.argv[2] !== "serve" || code !== 0) process.exit(code);
  });
}
