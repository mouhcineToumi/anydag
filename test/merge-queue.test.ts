import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import * as queue from "../scripts/merge-queue.mjs";

const { BASELINES, baselineRetaken, checksOf, decide, e2eScope, gateFiles, landingOrder, mergedHeadOn, order, queuedAt } = queue;

/**
 * **The merge queue's decisions** (#503): which pull request goes first, what its checks say, and
 * what to do next with the one at the front. The GitHub calls around them are not tested here; these
 * are the parts whose mistakes are silent — a pull request merged out of turn, a policy failure
 * re-run for ever, a red check read as green — and, since the 0.9.0 batch (#560), a gate change
 * landed ahead of the pull requests it would eject, a stacked branch merged into a dozen conflicts,
 * and a pull request landed on the selection's green.
 */
const required = ["CI passed", "e2e", "PR title", "PR target", "Linked issue"];
const green = Object.fromEntries(required.map((n) => [n, { state: "success", runId: 1 }]));

const front = (over: Record<string, unknown> = {}) => ({
  state: "OPEN",
  isDraft: false,
  base: "develop",
  labels: ["queue"],
  mergeable: "MERGEABLE",
  behind: 0,
  autoMerge: true,
  checks: green,
  ...over,
});

const labelled = (number: number, ...times: string[]) => ({
  number,
  timelineItems: { nodes: times.map((createdAt) => ({ createdAt, label: { name: "queue" } })) },
});

describe("order", () => {
  it("puts the oldest label first, then the lower number", () => {
    const prs = [labelled(9, "2026-11-18T10:00:00Z"), labelled(4, "2026-11-18T11:00:00Z"), labelled(7, "2026-11-18T10:00:00Z")];
    expect(order(prs).map((p: { number: number }) => p.number)).toEqual([7, 9, 4]);
  });

  it("counts from the last time the label went on, so a pull request labelled again goes to the back", () => {
    const again = labelled(3, "2026-11-18T09:00:00Z", "2026-11-18T12:00:00Z");
    expect(queuedAt(again)).toBe("2026-11-18T12:00:00Z");
    expect(order([again, labelled(5, "2026-11-18T10:00:00Z")]).map((p: { number: number }) => p.number)).toEqual([5, 3]);
  });

  it("ignores other labels' events", () => {
    const pr = {
      number: 1,
      timelineItems: {
        nodes: [
          { createdAt: "2026-11-18T09:00:00Z", label: { name: "queue" } },
          { createdAt: "2026-11-18T13:00:00Z", label: { name: "size: S" } },
        ],
      },
    };
    expect(queuedAt(pr)).toBe("2026-11-18T09:00:00Z");
  });
});

describe("checksOf", () => {
  it("reads a check run by its status and conclusion", () => {
    const checks = checksOf([
      { __typename: "CheckRun", name: "a", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "1" },
      { __typename: "CheckRun", name: "b", status: "COMPLETED", conclusion: "SKIPPED", startedAt: "1" },
      { __typename: "CheckRun", name: "c", status: "IN_PROGRESS", conclusion: null, startedAt: "1" },
      {
        __typename: "CheckRun",
        name: "d",
        status: "COMPLETED",
        conclusion: "CANCELLED",
        startedAt: "1",
        checkSuite: { workflowRun: { databaseId: 42 } },
      },
      { __typename: "StatusContext", context: "e", state: "PENDING" },
      { __typename: "StatusContext", context: "f", state: "ERROR" },
    ]);
    expect(Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, (v as { state: string }).state]))).toEqual({
      a: "success",
      b: "success",
      c: "pending",
      d: "failure",
      e: "pending",
      f: "failure",
    });
    expect(checks.d.runId).toBe(42);
  });

  it("answers with the latest run of a check, so a re-run that passed is green", () => {
    const checks = checksOf([
      { __typename: "CheckRun", name: "e2e", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-11-18T10:05:00Z" },
      { __typename: "CheckRun", name: "e2e", status: "COMPLETED", conclusion: "FAILURE", startedAt: "2026-11-18T10:00:00Z" },
    ]);
    expect(checks.e2e.state).toBe("success");
  });

  it("treats a re-run that has not started as the latest", () => {
    const checks = checksOf([
      { __typename: "CheckRun", name: "e2e", status: "COMPLETED", conclusion: "FAILURE", startedAt: "2026-11-18T10:00:00Z" },
      { __typename: "CheckRun", name: "e2e", status: "QUEUED", conclusion: null, startedAt: null },
    ]);
    expect(checks.e2e.state).toBe("pending");
  });
});

