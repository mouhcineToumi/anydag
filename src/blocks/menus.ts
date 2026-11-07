/**
 * What the editor's menus offer and how a paste is read — the decisions in `BlockEditor.tsx` that
 * can be tested without a browser. No BlockNote import, so the test reads these as data.
 */
import type { NoteBlockType } from "@/note/markdown";

/**
 * The slash menu, by BlockNote's own item keys, and the block each one makes. Three heading levels
 * because `markdown.css` styles three; a file with a fourth still opens and keeps it, it just is not
 * offered. No toggle, no file, audio or video, no page break, no emoji: none of them is Markdown.
 * `test/note-menu.test.ts` holds this list to the schema and to the bridge.
 */
export const SLASH: Record<string, NoteBlockType> = {
  paragraph: "paragraph",
  heading: "heading",
  heading_2: "heading",
  heading_3: "heading",
  bullet_list: "bulletListItem",
  numbered_list: "numberedListItem",
  check_list: "checkListItem",
  quote: "quote",
  code_block: "codeBlock",
  table: "table",
  image: "image",
  divider: "divider",
};
export const SLASH_KEYS = Object.keys(SLASH);

/**
 * The slash items that are ours rather than BlockNote's, and the block each makes — the embed,
 * which opens the same picker `@` does and puts the chosen board in the note. Kept apart from `SLASH`
 * because the test that holds `SLASH` to BlockNote's own keys would otherwise have to learn an
 * exception, and an exception is where a key that silently matches nothing hides.
 */
export const OWN_SLASH: Record<string, NoteBlockType> = {
  board_embed: "embed",
  /* A file from the computer, kept as an attachment and embedded where the caret is. */
  file_upload: "embed",
  /* An equation on lines of its own, its field open for the TeX. */
  equation: "equation",
};

/** What opens the reference picker: a mention's `@`, and the wiki-link `[[` people type from habit. */
export const REF_TRIGGERS = ["@", "[["] as const;

/**
 * How a paste is read.
 *
 * - **Files, or BlockNote's own clipboard**: the default handler, which uploads an image through
 *   `uploadFile` and restores its own blocks exactly.
 * - **HTML from somewhere else**: the default handler too, with its Markdown sniffing off — HTML
 *   says what it is, and that sniffing is BlockNote's Markdown parser by another door.
 * - **Plain text**: Markdown, through remark. So is HTML that a code editor wraps its plain text
 *   in (`white-space: pre`, which is how VS Code copies): the text is what somebody meant to paste,
 *   and the HTML is colouring.
 */
export function pasteKind(types: readonly string[], html: string): "markdown" | "default" {
  if (types.includes("Files") || types.includes("blocknote/html")) return "default";
  if (html && !/white-space:\s*pre/i.test(html)) return "default";
  return types.includes("text/plain") ? "markdown" : "default";
}
