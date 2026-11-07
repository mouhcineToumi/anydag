import { describe, expect, it } from "vitest";
import { rank, refItems } from "@/blocks/refs";
import type { IndexDoc } from "@/refs/useIndex";

const doc = (id: string, name: string, title?: string, kind: IndexDoc["kind"] = "board"): IndexDoc => ({ id, name, kind, title, refs: [] });

const DOCS = [
  doc("a000000001", "acme/153", "Acme research"),
  doc("a000000002", "acme/159", "Acme research"),
  doc("a000000003", "reference/architecture", "Architecture"),
  doc("a000000004", "work/q3-plan", undefined, "note"),
];

describe("the reference picker", () => {
  it("puts a title that starts with the query first", () => {
    const got = refItems(DOCS, "arch", null, () => {}).map((i) => i.title);
    expect(got[0]).toBe("Architecture");
    expect(got).toHaveLength(3); // `research` has it too
  });

  it("finds every token in any order, in the title or the path", () => {
    expect(rank(DOCS[3]!, "plan q3")).not.toBeNull();
    expect(rank(DOCS[3]!, "plan q4")).toBeNull();
  });

  it("tells two documents with one title apart, so no two rows share a title", () => {
    /* In one folder there is nothing to tell them apart by but a number — and the name, under it. */
    const got = refItems(DOCS, "acme", null, () => {});
    expect(got.map((i) => i.title)).toEqual(["Acme research", "Acme research (2)"]);
    expect(got.map((i) => i.subtext)).toEqual(["Board · acme/153", "Board · acme/159"]);
  });

  it("tells them apart by their folders when those differ, and never shows a name otherwise", () => {
    const docs = [doc("b000000001", "untitled", "Untitled"), doc("b000000002", "work/untitled", "Untitled"), doc("b000000003", "plan-7", "Plan")];
    const got = refItems(docs, "", null, () => {});
    expect(got.map((i) => i.title)).toEqual(["Plan", "Untitled (top level)", "Untitled (work)"]);
    expect(got.map((i) => i.subtext)).toEqual(["Board", "Board", "Board · work"]);
  });

  it("leaves out the document being written", () => {
    expect(refItems(DOCS, "", "a000000003", () => {}).map((i) => i.title)).not.toContain("Architecture");
  });
});
