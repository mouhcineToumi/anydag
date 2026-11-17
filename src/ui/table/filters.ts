/**
 * A table's filter rules as the Filter card holds them, apart from what the file can say.
 *
 * The file spells **is empty** `col=` and **is not empty** `col!=` — an operator with no value
 * (`src/table/values.ts`, `passes`). So a rule a person is still filling in — "is", "is not",
 * "contains" … with no value yet — has no spelling of its own: written, it reads back as one of the
 * emptiness tests, and the card shows the wrong test with no value field (#404). A rule is a
 * **draft** here until the file can read it back as itself, and the card writes only the drafts that
 * are `complete`. That is also why adding a line writes nothing and hides no row.
 *
 * Browser-free and React-free: the card's decisions are tested as data (`test/table-filter.test.ts`).
 */
import type { FilterOp, FilterRule } from "@/table/parse";

/** What a filter line offers besides the eight operators: a test for emptiness, which is `=` or `!=` with nothing after it. */
export type FilterTest = FilterOp | "empty" | "filled";

/** A rule as the card holds it: the test a person picked and the value typed for it. */
export interface FilterDraft {
  column: string;
  test: FilterTest;
  value: string;
}

/** The test a written rule says: `=` with no value is "is empty", `!=` with none "is not empty". */
export const testOf = (rule: FilterRule): FilterTest =>
  rule.value === "" && rule.op === "=" ? "empty" : rule.value === "" && rule.op === "!=" ? "filled" : rule.op;

/** A written rule as the card holds it. */
export const draftOf = (rule: FilterRule): FilterDraft => ({
  column: rule.column,
  test: testOf(rule),
  value: rule.value,
});

/** The rule a draft writes; an emptiness test has no value to write. */
export function ruleOf(draft: FilterDraft): FilterRule {
  if (draft.test === "empty") return { column: draft.column, op: "=", value: "" };
  if (draft.test === "filled") return { column: draft.column, op: "!=", value: "" };
  return { column: draft.column, op: draft.test, value: draft.value.trim() };
}

/** Whether the file reads the draft back as the same rule: an operator needs its value, an emptiness test has none. */
export const complete = (draft: FilterDraft): boolean =>
  draft.test === "empty" || draft.test === "filled" || draft.value.trim() !== "";

/**
 * A new test on a rule. The emptiness tests carry no value, so leaving one starts the value empty;
 * between two operators the value stays, and moving to an emptiness test drops it.
 */
export function retest(draft: FilterDraft, test: FilterTest): FilterDraft {
  const valued = test !== "empty" && test !== "filled";
  const kept = valued && draft.test !== "empty" && draft.test !== "filled" ? draft.value : "";
  return { ...draft, test, value: kept };
}

/** The rules to write: every one the file can read back, in the card's order — an unfinished one is not a rule yet. */
export const rulesToWrite = (drafts: readonly FilterDraft[]): FilterRule[] => drafts.filter(complete).map(ruleOf);

/** Whether two written filters say the same thing, so the card can tell its own write from another writer's. */
export const sameRules = (a: readonly FilterRule[], b: readonly FilterRule[]): boolean =>
  a.length === b.length && a.every((r, i) => r.column === b[i]!.column && r.op === b[i]!.op && r.value === b[i]!.value);
