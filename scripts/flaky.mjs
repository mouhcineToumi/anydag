#!/usr/bin/env node
/**
 * **The tests that passed only on retry** (#494), out of a Playwright JSON report.
 *
 *     node scripts/flaky.mjs report.json            one line of JSON per flaky test
 *
 * The suite retries a failed test once (`retries: 1` in `playwright.config.ts`), so a test that fails
 * and then passes leaves the run green and is said once, as *flaky*, in a report nobody reads. The
 * nightly runs this over its full browser suite's merged report and keeps an issue per test it
 * prints (`.github/workflows/nightly.yml`, job `flaky`), so the same flake is one issue that collects
 * every night it came back, not a re-run somebody pressed and forgot.
 *
 * A test is named without its line: a line moves with every edit above it, and the issue is keyed by
 * its title. The name is the spec's file and the test's describe path and title — what Playwright
 * prints, `e2e/sidebar.spec.ts › the tree's empty space › right-clicking …`.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** What one flaky test was: its name, where it is, and the first error its failed try gave. */
export function flakes(report) {
  const out = [];
  const walk = (suite, path) => {
    /* The file's own suite carries the file name as its title; a describe's carries its words. */
    const here = suite.title && suite.title !== suite.file ? [...path, suite.title] : path;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status !== "flaky") continue;
        const failed = (test.results ?? []).find((r) => r.status !== "passed" && r.status !== "skipped");
        const error = failed?.error?.message ?? failed?.errors?.[0]?.message ?? "";
        const file = `e2e/${spec.file ?? suite.file}`.replace(/^e2e\/e2e\//, "e2e/");
        out.push({
          name: [file, ...here, spec.title].join(" › "),
          file,
          line: spec.line,
          project: test.projectName ?? "",
          error: clean(error),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  /* One entry per test: a test in two projects is one flake to look at. */
  return [...new Map(out.map((f) => [f.name, f])).values()];
}

/** An error as text an issue can hold: no terminal colours, and not a page of it. */
export function clean(message) {
  const plain = message.replace(/\u001b\[[0-9;]*m/g, "").trim();
  const lines = plain.split("\n");
  return lines.length > 25 ? [...lines.slice(0, 25), "…"].join("\n") : plain;
}

/** The issue's title for a flake. GitHub keeps 256 characters of a title; this keeps well under. */
export function titleOf(flake) {
  const title = `flaky: ${flake.name}`;
  return title.length > 200 ? `${title.slice(0, 199)}…` : title;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/flaky.mjs <playwright-report.json>");
    process.exit(2);
  }
  for (const f of flakes(JSON.parse(fs.readFileSync(file, "utf8")))) console.log(JSON.stringify({ ...f, title: titleOf(f) }));
}
