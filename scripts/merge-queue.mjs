#!/usr/bin/env node
/**
 * **The merge queue** (#503): pull requests into `develop` land one at a time, each tested on the
 * `develop` it lands on.
 *
 *     node scripts/merge-queue.mjs                 work the queue until it is empty
 *     node scripts/merge-queue.mjs --watch         …and keep waiting for more
 *     node scripts/merge-queue.mjs status          print the queue in order, change nothing
 *     node scripts/merge-queue.mjs eject <n> <why> take a pull request out, with a comment
 *
 * GitHub's own merge queue is offered only to repositories an organization owns, and this one a
 * person owns, so the queue is this script run from the maintainer's machine. A pull request joins
 * it by being labelled `queue`; the oldest label goes first. For the one at the front the script
 *
 * 1. brings the branch up to date with GitHub's *update branch* (a merge commit from `develop`, no
 *    force-push — the merge into `develop` is a squash, so it never shows),
 * 2. turns on auto-merge pinned to that commit, so GitHub merges it the moment the required checks
 *    pass,
 * 3. re-runs a failed check once, and on a second failure takes the pull request out with a comment
 *    naming what failed — a policy check (`PR title`, `PR target`, `Linked issue`) at once,
 * 4. and on a conflict stops, with the merge of `develop` left in a worktree under the git directory
 *    and its description printed as JSON (exit 3): resolving it is the `merge-queue` skill's job
 *    (`.claude/skills/merge-queue/SKILL.md`), which pushes the resolution and runs this again.
 *
 * What the 0.9.0 batch taught it (#560):
 *
 * - **A pull request that changes the gate goes last.** One touching `scripts/checks.sh` or a
 *   `*-baseline.json` is held while anything else is queued, so a check that did not exist when the
 *   others went green cannot eject them, and it waits for the rest to land. One that carries a
 *   baseline then stops the queue once it is up to date (exit 4) until the baseline is retaken on that
 *   `develop` and committed as `chore: retake … baseline`, which the skill does.
 * - **A stacked branch is rebased.** When the branch still carries the commits of a pull request that
 *   landed as a squash, *update branch* would conflict in every file they touched; the queue rebases
 *   the branch's own commits onto `develop` and force-pushes with a lease instead, and says so on the
 *   pull request. A conflict there stops it as a merge conflict does (exit 3, `kind: "rebase"`).
 * - **The commit that lands ran the whole browser suite.** `e2e.yml` runs everything for a pull
 *   request labelled `queue`; a front pull request whose last `e2e` run was still the selection (it
 *   was up to date when it reached the front, so no update started a run) has that run started again,
 *   whole, before auto-merge goes on.
 *
 * The ruleset on `develop` requires a branch to be up to date (`strict_required_status_checks_policy`),
 * so GitHub itself refuses a merge that was not tested on the current `develop`, whoever asks; the
 * queue is what does the updating, in order, so nobody races for it. Auto-merge is turned off on every
 * other queued pull request for the same reason. One runner at a time: a lock in the git directory.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { lock } from "./lib/lock.mjs";

export const LABEL = "queue";
const BASE = "develop";
/** A failure here is the pull request's text or target, which a re-run cannot change. */
const NO_RETRY = new Set(["PR title", "PR target", "Linked issue"]);
/** Branches whose pull requests keep their commits (a release or back-merge), as `AGENTS.md` says. */
const MERGE_COMMIT = /^(release|hotfix)\/|^chore\/back-merge/;
/** A change to the gate itself: what the fast tier runs, or a baseline one of its checks reads. */
const GATE = /^scripts\/checks\.sh$|-baseline\.json$/;
const BASELINE = /-baseline\.json$/;
/** How each baseline is retaken, for the skill to run on the `develop` the pull request lands on. */
export const BASELINES = { "scripts/complexity-baseline.json": "node scripts/check-complexity.mjs --update-baseline" };
/** The commit that retakes a baseline, the last on the branch when it is current. */
const RETAKEN = /^chore(\([^)]*\))?!?: retake .*baseline/i;
/** An `e2e.yml` shard's job name, which carries the scope it ran: `shard 2/4 (full)`. */
const SHARD = /^shard \d+\/\d+ \((\w+)\)$/;
const POLL_MS = 20_000;
/** Green, armed and still open this long means something else holds it: a review, a thread. */
const BLOCKED_MS = 3 * 60_000;
const TIMEOUT_MS = 60 * 60_000;

