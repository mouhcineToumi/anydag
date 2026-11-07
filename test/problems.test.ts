import { describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { CODES } from "@/dsl/codes";
import { count, freshErrors, itemAt, listProblems } from "@/ui/problemList";

/** Today's board, the one that started this: a stray `y` at the top of its `edges` fence. */
const TEST_2 = [
  "---",
  'title: "test"',
  "---",
  "",
  "```edges {#edges-rgx3}",
  "y",
  "arch-k8a4 --> arch-k2bv",
  "```",
  "",
  "```arch {#arch-k8a4 x=784 y=896}",
  'store db1 "Postgres 1" icon=database',
  "```",
  "",
  "```arch {#arch-k2bv x=1144 y=688}",
  'store db1 "Staging DB" icon=database',
  "```",
  "",
].join("\n");

describe("listProblems", () => {
  it("puts a board-level error inside the fence it is written in", () => {
    const board = parseBoard("test-2", TEST_2);
    const ps = listProblems(board);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ code: CODES.EB_LINK_SYNTAX, line: 6, item: "edges-rgx3", severity: "error" });
  });

  it("names the item a diagram's own problem belongs to, and its page", () => {
    const text = ["```arch {#a}", 'service api "API" hue=purple', "```", ""].join("\n");
    const board = parseBoard("t", text);
    const ps = listProblems(board);
    const hue = ps.find((p) => p.code === CODES.W_UNKNOWN_HUE)!;
    expect(hue).toMatchObject({ item: "a", severity: "warn" });
    expect(hue.page).toBe(board.items.find((it) => it.id === "a")!.page);
  });

  it("keys a problem without its line, so moving it down is not a new problem", () => {
    const a = listProblems(parseBoard("t", TEST_2))[0]!;
    const b = listProblems(parseBoard("t", TEST_2.replace("```edges {#edges-rgx3}\n", "```edges {#edges-rgx3}\n\n")))[0]!;
    expect(b.line).toBe(a.line + 1);
    expect(b.key).toBe(a.key);
  });

  it("is sorted by line and counts both kinds", () => {
    const text = ["```arch {#a}", 'service api "API" hue=purple', "api --> ghost", "```", ""].join("\n");
    const ps = listProblems(parseBoard("t", text));
    expect(ps.map((p) => p.line)).toEqual([...ps.map((p) => p.line)].sort((x, y) => x - y));
    expect(count(ps)).toEqual({ errors: 1, warnings: 1 });
  });
});

describe("itemAt", () => {
  const board = parseBoard("test-2", TEST_2);
  it("finds the fence holding a line, fence lines included", () => {
    expect(itemAt(board.items, 5)?.id).toBe("edges-rgx3");
    expect(itemAt(board.items, 6)?.id).toBe("edges-rgx3");
    expect(itemAt(board.items, 8)?.id).toBe("edges-rgx3");
    expect(itemAt(board.items, 11)?.id).toBe("arch-k8a4");
  });
  it("finds nothing in the frontmatter or between two fences", () => {
    expect(itemAt(board.items, 2)).toBeUndefined();
    expect(itemAt(board.items, 9)).toBeUndefined();
  });
});

describe("freshErrors", () => {
  const ps = listProblems(parseBoard("test-2", TEST_2));
  it("interrupts once for a problem, then not again", () => {
    expect(freshErrors(ps, new Set(), null)).toHaveLength(1);
    expect(freshErrors(ps, new Set(ps.map((p) => p.key)), null)).toHaveLength(0);
  });
  it("says nothing about the item being edited", () => {
    expect(freshErrors(ps, new Set(), "edges-rgx3")).toHaveLength(0);
  });
  it("never interrupts for a warning", () => {
    const warn = listProblems(parseBoard("t", ["```arch {#a}", 'service api "API" hue=purple', "```", ""].join("\n")));
    expect(warn).toHaveLength(1);
    expect(freshErrors(warn, new Set(), null)).toHaveLength(0);
  });
});
