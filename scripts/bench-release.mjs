#!/usr/bin/env node
/**
 * The release table: the fixed rows `node scripts/bench.mjs --release` prints, the numbers of the
 * release before it, and the file the next release will compare against (#328).
 *
 *   docs/bench/<version>.json   one release's numbers, written by `--save`, committed with the release
 *
 * The rows are fixed so two releases sit beside each other: the table is a comparison, not a report.
 * The file is committed rather than read off the previous release's notes so the comparison works
 * offline and a change to a number is a diff in a pull request. Nothing here runs in CI: the numbers
 * depend on the machine, and they are the release machine's.
 *
 * Kept apart from `bench.mjs` so the rows and the arithmetic can be held by a test without starting
 * a server or a browser.
 */
import fs from "node:fs";
import path from "node:path";

/** Where `--save` writes a release, and `--release` reads the one before it. */
export const RELEASE_DIR = path.join("docs", "bench");

/**
 * The rows, in the order the table prints them. `metric` is the bench's own name, so every cell can
 * be traced to the run; `unit` is what its value is in. Lower is better in every row.
 */
export const RELEASE_ROWS = [
  {
    metric: "desktop.startup.1000.cold.ready",
    label: "Startup to a drawn board, 1,000 files",
    unit: "ms",
  },
  {
    metric: "page.1000.search.first",
    label: "First search in the page, 1,000 files",
    unit: "ms",
  },
  {
    metric: "vault.1000.server.rss.rest",
    label: "Server memory at rest, 1,000 files",
    unit: "MB",
  },
  { metric: "vault.1000.list.cold", label: "`/__board/list` cold, 1,000 files", unit: "ms" },
  { metric: "vault.1000.list.warm", label: "`/__board/list` warm, 1,000 files", unit: "ms" },
  { metric: "vault.1000.index.cold", label: "`/__board/index` cold, 1,000 files", unit: "ms" },
  { metric: "vault.1000.index.warm", label: "`/__board/index` warm, 1,000 files", unit: "ms" },
  { metric: "vault.1000.search.cold", label: "`/__board/search` cold, 1,000 files", unit: "ms" },
  { metric: "vault.1000.search.warm", label: "`/__board/search` warm, 1,000 files", unit: "ms" },
  { metric: "board.500.ready", label: "A 500-item board to `data-dag-ready`", unit: "ms" },
];

/** A version's numbers in RELEASE_ROWS order; a row the run did not measure says `n/a`. */
export function releaseResults(results) {
  return RELEASE_ROWS.map((row) => {
    const found = results.find((r) => r.metric === row.metric);
    return { metric: row.metric, value: found ? found.value : "n/a", unit: row.unit };
  });
}

/**
 * The results as `metric → { value, unit }`, which is what the table reads. A row the run did not
 * measure is absent, so the table can tell it from a row measured as `n/a`.
 */
export function releaseValues(results) {
  const out = {};
  for (const row of RELEASE_ROWS) {
    const found = results.find((r) => r.metric === row.metric);
    if (found) out[row.metric] = { value: found.value, unit: row.unit };
  }
  return out;
}

/** `MAJOR.MINOR.PATCH` of a version, or null: what decides which file is the previous release. */
function versionNumber(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersion(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * The greatest release committed in `dir` before `version`, with its results, or null when this is
 * the first release to carry the table. A file for the current version is not "previous": the table
 * compares two releases, not a version with itself.
 */
export function previousRelease(dir, version) {
  const current = versionNumber(version);
  if (!current) return null;
  let best = null;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const found = versionNumber(name.slice(0, -".json".length));
    if (!found || compareVersion(found, current) >= 0) continue;
    if (best && compareVersion(found, best.number) <= 0) continue;
    best = { version: name.slice(0, -".json".length), number: found };
  }
  if (!best) return null;
  const file = path.join(dir, `${best.version}.json`);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} is not a release file: ${e.message}`);
  }
  if (data.version !== best.version || !Array.isArray(data.results)) {
    throw new Error(`${file} is not a release file: it needs "version": "${best.version}" and a "results" list`);
  }
  return { version: best.version, results: data.results, machine: data.machine ?? "" };
}

/** The rows a run did not measure, so `--save` can refuse a file with a hole in it. */
export function missingReleaseRows(results) {
  return releaseResults(results).filter((r) => r.value === "n/a" || r.value === null || r.value === undefined);
}

/**
 * Write `dir/<version>.json` for the next release. It holds the table's rows only, a smaller file to
 * read and diff than `--json`'s whole run.
 */
export function writeRelease(dir, { version, date, machine, results }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${version}.json`);
  const body = { version, date, machine, results: releaseResults(results) };
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return file;
}

const cell = (entry, unit) => {
  if (!entry || entry.value === null || entry.value === undefined) return "—";
  if (typeof entry.value === "number") return `${entry.value} ${entry.unit ?? unit}`;
  return String(entry.value);
};

/** The new number against the old, in percent; `—` when either is not a number. */
function changeOf(now, before) {
  if (typeof now?.value !== "number" || typeof before?.value !== "number" || before.value === 0) return "—";
  const pct = Math.round(((now.value - before.value) / before.value) * 1000) / 10;
  if (pct === 0) return "0%";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

/** One Markdown table, ready to paste into the release notes. */
export function releaseTable({ version, machine, current, previous = null, previousVersion = null }) {
  const rows = RELEASE_ROWS.map((row) => {
    const now = current[row.metric] ?? { value: "n/a" };
    const before = previous?.[row.metric];
    return `| ${row.label} | ${cell(now, row.unit)} | ${cell(before, row.unit)} | ${changeOf(now, before)} |`;
  });
  const lines = [`### Bench, ${version}`, "", `Machine: ${machine}`];
  if (!previous) lines.push("", "_No earlier release is committed in `docs/bench/`: this is the first table._");
  lines.push(
    "",
    `| Metric | ${version} | ${previousVersion ?? "Previous"} | Change |`,
    "|---|---:|---:|---:|",
    ...rows,
    "",
    "Change is this release against the previous one, in percent; lower is better in every row.",
  );
  return lines.join("\n");
}
