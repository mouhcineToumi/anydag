import { describe, expect, it } from "vitest";

import { mentionAt, mentionOptions } from "@/assistant/mentions";
import type { IndexDoc } from "@/refs/useIndex";

const doc = (id: string, name: string, title?: string, kind: IndexDoc["kind"] = "board"): IndexDoc => ({
  id,
  name,
  kind,
  title,
  refs: [],
});

const DOCS = [
  doc("a000000001", "acme/153", "Acme research"),
  doc("a000000002", "acme/159", "Acme research"),
  doc("a000000003", "reference/architecture", "Architecture"),
  doc("a000000004", "work/q3-plan", undefined, "note"),
];

describe("the composer's @ trigger", () => {
  it("follows an @ that starts a word", () => {
    expect(mentionAt("look at @pla", 12)).toEqual({ start: 8, query: "pla" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("ask (@plan now", 10)).toEqual({ start: 5, query: "plan" });
  });

  it("does not open for the @ inside an email address", () => {
    expect(mentionAt("mail me at person@example.com", 27)).toBeNull();
    expect(mentionAt("person@example.com", 18)).toBeNull();
  });

  it("ends the query at a line break", () => {
    expect(mentionAt("@plan\nnext", 10)).toBeNull();
  });
});

describe("the composer's @ ranking", () => {
  it("puts a title that starts with the query first, as the reference picker does", () => {
    const got = mentionOptions(DOCS, "arch").map((d) => d.title);
    expect(got[0]).toBe("Architecture");
    expect(got).toHaveLength(3);
  });

  it("finds every token in any order, in the title or the path", () => {
    expect(mentionOptions(DOCS, "plan q3").map((d) => d.name)).toEqual(["work/q3-plan"]);
    expect(mentionOptions(DOCS, "plan q4")).toEqual([]);
  });

  it("leaves out a document the message already has", () => {
    expect(mentionOptions(DOCS, "", new Set(["a000000003"])).map((d) => d.name)).not.toContain("reference/architecture");
  });
});
