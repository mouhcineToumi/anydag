import { expect, it } from "vitest";

/** A dummy test that always fails, for the merge queue test in #511. Never merged. */
it("fails on purpose", () => {
  expect(1).toBe(2);
});
