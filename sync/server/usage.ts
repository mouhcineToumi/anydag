/**
 * The usage ledger's front door: `bump` adds to a counter, or sets a
 * snapshot metric, on today's UTC day, through `Meta.bump`.
 *
 * Load-bearing:
 * - **A counter is bumped after the work it counts has happened**, never before: a refused commit
 *   counts `conflicts_stale` and not `commits`, a blob already held counts no `bytes_up`.
 * - **A bump that fails never fails the request that earned it.** The commit has landed by the
 *   time `commits` is counted; answering a 500 then would send the client back with a parent that
 *   is now stale, for the sake of a number. The failure is said on stderr, and the count is lost —
 *   the ledger measures, it is not a record anybody is billed from yet.
 * - **The day is the server's clock's**, injected, so a test can cross midnight.
 */

import type { Metric } from "../protocol/wire";
import type { Meta } from "./meta/types";

export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

export class Usage {
  constructor(
    private readonly meta: Meta,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Add `n` (or set it, for a snapshot metric) for `account`, and `vault` or the account as a whole (`null`). */
  async bump(account: string, vault: string | null, metric: Metric, n: number): Promise<void> {
    try {
      await this.meta.bump(dayOf(this.now()), account, vault, metric, n);
    } catch (e) {
      console.error(`anydag-sync: could not count ${metric}: ${(e as Error).message}`);
    }
  }
}
