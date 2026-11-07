/**
 * Equations in the note editor. The React half of `MATH_CONFIG` and
 * `EQUATION_CONFIG`, whose shapes `src/note/schema.ts` decides: an equation is drawn by KaTeX here as
 * on every read-only page (`src/render/Math.tsx`), and a click opens a field with its TeX — Notion's
 * way.
 *
 * How one is made:
 *
 * - **`$x$` typed** becomes an inline equation the moment the closing dollar is, and `$$x$$` a display
 *   one in the line — Pandoc's rule as far as typing can know it: no space just inside either dollar.
 * - **`$$` and a space** at the start of an empty line makes an equation block, and **`/Equation`**.
 * - **ctrl+shift+E** (⌘⇧E) makes the selected words an equation, or an empty one at the caret, and
 *   **the formatting toolbar's Σ** does the same to a selection.
 * - **Enter on an equation the caret has selected** opens its field, so a keyboard reaches one too.
 *
 * Four things are load-bearing:
 *
 * - **A change writes the node's attributes, never a new node** (`setNodeMarkup`, and `updateBlock`
 *   for a block). BlockNote's `updateInlineContent` replaces the node, which is a new node view, which
 *   is a field that closes under the person typing into it.
 * - **The field is a portal on `<body>`**, so the editor's own DOM — ProseMirror's — never holds it,
 *   and it is not clipped by anything the editor sits in. React's events from it still bubble through
 *   the editor's React tree, so it stops every key and press it handles.
 * - **What opens by itself is named before it is drawn** (`opening`): a block by its id, an inline
 *   equation by where it starts. A node view mounted for any other reason — the note opening, an
 *   outside write — stays shut.
 * - **An inline equation emptied and left is taken out**, as Notion does: a nameless chip is nothing
 *   anybody can see to click. An empty block stays, saying so, because a block is where the caret is.
 */
import { createExtension, type BlockNoteEditor } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec, useBlockNoteEditor, useComponentsContext, useEditorState } from "@blocknote/react";
import { Extension, InputRule } from "@tiptap/core";
import { Sigma } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { EQUATION_CONFIG, MATH_CONFIG } from "@/note/schema";
import { MathTex, mathError } from "@/render/Math";

/* ------------------------------------------------------------------------------------------------ */
/* What opens its field by itself                                                                     */

type Opening = { block: string } | { pos: number };

let opening: Opening | null = null;
const openers = new Set<(o: Opening) => void>();

/** Open an equation's field: now, if it is drawn and listening, and as soon as it is drawn otherwise. */
function open(o: Opening): void {
  opening = o;
  for (const f of openers) f(o);
}

/** Whether this equation is the one named — and the name let go of, so nothing opens twice. */
function take(o: Opening | null, match: (o: Opening) => boolean): boolean {
  if (!o || !match(o)) return false;
  if (opening === o) opening = null;
  return true;
}

function useOpening(match: (o: Opening) => boolean, setOpen: (open: boolean) => void): void {
  const matches = useRef(match);
  matches.current = match;
  useEffect(() => {
    if (take(opening, matches.current)) setOpen(true);
    const f = (o: Opening) => {
      if (take(o, matches.current)) setOpen(true);
    };
    openers.add(f);
    return () => {
      openers.delete(f);
    };
  }, [setOpen]);
}

/* ------------------------------------------------------------------------------------------------ */
/* The field                                                                                         */

type Done = "key" | "away";

/**
 * The TeX of one equation, under it, with what KaTeX made of it under that. Every change is written
 * to the node at once, so the equation above redraws as it is typed — and ctrl+Z still takes the
 * run back, because ProseMirror groups steps made close together.
 */
