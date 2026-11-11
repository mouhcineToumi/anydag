import { describe, expect, it } from "vitest";

import { parseDiagram } from "../src/dsl/parse";
import { addTopic, indentTopic, makeRoot, outdentTopic, shiftTopic, topicMoves, topicParent } from "../src/dsl/restate";
import { topicKeyFor } from "../src/edit/bindings";
import { growTopic } from "../src/edit/build";
import { topicHandles } from "../src/edit/pick";

/* Lines: 1 root, 2 Dialects, 3 Arch, 4 Erd, 5 Editing, 6 Drag, 7 Pick */
const MAP = `root AnyDag
  Dialects
    Arch
    Erd
  Editing
    Drag
    Pick`;

/** What a map says once parsed: each topic's title under its parent's, so a write is checked by meaning. */
function tree(body: string): string[] {
  const g = parseDiagram("mindmap", body, undefined)!;
  const title = new Map(g.nodes.map((n) => [n.id, n.title]));
  const parent = new Map(g.edges.map((e) => [e.to.node, e.from.node]));
  return g.nodes.map((n) => `${parent.has(n.id) ? title.get(parent.get(n.id)!) : "∅"} > ${n.title}`);
}

describe("topicParent and topicMoves", () => {
  it("finds the parent the way the parser does", () => {
    expect(topicParent(MAP, 1)).toBeNull();
    expect(topicParent(MAP, 3)).toBe(2);
    expect(topicParent(MAP, 7)).toBe(5);
  });

  it("offers a move only where the grammar has an answer", () => {
    expect(topicMoves(MAP, 1)).toEqual({
      child: true,
      sibling: false,
      indent: false,
      outdent: false,
      up: false,
      down: false,
      root: false,
    });
    /* The first child of the root: it can go down, but there is nothing above it to indent under, and
       outdenting would put it at depth 0 beside the root. */
    expect(topicMoves(MAP, 2)).toMatchObject({ sibling: true, indent: false, outdent: false, up: false, down: true, root: true });
    expect(topicMoves(MAP, 4)).toMatchObject({ indent: true, outdent: true, up: true, down: false });
  });

  it("offers nothing for a line that is not a topic", () => {
    expect(topicMoves(`${MAP}\n\n%% note`, 9)).toMatchObject({ child: false, root: false });
  });
});

describe("addTopic", () => {
  it("adds a child at the end of the family, at the indent the first child already uses", () => {
    const made = addTopic(MAP, 2, "child")!;
    expect(made.line).toBe(5);
    expect(made.body.split("\n").slice(1, 6)).toEqual(["  Dialects", "    Arch", "    Erd", "    New topic", "  Editing"]);
  });

  it("indents the first child of a leaf one level past it", () => {
    expect(addTopic(MAP, 3, "child")!.body.split("\n")[3]).toBe("      New topic");
  });

  it("puts a sibling after the whole branch, not between a parent and its children", () => {
    const made = addTopic(MAP, 2, "sibling")!;
    expect(made.line).toBe(5);
    expect(made.body.split("\n").slice(1, 6)).toEqual(["  Dialects", "    Arch", "    Erd", "  New topic", "  Editing"]);
  });

  it("refuses a sibling of the root, which would be a second root", () => {
    expect(addTopic(MAP, 1, "sibling")).toBeNull();
    expect(addTopic(MAP, 1, "child")!.line).toBe(8);
  });

  it("keeps a tab-indented tree tab-indented", () => {
    const made = addTopic("root R\n\tA", 2, "child")!;
    expect(made.body).toBe("root R\n\tA\n\t\tNew topic");
    expect(addTopic("root R\n\tA", 1, "child")!.body).toBe("root R\n\tA\n\tNew topic");
  });

  it("leaves every other byte alone, comments and the gap after the branch included", () => {
    const body = "root R\n  A\n    a1 // note\n\n  B";
    const made = addTopic(body, 2, "sibling")!;
    expect(made.body).toBe("root R\n  A\n    a1 // note\n  New topic\n\n  B");
  });

  it("is not a topic on a blank or comment line", () => {
    expect(addTopic("root R\n\n%% c\n  A", 2, "child")).toBeNull();
    expect(addTopic("root R\n\n%% c\n  A", 3, "child")).toBeNull();
  });

  it("parses back as one more topic under the right parent", () => {
    expect(tree(addTopic(MAP, 5, "child")!.body)).toContain("Editing > New topic");
    expect(tree(addTopic(MAP, 5, "sibling")!.body)).toContain("AnyDag > New topic");
  });
});

