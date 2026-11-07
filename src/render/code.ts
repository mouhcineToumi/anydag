/**
 * What a code block says about itself — its language and its text — read the same way wherever one
 * is drawn. No DOM and no React: the read-only renderer reads a parsed tree, the note
 * editor reads its own block, and both arrive here.
 */
import type { ExtraProps } from "react-markdown";

type Hast = NonNullable<ExtraProps["node"]>;
type HastChild = Hast["children"][number];

/**
 * The label a block wears: the word after its opening fence, or `text` when it names none. The note
 * editor holds a bare fence and ```` ```text ```` as one block (`language: "text"`, written back as a
 * bare fence), so the read-only views say `text` for a bare fence too, or the two would disagree
 * about one file.
 */
export function codeLanguage(lang: string | null | undefined): string {
  const word = lang?.trim();
  return word ? word : "text";
}

/** Every text node under a hast node, in order. */
function textOf(node: HastChild | Hast): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

/**
 * A `<pre>` as `react-markdown` hands it over: the `<code>` inside it, its `language-…` class and its
 * text. `mdast-util-to-hast` ends a code block's text with one `\n` the file never had, so that one is
 * taken off — what is copied is exactly what is between the fences.
 */
export function codeOfPre(pre: Hast | undefined): { language: string; text: string } {
  const code = pre?.children.find((c): c is Hast => c.type === "element" && c.tagName === "code");
  const classes = code?.properties?.className;
  const lang = (Array.isArray(classes) ? classes : [])
    .map(String)
    .find((c) => c.startsWith("language-"))
    ?.slice("language-".length);
  const text = code ? textOf(code) : pre ? textOf(pre) : "";
  return { language: codeLanguage(lang), text: text.endsWith("\n") ? text.slice(0, -1) : text };
}
