#!/usr/bin/env node
/**
 * **The visual review** (#528): what a pull request did to how the app looks, judged by an agent
 * against `DESIGN.md`, on the maintainer's machine.
 *
 *     node scripts/visual-review.mjs <pr>              capture before and after, print what changed
 *     node scripts/visual-review.mjs post <pr>         post the agent's review on the pull request
 *     node scripts/visual-review.mjs post <pr> --dry-run   print the comment, push and post nothing
 *     node scripts/visual-review.mjs --all [<ref>]     capture every surface at <ref> (origin/develop)
 *
 * The pixel comparison in CI stays the gate: it catches a change nobody meant. This is for the
 * change somebody did mean — a baseline regenerated and committed, a new surface — which passes every
 * check whether it looks right or not. It runs **locally, not in CI**, the way the merge queue does
 * (`scripts/merge-queue.mjs`): no workflow runs an agent and no secret is needed. The driver is the
 * `visual-review` skill (`.claude/skills/visual-review/SKILL.md`), in the maintainer's own Claude
 * Code or OpenCode, and this script does everything that is not judgement:
 *
 * 1. **The path filter, first.** A pull request that touches none of {@link CHROME} prints
 *    `{"skip": true}` and stops, before Docker or any agent: it costs one `gh` call.
 * 2. **Capture.** Two worktrees kept under the git directory, at the merge base and at the pull
 *    request's head. In each, the chrome's screenshot specs ({@link screenshotSpecs}) run in the
 *    pinned Playwright image (`scripts/e2e-docker.sh`) with that side's snapshot folders emptied, so
 *    every image is a fresh render of that side's code. The worktrees, and the `node_modules` volume
 *    Docker keeps for each, are reused from one run to the next.
 * 3. **Pairs.** The images, paired by name into `before/`, `after/` and `diff/`, each marked
 *    `changed`, `new`, `removed` or `same` ({@link pairUp}), in `manifest.json` beside the chrome's
 *    diff. It prints the manifest's path and the changed pairs as JSON, and stops.
 * 4. The agent reads the pairs and `DESIGN.md` and writes `review.json` ({@link checkReview}).
 * 5. **Post.** The images the comment shows are pushed as one commit to `refs/visual-review/pr-<n>`
 *    — a ref outside `refs/heads`, so no clone fetches it and no workflow runs — and linked by that
 *    commit's sha. One comment on the pull request, edited in place on a re-run ({@link MARKER}).
 *
 * `--all` is step 2 for one side and every surface, for an audit of the whole app (a step before a
 * release in `docs/RELEASING.md`): the agent writes `report.md` beside the images.
 *
 * Exit codes: 0 done (the JSON on stdout says what), 1 an error, 2 a wrong argument or a
 * `review.json` the comment cannot be made from (the message says which field).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { compare, decode, encode } from "./lib/png.mjs";

/** The paths whose change can change how the chrome looks: a pull request touching none is skipped. */
export const CHROME = [
  /^src\/(styles|ui|settings|blocks|feedback|telemetry)\//,
  /^themes\//,
  /^DESIGN\.md$/,
  /^e2e\/surfaces\.spec\.ts$/,
  /* A baseline regenerated is the case this review exists for; the diagram's are `reference.spec.ts`'s. */
  /^e2e\/(?!reference\.|export\.)[^/]+\.spec\.ts-snapshots\//,
];

/** Specs whose screenshots are the diagram surface, not the chrome: out of this review. */
const NOT_CHROME = new Set(["reference.spec.ts", "export.spec.ts"]);

/** The hidden line that finds this review's own comment again. */
export const MARKER = "<!-- anydag:visual-review -->";

/** Pixels moved by more than the tolerance, as a share of the picture, under which a pair is the same. */
const SAME_RATIO = 0.0001;

const SEVERITIES = new Set(["regression", "note"]);

/** The changed paths that concern the chrome. */
export function chromeFiles(files) {
  return files.filter((f) => CHROME.some((re) => re.test(f)));
}

/** The spec files under `e2e/` of a checkout that take a screenshot of the chrome. */
export function screenshotSpecs(root) {
  const dir = path.join(root, "e2e");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".spec.ts") && !NOT_CHROME.has(f))
    .filter((f) => fs.readFileSync(path.join(dir, f), "utf8").includes("toHaveScreenshot("))
    .sort();
}

