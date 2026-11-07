import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Nodes, Root } from "mdast";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { beforeAll, describe, expect, it } from "vitest";

import { remarkMath } from "@/note/math";
import { blocksToMd, load, mdToBlocks, save, settle, type NoteBlock } from "@/note/markdown";
import { noteSchema } from "@/note/schema";
import { refsInMarkdown } from "@/refs/extract";
import { CodePre, MathCode } from "@/render/CodeBlock";
import { loadKatex } from "@/render/Math";
import { noteCorpus } from "@/search/corpus";

/**
 * Equations. What `$…$` is (Pandoc's rule, inside the tokenizer), what the
 * note bridge makes of it and writes back, and what a read-only page draws. The editor's gestures are
 * a browser's (`e2e/math.spec.ts`).
 */

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** Every equation in `md`, in order: `$tex` inline, `$$tex` inline display, `B:tex` a block. */
function equations(md: string): string[] {
  const out: string[] = [];
  const walk = (n: Nodes) => {
    if (n.type === "inlineMath") {
      const classes = n.data?.hProperties?.className;
      out.push(`${Array.isArray(classes) && classes.includes("math-display") ? "$$" : "$"}${n.value}`);
    } else if (n.type === "math") out.push(`B:${n.value}`);
    if ("children" in n) for (const c of n.children as Nodes[]) walk(c);
  };
  walk(parser.parse(md) as Root);
  return out;
}

describe("a single dollar follows Pandoc's rule", () => {
  it("reads a formula that hugs its dollars", () => {
    expect(equations("the matrix $W_Q$ and $x^2$.")).toEqual(["$W_Q", "$x^2"]);
    expect(equations("$\\arg\\max$ and $T = 0$ then $10^{-7}$ [12]")).toEqual(["$\\arg\\max", "$T = 0", "$10^{-7}"]);
  });

  it("leaves a price a price — a space inside a dollar, or a digit after the closing one", () => {
    expect(equations("between $5 and $10 dollars")).toEqual([]);
    expect(equations("price $5,$10")).toEqual([]);
    expect(equations("a $ x $ b")).toEqual([]);
    expect(equations("Clients closed over $1.2M in sales in 12 months.")).toEqual([]);
  });

  it("tries only the first closing dollar, so a price before a formula is still a price", () => {
    expect(equations("costs $5 and the formula $x$")).toEqual(["$x"]);
  });

  it("keeps the Markdown between two prices", () => {
    const md = "costs $5 and **really** $10";
    expect(equations(md)).toEqual([]);
    expect(blocksToMd(mdToBlocks(md))).toBe(md);
  });

  it("reads `\\$` as a dollar outside a formula and inside one", () => {
    expect(equations("x \\$y$ z$")).toEqual([]);
    expect(equations("$a\\$ b$ and $a \\\\$")).toEqual(["$a\\$ b", "$a \\\\"]);
  });

  it("reads `$$` mid-line as display, and `$$` lines and a math fence as a block", () => {
    expect(equations("weights:$$Q = X W_Q, \\quad K$$Where it")).toEqual(["$$Q = X W_Q, \\quad K"]);
    expect(equations("$$\n\\frac{a}{b}\n$$")).toEqual(["B:\\frac{a}{b}"]);
    expect(mdToBlocks("```math\nx^2\n```")).toEqual([{ type: "equation", props: { tex: "x^2", fenced: true } }]);
  });
});

