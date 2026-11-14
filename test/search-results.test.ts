import { describe, expect, it } from "vitest";

import { byDocument, docKey } from "../src/search/results";
import type { Found } from "../src/search/wire";

/** What the two lists say about one file: a name match is the row, its blocks are not a second one. */

const hit = (kind: Found["kind"], name: string, part?: string): Found => ({
  id: `${kind}-${name}`,
  kind,
  name,
  title: null,
  part: part ?? null,
  what: "md",
  score: 1,
  terms: ["api", "spec"],
  snippet: "**API** **spec**",
  runs: [
    { text: "API", hit: true },
    { text: " ", hit: false },
    { text: "spec", hit: true },
  ],
});

describe("search results", () => {
  it("lists a file once, by its name, when it matched both ways", () => {
    const named = new Set([docKey({ kind: "board", name: "work/api-spec" })]);
    const split = byDocument(
      [hit("board", "work/api-spec", "intro"), hit("board", "work/api-spec", "docs"), hit("note", "journal", "L4")],
      named,
    );

    expect(split.hits.map((h) => `${h.name}#${h.part}`)).toEqual(["journal#L4"]);
    expect([...split.inText]).toEqual(["board:work/api-spec"]);
  });

  it("keeps the two kinds apart when a board and a note share a name", () => {
    const named = new Set([docKey({ kind: "board", name: "plan" })]);
    const split = byDocument([hit("board", "plan"), hit("note", "plan", "L1")], named);

    expect(split.hits.map((h) => `${h.kind}:${h.name}`)).toEqual(["note:plan"]);
    expect([...split.inText]).toEqual(["board:plan"]);
  });

  it("leaves every hit standing when no name matched", () => {
    const split = byDocument([hit("note", "a", "L1"), hit("note", "b", "L2")], new Set());

    expect(split.hits).toHaveLength(2);
    expect(split.inText.size).toBe(0);
  });
});
