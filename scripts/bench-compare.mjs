#!/usr/bin/env node
/**
 * A pull request against its base, on one machine, side by side (#527).
 *
 *   node scripts/bench-compare.mjs --base <checkout> --head <checkout> [--rounds 3]
 *                                  [--only edit] [--sizes 1000] [--ratio 1.5] [--floor 50]
 *                                  [--base-name <s>] [--head-name <s>] [--json <file>] [--markdown <file>]
 *
 * `--base` and `--head` are two checkouts, each built (`npx vite build && node server/build.mjs`).
 * This script runs **this checkout's** `scripts/bench.mjs` on each with `--app`, so both builds are
 * measured by the same ruler, and alternates them: base then head, then head then base, and so on for
 * `--rounds` of each (`--base-name` and `--head-name` are what the report calls them; each checkout's
 * short commit by default). A runner's absolute numbers move with its neighbours; the same runner measuring
 * two builds one after the other, in turn, does not move between them.
 *
 * **What is flagged.** Each round's number is already a median (the bench times every action five
 * times). A metric in milliseconds is **slower** when all of these hold:
 *
 *   - the head's median over the rounds is at least `--ratio` times the base's (1.5);
 *   - and at least `--floor` milliseconds more (50) — a 20 ms action that takes 31 is not a
 *     regression anybody waits on, and it is where a frame's timing alone moves a number;
 *   - and every head round is slower than every base round: the two do not overlap;
 *   - and the metric is **stable**: the base's own rounds are within `--ratio` of each other. A
 *     metric that moves that much between two runs of the same build is reported as **noisy** and
 *     never flagged — a check that fails on noise is one nobody reads.
 *
 * **faster** is the same test the other way. Exit 0 when nothing is slower, 1 when something is, 2
 * when a run could not be made at all. The table is printed, and written as Markdown with
 * `--markdown` (the job summary and the pull request's comment) and as JSON with `--json`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULTS = { ratio: 1.5, floor: 50 };

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The runs of each side, `[{ results: [{ metric, value, unit }] }]`, as one row per metric with every
 * round's number on each side. A value that is not a number (`timeout`, `n/a`) is left out of its
 * side, and a metric in another unit than `ms` is left out altogether.
 */
export function rowsOf(baseRuns, headRuns) {
  const rows = new Map();
  const add = (runs, side) => {
    for (const run of runs)
      for (const r of run.results ?? []) {
        if (r.unit !== "ms") continue;
        if (!rows.has(r.metric)) rows.set(r.metric, { metric: r.metric, base: [], head: [] });
        if (typeof r.value === "number") rows.get(r.metric)[side].push(r.value);
      }
  };
  add(baseRuns, "base");
  add(headRuns, "head");
  return [...rows.values()];
}

/** Each row's verdict: `slower`, `faster`, `same`, `noisy`, or `missing` on one side. */
export function compare(rows, { ratio = DEFAULTS.ratio, floor = DEFAULTS.floor } = {}) {
  return rows.map((r) => {
    if (r.base.length === 0 || r.head.length === 0)
      return { ...r, verdict: "missing", why: r.base.length ? "no number on the head" : "no number on the base" };
    const b = median(r.base);
    const h = median(r.head);
    const spread = Math.min(...r.base) > 0 ? Math.max(...r.base) / Math.min(...r.base) : Number.POSITIVE_INFINITY;
    const out = { ...r, baseMs: b, headMs: h, ratio: b > 0 ? h / b : null, delta: h - b, spread };
    if (spread >= ratio) return { ...out, verdict: "noisy", why: `the base's own rounds are ${spread.toFixed(2)}× apart` };
    if (h >= b * ratio && h - b >= floor && Math.min(...r.head) > Math.max(...r.base)) return { ...out, verdict: "slower" };
    if (b >= h * ratio && b - h >= floor && Math.max(...r.head) < Math.min(...r.base)) return { ...out, verdict: "faster" };
    return { ...out, verdict: "same" };
  });
}

const ms = (x) => (x === null || x === undefined ? "—" : x >= 100 ? `${Math.round(x)} ms` : `${x.toFixed(1)} ms`);
const rounds = (xs) => xs.map((x) => Math.round(x)).join(", ");

