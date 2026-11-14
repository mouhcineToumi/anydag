/**
 * The editor's schema: what a note can hold, which is exactly what Markdown can say.
 *
 * Every block and mark here round-trips through `markdown.ts`, and nothing BlockNote ships that
 * does not is in it — underline has no Markdown, toggles and files and audio have none, and a text
 * or background colour is a colour the theme does not own (the refusal `docs/architecture/design-and-layout.md` already makes
 * as *A custom colour*). Leaving a block out of the schema is what takes it out of the slash menu
 * and the block-type select, so the menus cannot offer something the file cannot keep.
 *
 * **`code` is BlockNote's own mark with one property changed.** TipTap's `Code` excludes every
 * other mark, so bold around inline code — the house style of this repository's prose, in 28 of its
 * 149 Markdown bodies — cannot be held: the editor splits the bold around it, and handed the pair
 * directly it throws `Invalid collection of marks for node text: bold,code`. `excludes: ""` lets it
 * sit inside bold and italic, and keeps everything else about the mark: its backtick input rule,
 * its `Mod-E`, its `<code>` parse rule for pasted HTML.
 *
 * Imports `@blocknote/core`, which is DOM-free at import time; a spec touches `document` only when
 * an editor renders it. So this runs under vitest's `node` environment too, and the round-trip test
 * builds its editor from this schema rather than from a copy of it.
 */
