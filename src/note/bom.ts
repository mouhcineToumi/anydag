/**
 * A byte-order mark at the very start of a file — U+FEFF, the bytes `EF BB BF` — which Windows
 * editors and some exporters write in front of UTF-8 (#394).
 *
 * It is part of the file, so it is kept: an edit anywhere writes it back where it was, and a
 * frontmatter grows behind it, never in front. It is not part of the text, so nothing reads it:
 * a frontmatter is still the block that opens the file when the mark comes first (every `FRONT`
 * pattern in `src/note/`, `src/refs/` and `server/` allows `\uFEFF?` before the `---`), and remark
 * — which skips the mark and counts its offsets from the character after it — is never handed a
 * text whose offsets would then be one code unit out of step with it.
 *
 * No browser, no React, no `@/` aliases: `src/board/`'s rule, for the reason it gives.
 */

const BOM = "\uFEFF";

/** The mark a text opens with, `""` when it has none. */
export const markOf = (text: string): string => (text.startsWith(BOM) ? BOM : "");

/**
 * `edit` made to the text after its mark, with the mark put back in front of what it returns — how
 * a frontmatter writer that knows nothing of the mark keeps it first, and once.
 */
export function underMark(text: string, edit: (rest: string) => string): string {
  const mark = markOf(text);
  return mark + edit(text.slice(mark.length));
}
