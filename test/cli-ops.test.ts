import { describe, expect, it } from "vitest";

import { parseBoard } from "../src/board/parseBoard";
import { applyPatch, type PatchOp } from "../src/board/patch";

import type { Loaded } from "../cli/board";
import {
  addLinkOps,
  addPageOps,
  anchorAt,
  attrsOf,
  insertOps,
  linkOf,
  movePageOps,
  removeLinkOps,
  removePageOps,
  renamePageOps,
  restackOps,
  setLinkOps,
  withGroups,
} from "../cli/ops";

/**
 * The canvas's gestures as the CLI computes them, applied with the page's own `applyPatch`.
 *
 * Every assertion is about the **file** the ops make, because that is the only thing either writer
 * leaves behind: what the page would have committed and what this commits have to be the same
 * bytes, or the two writers disagree about what a gesture means.
 */

const BOARD = `\`\`\`arch {#stack x=0 y=0}
client web "Browser"
service api "API"
store db "Database"

web --> api
api --> db
\`\`\`

\`\`\`md {#intro x=600 y=0}
A note
\`\`\`

\`\`\`md {#aside x=600 y=200 group=g1}
Another
\`\`\`

\`\`\`md {#third x=600 y=400 group=g1}
A third
\`\`\`
`;

const loaded = (text: string): Loaded => ({ name: "t", text, base: "b", board: parseBoard("t", text) });

function apply(text: string, ops: PatchOp[]): string {
  const r = applyPatch(text, ops);
  if (!r.ok) throw new Error(r.error);
  return r.text;
}

describe("items", () => {
  it("inserts with a fresh id when the one given is taken, and renames the batch's groups", () => {
    const l = loaded(BOARD);
    const { ops, ids } = insertOps(
      l,
      [
        { type: "md", attrs: { id: "intro", group: "g1" }, body: "copy" },
        { type: "md", attrs: { id: "free", group: "g1" }, body: "copy 2" },
      ],
      undefined,
    );
    expect(ids[0]).not.toBe("intro");
    expect(ids[0]).toMatch(/^md-[a-z0-9]{4}$/);
    expect(ids[1]).toBe("free");
    const after = parseBoard("t", apply(BOARD, ops));
    const [a, b] = ids.map((id) => after.items.find((i) => i.id === id)!);
    /* A pasted group is a new group — together with itself, apart from the original. */
    expect(a!.group).toBe(b!.group);
    expect(a!.group).not.toBe("g1");
  });

  it("puts an item on a named page, and writes page-1 as nothing", () => {
    const paged = `---\npages:\n  - id: page-1\n    name: Board\n  - id: page-2\n    name: Design\n---\n\n${BOARD}`;
    const l = loaded(paged);
    const onTwo = insertOps(l, [{ type: "md", attrs: {}, body: "x" }], "Design");
    expect(onTwo.ops[0]).toMatchObject({ insert: { attrs: { page: "page-2" } } });
    const onOne = insertOps(l, [{ type: "md", attrs: { page: "page-9" }, body: "x" }], "page-1");
    expect("page" in (onOne.ops[0] as { insert: { attrs: object } }).insert.attrs).toBe(false);
    expect(() => insertOps(l, [{ type: "md", attrs: {}, body: "x" }], "nope")).toThrow(/no page `nope`/);
  });

  it("anchors a stack at a point, keeping its arrangement", () => {
    const moved = anchorAt(
      [
        { type: "md", attrs: { x: 100, y: 100 }, body: "" },
        { type: "md", attrs: { x: 300, y: 160 }, body: "" },
        { type: "md", attrs: {}, body: "" },
      ],
      { x: -40, y: 0 },
    );
    expect(moved.map((m) => [m.attrs.x, m.attrs.y])).toEqual([
      [-40, 0],
      [160, 60],
      [-40, 0],
    ]);
  });

  it("turns key=value into a SetOp's attributes the way the panel does", () => {
    const paged = `---\npages:\n  - id: page-1\n    name: Board\n  - id: page-2\n    name: Design\n---\n\n${BOARD}`;
    const l = loaded(paged);
    expect(attrsOf(l, { page: "Design", hue: "teal", w: 320, hidden: null })).toEqual({ page: "page-2", hue: "teal", w: 320, hidden: null });
    expect(attrsOf(l, { page: "page-1" })).toEqual({ page: null });
    expect(() => attrsOf(l, { hue: "purple" })).toThrow(/did you mean `violet`/);
    expect(() => attrsOf(l, { id: "x" })).toThrow(/item rename/);
  });

  it("widens a member to its whole group, as a click on one does", () => {
    expect(withGroups(loaded(BOARD), ["aside"])).toEqual(["aside", "third"]);
    expect(withGroups(loaded(BOARD), ["intro"])).toEqual(["intro"]);
  });

  it("restacks in file order, and backwards for the back", () => {
    const l = loaded(BOARD);
    expect(restackOps(l, ["intro", "stack"], "front")).toEqual([
      { id: "stack", move: "front" },
      { id: "intro", move: "front" },
    ]);
    expect(restackOps(l, ["intro", "stack"], "back")).toEqual([
      { id: "intro", move: "back" },
      { id: "stack", move: "back" },
    ]);
    const front = parseBoard("t", apply(BOARD, restackOps(l, ["stack"], "front")));
    expect(front.items.at(-1)!.id).toBe("stack");
  });
});

