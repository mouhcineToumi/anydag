import { describe, expect, it } from "vitest";

import { RECENT_LIMIT, parseRecent, rememberRecent, type RecentFile } from "@/ui/recents";

/**
 * Home's recent list, held to its two rules without a browser: the stored value is a browser's and
 * may be anything, and opening a file twice is one row at the top rather than two.
 */

const file = (kind: RecentFile["kind"], name: string): RecentFile => ({ kind, name });

describe("the recent files Home draws", () => {
  it("reads nothing from what is not a list", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("")).toEqual([]);
    expect(parseRecent("not json")).toEqual([]);
    expect(parseRecent('{"kind":"board","name":"plan"}')).toEqual([]);
  });

  it("keeps the valid entries, in the order stored, and drops the rest", () => {
    expect(
      parseRecent(
        JSON.stringify([
          file("board", "plan"),
          { kind: "gallery", name: "nope" },
          { kind: "note" },
          { kind: "note", name: "" },
          null,
          file("quiz", "drill"),
        ]),
      ),
    ).toEqual([file("board", "plan"), file("quiz", "drill")]);
  });

  it("caps a list written by another version and drops its duplicates", () => {
    const many = Array.from({ length: RECENT_LIMIT + 3 }, (_, i) => file("note", `note-${i}`));
    expect(parseRecent(JSON.stringify([...many, ...many]))).toHaveLength(RECENT_LIMIT);
    expect(parseRecent(JSON.stringify([file("note", "a"), file("note", "a")]))).toEqual([file("note", "a")]);
  });

  it("puts a repeated open at the top rather than adding a second row", () => {
    const entries = [file("note", "b"), file("board", "a"), file("quiz", "q")];
    expect(rememberRecent(entries, file("board", "a"))).toEqual([file("board", "a"), file("note", "b"), file("quiz", "q")]);
  });

  it("keeps five, newest first", () => {
    let entries: RecentFile[] = [];
    for (let i = 0; i < 8; i++) entries = rememberRecent(entries, file("note", `note-${i}`));
    expect(entries).toEqual([
      file("note", "note-7"),
      file("note", "note-6"),
      file("note", "note-5"),
      file("note", "note-4"),
      file("note", "note-3"),
    ]);
  });
});
