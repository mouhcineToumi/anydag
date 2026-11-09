/**
 * One seed of the convergence harness: a world, its schedule, `settle`, and the three assertions.
 * A failing seed answers its failures and every step it took, so it can be read — and replayed
 * with `ANYDAG_SYNC_SEED=<seed>`, which runs that seed alone as a plain test.
 */

import type { Harness } from "../helpers";
import { Rng } from "./prng";
import { World } from "./world";

export interface SeedResult {
  seed: number;
  devices: number;
  steps: number;
  failures: string[];
  log: string[];
  ms: number;
}

export interface SeedOptions {
  /** Steps before settling; drawn from the seed when absent. */
  steps?: number;
  /** Devices; 2 or 3, drawn from the seed when absent. */
  devices?: number;
}

export async function runSeed(h: Harness, seed: number, opts: SeedOptions = {}): Promise<SeedResult> {
  const t0 = Date.now();
  const shape = new Rng(seed ^ 0x9e3779b9);
  const devices = opts.devices ?? shape.int(2, 3);
  const steps = opts.steps ?? shape.int(30, 80);
  const world = await World.create(h, seed, devices);
  let failures: string[] = [];
  try {
    for (let i = 0; i < steps; i++) await world.step();
    await world.settle();
    failures = await world.check();
  } catch (e) {
    failures = [`threw: ${(e as Error).stack ?? String(e)}`];
  } finally {
    await world.close();
  }
  return { seed, devices, steps, failures, log: world.log, ms: Date.now() - t0 };
}

export function describeFailure(r: SeedResult): string {
  return [
    `seed ${r.seed} (${r.devices} devices, ${r.steps} steps) failed:`,
    ...r.failures.map((f) => `  - ${f}`),
    "steps:",
    ...r.log.map((l) => `  ${l}`),
    `replay: ANYDAG_SYNC_SEED=${r.seed} npx vitest run sync/test/converge.test.ts`,
  ].join("\n");
}
