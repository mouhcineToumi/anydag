import { describe, expect, it } from "vitest";

import { blockAt, load } from "../src/note/markdown";

/**
 * The block a line of a note falls in — what a search result naming `L12`, or a link to a
 * `^anchor`, opens onto. Read off the span map, so these are claims about the map.
 */

const BODY = "# Monday\n\nFiller one.\n\n- first item\n- second item\n  continued\n- third item\n\nThe target para.\n";
const { blocks, loaded } = load(BODY);
const text = (id: string | null) => {
  const b = blocks.find((x) => x.id === id);
  return b ? JSON.stringify(b.content) : null;
};

describe("blockAt", () => {
  it("finds the block a line starts, and the one it continues", () => {
    expect(text(blockAt(loaded, 1))).toContain("Monday");
    expect(text(blockAt(loaded, 3))).toContain("Filler one");
    expect(text(blockAt(loaded, 10))).toContain("The target para");
  });

  it("finds a list item by its own line, a continuation line included", () => {
    expect(text(blockAt(loaded, 5))).toContain("first item");
    expect(text(blockAt(loaded, 6))).toContain("second item");
    expect(text(blockAt(loaded, 7))).toContain("second item");
    expect(text(blockAt(loaded, 8))).toContain("third item");
  });

  it("gives a blank line to the block after it, and a line past the end to the last", () => {
    expect(text(blockAt(loaded, 2))).toContain("Filler one");
    expect(text(blockAt(loaded, 99))).toContain("The target para");
  });

  it("has nothing to give in a note with no blocks", () => {
    expect(blockAt(load("").loaded, 1)).toBeNull();
  });
});
