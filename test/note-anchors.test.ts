import { describe, expect, it } from "vitest";
import { anchorBlock, anchorsOf, freshAnchor, remarkAnchors } from "../src/note/anchors";
import { load, saved, settle } from "../src/note/markdown";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root } from "mdast";

const NOTE = "# Plan ^top\n\nA paragraph\nover two lines. ^para-1\n\n- one\n- two ^li\n\n```js\nx ^no\n```\n\n> quoted ^q\n";

describe("block anchors", () => {
  it("finds every anchored block, with its words and its line", () => {
    expect(anchorsOf(NOTE).map((a) => [a.id, a.line, a.text])).toEqual([
      ["top", 1, "Plan"],
      ["para-1", 3, "A paragraph\nover two lines."],
      ["li", 7, "two"],
      ["q", 13, "quoted"],
    ]);
  });

  it("writes one on the end of a block's last line and touches nothing else", () => {
    const md = "First.\n\nSecond\nparagraph.\n\nThird.\n";
    const got = anchorBlock(md, md.indexOf("Second"), () => 0)!;
    expect(got.id).toBe("000000");
    expect(got.md).toBe("First.\n\nSecond\nparagraph. ^000000\n\nThird.\n");
  });

  it("hands back the anchor a block already has rather than writing a second", () => {
    expect(anchorBlock(NOTE, NOTE.indexOf("over"))).toEqual({ md: NOTE, id: "para-1" });
  });

  it("refuses a code block, which cannot carry one", () => {
    expect(anchorBlock(NOTE, NOTE.indexOf("x ^no"))).toBeNull();
  });

  it("never mints an anchor the note already has", () => {
    let i = 0;
    const seq = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    expect(freshAnchor(new Set(["000000"]), () => seq[i++]!)).toBe("gggggg");
  });

  it("survives the editor: an untouched anchored note saves byte for byte, and a touched block keeps its anchor", () => {
    const { blocks, loaded } = load(NOTE);
    const settled = settle(loaded, blocks);
    expect(saved(settled, blocks).body).toBe(NOTE);
    const para = blocks.find((b) => b.type === "paragraph")!;
    const edited = blocks.map((b) =>
      b === para ? { ...b, content: [{ type: "text" as const, text: "Rewritten. ^para-1", styles: {} }] } : b,
    );
    expect(anchorsOf(saved(settled, edited).body).map((a) => a.id)).toContain("para-1");
  });

  it("moves to the element in the read-only view", () => {
    const tree = unified().use(remarkParse).parse("Words here ^abc\n") as Root;
    remarkAnchors()(tree);
    const p = tree.children[0] as { data?: { hProperties?: { id?: string } }; children: { value: string }[] };
    expect(p.data?.hProperties?.id).toBe("^abc");
    expect(p.children[0]!.value).toBe("Words here");
  });
});
