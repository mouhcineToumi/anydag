#!/usr/bin/env node
/**
 * **The development health report at each stable release** (#529).
 *
 *     node scripts/release-report.mjs 0.8.0              write docs/metrics/0.8.0.json and .md, print the MD
 *     node scripts/release-report.mjs 0.8.0 --attach     …and upload both to the v0.8.0 GitHub release
 *     node scripts/release-report.mjs                    the version in VERSION
 *     node scripts/release-report.mjs 0.8.0 --refresh    ignore the response cache (a fresh API read)
 *     node scripts/release-report.mjs 0.8.0 --no-audit   do not run `npm audit`/`npm outdated`
 *
 * The window for `X.Y.Z` is `(the previous stable tag, vX.Y.Z]` — fixed by tags, not by the clock, so
 * re-running for the same version writes the same JSON. The first release has no earlier tag, so its
 * window is the seven days before it. Every metric also shows a rolling 7-day value: the same
 * computation over `(the tag − 7 days, the tag]`, or, for a point-in-time row, the median of the
 * release snapshots in that week.
 *
 * The report is committed in `docs/metrics/` with the back-merge into `develop`
 * (`docs/RELEASING.md`), and `release.yml` attaches it to the release. The definitions are in
 * `docs/metrics/README.md`; the arithmetic and the rendering are in `scripts/lib/release-report.mjs`.
 *
 * **The repository is public, so the report is.** Security findings appear as counts by severity and
 * age only, never as the finding itself (`SECURITY.md`). Nothing here reads or prints a secret.
 *
 * The GitHub API is read through `gh` (authenticated by `GH_TOKEN` in CI, by `gh auth` locally), and
 * tags are read from the checkout: run it with the tags fetched (`git fetch --tags`) and, in CI,
 * `fetch-depth: 0`. Responses are cached under `node_modules/.cache/release-report/` by endpoint, so
 * a backfill of eight releases reads each issue and pull request once.
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { RELEASE_ROWS } from "./bench-release.mjs";
import { compareVersions, median, METRICS, rate, reportsUpTo, summarize, WEEK_MS } from "./lib/release-report.mjs";
import { parseVersion } from "./lib/version.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const METRICS_DIR = path.join(ROOT, "docs", "metrics");
const BENCH_DIR = path.join(ROOT, "docs", "bench");
const DAY_MS = 24 * 60 * 60 * 1000;

/* ── CLI ────────────────────────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    [
      "usage: node scripts/release-report.mjs [version] [--attach] [--refresh] [--no-audit]",
      "",
      "  version    the stable version to report; defaults to VERSION",
      "  --attach   upload the JSON and the MD to the v<version> GitHub release",
      "  --refresh  ignore the response cache and read the API again",
      "  --no-audit do not run npm audit/outdated for the current release",
    ].join("\n"),
  );
  process.exit(0);
}
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const version = positional[0] ?? fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const attach = flags.has("--attach");
const refresh = flags.has("--refresh");
const noAudit = flags.has("--no-audit");

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`release-report: '${version}' is not a stable X.Y.Z version`);
  process.exit(2);
}

/* ── GitHub, through gh ─────────────────────────────────────────────────────────────────────── */

const cacheDir = fs.existsSync(path.join(ROOT, "node_modules"))
  ? path.join(ROOT, "node_modules", ".cache", "release-report")
  : path.join(os.tmpdir(), "anydag-release-report");

function cacheFile(key) {
  return path.join(cacheDir, `${crypto.createHash("sha1").update(key).digest("hex")}.json`);
}

function cacheRead(key) {
  if (refresh) return undefined;
  try {
    return JSON.parse(fs.readFileSync(cacheFile(key), "utf8")).data;
  } catch {
    return undefined;
  }
}

function cacheWrite(key, data) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile(key), JSON.stringify({ key, data }));
  } catch {
    /* a cache that cannot be written is only slower */
  }
}

function cached(key, load) {
  const found = cacheRead(key);
  if (found !== undefined) return found;
  const data = load();
  cacheWrite(key, data);
  return data;
}

async function cachedAsync(key, load) {
  const found = cacheRead(key);
  if (found !== undefined) return found;
  const data = await load();
  cacheWrite(key, data);
  return data;
}

const execFileAsync = promisify(execFile);

function gh(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const why = (e.stderr || e.message || "").toString().trim();
    throw new Error(`gh ${args.join(" ")} failed: ${why}`);
  }
}