/** The table, in Markdown: what moved first, then the rest. */
export function markdown(verdicts, { base, head, rounds: n, what, machine, ratio = DEFAULTS.ratio, floor = DEFAULTS.floor }) {
  const order = { slower: 0, faster: 1, noisy: 2, missing: 3, same: 4 };
  const sorted = [...verdicts].sort((a, b) => order[a.verdict] - order[b.verdict] || a.metric.localeCompare(b.metric));
  const slower = verdicts.filter((v) => v.verdict === "slower");
  const lines = [
    "<!-- anydag-bench -->",
    "### Bench: this pull request against its base",
    "",
    slower.length
      ? `**${slower.length} slower:** ${slower.map((v) => `\`${v.metric}\` ${ms(v.baseMs)} → ${ms(v.headMs)}`).join(", ")}.`
      : "**Nothing slower.**",
    "",
    `Base \`${base}\` and head \`${head}\`, measured in turn on one runner, ${n} rounds each (${what}). ` +
      `Slower means at least ${ratio}× and ${floor} ms more, every head round above every base round, ` +
      `on a metric whose base rounds are within ${ratio}× of each other. Advisory: it holds nothing back.`,
    "",
    "| Metric | Base | Head | Change | Verdict | Rounds, base · head |",
    "|---|---|---|---|---|---|",
    ...sorted.map((v) => {
      const change =
        v.verdict === "missing" ? v.why : `×${v.ratio?.toFixed(2)} (${v.delta >= 0 ? "+" : "−"}${ms(Math.abs(v.delta))})`;
      const verdict = v.verdict === "slower" ? "**slower**" : v.verdict === "noisy" ? `noisy: ${v.why}` : v.verdict;
      return `| \`${v.metric}\` | ${ms(v.baseMs)} | ${ms(v.headMs)} | ${change} | ${verdict} | ${rounds(v.base)} · ${rounds(v.head)} |`;
    }),
    "",
    machine ? `<sub>${machine}</sub>` : "",
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

/* -- the run ------------------------------------------------------------------------------------- */

function main(argv) {
  const opt = (name, dflt) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : dflt;
  };
  const base = opt("--base");
  const head = opt("--head");
  if (!base || !head) {
    console.error("bench-compare: --base <checkout> and --head <checkout> are both needed");
    return 2;
  }
  const n = Number(opt("--rounds", "3"));
  const only = opt("--only", "edit");
  const sizes = opt("--sizes", "1000");
  const ratio = Number(opt("--ratio", String(DEFAULTS.ratio)));
  const floor = Number(opt("--floor", String(DEFAULTS.floor)));
  for (const [side, dir] of [
    ["base", base],
    ["head", head],
  ])
    if (
      !fs.existsSync(path.join(dir, "server", "dist", "anydag-server.mjs")) ||
      !fs.existsSync(path.join(dir, "dist", "index.html"))
    ) {
      console.error(`bench-compare: the ${side} at ${dir} is not built — run \`npx vite build && node server/build.mjs\` in it`);
      return 2;
    }

  /* Each run's JSON goes in a temp folder of this script's own, removed by that exact path. */
  const tmp = fs.realpathSync(os.tmpdir());
  const work = fs.mkdtempSync(path.join(tmp, "anydag-compare-"));
  const runs = { base: [], head: [] };
  let machine = null;
  try {
    for (let i = 0; i < n; i++) {
      const order = i % 2 === 0 ? ["base", "head"] : ["head", "base"];
      for (const side of order) {
        const dir = side === "base" ? base : head;
        const out = path.join(work, `${side}-${i}.json`);
        console.log(`# round ${i + 1} of ${n}: ${side} (${dir})`);
        const r = spawnSync(
          process.execPath,
          [path.join(here, "bench.mjs"), "--app", dir, "--only", only, "--sizes", sizes, "--json", out],
          { stdio: "inherit" },
        );
        if (r.status !== 0 || !fs.existsSync(out)) {
          console.error(`bench-compare: the ${side} run of round ${i + 1} failed (exit ${r.status})`);
          return 2;
        }
        const json = JSON.parse(fs.readFileSync(out, "utf8"));
        machine ??= json.machine;
        runs[side].push(json);
      }
    }
  } finally {
    if (path.dirname(work) === tmp && path.basename(work).startsWith("anydag-compare-"))
      fs.rmSync(work, { recursive: true, force: true });
  }

  const verdicts = compare(rowsOf(runs.base, runs.head), { ratio, floor });
  const label = (dir, name) => {
    if (name) return name;
    const r = spawnSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : path.basename(dir);
  };
  const m = machine
    ? `${machine.cpu} · ${machine.cores} cores · ${machine.memoryGB} GB · ${machine.os} · Node ${machine.node}`
    : null;
  const md = markdown(verdicts, {
    base: label(base, opt("--base-name")),
    head: label(head, opt("--head-name")),
    rounds: n,
    what: `\`--only ${only} --sizes ${sizes}\``,
    machine: m,
    ratio,
    floor,
  });
  console.log(`\n${md}`);
  const outMd = opt("--markdown");
  if (outMd) fs.writeFileSync(outMd, md);
  const outJson = opt("--json");
  if (outJson)
    fs.writeFileSync(outJson, `${JSON.stringify({ machine, ratio, floor, rounds: n, only, sizes, verdicts }, null, 2)}\n`);
  return verdicts.some((v) => v.verdict === "slower") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
