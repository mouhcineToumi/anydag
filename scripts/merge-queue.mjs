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
 * The ruleset on `develop` requires a branch to be up to date (`strict_required_status_checks_policy`),
 * so GitHub itself refuses a merge that was not tested on the current `develop`, whoever asks; the
 * queue is what does the updating, in order, so nobody races for it. Auto-merge is turned off on every
 * other queued pull request for the same reason. One runner at a time: a lock in the git directory.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const LABEL = "queue";
const BASE = "develop";
/** A failure here is the pull request's text or target, which a re-run cannot change. */
const NO_RETRY = new Set(["PR title", "PR target", "Linked issue"]);
/** Branches whose pull requests keep their commits (a release or back-merge), as `AGENTS.md` says. */
const MERGE_COMMIT = /^(release|hotfix)\/|^chore\/back-merge/;
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
 * lacks), `autoMerge`, `checks` (from `checksOf`); `retried` says the failed checks already had their
 * second try on this commit.
 */
export function decide(pr, { required, retried = false }) {
  if (pr.state === "MERGED") return { do: "done" };
  if (pr.state === "CLOSED") return { do: "drop", reason: "it was closed" };
  if (!pr.labels.includes(LABEL)) return { do: "drop", reason: `it is no longer labelled \`${LABEL}\`` };
  if (pr.isDraft) return { do: "eject", reason: "it is a draft" };
  if (pr.base !== BASE) return { do: "eject", reason: `it targets \`${pr.base}\`, and the queue merges into \`${BASE}\`` };
  if (pr.mergeable === "CONFLICTING") return { do: "conflict" };
  if (pr.behind > 0) return { do: "update" };
  const failed = required.filter((name) => pr.checks[name]?.state === "failure");
  if (failed.length > 0) {
    const runs = [...new Set(failed.map((name) => pr.checks[name].runId))];
    const final = retried || failed.some((name) => NO_RETRY.has(name)) || runs.some((id) => !id);
    if (final) return { do: "eject", reason: `${failed.map((n) => `\`${n}\``).join(", ")} failed`, failed };
    return { do: "retry", runs };
  }
  if (!pr.autoMerge) return { do: "arm" };
  return { do: "wait", green: required.every((name) => pr.checks[name]?.state === "success") };
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
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
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
    checks: checksOf(raw.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []),
  };
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

/** The merge of `develop` into the pull request, left half done in its own worktree. */
function prepareConflict(pr) {
  const dir = path.join(stateDir(), `pr-${pr.number}`);
  if (fs.existsSync(dir)) git(["worktree", "remove", "--force", dir]);
  git(["fetch", "--quiet", "origin", BASE, `+refs/pull/${pr.number}/head:refs/merge-queue/pr-${pr.number}`]);
  git(["worktree", "add", "--quiet", "--detach", dir, `refs/merge-queue/pr-${pr.number}`]);
  try {
    git(["-C", dir, "merge", "--no-ff", "--no-edit", `origin/${BASE}`], { stdio: "pipe" });
  } catch {
    /* the conflict this is for */
  }
  const conflicts = git(["-C", dir, "diff", "--name-only", "--diff-filter=U"]).split("\n").filter(Boolean);
  const tiers = pr.raw.closingIssuesReferences.nodes
    .flatMap((i) => i.labels.nodes.map((l) => l.name))
    .filter((n) => n.startsWith("agent:"));
  return {
    pr: pr.number,
    title: pr.title,
    branch: pr.head,
    crossRepository: pr.raw.isCrossRepository,
    tier: tiers[0] ?? null,
    worktree: dir,
    conflicts,
    push: `git -C ${dir} push origin HEAD:refs/heads/${pr.head}`,
  };
}

/* ── The loop ───────────────────────────────────────────────────────────────────────────────── */

const say = (msg) => console.error(`[merge-queue ${new Date().toISOString().slice(11, 19)}] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Works one pull request until it merges or leaves; returns the conflict, if it stopped on one. */
async function work(r, required, number) {
  const began = Date.now();
  let sha = "";
  let retried = false;
  let greenSince = 0;
  for (;;) {
    const pr = fetchPr(r, number);
    if (pr.headSha !== sha) {
      sha = pr.headSha;
      retried = false;
      greenSince = 0;
    }
    const next = decide(pr, { required, retried });
    if (Date.now() - began > TIMEOUT_MS && next.do !== "done") {
      say(`#${number}: an hour without landing, out of the queue`);
      eject(number, "it waited an hour at the front of the queue without landing");
      return null;
    }
    switch (next.do) {
      case "done":
        say(`#${number} merged: ${pr.title}`);
        return null;
      case "drop":
        say(`#${number} left: ${next.reason}`);
        return null;
      case "eject":
        say(`#${number} out: ${next.reason}`);
        eject(number, next.reason, next.failed, pr.checks);
        return null;
      case "conflict":
        say(`#${number} conflicts with ${BASE}`);
        return prepareConflict(pr);
      case "update": {
        say(`#${number} is ${pr.behind} behind ${BASE}: updating the branch`);
        if (pr.autoMerge) disableAuto(number);
        const result = updateBranch(r, pr);
        if (result === "conflict") return prepareConflict(pr);
        await sleep(5_000);
        break;
      }
      case "retry":
        say(`#${number}: a check failed, running it again (${next.runs.join(", ")})`);
        for (const id of next.runs) gh(["run", "rerun", String(id), "--failed"], { quiet: true });
        retried = true;
        await sleep(POLL_MS);
        break;
      case "arm": {
        const method = MERGE_COMMIT.test(pr.head) ? "--merge" : "--squash";
        say(`#${number}: auto-merge on at ${sha.slice(0, 7)} (${method.slice(2)})`);
        gh(["pr", "merge", String(number), "--auto", method, "--match-head-commit", sha], { quiet: true });
        await sleep(5_000);
        break;
      }
      case "wait":
        if (next.green) {
          greenSince ||= Date.now();
          if (Date.now() - greenSince > BLOCKED_MS) {
            say(`#${number}: green but not merging`);
            eject(
              number,
              "its checks passed but GitHub would not merge it — an unresolved review thread or a requested change holds it",
            );
            return null;
          }
        }
        await sleep(POLL_MS);
        break;
    }
  }
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

async function run({ watch }) {
  lock();
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
    const [front, ...rest] = queue;
    for (const pr of rest) {
      if (pr.autoMergeRequest) {
        say(`#${pr.number}: auto-merge off until it reaches the front`);
        disableAuto(pr.number);
      }
    }
    say(`#${front.number} at the front (${rest.length} behind): ${front.title}`);
    const conflict = await work(r, required, front.number);
    if (conflict) {
      console.log(JSON.stringify(conflict, null, 2));
      return 3;
    }
  }
}

function status() {
  const r = repo();
  const queue = listQueue(r);
  if (queue.length === 0) console.log("the queue is empty");
  queue.forEach((pr, i) => {
    console.log(
      `${i + 1}. #${pr.number} ${pr.title}  (queued ${queuedAt(pr)}, auto-merge ${pr.autoMergeRequest ? "on" : "off"})`,
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
