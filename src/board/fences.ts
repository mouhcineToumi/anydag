/**
 * Locating fenced blocks in a board file.
 *
 * **Imported by both the app and the Vite plugin**, so the server rewrites exactly the line the
 * client is showing. Anything that has to agree about "which line is this item" lives here.
 *
 * A fence is CommonMark-ish: three or more backticks, an info string, and a closing run of at least
 * as many backticks. Fences inside a fence are not scanned, which is what lets a `md` item contain
 * a fenced code sample.
 *
 * **A line ends at `\n`, and a `\r` before it is part of the break**; a BOM at offset 0 is part of
 * no line (`eol.ts`). So a CRLF file scans to the fences its LF twin does: every offset stops short
 * of the `\r`, and `body` is LF. Matching each line with the `\r` still on it found no fence at all
 * in a CRLF board, which then read as one prose card (#391).
 */

import { bomLength } from "./eol";

export interface RawFence {
  /** `arch`, `md`, `image`… — the first word of the info string. */
  type: string;
  /** The `{…}` part of the info string, without the braces. Empty when absent. */
  attrText: string;
  /** Everything between the fence lines, no trailing newline, every line break LF whatever the file's. */
  body: string;
  /** 1-based line of the opening fence, for diagnostics. */
  line: number;
  /** Character offsets of the opening fence line, so a rewrite can splice it. Its line break is outside. */
  openStart: number;
  openEnd: number;
  /**
   * The body's span in the file, its own line breaks as written: from the line after the opening
   * fence to the end of the last body line, its break outside (to EOF for an unclosed fence).
   * `body` is this span made LF. Zero body lines and one empty one are both an empty span.
   */
  bodyStart: number;
  bodyEnd: number;
  /** Character offset just past the closing fence line, its line break outside (or EOF for an unclosed fence). */
  blockEnd: number;
  /** False when the file ended before a closing run of backticks. */
  closed: boolean;
}

/*
 * Each run of blanks is matched by exactly one `[ \t]*`: the one after the type and the one after the
 * braces belong to their groups. Three of them side by side, as this once was, let a line of a fence
 * opener, thousands of spaces and one stray character try every way of splitting the spaces between
 * them — cubic time, and seconds of the grammar's thread on a line of 3 KB (#9).
 */
const OPEN = /^([ \t]*)(`{3,})[ \t]*(?:([A-Za-z][A-Za-z0-9-]*)[ \t]*)?(?:(\{[^\n]*\})[ \t]*)?$/;

/**
 * The longest line read as an opening fence. An opener is three backticks, a word and its attributes;
 * a longer line is prose, and is not handed to the pattern at all — whatever the pattern costs, a
 * line from somebody else's vault costs no more than this.
 */
const LONGEST_OPEN = 16 * 1024;

export function scanFences(text: string): RawFence[] {
  const out: RawFence[] = [];
  const lines = text.split("\n");

  /* Offsets are tracked as we go: `text.indexOf` would find the wrong line when two fences share
     an info string, which is common (three `md` blocks in a row). `from` and `content` are a line
     without what is not part of it — the BOM before the first, the `\r` of a CRLF break after any. */
  const offsets: number[] = [];
  let at = 0;
  for (const l of lines) {
    offsets.push(at);
    at += l.length + 1;
  }
  const bom = bomLength(text);
  const from = (i: number): number => offsets[i]! + (i === 0 ? bom : 0);
  const content = (i: number): string => {
    const l = lines[i]!;
    const end = l.endsWith("\r") ? l.length - 1 : l.length;
    return i === 0 && bom ? l.slice(bom, end) : end === l.length ? l : l.slice(0, end);
  };

  let i = 0;
  while (i < lines.length) {
    const line = content(i);
    const m = line.length > LONGEST_OPEN ? null : OPEN.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const ticks = m[2]!;
    const type = m[3] ?? "";
    const attrText = m[4] ? m[4].slice(1, -1) : "";
    const openStart = from(i);
    const openEnd = openStart + line.length;

    let j = i + 1;
    const close = new RegExp(`^[ \\t]*\`{${ticks.length},}[ \\t]*$`);
    while (j < lines.length && !close.test(content(j))) j++;

    const inner: string[] = [];
    for (let k = i + 1; k < j; k++) inner.push(content(k));
    const body = inner.join("\n");
    const bodyStart = i + 1 < lines.length ? offsets[i + 1]! : text.length;
    /* An unclosed fence's body runs to EOF, the trailing break included, as its `body` does. */
    const bodyEnd = j >= lines.length ? text.length : j > i + 1 ? from(j - 1) + content(j - 1).length : bodyStart;
    const blockEnd = j < lines.length ? from(j) + content(j).length : text.length;

    out.push({ type, attrText, body, line: i + 1, openStart, openEnd, bodyStart, bodyEnd, blockEnd, closed: j < lines.length });
    i = j + 1;
  }

  return out;
}

/**
 * Rewrite one fence's attribute list in place, touching nothing else in the file.
 *
 * Returns `null` when the offsets do not land on a fence line, so a caller can tell "the file moved
 * under me" from "nothing to change" — the difference between a 409 and a no-op. The doc comment
 * has always claimed this; the code returned the text unchanged, which reported success for a
 * write that never happened.
 *
 * `attrText` is the inner text, no braces: `serializeAttrs` produces exactly that.
 */
export function rewriteFenceAttrs(text: string, fence: RawFence, attrText: string): string | null {
  const line = text.slice(fence.openStart, fence.openEnd);
  const m = line.length > LONGEST_OPEN ? null : OPEN.exec(line);
  if (!m) return null;
  const indent = m[1] ?? "";
  const ticks = m[2]!;
  const type = m[3] ?? "";
  const rebuilt = `${indent}${ticks}${type}${attrText ? ` {${attrText}}` : ""}`;
  return text.slice(0, fence.openStart) + rebuilt + text.slice(fence.openEnd);
}
