import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import { compare } from "../scripts/check-complexity.mjs";

/**
 * **What a change makes more complex** (#526): the decision `scripts/check-complexity.mjs` makes
 * against `scripts/complexity-baseline.json`. Held here because both wrong answers are silent — too
 * strict and every edit to a large file fails on a function it did not touch, too loose and the
 * check prints numbers nobody has to answer for.
 */
const at = (file: string, line: number, complexity: number, name = "work") => ({ file, line, name, complexity });
const held = (name: string, complexity: number) => ({ name, complexity });

describe("compare", () => {
  it("passes a file whose old offenders the change did not touch", () => {
    const baseline = { "src/a.ts": [held("first", 21), held("second", 40)] };
    expect(compare(baseline, [at("src/a.ts", 10, 21, "first"), at("src/a.ts", 90, 40, "second")])).toEqual([]);
  });

  it("passes a file the change moved down the page without changing a score", () => {
    const baseline = { "src/a.ts": [held("first", 21), held("second", 40)] };
    expect(compare(baseline, [at("src/a.ts", 110, 21, "first"), at("src/a.ts", 190, 40, "second")])).toEqual([]);
  });

  it("fails a function that is new over the threshold", () => {
    const raised = compare({ "src/a.ts": [held("first", 21)] }, [
      at("src/a.ts", 10, 21, "first"),
      at("src/a.ts", 80, 25, "parse"),
    ]);
    expect(raised).toEqual([{ file: "src/a.ts", line: 80, name: "parse", complexity: 25, was: null }]);
  });

  it("fails a function already over the threshold that the change made worse", () => {
    const raised = compare({ "src/a.ts": [held("work", 21)] }, [at("src/a.ts", 10, 24)]);
    expect(raised).toEqual([{ file: "src/a.ts", line: 10, name: "work", complexity: 24, was: 21 }]);
  });

  it("passes a function the change made simpler", () => {
    expect(compare({ "src/a.ts": [held("work", 30)] }, [at("src/a.ts", 10, 22)])).toEqual([]);
  });

  it("passes a function renamed at the same score", () => {
    expect(compare({ "src/a.ts": [held("before", 25)] }, [at("src/a.ts", 10, 25, "after")])).toEqual([]);
  });

  it("fails a second function even at a score the file already held", () => {
    const raised = compare({ "src/a.ts": [held("first", 21)] }, [
      at("src/a.ts", 10, 21, "first"),
      at("src/a.ts", 80, 21, "second"),
    ]);
    expect(raised).toEqual([{ file: "src/a.ts", line: 80, name: "second", complexity: 21, was: null }]);
  });

  it("sees a raise even when another function in the file got simpler", () => {
    const raised = compare({ "src/a.ts": [held("big", 25), held("work", 21)] }, [at("src/a.ts", 10, 25)]);
    expect(raised).toEqual([{ file: "src/a.ts", line: 10, name: "work", complexity: 25, was: 21 }]);
  });

  it("keeps one file's baseline out of another's", () => {
    const raised = compare({ "src/a.ts": [held("work", 40)] }, [at("src/a.ts", 10, 40, "work"), at("src/b.ts", 20, 25)]);
    expect(raised.map((finding: { file: string }) => finding.file)).toEqual(["src/b.ts"]);
  });

  it("reports in file and line order", () => {
    const raised = compare({}, [at("src/b.ts", 20, 25), at("src/a.ts", 90, 24), at("src/a.ts", 10, 21)]);
    expect(raised.map((finding: { line: number }) => finding.line)).toEqual([10, 90, 20]);
  });
});
