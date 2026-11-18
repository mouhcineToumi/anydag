#!/usr/bin/env node
/**
 * **The development health report** (#529): the metrics a stable release carries, their definitions
 * in one place, and the Markdown rendered from the JSONs in `docs/metrics/`.
 *
 * `scripts/release-report.mjs` gathers the numbers and writes `docs/metrics/<version>.json`; this
 * file is the catalogue (`METRICS`), the arithmetic (median, p90, a sparkline, the direction) and
 * `renderReport`, which is handed every report up to the one being printed. It is kept apart from
 * the gathering so the arithmetic can be held by a test without the GitHub API or a tag.
 *
 * Three rules make a trend mean something:
 *
 * 1. **A metric is a fixed row.** Its `id`, label, unit and polarity never change; a new metric is a
 *    new row, not a redefinition. The definition anchor points into `docs/metrics/README.md`.
 * 2. **A number is computed from a window fixed by tags**, never by the clock — see
 *    `docs/metrics/README.md`, *The window*. A rolling 7-day value is the same computation over the
 *    seven days ending at the tag.
 * 3. **No data is n/a, never zero.** A row whose source did not exist yet (or is #526, #527, #112 or
 *    #528) says why, in `reason` or `rollingReason`.
 *
 * The rows are in `METRICS` order, and `renderReport` prints them in that order. A star (★) marks the
 * starter set the first report carried.
 */
import { RELEASE_ROWS } from "../bench-release.mjs";

/** A week, in milliseconds: the unit of the rolling value and of the release-frequency rows. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** How many releases the sparkline draws. The issue's example is `▁▂▄▃▂`. */
export const TREND_POINTS = 8;

/** The sections of the report, in the order they print. */
export const SECTIONS = [
  "Delivery",
  "Stability",
  "Code and test quality",
  "Performance — the release bench",
  "Workflow (GitHub issues)",
  "Agent output",
];

/* ── Arithmetic ─────────────────────────────────────────────────────────────────────────────── */