describe("decide", () => {
  it("is done once merged, and lets go of one closed or unlabelled", () => {
    expect(decide(front({ state: "MERGED" }), { required }).do).toBe("done");
    expect(decide(front({ state: "CLOSED" }), { required }).do).toBe("drop");
    expect(decide(front({ labels: [] }), { required }).do).toBe("drop");
  });

  it("takes out a draft and a pull request into another branch", () => {
    expect(decide(front({ isDraft: true }), { required }).do).toBe("eject");
    expect(decide(front({ base: "main" }), { required })).toMatchObject({
      do: "eject",
      reason: expect.stringContaining("`main`"),
    });
  });

  it("stops on a conflict before trying to update", () => {
    expect(decide(front({ mergeable: "CONFLICTING", behind: 3 }), { required }).do).toBe("conflict");
  });

  it("updates a branch that is behind, even with every check green", () => {
    expect(decide(front({ behind: 1 }), { required }).do).toBe("update");
  });

  it("re-runs a failed check once, then takes the pull request out", () => {
    const checks = { ...green, e2e: { state: "failure", runId: 7, url: "u" } };
    expect(decide(front({ checks }), { required })).toEqual({ do: "retry", runs: [7] });
    expect(decide(front({ checks }), { required, retried: true })).toMatchObject({ do: "eject", failed: ["e2e"] });
  });

  it("re-runs each failed workflow run once, not each check", () => {
    const checks = { ...green, "CI passed": { state: "failure", runId: 7 }, e2e: { state: "failure", runId: 7 } };
    expect(decide(front({ checks }), { required })).toEqual({ do: "retry", runs: [7] });
  });

  it("does not re-run a policy check: the title or the linked issue has to change", () => {
    const checks = { ...green, "Linked issue": { state: "failure", runId: 9 } };
    expect(decide(front({ checks }), { required })).toMatchObject({ do: "eject", failed: ["Linked issue"] });
  });

  it("takes out a policy failure before resolving a conflict or updating, which cannot fix it", () => {
    const checks = { ...green, "PR title": { state: "failure", runId: 9 } };
    expect(decide(front({ checks, behind: 4 }), { required })).toMatchObject({ do: "eject", failed: ["PR title"] });
    expect(decide(front({ checks, mergeable: "CONFLICTING" }), { required })).toMatchObject({
      do: "eject",
      failed: ["PR title"],
    });
  });

  it("updates before judging any other failure, which a newer develop may fix", () => {
    const checks = { ...green, e2e: { state: "failure", runId: 7 } };
    expect(decide(front({ checks, behind: 2 }), { required }).do).toBe("update");
  });

  it("takes out a failure it cannot re-run, a status with no workflow run", () => {
    const checks = { ...green, e2e: { state: "failure" } };
    expect(decide(front({ checks }), { required }).do).toBe("eject");
  });

  it("ignores a failed check that is not required", () => {
    const checks = { ...green, CodeQL: { state: "failure", runId: 3 } };
    expect(decide(front({ checks }), { required })).toEqual({ do: "wait", green: true });
  });

  it("turns auto-merge on once up to date, and waits while a required check is missing or running", () => {
    expect(decide(front({ autoMerge: false, checks: {} }), { required }).do).toBe("arm");
    expect(decide(front({ checks: {} }), { required })).toEqual({ do: "wait", green: false });
    expect(decide(front({ checks: { ...green, e2e: { state: "pending" } } }), { required })).toEqual({
      do: "wait",
      green: false,
    });
  });
});

const withFiles = (number: number, time: string, ...paths: string[]) => ({
  ...labelled(number, time),
  files: { nodes: paths.map((path) => ({ path })) },
});
const numbers = (prs: { number: number }[]) => prs.map((p) => p.number);

describe("the gate goes last", () => {
  it("knows a change to the fast tier's list or to a baseline", () => {
    expect(
      gateFiles(["scripts/checks.sh", "scripts/complexity-baseline.json", "src/a.ts", "scripts/check-complexity.mjs"]),
    ).toEqual(["scripts/checks.sh", "scripts/complexity-baseline.json"]);
  });

  it("holds a pull request that changes the gate behind every one that does not", () => {
    const queue = order([
      withFiles(546, "2026-11-18T09:00:00Z", "scripts/checks.sh", "scripts/complexity-baseline.json"),
      withFiles(533, "2026-11-18T10:00:00Z", "src/quiz/parse.ts"),
      withFiles(547, "2026-11-18T11:00:00Z", "src/ui/quiz/Quiz.tsx"),
    ]);
    expect(numbers(landingOrder(queue))).toEqual([533, 547, 546]);
  });

  it("works one when it is all that is left, the oldest first", () => {
    const queue = order([
      withFiles(8, "2026-11-18T11:00:00Z", "scripts/checks.sh"),
      withFiles(6, "2026-11-18T10:00:00Z", "scripts/complexity-baseline.json"),
    ]);
    expect(numbers(landingOrder(queue))).toEqual([6, 8]);
  });

  it("knows how to retake every baseline the repository has", () => {
    expect(Object.keys(BASELINES)).toContain("scripts/complexity-baseline.json");
  });
});

