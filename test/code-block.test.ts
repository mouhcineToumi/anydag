import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { codeLanguage, codeOfPre } from "@/render/code";
import { CodePre } from "@/render/CodeBlock";
import { loadSyntax } from "@/render/syntax";

/**
 * A code block's language and copy button, as the read-only pages draw them. What is held
 * here: the copy is exactly what is between the fences — through `react-markdown`'s own pipeline,
 * which adds a newline the file never had — the label says what the fence says, and a snapshot draws
 * the label and never the button. The editor's half is a browser's (`e2e/code-copy.spec.ts`).
 */

/** Draws `md` the way every read-only page does, and says what each `<pre>` would copy. */
function draw(md: string): { html: string; copies: ReturnType<typeof codeOfPre>[] } {
  const copies: ReturnType<typeof codeOfPre>[] = [];
  const pre = (props: ComponentProps<"pre"> & ExtraProps) => {
    copies.push(codeOfPre(props.node));
    return createElement(CodePre, props);
  };
  const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], components: { pre } }, md));
  return { html, copies };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a code block's language", () => {
  it("is the fence's word, or text when it names none", () => {
    expect(codeLanguage("python")).toBe("python");
    expect(codeLanguage("  ts ")).toBe("ts");
    expect(codeLanguage("")).toBe("text");
    expect(codeLanguage(null)).toBe("text");
    expect(codeLanguage(undefined)).toBe("text");
  });

  /* In a language nothing colours, so the text is exactly what the renderer gave: the suite shares
     modules between files (`isolate: false`), and a language another file loaded stays loaded. */
  it("is drawn above the text", () => {
    const { html } = draw("```pseudo\nprint(1)\n```\n");
    expect(html).toContain('data-dag-code="pseudo"');
    expect(html).toMatch(/<span class="dag-code__lang">pseudo<\/span>/);
    /* The head comes before the text, and the text is still a pre holding a code. */
    expect(html.indexOf("dag-code__head")).toBeLessThan(html.indexOf("<pre"));
    expect(html).toMatch(/<pre><code class="language-pseudo">print\(1\)\n<\/code><\/pre>/);
  });

  /* Once its language has landed, the same block is coloured and still holds the same text. */
  it("is coloured once its language has landed, and says what it could not read", async () => {
    await loadSyntax("python");
    const { html } = draw("```python\ndef f(:\n    return 1\n```\n");
    expect(html).toContain('<span class="dag-tok-keyword">def</span>');
    expect(html).toContain('data-dag-code-read="checked"');
    expect(html).toMatch(/<span class="dag-code__problems"[^>]*>1 syntax error<\/span>/);
    expect(html.replace(/<[^>]+>/g, "")).toContain("def f(:\n    return 1");
  });

  it("says text for a bare fence, which the note editor holds as one", () => {
    expect(draw("```\nplain\n```\n").copies[0]!.language).toBe("text");
    expect(draw("```text\nplain\n```\n").copies[0]!.language).toBe("text");
  });
});

describe("what the button copies", () => {
  it("is exactly what is between the fences", () => {
    const body = "const a = 1;\n\n  indented();\n// a <tag> & an \"entity\"";
    const { copies } = draw("Before.\n\n```js\n" + body + "\n```\n\nAfter.\n");
    expect(copies).toEqual([{ language: "js", text: body }]);
  });

  it("keeps a blank last line the file has, and takes only the newline the renderer added", () => {
    expect(draw("```\na\n\n```\n").copies[0]!.text).toBe("a\n");
  });

  it("is empty for an empty block", () => {
    expect(draw("```sh\n```\n").copies[0]).toEqual({ language: "sh", text: "" });
  });

  it("is every block's own, on a page of several", () => {
    const { copies } = draw("```a\none\n```\n\ntext\n\n~~~b\ntwo\n~~~\n\n    indented three\n");
    expect(copies).toEqual([
      { language: "a", text: "one" },
      { language: "b", text: "two" },
      { language: "text", text: "indented three" },
    ]);
  });

  it("does not read an inline code span as a block", () => {
    expect(draw("Some `inline` code.\n").copies).toEqual([]);
  });
});

describe("the button", () => {
  it("is drawn for somebody looking at the page", () => {
    const { html } = draw("```\nx\n```\n");
    expect(html).toMatch(/<button[^>]*class="dag-code__copy"[^>]*data-dag-code-copy="copy"[^>]*aria-label="Copy code"/);
  });

  it("is not drawn in a snapshot, which still says the language", () => {
    vi.stubGlobal("location", new URL("http://localhost/?board=x&snapshot=1"));
    const { html } = draw("```sql\nselect 1\n```\n");
    expect(html).not.toContain("dag-code__copy");
    expect(html).toContain('<span class="dag-code__lang">sql</span>');
  });
});