/** `surfaces.spec.ts` + `board-paper-linux.png` → `surfaces--board-paper`: one flat name per picture. */
export function surfaceName(spec, file) {
  return `${spec.replace(/\.spec\.ts$/, "")}--${file.replace(/(-linux)?\.png$/, "")}`;
}

/**
 * Pairs two sides' pictures by name. `compareOne(name)` answers how a pair present on both sides
 * differs (`{ sized, ratio }`); a pair is `same` under {@link SAME_RATIO}.
 */
export function pairUp(before, after, compareOne) {
  const names = [...new Set([...before, ...after])].sort();
  return names.map((name) => {
    if (!after.includes(name)) return { name, status: "removed" };
    if (!before.includes(name)) return { name, status: "new" };
    const d = compareOne(name);
    const status = !d.sized || d.ratio > SAME_RATIO ? "changed" : "same";
    return { name, status, ratio: Number(d.ratio.toFixed(5)), sized: d.sized };
  });
}

/**
 * Holds `review.json` to what the comment can be made from: a summary, and each finding naming a
 * surface the manifest has, a severity, a title and what is wrong. A finding's `surfaces` are shown
 * before and after; its `also` are the pictures with the same problem, named and not shown. Returns
 * the list of problems.
 */
export function checkReview(review, surfaces) {
  const problems = [];
  const known = new Set(surfaces.map((s) => s.name));
  if (typeof review?.summary !== "string" || !review.summary.trim()) problems.push("`summary` is missing");
  if (!Array.isArray(review?.findings)) problems.push("`findings` must be a list (empty when there are none)");
  for (const [i, f] of (review?.findings ?? []).entries()) {
    const at = `findings[${i}]`;
    if (!SEVERITIES.has(f.severity)) problems.push(`${at}.severity must be one of ${[...SEVERITIES].join(", ")}`);
    if (!Array.isArray(f.surfaces) || f.surfaces.length === 0) problems.push(`${at}.surfaces must name at least one picture`);
    for (const s of f.surfaces ?? []) if (!known.has(s)) problems.push(`${at}.surfaces: no picture is called "${s}"`);
    if (f.also !== undefined && !Array.isArray(f.also)) problems.push(`${at}.also must be a list`);
    for (const s of f.also ?? []) if (!known.has(s)) problems.push(`${at}.also: no picture is called "${s}"`);
    if (typeof f.title !== "string" || !f.title.trim()) problems.push(`${at}.title is missing`);
    if (typeof f.detail !== "string" || !f.detail.trim()) problems.push(`${at}.detail is missing`);
  }
  for (const s of review?.fine ?? []) if (!known.has(s)) problems.push(`fine: no picture is called "${s}"`);
  return problems;
}

