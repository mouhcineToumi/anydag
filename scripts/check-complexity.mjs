#!/usr/bin/env node
/**
 * **Cognitive complexity: refused when a change raises it, measured over the tree (#526).**
 *
 *     node scripts/check-complexity.mjs                     what this change makes more complex
 *     node scripts/check-complexity.mjs --base <ref>        the same against a named commit
 *     node scripts/check-complexity.mjs --report            the whole tree, for the nightly summary
 *     node scripts/check-complexity.mjs --update-baseline   rewrite the baseline (its own commit)
 *
 * Biome's `noExcessiveCognitiveComplexity` is the measure — the rule weighs nesting and breaks in
 * control flow, which is what a reader feels, not the number of branches a cyclomatic count gives.
 * It is configured in `biome.jsonc` at 20 and switched **off there**, because 306 functions were
 * already over 20 when it landed (#526) and printing all of them in every `biome lint` would bury
 * the one line the lint is about. This script switches it back on (`--only`), over the files a
 * change touches or over the whole tree.
 *
 * **Why 20.** Measured over the tree on 2026-11-18: 473 functions are over 15 (Biome's default),
 * 306 over 20, 201 over 25, 141 over 30; the worst is 255. 15 is a parser's first switch plus two
 * branches, which this codebase has everywhere; 20 is where a function stops being one idea. The
 * threshold lives in three places that must agree — `THRESHOLD` here, `maxAllowedComplexity` in
 * `biome.jsonc`, and `threshold` in the baseline — and the check refuses a baseline taken at
 * another number rather than quietly comparing unlike things.
 *
 * **Why a baseline file and not a `biome-ignore` per function.** Suppressing 306 functions in place
 * would put a comment in the middle of the code for a fact about a number, and every one would be a
 * line to keep true. `scripts/complexity-baseline.json` holds each function's name and score per
 * file instead; a function that is not in it, or whose score rose, is what fails a change. Names and
 * scores, not line numbers, so a block that moves within its file is not reported as new. Run
 * `npm run complexity:baseline` after a deliberate refactor, in a commit of its own, and never to
 * make a red change green.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addSummary, askedForHelp, baseRef, changedFiles, failed, option, root } from "./lib/change.mjs";

const RULE = "complexity/noExcessiveCognitiveComplexity";
const THRESHOLD = 20;
const BASELINE = path.join(root, "scripts/complexity-baseline.json");
const BIOME = path.join(root, "node_modules/@biomejs/biome/bin/biome");
const SCRIPT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** The function a diagnostic points at: Biome's span covers the name, or the `=>` of a callback. */
function nameAt(file, location, sources) {
  if (!sources.has(file)) sources.set(file, fs.readFileSync(path.join(root, file), "utf8").split("\n"));
  const text = (sources.get(file)[location.start.line - 1] ?? "")
    .slice(location.start.column - 1, location.end.column - 1)
    .trim();
  /* An arrow function has no name to point at: Biome's span covers the `=>`. */
  if (text.startsWith("=>")) return "an arrow function";
  return text.replace(/\($/, "").trim() || "a function";
}

/** The findings of one biome JSON report, and only the complexity ones. */
export function findingsOf(report) {
  const sources = new Map();
  return (report.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === `lint/${RULE}`)
    .map((diagnostic) => ({
      file: diagnostic.location.path,
      line: diagnostic.location.start.line,
      name: nameAt(diagnostic.location.path, diagnostic.location, sources),
      complexity: Number(/complexity of (\d+)/.exec(diagnostic.message)?.[1] ?? 0),
    }))
    .filter((finding) => finding.complexity > THRESHOLD);
}

/**
 * What this change raises: findings grouped per file, and each file's functions matched against the
 * baseline's. A function of the same name and score matches first — so one that moved down the page
 * is not new — then a function of the same name at another score (a raise, or an improvement), then
 * another function at the same score (a rename or a split), and what is left is paired with the
 * nearest remaining score: above it is a raise, below it an improvement, and nothing left to pair
 * with is new.
 *
 * The comparison is per file, and names come first, because both simpler rules have a blind spot:
 * line numbers move with every edit above them, and scores alone let one function's improvement pay
 * for another's raise. A name is not always there (an anonymous callback has none), so scores still
 * decide those.
 */
export function compare(baseline, findings) {
  const byFile = new Map();
  for (const finding of findings) byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding]);
  const raised = [];
  for (const [file, found] of byFile) raised.push(...compareFile(baseline[file] ?? [], found));
  return raised.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** The entry whose score is closest to `complexity`; `entries` is never empty. */
