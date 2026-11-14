/**
 * Locating fenced blocks in a board file.
 *
 * **Imported by both the app and the Vite plugin**, so the server rewrites exactly the line the
 * client is showing. Anything that has to agree about "which line is this item" lives here.
 *
 * A fence is CommonMark-ish: three or more backticks, an info string, and a closing run of at least
 * as many backticks. Fences inside a fence are not scanned, which is what lets a `md` item contain
 * a fenced code sample.
 */

export interface RawFence {
  /** `arch`, `md`, `image`… — the first word of the info string. */
  type: string;
  /** The `{…}` part of the info string, without the braces. Empty when absent. */
  attrText: string;
  /** Everything between the fence lines, newlines preserved, no trailing newline. */
  body: string;
  /** 1-based line of the opening fence, for diagnostics. */
  line: number;
  /** Character offsets of the opening fence line, so a rewrite can splice it. */
  openStart: number;
  openEnd: number;
  /** Character offset just past the closing fence line (or EOF for an unclosed fence). */
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
     an info string, which is common (three `md` blocks in a row). */
  const offsets: number[] = [];
  let at = 0;
  for (const l of lines) {
    offsets.push(at);
    at += l.length + 1;
  }

  let i = 0;
  while (i < lines.length) {
    const m = lines[i]!.length > LONGEST_OPEN ? null : OPEN.exec(lines[i]!);
    if (!m) {
      i++;
      continue;
    }
    const ticks = m[2]!;
    const type = m[3] ?? "";
    const attrText = m[4] ? m[4].slice(1, -1) : "";
    const openStart = offsets[i]!;
    const openEnd = openStart + lines[i]!.length;

    let j = i + 1;
    const close = new RegExp(`^[ \\t]*\`{${ticks.length},}[ \\t]*$`);
    while (j < lines.length && !close.test(lines[j]!)) j++;

    const body = lines.slice(i + 1, j).join("\n");
    const blockEnd = j < lines.length ? offsets[j]! + lines[j]!.length : text.length;

    out.push({ type, attrText, body, line: i + 1, openStart, openEnd, blockEnd, closed: j < lines.length });
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
