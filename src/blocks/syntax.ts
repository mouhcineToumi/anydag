/**
 * The note editor's code blocks, coloured and checked as they are typed: the same reading
 * the read-only pages draw (`src/render/syntax.ts`), laid over the text as ProseMirror decorations.
 *
 * Three things are load-bearing:
 *
 * - **Decorations, never marks.** A mark is part of the document and would be written back into the
 *   file — BlockNote's code block holds plain text, and a coloured keyword is a fact about the
 *   language, not about what was typed. A decoration is drawn and never saved.
 * - **Recomputed from the text, and only for a block whose text changed.** `readCode` keeps every
 *   reading by its text, so a keystroke re-reads the block it landed in and every other block is a
 *   cache hit; the walk over the document is the only cost the rest pay.
 * - **A language that lands later redraws.** The grammar is a chunk asked for the first time a block
 *   names its language; when it arrives, `onSyntax` dispatches an empty transaction carrying this
 *   plugin's key, and the decorations are made again with it.
 *
 * What a block could not read is underlined with its line in the tooltip, and counted after the
 * language label through `--code-problems` on the block — a custom property and not an attribute,
 * because the label is a child of the element a node decoration can reach, and `attr()` reads only
 * the element it is on.
 */
import { createExtension } from "@blocknote/core";
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { loadSyntax, onSyntax, problemTitle, problemsSaid, readCode, segmentsOf } from "@/render/syntax";

const key = new PluginKey<DecorationSet>("dag-syntax");

function decorate(doc: PMNode): DecorationSet {
  const out: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return true;
    const language = node.attrs.language as string | undefined;
    const text = node.textContent;
    const read = readCode(text, language);
    if (!read) {
      void loadSyntax(language);
      return false;
    }
    const start = pos + 1;
    for (const s of segmentsOf(text.length, read)) {
      if (!s.cls && !s.problem) continue;
      const attrs: Record<string, string> = { class: [s.cls, s.problem ? "dag-tok-error" : null].filter(Boolean).join(" ") };
      if (s.problem) {
        attrs.title = problemTitle(s.problem);
        attrs["data-dag-code-error"] = "";
      }
      out.push(Decoration.inline(start + s.from, start + s.to, attrs));
    }
    const said = problemsSaid(read);
    if (said) out.push(Decoration.node(pos, pos + node.nodeSize, { style: `--code-problems: "${said}"` }));
    return false;
  });
  return DecorationSet.create(doc, out);
}

const plugin = new Plugin<DecorationSet>({
  key,
  state: {
    init: (_config, state) => decorate(state.doc),
    apply: (tr, old) => (tr.docChanged || tr.getMeta(key) ? decorate(tr.doc) : old),
  },
  props: {
    decorations: (state) => key.getState(state),
  },
  view: (view) => {
    const off = onSyntax(() => {
      if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true).setMeta("addToHistory", false));
    });
    return { destroy: off };
  },
});

const colouring = Extension.create({
  name: "dagSyntax",
  addProseMirrorPlugins: () => [plugin],
});

/** Handed to the editor's own `extensions` (`BlockEditor.tsx`), as `mathKeys` is. */
export const syntaxColours = createExtension({ key: "dag-syntax", tiptapExtensions: [colouring] });
