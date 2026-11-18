import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import { checksOf, decide, order, queuedAt } from "../scripts/merge-queue.mjs";

/**
 * **The merge queue's decisions** (#503): which pull request goes first, what its checks say, and
 * what to do next with the one at the front. The GitHub calls around them are not tested here; these
 * are the parts whose mistakes are silent — a pull request merged out of turn, a policy failure
 * re-run for ever, a red check read as green.
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
