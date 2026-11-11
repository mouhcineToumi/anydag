/**
 * One field of a form as rich text — a quiz's prompt, an option, an explanation — loaded when a
 * field is first opened, beside the note editor in the same lazy chunk.
 *
 * **It takes Markdown and hands back Markdown, and BlockNote never reads or writes a byte of it.**
 * The field's text goes through `src/note/markdown.ts` both ways, the note's own span map: `load` on
 * open, `settle` once the editor holds the blocks, `saved` on every change. So the blocks a person did
 * not touch keep the bytes they were opened with, and a field opened and left hands back exactly
 * what it was given — which is what lets a form's writer say "nothing changed" and write nothing.
 *
 * **The schema is what a field can hold, not what a note can.** Two variants:
 *
 * - `line` — one paragraph and its marks, references and inline equations: a heading's words. Enter
 *   is the form's (`onEnter`), never a new paragraph, and so is shift+Enter.
 * - `block` — paragraphs, lists, code, tables, pictures, equations and embeds. No headings, no task
 *   lists, no quotes and no rule: each of those is part of a quiz's own syntax (a `##` starts a
 *   question, a `- [ ]` is an option, a closing quote is the answer, and `---` under a line is a
 *   heading), and a field that could make one could break the question it is in.
 *
 * Which file the Markdown goes into is the caller's business: this knows blocks, as `BlockEditor` does.
 */
import "@blocknote/mantine/style.css";
import "@/styles/blocks.css";

import { BlockNoteSchema } from "@blocknote/core";
import { filterSuggestionItems, SuggestionMenu } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  SuggestionMenuController,
  blockTypeSelectItems,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
} from "@blocknote/react";
import { LayoutDashboard, Sigma } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { load, saved, settle, type Loaded, type NoteBlock } from "@/note/markdown";
import { noteSchema } from "@/note/schema";
import { readIndex } from "@/refs/useIndex";

import { codeBlock } from "./code";
import { EquationButton, equationBlock, insertEquation, mathInline, mathKeys } from "./math";
import { FIELD_BLOCKS, FIELD_SLASH_KEYS, REF_TRIGGERS } from "./menus";
import { markdownPaste } from "./paste";
import { EMBED_TRIGGER, embedBlock, embedFor, refFor, refInline, refItems } from "./refs";
import { syntaxColours } from "./syntax";

const inlineContentSpecs = { ...noteSchema.inlineContentSpecs, ref: refInline, math: mathInline };

const lineSchema = BlockNoteSchema.create({
  blockSpecs: { paragraph: noteSchema.blockSpecs.paragraph },
  inlineContentSpecs,
  styleSpecs: noteSchema.styleSpecs,
});

const own: Record<string, unknown> = { codeBlock: codeBlock(), embed: embedBlock(), equation: equationBlock() };
const blockSchema = BlockNoteSchema.create({
  blockSpecs: Object.fromEntries(
    FIELD_BLOCKS.map((t) => [t, own[t] ?? noteSchema.blockSpecs[t as keyof typeof noteSchema.blockSpecs]]),
  ) as unknown as typeof noteSchema.blockSpecs,
  inlineContentSpecs,
  styleSpecs: noteSchema.styleSpecs,
});

export interface FieldEditorProps {
  /** The field's Markdown, read once when the editor is made: while it is open, the editor's document is the field. */
  md: string;
  variant: "line" | "block";
  /** The field's Markdown after a change a person made — only when it differs from what was handed back last. */
  onChange(md: string): void;
  /** Store a picture and say what the Markdown should call it. */
  upload(file: File): Promise<string>;
  /** What the Markdown calls a picture → a URL the browser can load. */
  resolve(src: string): string;
  scheme: "light" | "dark";
  label: string;
  /** Enter in a `line` field — on to the next field. */
  onEnter?(): void;
  /** Escape, with no menu open: the person is done with the field. */
  onDone?(): void;
  /**
   * Called once the editor holds the caret, with how to type into it: the host keeps the letters
   * typed while the field was opening, and any that reach no editor after, and puts them in here.
   */
  bind?(insert: (text: string) => void): void;
}

/**
 * The blocks to open with, and the span map for them. A `line` field's text is a heading's words,
 * which as block Markdown might read as a list (`1. First`) or a quote; a line field holds only a
 * paragraph, so such words are opened as plain text, and written back escaped if they are changed.
 */
function opening(md: string, variant: FieldEditorProps["variant"]): { blocks: NoteBlock[]; loaded: Loaded } {
  const first = load(md);
  if (variant === "block" || first.blocks.every((b) => b.type === "paragraph")) return first;
  return { blocks: [{ type: "paragraph", content: [{ type: "text", text: md, styles: {} }] as never }], loaded: load("").loaded };
}

/** A suggestion menu is open: Enter and Escape are its own. */
const menuOpen = () => !!document.querySelector(".bn-suggestion-menu, [data-dag-math-field]");