function nearest(entries, complexity) {
  let best = entries[0];
  for (const entry of entries) {
    if (Math.abs(entry.complexity - complexity) < Math.abs(best.complexity - complexity)) best = entry;
  }
  return best;
}

/** One file's findings against the functions the baseline holds for it. */
function compareFile(before, found) {
  const claimed = new Set();
  const free = () => before.filter((entry) => !claimed.has(entry));
  const claim = (entry, finding) => {
    claimed.add(entry);
    if (finding.complexity > entry.complexity) return { ...finding, was: entry.complexity };
    return null;
  };

  /* Same function, same score: untouched. */
  const rest = [];
  for (const finding of [...found].sort((a, b) => a.complexity - b.complexity)) {
    const same = free().find((entry) => entry.name === finding.name && entry.complexity === finding.complexity);
    if (same) claimed.add(same);
    else rest.push(finding);
  }

  /* Same function, another score: a raise if it grew. */
  const raised = [];
  const orphans = [];
  for (const finding of rest) {
    const named = free().filter((entry) => entry.name === finding.name);
    if (named.length === 0) {
      orphans.push(finding);
      continue;
    }
    const change = claim(nearest(named, finding.complexity), finding);
    if (change) raised.push(change);
  }

  /* Another function, or nothing: a score match is a rename, the nearest is a change, none is new. */
  for (const finding of orphans) {
    const exact = free().find((entry) => entry.complexity === finding.complexity);
    if (exact) {
      claimed.add(exact);
      continue;
    }
    const left = free();
    if (left.length === 0) {
      raised.push({ ...finding, was: null });
      continue;
    }
    const change = claim(nearest(left, finding.complexity), finding);
    if (change) raised.push(change);
  }
  return raised;
}

/** Run the rule over `paths` and return biome's report. */
function lint(paths) {
  const args = ["lint", `--only=${RULE}`, "--reporter=json", "--max-diagnostics=none", "--no-errors-on-unmatched", ...paths];
  const out = execFileSync(process.execPath, [BIOME, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.indexOf("{")));
}