describe("a baseline is retaken on the develop it lands on", () => {
  const carrying = (headCommit: unknown) => front({ baselines: ["scripts/complexity-baseline.json"], headCommit });

  it("stops for the retake once the branch is up to date, and not before", () => {
    const merge = { parents: 2, message: "Merge branch 'develop' into chore/546-gate" };
    expect(decide({ ...carrying(merge), behind: 2 }, { required }).do).toBe("update");
    expect(decide(carrying(merge), { required })).toEqual({ do: "baseline", files: ["scripts/complexity-baseline.json"] });
  });

  it("goes on once the last commit is the retake", () => {
    const retake = { parents: 1, message: "chore: retake the complexity-baseline on develop\n\nbody" };
    expect(baselineRetaken(retake)).toBe(true);
    expect(decide(carrying(retake), { required })).toEqual({ do: "wait", green: true });
  });

  it("does not count a retake that a merge came after, or another commit", () => {
    expect(baselineRetaken({ parents: 2, message: "chore: retake the complexity-baseline on develop" })).toBe(false);
    expect(baselineRetaken({ parents: 1, message: "feat: a new check" })).toBe(false);
    expect(baselineRetaken(null)).toBe(false);
  });
});

describe("a stacked branch is rebased", () => {
  const commit = (oid: string, ...prs: { number: number; state: string; headRefOid: string }[]) => ({
    commit: { oid, associatedPullRequests: { nodes: prs } },
  });

  it("finds the last merged pull request whose head the branch carries", () => {
    const commits = [
      commit("a1", { number: 533, state: "MERGED", headRefOid: "a2" }, { number: 540, state: "OPEN", headRefOid: "b2" }),
      commit("a2", { number: 533, state: "MERGED", headRefOid: "a2" }, { number: 540, state: "OPEN", headRefOid: "b2" }),
      commit("b1", { number: 540, state: "OPEN", headRefOid: "b2" }),
      commit("b2", { number: 540, state: "OPEN", headRefOid: "b2" }),
    ];
    expect(mergedHeadOn(commits, 540)).toEqual({ number: 533, head: "a2" });
  });

  it("ignores its own head, an open pull request below it and a commit that was not a head", () => {
    const commits = [
      commit("a1", { number: 533, state: "OPEN", headRefOid: "a1" }),
      commit("b1", { number: 533, state: "MERGED", headRefOid: "a9" }),
      commit("b2", { number: 540, state: "MERGED", headRefOid: "b2" }),
    ];
    expect(mergedHeadOn(commits, 540)).toBeNull();
  });

  it("rebases before it would update or stop on the conflict the update makes", () => {
    const onto = { number: 533, head: "a2" };
    expect(decide(front({ stackedOn: onto, behind: 3, mergeable: "CONFLICTING" }), { required })).toEqual({
      do: "rebase",
      onto,
    });
  });

  it("still takes out a policy failure first", () => {
    const checks = { ...green, "PR title": { state: "failure", runId: 9 } };
    expect(decide(front({ checks, stackedOn: { number: 533, head: "a2" } }), { required }).do).toBe("eject");
  });
});

describe("the commit that lands ran the whole browser suite", () => {
  const shard = (name: string, startedAt: string | null) => ({ __typename: "CheckRun", name, startedAt });

  it("reads the scope from the latest run's shards, and none when no shard ran", () => {
    expect(e2eScope([shard("shard 1/3 (changed)", "2026-11-18T10:00:00Z")])).toBe("changed");
    expect(
      e2eScope([
        shard("shard 1/3 (changed)", "2026-11-18T10:00:00Z"),
        shard("shard 2/4 (full)", "2026-11-18T10:09:00Z"),
        shard("fast tier", "2026-11-18T10:10:00Z"),
      ]),
    ).toBe("full");
    expect(e2eScope([shard("shard 1/3 (changed)", "2026-11-18T10:00:00Z"), shard("shard 1/4 (full)", null)])).toBe("full");
    expect(e2eScope([shard("plan", "2026-11-18T10:00:00Z")])).toBeNull();
  });

  it("runs the whole suite again on a front pull request whose green was the selection", () => {
    expect(decide(front({ autoMerge: false, e2eScope: "changed" }), { required })).toEqual({ do: "widen", run: 1 });
    expect(decide(front({ autoMerge: false, e2eScope: "changed" }), { required, widened: true })).toEqual({
      do: "wait",
      green: false,
    });
  });

  it("waits for a selection still running, and never arms on it", () => {
    const checks = { ...green, e2e: { state: "pending", runId: 1 } };
    expect(decide(front({ autoMerge: false, e2eScope: "changed", checks }), { required })).toEqual({
      do: "wait",
      green: false,
    });
    expect(decide(front({ autoMerge: true, e2eScope: "changed" }), { required }).do).toBe("disarm");
  });

  it("arms on the whole suite, and on a change the browser suite cannot see", () => {
    expect(decide(front({ autoMerge: false, e2eScope: "full" }), { required }).do).toBe("arm");
    expect(decide(front({ autoMerge: false, e2eScope: null }), { required }).do).toBe("arm");
  });

  it("re-runs a failed selection as any failure, before widening it", () => {
    const checks = { ...green, e2e: { state: "failure", runId: 7 } };
    expect(decide(front({ e2eScope: "changed", checks }), { required })).toEqual({ do: "retry", runs: [7] });
  });
});
