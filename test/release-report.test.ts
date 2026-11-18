import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import * as report from "../scripts/lib/release-report.mjs";

const { METRICS, compareVersions, direction, median, percentile, renderReport, reportsUpTo, sparkline, summarize } = report;

/**
 * **The development health report** (#529): the rows are fixed, the arithmetic is quiet when it is
 * wrong, and every row must link to a definition that exists. The trend is only a trend if the rows
 * never move, so this holds the catalogue, the sparkline, the direction and the rendered file away
 * from the GitHub API and the tags.
 */
describe("the catalogue", () => {
  it("gives every metric a unique id, a definition anchor and a polarity", () => {
    const ids = METRICS.map((m: { id: string }) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const metric of METRICS) {
      expect(metric.definition).toMatch(/^[a-z0-9-]+$/);
      expect(["higher", "lower"]).toContain(metric.polarity);
      expect(metric.label.length).toBeGreaterThan(0);
      expect(metric.section.length).toBeGreaterThan(0);
    }
  });

  it("is the six-metric starter set, and no other row claims a star", () => {
    const starred = METRICS.filter((m: { label: string }) => m.label.includes("★")).map((m: { id: string }) => m.id);
    expect(starred).toEqual([
      "release-frequency",
      "lead-time-for-changes",
      "change-failure-rate",
      "regression-rate",
      "ci-first-pass-rate",
      "bug-to-feature-ratio",
    ]);
  });

  it("links every row to a definition the README actually has", () => {
    const readme = fs.readFileSync(path.join(process.cwd(), "docs", "metrics", "README.md"), "utf8");
    for (const metric of METRICS) {
      expect(readme, `${metric.id} has no <a id="${metric.definition}"> in docs/metrics/README.md`).toContain(
        `<a id="${metric.definition}"></a>`,
      );
    }
  });

  it("carries every bench row as its own metric, so one row moving is a diff", () => {
    const bench = METRICS.filter((m: { section: string }) => m.section === "Performance — the release bench");
    expect(bench).toHaveLength(11); // ten bench rows, plus interaction latency (#527)
    expect(bench.filter((m: { id: string }) => m.id.startsWith("bench."))).toHaveLength(10);
  });
});

describe("the arithmetic", () => {
  it("takes the middle, and the mean of the two middles for an even count", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("interpolates the p90 between ranks rather than taking the ninth of ten", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1, 6);
    expect(percentile([10], 0.9)).toBe(10);
    expect(percentile([], 0.9)).toBeNull();
  });

  it("summarises milliseconds in the unit it is asked for", () => {
    expect(summarize([60_000, 120_000], 60_000)).toEqual({ median: 1.5, p90: 1.9, n: 2 });
    expect(summarize([], 60_000)).toEqual({ median: null, p90: null, n: 0 });
  });

  it("sorts versions as semver, not as strings", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("0.9.0", "0.9.0")).toBe(0);
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
  });
});

describe("the trend", () => {
  it("draws the last eight numbers, from ▁ to █", () => {
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8])).toBe("▁▂▃▄▅▆▇█");
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toHaveLength(8);
  });

  it("says a flat run is flat, and one number is not a trend", () => {
    expect(sparkline([2, 2, 2])).toBe("▄▄▄");
    expect(sparkline([2])).toBe("—");
    expect(sparkline([])).toBe("—");
  });

  it("turns a move into an arrow and a word, with the metric's polarity", () => {
    expect(direction(5, 3, "lower")).toBe("↓ better");
    expect(direction(5, 3, "higher")).toBe("↓ worse");
    expect(direction(1, 2, "higher")).toBe("↑ better");
    expect(direction(1, 2, "lower")).toBe("↑ worse");
    expect(direction(1, 1, "lower")).toBe("→ flat");
    expect(direction(null, 1, "lower")).toBe("—");
  });
});

describe("the rendered report", () => {
  const date = (version: string) => new Date(Date.UTC(2026, 10, Number(version.split(".")[2]) + 1)).toISOString();

  const fake = (version: string, frequency: number | null) => ({
    version,
    tag: `v${version}`,
    date: date(version),
    previous: null,
    previous_date: null,
    window: { from: "2026-11-01T10:00:00.000Z", to: date(version) },
    rolling: { from: "2026-11-01T10:00:00.000Z", to: date(version) },
    metrics: Object.fromEntries(
      METRICS.map((metric: { id: string }) => [
        metric.id,
        metric.id === "release-frequency" && frequency !== null
          ? {
              value: { stable: 1, nightly: 0, weeks: 1, stable_per_week: frequency, nightly_per_week: 0 },
              rolling: { stable: 1, nightly: 0, weeks: 1, stable_per_week: frequency, nightly_per_week: 0 },
              reason: null,
              rollingReason: null,
            }
          : { value: null, rolling: null, reason: "depends on #526" },
      ]),
    ),
  });

  it("keeps a report out of a newer release's folder", () => {
    const history = [fake("0.1.0", 1), fake("0.3.0", 3), fake("0.2.0", 2)];
    expect(reportsUpTo(history, "0.2.0").map((r: { version: string }) => r.version)).toEqual(["0.1.0", "0.2.0"]);
  });

  it("shows this release, the release before it, the sparkline and the direction", () => {
    const history = [fake("0.1.0", 2), fake("0.2.0", 1)];
    const markdown = renderReport(history[1], history);
    expect(markdown).toContain("# AnyDag development health — 0.2.0");
    expect(markdown).toContain("[Release frequency ★](README.md#release-frequency)");
    expect(markdown).toContain("0.1.0 2/wk");
    expect(markdown).toContain("█▁");
    expect(markdown).toContain("↓ worse");
  });

  it("says n/a and why, and does not draw a direction for it", () => {
    const history = [fake("0.1.0", 2), fake("0.2.0", 1)];
    const markdown = renderReport(history[1], history);
    expect(markdown).toContain("n/a (depends on #526)");
    const line = markdown.split("\n").find((l: string) => l.includes("[Security backlog]"));
    expect(line).toContain("n/a (depends on #526)");
    expect(line?.trim().endsWith("| — |")).toBe(true);
  });

  it("is the same bytes when it is rendered again from the same reports", () => {
    const history = [fake("0.1.0", 2), fake("0.2.0", 1)];
    expect(renderReport(history[1], history)).toBe(renderReport(history[1], history));
  });

  it("links every one of its rows", () => {
    const history = [fake("0.1.0", 2), fake("0.2.0", 1)];
    const markdown = renderReport(history[1], history);
    for (const metric of METRICS) {
      expect(markdown, `${metric.id} is missing`).toContain(`README.md#${metric.definition}`);
    }
  });
});
