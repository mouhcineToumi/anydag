/**
 * What `GET /metrics` says: request counts and latencies by route
 * template, kept in this process, and the usage ledger's totals for today, read from `Meta`, in the
 * Prometheus text format.
 *
 * Load-bearing:
 * - **A label is a route template, a method or a status — never a value from a request.** No vault
 *   id, no account name, no blob id, no path a client chose: a scraper's database keeps every
 *   label it is given, so an id in one is both a leak and an unbounded series. A request no route
 *   matched is `route="unmatched"` for the same reason — a scanner walking random paths would
 *   otherwise mint a series per path.
 * - **Latency is a summary over a window**: `_sum` and `_count` since start, and the quantiles over
 *   the last `WINDOW` requests per series, which is what a person looking at a dashboard asks
 *   ("how slow is commit lately"), at a fixed memory cost.
 * - **Per-process.** Two instances behind one name are two scrape targets; the ledger, which is in
 *   the database, is the cross-instance truth.
 */

import { METRICS, SNAPSHOT_METRICS, type Metric } from "../protocol/wire";
import type { Meta } from "./meta/types";
import { dayOf } from "./usage";

const WINDOW = 1024;
const QUANTILES = [0.5, 0.9, 0.99];

interface Series {
  count: number;
  sum: number;
  recent: number[];
  at: number;
}

const esc = (v: string): string => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

export class Metrics {
  private readonly requests = new Map<string, number>();
  private readonly latency = new Map<string, Series>();
  /** Open poke streams, read when the text is made. */
  pokes: () => number = () => 0;

  record(route: string, method: string, status: number, seconds: number): void {
    const r = `route="${esc(route)}",method="${esc(method)}",status="${status}"`;
    this.requests.set(r, (this.requests.get(r) ?? 0) + 1);
    const l = `route="${esc(route)}",method="${esc(method)}"`;
    let s = this.latency.get(l);
    if (!s) this.latency.set(l, (s = { count: 0, sum: 0, recent: [], at: 0 }));
    s.count++;
    s.sum += seconds;
    if (s.recent.length < WINDOW) s.recent.push(seconds);
    else {
      s.recent[s.at] = seconds;
      s.at = (s.at + 1) % WINDOW;
    }
  }

  async text(meta: Meta, now: Date, version: string): Promise<string> {
    const out: string[] = [];
    out.push(
      "# HELP anydag_sync_info The server's version.",
      "# TYPE anydag_sync_info gauge",
      `anydag_sync_info{version="${esc(version)}"} 1`,
    );

    out.push(
      "# HELP anydag_sync_requests_total Requests answered, by route template, method and status.",
      "# TYPE anydag_sync_requests_total counter",
    );
    for (const [labels, n] of [...this.requests].sort()) out.push(`anydag_sync_requests_total{${labels}} ${n}`);

    out.push(
      "# HELP anydag_sync_request_duration_seconds Time to the response's headers, by route template.",
      "# TYPE anydag_sync_request_duration_seconds summary",
    );
    for (const [labels, s] of [...this.latency].sort(([a], [b]) => a.localeCompare(b))) {
      const sorted = [...s.recent].sort((a, b) => a - b);
      for (const q of QUANTILES) {
        const v = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : 0;
        out.push(`anydag_sync_request_duration_seconds{${labels},quantile="${q}"} ${v}`);
      }
      out.push(
        `anydag_sync_request_duration_seconds_sum{${labels}} ${s.sum}`,
        `anydag_sync_request_duration_seconds_count{${labels}} ${s.count}`,
      );
    }

    out.push(
      "# HELP anydag_sync_poke_streams Poke streams open now.",
      "# TYPE anydag_sync_poke_streams gauge",
      `anydag_sync_poke_streams ${this.pokes()}`,
    );

    /* The ledger for today, every account and vault folded together: the account-wide rows
     * (`vault` null) and the per-vault ones are separate figures, so a metric that has both is
     * reported from its account-wide rows when there are any, else from its vault rows. */
    const day = dayOf(now);
    const rows = await meta.usage({ since: day, until: day });
    const wide = new Map<Metric, number>();
    const perVault = new Map<Metric, number>();
    for (const r of rows) {
      const into = r.vault === null ? wide : perVault;
      into.set(r.metric, (into.get(r.metric) ?? 0) + Number(r.value));
    }
    out.push(
      "# HELP anydag_sync_usage_today The usage ledger's totals for today (UTC), across every account.",
      "# TYPE anydag_sync_usage_today gauge",
    );
    for (const m of METRICS) {
      const v = wide.has(m) ? wide.get(m)! : (perVault.get(m) ?? 0);
      out.push(`anydag_sync_usage_today{metric="${m}",kind="${SNAPSHOT_METRICS.has(m) ? "snapshot" : "counter"}"} ${v}`);
    }
    return out.join("\n") + "\n";
  }
}
