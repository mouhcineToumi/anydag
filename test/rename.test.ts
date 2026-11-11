import { describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { renameItemId, renameNodeLinks } from "@/board/rename";

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
    const text = '```md {#a x=0 y=0}\nA\n```\n\n```arch {#b x=0 y=0}\nservice x "X"\n```\n\n```edges {#l}\na.node --> b\n```\n';
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

/**
 * Following a rename of a node *inside* an item: `sales.web` → `sales.online` in every `edges` line,
 * and nothing else on the board.
 */
describe("renameNodeLinks", () => {
  const CHART = `---
title: Follow
---

\`\`\`md {#notes x=0 y=0}
Why.
\`\`\`

\`\`\`chart {#sales x=200 y=0}
bar
x Q1 Q2
series web "Web" 1 2
series webx "Web X" 3 4
\`\`\`

\`\`\`chart {#shop x=600 y=0}
bar
x Q1 Q2
series web "Web" 5 6
\`\`\`

\`\`\`edges
notes --> sales.web "why it grew"
notes --> sales.webx
notes --> shop.web
notes --> sales
sales.web --> shop.web --> notes hue=teal
\`\`\`
`;

  it("renames the node half of an exact item.node reference, keeping the label and the rest", () => {
    const r = renameNodeLinks(CHART, "sales", "web", "online");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain('notes --> sales.online "why it grew"');
    expect(r.text).toContain("sales.online --> shop.web --> notes hue=teal");
  });

  it("changes nothing but those references: other nodes, other items and the item itself stay", () => {
    const r = renameNodeLinks(CHART, "sales", "web", "online");
    if (!r.ok) throw new Error(r.error);
    expect(r.text).toContain("notes --> sales.webx\n");
    expect(r.text).toContain("notes --> shop.web\n");
    expect(r.text).toContain("notes --> sales\n");
    /* Every byte outside the two rewritten lines is the original's. */
    const want = CHART.replace('sales.web "why', 'sales.online "why').replace("sales.web --> shop", "sales.online --> shop");
    expect(r.text).toBe(want);
  });

  it("leaves a token alone when it is a whole literal item id", () => {
    const text = `${CHART}\n\`\`\`md {#sales.web x=0 y=300}\nI am an item.\n\`\`\`\n`;
    const r = renameNodeLinks(text, "sales", "web", "online");
    if (!r.ok) throw new Error(r.error);
    expect(r.text).toBe(text);
  });

  it("composes with the series rename into a board that still resolves", () => {
    const withDecl = CHART.replace('series web "Web" 1 2', 'series online "Web" 1 2');
    const r = renameNodeLinks(withDecl, "sales", "web", "online");
    if (!r.ok) throw new Error(r.error);
    const board = parseBoard("t", r.text);
    expect(board.errors).toEqual([]);
    expect(board.links.map((l) => `${l.from.item}.${l.from.node ?? ""}`)).toContain("sales.online");
  });

  it("is a no-op when the board has no link to follow, and refuses an item that is not there", () => {
    const plain = '```chart {#a x=0 y=0}\nbar\nseries web "W" 1\n```\n';
    const same = renameNodeLinks(plain, "a", "web", "online");
    expect(same).toEqual({ ok: true, text: plain });
    expect(renameNodeLinks(CHART, "ghost", "web", "online").ok).toBe(false);
    expect(renameNodeLinks(CHART, "sales", "web", "web")).toEqual({ ok: true, text: CHART });
  });
});