async function ghAsync(args) {
  try {
    const { stdout } = await execFileAsync("gh", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    const why = (e.stderr || e.message || "").toString().trim();
    throw new Error(`gh ${args.join(" ")} failed: ${why}`);
  }
}

/** Run `worker` over `items` with at most `limit` in flight; the GitHub API likes a small pool. */
async function pool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

const repo = process.env.GITHUB_REPOSITORY ?? JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
const api = (endpoint) => `repos/${repo}/${endpoint}`;

/** One request, for an object answer (check runs, workflow runs). */
function ghJson(endpoint) {
  return cached(`json:${endpoint}`, () => JSON.parse(gh(["api", endpoint])));
}

async function ghJsonAsync(endpoint) {
  return cachedAsync(`json:${endpoint}`, async () => JSON.parse(await ghAsync(["api", endpoint])));
}

/** Every page of a list endpoint, as one array. */
function ghList(endpoint) {
  return cached(`list:${endpoint}`, () => {
    const pages = JSON.parse(gh(["api", "--paginate", "--slurp", endpoint]));
    return pages.flatMap((page) => (Array.isArray(page) ? page : [page]));
  });
}

async function ghListAsync(endpoint) {
  return cachedAsync(`list:${endpoint}`, async () => {
    const pages = JSON.parse(await ghAsync(["api", "--paginate", "--slurp", endpoint]));
    return pages.flatMap((page) => (Array.isArray(page) ? page : [page]));
  });
}

/** Every page of an object endpoint whose rows are under `key` (`workflow_runs`). */
function ghPages(endpoint, key) {
  return cached(`pages:${endpoint}:${key}`, () => {
    const pages = JSON.parse(gh(["api", "--paginate", "--slurp", endpoint]));
    return pages.flatMap((page) => (Array.isArray(page) ? page : (page[key] ?? [])));
  });
}

/* ── The checkout: tags and reverts ────────────────────────────────────────────────────────── */

function readTags() {
  const format = "%(refname:short)%09%(creatordate:iso-strict)%09%(objectname)";
  const out = execFileSync("git", ["for-each-ref", `--format=${format}`, "refs/tags"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const tags = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [tag, date] = line.split("\t");
    if (!tag?.startsWith("v")) continue;
    const parsed = parseVersion(tag.slice(1));
    if (!parsed) continue;
    tags.push({
      tag,
      version: tag.slice(1),
      kind: parsed.kind,
      time: new Date(date).toISOString(),
      ms: Date.parse(date),
    });
  }
  return tags;
}

const TAGS = readTags();
const TARGET = TAGS.find((t) => t.kind === "stable" && t.version === version);
if (!TARGET) {
  console.error(`release-report: no stable tag v${version} in this checkout — run git fetch --tags`);
  process.exit(2);
}

const TO_MS = TARGET.ms;
const STABLES = TAGS.filter((t) => t.kind === "stable" && t.ms <= TO_MS).sort((a, b) => compareVersions(a.version, b.version));
const NIGHTLIES = TAGS.filter((t) => t.kind === "nightly" && t.ms <= TO_MS).sort((a, b) => a.ms - b.ms);
const PREVIOUS = STABLES.filter((t) => compareVersions(t.version, version) < 0).at(-1) ?? null;
const FROM_MS = PREVIOUS ? PREVIOUS.ms : TO_MS - WEEK_MS;
const ROLLING_FROM_MS = TO_MS - WEEK_MS;
const FROM = new Date(FROM_MS).toISOString();
const TO = new Date(TO_MS).toISOString();
const ROLLING_FROM = new Date(ROLLING_FROM_MS).toISOString();

/** A tag of `kind` that contains a commit, at or before this release, earliest first. */
const tagContainsCache = new Map();
function firstTag(kind, sha) {
  if (!sha) return null;
  const key = `${kind}:${sha}`;
  if (tagContainsCache.has(key)) return tagContainsCache.get(key);
  let names = [];
  try {
    names = execFileSync("git", ["tag", "--contains", sha], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    names = [];
  }
  const found = new Set(names);
  const tag =
    TAGS.filter((t) => t.kind === kind && found.has(t.tag) && t.ms <= TO_MS).sort(
      (a, b) => a.ms - b.ms || compareVersions(a.version, b.version),
    )[0] ?? null;
  tagContainsCache.set(key, tag);
  return tag;
}

/** `Revert "… (#123)"` commits at or before this release, with the pull request they name. */
function readReverts() {
  const format = "%H%x09%cI%x09%s%x09%b%x1e";
  const out = execFileSync("git", ["log", `--format=${format}`, TARGET.tag], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const reverts = [];
  for (const record of out.split("\x1e")) {
    const [sha, date, subject, ...rest] = record.replace(/^\n/, "").split("\t");
    if (!sha || !date || !subject) continue;
    if (!/^Revert "/.test(subject)) continue;
    const body = [subject, ...rest].join("\t");
    const named = /This reverts commit ([0-9a-f]{7,40})/i.exec(body)?.[1] ?? null;
    const pr = /\(#(\d+)\)\s*$/.exec(subject)?.[1];
    reverts.push({ sha, date, ms: Date.parse(date), reverted: named, pr: pr ? Number(pr) : null });
  }
  return reverts;
}

const REVERTS = readReverts();

/* ── The data ──────────────────────────────────────────────────────────────────────────────── */

const pulls = ghList(api("pulls?state=all&per_page=100&sort=created&direction=asc")).map((p) => ({
  number: p.number,
  title: p.title,
  body: p.body ?? "",
  state: p.state,
  createdAt: p.created_at,
  mergedAt: p.merged_at,
  closedAt: p.closed_at,
  mergeCommit: p.merge_commit_sha,
  additions: p.additions ?? 0,
  deletions: p.deletions ?? 0,
  labels: (p.labels ?? []).map((l) => l.name),
  base: p.base?.ref ?? "",
  headRef: p.head?.ref ?? "",
  headSha: p.head?.sha ?? "",
}));

const issues = ghList(api("issues?state=all&per_page=100"))
  .filter((i) => !i.pull_request)
  .map((i) => ({
    number: i.number,
    title: i.title,
    body: i.body ?? "",
    state: i.state,
    createdAt: i.created_at,
    closedAt: i.closed_at,
    labels: (i.labels ?? []).map((l) => l.name),
    timeline: [],
  }));

const issueByNumber = new Map(issues.map((i) => [i.number, i]));

/* Every issue's timeline: the label history (WIP, status: ready), reopens, and the cross-reference
   that names the pull request which fixed it. One request per issue, cached by endpoint, eight at a
   time so a cold backfill is minutes rather than half an hour. */
await pool(issues, 8, async (issue) => {
  issue.timeline = await ghListAsync(api(`issues/${issue.number}/timeline?per_page=100`));
});

function eventTime(event) {
  return Date.parse(event.created_at);
}

/** The labels on an issue at `ms`: undo, in reverse, the label events after that moment. */
function labelsAt(issue, ms) {
  const labels = new Set(issue.labels);
  for (const event of [...issue.timeline].reverse()) {
    if (eventTime(event) <= ms) break;
    if (event.event === "labeled" && event.label?.name) labels.delete(event.label.name);
    if (event.event === "unlabeled" && event.label?.name) labels.add(event.label.name);
  }
  return labels;
}

/** Whether an issue was open at `ms`: undo the close/reopen events after it from its state now. */
function openAt(issue, ms) {
  let open = issue.state === "open";
  for (const event of [...issue.timeline].reverse()) {
    if (eventTime(event) <= ms) break;
    if (event.event === "closed") open = true;
    if (event.event === "reopened") open = false;
  }
  return open;
}

/** The intervals an issue carried `status: in-progress` while open, as `[from, to|null]`. */
function inProgressIntervals(issue) {
  const events = [...issue.timeline].sort((a, b) => eventTime(a) - eventTime(b));
  let label = false;
  let closed = false;
  let since = null;
  const intervals = [];
  const step = (ms) => {
    const now = label && !closed;
    if (now && since === null) since = ms;
    if (!now && since !== null) {
      intervals.push([since, ms]);
      since = null;
    }
  };
  for (const event of events) {
    const ms = eventTime(event);
    if (event.event === "labeled" && event.label?.name === "status: in-progress") {
      label = true;
      step(ms);
    } else if (event.event === "unlabeled" && event.label?.name === "status: in-progress") {
      label = false;
      step(ms);
    } else if (event.event === "closed") {
      closed = true;
      step(ms);
    } else if (event.event === "reopened") {
      closed = false;
      step(ms);
    }
  }
  if (since !== null) intervals.push([since, issue.state === "closed" && issue.closedAt ? Date.parse(issue.closedAt) : null]);
  return intervals;
}

/** How much of `[fromMs, toMs]` an interval list covers, in milliseconds. */
function overlap(intervals, fromMs, toMs) {
  let total = 0;
  for (const [start, end] of intervals) {
    const a = Math.max(start, fromMs);
    const b = Math.min(end ?? toMs, toMs);
    if (b > a) total += b - a;
  }
  return total;
}

/* ── Pull requests in the window, enriched ─────────────────────────────────────────────────── */

const closingPattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)/gi;
function closingRefs(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(closingPattern)) out.push(Number(m[1]));
  return [...new Set(out)];
}

/** The issue cross-referenced by this pull request close to its merge, when its body names none. */
function fallbackIssue(pr) {
  const merged = pr.mergedAt ? Date.parse(pr.mergedAt) : null;
  if (!merged) return null;
  for (const issue of issues) {
    if (!issue.closedAt) continue;
    if (Math.abs(Date.parse(issue.closedAt) - merged) > 10 * 60_000) continue;
    for (const event of issue.timeline) {
      if (event.event !== "cross-referenced") continue;
      if (event.source?.issue?.number === pr.number && event.source.issue.pull_request) return issue.number;
    }
  }
  return null;
}

function inWindow(iso, fromMs, toMs) {
  if (!iso) return false;
  const ms = Date.parse(iso);
  return ms > fromMs && ms <= toMs;
}

const relevantPulls = pulls.filter(
  (p) =>
    inWindow(p.mergedAt, ROLLING_FROM_MS, TO_MS) ||
    inWindow(p.closedAt, ROLLING_FROM_MS, TO_MS) ||
    inWindow(p.createdAt, ROLLING_FROM_MS, TO_MS),
);

await pool(relevantPulls, 4, async (pr) => {
  const detail = await ghJsonAsync(api(`pulls/${pr.number}`));
  pr.additions = detail.additions ?? 0;
  pr.deletions = detail.deletions ?? 0;
  pr.commits = (await ghListAsync(api(`pulls/${pr.number}/commits?per_page=100`))).map((c) => ({
    sha: c.sha,
    date: c.commit?.author?.date ?? c.commit?.committer?.date ?? null,
    committed: c.commit?.committer?.date ?? null,
    message: c.commit?.message ?? "",
    parents: c.parents?.length ?? 0,
    committer: c.commit?.committer?.name ?? "",
  }));
  pr.firstCommit = [...pr.commits].sort((a, b) => Date.parse(a.date ?? 0) - Date.parse(b.date ?? 0))[0] ?? null;
  pr.reviews = (await ghListAsync(api(`pulls/${pr.number}/reviews?per_page=100`))).map((r) => ({
    state: r.state,
    at: r.submitted_at,
  }));
  pr.checks = {};
  await pool(pr.commits, 3, async (commit) => {
    const result = await ghJsonAsync(api(`commits/${commit.sha}/check-runs?per_page=100&filter=all`));
    pr.checks[commit.sha] = result.check_runs ?? [];
  });
  pr.runs = pr.headSha
    ? ((await ghJsonAsync(api(`actions/runs?head_sha=${pr.headSha}&per_page=100`))).workflow_runs ?? []).filter(
        (r) => r.event === "pull_request" && (r.path === ".github/workflows/ci.yml" || r.path === ".github/workflows/e2e.yml"),
      )
    : [];
  pr.timeline = await ghListAsync(api(`issues/${pr.number}/timeline?per_page=100`));
  pr.linkedIssue = closingRefs(pr.body).find((n) => issueByNumber.has(n)) ?? fallbackIssue(pr) ?? null;
});

/* The pull request each bug was fixed by: the body's closing reference, or the cross-reference that
   arrived within ten minutes of the issue closing. A mention elsewhere does not count as the fix. */
for (const issue of issues) {
  const refs = new Set();
  for (const pr of pulls) {
    if (pr.mergedAt && closingRefs(pr.body).includes(issue.number)) refs.add(pr.number);
  }
  if (issue.closedAt) {
    for (const event of issue.timeline) {
      if (event.event !== "cross-referenced" || !event.source?.issue?.pull_request) continue;
      const pr = pulls.find((p) => p.number === event.source.issue.number);
      if (!pr?.mergedAt) continue;
      if (Math.abs(Date.parse(pr.mergedAt) - Date.parse(issue.closedAt)) <= 10 * 60_000) refs.add(pr.number);
    }
  }
  issue.fixPrs = [...refs];
}

const developRuns = ghPages(
  api(`actions/runs?event=push&branch=develop&per_page=100&created=>=${new Date(FROM_MS - WEEK_MS).toISOString().slice(0, 10)}`),
  "workflow_runs",
).filter((r) => r.path === ".github/workflows/ci.yml" && r.conclusion === "success");

const dependabot = (() => {
  try {
    return ["open", "fixed", "dismissed"].flatMap((state) => ghList(api(`dependabot/alerts?state=${state}&per_page=100`)));
  } catch {
    return null;
  }
})();

const benchFile = path.join(BENCH_DIR, `${version}.json`);
const bench = fs.existsSync(benchFile) ? JSON.parse(fs.readFileSync(benchFile, "utf8")) : null;

/* ── Prior reports, for the trend and a point-in-time rolling value ─────────────────────────── */

function readReports() {
  if (!fs.existsSync(METRICS_DIR)) return [];
  const out = [];
  for (const name of fs.readdirSync(METRICS_DIR)) {
    if (!name.endsWith(".json")) continue;
    try {
      const report = JSON.parse(fs.readFileSync(path.join(METRICS_DIR, name), "utf8"));
      if (report.version === name.slice(0, -".json".length)) out.push(report);
    } catch {
      /* a broken report is not a report; the command that wrote it failed */
    }
  }
  return out;
}
const priorReports = readReports();

/* ── Metric helpers ────────────────────────────────────────────────────────────────────────── */

const weeks = (toMs, fromMs) => (toMs - fromMs) / WEEK_MS;

function closedBetween(fromMs, toMs) {
  return issues.filter((i) => i.closedAt && inWindow(i.closedAt, fromMs, toMs));
}

function mergedBetween(fromMs, toMs) {
  return pulls.filter((p) => p.mergedAt && inWindow(p.mergedAt, fromMs, toMs));
}

function closedPrsBetween(fromMs, toMs) {
  return pulls.filter((p) => p.closedAt && inWindow(p.closedAt, fromMs, toMs));
}

function hasLabel(item, label) {
  return item.labels.includes(label);
}

function bugClosedBetween(fromMs, toMs) {
  return closedBetween(fromMs, toMs).filter((i) => hasLabel(i, "type: bug"));
}

function durationSummary(ms, scale = 60_000) {
  return summarize(ms, scale);
}

function rateEntry(part, whole, extra = {}) {
  const value = rate(part, whole);
  return value === null ? null : { rate: value, ...extra };
}

/** Every check run of a name on a commit, earliest first. */
function checksNamed(checks, name) {
  return (checks ?? [])
    .filter((c) => c.name === name)
    .sort((a, b) => Date.parse(a.started_at ?? a.completed_at ?? 0) - Date.parse(b.started_at ?? b.completed_at ?? 0));
}

function firstCheck(checks, name) {
  return checksNamed(checks, name)[0] ?? null;
}

function firstRedCheck(pr) {
  const red = [];
  for (const commit of pr.commits) {
    for (const c of pr.checks[commit.sha] ?? []) {
      if (c.name !== "CI passed" && c.name !== "e2e") continue;
      if (!["failure", "timed_out"].includes(c.conclusion)) continue;
      const at = Date.parse(c.started_at ?? c.completed_at ?? 0);
      if (at) red.push(at);
    }
  }
  return red.length ? Math.min(...red) : null;
}

function firstReview(pr) {
  const times = pr.reviews.map((r) => Date.parse(r.at ?? 0)).filter(Boolean);
  return times.length ? Math.min(...times) : null;
}

/** Commits pushed after a review or a red CI, merge commits from `develop` excluded. */
function reworked(pr) {
  const threshold = [firstReview(pr), firstRedCheck(pr)].filter((n) => typeof n === "number").sort()[0];
  if (threshold === undefined) return false;
  return pr.commits.some((c) => c.parents <= 1 && Date.parse(c.committed ?? c.date ?? 0) > threshold);
}

function queueEvents(pr) {
  return (pr.timeline ?? []).filter((e) => (e.event === "labeled" || e.event === "unlabeled") && e.label?.name === "queue");
}

function queueAdds(pr) {
  return queueEvents(pr)
    .filter((e) => e.event === "labeled")
    .map((e) => Date.parse(e.created_at))
    .filter(Boolean)
    .sort((a, b) => a - b);
}

function queueEjections(pr, fromMs, toMs) {
  const out = [];
  for (const e of pr.timeline ?? []) {
    if (e.event !== "commented") continue;
    const match = /^Left the merge queue: (.+)\.$/m.exec(e.body ?? "");
    if (!match) continue;
    if (!inWindow(e.created_at, fromMs, toMs)) continue;
    out.push(match[1].trim());
  }
  return out;
}

function queueConflicts(pr) {
  return pr.commits.some((c) => c.parents > 1 && c.committer !== "GitHub");
}

function tierOf(pr) {
  if (!pr.linkedIssue) return "unlinked";
  const issue = issueByNumber.get(pr.linkedIssue);
  if (!issue) return "unlinked";
  for (const tier of ["light", "standard", "deep"]) if (hasLabel(issue, `agent: ${tier}`)) return tier;
  return "untiered";
}

function revertedPrs() {
  const byNumber = new Map();
  for (const revert of REVERTS) {
    let number = revert.pr;
    if (!number) {
      const bySha = pulls.find(
        (p) =>
          p.mergeCommit &&
          revert.reverted &&
          (p.mergeCommit === revert.reverted ||
            p.mergeCommit.startsWith(revert.reverted) ||
            revert.reverted.startsWith(p.mergeCommit)),
      );
      number = bySha?.number ?? null;
    }
    /* A revert of a branch commit (a merge-commit pull request) names a sha that is not the merge
       commit. GitHub knows which pull requests the commit belongs to; ask only when the cheap match
       missed, so a repository with no reverts makes no extra request. */
    if (!number && revert.reverted) {
      try {
        const found = ghJson(api(`commits/${revert.reverted}/pulls`));
        number = found[0]?.number ?? null;
      } catch {
        number = null;
      }
    }
    if (!number) continue;
    byNumber.set(number, (byNumber.get(number) ?? []).concat(revert));
  }
  return byNumber;
}
const reverted = revertedPrs();

function tagOfMerge(pr) {
  return pr.mergeCommit ? firstTag("stable", pr.mergeCommit) : null;
}

/* ── The metrics ──────────────────────────────────────────────────────────────────────────── */

function metricReleaseFrequency(fromMs, toMs) {
  const stable = STABLES.filter((t) => t.ms > fromMs && t.ms <= toMs).length;
  const nightly = NIGHTLIES.filter((t) => t.ms > fromMs && t.ms <= toMs).length;
  const w = weeks(toMs, fromMs);
  return { stable, nightly, weeks: w, stable_per_week: stable / w, nightly_per_week: nightly / w };
}

function metricLeadTime(fromMs, toMs) {
  const stableDurations = [];
  const nightlyDurations = [];
  let unreleased = 0;
  for (const pr of mergedBetween(fromMs, toMs)) {
    const start = Date.parse(pr.firstCommit?.date ?? pr.createdAt);
    if (!Number.isFinite(start)) continue;
    const stable = tagOfMerge(pr);
    if (!stable) {
      unreleased += 1;
      continue;
    }
    if (stable.ms >= start) stableDurations.push(stable.ms - start);
    const nightly = firstTag("nightly", pr.mergeCommit);
    if (nightly && nightly.ms >= start) nightlyDurations.push(nightly.ms - start);
  }
  if (stableDurations.length === 0) return null;
  const stable = summarize(stableDurations, 3_600_000);
  const night = summarize(nightlyDurations, 3_600_000);
  return {
    median_hours: stable.median,
    p90_hours: stable.p90,
    n: stable.n,
    nightly_median_hours: night.median,
    nightly_p90_hours: night.p90,
    nightly_n: night.n,
    unreleased,
  };
}

function metricCycleTime(fromMs, toMs) {
  const merged = mergedBetween(fromMs, toMs);
  const durations = merged
    .map((p) => Date.parse(p.mergedAt) - Date.parse(p.createdAt))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (durations.length === 0) return null;
  const summary = summarize(durations, 3_600_000);
  return {
    median_hours: summary.median,
    p90_hours: summary.p90,
    n: summary.n,
    median_lines: Math.round(median(merged.map((p) => p.additions + p.deletions)) ?? 0),
  };
}

function metricQueue(fromMs, toMs) {
  const merged = mergedBetween(fromMs, toMs).filter((p) => queueAdds(p).length > 0);
  const waits = [];
  for (const pr of merged) {
    const adds = queueAdds(pr).filter((ms) => ms <= Date.parse(pr.mergedAt));
    const last = adds.at(-1);
    if (last) waits.push(Date.parse(pr.mergedAt) - last);
  }
  const ejections = [];
  for (const pr of relevantPulls) ejections.push(...queueEjections(pr, fromMs, toMs));
  if (merged.length === 0 && ejections.length === 0) return null;
  const summary = summarize(waits, 60_000);
  const reasons = {};
  for (const why of ejections) reasons[why] = (reasons[why] ?? 0) + 1;
  return {
    median_minutes: summary.median,
    p90_minutes: summary.p90,
    n: summary.n,
    ejected: ejections.length,
    reasons,
  };
}

function changeFailures(toMs) {
  const decided = [];
  const limited = STABLES.filter((t) => t.ms <= toMs);
  for (const release of limited) {
    if (release.version === version) continue;
    const index = limited.indexOf(release);
    const next = limited[index + 1];
    if (!next) continue;
    const [major, minor, patch] = release.version.split(".").map(Number);
    const [nMajor, nMinor, nPatch] = next.version.split(".").map(Number);
    const failedByPatch = major === nMajor && minor === nMinor && nPatch > patch;
    let failedByRevert = false;
    for (const [number, reverts] of reverted) {
      const pr = pulls.find((p) => p.number === number);
      const first = pr ? tagOfMerge(pr) : null;
      if (first?.version === release.version && reverts.some((r) => r.ms <= toMs)) failedByRevert = true;
    }
    decided.push({ version: release.version, failed: failedByPatch || failedByRevert, decidedAt: next.ms });
  }
  if (decided.length === 0) return null;
  const failed = decided.filter((d) => d.failed).map((d) => d.version);
  return {
    rate: failed.length / decided.length,
    failed,
    decided: decided.length,
    pending: version,
    _decided: decided,
  };
}

function metricChangeFailure(toMs) {
  const all = changeFailures(toMs);
  if (!all) return null;
  const { _decided, ...value } = all;
  const rolling = _decided.filter((d) => d.decidedAt > ROLLING_FROM_MS);
  return {
    value,
    rolling:
      rolling.length === 0
        ? null
        : {
            rate: rolling.filter((d) => d.failed).length / rolling.length,
            failed: rolling.filter((d) => d.failed).map((d) => d.version),
            decided: rolling.length,
            pending: version,
          },
    rollingReason: rolling.length === 0 ? "no release's fate was decided in the last 7 days" : undefined,
  };
}

function metricTimeToRestore(fromMs, toMs) {
  const bugs = bugClosedBetween(fromMs, toMs).filter((i) => hasLabel(i, "escaped"));
  const durations = [];
  for (const bug of bugs) {
    const fix = pulls
      .filter((p) => p.mergedAt && p.number !== undefined && bug.fixPrs.includes(p.number))
      .filter((p) => Date.parse(p.mergedAt) >= Date.parse(bug.createdAt))
      .sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt))[0];
    if (!fix) continue;
    const tag = tagOfMerge(fix);
    if (!tag) continue;
    durations.push(tag.ms - Date.parse(bug.createdAt));
  }
  if (durations.length === 0) return null;
  const summary = summarize(durations, DAY_MS);
  return { median_days: summary.median, p90_days: summary.p90, n: summary.n };
}

function metricBugRate(fromMs, toMs, label) {
  const bugs = bugClosedBetween(fromMs, toMs);
  if (bugs.length === 0) return null;
  const found = bugs.filter((i) => hasLabel(i, label)).length;
  return { rate: found / bugs.length, [label === "escaped" ? "escaped" : "regressions"]: found, closed: bugs.length };
}

function metricCiFirstPass(fromMs, toMs) {
  const merged = mergedBetween(fromMs, toMs);
  let green = 0;
  let measured = 0;
  let skipped = 0;
  for (const pr of merged) {
    const first = pr.firstCommit;
    if (!first) {
      skipped += 1;
      continue;
    }
    const ci = firstCheck(pr.checks[first.sha], "CI passed");
    const e2e = firstCheck(pr.checks[first.sha], "e2e");
    if (!ci || !e2e) {
      skipped += 1;
      continue;
    }
    measured += 1;
    if (ci.conclusion === "success" && e2e.conclusion === "success") green += 1;
  }
  return measured === 0 ? null : { rate: green / measured, green, measured, skipped };
}

function metricFlaky(fromMs, toMs) {
  /* An issue created after the tag did not exist at the tag; without this filter a re-run of an old
     report would count a newer flake as open then, and the JSON would not be reproducible. */
  const flaky = issues.filter((i) => /^flaky:/i.test(i.title) && Date.parse(i.createdAt) <= toMs);
  if (flaky.length === 0) return null;
  const first = flaky.map((i) => Date.parse(i.createdAt)).sort((a, b) => a - b)[0];
  if (toMs < first) return null;
  const open = flaky.filter((i) => openAt(i, toMs)).length;
  const fresh = flaky.filter((i) => inWindow(i.createdAt, fromMs, toMs)).length;
  return { open, new: fresh };
}

function metricCiDuration(fromMs, toMs) {
  const durations = [];
  for (const pr of mergedBetween(fromMs, toMs)) {
    const runs = pr.runs.filter((r) => r.path === ".github/workflows/ci.yml" || r.path === ".github/workflows/e2e.yml");
    const ci = runs
      .filter((r) => r.path === ".github/workflows/ci.yml" && r.conclusion === "success")
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
    const e2e = runs
      .filter((r) => r.path === ".github/workflows/e2e.yml" && r.conclusion === "success")
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
    if (!ci || !e2e) continue;
    const start = Math.min(...runs.map((r) => Date.parse(r.created_at)).filter(Boolean));
    const end = Math.max(Date.parse(ci.updated_at), Date.parse(e2e.updated_at));
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) durations.push(end - start);
  }
  const pr = summarize(durations, 60_000);
  const develop = summarize(
    developRuns
      .filter((r) => inWindow(r.created_at, fromMs, toMs))
      .map((r) => Date.parse(r.updated_at) - Date.parse(r.created_at))
      .filter((n) => Number.isFinite(n) && n >= 0),
    60_000,
  );
  if (pr.n === 0 && develop.n === 0) return null;
  return {
    pr_median_minutes: pr.median,
    pr_p90_minutes: pr.p90,
    pr_n: pr.n,
    develop_median_minutes: develop.median,
    develop_p90_minutes: develop.p90,
    develop_n: develop.n,
  };
}

function alertsAt(ms) {
  const out = { critical: 0, high: 0, moderate: 0, low: 0, total: 0 };
  for (const alert of dependabot ?? []) {
    const created = Date.parse(alert.created_at);
    if (!Number.isFinite(created) || created > ms) continue;
    if (alert.fixed_at && Date.parse(alert.fixed_at) <= ms) continue;
    if (alert.dismissed_at && Date.parse(alert.dismissed_at) <= ms) continue;
    const severity = alert.security_advisory?.severity ?? "low";
    const key = severity === "medium" ? "moderate" : severity;
    if (!(key in out)) continue;
    out[key] += 1;
    out.total += 1;
  }
  return out;
}

function auditNow() {
  const audit = spawnSync("npm", ["audit", "--package-lock-only", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(audit.stdout || "");
  } catch {
    return { audit: null, audit_reason: "npm audit could not read the lockfile" };
  }
  const v = parsed.metadata?.vulnerabilities;
  if (!v) return { audit: null, audit_reason: "npm audit returned no vulnerability counts" };
  return {
    audit: {
      critical: v.critical ?? 0,
      high: v.high ?? 0,
      moderate: v.moderate ?? 0,
      low: v.low ?? 0,
      total: v.total ?? 0,
    },
  };
}

function outdatedNow() {
  const outdated = spawnSync("npm", ["outdated", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(outdated.stdout || "{}");
  } catch {
    return { major_behind: null, major_reason: "npm outdated could not read the lockfile" };
  }
  let count = 0;
  for (const info of Object.values(parsed)) {
    const from = String(info.current ?? info.wanted ?? "");
    const to = String(info.latest ?? "");
    const major = (v) => Number(v.replace(/^\D+/, "").split(".")[0]);
    if (from && to && Number.isFinite(major(from)) && Number.isFinite(major(to)) && major(to) > major(from)) count += 1;
  }
  return { major_behind: count };
}

function metricDependency(toMs) {
  if (dependabot === null) {
    return { value: null, reason: "the token cannot read Dependabot alerts" };
  }
  const first = dependabot
    .map((a) => Date.parse(a.created_at))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  if (first === undefined) {
    return { value: null, reason: "Dependabot has reported no alert and no scan history for this repository" };
  }
  if (toMs < first) {
    return {
      value: null,
      reason: `Dependabot's first alert on this repository is dated ${new Date(first).toISOString()}, after this release`,
    };
  }
  const dependabotAt = alertsAt(toMs);
  const existing = priorReports.find((r) => r.version === version)?.metrics?.["dependency-health"]?.value;
  let audit = existing?.audit ?? null;
  let auditReason =
    existing?.audit_reason ?? "npm audit describes the tree it runs on; a backfilled report has no recorded audit";
  let major = existing?.major_behind ?? null;
  let majorReason =
    existing?.major_reason ?? "npm outdated describes the registry it runs against; a backfilled report has no recorded check";
  if (!existing && !noAudit && fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim() === version) {
    const now = auditNow();
    audit = now.audit;
    auditReason = now.audit_reason ?? null;
    const behind = outdatedNow();
    major = behind.major_behind;
    majorReason = behind.major_reason ?? null;
  }
  return {
    value: { dependabot: dependabotAt, audit, audit_reason: auditReason, major_behind: major, major_reason: majorReason },
  };
}

function benchValue(row) {
  if (!bench) {
    return {
      value: null,
      reason: `no docs/bench/${version}.json — the bench became a release record at 0.8.0`,
    };
  }
  const found = (bench.results ?? []).find((r) => r.metric === row.metric);
  if (!found || typeof found.value !== "number") {
    return { value: null, reason: `the ${version} bench did not measure this row` };
  }
  return { value: { value: found.value, unit: row.unit } };
}

function metricThroughput(fromMs, toMs) {
  const closed = closedBetween(fromMs, toMs).length;
  return { closed, weeks: weeks(toMs, fromMs), per_week: closed / weeks(toMs, fromMs) };
}

const WIP_INTERVALS = new Map(issues.map((i) => [i.number, inProgressIntervals(i)]));

function metricWip(fromMs, toMs) {
  const existed = issues.filter((i) => Date.parse(i.createdAt) <= toMs);
  if (existed.length === 0) return null;
  let ms = 0;
  let atTag = 0;
  for (const issue of existed) {
    const intervals = WIP_INTERVALS.get(issue.number) ?? [];
    ms += overlap(intervals, fromMs, toMs);
    if (intervals.some(([start, end]) => start <= toMs && (end === null || end > toMs))) atTag += 1;
  }
  return { average: ms / (toMs - fromMs), at_tag: atTag };
}

function metricIssueSize(fromMs, toMs) {
  const closed = closedBetween(fromMs, toMs);
  let measured = 0;
  let withinDay = 0;
  const sizes = { S: 0, M: 0, L: 0, none: 0 };
  for (const issue of closed) {
    const ready = issue.timeline
      .filter((e) => e.event === "labeled" && e.label?.name === "status: ready")
      .map((e) => Date.parse(e.created_at))
      .filter((n) => Number.isFinite(n) && n <= Date.parse(issue.closedAt))
      .sort((a, b) => a - b)[0];
    if (ready !== undefined) {
      measured += 1;
      if (Date.parse(issue.closedAt) - ready <= DAY_MS) withinDay += 1;
    }
    const size = ["S", "M", "L"].find((s) => hasLabel(issue, `size: ${s}`));
    sizes[size ?? "none"] += 1;
  }
  if (measured === 0) return null;
  return { within_day_rate: withinDay / measured, within_day: withinDay, measured, sizes };
}

function metricBugFeature(fromMs, toMs) {
  const closed = closedBetween(fromMs, toMs);
  const bugs = closed.filter((i) => hasLabel(i, "type: bug")).length;
  const features = closed.filter((i) => hasLabel(i, "type: feature")).length;
  if (features === 0) return null;
  return { ratio: bugs / features, bugs, features };
}

function metricReopen(fromMs, toMs) {
  const closed = closedBetween(fromMs, toMs);
  if (closed.length === 0) return null;
  const reopened = issues.filter((i) =>
    i.timeline.some((e) => e.event === "reopened" && inWindow(e.created_at, fromMs, toMs)),
  ).length;
  return { rate: reopened / closed.length, reopened, closed: closed.length };
}

function agentMetrics(fromMs, toMs) {
  const closed = closedPrsBetween(fromMs, toMs);
  if (closed.length === 0) return null;
  const tiers = {};
  for (const key of ["light", "standard", "deep", "untiered", "unlinked"]) {
    tiers[key] = { merged: 0, closed: 0, rate: null };
  }
  for (const pr of closed) {
    const key = tierOf(pr);
    tiers[key].closed += 1;
    if (pr.mergedAt) tiers[key].merged += 1;
  }
  for (const tier of Object.values(tiers)) tier.rate = rate(tier.merged, tier.closed);
  const merged = closed.filter((p) => p.mergedAt).length;
  const acceptance = { merged, closed: closed.length, rate: merged / closed.length, tiers };

  let reworkedCount = 0;
  const reworkTiers = {};
  const revertTiers = {};
  for (const key of Object.keys(tiers)) {
    reworkTiers[key] = { reworked: 0, n: 0, rate: null };
    revertTiers[key] = { reverted: 0, n: 0, rate: null };
  }
  for (const pr of closed) {
    const key = tierOf(pr);
    reworkTiers[key].n += 1;
    if (reworked(pr)) {
      reworkedCount += 1;
      reworkTiers[key].reworked += 1;
    }
    if (pr.mergedAt) {
      revertTiers[key].n += 1;
      if (reverted.has(pr.number)) revertTiers[key].reverted += 1;
    }
  }
  for (const tier of Object.values(reworkTiers)) tier.rate = rate(tier.reworked, tier.n);
  for (const tier of Object.values(revertTiers)) tier.rate = rate(tier.reverted, tier.n);
  const queueConflictCount = closed.filter((pr) => queueConflicts(pr) && queueAdds(pr).length > 0).length;
  const revertedCount = closed.filter((pr) => pr.mergedAt && reverted.has(pr.number)).length;
  return {
    acceptance,
    rework: {
      rate: reworkedCount / closed.length,
      reworked: reworkedCount,
      n: closed.length,
      by_tier: reworkTiers,
      queue_conflicts: queueConflictCount,
    },
    revert: {
      rate: merged === 0 ? null : revertedCount / merged,
      reverted: revertedCount,
      merged,
      by_tier: revertTiers,
    },
  };
}

/* ── Assemble ─────────────────────────────────────────────────────────────────────────────── */

function notMeasured(reason, rollingReason) {
  return { value: null, rolling: null, reason, rollingReason: rollingReason ?? reason };
}

function entry(value, rolling, reason) {
  return { value, rolling, reason: reason ?? null, rollingReason: rolling === null ? (reason ?? null) : null };
}

/** The median of each numeric field of a shape, nested; nulls survive; counts stay counts. */
function medianShape(values) {
  const xs = values.filter((v) => v !== null && v !== undefined);
  if (xs.length === 0) return null;
  if (typeof xs[0] === "number") return median(xs);
  if (typeof xs[0] !== "object") return xs.at(-1);
  const out = {};
  for (const key of Object.keys(xs[0])) out[key] = medianShape(xs.map((v) => v?.[key]));
  return out;
}

function snapshotRolling(id, currentValue, fromMs) {
  const values = priorReports
    .filter((r) => r.version !== version)
    .filter((r) => Date.parse(r.date) >= fromMs && Date.parse(r.date) <= TO_MS)
    .map((r) => r.metrics?.[id]?.value)
    .filter((v) => v !== null && v !== undefined);
  if (currentValue !== null && currentValue !== undefined) values.push(currentValue);
  return values.length === 0 ? null : medianShape(values);
}

const metrics = {};
metrics["release-frequency"] = entry(metricReleaseFrequency(FROM_MS, TO_MS), metricReleaseFrequency(ROLLING_FROM_MS, TO_MS));
metrics["lead-time-for-changes"] = entry(
  metricLeadTime(FROM_MS, TO_MS),
  metricLeadTime(ROLLING_FROM_MS, TO_MS),
  "no pull request merged in the window reached a stable tag at or before this release",
);
metrics["pr-cycle-time"] = entry(
  metricCycleTime(FROM_MS, TO_MS),
  metricCycleTime(ROLLING_FROM_MS, TO_MS),
  "no pull request merged in the window",
);
metrics["merge-queue-wait"] = entry(
  metricQueue(FROM_MS, TO_MS),
  metricQueue(ROLLING_FROM_MS, TO_MS),
  "no pull request carried the `queue` label in the window",
);

const failure = metricChangeFailure(TO_MS);
metrics["change-failure-rate"] = failure
  ? entry(failure.value, failure.rolling, undefined)
  : notMeasured("no earlier stable release's fate is decided by this release");
if (metrics["change-failure-rate"] && failure?.rolling === null) {
  metrics["change-failure-rate"].rollingReason = failure.rollingReason;
}
metrics["time-to-restore"] = entry(
  metricTimeToRestore(FROM_MS, TO_MS),
  metricTimeToRestore(ROLLING_FROM_MS, TO_MS),
  "no `escaped` bug closed in the window has a fix in a stable release",
);
metrics["escaped-defect-rate"] = entry(
  metricBugRate(FROM_MS, TO_MS, "escaped"),
  metricBugRate(ROLLING_FROM_MS, TO_MS, "escaped"),
  "no bug was closed in the window",
);
metrics["regression-rate"] = entry(
  metricBugRate(FROM_MS, TO_MS, "regression"),
  metricBugRate(ROLLING_FROM_MS, TO_MS, "regression"),
  "no bug was closed in the window",
);

metrics["ci-first-pass-rate"] = entry(
  metricCiFirstPass(FROM_MS, TO_MS),
  metricCiFirstPass(ROLLING_FROM_MS, TO_MS),
  "no pull request merged in the window has a first `CI passed` and `e2e` run",
);
metrics["flaky-tests"] = (() => {
  const value = metricFlaky(FROM_MS, TO_MS);
  const rolling = metricFlaky(ROLLING_FROM_MS, TO_MS);
  if (!value) {
    const first = issues
      .filter((i) => /^flaky:/i.test(i.title))
      .map((i) => Date.parse(i.createdAt))
      .sort((a, b) => a - b)[0];
    return notMeasured(
      first
        ? `the nightly's \`flaky:\` issue convention began on ${new Date(first).toISOString()}, after this release`
        : "the nightly's `flaky:` issue convention has produced no issue yet (#494)",
    );
  }
  return entry({ ...value, new: value.new }, rolling ? { ...rolling, new: rolling.new } : null);
})();
metrics["ci-duration"] = entry(
  metricCiDuration(FROM_MS, TO_MS),
  metricCiDuration(ROLLING_FROM_MS, TO_MS),
  "no successful `ci.yml` run in the window",
);

const dependency = metricDependency(TO_MS);
metrics["dependency-health"] = dependency.value
  ? {
      value: dependency.value,
      rolling: snapshotRolling("dependency-health", dependency.value, ROLLING_FROM_MS),
      reason: null,
      rollingReason: null,
    }
  : notMeasured(dependency.reason);

for (const row of RELEASE_ROWS) {
  const id = `bench.${row.metric}`;
  const result = benchValue(row);
  metrics[id] = result.value
    ? {
        value: result.value,
        rolling: snapshotRolling(id, result.value, ROLLING_FROM_MS),
        reason: null,
        rollingReason: null,
      }
    : notMeasured(result.reason);
}
metrics["interaction-latency"] = notMeasured("depends on #527");
metrics["diff-coverage"] = notMeasured("vitest coverage is not collected on pull requests");
metrics["duplication-and-complexity"] = notMeasured("depends on #526");
metrics["security-backlog"] = notMeasured("depends on #112");
metrics["visual-review"] = notMeasured("depends on #528");

metrics["throughput"] = entry(metricThroughput(FROM_MS, TO_MS), metricThroughput(ROLLING_FROM_MS, TO_MS));
metrics["work-in-progress"] = (() => {
  const value = metricWip(FROM_MS, TO_MS);
  if (!value) return notMeasured("no issue existed at this release");
  return {
    value,
    rolling: snapshotRolling("work-in-progress", value, ROLLING_FROM_MS),
    reason: null,
    rollingReason: null,
  };
})();
metrics["issue-size"] = entry(
  metricIssueSize(FROM_MS, TO_MS),
  metricIssueSize(ROLLING_FROM_MS, TO_MS),
  "no issue closed in the window carried `status: ready`",
);
metrics["bug-to-feature-ratio"] = entry(
  metricBugFeature(FROM_MS, TO_MS),
  metricBugFeature(ROLLING_FROM_MS, TO_MS),
  "no `type: feature` issue was closed in the window",
);
metrics["reopen-rate"] = entry(
  metricReopen(FROM_MS, TO_MS),
  metricReopen(ROLLING_FROM_MS, TO_MS),
  "no issue was closed in the window",
);

const agents = agentMetrics(FROM_MS, TO_MS);
const agentsRolling = agentMetrics(ROLLING_FROM_MS, TO_MS);
metrics["agent-acceptance"] = entry(
  agents?.acceptance ?? null,
  agentsRolling?.acceptance ?? null,
  "no pull request was closed in the window",
);
metrics["agent-rework"] = entry(
  agents?.rework ?? null,
  agentsRolling?.rework ?? null,
  "no pull request was closed in the window",
);
metrics["agent-revert"] = entry(
  agents?.revert ?? null,
  agentsRolling?.revert ?? null,
  "no pull request was merged in the window",
);

/* The catalogue order is the file's order: a row that is missing is a bug in this script, not a
   report with a hole in it. Building the object here, not above, also makes the JSON a diff of the
   catalogue when a row is added. */
const ordered = {};
for (const metric of METRICS) {
  if (!(metric.id in metrics)) throw new Error(`no value for ${metric.id}`);
  ordered[metric.id] = metrics[metric.id];
}

const report = {
  version,
  tag: TARGET.tag,
  date: TO,
  previous: PREVIOUS?.version ?? null,
  previous_date: PREVIOUS?.time ?? null,
  window: { from: FROM, to: TO },
  rolling: { from: ROLLING_FROM, to: TO },
  metrics: ordered,
};

/* ── Write and print ───────────────────────────────────────────────────────────────────────── */

const jsonText = `${JSON.stringify(report, null, 2)}\n`;
fs.mkdirSync(METRICS_DIR, { recursive: true });
const jsonFile = path.join(METRICS_DIR, `${version}.json`);
fs.writeFileSync(jsonFile, jsonText);

const { renderReport } = await import("./lib/release-report.mjs");
const markdown = renderReport(report, reportsUpTo([...priorReports.filter((r) => r.version !== version), report], version));
const mdFile = path.join(METRICS_DIR, `${version}.md`);
fs.writeFileSync(mdFile, markdown);

if (attach) {
  const args = ["release", "upload", TARGET.tag, jsonFile, mdFile, "--clobber"];
  try {
    execFileSync("gh", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    console.error(`release-report: attached ${path.basename(jsonFile)} and ${path.basename(mdFile)} to ${TARGET.tag}`);
  } catch (e) {
    console.error(`release-report: could not attach the report: ${(e.stderr || e.message).toString().trim()}`);
    process.exitCode = 1;
  }
}

process.stdout.write(markdown);
