/**
 * The editor's schema: what a note can hold, which is exactly what Markdown can say.
 *
 * Every block and mark here round-trips through `markdown.ts`, and nothing BlockNote ships that
 * does not is in it — underline has no Markdown, toggles and files and audio have none, and a text
 * or background colour is a colour the theme does not own (the refusal `CLAUDE.md` already makes
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
  },
  inlineContentSpecs: { ...defaultInlineContentSpecs, ref, math: mathInline },
  styleSpecs: {
    bold: defaultStyleSpecs.bold,
    italic: defaultStyleSpecs.italic,
    strike: defaultStyleSpecs.strike,
    code,
  },
});
