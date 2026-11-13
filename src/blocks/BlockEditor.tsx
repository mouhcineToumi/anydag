/**
 * BlockNote, configured once. The one file in `src/` that imports BlockNote's React half and
 * Mantine, and the reason `index.ts` loads it lazily: none of it is on the canvas's path, so a board
 * never pays for it and `?snapshot=1` never loads it.
 *
 * **It knows blocks, not files.** It is handed the blocks to open with and hands back a `NoteEditor`
 * to read and change them through; what those blocks are as Markdown, and which of them a save has
 * to rewrite, is `src/note/`'s business. That split is the central
 * decision: BlockNote edits, and never parses or writes a byte of a file.
 *
 * Four things here are choices:
 *
 * - **The menus offer only what the file can keep.** The schema already holds only Markdown's
 *   blocks and marks (`src/note/schema.ts`); the slash menu, the block-type select and the
 *   drag-handle menu are then cut to what Markdown can *say* of those — three heading levels (the
 *   ones `markdown.css` styles), no toggles, no alignment, no colours, no header-row switch (a
 *   Markdown table always has one). `test/note-menu.test.ts` holds the slash menu to that.
 * - **Pasted Markdown goes through remark, never through BlockNote's parser.** Its parser is the
 *   one this whole feature was built around avoiding — it reads every wrapped line as a hard break.
 *   So `text/plain` is converted by `mdToBlocks` and inserted as BlockNote's own HTML; HTML from
 *   another app, and BlockNote's own clipboard, go through the default handler with its Markdown
 *   sniffing off. The handler is `markdownPaste` in `./paste.ts`, shared with a quiz's fields.
 * - **The colours are the theme's.** `className="dag-blocks"` lands on the editor *and* on every
 *   menu BlockNote portals out of it, and `src/styles/blocks.css` maps each `--bn-*` onto a
 *   `--dag-*` there. The scheme follows the theme's, so `paper-dark` gets the dark editor.
 * - **An image is stored beside the note** through `upload`, and drawn through `resolve`, because
 *   the file holds a path relative to the note (`plan.assets/paste-….png`) and the browser needs a
 *   route.
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
  DragHandleMenu,
  FileCaptionButton,
  FileDeleteButton,
  FileReplaceButton,
  FormattingToolbar,
  FormattingToolbarController,
  NestBlockButton,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  type SideMenuProps,
  SuggestionMenuController,
  UnnestBlockButton,
  blockTypeSelectItems,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
} from "@blocknote/react";
import { LayoutDashboard, Sigma, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { applySteps, type NoteBlock, type Step } from "@/note/markdown";
import { noteSchema } from "@/note/schema";
import { readIndex } from "@/refs/useIndex";

import { codeBlock } from "./code";
import { EquationButton, equationBlock, insertEquation, mathInline, mathKeys } from "./math";
import { syntaxColours } from "./syntax";
import { OWN_SLASH, REF_TRIGGERS, SLASH_KEYS } from "./menus";
import { markdownPaste } from "./paste";
import { EMBED_TRIGGER, embedBlock, embedFor, refFor, refInline, refItems } from "./refs";

/**
 * The note schema with its references drawn by React — the live title, the board in a box — its
 * code blocks wearing their language and a copy button, and its equations drawn by KaTeX
 * with a field for their TeX. The
 * shapes are `noteSchema`'s, so what the editor holds is exactly what the round-trip tests hold;
 * only the drawing differs. A new schema rather than `noteSchema.extend()`, which changes the schema
 * it is called on.
 */
const editorSchema = BlockNoteSchema.create({
  blockSpecs: { ...noteSchema.blockSpecs, codeBlock: codeBlock(), embed: embedBlock(), equation: equationBlock() },
  inlineContentSpecs: { ...noteSchema.inlineContentSpecs, ref: refInline, math: mathInline },
  styleSpecs: noteSchema.styleSpecs,
});

export interface NoteEditor {
  /** The editor's top-level blocks, as plain data. */
  document(): NoteBlock[];
  /** Apply an outside write — `plan()`'s steps — without an undo entry: ctrl+Z never takes back what the other writer wrote. */
  apply(steps: Step[]): void;
  focus(): void;
  /**
   * The caret at the start of the text, from the note's title: the arrow down puts it at
   * the start of the first block, and Enter (`newLine`) in a new empty one above it — unless the
   * first block is an empty line already, which is where a new note's caret goes.
   */
  focusStart(newLine?: boolean): void;
  /**
   * Put the caret at the start of one block and bring it into the middle of the page — what a
   * search result or a link to a block opens onto. The block's words are marked for a
   * moment so the eye finds them, by a CSS highlight rather than by anything in the document.
   */
  reveal(id: string): void;
}