describe("growTopic", () => {
  it("returns the parser's id for the new topic, so the pick can follow it", () => {
    const made = growTopic(MAP, "m1", "child")!;
    const g = parseDiagram("mindmap", made.body, undefined)!;
    const node = g.nodes.find((n) => n.id === made.id)!;
    expect(node.title).toBe("New topic");
    expect(tree(made.body)).toContain("Dialects > New topic");
  });

  it("is null for an unknown topic and for the root's sibling", () => {
    expect(growTopic(MAP, "nope", "child")).toBeNull();
    expect(growTopic(MAP, "m0", "sibling")).toBeNull();
  });
});

describe("outdentTopic", () => {
  it("moves the topic and its subtree to sit right after its parent, one level out", () => {
    const body = "root R\n  A\n    B\n      b1\n    C\n  D";
    const made = outdentTopic(body, 3)!;
    expect(made.body).toBe("root R\n  A\n    C\n  B\n    b1\n  D");
    expect(made.line).toBe(4);
  });

  it("is null directly under the root, and for the root", () => {
    expect(outdentTopic(MAP, 2)).toBeNull();
    expect(outdentTopic(MAP, 1)).toBeNull();
  });
});

describe("indentTopic", () => {
  it("makes the topic the last child of the sibling above, with its own children along", () => {
    const made = indentTopic(MAP, 5)!;
    expect(made.body).toBe(
      ["root AnyDag", "  Dialects", "    Arch", "    Erd", "    Editing", "      Drag", "      Pick"].join("\n"),
    );
    expect(made.line).toBe(5);
  });

  it("uses the indent the sibling's children already have", () => {
    const body = "root R\n  A\n      a1\n  B";
    expect(indentTopic(body, 4)!.body).toBe("root R\n  A\n      a1\n      B");
  });

  it("is null for the first sibling and for the root", () => {
    expect(indentTopic(MAP, 2)).toBeNull();
    expect(indentTopic(MAP, 1)).toBeNull();
  });
});

describe("shiftTopic", () => {
  it("swaps a topic and its subtree with the sibling above", () => {
    const made = shiftTopic(MAP, 5, -1)!;
    expect(made.body).toBe(["root AnyDag", "  Editing", "    Drag", "    Pick", "  Dialects", "    Arch", "    Erd"].join("\n"));
    expect(made.line).toBe(2);
  });

  it("swaps with the sibling below, landing after the whole of it", () => {
    const made = shiftTopic(MAP, 2, 1)!;
    expect(made.body).toBe(["root AnyDag", "  Editing", "    Drag", "    Pick", "  Dialects", "    Arch", "    Erd"].join("\n"));
    expect(made.line).toBe(5);
  });

  it("is null at either end of the siblings, and for the root", () => {
    expect(shiftTopic(MAP, 2, -1)).toBeNull();
    expect(shiftTopic(MAP, 5, 1)).toBeNull();
    expect(shiftTopic(MAP, 1, 1)).toBeNull();
  });

  it("round-trips: up then down is the file it started as", () => {
    const up = shiftTopic(MAP, 5, -1)!;
    expect(shiftTopic(up.body, up.line, 1)!.body).toBe(MAP);
  });
});

