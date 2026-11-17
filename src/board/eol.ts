/**
 * A board file's line endings and byte-order mark, which belong to the file and not to the board.
 *
 * A file written on Windows — by Notepad, by an editor set to CRLF, by git with `autocrlf` — ends
 * its lines in `\r\n`, may mix the two after a second editor has been at it, and may start with a
 * UTF-8 BOM (U+FEFF). The reader once knew none of that: a fence line ending in `\r` was no fence,
 * so a CRLF board read as one prose card and deleting it erased the board (#391); a BOM was text
 * before the first `---`, so the frontmatter became a card and the first drag wrote two blocks
 * through overlapping spans (#392).
 *
 * The rule: **a `\r` before a `\n` is part of the line break, and a BOM at offset 0 is part of no
 * line.** Every reader sees the file as its LF, mark-less twin — a fence's body and a prose item's
 * text are LF — and every writer puts back what it found: the mark untouched, and the line endings
 * of whatever it rewrites (`eolAt`), or of the file (`eolOf`) for something new.
 *
 * Browser-free and no `@/` aliases: `src/board/`'s rule.
 */

export const BOM = "﻿";

/** 1 when the text starts with a byte-order mark, else 0: where the document itself starts. */
export const bomLength = (text: string): number => (text.charCodeAt(0) === 0xfeff ? 1 : 0);

/** Every CRLF made LF. A lone `\r` is not a line break anywhere in the format, and stays. */
export const lf = (text: string): string => (text.includes("\r\n") ? text.replace(/\r\n/g, "\n") : text);

/** `text`, LF or CRLF, with every line break written `eol`. */
export function withEol(text: string, eol: string): string {
  const plain = lf(text);
  return eol === "\n" ? plain : plain.replace(/\n/g, eol);
}

/**
 * The file's line ending, for a block that has none of its own yet — an appended card, a new
 * frontmatter: CRLF when most of its line breaks are, LF otherwise and for a file with none.
 */
export function eolOf(text: string): string {
  let crlf = 0;
  let all = 0;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) {
    all++;
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
  }
  return crlf * 2 > all ? "\r\n" : "\n";
}

/**
 * The line ending of the line `at` is on — what a rewrite of the block starting there writes, so a
 * CRLF card in a mixed file stays CRLF. The file's own (`eolOf`) when that line is the last.
 */
export function eolAt(text: string, at: number): string {
  const i = text.indexOf("\n", at);
  if (i < 0) return eolOf(text);
  return i > 0 && text.charCodeAt(i - 1) === 13 ? "\r\n" : "\n";
}