describe("pages", () => {
  const paged = `---\npages:\n  - id: page-1\n    name: Board\n  - id: page-2\n    name: Design\n---\n\n${BOARD.replace("{#intro x=600 y=0}", "{#intro x=600 y=0 page=page-2}")}`;

  it("adds one at the end with the next free id, and writes the whole list", () => {
    const { ops, id } = addPageOps(loaded(BOARD), "Notes");
    expect(id).toBe("page-2");
    const after = parseBoard("t", apply(BOARD, ops));
    expect(after.pages).toEqual([
      { id: "page-1", name: "Board" },
      { id: "page-2", name: "Notes" },
    ]);
  });

  it("renames by id or by name", () => {
    const after = parseBoard("t", apply(paged, renamePageOps(loaded(paged), "Design", "Drafts")));
    expect(after.pages.map((p) => p.name)).toEqual(["Board", "Drafts"]);
  });

  it("moves what was on a removed page to the first one, and refuses the last page", () => {
    const after = parseBoard("t", apply(paged, removePageOps(loaded(paged), "page-2")));
    expect(after.pages.map((p) => p.id)).toEqual(["page-1"]);
    expect(after.items.find((i) => i.id === "intro")!.page).toBe("page-1");
    expect(apply(paged, removePageOps(loaded(paged), "page-2"))).not.toContain("page=page-2");
    expect(() => removePageOps(loaded(BOARD), "page-1")).toThrow(/cannot have none/);
  });

  it("reorders, and writes nothing when the order would not change", () => {
    const after = parseBoard("t", apply(paged, movePageOps(loaded(paged), "page-2", "page-1")));
    expect(after.pages.map((p) => p.id)).toEqual(["page-2", "page-1"]);
    expect(movePageOps(loaded(paged), "page-2", null)).toEqual([]);
  });
});

describe("links", () => {
  it("makes an edges fence when the page has none, and appends to it when it has one", () => {
    const first = addLinkOps(loaded(BOARD), "intro", "stack.api", { label: "explains" }, "page-1");
    expect(first.into).toBe("edges");
    const once = apply(BOARD, first.ops);
    expect(once).toMatch(/```edges \{#edges-[a-z0-9]{4}\}\nintro --> stack\.api "explains"\n```/);
    const second = addLinkOps(loaded(once), "aside", "intro", { arrow: "-.->", hue: "teal", quiet: true }, "page-1");
    const twice = apply(once, second.ops);
    expect(twice).toContain('intro --> stack.api "explains"\naside -.-> intro hue=teal quiet');
    expect(parseBoard("t", twice).links).toHaveLength(2);
  });

  it("writes two cards of one diagram as an edge of that diagram, as the pointer does", () => {
    const made = addLinkOps(loaded(BOARD), "stack.web", "stack.db", {}, "page-1");
    expect(made.into).toBe("diagram");
    expect(apply(BOARD, made.ops)).toContain("api --> db\nweb --> db");
  });

  it("refuses an end that is not on the board, naming the nearest", () => {
    expect(() => addLinkOps(loaded(BOARD), "intr", "stack", {}, "page-1")).toThrow(/did you mean `intro`/);
    expect(() => addLinkOps(loaded(BOARD), "stack.apx", "intro", {}, "page-1")).toThrow(/did you mean `stack\.api`/);
  });

  it("sets the label, the bend and quiet on the right segment of a chain, and removes the whole line", () => {
    const chained = `${BOARD}\n\`\`\`edges {#links}\nintro --> aside --> third\n\`\`\`\n`;
    const l = loaded(chained);
    const second = linkOf(l, "aside", "third");
    expect(second.seg).toBe(1);
    const set = apply(chained, setLinkOps(second, { label: "then", via: { x: 320, y: -40 }, quiet: true }));
    expect(set).toContain('intro --> aside --> third "then" quiet via="320,-40"');
    const link = parseBoard("t", set).links.find((k) => k.to.item === "third")!;
    expect(link.label).toBe("then");
    expect(link.via).toEqual({ x: 320, y: -40 });
    const gone = apply(set, removeLinkOps(linkOf(loaded(set), "intro", "aside")));
    expect(parseBoard("t", gone).links).toEqual([]);
  });
});