/** `surfaces--settings-tags-paper-dark` → `Settings tags · dark` — what a person calls it. */
export function label(name) {
  const [, rest = name] = name.split("--");
  const dark = rest.endsWith("-paper-dark");
  const bare = rest.replace(/-(paper-dark|paper|neutral)$/, "");
  const theme = dark ? "dark" : rest.endsWith("-neutral") ? "neutral" : "light";
  const words = bare.replace(/-/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} · ${theme}`;
}

/**
 * The comment, from the manifest, the agent's review and `url(side, name)` for a picture. Pictures
 * shown: each finding's before and after (the diff linked), and a new surface's after.
 */
export function renderComment(manifest, review, url) {
  const by = (status) => manifest.surfaces.filter((s) => s.status === status);
  const changed = by("changed");
  const added = by("new");
  const removed = by("removed");
  const status = Object.fromEntries(manifest.surfaces.map((s) => [s.name, s.status]));
  const lines = [MARKER];
  const counts = [
    `${changed.length} picture${changed.length === 1 ? "" : "s"} changed`,
    added.length ? `${added.length} new` : "",
    removed.length ? `${removed.length} removed` : "",
  ].filter(Boolean);
  lines.push(
    `**Visual review** (advisory) · ${counts.join(", ")} · merge base \`${manifest.base.slice(0, 7)}\` → head \`${manifest.head.slice(0, 7)}\``,
    "",
  );
  if (changed.length === 0 && added.length === 0 && removed.length === 0) {
    lines.push("No surface with a screenshot looks any different at the head of this pull request.", "");
  } else {
    lines.push(review.summary.trim(), "");
  }
  const pictures = (names) => {
    const out = [];
    for (const name of names) {
      const st = status[name];
      if (st === "changed") {
        out.push(
          "",
          `   **${label(name)}** · [where the pixels moved](${url("diff", name)})`,
          "",
          "   | before | after |",
          "   |---|---|",
          `   | ![before](${url("before", name)}) | ![after](${url("after", name)}) |`,
        );
      } else if (st === "new") {
        out.push("", `   **${label(name)}** (new, no before)`, "", `   ![after](${url("after", name)})`);
      }
    }
    return out;
  };
  const findings = review.findings ?? [];
  const regressions = findings.filter((f) => f.severity === "regression" && !f.preexisting);
  const notes = findings.filter((f) => f.severity !== "regression" || f.preexisting);
  if (regressions.length) {
    lines.push("**Regressions**", "");
    regressions.forEach((f, i) => {
      const rule = f.rule ? ` (${f.rule})` : "";
      const also = f.also?.length ? ` Also on ${f.also.map(label).join(", ")}.` : "";
      lines.push(`${i + 1}. **${f.title.trim()}** ${f.detail.trim()}${rule}${also}`, ...pictures(f.surfaces), "");
    });
  }
  if (notes.length) {
    lines.push("**Notes**", "");
    for (const f of notes) {
      const where = f.surfaces.map(label).join(", ");
      const before = f.preexisting ? " Already so before this pull request." : "";
      const rule = f.rule ? ` (${f.rule})` : "";
      lines.push(`- **${where}: ${f.title.trim()}** ${f.detail.trim()}${rule}${before}`);
    }
    lines.push("");
  }
  const named = new Set(findings.flatMap((f) => [...f.surfaces, ...(f.also ?? [])]));
  const fine = changed.filter((s) => !named.has(s.name)).map((s) => label(s.name));
  if (fine.length) lines.push(`**Changed, looks right:** ${fine.join(", ")}.`, "");
  const unseen = added.filter((s) => !named.has(s.name));
  if (unseen.length) {
    lines.push(`**New, looks right:** ${unseen.map((s) => label(s.name)).join(", ")}.`, "");
  }
  if (removed.length) lines.push(`**No longer photographed:** ${removed.map((s) => label(s.name)).join(", ")}.`, "");
  if (manifest.failed?.length) {
    lines.push(
      `**Not compared:** the capture failed on ${manifest.failed.map((f) => `the ${f} side`).join(" and ")}, so some pictures may be missing from it.`,
      "",
    );
  }
  lines.push(
    `<sub>\`node scripts/visual-review.mjs ${manifest.pr}\` on the maintainer's machine (the \`visual-review\` skill). Advisory: it holds nothing back. The pixel comparison in CI is the gate.</sub>`,
  );
  return `${lines.join("\n")}\n`;
}

/* ── Git and GitHub ─────────────────────────────────────────────────────────────────────────── */

const git = (args, opts = {}) => execFileSync("git", args, { encoding: "utf8", ...opts }).trim();
const gh = (args, { input } = {}) =>
  execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });
const ghJson = (args) => JSON.parse(gh(args));
const say = (msg) => console.error(`[visual-review ${new Date().toISOString().slice(11, 19)}] ${msg}`);

function repo() {
  const { owner, name } = ghJson(["repo", "view", "--json", "owner,name"]);
  return { owner: owner.login, name };
}