export interface BlockEditorProps {
  /** What the note opens with. An empty note opens as one empty paragraph. */
  initial: NoteBlock[];
  onReady(editor: NoteEditor): void;
  /** Something a person did changed the blocks. */
  onChange(): void;
  /** Store an image and say what the file should call it. */
  upload(file: File): Promise<string>;
  /** What the file calls an image → a URL the browser can load. */
  resolve(src: string): string;
  scheme: "light" | "dark";
  editable?: boolean;
  /** What the editing surface is called: the note's title, so it is not an unnamed field. */
  label: string;
  /** This note's permanent id, left out of the reference picker: a note does not link to itself. */
  self?: string | null;
  /**
   * Keep files from the computer as attachments and say what each became — its id and
   * title, to embed — or why it was refused. What a drop onto the note and the slash menu's Upload
   * file do; a paste is `upload`'s, and stays this note's own picture.
   */
  attach?(files: readonly File[]): Promise<Array<{ id: string; title: string } | { error: string }>>;
}

type Editor = ReturnType<typeof useNoteEditor>;

function useNoteEditor(props: BlockEditorProps) {
  const { initial, upload, resolve } = props;
  return useCreateBlockNote(
    {
      schema: editorSchema,
      extensions: [mathKeys, syntaxColours],
      initialContent: (initial.length ? initial : undefined) as never,
      uploadFile: upload,
      resolveFileUrl: async (url: string) => resolve(url),
      pasteHandler: markdownPaste,
    },
    [],
  );
}

/** Delete and nothing else: no colours (the theme owns them) and no header toggles (a Markdown table always has a header row). */
function NoteDragHandleMenu() {
  return (
    <DragHandleMenu>
      <RemoveBlockItem>
        {/* The item has no icon slot of its own, so the glyph rides in its label. It is decorative —
            the item is announced as "Delete", and `.dag-blocks-menu-label` centres the two. */}
        <span className="dag-blocks-menu-label">
          <Trash2 size={16} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" />
          Delete
        </span>
      </RemoveBlockItem>
    </DragHandleMenu>
  );
}

/**
 * The side menu, with that drag-handle menu: a component of its own rather than an arrow in the
 * render. `SideMenuController` draws what it is given as a component type, so a new arrow on every
 * render of the editor — and the page re-renders it whenever the index changes — unmounted the side
 * menu and shut a drag-handle menu somebody had just opened. Measured on the e2e suite: four runs
 * in twenty-four lost the menu once the editor came up before the index had (#120).
 */
function NoteSideMenu(props: SideMenuProps) {
  return <SideMenu {...props} dragHandleMenu={NoteDragHandleMenu} />;
}

/** BlockNote's own items, cut to `SLASH`, and ours. The React items keep the core item's `key` at run time; only their type drops it. */
function slashItems(editor: Editor, pickFiles?: () => void) {
  const allowed = new Set<string>(SLASH_KEYS);
  const own: Record<keyof typeof OWN_SLASH, object | null> = {
    board_embed: {
      title: "Board",
      subtext: "Draw a board, a note, a quiz or a table inside this one",
      aliases: ["embed", "board", "note", "quiz", "table"],
      group: "Embeds",
      icon: <LayoutDashboard size={18} />,
      /* The same picker `![` opens, so there is one way to choose what to embed. */
      onItemClick: () => editor.getExtension(SuggestionMenu)?.openSuggestionMenu(EMBED_TRIGGER, { deleteTriggerCharacter: true }),
    },
    file_upload: pickFiles
      ? {
          title: "Upload file",
          subtext: "A PDF, a picture, a document, a sheet, a recording",
          aliases: ["file", "upload", "attach", "attachment", "pdf"],
          group: "Embeds",
          icon: <Upload size={18} />,
          onItemClick: pickFiles,
        }
      : null,
    equation: {
      title: "Equation",
      subtext: "A formula on a line of its own, in TeX",
      aliases: ["math", "latex", "tex", "formula", "katex"],
      group: "Basic blocks",
      icon: <Sigma size={18} />,
      onItemClick: () => insertEquation(editor),
    },
  };
  const out: { key?: string; group?: string }[] = getDefaultReactSlashMenuItems(editor).filter((item) =>
    allowed.has((item as { key?: string }).key ?? ""),
  );
  /* Each of ours after the last of its own group: the menu draws a group's heading wherever the group
     starts, so an Equation after the Embeds would head "Basic blocks" twice — under one React key. */
  for (const [key, item] of Object.entries(own)) {
    if (!item) continue;
    const group = (item as { group?: string }).group;
    const at = out.map((i) => i.group).lastIndexOf(group);
    out.splice(at < 0 ? out.length : at + 1, 0, { key, ...item });
  }
  return out as ReturnType<typeof getDefaultReactSlashMenuItems>;
}

