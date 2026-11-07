import { describe, expect, it } from "vitest";

import { verbOf } from "../src/assistant/words";

describe("verbOf", () => {
  it("reads a chat's doc_* call as the tool its kind names", () => {
    expect(verbOf("mcp__anydag__doc_create", { kind: "note", name: "plan" })).toBe(verbOf("note_create"));
    expect(verbOf("anydag_doc_list", { kind: "board" })).toBe("Listed boards");
    expect(verbOf("doc_read", { kind: "quiz" })).toBe("Read a quiz");
  });

  it("leaves a doc_* call with no kind it knows as its own words", () => {
    expect(verbOf("doc_read")).toBe("Doc read");
    expect(verbOf("doc_read", { kind: "spaceship" })).toBe("Doc read");
  });
});
