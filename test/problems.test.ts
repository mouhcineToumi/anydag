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

/** A link to a card that is not there: a problem a person can act on, on a line of its own. */
const GHOST = ["```arch {#a}", 'service api "API"', "api --> ghost", "```", ""].join("\n");

describe("listProblems", () => {
  it("leaves out a statement a person could not read, and keeps it for an agent", () => {
    /* The stray `y` is `EB_LINK_SYNTAX`: in the board's own format, which a person never sees. */
    const board = parseBoard("test-2", TEST_2);
    expect(listProblems(board)).toEqual([]);
    expect(board.errors.map((e) => e.code)).toContain(CODES.EB_LINK_SYNTAX);
  });

  it("names the item a diagram's own problem belongs to, its page and the thing it concerns", () => {
    const text = ["```arch {#a}", 'service api "API" hue=purple', "```", ""].join("\n");
    const board = parseBoard("t", text);
    const ps = listProblems(board);
    const hue = ps.find((p) => p.code === CODES.W_UNKNOWN_HUE)!;
    expect(hue).toMatchObject({ item: "a", severity: "warn", target: { what: "node", id: "api" } });
    expect(hue.page).toBe(board.items.find((it) => it.id === "a")!.page);
    /* In words, with no grammar in them. */
    expect(hue.words).not.toMatch(/hue=|`/);
  });

  it("points a link that ends on nothing at the link, with Delete as its fix", () => {
    const [p] = listProblems(parseBoard("t", GHOST));
    expect(p).toMatchObject({ code: CODES.E_UNKNOWN_ID, target: { what: "edge" }, fix: "delete-edge" });
  });

  it("drops a problem about something that was not drawn", () => {
    /* The first statement cannot be read, so the edge from it has nothing to point at either. */
    const text = ["```arch {#a}", 'service api "API', "api --> ghost", "```", ""].join("\n");
    expect(listProblems(parseBoard("t", text))).toEqual([]);
  });

  it("keeps a Mermaid paste once, as one thing to convert", () => {
    const text = ["```arch {#a}", "graph LR", "  A --> B", "  B --> C", "```", ""].join("\n");
    const ps = listProblems(parseBoard("t", text));
    expect(ps.filter((p) => p.code === CODES.E_MERMAID_SYNTAX)).toHaveLength(1);
  });

  it("keys a problem without its line, so moving it down is not a new problem", () => {
    const a = listProblems(parseBoard("t", GHOST))[0]!;
    const b = listProblems(parseBoard("t", GHOST.replace("```arch {#a}\n", "```arch {#a}\n\n")))[0]!;
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
  const ps = listProblems(parseBoard("t", GHOST));
  it("interrupts once for a problem, then not again", () => {
    expect(freshErrors(ps, new Set(), null)).toHaveLength(1);
    expect(freshErrors(ps, new Set(ps.map((p) => p.key)), null)).toHaveLength(0);
  });
  it("says nothing about the item being edited", () => {
    expect(freshErrors(ps, new Set(), "a")).toHaveLength(0);
  });
  it("never interrupts for a warning", () => {
    const warn = listProblems(parseBoard("t", ["```arch {#a}", 'service api "API" hue=purple', "```", ""].join("\n")));
    expect(warn).toHaveLength(1);
    expect(freshErrors(warn, new Set(), null)).toHaveLength(0);
  });
});
