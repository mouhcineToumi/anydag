/**
 * `POST /v1/logs` — logs from installs that said yes, kept as one file a day.
 *
 * Load-bearing:
 * - **Open, like `/v1/health` and `/v1/pair`**: an install that sends logs is usually not a device
 *   of this server, and the batch carries nothing a token would protect. What stands in for one is
 *   a size cap (`MAX_BATCH_BYTES`), a per-address rate (`PER_MINUTE`) and a whole-server one
 *   (`ALL_PER_MINUTE`); a batch over either is answered `{accepted: 0}` and dropped, never an error a
 *   client would retry.
 * - **The batch is `cleanBatch`'s again here** (`protocol/logs.ts`): whatever sent it, what is
 *   written is what that file can describe, every free-text field scrubbed once more.
 * - **On disk, never in the database**: `<data>/logs/YYYY-MM-DD.jsonl`, one event a line with its
 *   batch's `env` beside it, and nothing about the request — no address, no header. Files older than
 *   `ANYDAG_API_LOGS_DAYS` go the first time a day's file is opened. `ANYDAG_API_LOGS=off` turns
 *   the route into `ES_NOT_FOUND`.
 */

import fs from "node:fs";
import path from "node:path";

import { Hono } from "hono";

import { cleanBatch, MAX_BATCH_BYTES, type LogBatch, type LogsAccepted } from "../../protocol/logs";
import { clientAddress, HttpError, Rate, type Deps, type Vars } from "./http";

const PER_MINUTE = 30;
const ALL_PER_MINUTE = 3000;

/** The day files, and the pruning that keeps them to their number of days. */
export class LogStore {
  private day = "";

  constructor(
    readonly dir: string,
    private readonly days: number,
  ) {}

  append(batch: LogBatch, now: Date): number {
    const day = now.toISOString().slice(0, 10);
    if (day !== this.day) {
      fs.mkdirSync(this.dir, { recursive: true });
      this.prune(now);
      this.day = day;
    }
    const received = now.toISOString();
    const lines = batch.events
      .map((e) => JSON.stringify({ received, ...batch.env, name: e.name, at: e.at, props: e.props }))
      .join("\n");
    fs.appendFileSync(path.join(this.dir, `${day}.jsonl`), `${lines}\n`);
    return batch.events.length;
  }

  prune(now: Date): number {
    const oldest = new Date(now.getTime() - this.days * 86_400_000).toISOString().slice(0, 10);
    let gone = 0;
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return 0;
    }
    for (const name of names) {
      const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      if (m && m[1]! < oldest) {
        fs.rmSync(path.join(this.dir, name), { force: true });
        gone++;
      }
    }
    return gone;
  }
}

export function logRoutes(deps: Deps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();
  const store = new LogStore(path.join(deps.config.data, "logs"), deps.config.logsDays);
  const rate = new Rate(PER_MINUTE, ALL_PER_MINUTE);

  app.post("/v1/logs", async (c) => {
    if (!deps.config.logs) throw new HttpError("ES_NOT_FOUND", "this server does not keep logs");
    const none: LogsAccepted = { accepted: 0 };
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > MAX_BATCH_BYTES) return c.json(none, 202);
    if (!rate.allow(clientAddress(c, deps.config.trustProxy), deps.now().getTime())) return c.json(none, 202);
    const raw = await c.req.text();
    if (raw.length > MAX_BATCH_BYTES) return c.json(none, 202);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpError("ES_BAD_REQUEST", "the body is not JSON");
    }
    const batch = cleanBatch(parsed);
    if (!batch) return c.json(none, 202);
    const answer: LogsAccepted = { accepted: store.append(batch, deps.now()) };
    return c.json(answer, 202);
  });

  return app;
}