describe("makeRoot", () => {
  it("turns the tree over: the topic on top, its old parents hanging below it", () => {
    const made = makeRoot(MAP, 5)!;
    expect(made.body).toBe(
      ["root Editing", "  Drag", "  Pick", "  AnyDag", "    Dialects", "      Arch", "      Erd"].join("\n"),
    );
    expect(made.line).toBe(1);
    /* No topic is lost and none is renamed. */
    expect(
      tree(made.body)
        .map((t) => t.split(" > ")[1])
        .sort(),
    ).toEqual(
      tree(MAP)
        .map((t) => t.split(" > ")[1])
        .sort(),
    );
    expect(tree(made.body)[0]).toBe("∅ > Editing");
  });

  it("works from a deep topic, keeping each ancestor's other children under it", () => {
    const made = makeRoot(MAP, 3)!;
    expect(made.body).toBe(
      ["root Arch", "  Dialects", "    Erd", "    AnyDag", "      Editing", "        Drag", "        Pick"].join("\n"),
    );
  });

  it("moves the `root` word, and leaves a deeper topic that merely starts with it alone", () => {
    const body = "root R\n  root cause\n    why\n  other";
    const made = makeRoot(body, 3)!;
    expect(made.body).toBe("root why\n  root cause\n    R\n      other");
  });

  it("works for a map written without the word, and for a Mermaid-wrapped root", () => {
    expect(makeRoot("Top\n  A", 2)!.body).toBe("root A\n  Top");
    expect(makeRoot("root ((Top))\n  A", 2)!.body).toBe("root A\n  ((Top))");
  });

  it("carries a comment with the topic that follows it, and leaves what is outside the tree alone", () => {
    const body = "%% title\nroot R\n  A\n  %% about B\n  B\n%% end";
    const made = makeRoot(body, 5)!;
    expect(made.body).toBe("%% title\n  %% about B\nroot B\n  R\n    A\n%% end");
    expect(made.line).toBe(3);
  });

  it("is null for the top of the tree, which already is the root", () => {
    expect(makeRoot(MAP, 1)).toBeNull();
  });
});

describe("topicKeyFor", () => {
  const key = (k: string, mods: { shiftKey?: boolean; altKey?: boolean } = {}) =>
    topicKeyFor({ key: k, shiftKey: false, altKey: false, ...mods });

  it("is the outliner's: Tab child, Enter sibling, Shift+Tab outdent, Alt+arrows move", () => {
    expect(key("Tab")).toBe("child");
    expect(key("Enter")).toBe("sibling");
    expect(key("Tab", { shiftKey: true })).toBe("outdent");
    expect(key("ArrowUp", { altKey: true })).toBe("up");
    expect(key("ArrowDown", { altKey: true })).toBe("down");
  });

  it("leaves every other press to the keys that already own it", () => {
    expect(key("ArrowUp")).toBeNull();
    expect(key("Enter", { shiftKey: true })).toBeNull();
    expect(key("Tab", { altKey: true })).toBeNull();
    expect(key("a")).toBeNull();
  });
});

describe("topicHandles", () => {
  const box = (x: number, y: number) => ({ x, y, w: 80, h: 30 });
  const body = MAP;

  /* The ids are the parser's counter, which is shared with the edges it invents: Dialects is `m1`
     and Editing is `m7`. */
  it("puts the child's + on the side away from the root, and the sibling's below", () => {
    const boxes = { m0: box(200, 200), m1: box(40, 200), m7: box(380, 200) };
    expect(topicHandles(body, "m1", boxes)).toEqual({ child: "w", sibling: "s" });
    expect(topicHandles(body, "m7", boxes)).toEqual({ child: "e", sibling: "s" });
  });

  it("moves the sibling's to the right for a topic that grows up or down the page", () => {
    const boxes = { m0: box(200, 200), m1: box(200, 40), m7: box(200, 380) };
    expect(topicHandles(body, "m1", boxes)).toEqual({ child: "n", sibling: "e" });
    expect(topicHandles(body, "m7", boxes)).toEqual({ child: "s", sibling: "e" });
  });

  it("gives the root a child on its right and no sibling", () => {
    expect(topicHandles(body, "m0", { m0: box(200, 200) })).toEqual({ child: "e", sibling: null });
  });
});
