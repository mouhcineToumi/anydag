import { describe, expect, it } from "vitest";

import { itemsToText, textToItems } from "@/board/clipboard";
import { locateItems, renderFence } from "@/board/locate";
import { parseBoard } from "@/board/parseBoard";
import { applyPatch } from "@/board/patch";
import { TEMPLATES } from "@/board/templates";
import { DIAGRAM_TYPES, isItemType } from "@/board/types";
import { parseDiagram } from "@/dsl/parse";
import { parseChart } from "@/dsl/chart";
import { parseSequence } from "@/dsl/sequence";

/**
 * The edits a person makes on the canvas, as changes to the file.
 *
 * `board.test.ts` covers the one write the tool used to have — a move. These are the rest: retype a
 * body, delete an item, add one, paste several, and the identity rule that makes any of it possible
 * on an item nobody named. Every case checks the bytes around the edit as much as the edit itself,
 * because the failure that matters is the one where a delete also eats the paragraph above it.
 */

const BOARD = `---
title: Edit me
---

# A heading, loose in the file

\`\`\`md {#intro x=0 y=0}
Some prose.
\`\`\`

\`\`\`arch {#infra x=40 y=80 title="What runs where"}
service api "API"
\`\`\`

\`\`\`md
Anonymous.
\`\`\`

A closing paragraph.
`;

describe("locateItems", () => {
  it("names items exactly as parseBoard does", () => {
    const ids = locateItems(BOARD, isItemType).items.map((it) => it.id);
    expect(ids).toEqual(parseBoard("t", BOARD).items.map((it) => it.id));
    expect(ids).toEqual(["md-1", "intro", "infra", "md-2", "md-3"]);
  });

  it("gives each item the line its block starts on", () => {
    const lines = Object.fromEntries(locateItems(BOARD, isItemType).items.map((it) => [it.id, it.line]));
    expect(lines).toEqual({ "md-1": 5, intro: 7, infra: 11, "md-2": 15, "md-3": 19 });
    expect(parseBoard("t", BOARD).items.find((it) => it.id === "md-3")?.line).toBe(19);
  });

  it("numbers an anonymous item around an id somebody wrote", () => {
    /* `#md-1` is explicit and later in the file than the loose heading. Without the two-pass rule
       the heading takes `md-1` first and the written one is reported as a duplicate. */
    const text = "Loose.\n\n```md {#md-1}\nNamed.\n```\n\n```md\nAnonymous.\n```\n";
    const board = parseBoard("t", text);
    expect(board.errors).toEqual([]);
    expect(board.items.map((it) => it.id)).toEqual(["md-2", "md-1", "md-3"]);
  });

  it("spans exactly the block, fences included", () => {
    const infra = locateItems(BOARD, isItemType).items.find((it) => it.id === "infra")!;
    expect(BOARD.slice(infra.start, infra.end)).toBe('```arch {#infra x=40 y=80 title="What runs where"}\nservice api "API"\n```');
    const prose = locateItems(BOARD, isItemType).items.find((it) => it.id === "md-3")!;
    expect(BOARD.slice(prose.start, prose.end)).toBe("A closing paragraph.");
  });
});

describe("renderFence", () => {
  it("uses four backticks when the body closes three", () => {
    const out = renderFence("md", "#a", "text\n```\ncode\n```");
    expect(out.startsWith("````md {#a}\n")).toBe(true);
    expect(out.endsWith("\n````")).toBe(true);
    expect(parseBoard("t", out).items[0]?.body).toBe("text\n```\ncode\n```");
  });

  it("writes an empty body as two lines", () => {
    expect(renderFence("image", "#i src=a.png", "")).toBe("```image {#i src=a.png}\n```");
  });
});