/** When a pull request joined the queue: the last time it was labelled `queue`. */
export function queuedAt(pr) {
  const events = (pr.timelineItems?.nodes ?? []).filter((e) => e?.label?.name === LABEL);
  return events.at(-1)?.createdAt ?? "";
}

/** The queue in the order it is worked: the oldest label first, then the lower number. */
export function order(prs) {
  return [...prs].sort((a, b) => queuedAt(a).localeCompare(queuedAt(b)) || a.number - b.number);
}

/** The paths a pull request changes that change the gate. */
export function gateFiles(files) {
  return files.filter((f) => GATE.test(f));
}

const filesOf = (pr) => (pr.files?.nodes ?? []).map((f) => f.path);
const changesGate = (pr) => gateFiles(filesOf(pr)).length > 0;

/**
 * The order the queue lands in: `order`'s, except that a pull request changing the gate goes after
 * every one that does not, so it is worked only when nothing else is queued.
 */
export function landingOrder(queue) {
  return [...queue.filter((pr) => !changesGate(pr)), ...queue.filter(changesGate)];
}

/**
 * The scope of the latest `e2e.yml` run on a commit — `changed`, `smoke` or `full` — from its shards'
 * job names; `null` when no shard ran (a change the browser suite cannot see).
 */
export function e2eScope(contexts) {
  let scope = null;
  let when = "";
  for (const c of contexts) {
    if (c.__typename !== "CheckRun") continue;
    const m = SHARD.exec(c.name);
    if (!m) continue;
    const started = c.startedAt ?? "￿";
    if (scope === null || started >= when) {
      scope = m[1];
      when = started;
    }
  }
  return scope;
}

/** Whether the branch's last commit is the retake of its baselines, made on the `develop` it has. */
export function baselineRetaken(commit) {
  return Boolean(commit) && commit.parents === 1 && RETAKEN.test(commit.message ?? "");
}

const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/**
 * Each check on a commit as `pending`, `success` or `failure`, by name. A re-run is a new check run
 * with the same name, so the latest one started is the answer; one not started yet is the latest.
 */
export function checksOf(contexts) {
  const out = {};
  const when = {};
  for (const c of contexts) {
    if (c.__typename === "StatusContext") {
      const state = c.state === "SUCCESS" ? "success" : c.state === "PENDING" || c.state === "EXPECTED" ? "pending" : "failure";
      out[c.context] = { state };
      continue;
    }
    const started = c.startedAt ?? "￿";
    if (when[c.name] && when[c.name] > started) continue;
    when[c.name] = started;
    const state = c.status !== "COMPLETED" ? "pending" : PASSED.has(c.conclusion) ? "success" : "failure";
    out[c.name] = { state, runId: c.checkSuite?.workflowRun?.databaseId, url: c.detailsUrl };
  }
  return out;
}

/**
 * What to do next with the pull request at the front of the queue, from a snapshot of it. The
 * snapshot: `state`, `isDraft`, `base`, `labels`, `mergeable`, `behind` (commits of `develop` it
 * lacks), `autoMerge`, `checks` (from `checksOf`), and optionally `stackedOn` (a squash-merged pull
 * request whose head the branch still carries), `baselines` (the `*-baseline.json` it changes),
 * `headCommit` (`{ parents, message }`) and `e2eScope`; `retried` says the failed checks already had
 * their second try on this commit, `widened` that its `e2e` run was already started again whole.
 */
export function decide(pr, { required, retried = false, widened = false }) {
  const failed = required.filter((name) => pr.checks[name]?.state === "failure");
  return (
    whyLeave(pr, failed) ??
    bringUpToDate(pr) ??
    judgeChecks(pr, failed, retried) ??
    wholeSuite(pr, widened) ??
    (pr.autoMerge ? { do: "wait", green: required.every((n) => pr.checks[n]?.state === "success") } : { do: "arm" })
  );
}

const named = (names) => names.map((n) => `\`${n}\``).join(", ");