export default function FieldEditor(props: FieldEditorProps) {
  const { variant } = props;
  /* Read once: while the field is open, the editor's document is the field. */
  const [start] = useState(() => opening(props.md, variant));
  const loaded = useRef(start.loaded);
  const last = useRef(props.md);
  const latest = useRef(props);
  latest.current = props;

  const editor = useCreateBlockNote(
    {
      schema: (variant === "line" ? lineSchema : blockSchema) as typeof blockSchema,
      extensions: [mathKeys, syntaxColours],
      initialContent: (start.blocks.length ? start.blocks : undefined) as never,
      uploadFile: (file: File) => latest.current.upload(file),
      resolveFileUrl: async (url: string) => latest.current.resolve(url),
      pasteHandler: markdownPaste,
    },
    [],
  );

  /* The map measured against the blocks as the editor holds them, then the caret at the end: a
     field is opened by a click or a key on it, and the person goes on from where its words stop. */
  useEffect(() => {
    loaded.current = settle(loaded.current, editor.document as unknown as NoteBlock[]);
    const lastBlock = editor.document[editor.document.length - 1];
    if (lastBlock) editor.setTextCursorPosition(lastBlock, "end");
    editor.focus();
    latest.current.bind?.((text) => {
      editor.focus();
      editor.insertInlineContent(text);
    });
  }, [editor]);

  const pickers = useMemo(
    () => ({
      ref: async (query: string) =>
        refItems((await readIndex()).docs, query, null, (d) => editor.insertInlineContent([refFor(d)] as never)),
      embed: async (query: string) =>
        refItems((await readIndex()).docs, query, null, (d) => {
          const at = editor.getTextCursorPosition().block;
          const empty = at.type === "paragraph" && Array.isArray(at.content) && at.content.length === 0;
          if (empty) editor.replaceBlocks([at], [embedFor(d)] as never);
          else editor.insertBlocks([embedFor(d)] as never, at, "after");
        }),
      slash: async (query: string) => {
        const allowed = new Set<string>(FIELD_SLASH_KEYS);
        const items = getDefaultReactSlashMenuItems(editor).filter((i) => allowed.has((i as { key?: string }).key ?? ""));
        const ours: typeof items = [
          {
            title: "Equation",
            subtext: "A formula on a line of its own, in TeX",
            aliases: ["math", "latex", "tex", "formula", "katex"],
            group: "Basic blocks",
            icon: <Sigma size={18} />,
            onItemClick: () => insertEquation(editor as never),
          },
          {
            title: "Board",
            subtext: "Draw a board, a note, a quiz or a table here",
            aliases: ["embed", "board", "note", "quiz", "table"],
            group: "Embeds",
            icon: <LayoutDashboard size={18} />,
            onItemClick: () =>
              editor.getExtension(SuggestionMenu)?.openSuggestionMenu(EMBED_TRIGGER, { deleteTriggerCharacter: true }),
          },
        ];
        /* Each after the last of its own group: the menu heads a group wherever it starts, so one
           appended after another group would head "Basic blocks" twice, under one React key. */
        for (const item of ours) {
          const at = items.map((i) => i.group).lastIndexOf(item.group);
          items.splice(at < 0 ? items.length : at + 1, 0, item);
        }
        return filterSuggestionItems(items, query);
      },
    }),
    [editor],
  );

  const typeItems = useMemo(
    () =>
      blockTypeSelectItems(editor).filter((i) => (FIELD_BLOCKS as readonly string[]).includes(i.type) && !i.props?.isToggleable),
    [editor],
  );

  const onChange = () => {
    const out = saved(loaded.current, editor.document as unknown as NoteBlock[]);
    loaded.current = out.loaded;
    const md = out.body.replace(/\n+$/, "");
    if (md === last.current) return;
    last.current = md;
    latest.current.onChange(md);
  };

  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && !menuOpen()) {
      latest.current.onDone?.();
      return;
    }
    if (variant !== "line" || e.key !== "Enter" || menuOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.shiftKey) latest.current.onEnter?.();
  };

  return (
    /* Not `dag-field`: the panel's labels have that name, and its 12px would land on this editor. */
    <div className={`dag-rich-field dag-rich-field--${variant}`} onKeyDownCapture={onKeyDownCapture}>
      <BlockNoteView
        editor={editor}
        className="dag-blocks dag-blocks--field"
        theme={props.scheme}
        onChange={onChange}
        slashMenu={false}
        formattingToolbar={false}
        sideMenu={false}
        emojiPicker={false}
        aria-label={props.label}
        data-dag-field-editor={variant}
      >
        {variant === "block" ? <SuggestionMenuController triggerCharacter="/" getItems={pickers.slash} /> : null}
        {REF_TRIGGERS.map((trigger) => (
          <SuggestionMenuController key={trigger} triggerCharacter={trigger} getItems={pickers.ref} />
        ))}
        {variant === "block" ? <SuggestionMenuController triggerCharacter={EMBED_TRIGGER} getItems={pickers.embed} /> : null}
        <FormattingToolbarController
          formattingToolbar={() => (
            <FormattingToolbar>
              {variant === "block" ? <BlockTypeSelect key="type" items={typeItems} /> : null}
              <BasicTextStyleButton key="bold" basicTextStyle="bold" />
              <BasicTextStyleButton key="italic" basicTextStyle="italic" />
              <BasicTextStyleButton key="strike" basicTextStyle="strike" />
              <BasicTextStyleButton key="code" basicTextStyle="code" />
              <EquationButton key="equation" />
              <CreateLinkButton key="link" />
            </FormattingToolbar>
          )}
        />
      </BlockNoteView>
    </div>
  );
}
