import { describe, expect, it } from "vitest";

import type { Hit } from "../src/search/engine";
import { byDocument, docKey } from "../src/search/results";

/** What the two lists say about one file: a name match is the row, its blocks are not a second one. */

const hit = (kind: Hit["doc"]["kind"], name: string, part?: string): Hit => ({
  doc: { id: `${kind}-${name}`, kind, name, units: [] },
  unit: { part, what: "md", text: "API spec" },
  score: 1,
  terms: ["api", "spec"],
});

describe("search results", () => {
  it("lists a file once, by its name, when it matched both ways", () => {
    const named = new Set([docKey({ kind: "board", name: "work/api-spec" })]);
    const split = byDocument(
      [hit("board", "work/api-spec", "intro"), hit("board", "work/api-spec", "docs"), hit("note", "journal", "L4")],
      named,
    );

    expect(split.hits.map((h) => `${h.doc.name}#${h.unit.part}`)).toEqual(["journal#L4"]);
    expect([...split.inText]).toEqual(["board:work/api-spec"]);
  });

  it("keeps the two kinds apart when a board and a note share a name", () => {
    const named = new Set([docKey({ kind: "board", name: "plan" })]);
    const split = byDocument([hit("board", "plan"), hit("note", "plan", "L1")], named);

    expect(split.hits.map((h) => `${h.doc.kind}:${h.doc.name}`)).toEqual(["note:plan"]);
    expect([...split.inText]).toEqual(["board:plan"]);
  });

  it("leaves every hit standing when no name matched", () => {
    const split = byDocument([hit("note", "a", "L1"), hit("note", "b", "L2")], new Set());

    expect(split.hits).toHaveLength(2);
    expect(split.inText.size).toBe(0);
  });
});