/** A number with at most `digits` decimals, as a string; `—` for anything that is not a number. */
export function num(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

/** A rate as a percentage, with one decimal: `0.3333` → `33.3%`. */
export function pct(rate) {
  return typeof rate === "number" && Number.isFinite(rate) ? `${num(rate * 100, 1)}%` : "—";
}

/** The middle of a list: the mean of the two middle values when the count is even. */
export function median(values) {
  const xs = values.filter((n) => typeof n === "number" && Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * The p-th percentile, p in 0..1, by linear interpolation between the two nearest ranks — the
 * `statistics.quantiles` definition, so a p90 of ten values is not the ninth of them. `null` on an
 * empty list.
 */
export function percentile(values, p) {
  const xs = values.filter((n) => typeof n === "number" && Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const rank = (xs.length - 1) * Math.min(Math.max(p, 0), 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return low === high ? xs[low] : xs[low] + (xs[high] - xs[low]) * (rank - low);
}

/** Median and p90 of a list of milliseconds, in the unit `scale` divides by. */
export function summarize(durationsMs, scale = 60_000) {
  const xs = durationsMs.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (xs.length === 0) return { median: null, p90: null, n: 0 };
  return {
    median: Math.round((median(xs) / scale) * 10) / 10,
    p90: Math.round((percentile(xs, 0.9) / scale) * 10) / 10,
    n: xs.length,
  };
}

/** `0.3333` from `1` of `3`, or `null` when nothing was measured. */
export function rate(part, whole) {
  return whole > 0 ? part / whole : null;
}

/**
 * A sparkline of the last `TREND_POINTS` numbers, `▁` (low) to `█` (high). Fewer than two points is
 * `—`; a flat run is `▄`, because a line that is all `▁` would say "low", not "flat".
 */
export function sparkline(values) {
  const xs = values.filter((n) => typeof n === "number" && Number.isFinite(n)).slice(-TREND_POINTS);
  if (xs.length < 2) return "—";
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const levels = "▁▂▃▄▅▆▇█";
  if (min === max) return "▄".repeat(xs.length);
  return xs.map((v) => levels[Math.round(((v - min) / (max - min)) * (levels.length - 1))]).join("");
}

/**
 * The arrow and the word for a move from `before` to `now`: `↑ better` when a higher value is better,
 * `↓ worse` when it is not, `→ flat` when they are equal. Fewer than two values is `—`.
 */
export function direction(before, now, polarity) {
  if (typeof before !== "number" || typeof now !== "number" || !Number.isFinite(before) || !Number.isFinite(now)) {
    return "—";
  }
  if (before === now) return "→ flat";
  const up = now > before;
  const better = polarity === "higher" ? up : !up;
  return `${up ? "↑" : "↓"} ${better ? "better" : "worse"}`;
}

/** A duration in days, hours or minutes, whichever keeps it readable. */
export function duration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  const hours = ms / 3_600_000;
  return hours >= 48 ? `${num(hours / 24)} d` : `${num(hours)} h`;
}

/** Versions sort as semver, not as strings: `0.10.0` is after `0.9.0`. */
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v));
    return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return String(a).localeCompare(String(b));
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre.localeCompare(y.pre);
}

/** Reports sorted oldest first, without a version past `upTo` (a report is a snapshot of its time). */
export function reportsUpTo(reports, upTo) {
  return [...reports]
    .filter((r) => r && r.version && compareVersions(r.version, upTo) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}

/* ── The catalogue ──────────────────────────────────────────────────────────────────────────── */

const alerts = (d) =>
  `${d.total} alert${d.total === 1 ? "" : "s"} (${d.critical} critical, ${d.high} high, ${d.moderate} moderate, ${d.low} low)`;

/**
 * Every row of the report. `primary` is the one number its trend follows; `short` is that number for
 * the previous-releases column; `show` is the release and rolling cell. A row with no `primary` is
 * never n/a by shape, only by `reason` in the JSON.
 */
export const METRICS = [
  /* ── Delivery ─────────────────────────────────────────────────────────────────────────────── */
  {
    id: "release-frequency",
    section: "Delivery",
    label: "Release frequency ★",
    definition: "release-frequency",
    polarity: "higher",
    primary: (v) => v.stable_per_week,
    short: (v) => `${num(v.stable_per_week)}/wk`,
    show: (v) =>
      `${num(v.stable_per_week)} stable/wk (${v.stable} in ${num(v.weeks)} wk) · ${num(v.nightly_per_week)} nightly/wk`,
  },
  {
    id: "lead-time-for-changes",
    section: "Delivery",
    label: "Lead time for changes ★",
    definition: "lead-time-for-changes",
    polarity: "lower",
    primary: (v) => v.median_hours,
    short: (v) => `${num(v.median_hours)} h`,
    show: (v) =>
      `${num(v.median_hours)} h median, p90 ${num(v.p90_hours)} h (n=${v.n})` +
      (v.nightly_n > 0 ? `; to the first nightly, ${num(v.nightly_median_hours)} h (n=${v.nightly_n})` : ""),
  },
  {
    id: "pr-cycle-time",
    section: "Delivery",
    label: "PR cycle time",
    definition: "pr-cycle-time",
    polarity: "lower",
    primary: (v) => v.median_hours,
    short: (v) => `${num(v.median_hours)} h`,
    show: (v) => `${num(v.median_hours)} h median, p90 ${num(v.p90_hours)} h (n=${v.n}); median ${v.median_lines} lines changed`,
  },
  {
    id: "merge-queue-wait",
    section: "Delivery",
    label: "Merge queue wait",
    definition: "merge-queue-wait",
    polarity: "lower",
    primary: (v) => v.median_minutes,
    short: (v) => `${num(v.median_minutes)} min`,
    show: (v) => {
      const waited = `${num(v.median_minutes)} min median, p90 ${num(v.p90_minutes)} min (n=${v.n})`;
      const out =
        v.ejected === 0
          ? "none taken out"
          : `${v.ejected} taken out (${Object.entries(v.reasons)
              .map(([why, count]) => `${why}: ${count}`)
              .join("; ")})`;
      return `${waited}; ${out}`;
    },
  },

  /* ── Stability ────────────────────────────────────────────────────────────────────────────── */
  {
    id: "change-failure-rate",
    section: "Stability",
    label: "Change failure rate ★",
    definition: "change-failure-rate",
    polarity: "lower",
    primary: (v) => v.rate,
    short: (v) => pct(v.rate),
    show: (v) => `${pct(v.rate)} (${v.failed.length} of ${v.decided} decided${v.pending ? `; ${v.pending} pending` : ""})`,
  },
  {
    id: "time-to-restore",
    section: "Stability",
    label: "Time to restore",
    definition: "time-to-restore",
    polarity: "lower",
    primary: (v) => v.median_days,
    short: (v) => `${num(v.median_days)} d`,
    show: (v) => `${num(v.median_days)} d median, p90 ${num(v.p90_days)} d (n=${v.n})`,
  },
  {
    id: "escaped-defect-rate",
    section: "Stability",
    label: "Escaped defect rate",
    definition: "escaped-defect-rate",
    polarity: "lower",
    primary: (v) => v.rate,
    short: (v) => pct(v.rate),
    show: (v) => `${pct(v.rate)} (${v.escaped} of ${v.closed} bugs closed)`,
  },
  {
    id: "regression-rate",
    section: "Stability",
    label: "Regression rate ★",
    definition: "regression-rate",
    polarity: "lower",
    primary: (v) => v.rate,
    short: (v) => pct(v.rate),
    show: (v) => `${pct(v.rate)} (${v.regressions} of ${v.closed} bugs closed)`,
  },

  /* ── Code and test quality ────────────────────────────────────────────────────────────────── */
  {
    id: "ci-first-pass-rate",
    section: "Code and test quality",
    label: "CI first-pass rate ★",
    definition: "ci-first-pass-rate",
    polarity: "higher",
    primary: (v) => v.rate,
    short: (v) => pct(v.rate),
    show: (v) => `${pct(v.rate)} (${v.green} of ${v.measured} pull requests; ${v.skipped} without a first run of both checks)`,
  },
  {
    id: "flaky-tests",
    section: "Code and test quality",
    label: "Flaky tests",
    definition: "flaky-tests",
    polarity: "lower",
    primary: (v) => v.new,
    short: (v) => `${v.new} new`,
    show: (v) => `${v.new} new, ${v.open} open at the release`,
  },
  {
    id: "ci-duration",
    section: "Code and test quality",
    label: "CI duration",
    definition: "ci-duration",
    polarity: "lower",
    primary: (v) => v.pr_median_minutes,
    short: (v) => `${num(v.pr_median_minutes)} min`,
    show: (v) =>
      `pull request ${num(v.pr_median_minutes)} min median, p90 ${num(v.pr_p90_minutes)} min (n=${v.pr_n}); ` +
      `develop push ${num(v.develop_median_minutes)} min median, p90 ${num(v.develop_p90_minutes)} min (n=${v.develop_n})`,
  },
  {
    id: "diff-coverage",
    section: "Code and test quality",
    label: "Diff coverage",
    definition: "diff-coverage",
    polarity: "higher",
  },
  {
    id: "dependency-health",
    section: "Code and test quality",
    label: "Dependency health",
    definition: "dependency-health",
    polarity: "lower",
    primary: (v) => v.dependabot.total,
    short: (v) => `${v.dependabot.total} alerts`,
    show: (v) => {
      const parts = [alerts(v.dependabot)];
      if (v.audit) {
        parts.push(
          `npm audit ${v.audit.total} (${v.audit.critical} critical, ${v.audit.high} high, ${v.audit.moderate} moderate, ${v.audit.low} low)`,
        );
      } else {
        parts.push("npm audit n/a (no recorded audit)");
      }
      if (typeof v.major_behind === "number") parts.push(`${v.major_behind} dependencies a major version or more behind`);
      else parts.push("dependencies behind n/a (no recorded check)");
      return parts.join("; ");
    },
  },
  {
    id: "duplication-and-complexity",
    section: "Code and test quality",
    label: "Duplication and complexity",
    definition: "duplication-and-complexity",
    polarity: "lower",
  },
  {
    id: "security-backlog",
    section: "Code and test quality",
    label: "Security backlog",
    definition: "security-backlog",
    polarity: "lower",
  },
  {
    id: "visual-review",
    section: "Code and test quality",
    label: "Visual review",
    definition: "visual-review",
    polarity: "lower",
  },

  /* ── Performance — the release bench ──────────────────────────────────────────────────────── */
  ...RELEASE_ROWS.map((row) => ({
    id: `bench.${row.metric}`,
    section: "Performance — the release bench",
    label: row.label,
    definition: "performance-the-release-bench",
    polarity: "lower",
    primary: (v) => v.value,
    short: (v) => `${num(v.value)} ${v.unit}`,
    show: (v) => `${num(v.value)} ${v.unit}`,
  })),
  {
    id: "interaction-latency",
    section: "Performance — the release bench",
    label: "Interaction latency, `edit.*`",
    definition: "interaction-latency",
    polarity: "lower",
  },

  /* ── Workflow (GitHub issues) ─────────────────────────────────────────────────────────────── */
  {
    id: "throughput",
    section: "Workflow (GitHub issues)",
    label: "Throughput",
    definition: "throughput",
    polarity: "higher",
    primary: (v) => v.per_week,
    short: (v) => `${num(v.per_week)}/wk`,
    show: (v) => `${num(v.per_week)} issues/wk (${v.closed} closed in ${num(v.weeks)} wk)`,
  },
  {
    id: "work-in-progress",
    section: "Workflow (GitHub issues)",
    label: "Work in progress",
    definition: "work-in-progress",
    polarity: "lower",
    primary: (v) => v.average,
    short: (v) => `${num(v.average)} avg`,
    show: (v) => `${num(v.average)} average in progress; ${v.at_tag} at the release`,
  },
  {
    id: "issue-size",
    section: "Workflow (GitHub issues)",
    label: "Issue size",
    definition: "issue-size",
    polarity: "higher",
    primary: (v) => v.within_day_rate,
    short: (v) => pct(v.within_day_rate),
    show: (v) =>
      `${pct(v.within_day_rate)} closed within a day of \`status: ready\` (${v.within_day} of ${v.measured}); ` +
      `S ${v.sizes.S}, M ${v.sizes.M}, L ${v.sizes.L}, none ${v.sizes.none}`,
  },
  {
    id: "bug-to-feature-ratio",
    section: "Workflow (GitHub issues)",
    label: "Bug to feature ratio ★",
    definition: "bug-to-feature-ratio",
    polarity: "lower",
    primary: (v) => v.ratio,
    short: (v) => num(v.ratio, 2),
    show: (v) => `${num(v.ratio, 2)} bugs per feature (${v.bugs} bugs, ${v.features} features)`,
  },
  {
    id: "reopen-rate",
    section: "Workflow (GitHub issues)",
    label: "Reopen rate",
    definition: "reopen-rate",
    polarity: "lower",
    primary: (v) => v.rate,
    short: (v) => pct(v.rate),
    show: (v) => `${pct(v.rate)} (${v.reopened} of ${v.closed} closed issues reopened)`,
  },

  /* ── Agent output ─────────────────────────────────────────────────────────────────────────── */
  {
    id: "agent-acceptance",
    section: "Agent output",
    label: "Acceptance rate",
    definition: "agent-acceptance",
    polarity: "higher",
    primary: (v) => v.rate,
    short: (v) => pct(v.rate),
    show: (v) => `${pct(v.rate)} (${v.merged} of ${v.closed} closed pull requests merged)`,
  },
  {
    id: "agent-rework",
    section: "Agent output",
    label: "Rework rate",
    definition: "agent-rework",
    polarity: "lower",
    primary: (v) => v.rate,
    short: (v) => pct(v.rate),
    show: (v) =>
      `${pct(v.rate)} (${v.reworked} of ${v.n} pull requests); ${v.queue_conflicts} merge-queue conflict resolution${v.queue_conflicts === 1 ? "" : "s"}`,
  },
  {
    id: "agent-revert",
    section: "Agent output",
    label: "Revert rate",
    definition: "agent-revert",
    polarity: "lower",
    primary: (v) => v.rate,
    short: (v) => pct(v.rate),
    show: (v) => `${pct(v.rate)} (${v.reverted} of ${v.merged} merged pull requests reverted)`,
  },
];

/** The catalogue by id, for the gatherer and a test. */
export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));