/** Whether it has left the queue or has to: merged, closed, unlabelled, a draft, another base, a policy failure. */
function whyLeave(pr, failed) {
  if (pr.state === "MERGED") return { do: "done" };
  if (pr.state === "CLOSED") return { do: "drop", reason: "it was closed" };
  if (!pr.labels.includes(LABEL)) return { do: "drop", reason: `it is no longer labelled \`${LABEL}\`` };
  if (pr.isDraft) return { do: "eject", reason: "it is a draft" };
  if (pr.base !== BASE) return { do: "eject", reason: `it targets \`${pr.base}\`, and the queue merges into \`${BASE}\`` };
  /* A policy failure is the title or the linked issue, which no update from develop changes: out
     before a conflict is resolved or a CI run is spent on it. */
  const policy = failed.filter((name) => NO_RETRY.has(name));
  if (policy.length > 0) return { do: "eject", reason: `${named(policy)} failed`, failed: policy };
  return null;
}

/** What the branch needs before its checks mean anything: a rebase, a resolution, an update, a retake. */
function bringUpToDate(pr) {
  /* Before the conflict: merging develop into a branch that still carries a squashed pull request's
     commits conflicts wherever they went, and a rebase of its own commits does not. */
  if (pr.stackedOn) return { do: "rebase", onto: pr.stackedOn };
  if (pr.mergeable === "CONFLICTING") return { do: "conflict" };
  if (pr.behind > 0) return { do: "update" };
  /* Retaken on this develop before any check is judged: the retake is a new commit and a new run. */
  if (pr.baselines?.length > 0 && !baselineRetaken(pr.headCommit)) return { do: "baseline", files: pr.baselines };
  return null;
}

/** A required check that failed: re-run once, then out. */
function judgeChecks(pr, failed, retried) {
  if (failed.length === 0) return null;
  const runs = [...new Set(failed.map((name) => pr.checks[name].runId))];
  if (retried || runs.some((id) => !id)) return { do: "eject", reason: `${named(failed)} failed`, failed };
  return { do: "retry", runs };
}

/** The selection's green is not the one to land on: auto-merge off until the whole suite has run. */
function wholeSuite(pr, widened) {
  if (!pr.e2eScope || pr.e2eScope === "full") return null;
  if (pr.autoMerge) return { do: "disarm" };
  const run = pr.checks.e2e?.runId;
  if (widened || pr.checks.e2e?.state !== "success" || !run) return { do: "wait", green: false };
  return { do: "widen", run };
}

/* ── GitHub ─────────────────────────────────────────────────────────────────────────────────── */

function gh(args, { input, quiet = false } = {}) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", quiet ? "pipe" : "inherit"] });
}
const ghJson = (args) => JSON.parse(gh(args));
const git = (args, opts = {}) => execFileSync("git", args, { encoding: "utf8", ...opts }).trim();

const PR_FIELDS = `
  number title isDraft state baseRefName headRefName headRefOid isCrossRepository mergeable
  autoMergeRequest { enabledAt }
  labels(first: 30) { nodes { name } }
  timelineItems(itemTypes: [LABELED_EVENT], last: 30) { nodes { ... on LabeledEvent { createdAt label { name } } } }
  closingIssuesReferences(first: 5) { nodes { number labels(first: 30) { nodes { name } } } }
  files(first: 100) { nodes { path } }
  commits(last: 1) { nodes { commit { message parents(first: 2) { totalCount }
    statusCheckRollup { contexts(first: 100) { nodes {
    __typename
    ... on CheckRun { name status conclusion startedAt detailsUrl checkSuite { workflowRun { databaseId } } }
    ... on StatusContext { context state }
  } } } } } }`;

function repo() {
  const { owner, name } = ghJson(["repo", "view", "--json", "owner,name"]);
  return { owner: owner.login, name };
}

function listQueue(r) {
  const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, labels: ["${LABEL}"], first: 50) { nodes { ${PR_FIELDS} } } } }`;
  const data = ghJson(["api", "graphql", "-f", `query=${query}`, "-F", `owner=${r.owner}`, "-F", `name=${r.name}`]);
  return order(data.data.repository.pullRequests.nodes);
}

function fetchPr(r, number) {
  const query = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { ${PR_FIELDS} } } }`;
  const raw = ghJson([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-F",
    `owner=${r.owner}`,
    "-F",
    `name=${r.name}`,
    "-F",
    `number=${number}`,
  ]).data.repository.pullRequest;
  const compare =
    raw.state === "OPEN"
      ? ghJson(["api", `repos/${r.owner}/${r.name}/compare/${BASE}...${raw.headRefOid}`, "--jq", "{behind_by}"])
      : { behind_by: 0 };
  const head = raw.commits.nodes[0]?.commit;
  const contexts = head?.statusCheckRollup?.contexts.nodes ?? [];
  return {
    raw,
    number: raw.number,
    title: raw.title,
    state: raw.state,
    isDraft: raw.isDraft,
    base: raw.baseRefName,
    head: raw.headRefName,
    headSha: raw.headRefOid,
    labels: raw.labels.nodes.map((l) => l.name),
    mergeable: raw.mergeable,
    behind: compare.behind_by,
    autoMerge: Boolean(raw.autoMergeRequest),
    checks: checksOf(contexts),
    e2eScope: e2eScope(contexts),
    baselines: filesOf(raw).filter((f) => BASELINE.test(f)),
    headCommit: head ? { parents: head.parents.totalCount, message: head.message } : null,
    /* Only a branch behind develop can be carrying a pull request that has since landed. */
    stackedOn: raw.state === "OPEN" && compare.behind_by > 0 ? stackedOn(r, raw) : null,
  };
}