function stateDir() {
  const dir = path.resolve(git(["rev-parse", "--git-common-dir"]), "visual-review");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function lock() {
  const file = path.join(stateDir(), "lock");
  try {
    const pid = Number(fs.readFileSync(file, "utf8"));
    process.kill(pid, 0);
    say(`already running (pid ${pid})`);
    process.exit(1);
  } catch {
    /* no lock, or its runner is gone */
  }
  fs.writeFileSync(file, String(process.pid));
  process.on("exit", () => fs.rmSync(file, { force: true }));
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
}

/* ── Capture ────────────────────────────────────────────────────────────────────────────────── */

/** A worktree at `sha`, kept between runs and cleaned of the last one's leftovers. */
function worktree(side, sha) {
  const dir = path.join(stateDir(), side);
  if (!fs.existsSync(path.join(dir, ".git"))) {
    /* A folder left without its worktree (one removed by hand): ours, under the git directory. */
    fs.rmSync(dir, { recursive: true, force: true });
    git(["worktree", "prune"]);
    git(["worktree", "add", "--quiet", "--detach", dir, sha]);
  } else {
    git(["-C", dir, "checkout", "--quiet", "--force", "--detach", sha]);
  }
  /* `node_modules` is the mount point of Docker's volume for this worktree, kept. Everything else
     untracked — last run's `server/dist`, `test-results/`, pictures — goes. */
  git(["-C", dir, "clean", "-fdxq", "-e", "node_modules"]);
  return dir;
}

/**
 * Renders the chrome's screenshot specs of the checkout at `dir` into fresh images, and copies them
 * into `out` under their flat names. Returns the names and whether the run passed.
 */
function render(dir, out, label) {
  const specs = screenshotSpecs(dir);
  for (const spec of specs) fs.rmSync(path.join(dir, "e2e", `${spec}-snapshots`), { recursive: true, force: true });
  say(`${label}: rendering ${specs.join(", ")} in the Playwright image`);
  const log = path.join(out, "..", `${label}.log`);
  const fd = fs.openSync(log, "w");
  /* A fresh worktree's dev server compiles every page on its first visit, and a picture lost to that
     would read as a surface added or removed: the config's one retry is kept, and each test has
     three times the suite's thirty seconds (a spec that photographs three themes in one test spends
     most of its budget on three cold pages). This run renders pictures; it is not the gate. */
  const run = spawnSync(
    "bash",
    ["scripts/e2e-docker.sh", ...specs.map((s) => `e2e/${s}`), "--update-snapshots=all", "--timeout=90000", "--reporter=line"],
    { cwd: dir, stdio: ["ignore", fd, fd], env: { ...process.env, FORCE_COLOR: "0" } },
  );
  fs.closeSync(fd);
  const passed = run.status === 0;
  if (!passed) say(`${label}: the run failed (exit ${run.status}); what it rendered is kept. Log: ${log}`);
  fs.mkdirSync(out, { recursive: true });
  const names = [];
  for (const spec of specs) {
    const snaps = path.join(dir, "e2e", `${spec}-snapshots`);
    if (!fs.existsSync(snaps)) continue;
    for (const file of fs.readdirSync(snaps).filter((f) => f.endsWith(".png"))) {
      const name = surfaceName(spec, file);
      fs.copyFileSync(path.join(snaps, file), path.join(out, `${name}.png`));
      names.push(name);
    }
  }
  return { names: names.sort(), passed, log };
}

function prInfo(n) {
  const pr = ghJson(["pr", "view", String(n), "--json", "number,title,baseRefName,headRefOid,state,url"]);
  const files = gh(["pr", "diff", String(n), "--name-only"])
    .split("\n")
    .filter(Boolean);
  return { ...pr, files };
}

/** Before and after for pull request `n`, or `{ skip }` when it touches no chrome. */
function capture(n, { fresh }) {
  const pr = prInfo(n);
  const touched = chromeFiles(pr.files);
  if (touched.length === 0) {
    return { skip: true, pr: n, reason: "it changes nothing the chrome is drawn from", files: pr.files.length };
  }
  git(["fetch", "--quiet", "origin", pr.baseRefName, `+refs/pull/${n}/head:refs/visual-review/pr-${n}-head`]);
  const head = git(["rev-parse", `refs/visual-review/pr-${n}-head`]);
  const base = git(["merge-base", `origin/${pr.baseRefName}`, head]);
  const dir = path.join(stateDir(), `pr-${n}`);
  const manifestPath = path.join(dir, "manifest.json");
  if (!fresh && fs.existsSync(manifestPath)) {
    const kept = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (kept.base === base && kept.head === head) {
      say(`#${n}: the pictures of ${base.slice(0, 7)} → ${head.slice(0, 7)} are already here (--fresh to take them again)`);
      return summary(kept, manifestPath);
    }
  }
  lock();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const failed = [];
  const before = render(worktree("base", base), path.join(dir, "before"), "before");
  if (!before.passed) failed.push("before");
  const after = render(worktree("head", head), path.join(dir, "after"), "after");
  if (!after.passed) failed.push("after");
  fs.mkdirSync(path.join(dir, "diff"), { recursive: true });
  const surfaces = pairUp(before.names, after.names, (name) => {
    const a = decode(fs.readFileSync(path.join(dir, "before", `${name}.png`)));
    const b = decode(fs.readFileSync(path.join(dir, "after", `${name}.png`)));
    const d = compare(a, b);
    if (d.image && d.pixels > 0) fs.writeFileSync(path.join(dir, "diff", `${name}.png`), encode(d.image));
    return d;
  });
  /* Only the pictures that differ are worth keeping on disk in pairs. */
  for (const s of surfaces) if (s.status === "same") fs.rmSync(path.join(dir, "diff", `${s.name}.png`), { force: true });
  /* The code half of the change the pictures show; the pictures themselves are in the folders. */
  const code = touched.filter((f) => !f.endsWith(".png"));
  fs.writeFileSync(
    path.join(dir, "diff.patch"),
    code.length ? git(["diff", base, head, "--", ...code], { maxBuffer: 64 * 1024 * 1024 }) : "",
  );
  const manifest = {
    pr: n,
    title: pr.title,
    url: pr.url,
    base,
    head,
    touched,
    failed,
    logs: { before: before.log, after: after.log },
    dir,
    surfaces,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return summary(manifest, manifestPath);
}

function summary(manifest, manifestPath) {
  const pick = (status) => manifest.surfaces.filter((s) => s.status === status).map((s) => s.name);
  return {
    skip: false,
    pr: manifest.pr,
    manifest: manifestPath,
    dir: manifest.dir,
    review: path.join(manifest.dir, "review.json"),
    changed: pick("changed"),
    new: pick("new"),
    removed: pick("removed"),
    same: pick("same").length,
    failed: manifest.failed,
  };
}

/** Every surface at `ref`, for the whole-app audit. */
function audit(ref) {
  const [remote, ...branch] = ref.split("/");
  if (remote === "origin" && branch.length) git(["fetch", "--quiet", "origin", branch.join("/")]);
  const sha = git(["rev-parse", `${ref}^{commit}`]);
  const dir = path.join(stateDir(), `audit-${new Date().toISOString().slice(0, 10)}-${sha.slice(0, 7)}`);
  lock();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const after = render(worktree("head", sha), path.join(dir, "after"), "after");
  const manifest = {
    audit: true,
    ref,
    head: sha,
    dir,
    failed: after.passed ? [] : ["after"],
    logs: { after: after.log },
    surfaces: after.names.map((name) => ({ name, status: "audit" })),
  };
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    audit: true,
    head: sha,
    manifest: manifestPath,
    dir,
    report: path.join(dir, "report.md"),
    pictures: after.names.length,
    failed: manifest.failed,
  };
}

/* ── Post ───────────────────────────────────────────────────────────────────────────────────── */

/** The pictures the comment shows, as one commit on `refs/visual-review/pr-<n>`; returns its sha. */
function pushPictures(r, manifest, files) {
  const ref = `refs/visual-review/pr-${manifest.pr}`;
  let parent = null;
  try {
    git(["fetch", "--quiet", "origin", `+${ref}:${ref}`], { stdio: "pipe" });
    parent = git(["rev-parse", ref]);
  } catch {
    /* The first review of this pull request. */
  }
  const index = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "anydag-visual-review-")), "index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  for (const rel of files) {
    const blob = git(["hash-object", "-w", path.join(manifest.dir, rel)]);
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${rel}`], { env });
  }
  const tree = git(["write-tree"], { env });
  fs.rmSync(path.dirname(index), { recursive: true, force: true });
  const message = `visual review of #${manifest.pr} at ${manifest.head.slice(0, 7)}`;
  const commit = git(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message]);
  /* Pictures, not code: the hooks' checks have nothing to say about them. Chained on the last
     review's commit, so an older comment's pictures stay reachable. */
  git(["push", "--quiet", "origin", `${commit}:${ref}`], { env: { ...process.env, ANYDAG_NO_HOOK: "1" }, stdio: "pipe" });
  say(`#${manifest.pr}: ${files.length} pictures at ${ref} (${commit.slice(0, 7)}) in ${r.owner}/${r.name}`);
  return commit;
}

