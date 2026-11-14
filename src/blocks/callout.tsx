/**
 * The note editor's callout: the React half of `CALLOUT_CONFIG`, whose shape `src/note/schema.ts`
 * decides. Drawn as every read-only page draws one (`src/render/Callout.tsx`) — the kind's icon and
 * tint, its title in bold, the body below — and edited where it is drawn.
 *
 * How one is made:
 *
 * - **`/Callout`** inserts a `note`.
 * - **`> [!tip] ` typed**: `>` and a space is BlockNote's quote, and `[!tip]` and a space at the start
 *   of a quote makes it a callout of that kind — so the line a person types is the line the file
 *   will hold. A `-` or `+` after the bracket makes it fold, as in the file.
 *
 * Four things are load-bearing:
 *
 * - **The box is the block's frame** (`renderFrame`), not its content: BlockNote puts the block's
 *   text *and* its child blocks in the frame's slot, so a callout of three paragraphs is one tinted
 *   box, as it is on every read-only page, rather than a box around its first line with the rest
 *   indented under it.
 * - **The head is chrome.** It is outside the slot, so BlockNote leaves its events and its DOM to it
 *   (`isFrameChromeEvent`), and nothing in it is ever read back as the callout's text. The kind is a
 *   `<select>` and the title an `<input>`, written to the block's props with `updateBlock` — a prop,
 *   never a new node, so the field keeps the focus.
 * - **The title is committed on Enter or on leaving the field**, as the note's own title is, and
 *   Escape puts it back. Written on every keystroke, each one was a save.
 * - **Folding is the page's, not the file's.** `-` draws it shut and `+` open when the note opens;
 *   the chevron changes only what is drawn here, and writes nothing.
 */
import { createExtension, type BlockNoteEditor } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CALLOUT_KINDS, calloutKind, calloutLabel } from "@/note/callout";
import { CALLOUT_ATTR, CALLOUT_CONFIG, CALLOUT_KEYBOARD, calloutParse, calloutParseContent } from "@/note/schema";
import { CalloutIcon, calloutVars } from "@/render/Callout";

type Editor = BlockNoteEditor<any, any, any>;

interface Props {
  kind: string;
  title: string;
  fold: string;
}

/** A word in the case the file already writes its kinds in: `[!NOTE]` becomes `[!TIP]`, not `[!tip]`. */
function inCaseOf(word: string, like: string): string {
  return like.length > 1 && like === like.toUpperCase() ? word.toUpperCase() : word;
}

/** The title field: the file's words, committed when the person is done with them. */
function TitleField({
  value,
  placeholder,
  editable,
  onCommit,
}: {
  value: string;
  placeholder: string;
  editable: boolean;
  onCommit(next: string): void;
}): ReactNode {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  /* Escape leaves the field by blurring it, and the blur must not then write what Escape took back. */
  const cancelled = useRef(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(value);
      return;
    }
    const next = draft.replace(/\s+/g, " ").trim();
    if (next !== value) onCommit(next);
  };
  return (
    <input
      className="dag-callout__title"
      data-dag-callout-title-field=""
      aria-label="Callout title"
      value={draft}
      placeholder={placeholder}
      readOnly={!editable}
      spellCheck
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function CalloutFrame({
  id,
  props,
  editor,
  slotRef,
}: {
  id: string;
  props: Props;
  editor: Editor;
  slotRef(node: HTMLElement | null): void;
}): ReactNode {
  const kind = calloutKind(props.kind);
  const known = (CALLOUT_KINDS as readonly string[]).includes(props.kind.toLowerCase());
  const [open, setOpen] = useState(props.fold !== "-");
  const editable = editor.isEditable;
  const write = (next: Partial<Props>) => {
    if (editor.getBlock(id)) editor.updateBlock(id, { props: next } as never);
  };
  return (
    <div
      className="dag-callout dag-callout--editor"
      data-dag-callout={kind}
      data-dag-callout-word={props.kind}
      data-dag-callout-open={open ? "true" : "false"}
      style={calloutVars(kind)}
    >
      <div className="dag-callout__head" contentEditable={false}>
        <span className="dag-callout__pick" title={`Kind: ${calloutLabel(props.kind)}`}>
          <CalloutIcon kind={kind} />
          <select
            className="dag-callout__kind"
            data-dag-callout-kind=""
            aria-label="Callout kind"
            value={known ? props.kind.toLowerCase() : props.kind}
            disabled={!editable}
            onChange={(e) => write({ kind: inCaseOf(e.target.value, props.kind) })}
          >
            {known ? null : <option value={props.kind}>{calloutLabel(props.kind)}</option>}
            {CALLOUT_KINDS.map((k) => (
              <option key={k} value={k}>
                {calloutLabel(k)}
              </option>
            ))}
          </select>
        </span>
        <TitleField
          value={props.title}
          placeholder={calloutLabel(props.kind)}
          editable={editable}
          onCommit={(title) => write({ title })}
        />
        {props.fold === "-" || props.fold === "+" ? (
          <button
            type="button"
            className="dag-callout__fold"
            data-dag-callout-fold-button=""
            aria-expanded={open}
            aria-label={open ? "Fold the callout" : "Unfold the callout"}
            title={open ? "Fold" : "Unfold"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="dag-callout__slot" ref={slotRef} />
    </div>
  );
}

/** `[!tip]` and a space at the start of a quote — the second half of typing `> [!tip] `. */
const typing = createExtension({
  key: "dag-callout",
  inputRules: [
    {
      find: /^\[!([A-Za-z][\w-]*)\]([+-]?)\s$/,
      replace: ({ match, editor }) => {
        if (editor.getTextCursorPosition().block.type !== "quote") return undefined;
        return { type: "callout", props: { kind: match[1] ?? "note", title: "", fold: match[2] ?? "" } } as never;
      },
    },
  ],
});

export const calloutBlock = createReactBlockSpec(
  CALLOUT_CONFIG,
  {
    experimental_keyboard: CALLOUT_KEYBOARD,
    parse: calloutParse,
    parseContent: calloutParseContent,
    render: ({ contentRef }) => <p className="dag-callout__text" ref={contentRef} />,
    renderFrame: ({ block, editor, slotRef }) => (
      <CalloutFrame id={block.id} props={block.props} editor={editor as unknown as Editor} slotRef={slotRef} />
    ),
    /* `calloutHTML`'s shape, which `calloutParse` reads back. */
    toExternalHTML: ({ block, contentRef, childrenRef }) => (
      <div
        {...{
          [CALLOUT_ATTR.word]: block.props.kind,
          [CALLOUT_ATTR.title]: block.props.title,
          [CALLOUT_ATTR.fold]: block.props.fold,
        }}
      >
        <p data-dag-callout-text="" ref={contentRef} />
        <div data-dag-callout-children="" ref={childrenRef} />
      </div>
    ),
  },
  [typing],
);

/** Insert a `note` callout where the caret is — the slash menu's *Callout* — and put the caret in its text. */
export function insertCallout(editor: Editor): void {
  const at = editor.getTextCursorPosition().block;
  const empty = at.type === "paragraph" && Array.isArray(at.content) && at.content.length === 0;
  const block = { type: "callout", props: { kind: "note", title: "", fold: "" } };
  const made = empty
    ? editor.replaceBlocks([at], [block] as never).insertedBlocks[0]
    : editor.insertBlocks([block] as never, at, "after")[0];
  if (made) editor.setTextCursorPosition(made, "start");
}