/**
 * The last pull request, other than this one, whose head commit is on this branch and that has
 * merged — from the branch's commits, oldest first, each with the pull requests it belongs to.
 */
export function mergedHeadOn(commits, number) {
  let found = null;
  for (const { commit } of commits) {
    for (const p of commit.associatedPullRequests?.nodes ?? []) {
      if (p.number !== number && p.state === "MERGED" && p.headRefOid === commit.oid)
        found = { number: p.number, head: commit.oid };
    }
  }
  return found;
}

/**
 * The pull request this branch was stacked on, when it landed as a squash: its head is on the branch
 * and not on `develop`, so the branch still carries commits `develop` has only as one squash.
 */
function stackedOn(r, raw) {
  const query = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { commits(last: 100) { nodes { commit { oid
      associatedPullRequests(first: 10) { nodes { number state headRefOid } } } } } } } }`;
  const commits = ghJson([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-F",
    `owner=${r.owner}`,
    "-F",
    `name=${r.name}`,
    "-F",
    `number=${raw.number}`,
  ]).data.repository.pullRequest.commits.nodes;
  const found = mergedHeadOn(commits, raw.number);
  if (!found) return null;
  const { ahead_by } = ghJson(["api", `repos/${r.owner}/${r.name}/compare/${BASE}...${found.head}`, "--jq", "{ahead_by}"]);
  return ahead_by > 0 ? found : null;
}

function requiredChecks(r) {
  const rules = ghJson(["api", `repos/${r.owner}/${r.name}/rules/branches/${BASE}`]);
  const rule = rules.find((x) => x.type === "required_status_checks");
  if (!rule) return { names: [], strict: false };
  return {
    names: rule.parameters.required_status_checks.map((c) => c.context),
    strict: rule.parameters.strict_required_status_checks_policy,
  };
}

/** GitHub's *update branch*: `develop` merged into the pull request's branch, on GitHub. */
function updateBranch(r, pr) {
  try {
    gh(
      [
        "api",
        "-X",
        "PUT",
        `repos/${r.owner}/${r.name}/pulls/${pr.number}/update-branch`,
        "-f",
        `expected_head_sha=${pr.headSha}`,
      ],
      { quiet: true },
    );
    return "updated";
  } catch (e) {
    const text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    if (/conflict/i.test(text)) return "conflict";
    if (/expected head sha/i.test(text)) return "moved";
    throw e;
  }
}

/**
 * Re-runs a workflow run's failed jobs, or all of them; false when the run has not finished, which
 * GitHub refuses.
 */
function rerun(id, { failed = true } = {}) {
  try {
    gh(["run", "rerun", String(id), ...(failed ? ["--failed"] : [])], { quiet: true });
    return true;
  } catch (e) {
    if (/already running|cannot be rerun/i.test(`${e.stdout ?? ""}${e.stderr ?? ""}`)) return false;
    throw e;
  }
}

/**
 * Brings the branch up to date; `"conflict"` only when it truly conflicts. GitHub can merge the pull
 * request between the snapshot and the update: it is then one behind its own squash, and the
 * refused update is not a conflict.
 */
function update(r, pr) {
  const result = updateBranch(r, pr);
  if (result === "conflict" && fetchPr(r, pr.number).state === "MERGED") return "merged";
  return result;
}

/**
 * Re-runs the failed checks' runs; true when GitHub took every one. A required check can fail while
 * another job of its workflow run is still going (e2e's verdict before its report), and GitHub
 * re-runs only a finished run: that one is tried again on the next poll, not counted as the retry.
 */
function retry(number, runs) {
  say(`#${number}: a check failed, running it again (${runs.join(", ")})`);
  const running = runs.filter((id) => !rerun(id));
  if (running.length === 0) return true;
  say(`#${number}: run ${running.join(", ")} is still going; trying again when it ends`);
  return false;
}

