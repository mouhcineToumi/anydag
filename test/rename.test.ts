import { describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { renameItemId } from "@/board/rename";

/**
 * Renaming an item across the whole board: its own declaration, and every `edges` reference to it.
 *
 * `restate.ts`'s `renameId` (`rebind.ts` underneath) is tested in `restate.test.ts` and covers a
 * different grammar — a DSL id inside one diagram's own body. This is the board-level rename: an
 * item id, reachable from `edges` fences that belong to no dialect at all.
 */

const BOARD = `---
title: Rename me
---

\`\`\`md {#a x=0 y=0}
A note.
\`\`\`

\`\`\`md
Loose, unnamed.
\`\`\`

\`\`\`md {#c x=0 y=0}
Another note.
\`\`\`

\`\`\`arch {#b x=200 y=0}
service svc "Svc"
\`\`\`

\`\`\`edges {#links}
a --> b "signs in"
b.svc --> c
c --> a
\`\`\`
`;

describe("renameItemId", () => {
  it("renames the fence's own #id", () => {
    const out = renameItemId(BOARD, "a", "actor");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("```md {#actor x=0 y=0}\nA note.\n```");
  });

  it("renames every whole-token reference in every edges fence", () => {
    const out = renameItemId(BOARD, "a", "actor");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain('actor --> b "signs in"');
    expect(out.text).toContain("c --> actor");
    /* `b.svc` names no `a` at all — nothing about it should change. */
    expect(out.text).toContain("b.svc --> c");
  });

  it("renames only the item half of an item.node reference, keeping the node", () => {
    const text = "```md {#a x=0 y=0}\nA\n```\n\n```arch {#b x=0 y=0}\nservice x \"X\"\n```\n\n```edges {#l}\na.node --> b\n```\n";
    const out = renameItemId(text, "a", "actor");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("actor.node --> b");
  });

  it("leaves a reference alone when the whole token is somebody else's literal id", () => {
    /* `a.b` is a real item here, not a split of `a` and node `b` — renaming `a` must not touch it. */
    const text = "```md {#a x=0 y=0}\nA\n```\n\n```md {#a.b x=0 y=0}\nDotted\n```\n\n```edges {#l}\na.b --> a\n```\n";
    const out = renameItemId(text, "a", "renamed");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("a.b --> renamed");
  });

  it("pins a truly anonymous fenced item's id while renaming it", () => {
    const text = "```md {x=0 y=0}\nAnon.\n```\n";
    const out = renameItemId(text, "md-1", "named");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toBe("```md {#named x=0 y=0}\nAnon.\n```\n");
  });

  it("wraps loose prose in a fence to rename it", () => {
    const out = renameItemId(BOARD, "md-1", "loose");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("```md {#loose}\nLoose, unnamed.\n```");
  });

  it("refuses a name already on the board", () => {
    const out = renameItemId(BOARD, "a", "b");
    expect(out.ok).toBe(false);
  });

  it("refuses an id that names nothing", () => {
    const out = renameItemId(BOARD, "nope", "x");
    expect(out.ok).toBe(false);
  });

  it("is a no-op renaming an id to itself", () => {
    const out = renameItemId(BOARD, "a", "a");
    expect(out.ok && out.text).toBe(BOARD);
  });

  it("leaves a clean parse behind, with every link still resolving", () => {
    const out = renameItemId(BOARD, "a", "actor");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const board = parseBoard("t", out.text);
    expect(board.errors).toEqual([]);
    expect(board.items.map((it) => it.id)).toEqual(["actor", "md-1", "c", "b", "links"]);
    expect(board.links.map((l) => [l.from.item, l.from.node, l.to.item, l.to.node])).toEqual([
      ["actor", undefined, "b", undefined],
      ["b", "svc", "c", undefined],
      ["c", undefined, "actor", undefined],
    ]);
  });
});
