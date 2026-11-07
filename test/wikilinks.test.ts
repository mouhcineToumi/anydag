/** `[[wikilinks]]` and `![[embeds]]`, resolved by name. */
import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import { blocksToMd, load, mdToBlocks, saved, settle } from "../src/note/markdown";
import { indexTexts, refsInMarkdown, resolveWikiRefs } from "../src/refs/extract";
import { parseWikiUrl, resolveWiki, wikiLabel, wikilinksIn, wikilinkTree, wikiUrl } from "../src/refs/wikilinks";

describe("wikilinksIn", () => {
  it("reads a target, a part after #, and an alias after |", () => {
    const [a, b, c, d] = wikilinksIn("[[Meeting notes]] [[Plan#Budget]] [[Plan|the plan]] ![[Projects/Plan#^b1|see]]");
    expect(a).toMatchObject({ embed: false, target: "Meeting notes", raw: "[[Meeting notes]]", index: 0 });
    expect(b).toMatchObject({ target: "Plan", part: "Budget" });
    expect(c).toMatchObject({ target: "Plan", alias: "the plan" });
    expect(d).toMatchObject({ embed: true, target: "Projects/Plan", part: "^b1", alias: "see" });
  });

  it("takes a table's escaped bar for the alias, and a bare heading for this note", () => {
    expect(wikilinksIn("[[Plan\\|alias]]")[0]).toMatchObject({ target: "Plan", alias: "alias" });
    expect(wikilinksIn("[[#Goals]]")[0]).toMatchObject({ target: "", part: "Goals" });
  });

  it("finds nothing in a single bracket, an empty pair or across a line", () => {
    expect(wikilinksIn("[a] [[]] [[a\nb]]")).toEqual([]);
  });

  it("says a link's words", () => {
    expect(wikiLabel({ target: "Plan" })).toBe("Plan");
    expect(wikiLabel({ target: "Plan", part: "Budget" })).toBe("Plan › Budget");
    expect(wikiLabel({ target: "Plan", alias: "the plan" })).toBe("the plan");
  });

  it("carries a target with spaces and a # through its URL", () => {
    const url = wikiUrl("Meeting notes/2026 #3", "A heading");
    expect(parseWikiUrl(url)).toEqual({ target: "Meeting notes/2026 #3", part: "A heading" });
    expect(parseWikiUrl("dag:k3f9x2m1qa")).toBeNull();
  });
});

describe("the remark plugin", () => {
  const tree = (md: string) => {
    const t = unified().use(remarkParse).use(remarkGfm).parse(md) as Root;
    wikilinkTree(t);
    return t;
  };

  it("makes a link and an image, and leaves code and a link's own text alone", () => {
    const t = tree("See [[Plan]] and ![[pic.png]].\n\n`[[not]]`\n\n```\n[[nor]]\n```\n\n[a [[b]] c](https://x.y)\n");
    const para = t.children[0] as { children: { type: string; url?: string }[] };
    expect(para.children.map((c) => c.type)).toEqual(["text", "link", "text", "image", "text"]);
    expect(para.children[1]!.url).toBe("wiki:Plan");
    const json = JSON.stringify(t.children.slice(1));
    expect(json).not.toContain("wiki:");
  });
});

describe("resolveWiki", () => {
  const docs = [
    { id: "a000000001", name: "Meeting notes", kind: "note" },
    { id: "a000000002", name: "Projects/Plan", kind: "note" },
    { id: "a000000003", name: "Archive/Old/Plan", kind: "note" },
    { id: "a000000004", name: "attachments/pic.png", kind: "file" },
    { id: "a000000005", name: "roadmap", kind: "board", title: "The Roadmap" },
  ];
  const id = (t: string) => resolveWiki(t, docs)?.id;

  it("matches a name, its tail, any case, the shortest path first", () => {
    expect(id("Meeting notes")).toBe("a000000001");
    expect(id("meeting NOTES")).toBe("a000000001");
    expect(id("Plan")).toBe("a000000002");
    expect(id("Old/Plan")).toBe("a000000003");
    expect(id("Archive/Old/Plan")).toBe("a000000003");
  });

  it("takes a note's .md, a board's suffix and an attachment's extension", () => {
    expect(id("Meeting notes.md")).toBe("a000000001");
    expect(id("roadmap.board")).toBe("a000000005");
    expect(id("pic.png")).toBe("a000000004");
    expect(id("pic")).toBeUndefined();
  });

  it("falls back to a title, and names nothing else", () => {
    expect(id("the roadmap")).toBe("a000000005");
    expect(id("Nowhere")).toBeUndefined();
    expect(id("  ")).toBeUndefined();
  });
});

/* The resolution `resolveWiki` was before it kept an index: three passes over every document per
   link. Held here as the meaning the index must keep, on vaults made to collide. */