describe("applyPatch — body", () => {
  it("replaces the body and nothing else", () => {
    const out = applyPatch(BOARD, [{ id: "infra", body: 'service api "API"\nstore db "DB"\napi --> db' }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain('```arch {#infra x=40 y=80 title="What runs where"}\nservice api "API"\nstore db "DB"\napi --> db\n```');
    expect(out.text.split("\n").length).toBe(BOARD.split("\n").length + 2);
    expect(parseBoard("t", out.text).items.map((it) => it.id)).toEqual(["md-1", "intro", "infra", "md-2", "md-3"]);
  });

  it("sets attributes and the body in one op", () => {
    const out = applyPatch(BOARD, [{ id: "intro", attrs: { w: 400 }, body: "New prose." }]);
    expect(out.ok && out.text).toContain("```md {#intro x=0 y=0 w=400}\nNew prose.\n```");
  });

  it("empties a body without leaving a blank line", () => {
    const out = applyPatch(BOARD, [{ id: "intro", body: "" }]);
    expect(out.ok && out.text).toContain("```md {#intro x=0 y=0}\n```\n");
  });

  it("fills an empty fence", () => {
    const text = "```image {#i src=a.png}\n```\n";
    const out = applyPatch(text, [{ id: "i", body: "A caption" }]);
    expect(out.ok && out.text).toBe("```image {#i src=a.png}\nA caption\n```\n");
  });

  it("lengthens the fence when the new body would close it", () => {
    const out = applyPatch(BOARD, [{ id: "intro", body: "```js\nlet x\n```" }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("````md {#intro x=0 y=0}\n```js\nlet x\n```\n````");
    expect(parseBoard("t", out.text).items.find((it) => it.id === "intro")?.body).toBe("```js\nlet x\n```");
  });

  it("retypes loose prose in place", () => {
    const out = applyPatch(BOARD, [{ id: "md-3", body: "A different paragraph." }]);
    expect(out.ok && out.text.endsWith("\nA different paragraph.\n")).toBe(true);
  });

  it("finishes an unclosed fence at the end of the file", () => {
    const out = applyPatch("```md {#a}\nold", [{ id: "a", body: "new" }]);
    expect(out.ok && out.text).toBe("```md {#a}\nnew");
    const bare = applyPatch("```md {#a}", [{ id: "a", body: "new" }]);
    expect(bare.ok && bare.text).toBe("```md {#a}\nnew");
  });
});

describe("applyPatch — anonymous items", () => {
  it("pins an item that has no #id, and the id it had stays its id", () => {
    const out = applyPatch(BOARD, [{ id: "md-2", attrs: { x: 8, y: 16 } }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("```md {#md-2 x=8 y=16}\nAnonymous.\n```");
    expect(parseBoard("t", out.text).items.map((it) => it.id)).toEqual(["md-1", "intro", "infra", "md-2", "md-3"]);
  });

  it("wraps loose prose in a fence to pin it", () => {
    const out = applyPatch(BOARD, [{ id: "md-1", attrs: { x: 8, y: 16 } }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("```md {#md-1 x=8 y=16}\n# A heading, loose in the file\n```");
    expect(parseBoard("t", out.text).items.map((it) => it.id)).toEqual(["md-1", "intro", "infra", "md-2", "md-3"]);
  });
});

describe("applyPatch — remove", () => {
  it("removes the block and the blank line that separated it", () => {
    const out = applyPatch(BOARD, [{ id: "infra", remove: true }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).not.toContain("infra");
    expect(out.text).toContain("Some prose.\n```\n\n```md\nAnonymous.");
    expect(parseBoard("t", out.text).items.map((it) => it.id)).toEqual(["md-1", "intro", "md-2", "md-3"]);
  });

  it("removes loose prose", () => {
    const out = applyPatch(BOARD, [{ id: "md-3", remove: true }]);
    expect(out.ok && out.text.endsWith("Anonymous.\n```\n")).toBe(true);
  });

  it("removes the first block after the frontmatter", () => {
    const out = applyPatch(BOARD, [{ id: "md-1", remove: true }]);
    expect(out.ok && out.text).toContain("---\ntitle: Edit me\n---\n\n```md {#intro x=0 y=0}");
  });

  it("removes several at once", () => {
    const out = applyPatch(BOARD, [
      { id: "intro", remove: true },
      { id: "md-3", remove: true },
      { id: "md-1", remove: true },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(parseBoard("t", out.text).items.map((it) => it.id)).toEqual(["infra", "md-1"]);
  });
});

/*
 * A delete takes the links that named what it deleted: a task card copied, linked to the
 * original, and then deleted left `md-j7up --> md-lz2u` behind — an `EB_LINK_UNKNOWN_ITEM` error on
 * a board with nothing on it anybody could point at.
 */
describe("applyPatch — remove takes its links", () => {
  const LINKED = `\`\`\`md {#task x=0 y=0 w=420}
![Update Linkedin Profile](dag:2ns8bnj0e0)
\`\`\`

\`\`\`md {#copy x=24 y=24 w=420}
![Update Linkedin Profile](dag:2ns8bnj0e0)
\`\`\`

\`\`\`arch {#infra x=600 y=0}
service api "API"
store db "DB"
\`\`\`

\`\`\`edges {#links}
task --> copy "blocks"
copy --> infra.api
infra --> task hue=teal
\`\`\`
`;
  const removed = (ids: string[]) => {
    const out = applyPatch(LINKED, ids.map((id) => ({ id, remove: true as const })));
    expect(out.ok).toBe(true);
    return out.ok ? out.text : "";
  };
  const linksOf = (text: string) => parseBoard("t", text).items.find((it) => it.id === "links")?.body;

  it("takes every statement naming the item, and nothing else", () => {
    const text = removed(["copy"]);
    expect(linksOf(text)).toBe("infra --> task hue=teal");
    expect(parseBoard("t", text).errors).toEqual([]);
  });

  it("counts a link into a card inside a diagram as naming the diagram", () => {
    expect(linksOf(removed(["infra"]))).toBe('task --> copy "blocks"');
  });

  it("leaves an empty fence where the last link went, as deleting that link by hand does", () => {
    const text = removed(["task", "copy"]);
    expect(linksOf(text)).toBe("");
    expect(parseBoard("t", text).errors).toEqual([]);
  });

  it("does not touch a link that named nothing before the patch", () => {
    const stale = LINKED.replace("infra --> task hue=teal", "infra --> task hue=teal\nghost --> task");
    const out = applyPatch(stale, [{ id: "copy", remove: true }]);
    expect(out.ok && linksOf(out.text)).toBe("infra --> task hue=teal\nghost --> task");
  });

  it("reads an item whose own id has a dot in it as that item, not as a card inside another", () => {
    const dotted = `\`\`\`md {#a x=0 y=0}\nA\n\`\`\`\n\n\`\`\`md {#a.b x=0 y=200}\nAB\n\`\`\`\n\n\`\`\`edges\na.b --> a\n\`\`\`\n`;
    const out = applyPatch(dotted, [{ id: "a.b", remove: true }]);
    expect(out.ok && out.text).toContain("```edges\n```");
    const kept = applyPatch(dotted.replace("a.b --> a", "a.b --> x"), [{ id: "a", remove: true }]);
    expect(kept.ok && kept.text).toContain("a.b --> x");
  });
});

describe("applyPatch — insert", () => {
  it("appends a fence with its id first", () => {
    const out = applyPatch(BOARD, [{ insert: { type: "md", attrs: { id: "new", x: 100, y: 200 }, body: "Hello" } }]);
    expect(out.ok && out.text.endsWith("A closing paragraph.\n\n```md {#new x=100 y=200}\nHello\n```\n")).toBe(true);
  });

  it("inserts after a named item", () => {
    const out = applyPatch(BOARD, [{ insert: { type: "md", attrs: { id: "new" }, body: "Hello" }, after: "intro" }]);
    expect(out.ok && out.text).toContain("Some prose.\n```\n\n```md {#new}\nHello\n```\n\n```arch {#infra");
  });

  it("refuses an id already on the board, and a type it does not know", () => {
    expect(applyPatch(BOARD, [{ insert: { type: "md", attrs: { id: "intro" }, body: "" } }]).ok).toBe(false);
    expect(applyPatch(BOARD, [{ insert: { type: "svg", attrs: { id: "z" }, body: "" } }]).ok).toBe(false);
    expect(applyPatch(BOARD, [{ insert: { type: "md", attrs: {}, body: "" } }]).ok).toBe(false);
  });

  it("appends several in the order they were given", () => {
    /* Two appends have the same offset — past the end — so they cannot join the descending sort
       that keeps the other ops' offsets valid, and running them backwards put a three-item paste
       in the file as C, B, A. */
    const out = applyPatch(BOARD, [
      { insert: { type: "md", attrs: { id: "a" }, body: "One" } },
      { insert: { type: "md", attrs: { id: "b" }, body: "Two" } },
      { insert: { type: "md", attrs: { id: "c" }, body: "Three" } },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(parseBoard("t", out.text).items.slice(-3).map((it) => it.id)).toEqual(["a", "b", "c"]);
  });

  it("appends to an empty file", () => {
    const out = applyPatch("", [{ insert: { type: "md", attrs: { id: "a" }, body: "One" } }]);
    expect(out.ok && out.text).toBe("```md {#a}\nOne\n```\n");
  });

  it("mixes inserts, removes and moves in one patch", () => {
    const out = applyPatch(BOARD, [
      { id: "infra", remove: true },
      { insert: { type: "state", attrs: { id: "s", x: 0, y: 0 }, body: TEMPLATES.state } },
      { id: "intro", attrs: { x: 640 } },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const board = parseBoard("t", out.text);
    expect(board.errors).toEqual([]);
    expect(board.items.map((it) => it.id)).toEqual(["md-1", "intro", "md-2", "md-3", "s"]);
    expect(board.items.find((it) => it.id === "intro")?.x).toBe(640);
  });
});

describe("applyPatch — z-order (MoveOp)", () => {
  it("brings an item to the front of its page's stack", () => {
    const out = applyPatch(BOARD, [{ id: "intro", move: "front" }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(parseBoard("t", out.text).items.map((it) => it.id)).toEqual(["md-1", "infra", "md-2", "md-3", "intro"]);
  });

  it("sends an item to the back, pinning an anonymous one's auto id along the way", () => {
    /* `md-2` is `\`\`\`md\nAnonymous.\n\`\`\`` — no braces at all — so this also proves a move pins
       an unnamed item's id the way a drag does: without it, reordering could hand `md-2`'s auto id
       to whichever anonymous item is now encountered first. */
    const out = applyPatch(BOARD, [{ id: "md-2", move: "back" }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("```md {#md-2}\nAnonymous.\n```");
    const board = parseBoard("t", out.text);
    expect(board.errors).toEqual([]);
    expect(board.items.map((it) => it.id)).toEqual(["md-2", "md-1", "intro", "infra", "md-3"]);
  });

  it("moves beside a named item, pinning loose prose into a fence to do it", () => {
    /* `md-3` is loose prose with no fence at all — "before infra" has nowhere to write an id
       without wrapping it, the same rule `SetOp` follows when a drag pins a paragraph. */
    const out = applyPatch(BOARD, [{ id: "md-3", move: { before: "infra" } }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("```md {#md-3}\nA closing paragraph.\n```");
    expect(parseBoard("t", out.text).items.map((it) => it.id)).toEqual(["md-1", "intro", "md-3", "infra", "md-2"]);
  });

  it("moves after a named item", () => {
    const out = applyPatch(BOARD, [{ id: "infra", move: { after: "md-2" } }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(parseBoard("t", out.text).items.map((it) => it.id)).toEqual(["md-1", "intro", "md-2", "infra", "md-3"]);
  });

  it("lands right after the frontmatter when the target is the file's first item", () => {
    const out = applyPatch(BOARD, [{ id: "infra", move: { before: "md-1" } }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const board = parseBoard("t", out.text);
    expect(board.title).toBe("Edit me");
    expect(board.items.map((it) => it.id)).toEqual(["infra", "md-1", "intro", "md-2", "md-3"]);
  });

  it("refuses a target that names nothing", () => {
    expect(applyPatch(BOARD, [{ id: "infra", move: { after: "nope" } }]).ok).toBe(false);
    expect(applyPatch(BOARD, [{ id: "nope", move: "front" }]).ok).toBe(false);
  });

  it("is a no-op when there is nothing to reorder against", () => {
    /* A single-item board: "front" has no other page member to land beside. */
    const solo = "```md {#only x=0 y=0}\nAlone.\n```\n";
    const out = applyPatch(solo, [{ id: "only", move: "front" }]);
    expect(out.ok && out.text).toBe(solo);
  });

  it("only reorders within the mover's own page", () => {
    const text = [
      "```md {#a x=0 y=0}\nA\n```",
      "```md {#b x=0 y=0 page=page-2}\nB\n```",
      "```md {#c x=0 y=0}\nC\n```",
    ].join("\n\n");
    const out = applyPatch(text, [{ id: "a", move: "front" }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    /* `a` jumps past `c` — its only page-1 neighbour — not past `b`, which is on `page-2` and
       physically sits between them in the file. */
    expect(parseBoard("t", out.text).items.map((it) => it.id)).toEqual(["b", "c", "a"]);
  });

  it("is idempotent: moving twice is the same as moving once", () => {
    const once = applyPatch(BOARD, [{ id: "md-2", move: "front" }]);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = applyPatch(once.text, [{ id: "md-2", move: "front" }]);
    expect(twice.ok && twice.text).toBe(once.text);
  });

  it("carries several moves and a page all at once, one commit's worth", () => {
    const out = applyPatch(BOARD, [
      { id: "intro", move: "front" },
      { id: "md-1", move: "back" },
      { meta: { title: "Renamed" } },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const board = parseBoard("t", out.text);
    expect(board.title).toBe("Renamed");
    expect(board.items.map((it) => it.id)).toEqual(["md-1", "infra", "md-2", "md-3", "intro"]);
  });
});

describe("groups on the fence line", () => {
  it("reads `group=` and keeps it through a move", () => {
    const text = "```md {#a x=0 y=0 group=g1}\nA\n```\n\n```md {#b group=g1}\nB\n```\n";
    const board = parseBoard("t", text);
    expect(board.items.map((it) => it.group)).toEqual(["g1", "g1"]);
    const out = applyPatch(text, [{ id: "a", attrs: { x: 8, y: 8 } }, { id: "b", attrs: { group: null } }]);
    expect(out.ok && out.text).toBe("```md {#a x=8 y=8 group=g1}\nA\n```\n\n```md {#b}\nB\n```\n");
  });
});

describe("the clipboard flavour", () => {
  it("is the items' own source, and reads back as the same items", () => {
    const board = parseBoard("t", BOARD);
    const text = itemsToText(board.items.filter((it) => it.id === "infra" || it.id === "md-3"));
    expect(text).toBe(
      '```arch {#infra x=40 y=80 title="What runs where"}\nservice api "API"\n```\n\n```md {#md-3}\nA closing paragraph.\n```',
    );
    const back = textToItems(text);
    expect(back.map((n) => [n.type, n.attrs.id, n.body])).toEqual([
      ["arch", "infra", 'service api "API"'],
      ["md", "md-3", "A closing paragraph."],
    ]);
  });

  it("keeps a note a note", () => {
    const board = parseBoard("t", "```note {#n}\nRemember.\n```\n");
    expect(itemsToText(board.items)).toBe("```md {#n note}\nRemember.\n```");
    expect(textToItems("```note {#n}\nRemember.\n```")[0]?.attrs.note).toBe(true);
  });

  it("makes a note out of text that is not a board", () => {
    expect(textToItems("  Just a sentence.\r\nAnd another.  ")).toEqual([
      { type: "md", attrs: {}, body: "Just a sentence.\nAnd another." },
    ]);
    expect(textToItems("   ")).toEqual([]);
  });
});

describe("templates", () => {
  it("draw without a single diagnostic", () => {
    for (const type of DIAGRAM_TYPES) {
      const model =
        type === "sequence"
          ? parseSequence(TEMPLATES[type])
          : type === "chart"
            ? parseChart(TEMPLATES[type])
            : parseDiagram(type, TEMPLATES[type]);
      expect(model, type).not.toBeNull();
      expect(model!.diagnostics.map((d) => `${type}: ${d.code} ${d.message}`)).toEqual([]);
    }
  });
});
