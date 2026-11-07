import { describe, expect, it } from "vitest";

import { Parsed } from "../../server/grammar";

describe("Parsed", () => {
  it("parses only what changed, and moves its generation only then", async () => {
    const asked: string[][] = [];
    const parsed = new Parsed(async (texts) => {
      asked.push(Object.keys(texts).sort());
      return Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, { length: t.length }]));
    });
    await parsed.of({ a: "one", b: "two" });
    const g = parsed.generation;
    await parsed.of({ a: "one", b: "two" });
    expect(parsed.generation).toBe(g);
    await parsed.of({ a: "one", b: "three" });
    expect(parsed.generation).toBe(g + 1);
    // A text gone is a change too.
    await parsed.of({ a: "one" });
    expect(parsed.generation).toBe(g + 2);
    expect(asked).toEqual([["a", "b"], ["b"]]);
  });

  it("takes two cold asks one after the other, so the second parses nothing", async () => {
    let calls = 0;
    const parsed = new Parsed(async (texts) => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return Object.fromEntries(Object.keys(texts).map((k) => [k, {}]));
    });
    await Promise.all([parsed.of({ a: "x", b: "y" }), parsed.of({ a: "x", b: "y" })]);
    expect(calls).toBe(1);
  });
});
