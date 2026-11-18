/**
 * The git plumbing the two waste checks share (#526): where the tree is, which commit a change is
 * measured against, and which files it touches.
 *
 * **Why the base is a merge base, not a branch name.** A branch is compared with the tree it forked
 * from, because `develop` moves under it about twenty-five times a day. Comparing with
 * `origin/develop`'s tip would report a clone the branch has held for a week as new the moment
 * somebody fixed its other copy on `develop` — the branch did not add that clone, it inherited it.
 * On a pull request's merge commit the merge base is the base commit itself, so the two agree; on a
 * shallow checkout, where git cannot compute one, the fetched base commit is used as it is.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The top of the checkout, whatever directory the script was started from. */
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Run git in the tree and return its trimmed stdout; throws when git fails. */
export function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** `git(...)`, or `null` when the command fails — a missing ref, no merge base in a shallow clone. */
function gitOrNull(...args) {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

function rev(name) {
  return gitOrNull("rev-parse", "--verify", "--quiet", `${name}^{commit}`);
}

/**
 * The commit a change is measured against: `--base`, `ANYDAG_BASE` (CI passes the pull request's
 * base branch), `origin/develop`, `origin/main`, then their merge base with `HEAD` when git can
 * compute one. `null` when there is nothing to compare with — a shallow nightly checkout at a tag.
 */
export function baseRef(explicit) {
  for (const name of [explicit, process.env.ANYDAG_BASE, "origin/develop", "origin/main"]) {
    if (!name) continue;
    const sha = rev(name);
    if (!sha) continue;
    return gitOrNull("merge-base", sha, "HEAD") ?? sha;
  }
  return null;
}

/**
 * Every file the working tree has changed against `base`: what the branch adds since `base`
 * (`base..HEAD`, which is what a CI checkout is), what is staged or not (`HEAD`), and files git does
 * not know yet. Deleted files are left out — there is nothing in them to measure — and a rename
 * counts as its new path.
 *
 * The three are unioned because the same check runs in three places: a clean CI checkout has only
 * the first, a commit hook has the first two, and a developer trying a helper file out has the third.
 */
export function changedFiles(base) {
  const paths = new Set();
  const add = (...args) => {
    for (const line of (gitOrNull("diff", "--name-only", "--diff-filter=ACMR", ...args) ?? "").split("\n")) {
      if (line) paths.add(line);
    }
  };
  add(base, "HEAD");
  add("HEAD");
  for (const line of (gitOrNull("ls-files", "--others", "--exclude-standard") ?? "").split("\n")) {
    if (line) paths.add(line);
  }
  return [...paths].sort().filter((file) => fs.existsSync(path.join(root, file)));
}

/** Append a markdown section to the job's run summary, when there is one (the nightly's report). */
export function addSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) fs.appendFileSync(file, `${markdown.trimEnd()}\n\n`);
}

/** The value after `--name` in `argv`, or `undefined`. */
export function option(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

/** `--help`/`-h` was asked for: the script prints its usage and stops. */
export function askedForHelp(argv) {
  return argv.includes("--help") || argv.includes("-h");
}

/** A tool failure as one line — the check's name, then what went wrong — and the exit code for it. */
export function failed(name, error) {
  console.error(`${name} — ${error instanceof Error ? error.message : String(error)}`);
  return 2;
}