function naive<D extends { name: string; title?: string | null }>(target: string, docs: readonly D[]): D | undefined {
  const fold = (s: string) => s.normalize("NFC").toLowerCase().replace(/\\/g, "/").replace(/^\.?\/+/, "");
  const t = fold(target.trim());
  if (!t) return undefined;
  const bare = t.replace(/\.md$/, "").replace(/\.(?:note|board|quiz|table)$/, "");
  const wants = new Set([t, bare]);
  const leafOf = (n: string) => n.slice(n.lastIndexOf("/") + 1);
  const pick = (hits: D[]) => hits.sort((a, b) => a.name.length - b.name.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))[0];
  const exact = docs.filter((d) => wants.has(fold(d.name)));
  if (exact.length) return pick(exact);
  const tail = docs.filter((d) => {
    const n = fold(d.name);
    for (const w of wants) if (w.includes("/") ? n.endsWith(`/${w}`) : leafOf(n) === w) return true;
    return false;
  });
  if (tail.length) return pick(tail);
  const titled = docs.filter((d) => d.title && wants.has(fold(d.title)));
  return titled.length ? pick(titled) : undefined;
}

describe("resolveWiki's index", () => {
  it("answers exactly what three passes over the list did, on vaults made to collide", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    const words = ["Plan", "plan", "Notes", "a", "B", "Été", "x.md", "roadmap"];
    const kinds = ["note", "board", "quiz", "table", "file"];
    for (let round = 0; round < 40; round++) {
      const docs = Array.from({ length: 30 }, (_, i) => {
        const depth = rnd(4);
        const name = [...Array.from({ length: depth }, () => words[rnd(words.length)]), words[rnd(words.length)]].join("/");
        return { id: `d${round}-${i}`, name, kind: kinds[rnd(kinds.length)]!, title: rnd(3) ? null : words[rnd(words.length)] };
      });
      const targets = [...words, ...docs.map((d) => d.name), ...docs.map((d) => d.name.toUpperCase()), "plan.md", "a/plan", "/Plan", "./notes/a", "roadmap.board", "", "  ", "nowhere"];
      for (const t of targets) expect(resolveWiki(t, docs)?.id, `${t} in round ${round}`).toBe(naive(t, docs)?.id);
    }
  });

  it("resolves a vault's worth of links in a moment", () => {
    const docs = Array.from({ length: 5000 }, (_, i) => ({ id: `x${i}`, name: `folder${i % 50}/note ${i}`, kind: "note", title: `Note ${i}` }));
    const started = performance.now();
    for (let i = 0; i < 150_000; i++) resolveWiki(`note ${i % 5000}`, docs);
    /* Three passes per link took about five minutes for this; the index is a few lookups. */
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe("the index", () => {
  it("counts a wikilink with no id, and the vault's list gives it one", () => {
    const refs = refsInMarkdown("[[Plan|p]], ![[pic.png]], [x](dag:k3f9x2m1qa) and `[[code]]`");
    expect(refs).toEqual([
      { id: "", wiki: "Plan", type: "link", text: "p" },
      { id: "", wiki: "pic.png", type: "embed", text: "pic.png" },
      { id: "k3f9x2m1qa", type: "link", text: "x" },
    ]);
    const docs = [{ id: "b000000001", name: "Plan", kind: "note" }];
    expect(resolveWikiRefs(refs, docs).map((r) => r.id)).toEqual(["b000000001", "", "k3f9x2m1qa"]);
  });

  it("reads a note's wikilinks past its frontmatter", () => {
    const got = indexTexts({ "a.note.md": "---\ntitle: A\n---\nSee [[B]].\n" });
    expect(got["a.note.md"]!.refs).toEqual([{ id: "", wiki: "B", type: "link", text: "B" }]);
  });
});

describe("the note editor", () => {
  it("holds a wikilink as a reference and writes it back as it was written", () => {
    const md = "See [[Meeting notes]] and [[a#h|alias]] here.";
    const blocks = mdToBlocks(md);
    expect(blocks[0]!.content).toEqual([
      { type: "text", text: "See ", styles: {} },
      { type: "ref", props: { href: "wiki:Meeting%20notes", title: "[[Meeting notes]]" } },
      { type: "text", text: " and ", styles: {} },
      { type: "ref", props: { href: "wiki:a#h", title: "[[a#h|alias]]" } },
      { type: "text", text: " here.", styles: {} },
    ]);
    expect(blocksToMd(blocks)).toBe(md);
  });

  it("holds an embed alone on its line as an embed block", () => {
    const blocks = mdToBlocks("![[Projects/Plan]]");
    expect(blocks).toEqual([{ type: "embed", props: { href: "wiki:Projects%2FPlan", title: "![[Projects/Plan]]" } }]);
    expect(blocksToMd(blocks)).toBe("![[Projects/Plan]]");
  });

  it("does not escape a wikilink typed as text, nor one in a block somebody edited", () => {
    expect(blocksToMd([{ type: "paragraph", content: [{ type: "text", text: "x [[New]] y", styles: {} }] }])).toBe("x [[New]] y");
    const body = "# Title\n\nSee **[[Plan]]** now.\n";
    const { blocks, loaded } = load(body);
    const held = settle(loaded, blocks);
    const edited = blocks.map((b, i) => (i === 1 ? { ...b, content: [...(b.content as object[]), { type: "text", text: "!", styles: {} }] } : b));
    expect(saved(held, edited as never).body).toBe("# Title\n\nSee **[[Plan]]** now.!\n");
  });
});
