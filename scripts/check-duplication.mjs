#!/usr/bin/env node
/**
 * **Duplicated code: refused when a change introduces it, measured over the tree (#526).**
 *
 *     node scripts/check-duplication.mjs                    what this change adds, against the base
 *     node scripts/check-duplication.mjs --base <ref>       the same against a named commit
 *     node scripts/check-duplication.mjs --report           the whole tree, for the nightly summary
 *
 * Agent-written code piles up the same block in a second and third place instead of sharing it, and
 * a fix then lands in one copy. jscpd finds the clones; this script decides what to do with them:
 *
 *   - **A change** is compared with its base (`scripts/lib/change.mjs` says which commit) by clone
 *     fingerprint, not by line number, so an untouched old clone in a file the change edits stays
 *     quiet — and a block pasted into two places, or from a file into another, is new and fails.
 *   - **The tree** is scanned as it is, and the totals and the largest pairs go to the run summary
 *     the nightly writes. Nothing is refused there: it is a number to bring down, not a gate.
 *
 * `.jscpd.json` holds the scope and every exception it makes; plain JSON cannot hold a comment and
 * jscpd's parser refuses one, so the reasons for each pattern are in
 * `docs/architecture/gate-and-releases.md`, *Duplication and complexity*.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runJscpd } from "jscpd";
import { addSummary, askedForHelp, baseRef, failed, option, root } from "./lib/change.mjs";

const CONFIG = ".jscpd.json";

/** One clone as a line an editor can click, both ends named, and its size. */
export function cloneLine(clone) {
  const first = `${clone.firstFile.name}:${clone.firstFile.start}`;
  const second = `${clone.secondFile.name}:${clone.secondFile.start}`;
  return `${first} duplicates ${second} (${clone.lines} lines, ${clone.tokens} tokens)`;
}

/** A percentage as the report and the gate print it. */
function percent(total) {
  return `${total.percentage.toFixed(2)}%`;
}

/**
 * One scan, in a temporary directory that is removed whatever happens; `extra` is what makes it a
 * differential run (`--baseline-from-ref … --fail-on-new-clones`) or a whole-tree one (nothing).
 */
function scan(extra) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-jscpd-"));
  try {
    const result = runJscpd(
      [".", "--config", CONFIG, "--reporters", "json", "--output", output, "--silent", "--no-tips", ...extra],
      { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    const file = path.join(output, "jscpd-report.json");
    const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    const said = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n").trim();
    return { status: result.status, report, said };
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
}

/** The whole tree as a markdown section: the totals first, then the largest pairs to fold in. */
function report() {
  const { report: scanned, said } = scan([]);
  if (!scanned) {
    console.error(`check:duplication — jscpd wrote no report:\n${said}`);
    return 2;
  }
  const total = scanned.statistics.total;
  const worst = [...scanned.duplicates].sort((a, b) => b.lines - a.lines || b.tokens - a.tokens).slice(0, 10);
  const markdown = [
    "## Duplication",
    "",
    `${total.sources} files scanned; **${total.clones} clones**, ${total.duplicatedLines} duplicated lines (${percent(total)} of ${total.lines}).`,
    "",
    "The ten largest — each pair is one block to share, or to lift into the layer that owns it:",
    "",
    "| lines | clone | also in |",
    "| ---: | --- | --- |",
    ...worst.map(
      (clone) =>
        `| ${clone.lines} | \`${clone.firstFile.name}:${clone.firstFile.start}\` | \`${clone.secondFile.name}:${clone.secondFile.start}\` |`,
    ),
  ].join("\n");
  console.log(markdown);
  addSummary(markdown);
  return 0;
}

/** What this change adds against `base`; only clones whose fingerprint is not in `base` fail it. */
function differential(base) {
  const { status, report: scanned, said } = scan(["--baseline-from-ref", base, "--fail-on-new-clones"]);
  if (!scanned) {
    console.error(`check:duplication — jscpd wrote no report:\n${said}`);
    return 2;
  }
  const total = scanned.statistics.total;
  const fresh = scanned.duplicates.filter((clone) => clone.isNew);
  if (status === 0 && fresh.length === 0) {
    console.log(`check:duplication — ${total.clones} clones, ${percent(total)} duplicated, none new against ${base}`);
    return 0;
  }
  if (status !== 1 || fresh.length === 0) {
    /* Not the answer `--fail-on-new-clones` is supposed to give: a broken config, a missing binary. */
    console.error(`check:duplication — jscpd exited ${status}:\n${said}`);
    return 2;
  }
  console.error(
    `check:duplication — ${fresh.length} clone${fresh.length === 1 ? "" : "s"} this change introduces (tree: ${total.clones}):`,
  );
  for (const clone of fresh) console.error(`  ${cloneLine(clone)}`);
  console.error(
    "A clone is a fix that lands in one copy: share the block, or lift it into the layer that owns it (CLAUDE.md, *The layers*).",
  );
  return 1;
}

function main(argv) {
  if (askedForHelp(argv)) {
    console.log("usage: node scripts/check-duplication.mjs [--base <ref>] [--report]");
    return 0;
  }
  try {
    if (argv.includes("--report")) return report();
    const base = baseRef(option(argv, "--base"));
    if (!base) {
      const why = "no base to compare against: pass --base, or fetch origin/develop";
      if (process.env.GITHUB_EVENT_NAME === "pull_request") {
        console.error(`check:duplication — ${why}`);
        return 1;
      }
      console.log(`check:duplication — ${why}; only the whole-tree report can run here (npm run report:duplication)`);
      return 0;
    }
    return differential(base);
  } catch (error) {
    return failed("check:duplication", error);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
