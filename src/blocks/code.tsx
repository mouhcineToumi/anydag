/**
 * The note editor's code block: BlockNote's own, with the language above the text and a copy button
 * — what every read-only page draws for the same lines (`src/render/CodeBlock.tsx`).
 *
 * The spec is `noteSchema`'s, built fresh (`codeBlockSpec`), with only its `render` wrapped: the
 * parse rules, the `code` meta that makes Enter a newline and Tab an indent, the keyboard extension
 * and the export to HTML are all BlockNote's, untouched.
 *
 * Four things about the wrapper are load-bearing:
 *
 * - **It adds nothing unless `renderType` is `nodeView`.** BlockNote also calls `render` to write a
 *   block as HTML — its own clipboard flavour among them — and a label there would be text a paste
 *   could read back into the block.
 * - **The head and the button are `contentEditable="false"`**, beside the `<pre>` rather than in it:
 *   the `<code>` is ProseMirror's (`contentDOM`), and anything inside it is text.
 * - **`ignoreMutation` names them.** A node view with a `contentDOM` hands every mutation under it
 *   to ProseMirror, which reads the block back from the DOM — so the button's icon changing to a tick
 *   would have redrawn the block, button and all. `stopEvent` is the same for the pointer: a press on
 *   the button is the button's, not a caret placed at the end of the code.
 * - **The button is React in a root of its own**, the component the read-only pages draw, unmounted
 *   a task later than the node view goes: ProseMirror destroys node views in the middle of an
 *   update, which may be inside a React render, and React warns about an unmount from there.
 *
 * The block's text is read from the editor at the click, never from the DOM or the block the view
 * was made with: a node view outlives every keystroke typed into it.
 */
import { createRoot } from "react-dom/client";

import { codeBlockSpec } from "@/note/schema";
import { codeLanguage } from "@/render/code";
import { CodeCopy } from "@/render/CodeBlock";

type Spec = ReturnType<typeof codeBlockSpec>;
type Render = Spec["implementation"]["render"];

/** The plain text of a block whose content is `plain`: its runs of text, joined. */
function plainText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((run) => (run && typeof run === "object" && "text" in run ? String(run.text) : "")).join("");
}

export function codeBlock(): Spec {
  const spec = codeBlockSpec();
  const render: Render = spec.implementation.render;
  const wrapped: Render = function (this: ThisParameterType<Render>, block, editor) {
    const view = render.call(this, block, editor);
    if (!this || !("renderType" in this) || this.renderType !== "nodeView") return view;

    const head = document.createElement("div");
    head.className = "dag-code__head";
    head.contentEditable = "false";
    const lang = document.createElement("span");
    lang.className = "dag-code__lang";
    lang.textContent = codeLanguage(block.props.language);
    head.append(lang);

    const slot = document.createElement("div");
    slot.className = "dag-code__slot";
    slot.contentEditable = "false";
    const root = createRoot(slot);
    root.render(<CodeCopy text={() => plainText(editor.getBlock(block.id)?.content)} />);

    view.dom.prepend(head);
    view.dom.append(slot);
    const ours = (target: EventTarget | Node | null) =>
      target instanceof Node && (head.contains(target) || slot.contains(target));
    /* Not a literal in the `return`: `stopEvent` is ProseMirror's and BlockNote's type does not list
       it, though it hands the object to ProseMirror as it is. */
    const out = {
      ...view,
      ignoreMutation: (m: MutationRecord | { type: "selection"; target: Node }) => m.type !== "selection" && ours(m.target),
      stopEvent: (e: Event) => ours(e.target),
      destroy: () => {
        view.destroy?.();
        window.setTimeout(() => root.unmount());
      },
    };
    return out;
  };
  return { ...spec, implementation: { ...spec.implementation, render: wrapped } };
}