function MathField({
  anchor,
  tex,
  block,
  onTex,
  onDone,
}: {
  anchor: HTMLElement;
  tex: string;
  block: boolean;
  onTex(tex: string): void;
  onDone(how: Done): void;
}): ReactNode {
  const [draft, setDraft] = useState(tex);
  const box = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [at, setAt] = useState<{ left: number; top: number; width: number } | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  /* Under the equation, kept there through a scroll of the page or of anything the editor sits in. */
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const width = Math.min(block ? Math.max(r.width, 360) : 360, window.innerWidth - 16);
      const left = Math.max(8, Math.min(block ? r.left : r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
      setAt({ left, top: r.bottom + 6, width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, block]);

  /* Now, and again a frame later: a press on the equation is ProseMirror's too, and it selects the
     node and focuses the editor once it has finished with the press — after this has run. */
  useEffect(() => {
    const take = () => {
      const el = area.current;
      if (!el || document.activeElement === el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    };
    take();
    const id = requestAnimationFrame(take);
    return () => cancelAnimationFrame(id);
  }, []);

  /* A press anywhere but here or on the equation is somebody done with it. */
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (box.current?.contains(t) || anchor.contains(t))) return;
      done.current("away");
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [anchor]);

  const key = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    const finish = e.key === "Escape" || (e.key === "Enter" && (block ? e.ctrlKey || e.metaKey : !e.shiftKey));
    if (!finish) return;
    e.preventDefault();
    done.current("key");
  };

  const error = draft.trim() ? mathError(draft) : null;
  return createPortal(
    <div
      ref={box}
      className="dag-math-field"
      data-dag-math-field={block ? "block" : "inline"}
      style={at ? { left: at.left, top: at.top, width: at.width } : { visibility: "hidden" }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={area}
        className="dag-math-field__tex"
        data-dag-math-tex=""
        aria-label={block ? "Equation, in TeX" : "Inline equation, in TeX"}
        value={draft}
        rows={block ? 3 : 1}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={block ? "\\int_0^1 f(x)\\,dx" : "x^2"}
        onChange={(e) => {
          setDraft(e.target.value);
          onTex(e.target.value);
        }}
        onKeyDown={key}
      />
      <div className="dag-math-field__foot">
        {error ? (
          <span className="dag-math-field__error" data-dag-math-field-error="">
            {error}
          </span>
        ) : (
          <span>{block ? "Ctrl+Enter to finish · Escape" : "Enter to finish · Escape"}</span>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Putting the caret back                                                                            */

type Editor = BlockNoteEditor<any, any, any>;

/** The caret at a position in the document, and the focus back in the editor. */
function caretAt(editor: Editor, pos: number): void {
  editor._tiptapEditor.chain().focus().setTextSelection(pos).run();
}

/* ------------------------------------------------------------------------------------------------ */
/* An equation in a line                                                                             */

/** `$$x$$` typed: a display equation in the line. First, so the single rule never sees its dollars. */
const TYPED_DISPLAY = /(?:^|[^$\\])(\$\$([^$]*[^\s$][^$]*)\$\$)$/;
/** `$x$` typed: no space just inside either dollar, no dollar in it, and not `\$`. */
const TYPED_INLINE = /(?:^|[^$\\])(\$([^\s$](?:[^$]*[^\s$\\])?)\$)$/;

function typedRule(find: RegExp, display: boolean): InputRule {
  return new InputRule({
    find,
    handler: ({ state, range, match }) => {
      const type = state.schema.nodes.math;
      const whole = match[1];
      const tex = match[2];
      if (!type || !whole || !tex) return null;
      const start = range.from + match[0].lastIndexOf(whole);
      state.tr.replaceWith(start, range.to, type.create({ tex: tex.trim(), display }));
    },
  });
}

const typing = Extension.create({
  name: "dagMathTyping",
  addInputRules() {
    return [typedRule(TYPED_DISPLAY, true), typedRule(TYPED_INLINE, false)];
  },
});

/** The selection as an inline equation — its words the TeX — or an empty one at the caret, opened. */
export function makeInlineEquation(editor: Editor): boolean {
  /* ProseMirror reads a selection the browser changed on `selectionchange`, which comes later than a
     key pressed straight after a shift+arrow: read it now, or the words just selected are not. */
  (editor.prosemirrorView as unknown as { domObserver?: { flush?(): void } }).domObserver?.flush?.();
  const state = editor.prosemirrorState;
  const type = state.schema.nodes.math;
  if (!type) return false;
  const { from, to } = state.selection;
  const tex = state.doc.textBetween(from, to, " ").trim();
  editor.transact((tr) => {
    tr.replaceWith(from, to, type.create({ tex, display: false }));
  });
  /* An empty one opens for its TeX; a made one leaves the caret after it, in the editor — the toolbar
     that asked has gone with the selection, and the focus with it. */
  if (!tex) open({ pos: from });
  else caretAt(editor, from + 1);
  return true;
}

/** Enter on a selected equation opens it: the keyboard's click. */
function openSelected(editor: Editor): boolean {
  const sel = editor.prosemirrorState.selection as { from: number; node?: { type: { name: string } } };
  const name = sel.node?.type.name;
  if (name === "math") {
    open({ pos: sel.from });
    return true;
  }
  if (name === "equation") {
    open({ block: editor.getTextCursorPosition().block.id });
    return true;
  }
  return false;
}

/**
 * Typing `$x$`, ctrl+shift+E, and Enter on a selected equation. Handed to the editor's own
 * `extensions` (`BlockEditor.tsx`), not to the inline spec: BlockNote registers the extensions a
 * *block* spec carries and drops an inline spec's without a word.
 */
export const mathKeys = createExtension({
  key: "dag-math",
  tiptapExtensions: [typing],
  keyboardShortcuts: {
    "Mod-Shift-e": ({ editor }) => makeInlineEquation(editor),
    Enter: ({ editor }) => openSelected(editor),
  },
});

function MathChip({
  tex,
  display,
  editor,
  getPos,
}: {
  tex: string;
  display: boolean;
  editor: Editor;
  getPos: () => number | undefined;
}): ReactNode {
  const ref = useRef<HTMLSpanElement>(null);
  const [isOpen, setOpen] = useState(false);
  useOpening((o) => "pos" in o && o.pos === getPos(), setOpen);

  const write = (next: string) => {
    const pos = getPos();
    const node = pos === undefined ? null : editor.prosemirrorState.doc.nodeAt(pos);
    if (pos === undefined || node?.type.name !== "math") return;
    editor.transact((tr) => {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, tex: next });
    });
  };

  const finish = (how: Done) => {
    setOpen(false);
    const pos = getPos();
    const node = pos === undefined ? null : editor.prosemirrorState.doc.nodeAt(pos);
    if (pos === undefined || node?.type.name !== "math") return;
    if (!String(node.attrs.tex).trim()) {
      editor.transact((tr) => {
        tr.delete(pos, pos + node.nodeSize);
      });
      if (how === "key") caretAt(editor, pos);
    } else if (how === "key") caretAt(editor, pos + node.nodeSize);
  };

  return (
    <span
      ref={ref}
      className={isOpen ? "dag-math-chip dag-math-chip--open" : "dag-math-chip"}
      data-dag-math-chip={display ? "display" : "inline"}
      onClick={() => {
        if (editor.isEditable) setOpen(true);
      }}
    >
      {tex.trim() ? <MathTex tex={tex} display={display} /> : <span className="dag-math-chip__empty">Equation</span>}
      {isOpen && ref.current ? <MathField anchor={ref.current} tex={tex} block={false} onTex={write} onDone={finish} /> : null}
    </span>
  );
}

export const mathInline = createReactInlineContentSpec(
  MATH_CONFIG,
  {
    render: ({ inlineContent, editor, getPos }) => (
      <MathChip tex={inlineContent.props.tex} display={inlineContent.props.display} editor={editor} getPos={getPos} />
    ),
  },
);

/* ------------------------------------------------------------------------------------------------ */
/* An equation on lines of its own                                                                   */

const blockKeys = createExtension({
  key: "dag-equation",
  inputRules: [
    {
      find: /^\$\$\s$/,
      replace: ({ editor }) => {
        open({ block: editor.getTextCursorPosition().block.id });
        return { type: "equation", props: {} };
      },
    },
  ],
});

function EquationView({ id, tex, fenced, editor }: { id: string; tex: string; fenced: boolean; editor: Editor }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const [isOpen, setOpen] = useState(false);
  useOpening((o) => "block" in o && o.block === id, setOpen);

  const write = (next: string) => {
    if (editor.getBlock(id)) editor.updateBlock(id, { props: { tex: next } });
  };

  const finish = (how: Done) => {
    setOpen(false);
    if (how !== "key" || !editor.getBlock(id)) return;
    /* Done from the keyboard goes on below it, as Enter does anywhere else — into a new line if
       there is nothing below. */
    const next = editor.getNextBlock(id);
    if (next) editor.setTextCursorPosition(next, "start");
    else {
      const [made] = editor.insertBlocks([{ type: "paragraph" }], id, "after");
      if (made) editor.setTextCursorPosition(made, "start");
    }
    editor.focus();
  };

  return (
    <div
      ref={ref}
      className={isOpen ? "dag-equation dag-equation--open" : "dag-equation"}
      data-dag-equation=""
      data-dag-equation-tex={tex}
      data-dag-equation-fenced={fenced ? "" : undefined}
      onClick={() => {
        if (editor.isEditable) setOpen(true);
      }}
    >
      {tex.trim() ? <MathTex tex={tex} block /> : <div className="dag-equation__empty">Add an equation in TeX</div>}
      {isOpen && ref.current ? <MathField anchor={ref.current} tex={tex} block onTex={write} onDone={finish} /> : null}
    </div>
  );
}

export const equationBlock = createReactBlockSpec(
  EQUATION_CONFIG,
  {
    render: ({ block, editor }) => <EquationView id={block.id} tex={block.props.tex} fenced={block.props.fenced} editor={editor} />,
    /* A paste of Markdown is turned into BlockNote's *lossy* HTML and read back (`BlockEditor`'s
       paste handler), and that HTML keeps a block's drawing but not its type: the TeX is read off
       the element, or a pasted equation would come in as the text KaTeX drew. */
    parse: (el) =>
      el.hasAttribute("data-dag-equation-tex")
        ? { tex: el.getAttribute("data-dag-equation-tex") ?? "", fenced: el.hasAttribute("data-dag-equation-fenced") }
        : undefined,
  },
  [blockKeys],
);

/** Insert an equation block where the caret is — the slash menu's *Equation* — and open its field. */
export function insertEquation(editor: Editor): void {
  const at = editor.getTextCursorPosition().block;
  const empty = at.type === "paragraph" && Array.isArray(at.content) && at.content.length === 0;
  const made = empty ? editor.replaceBlocks([at], [{ type: "equation" }]).insertedBlocks[0] : editor.insertBlocks([{ type: "equation" }], at, "after")[0];
  const id = (made as { id?: string } | undefined)?.id;
  if (id) open({ block: id });
}

/* ------------------------------------------------------------------------------------------------ */
/* The formatting toolbar's button                                                                   */

/** Σ in the formatting toolbar: the selected words as an inline equation. */
export function EquationButton(): ReactNode {
  const Components = useComponentsContext();
  const editor = useBlockNoteEditor();
  const show = useEditorState({ editor, selector: ({ editor }) => editor.isEditable && !editor.prosemirrorState.selection.empty });
  if (!Components || !show) return null;
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      data-dag-math-button=""
      label="Equation"
      mainTooltip="Equation"
      secondaryTooltip="Ctrl+Shift+E"
      icon={<Sigma size={16} />}
      onClick={() => {
        makeInlineEquation(editor as Editor);
      }}
    />
  );
}
