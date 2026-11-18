#!/usr/bin/env node
/**
 * Can a change reach what the pull request's bench measures (#527)? One answer, asked by
 * `.github/workflows/bench.yml` before it builds anything:
 *
 *     node scripts/bench-plan.mjs --base origin/develop --head <sha>    # prints JSON: { run, kinds, why }
 *     node scripts/bench-plan.mjs --files a.ts,b.md --field run          # classify a list, no git
 *
 * **The rule** is `scripts/e2e-plan.mjs`'s, read for the bench rather than the browser suite. Every
 * changed path is one of three kinds, and the bench runs when any path is not `ignore`:
 *
 *   bench    the bench itself: `scripts/bench*.mjs`, the session helper it signs in with, and its
 *            workflow — a change to the ruler is measured with the new ruler on both sides
 *   app      what is built into the page or the server: anything `e2e-plan.mjs` calls `app`,
 *            `pixels` or `chrome`, the sync client in `server/sync/`, and the dependencies (`package.json`, the
 *            lockfile), because a bumped package is a different app
 *   ignore   prose, CI config, unit tests, the browser suite, the desktop shell, the api server
 *            (`api/`, not deployed and not in the local server), and every other script
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { kindOf } from "./e2e-plan.mjs";

/** The kind of one repository-relative path, for the bench. */
export function benchKind(file) {
  if (/^scripts\/(bench[^/]*|session)\.mjs$/.test(file) || file === ".github/workflows/bench.yml") return "bench";
  if (/^package(-lock)?\.json$/.test(file)) return "app";
  if (/^(scripts|e2e|api)\//.test(file)) return "ignore";
  const kind = kindOf(file);
  return kind === "app" || kind === "pixels" || kind === "chrome" || kind === "sync" ? "app" : "ignore";
}

/** @param {string[]} files changed paths, relative to the repository root */
export function benchPlan(files) {
  const kinds = new Map();
  for (const f of files) kinds.set(benchKind(f), [...(kinds.get(benchKind(f)) ?? []), f]);
  const run = kinds.has("app") || kinds.has("bench");
  const why = [...kinds].map(([k, fs]) => `${fs.length} ${k}`).join(", ") || "no changes";
  return {
    run,
    kinds: Object.fromEntries([...kinds].map(([k, fs]) => [k, fs.length])),
    why: run ? `${why} → base and head measured` : `${why} → nothing the bench measures`,
  };
}

function main(argv) {
  const arg = (name) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const field = arg("--field");
  const out = (answer) => console.log(field ? String(answer[field] ?? "") : JSON.stringify(answer));
  const explicit = arg("--files");
  if (explicit !== undefined) return out(benchPlan(explicit.split(",").filter(Boolean)));
  const base = arg("--base") ?? "origin/develop";
  const head = arg("--head") ?? "HEAD";
  let files;
  try {
    files = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return out({ run: true, kinds: {}, why: `could not diff ${base}...${head} → base and head measured` });
  }
  out(benchPlan(files));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