/** The block a point on the screen is over, by the id BlockNote writes on it — where a drop lands. */
const blockAt = (x: number, y: number): string | undefined =>
  document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-node-type="blockOuter"]')?.dataset.id;

/** How long a block a link opened onto stays marked — long enough to find, short enough not to linger. */
const FOUND_MS = 2000;
/** The name `blocks.css` styles the mark by: `::highlight(dag-found)`. */
const FOUND = "dag-found";

/**
 * Mark a block's text for a moment, **without touching an element**.
 *
 * The first version set an attribute on the block, and it never showed: ProseMirror owns every node
 * inside the editor, watches them, and redraws whatever it did not put there — the attribute was
 * gone before the next frame. A CSS highlight is a range the browser paints over, registered by
 * name and styled by `::highlight()`, so the document and its DOM stay exactly what the editor made.
 * A browser without the registry marks nothing; the caret is still on the block.
 */
function markFound(el: Element): void {
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  if (!registry || typeof Highlight === "undefined") return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const mark = new Highlight(range);
  registry.set(FOUND, mark);
  window.setTimeout(() => {
    if (registry.get(FOUND) === mark) registry.delete(FOUND);
  }, FOUND_MS);
}

export default function BlockEditor(props: BlockEditorProps) {
  const editor = useNoteEditor(props);
  const { onReady, onChange } = props;

  /*
   * The contenteditable itself has no name: BlockNote gives it `aria-autocomplete` and
   * `aria-haspopup` for its suggestion menus, and the note's title is what it edits. The
   * attribute has to go on ProseMirror's own element, which is not a React child here; setting
   * it on a wrapper would name the wrapper and leave the field unnamed.
   */
  useEffect(() => {
    const el = editor.domElement;
    if (!el) return;
    el.setAttribute("aria-label", props.label);
    return () => el.removeAttribute("aria-label");
  }, [editor, props.label]);

  /*
   * The pickers read the index at the moment they are asked, and never subscribe to it. Every write
   * anybody makes refreshes the index, and an editor that re-rendered on each one handed its
   * suggestion menus a new `getItems` every time — which closes an open menu under the person typing
   * into it. Found by the e2e suite running four notes at once; alone, nothing writes, and it passed.
   */
  const self = props.self ?? null;
  /* In a ref, so the pickers below are made once: `attach` is a new closure on every render of the page. */
  const attach = useRef(props.attach);
  attach.current = props.attach;
  const pickers = useMemo(() => {
    const insertEmbed = (d: Parameters<typeof embedFor>[0]) => {
      const at = editor.getTextCursorPosition().block;
      const empty = at.type === "paragraph" && Array.isArray(at.content) && at.content.length === 0;
      /* A picker opened on an empty line replaces it: that line was only ever where the embed goes. */
      if (empty) editor.replaceBlocks([at], [embedFor(d)] as never);
      else editor.insertBlocks([embedFor(d)] as never, at, "after");
    };
    /* Files kept as attachments and embedded after `after` — a block, or the caret's when none is
       said — in the order they were given. */
    const embedFiles = async (files: readonly File[], after?: string) => {
      const kept = (await attach.current?.(files)) ?? [];
      const blocks = kept.flatMap((k) =>
        "id" in k ? [embedFor({ id: k.id, title: k.title, name: k.title, kind: "file", refs: [] })] : [],
      );
      if (!blocks.length) return;
      const at = after ? editor.getBlock(after) : editor.getTextCursorPosition().block;
      const anchor = at ?? editor.document[editor.document.length - 1];
      if (!anchor) editor.replaceBlocks(editor.document, blocks as never);
      else {
        const empty = anchor.type === "paragraph" && Array.isArray(anchor.content) && anchor.content.length === 0;
        if (empty) editor.replaceBlocks([anchor], blocks as never);
        else editor.insertBlocks(blocks as never, anchor, "after");
      }
    };
    const pickFiles = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.onchange = () => void embedFiles(Array.from(input.files ?? []));
      input.click();
    };
    return {
      ref: async (query: string) =>
        refItems((await readIndex()).docs, query, self, (d) => editor.insertInlineContent([refFor(d)] as never)),
      embed: async (query: string) => refItems((await readIndex()).docs, query, self, insertEmbed),
      slash: async (query: string) => filterSuggestionItems(slashItems(editor, attach.current ? pickFiles : undefined), query),
      embedFiles,
    };
  }, [editor, self]);

  const typeItems = useMemo(
    () =>
      blockTypeSelectItems(editor).filter(
        (i) => !i.props?.isToggleable && (i.type !== "heading" || Number(i.props?.level) <= 3) && i.type !== "toggleListItem",
      ),
    [editor],
  );

  useEffect(() => {
    onReady({
      document: () => JSON.parse(JSON.stringify(editor.document)) as NoteBlock[],
      apply: (steps) => {
        /* The blocks as they are before anything moves: nothing inside the transaction reads them
           again, because there it would still be given these. */
        const top = editor.document.map((b) => b.id);
        editor.transact((tr) => {
          tr.setMeta("addToHistory", false);
          applySteps(top, steps, {
            remove: (ids) => editor.removeBlocks(ids),
            insert: (blocks, at, where) => editor.insertBlocks(blocks as never, at, where),
            replace: (ids, blocks) => editor.replaceBlocks(ids, blocks as never),
          });
        });
      },
      focus: () => editor.focus(),
      focusStart: (newLine) => {
        const first = editor.document[0];
        const empty = first?.type === "paragraph" && Array.isArray(first.content) && first.content.length === 0;
        if (first && newLine && !empty) {
          const [made] = editor.insertBlocks([{ type: "paragraph" }] as never, first, "before");
          editor.setTextCursorPosition(made ?? first, "start");
        } else if (first) editor.setTextCursorPosition(first, "start");
        editor.focus();
      },
      reveal: (id) => {
        if (!editor.getBlock(id)) return;
        editor.setTextCursorPosition(id, "start");
        editor.focus();
        const el = editor.domElement?.querySelector<HTMLElement>(`[data-node-type="blockOuter"][data-id="${CSS.escape(id)}"]`);
        if (!el) return;
        el.scrollIntoView({ block: "center" });
        markFound(el.querySelector(".bn-block-content") ?? el);
      },
    });
  }, [editor, onReady]);

  return (
    /* Files dragged in from the computer are attachments: taken here, in the capture
       phase, before BlockNote's own drop — which would keep an image as this note's private picture
       and drop anything else on the floor. A paste is still BlockNote's, and stays private. */
    <div
      className="dag-blocks-drop"
      data-dag-note-drop=""
      onDragOverCapture={(e) => {
        if (!props.attach || !Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDropCapture={(e) => {
        if (!props.attach || !e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        void pickers.embedFiles(Array.from(e.dataTransfer.files), blockAt(e.clientX, e.clientY));
      }}
    >
      <BlockNoteView
        editor={editor}
        className="dag-blocks"
        theme={props.scheme}
        editable={props.editable !== false}
        onChange={onChange}
        slashMenu={false}
        formattingToolbar={false}
        sideMenu={false}
        emojiPicker={false}
        data-dag-note-editor=""
      >
        <SuggestionMenuController triggerCharacter="/" getItems={pickers.slash} />
        {REF_TRIGGERS.map((trigger) => (
          <SuggestionMenuController key={trigger} triggerCharacter={trigger} getItems={pickers.ref} />
        ))}
        <SuggestionMenuController triggerCharacter={EMBED_TRIGGER} getItems={pickers.embed} />
        <FormattingToolbarController
          formattingToolbar={() => (
            <FormattingToolbar>
              <BlockTypeSelect key="type" items={typeItems} />
              <FileCaptionButton key="caption" />
              <FileReplaceButton key="replace" />
              <FileDeleteButton key="delete" />
              <BasicTextStyleButton key="bold" basicTextStyle="bold" />
              <BasicTextStyleButton key="italic" basicTextStyle="italic" />
              <BasicTextStyleButton key="strike" basicTextStyle="strike" />
              <BasicTextStyleButton key="code" basicTextStyle="code" />
              <EquationButton key="equation" />
              <NestBlockButton key="nest" />
              <UnnestBlockButton key="unnest" />
              <CreateLinkButton key="link" />
            </FormattingToolbar>
          )}
        />
        <SideMenuController sideMenu={NoteSideMenu} />
      </BlockNoteView>
    </div>
  );
}
