/**
 * A table's filter rules as the Filter card holds them: the file spells "is empty" `col=` and "is
 * not empty" `col!=`, so a rule with an operator and no value yet is a draft and is never written.
 * Written, it would read back as one of those tests — the defect #404, where "is" came back
 * "is empty" and lost its value field.
 */
import { describe, expect, it } from "vitest";

import type { FilterOp, FilterRule } from "../src/table/parse";
import { complete, draftOf, retest, ruleOf, rulesToWrite, sameRules, testOf } from "../src/ui/table/filters";

const rule = (op: FilterOp, value: string): FilterRule => ({ column: "stage", op, value });

describe("what a written rule says", () => {
  it("reads an operator with no value as the emptiness test it spells", () => {
    expect(testOf(rule("=", ""))).toBe("empty");
    expect(testOf(rule("!=", ""))).toBe("filled");
    expect(testOf(rule("=", "Won"))).toBe("=");
    expect(testOf(rule("!=", "Lost"))).toBe("!=");
    expect(testOf(rule("~", ""))).toBe("~");
  });

  it("round-trips every rule the file can read back as itself", () => {
    const written = [rule("=", ""), rule("!=", ""), rule("=", "Won"), rule("!=", "Lost"), rule("~", "acme")];
    for (const r of written) expect(ruleOf(draftOf(r))).toEqual(r);
  });
});

describe("the card's drafts", () => {
  it("is complete only when the file reads it back the same: an operator needs its value", () => {
    expect(complete(draftOf(rule("=", "")))).toBe(true);
    expect(complete(draftOf(rule("!=", "")))).toBe(true);
    expect(complete({ column: "stage", test: "=", value: "" })).toBe(false);
    expect(complete({ column: "stage", test: "!=", value: "   " })).toBe(false);
    expect(complete({ column: "stage", test: ">=", value: "" })).toBe(false);
    expect(complete({ column: "stage", test: ">=", value: "900" })).toBe(true);
  });

  it("keeps a value between two operators and drops it when an emptiness test takes over", () => {
    expect(retest({ column: "stage", test: "=", value: "Won" }, "!=")).toEqual({
      column: "stage",
      test: "!=",
      value: "Won",
    });
    expect(retest({ column: "stage", test: "!=", value: "Won" }, "empty")).toEqual({
      column: "stage",
      test: "empty",
      value: "",
    });
    expect(retest({ column: "stage", test: "empty", value: "" }, "=")).toEqual({
      column: "stage",
      test: "=",
      value: "",
    });
  });

  it('turns a fresh rule\'s "is not empty" into a draft when it is set to "is", not back into "is empty"', () => {
    const fresh = draftOf(rule("!=", ""));
    expect(fresh.test).toBe("filled");
    const is = retest(fresh, "=");
    expect(is).toEqual({ column: "stage", test: "=", value: "" });
    expect(complete(is)).toBe(false);
    expect(rulesToWrite([is])).toEqual([]);
  });

  it("writes the complete rules in order and leaves an unfinished one out", () => {
    const drafts = [
      { column: "stage", test: "=" as const, value: "Won" },
      { column: "name", test: "empty" as const, value: "" },
      { column: "amount", test: ">=" as const, value: "" },
      { column: "amount", test: ">=" as const, value: "900" },
    ];
    const written = rulesToWrite(drafts);
    expect(written).toEqual([
      { column: "stage", op: "=", value: "Won" },
      { column: "name", op: "=", value: "" },
      { column: "amount", op: ">=", value: "900" },
    ]);
    expect(sameRules(written, rulesToWrite(drafts))).toBe(true);
    expect(sameRules(written, [...written, { column: "name", op: "!=", value: "" }])).toBe(false);
    expect(
      sameRules(
        written,
        written.map((r) => ({ ...r, value: `${r.value}!` })),
      ),
    ).toBe(false);
  });
});