/** The pictures a comment links, as paths inside the review's folder. */
export function picturesOf(manifest, review) {
  const status = Object.fromEntries(manifest.surfaces.map((s) => [s.name, s.status]));
  const out = new Set();
  for (const f of review.findings ?? []) {
    for (const name of f.surfaces) {
      if (status[name] === "changed") {
        out.add(`before/${name}.png`);
        out.add(`after/${name}.png`);
        if (fs.existsSync(path.join(manifest.dir, "diff", `${name}.png`))) out.add(`diff/${name}.png`);
      } else if (status[name] === "new") out.add(`after/${name}.png`);
    }
  }
  return [...out].sort();
}

function upsertComment(r, n, body) {
  const comments = ghJson(["api", "--paginate", "--slurp", `repos/${r.owner}/${r.name}/issues/${n}/comments`]).flat();
  const mine = comments.find((c) => typeof c.body === "string" && c.body.startsWith(MARKER));
  if (mine) {
    gh(["api", "-X", "PATCH", `repos/${r.owner}/${r.name}/issues/comments/${mine.id}`, "-F", "body=@-"], { input: body });
    return mine.html_url;
  }
  return gh(["pr", "comment", String(n), "--body-file", "-"], { input: body }).trim();
}

function post(n, { dryRun }) {
  const dir = path.join(stateDir(), `pr-${n}`);
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`no capture for #${n}: run \`node scripts/visual-review.mjs ${n}\` first`);
    return 2;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const reviewPath = path.join(dir, "review.json");
  const differs = manifest.surfaces.some((s) => s.status !== "same");
  let review = { summary: "", findings: [] };
  if (fs.existsSync(reviewPath)) review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
  else if (differs) {
    console.error(`no review at ${reviewPath}: the agent writes it before the comment can be posted`);
    return 2;
  }
  if (differs) {
    const problems = checkReview(review, manifest.surfaces);
    if (problems.length) {
      console.error(`review.json cannot be posted:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
      return 2;
    }
  }
  const r = repo();
  const files = picturesOf(manifest, review);
  if (dryRun) {
    const url = (side, name) => `${dir}/${side}/${name}.png`;
    process.stdout.write(renderComment(manifest, review, url));
    return 0;
  }
  const sha = files.length ? pushPictures(r, manifest, files) : null;
  const url = (side, name) => `https://github.com/${r.owner}/${r.name}/raw/${sha}/${side}/${name}.png`;
  const link = upsertComment(r, n, renderComment(manifest, review, url));
  console.log(JSON.stringify({ posted: true, pr: n, comment: link, pictures: files.length }));
  return 0;
}

/* ── Arguments ──────────────────────────────────────────────────────────────────────────────── */

const USAGE = `usage:
  node scripts/visual-review.mjs <pr> [--fresh]        capture before and after for a pull request
  node scripts/visual-review.mjs post <pr> [--dry-run] post the review the agent wrote
  node scripts/visual-review.mjs --all [<ref>]         capture every surface at <ref> (origin/develop)`;

function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const args = argv.filter((a) => !a.startsWith("--"));
  const number = (s) => (/^\d+$/.test(s ?? "") ? Number(s) : null);
  if (flags.has("--all")) {
    console.log(JSON.stringify(audit(args[0] ?? "origin/develop"), null, 2));
    return 0;
  }
  if (args[0] === "post" && number(args[1])) return post(number(args[1]), { dryRun: flags.has("--dry-run") });
  if (number(args[0])) {
    console.log(JSON.stringify(capture(number(args[0]), { fresh: flags.has("--fresh") }), null, 2));
    return 0;
  }
  console.error(USAGE);
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main(process.argv.slice(2)));