/* ── Rendering ─────────────────────────────────────────────────────────────────────────────── */

const TIERS = [
  ["light", "`agent: light`"],
  ["standard", "`agent: standard`"],
  ["deep", "`agent: deep`"],
  ["untiered", "no `agent:` label"],
  ["unlinked", "no linked issue"],
];

function numericReports(metric, reports) {
  return reports
    .map((report) => {
      const entry = report.metrics?.[metric.id];
      const value = entry?.value == null ? null : metric.primary(entry.value);
      return { version: report.version, value: typeof value === "number" && Number.isFinite(value) ? value : null };
    })
    .filter((point) => point.value !== null);
}

function valueCell(metric, entry) {
  if (!entry || entry.value == null) return `n/a${entry?.reason ? ` (${entry.reason})` : ""}`;
  return metric.show(entry.value);
}

function rollingCell(metric, entry) {
  if (!entry || entry.rolling == null) {
    const why = entry?.rollingReason ?? entry?.reason;
    return `n/a${why ? ` (${why})` : ""}`;
  }
  return metric.show(entry.rolling);
}

function previousCell(metric, reports) {
  const current = reports.at(-1);
  const prior = reports
    .slice(0, -1)
    .filter((r) => r.version !== current?.version)
    .map((r) => ({ version: r.version, value: r.metrics?.[metric.id]?.value }))
    .filter((r) => r.value != null && typeof metric.primary(r.value) === "number")
    .slice(-3)
    .reverse();
  return prior.length === 0 ? "—" : prior.map((r) => `${r.version} ${metric.short(r.value)}`).join(" · ");
}

