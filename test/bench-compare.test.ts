import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import * as benchCompare from "../scripts/bench-compare.mjs";
// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import * as benchPlanModule from "../scripts/bench-plan.mjs";

const { compare, markdown, median, rowsOf } = benchCompare;
const { benchKind, benchPlan } = benchPlanModule;

type Row = { metric: string; base: number[]; head: number[] };
type Verdict = Row & { verdict: string; why?: string; ratio?: number; delta?: number };

const one = (base: number[], head: number[], opts?: object): Verdict =>
  (compare([{ metric: "edit.1000.note.save", base, head }], opts) as Verdict[])[0];

/**
 * **The pull request's bench** (#527) compares a change with its base on one runner, and goes red
 * only on a large regression of a stable metric. A check that fails on noise is one nobody reads, and
 * one that misses a 300 ms delay is one nobody needs, so both sides of the line are held here, where
 * no browser is needed to hold them.
 */
describe("compare", () => {
  it("flags a 300 ms delay on the note's save", () => {
    const v = one([258, 260, 257], [561, 559, 566]);
    expect(v.verdict).toBe("slower");
    expect(v.ratio).toBeCloseTo(561 / 258, 5);
    expect(v.delta).toBe(303);
  });

  it("does not flag the same build measured twice", () => {
    expect(one([258, 260, 257], [262, 257, 259]).verdict).toBe("same");
    expect(one([104, 110, 98], [112, 99, 106]).verdict).toBe("same");
  });

  it("does not flag a large ratio of a few milliseconds", () => {
    /* 20 ms to 45: more than twice, and a frame's timing, not something a person waits on. */
    expect(one([20, 21, 19], [45, 44, 46]).verdict).toBe("same");
  });

  it("does not flag a median over the line when the rounds overlap", () => {
    /* One slow base round sits above the head's fastest: not apart, so not a regression yet. */
    expect(one([100, 104, 160], [170, 165, 150]).verdict).not.toBe("slower");
  });

  it("calls a metric noisy when its base rounds alone are as far apart as the line, and never flags it", () => {
    const v = one([100, 400, 120], [900, 950, 1000]);
    expect(v.verdict).toBe("noisy");
    expect(v.why).toContain("4.00×");
  });

  it("says faster the other way", () => {
    expect(one([600, 610, 590], [250, 260, 255]).verdict).toBe("faster");
  });

  it("says which side has no number", () => {
    expect(one([], [250]).why).toBe("no number on the base");
    expect(one([250], []).why).toBe("no number on the head");
  });

  it("takes the line and the floor it is given", () => {
    expect(one([100, 101, 99], [140, 141, 139]).verdict).toBe("same");
    expect(one([100, 101, 99], [140, 141, 139], { ratio: 1.3, floor: 30 }).verdict).toBe("slower");
  });
});

describe("rowsOf", () => {
  it("pairs each metric's rounds across the two sides, in milliseconds only, numbers only", () => {
    const run = (save: number | string, rss: number) => ({
      results: [
        { metric: "edit.1000.note.save", value: save, unit: "ms" },
        { metric: "page.1000.heap", value: rss, unit: "MB" },
      ],
    });
    expect(rowsOf([run(258, 12), run(260, 13)], [run(561, 12), run("timeout", 12)])).toEqual([
      { metric: "edit.1000.note.save", base: [258, 260], head: [561] },
    ]);
  });
});

describe("median", () => {
  it("is the middle, or the mean of the two middles", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("the report", () => {
  it("puts what is slower first, with a marker the comment is found again by", () => {
    const verdicts = compare([
      { metric: "edit.1000.card.move", base: [20, 21, 22], head: [21, 20, 22] },
      { metric: "edit.1000.note.save", base: [258, 260, 257], head: [561, 559, 566] },
    ]);
    const md = markdown(verdicts, { base: "aaa1111", head: "bbb2222", rounds: 3, what: "`--only edit`", machine: "a runner" });
    expect(md.startsWith("<!-- anydag-bench -->\n")).toBe(true);
    expect(md).toContain("**1 slower:** `edit.1000.note.save` 258 ms → 561 ms.");
    const rows = (md as string).split("\n").filter((l: string) => l.startsWith("| `"));
    expect(rows[0]).toContain("edit.1000.note.save");
    expect(rows[0]).toContain("**slower**");
    expect(rows[1]).toContain("edit.1000.card.move");
  });

  it("says nothing is slower when nothing is", () => {
    const md = markdown(compare([{ metric: "edit.1000.undo", base: [30, 31, 32], head: [31, 30, 33] }]), {
      base: "a",
      head: "b",
      rounds: 3,
      what: "",
    });
    expect(md).toContain("**Nothing slower.**");
  });
});

/**
 * **When the bench runs at all**: a change that cannot reach the built page or server spends no
 * runner on it, and one that can is never skipped — the same two silent failures as the browser
 * suite's plan (`test/e2e-plan.test.ts`).
 */
describe("benchKind", () => {
  it.each([
    ["src/ui/NoteView.tsx", "app"],
    ["src/layout/size.ts", "app"],
    ["server/routes/docs.ts", "app"],
    ["server/sync/engine.ts", "app"],
    ["cli/main.ts", "app"],
    ["vite.config.ts", "app"],
    ["package.json", "app"],
    ["package-lock.json", "app"],
    ["scripts/bench.mjs", "bench"],
    ["scripts/bench-compare.mjs", "bench"],
    ["scripts/session.mjs", "bench"],
    [".github/workflows/bench.yml", "bench"],
    ["README.md", "ignore"],
    ["docs/architecture/limits.md", "ignore"],
    ["test/bench-compare.test.ts", "ignore"],
    ["e2e/notes.spec.ts", "ignore"],
    ["desktop/main.ts", "ignore"],
    ["api/server/app.ts", "ignore"],
    ["scripts/merge-queue.mjs", "ignore"],
    [".github/workflows/ci.yml", "ignore"],
    ["playwright.config.ts", "ignore"],
  ])("%s is %s", (file, kind) => {
    expect(benchKind(file)).toBe(kind);
  });
});

describe("benchPlan", () => {
  it("runs for the app or the bench, and says why", () => {
    expect(benchPlan(["src/ui/NoteView.tsx", "docs/x.md"])).toEqual({
      run: true,
      kinds: { app: 1, ignore: 1 },
      why: "1 app, 1 ignore → base and head measured",
    });
    expect(benchPlan(["scripts/bench.mjs"]).run).toBe(true);
  });

  it("runs nothing for prose, tests and CI alone", () => {
    expect(benchPlan(["docs/x.md", "test/y.test.ts", ".github/workflows/ci.yml"]).run).toBe(false);
    expect(benchPlan([]).why).toBe("no changes → nothing the bench measures");
  });
});