/** Auto-merge off; GitHub answers an error when it was not on, which is the same outcome. */
function disableAuto(number) {
  try {
    gh(["pr", "merge", String(number), "--disable-auto"], { quiet: true });
  } catch {
    /* it was off */
  }
}

function eject(number, reason, failed = [], checks = {}) {
  const lines = failed.map((name) => `- \`${name}\`${checks[name]?.url ? `: ${checks[name].url}` : ""}`);
  const body = [
    `Left the merge queue: ${reason}.`,
    ...(lines.length ? ["", ...lines] : []),
    "",
    `Fix it and label the pull request \`${LABEL}\` again.`,
  ].join("\n");
  disableAuto(number);
  gh(["pr", "edit", String(number), "--remove-label", LABEL], { quiet: true });
  gh(["pr", "comment", String(number), "--body-file", "-"], { input: body, quiet: true });
}

/* ── The conflict ───────────────────────────────────────────────────────────────────────────── */

function stateDir() {
  const dir = path.resolve(git(["rev-parse", "--git-common-dir"]), "merge-queue");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A fresh worktree of the pull request's head, under the git directory, with `develop` fetched. */
function worktreeFor(pr) {
  const dir = path.join(stateDir(), `pr-${pr.number}`);
  if (fs.existsSync(dir)) git(["worktree", "remove", "--force", dir]);
  git(["fetch", "--quiet", "origin", BASE, `+refs/pull/${pr.number}/head:refs/merge-queue/pr-${pr.number}`]);
  git(["worktree", "add", "--quiet", "--detach", dir, `refs/merge-queue/pr-${pr.number}`]);
  return dir;
}

const unmerged = (dir) => git(["-C", dir, "diff", "--name-only", "--diff-filter=U"]).split("\n").filter(Boolean);

/** What the skill is handed when the queue stops: `kind` is `merge`, `rebase` or `baseline`. */
function stop(pr, dir, kind, extra) {
  const tiers = pr.raw.closingIssuesReferences.nodes
    .flatMap((i) => i.labels.nodes.map((l) => l.name))
    .filter((n) => n.startsWith("agent:"));
  return {
    kind,
    pr: pr.number,
    title: pr.title,
    branch: pr.head,
    crossRepository: pr.raw.isCrossRepository,
    tier: tiers[0] ?? null,
    worktree: dir,
    ...extra,
  };
}

/** The merge of `develop` into the pull request, left half done in its own worktree. */
function prepareConflict(pr) {
  const dir = worktreeFor(pr);
  try {
    git(["-C", dir, "merge", "--no-ff", "--no-edit", `origin/${BASE}`], { stdio: "pipe" });
  } catch {
    /* the conflict this is for */
  }
  return stop(pr, dir, "merge", { conflicts: unmerged(dir), push: `git -C ${dir} push origin HEAD:refs/heads/${pr.head}` });
}

/**
 * A stacked branch whose lower pull request landed as a squash: its own commits — those after that
 * pull request's head — rebased onto `develop` and force-pushed with a lease on the head the queue
 * read, so a push made meanwhile is refused rather than lost. A conflict is left mid-rebase in the
 * worktree for the skill; otherwise `null`, or `"empty"` when nothing of the branch's own is left.
 */
function rebaseStacked(pr, onto) {
  const dir = worktreeFor(pr);
  const lease = `--force-with-lease=refs/heads/${pr.head}:${pr.headSha}`;
  const push = `git -C ${dir} push ${lease} origin HEAD:refs/heads/${pr.head}`;
  try {
    git(["-C", dir, "rebase", "--onto", `origin/${BASE}`, onto.head], { stdio: "pipe" });
  } catch {
    return stop(pr, dir, "rebase", { onto, conflicts: unmerged(dir), push });
  }
  if (git(["-C", dir, "rev-list", "--count", `origin/${BASE}..HEAD`]) === "0") {
    git(["worktree", "remove", "--force", dir]);
    return "empty";
  }
  const sha = git(["-C", dir, "rev-parse", "HEAD"]);
  git(["-C", dir, "push", "--quiet", lease, "origin", `HEAD:refs/heads/${pr.head}`], { stdio: "pipe" });
  git(["worktree", "remove", "--force", dir]);
  const body = [
    `The merge queue rebased this branch onto \`${BASE}\`: it still carried #${onto.number}'s commits, which landed as a squash, and merging \`${BASE}\` in would have conflicted wherever they went.`,
    "",
    `Its own commits were replayed with \`git rebase --onto origin/${BASE} ${onto.head.slice(0, 7)}\` and force-pushed with a lease: \`${pr.headSha.slice(0, 7)}\` → \`${sha.slice(0, 7)}\`. Fetch before you push to it again.`,
  ].join("\n");
  gh(["pr", "comment", String(pr.number), "--body-file", "-"], { input: body, quiet: true });
  return null;
}

/** The branch at the front, up to date and carrying a baseline: the worktree to retake it in. */
function prepareBaseline(pr, files) {
  const dir = worktreeFor(pr);
  return stop(pr, dir, "baseline", {
    baselines: files.map((file) => ({ file, retake: BASELINES[file] ?? null })),
    commit: `chore: retake the ${files.map((f) => path.basename(f, ".json")).join(" and ")} on ${BASE}`,
    push: `git -C ${dir} push origin HEAD:refs/heads/${pr.head}`,
  });
}

/* ── The loop ───────────────────────────────────────────────────────────────────────────────── */

const say = (msg) => console.error(`[merge-queue ${new Date().toISOString().slice(11, 19)}] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The end of `work`: `null` when the pull request merged or left, the stop's description otherwise. */
const end = (stopped = null) => ({ end: stopped });

function leave(number, why) {
  say(`#${number} out: ${why}`);
  eject(number, why);
  return end();
}

async function stepRebase(pr, { onto }) {
  const number = pr.number;
  if (pr.raw.isCrossRepository) {
    return leave(
      number,
      `it still carries #${onto.number}'s commits, which landed as a squash, and the queue cannot push to a fork: rebase it with \`git rebase --onto origin/${BASE} ${onto.head.slice(0, 7)}\``,
    );
  }
  say(`#${number} carries #${onto.number}, which landed as a squash: rebasing its own commits onto ${BASE}`);
  if (pr.autoMerge) disableAuto(number);
  const result = rebaseStacked(pr, onto);
  if (result === "empty")
    return leave(number, `once #${onto.number}'s commits are taken off, nothing of its own is left on the branch`);
  if (result) {
    say(`#${number}: the rebase onto ${BASE} conflicts`);
    return end(result);
  }
  await sleep(5_000);
  return null;
}

async function stepWait(pr, next, st) {
  if (next.green) {
    st.greenSince ||= Date.now();
    if (Date.now() - st.greenSince > BLOCKED_MS) {
      say(`#${pr.number}: green but not merging`);
      eject(
        pr.number,
        "its checks passed but GitHub would not merge it — an unresolved review thread or a requested change holds it",
      );
      return end();
    }
  }
  await sleep(POLL_MS);
  return null;
}

/** One step for each of `decide`'s answers; a step that ends the work returns `end(…)`. */
const STEPS = {
  done: (pr) => {
    say(`#${pr.number} merged: ${pr.title}`);
    return end();
  },
  drop: (pr, next) => {
    say(`#${pr.number} left: ${next.reason}`);
    return end();
  },
  eject: (pr, next) => {
    say(`#${pr.number} out: ${next.reason}`);
    eject(pr.number, next.reason, next.failed, pr.checks);
    return end();
  },
  rebase: stepRebase,
  conflict: (pr) => {
    say(`#${pr.number} conflicts with ${BASE}`);
    return end(prepareConflict(pr));
  },
  baseline: (pr, next) => {
    say(`#${pr.number} changes ${next.files.join(", ")}: stopping for it to be retaken on this ${BASE}`);
    if (pr.autoMerge) disableAuto(pr.number);
    return end(prepareBaseline(pr, next.files));
  },
  update: async (pr, _next, st) => {
    say(`#${pr.number} is ${pr.behind} behind ${BASE}: updating the branch`);
    if (pr.autoMerge) disableAuto(pr.number);
    if (update(st.r, pr) === "conflict") return end(prepareConflict(pr));
    await sleep(5_000);
    return null;
  },
  retry: async (pr, next, st) => {
    st.retried = retry(pr.number, next.runs);
    await sleep(POLL_MS);
    return null;
  },
  disarm: (pr) => {
    say(`#${pr.number}: auto-merge off until the whole browser suite has run`);
    disableAuto(pr.number);
    return null;
  },
  widen: async (pr, next, st) => {
    say(`#${pr.number}: e2e ran the selection; running the whole suite on ${pr.headSha.slice(0, 7)} (run ${next.run})`);
    st.widened = rerun(next.run, { failed: false });
    await sleep(POLL_MS);
    return null;
  },
  arm: async (pr) => {
    const method = MERGE_COMMIT.test(pr.head) ? "--merge" : "--squash";
    say(`#${pr.number}: auto-merge on at ${pr.headSha.slice(0, 7)} (${method.slice(2)})`);
    gh(["pr", "merge", String(pr.number), "--auto", method, "--match-head-commit", pr.headSha], { quiet: true });
    await sleep(5_000);
    return null;
  },
  wait: stepWait,
};

/** Works one pull request until it merges or leaves; returns what it stopped on, if it stopped. */
async function work(r, required, number) {
  const began = Date.now();
  /* What the queue has done to this commit: reset when the branch moves. */
  const st = { r, sha: "", retried: false, widened: false, greenSince: 0 };
  for (;;) {
    const pr = fetchPr(r, number);
    if (pr.headSha !== st.sha) Object.assign(st, { sha: pr.headSha, retried: false, widened: false, greenSince: 0 });
    const next = decide(pr, { required, retried: st.retried, widened: st.widened });
    if (Date.now() - began > TIMEOUT_MS && next.do !== "done") {
      say(`#${number}: an hour without landing, out of the queue`);
      eject(number, "it waited an hour at the front of the queue without landing");
      return null;
    }
    const outcome = await STEPS[next.do](pr, next, st);
    if (outcome) return outcome.end;
  }
}

function takeLock() {
  lock(path.join(stateDir(), "lock"), say);
}

/** The pull request to work next; the rest wait with auto-merge off, and a held gate change says so. */
function takeFront(queue) {
  const [front, ...rest] = landingOrder(queue);
  for (const pr of changesGate(front) ? [] : rest.filter(changesGate)) {
    const files = gateFiles(filesOf(pr)).join(", ");
    say(`#${pr.number} held: it changes the gate (${files}), and lands when nothing else is queued`);
  }
  for (const pr of rest) {
    if (pr.autoMergeRequest) {
      say(`#${pr.number}: auto-merge off until it reaches the front`);
      disableAuto(pr.number);
    }
  }
  say(`#${front.number} at the front, ${rest.length} more queued: ${front.title}`);
  return front;
}

async function run({ watch }) {
  takeLock();
  const r = repo();
  const { names: required, strict } = requiredChecks(r);
  if (!strict) say(`warning: ${BASE}'s ruleset does not require a branch to be up to date; only this queue keeps it so`);
  for (;;) {
    const queue = listQueue(r);
    if (queue.length === 0) {
      if (!watch) {
        say("the queue is empty");
        return 0;
      }
      await sleep(60_000);
      continue;
    }
    const front = takeFront(queue);
    const stopped = await work(r, required, front.number);
    if (stopped) {
      console.log(JSON.stringify(stopped, null, 2));
      return stopped.kind === "baseline" ? 4 : 3;
    }
  }
}

function status() {
  const r = repo();
  const queue = listQueue(r);
  if (queue.length === 0) console.log("the queue is empty");
  landingOrder(queue).forEach((pr, i) => {
    const gate = changesGate(pr) ? ", changes the gate: lands last" : "";
    console.log(
      `${i + 1}. #${pr.number} ${pr.title}  (queued ${queuedAt(pr)}, auto-merge ${pr.autoMergeRequest ? "on" : "off"}${gate})`,
    );
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "status") status();
  else if (cmd === "eject") {
    const [number, ...why] = rest;
    if (!number || why.length === 0) {
      console.error("usage: node scripts/merge-queue.mjs eject <number> <reason>");
      process.exit(2);
    }
    eject(Number(number), why.join(" "));
  } else if (cmd === undefined || cmd === "--watch") process.exit(await run({ watch: cmd === "--watch" }));
  else {
    console.error("usage: node scripts/merge-queue.mjs [--watch] | status | eject <number> <reason>");
    process.exit(2);
  }
}