function trendCell(metric, reports) {
  return sparkline(numericReports(metric, reports).map((p) => p.value));
}

function directionCell(metric, reports) {
  const current = reports.at(-1);
  if (current?.metrics?.[metric.id]?.value == null) return "—";
  const points = numericReports(metric, reports);
  if (points.length < 2) return "—";
  return direction(points.at(-2).value, points.at(-1).value, metric.polarity);
}

/**
 * The report for `current`, rendered from every report up to it. `history` is what
 * `docs/metrics/*.json` holds plus the current one; a report for an old release is not rewritten to
 * include a newer release, so the file committed at 0.7.0 stays what it said then.
 */
export function renderReport(current, history) {
  const reports = reportsUpTo(
    history.some((r) => r.version === current.version) ? history : [...history, current],
    current.version,
  );
  const window = current.previous
    ? `**since** ${current.previous} (${current.previous_date}) — a ${duration(Date.parse(current.window.to) - Date.parse(current.window.from))} window.`
    : "**the 7 days before this release** — there is no earlier stable tag, so the first window is a week by definition.";
  const lines = [
    `# AnyDag development health — ${current.version}`,
    "",
    `**Released** ${current.date} (tag \`${current.tag}\`), ${window}`,
    `The rolling 7-day value covers ${current.rolling.from} → ${current.rolling.to}.`,
    "",
    "Every metric links to its definition in [README.md](README.md). A number is computed from the tags and the GitHub API, never from the clock; a metric with no source says `n/a` and why. Security findings appear as counts only, never as the finding ([SECURITY.md](../../SECURITY.md)). This report gates nothing.",
    "",
  ];

  for (const section of SECTIONS) {
    const metrics = METRICS.filter((m) => m.section === section);
    if (metrics.length === 0) continue;
    lines.push(
      `## ${section}`,
      "",
      "| Metric | This release | Rolling 7 days | Previous | Trend | Direction |",
      "|---|---|---|---|---|---|",
    );
    for (const metric of metrics) {
      const entry = current.metrics?.[metric.id];
      lines.push(
        `| [${metric.label}](README.md#${metric.definition}) | ${valueCell(metric, entry)} | ${rollingCell(metric, entry)} | ${previousCell(metric, reports)} | ${trendCell(metric, reports)} | ${directionCell(metric, reports)} |`,
      );
    }
    lines.push("");
    if (section === "Agent output") {
      const acceptance = current.metrics?.["agent-acceptance"]?.value;
      const rework = current.metrics?.["agent-rework"]?.value;
      const reverts = current.metrics?.["agent-revert"]?.value;
      if (acceptance) {
        lines.push(
          "### Agent output by tier",
          "",
          "| Tier | Merged | Closed | Acceptance | Rework | Reverts |",
          "|---|---:|---:|---:|---:|---:|",
        );
        for (const [key, label] of TIERS) {
          const tier = acceptance.tiers?.[key];
          if (!tier || tier.closed === 0) continue;
          const reworked = rework?.by_tier?.[key];
          const reverted = reverts?.by_tier?.[key];
          lines.push(
            `| ${label} | ${tier.merged} | ${tier.closed} | ${pct(tier.rate)} | ${reworked ? `${pct(reworked.rate)} (${reworked.reworked}/${reworked.n})` : "—"} | ${reverted ? `${pct(reverted.rate)} (${reverted.reverted}/${reverted.n})` : "—"} |`,
          );
        }
        lines.push("");
      }
    }
  }

  lines.push(
    "## Not measured: the app in use",
    "",
    "The releases are built with `ANYDAG_CLOUD_BUILD` off, anonymous logs are opt-in, and the sync server is not deployed. There is **no production error, crash, latency or uptime data**, so error rate, new error signatures, crash-free sessions, sync failure rate and uptime are not measured, and this report does not invent them. The local server's latency is covered by the bench rows above; once logs exist, error signatures per release come from the log digest and crash-free sessions from the desktop's own opt-in crash reports.",
    "",
    "## How this report is made",
    "",
    `\`node scripts/release-report.mjs ${current.version}\` gathers the window from \`v${current.version}\` and the tag before it, writes \`docs/metrics/${current.version}.json\`, and prints this file. The definitions, the window and the sources are in [README.md](README.md). The trend is rendered from the reports in this folder up to this release.`,
    "",
  );
  return lines.join("\n");
}
