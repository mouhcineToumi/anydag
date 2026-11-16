/**
 * A watched vault's search index is kept up to date as the vault changes, not when somebody searches
 * (#267, `server/upkeep.ts`): made once the vault opens, and brought up to date after a write lands.
 */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Parsed } from "../../server/grammar";
import { keepIndexed, overOfVault } from "../../server/upkeep";
import { makeEnv, sweepTemps, type Env } from "./helpers";

let env: Env;
let stop: (() => void) | null = null;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  stop?.();
  stop = null;
  await env.cleanup();
  sweepTemps();
});

/** The keys the index's rows are for, and how many units its words table holds. */
function indexed(): { keys: string[]; units: number } {
  const file = path.join(env.homeDir, "parse.sqlite");
  if (!fs.existsSync(file)) return { keys: [], units: 0 };
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const set = db.prepare("select id from sets where root = ? and question = 'corpus'").get(env.root) as
      | { id: number }
      | undefined;
    if (!set) return { keys: [], units: 0 };
    const keys = (db.prepare("select key from texts where set_id = ? order by key").all(set.id) as { key: string }[]).map(
      (r) => r.key,
    );
    const units = Number((db.prepare(`select count(*) n from words_${set.id}`).get() as { n: number }).n);
    return { keys, units };
  } finally {
    db.close();
  }
}

const until = async (ok: () => boolean, ms = 10_000) => {
  const t = Date.now();
  while (!ok() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 25));
  return ok();
};

describe("the search index's upkeep", () => {
  it("makes the index once the vault opens, and follows a file written outside the app, with no search asked", async () => {
    await env.vault.create("Plan", "note", "# Plan\n\nPayments settle overnight.\n");
    await env.vault.create("Board", "board", "```md {#a}\nThe ledger closes at noon.\n```\n");
    await env.vault.watch();
    const before = fs.readdirSync(env.root).sort();
    const corpus = new Parsed("corpus", env.root, { home: env.homeDir });
    stop = keepIndexed(env.vault, corpus, null, 20, 50);
    expect(await until(() => indexed().keys.length === 2)).toBe(true);
    expect(indexed().keys).toEqual(["Board", "Plan.note.md"]);
    expect(indexed().units).toBeGreaterThan(2);

    // Another program writes a note: the index has it before anybody searches.
    fs.writeFileSync(path.join(env.root, "Agent.md"), "# Agent\n\nHarbour cranes unload at dawn.\n");
    expect(await until(() => indexed().keys.includes("Agent.note.md"))).toBe(true);
    const found = (await corpus.search(await overOfVault(env.vault), "harbour cranes")) as { hits: { name: string }[] };
    expect(found.hits.map((h) => h.name)).toEqual(["Agent"]);
    // The vault holds only what was written into it.
    expect(fs.readdirSync(env.root).sort()).toEqual([...before, "Agent.md"].sort());
  }, 20_000);

  it("waits for the references index to have been quiet a while, the page asking its next question then", async () => {
    await env.vault.create("Plan", "note", "# Plan\n\nPayments.\n");
    await env.vault.watch();
    const corpus = new Parsed("corpus", env.root, { home: env.homeDir });
    // A references index answered a moment ago, and again and again while the page is busy.
    let answeredAt = Date.now();
    const index = { settled: async () => undefined, idleMs: () => Date.now() - answeredAt } as unknown as Parsed;
    stop = keepIndexed(env.vault, corpus, index, 20, 300);
    const busy = Date.now();
    while (Date.now() - busy < 600) {
      answeredAt = Date.now();
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(indexed().keys).toEqual([]);
    // Quiet: the search index follows.
    expect(await until(() => indexed().keys.length === 1)).toBe(true);
    expect(Date.now() - answeredAt).toBeGreaterThanOrEqual(300);
  });

  it("stops when asked, and writes nothing more", async () => {
    await env.vault.create("Plan", "note", "# Plan\n\nPayments.\n");
    await env.vault.watch();
    const corpus = new Parsed("corpus", env.root, { home: env.homeDir });
    stop = keepIndexed(env.vault, corpus, null, 20, 50);
    expect(await until(() => indexed().keys.length === 1)).toBe(true);
    stop();
    fs.writeFileSync(path.join(env.root, "Later.md"), "# Later\n\nWords.\n");
    await new Promise((r) => setTimeout(r, 400));
    expect(indexed().keys).toEqual(["Plan.note.md"]);
  });
});