/** The baseline as `{ file: [{name, complexity}] }`, from the compact `[name, score]` pairs on disk. */
function readBaseline(quiet = false) {
  if (!fs.existsSync(BASELINE)) {
    if (!quiet)
      console.error("check:complexity — scripts/complexity-baseline.json is missing; run `npm run complexity:baseline`");
    return null;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  if (baseline.threshold !== THRESHOLD) {
    if (!quiet) {
      console.error(
        `check:complexity — the baseline was taken at ${baseline.threshold}, the rule runs at ${THRESHOLD}; run \`npm run complexity:baseline\``,
      );
    }
    return null;
  }
  const files = {};
  for (const [file, entries] of Object.entries(baseline.files)) {
    files[file] = entries.map(([name, complexity]) => ({ name, complexity }));
  }
  return files;
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** What this change raises above the baseline. */
function differential(base, baseline) {
  const files = new Set(changedFiles(base).filter((file) => SCRIPT.test(file)));
  if (files.size === 0) {
    console.log("check:complexity — no script changed");
    return 0;
  }
  /* The whole tree is linted (a second) and the findings outside the change dropped: one call, no
     command-line length to worry about on Windows, and the same report the nightly reads. */
  const raised = compare(
    baseline,
    findingsOf(lint(["."])).filter((finding) => files.has(finding.file)),
  );
  if (raised.length === 0) {
    console.log(
      `check:complexity — no function over ${THRESHOLD} that ${plural(files.size, "changed file", "changed files")} did not already hold`,
    );
    return 0;
  }
  console.error(
    `check:complexity — ${plural(raised.length, "function", "functions")} this change makes more complex than ${THRESHOLD}:`,
  );
  for (const finding of raised) {
    const was = finding.was === null ? "not in the baseline for this file" : `the baseline held ${finding.was} in this file`;
    console.error(`  ${finding.file}:${finding.line} ${finding.name} — cognitive complexity ${finding.complexity}, ${was}`);
  }
  console.error("Split the function, or move a branch into a named one; `npm run report:complexity` lists the tree's worst.");
  return 1;
}

/** The whole tree as a markdown section: how many, where, and the worst to start on. */
function report() {
  const findings = findingsOf(lint(["."]));
  const files = new Set(findings.map((finding) => finding.file));
  const worst = [...findings].sort((a, b) => b.complexity - a.complexity).slice(0, 15);
  const baseline = readBaseline(true);
  const held = baseline ? Object.values(baseline).flat().length : null;
  const trend =
    held === null
      ? ""
      : ` The baseline holds ${held} across ${Object.keys(baseline).length} files; ${findings.length <= held ? `${held - findings.length} fewer` : `${findings.length - held} more`} today.`;
  const markdown = [
    "## Cognitive complexity",
    "",
    `**${findings.length} functions** over ${THRESHOLD} in ${files.size} files.${trend}`,
    "",
    "The fifteen worst — each one to split, or to hand a branch to a named function:",
    "",
    "| complexity | function | where |",
    "| ---: | --- | --- |",
    ...worst.map((finding) => `| ${finding.complexity} | ${finding.name} | \`${finding.file}:${finding.line}\` |`),
  ].join("\n");
  console.log(markdown);
  addSummary(markdown);
  return 0;
}

/** Rewrite the baseline from the tree as it stands; a deliberate act, never part of a fix. */
function updateBaseline() {
  const findings = findingsOf(lint(["."]));
  const files = {};
  for (const finding of findings) files[finding.file] = [...(files[finding.file] ?? []), [finding.name, finding.complexity]];
  const ordered = Object.keys(files)
    .sort()
    .map((file) => [file, files[file].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))]);
  /* One line a file, the shape a diff of a generated file wants: a score that moved changes one
     pair, not five lines of pretty-printed object. */
  const body = ordered.map(([file, entries]) => `    ${JSON.stringify(file)}: ${JSON.stringify(entries)}`).join(",\n");
  fs.writeFileSync(BASELINE, `{\n  "threshold": ${THRESHOLD},\n  "files": {\n${body}\n  }\n}\n`);
  console.log(
    `check:complexity — baseline rewritten: ${plural(findings.length, "function", "functions")} over ${THRESHOLD} in ${plural(ordered.length, "file", "files")}`,
  );
  return 0;
}

function main(argv) {
  if (askedForHelp(argv)) {
    console.log("usage: node scripts/check-complexity.mjs [--base <ref>] [--report | --update-baseline]");
    return 0;
  }
  try {
    if (argv.includes("--report")) return report();
    if (argv.includes("--update-baseline")) return updateBaseline();
    const baseline = readBaseline();
    if (!baseline) return 2;
    const base = baseRef(option(argv, "--base"));
    if (!base) {
      const why = "no base to compare against: pass --base, or fetch origin/develop";
      if (process.env.GITHUB_EVENT_NAME === "pull_request") {
        console.error(`check:complexity — ${why}`);
        return 1;
      }
      console.log(`check:complexity — ${why}; only the whole-tree report can run here (npm run report:complexity)`);
      return 0;
    }
    return differential(base, baseline);
  } catch (error) {
    return failed("check:complexity", error);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