import {
  BlockNoteSchema,
  createBlockSpec,
  createCodeBlockSpec,
  createInlineContentSpec,
  createHeadingBlockSpec,
  createStyleSpecFromTipTapMark,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import Code from "@tiptap/extension-code";
import { DOMParser as PMParser, Fragment, type Schema } from "@tiptap/pm/model";

const code = createStyleSpecFromTipTapMark(Code.extend({ excludes: "" }), "boolean");

/**
 * A reference, and an embed. Their *shapes* are decided here, beside every other block a
 * note holds, and `src/blocks/` draws them: the live title, the board in a box. What is here draws
 * them plainly, which is what the round-trip tests need and all a server-side editor ever does.
 */
export const REF_CONFIG = {
  type: "ref",
  propSchema: { href: { default: "" }, title: { default: "" } },
  content: "none",
} as const;

export const EMBED_CONFIG = {
  type: "embed",
  propSchema: { href: { default: "" }, title: { default: "" } },
  content: "none",
} as const;

/**
 * An equation. `math` is one in a line, `$tex$` or `$$tex$$` (`display`, drawn centred on a
 * line of its own); `equation` is one on lines of its own, `$$` lines or a ```math fence (`fenced`).
 * Two names because ProseMirror keeps one namespace for both kinds of node. Drawn by KaTeX in
 * `src/blocks/math.tsx`; here as the TeX it is.
 */
export const MATH_CONFIG = {
  type: "math",
  propSchema: { tex: { default: "" }, display: { default: false } },
  content: "none",
} as const;

export const EQUATION_CONFIG = {
  type: "equation",
  propSchema: { tex: { default: "" }, fenced: { default: false } },
  content: "none",
} as const;

/**
 * A callout: a quote whose first line names a kind (`src/note/callout.ts`). `kind` is the word as
 * written — `NOTE`, `hint`, a word nobody knows — `title` the rest of that line as written, and
 * `fold` its `-` or `+`. Its text is the body's first paragraph, and the body's other blocks are its
 * children. Drawn with its icon, tint and title in `src/blocks/callout.tsx`; here as a quote.
 */
export const CALLOUT_CONFIG = {
  type: "callout",
  propSchema: { kind: { default: "note" }, title: { default: "" }, fold: { default: "" } },
  content: "inline",
} as const;

const mathInline = createInlineContentSpec(MATH_CONFIG, {
  render: (ic) => {
    const dom = document.createElement("span");
    dom.className = "dag-math";
    dom.textContent = ic.props.tex;
    return { dom };
  },
});

const equation = createBlockSpec(EQUATION_CONFIG, {
  render: (block) => {
    const dom = document.createElement("div");
    dom.className = "dag-math dag-math--block";
    dom.textContent = block.props.tex;
    return { dom };
  },
});

/**
 * A callout as HTML, and read back from it — which is how a paste of Markdown arrives: `mdToBlocks`,
 * then BlockNote's lossy HTML, then its parser (`src/blocks/paste.ts`). The props ride on the
 * element, its text in one child and its blocks in another, so nothing the editor draws around a
 * callout — the kind's name, the title field — can be read back into its text. The editor's own
 * spec (`src/blocks/callout.tsx`) writes the same shape.
 */
export const CALLOUT_ATTR = { word: "data-dag-callout-word", title: "data-dag-callout-title", fold: "data-dag-callout-fold" };

export function calloutParse(el: HTMLElement): { kind: string; title: string; fold: string } | undefined {
  /* Only the element below: a read-only page's callout, copied, carries the word too, and is read as the paragraphs it draws. */
  if (!el.hasAttribute(CALLOUT_ATTR.word) || !el.querySelector(":scope > [data-dag-callout-text]")) return undefined;
  return {
    kind: el.getAttribute(CALLOUT_ATTR.word) || "note",
    title: el.getAttribute(CALLOUT_ATTR.title) ?? "",
    fold: el.getAttribute(CALLOUT_ATTR.fold) ?? "",
  };
}

/** Its text, then its blocks as a group at the end — the shape BlockNote's own toggles hand back. */
export function calloutParseContent({ el, schema }: { el: HTMLElement; schema: Schema }): Fragment {
  const parser = PMParser.fromSchema(schema);
  const text = el.querySelector(":scope > [data-dag-callout-text]");
  const content = text
    ? parser.parse(text, { topNode: schema.nodes.paragraph!.create(), preserveWhitespace: true }).content
    : Fragment.empty;
  const kids = el.querySelector(":scope > [data-dag-callout-children]");
  if (!kids?.childElementCount) return content;
  const group = document.createElement("div");
  group.setAttribute("data-node-type", "blockGroup");
  for (const k of Array.from(kids.childNodes)) group.appendChild(k.cloneNode(true));
  const blocks = parser.parse(group, { topNode: schema.nodes.blockGroup!.create() });
  return blocks.content.size > 0 ? content.addToEnd(blocks) : content;
}

/** The element `calloutParse` reads: a `div` with the props, holding its text and its blocks. */
function calloutHTML(props: { kind: string; title: string; fold: string }): {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  childrenDOM: HTMLElement;
} {
  const dom = document.createElement("div");
  dom.setAttribute(CALLOUT_ATTR.word, props.kind);
  dom.setAttribute(CALLOUT_ATTR.title, props.title);
  dom.setAttribute(CALLOUT_ATTR.fold, props.fold);
  const contentDOM = document.createElement("p");
  contentDOM.setAttribute("data-dag-callout-text", "");
  const childrenDOM = document.createElement("div");
  childrenDOM.setAttribute("data-dag-callout-children", "");
  dom.append(contentDOM, childrenDOM);
  return { dom, contentDOM, childrenDOM };
}

/** Enter in a callout's text starts its body; Enter on an empty last line of the body leaves it; Backspace at its start makes it a quote again. */
export const CALLOUT_KEYBOARD = {
  enter: "into-children",
  emptyChildEnter: "exit-at-end",
  resetsTo: { type: "quote" },
} as const;

const callout = createBlockSpec(CALLOUT_CONFIG, {
  experimental_keyboard: CALLOUT_KEYBOARD,
  parse: calloutParse,
  parseContent: calloutParseContent,
  render: () => {
    const dom = document.createElement("blockquote");
    dom.className = "dag-callout";
    return { dom, contentDOM: dom };
  },
  toExternalHTML: (block) => calloutHTML(block.props),
});

const ref = createInlineContentSpec(REF_CONFIG, {
  render: (ic) => {
    const dom = document.createElement("span");
    dom.className = "dag-ref";
    dom.textContent = ic.props.title;
    return { dom };
  },
});

const embed = createBlockSpec(EMBED_CONFIG, {
  render: (block) => {
    const dom = document.createElement("div");
    dom.className = "dag-embed dag-embed--card";
    dom.textContent = block.props.title;
    return { dom };
  },
});

/**
 * A fenced code block, `text` when the fence names no language — which is why `markdown.ts` writes a
 * `text` block back as a bare fence. A function so the editor can build its own copy and draw a
 * label and a copy button on it (`src/blocks/code.tsx`) without touching this one: a spec handed to
 * `BlockNoteSchema.create` has its ProseMirror node built from it then, and keeps it.
 */
export const codeBlockSpec = () => createCodeBlockSpec({ defaultLanguage: "text" });

export const noteSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    /* Six levels held, because a file may have them; the menus offer three (see `blocks/menus.ts`). */
    heading: createHeadingBlockSpec({ levels: [1, 2, 3, 4, 5, 6], allowToggleHeadings: false }),
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: codeBlockSpec(),
    divider: defaultBlockSpecs.divider,
    table: defaultBlockSpecs.table,
    image: defaultBlockSpecs.image,
    embed: embed(),
    equation: equation(),
    callout: callout(),
  },
  inlineContentSpecs: { ...defaultInlineContentSpecs, ref, math: mathInline },
  styleSpecs: {
    bold: defaultStyleSpecs.bold,
    italic: defaultStyleSpecs.italic,
    strike: defaultStyleSpecs.strike,
    code,
  },
});