describe("the note bridge", () => {
  const md = [
    "Hello $x^2$, and display $$E=mc^2$$ mid-line, at $5 or $10.",
    "",
    "$$",
    "\\int_0^1 f(x)\\,dx",
    "$$",
    "",
    "```math",
    "y = mx + b",
    "```",
  ].join("\n");

  it("holds an inline equation as inline content and a display one as a block", () => {
    const blocks = mdToBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "equation", "equation"]);
    expect(blocks[0].content).toEqual([
      { type: "text", text: "Hello ", styles: {} },
      { type: "math", props: { tex: "x^2", display: false } },
      { type: "text", text: ", and display ", styles: {} },
      { type: "math", props: { tex: "E=mc^2", display: true } },
      { type: "text", text: " mid-line, at $5 or $10.", styles: {} },
    ]);
    expect(blocks[1].props).toEqual({ tex: "\\int_0^1 f(x)\\,dx", fenced: false });
  });

  it("writes each one back the way it was written, prices unescaped", () => {
    expect(blocksToMd(mdToBlocks(md))).toBe(md);
  });

  it("holds an equation in a table cell", () => {
    const table = "| a | b |\n| - | - |\n| $\\alpha$ | 1 |";
    expect(mdToBlocks(table)[0].type).toBe("table");
    expect(blocksToMd(mdToBlocks(table))).toContain("| $\\alpha$ | 1 |");
  });

  it("writes an untouched note back byte for byte", () => {
    const body = `${md}\n`;
    const { blocks, loaded } = load(body);
    expect(save(settle(loaded, blocks), blocks)).toBe(body);
  });

  it("escapes a dollar only when it would otherwise come back as an equation", () => {
    const literal: NoteBlock = {
      type: "paragraph",
      content: [{ type: "text", text: "a literal $x$ here", styles: {} }] as never,
    };
    expect(blocksToMd([literal])).toBe("a literal \\$x\\$ here");
    expect(mdToBlocks(blocksToMd([literal]))[0].content).toEqual(literal.content);
  });

  it("writes TeX a file can hold — no space inside the dollars, nothing for an emptied one", () => {
    const p = (tex: string, display = false): NoteBlock => ({
      type: "paragraph",
      content: [
        { type: "text", text: "a ", styles: {} },
        { type: "math", props: { tex, display } },
        { type: "text", text: " b", styles: {} },
      ] as never,
    });
    expect(blocksToMd([p(" x + 1 ")])).toBe("a $x + 1$ b");
    expect(blocksToMd([p("")])).toBe("a  b");
    expect(blocksToMd([p("E", true)])).toBe("a $$E$$ b");
    expect(blocksToMd([{ type: "equation", props: { tex: "\n\nx\n\n", fenced: false } }])).toBe("$$\nx\n$$");
    expect(blocksToMd([{ type: "equation", props: { tex: "", fenced: false } }])).toBe("$$\n$$");
  });

  it("keeps the equations through the editor's own schema", async () => {
    const server = ServerBlockNoteEditor.create({ schema: noteSchema });
    const held = await server._withJSDOM(async () => {
      server.editor.replaceBlocks(server.editor.document, mdToBlocks(md) as never);
      return JSON.parse(JSON.stringify(server.editor.document)) as NoteBlock[];
    });
    expect(blocksToMd(held)).toBe(blocksToMd(mdToBlocks(md)));
  });
});

describe("the other parsers read the same equations", () => {
  it("a reference inside an equation is TeX, not a reference", () => {
    expect(refsInMarkdown("$[x](dag:0123456789abcdef)$ and [y](dag:abcdefghij)").map((r) => r.id)).toEqual(["abcdefghij"]);
  });

  it("an equation's TeX is what search finds", () => {
    const { units } = noteCorpus("Intro.\n\n$$\n\\operatorname{softmax}(z)\n$$\n");
    expect(units.some((u) => u.text.includes("\\operatorname{softmax}(z)"))).toBe(true);
  });
});

describe("a read-only page", () => {
  beforeAll(async () => {
    await loadKatex();
  });

  const draw = (md: string) =>
    renderToStaticMarkup(
      createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMath], components: { pre: CodePre, code: MathCode } }, md),
    );

  it("draws an inline equation in its line and a display one as a block", () => {
    const html = draw("Let $x^2$ be.\n\n$$\n\\frac{a}{b}\n$$");
    expect(html).toMatch(/<p>Let <span class="dag-math dag-math--inline" data-dag-math=""><span class="katex">/);
    expect(html).toMatch(/<div class="dag-math dag-math--display dag-math--block" data-dag-math=""><span class="katex-display">/);
    expect(html).not.toContain("dag-code");
  });

  it("draws `$$` mid-line as display, in spans, so the paragraph is still a paragraph", () => {
    const html = draw("before:$$E=mc^2$$after");
    expect(html).toMatch(/<p>before:<span class="dag-math dag-math--display" data-dag-math=""><span class="katex-display">/);
    expect(html).not.toMatch(/<p>[^]*<div/);
  });

  it("draws a math fence as an equation, and any other fence as code", () => {
    expect(draw("```math\nx\n```")).toContain("dag-math--block");
    expect(draw("```ts\nx\n```")).toContain('data-dag-code="ts"');
  });

  it("shows the TeX of an equation that does not parse, with KaTeX's words as its title", () => {
    const html = draw("bad $\\frac{a$ here");
    expect(html).toContain('data-dag-math="error"');
    expect(html).toMatch(/title="KaTeX parse error/);
    expect(html).toContain("\\frac{a");
  });

  it("leaves inline code alone", () => {
    expect(draw("run `npm test` now")).toContain("<code>npm test</code>");
  });
});
