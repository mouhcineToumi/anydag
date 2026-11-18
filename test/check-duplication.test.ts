import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import { cloneLine } from "../scripts/check-duplication.mjs";

/**
 * **The line a new clone is reported as** (#526). The check is only as useful as the two locations
 * it names: a reader has to be able to open both without asking which copy the other one is.
 */
describe("cloneLine", () => {
  it("names both ends and the size", () => {
    const line = cloneLine({
      firstFile: { name: "src/quiz/parse.ts", start: 295 },
      secondFile: { name: "src/table/parse.ts", start: 675 },
      lines: 32,
      tokens: 208,
    });
    expect(line).toBe("src/quiz/parse.ts:295 duplicates src/table/parse.ts:675 (32 lines, 208 tokens)");
  });
});
