/**
 * Where a document's frontmatter is: the block between a `---` line at the very start of the text
 * and the next `---` line — **when what is between them is one**.
 *
 * Two `---` lines are also how Markdown draws two rules, so the pair alone says nothing: a note
 * whose body opens with a rule and has another one further down had everything between the two
 * read as frontmatter, out of the editor, the read-only page, search and its links (#397). A block
 * is a frontmatter when YAML reads it as a mapping, or when it holds nothing but blank lines. A
 * block YAML cannot read at all is one when its first line is a `key:` line — a frontmatter
 * somebody broke is still carried byte for byte, not drawn as text. Anything else — a sentence, a
 * heading, a list, a comment — is the body's, and two rules with it in between.
 *
 * Every reader and writer of a note's frontmatter asks here, so that what the page draws as the
 * body is what `withTask`, `withTags` and `withTitle` leave alone: a writer that took a sentence
 * for a frontmatter would put a `status:` line into the person's text.
 *
 * No browser, no React, no `@/` aliases: `src/board/`'s rule, for the reason it gives.
 */
import { parse as parseYaml } from "yaml";

import { QUIET } from "./quiet";

/** A pair of `---` lines at the start of a text: the whole block in `[0]`, what is between in `[1]`. */
const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** A line that opens a mapping's entry: a plain key, then a colon that ends it. */
const KEY_LINE = /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*[ \t]*:(?:[ \t]|$)/u;

/* The readers of one text ask in turn — the index reads a note's task, project, event, tags and
   title one after another — so the last block's answer is kept. */
let last: { inner: string; is: boolean } | null = null;

/** Whether `inner`, the lines between the two `---`, is a frontmatter. */
function isFront(inner: string): boolean {
  if (last?.inner === inner) return last.is;
  const is = judged(inner);
  last = { inner, is };
  return is;
}

function judged(inner: string): boolean {
  if (inner.trim() === "") return true;
  let data: unknown;
  try {
    data = parseYaml(inner, QUIET);
  } catch {
    const first = inner.split(/\r?\n/).find((l) => l.trim() !== "" && !/^\s*#/.test(l));
    return first !== undefined && KEY_LINE.test(first);
  }
  return data !== null && typeof data === "object" && !Array.isArray(data);
}

/**
 * The frontmatter `text` opens with — the whole block, both `---` lines and the line end after the
 * second, in `[0]`, and the lines between in `[1]` — or `null` when it opens with none.
 */
export function frontBlock(text: string): RegExpExecArray | null {
  const m = BLOCK.exec(text);
  return m && isFront(m[1]!) ? m : null;
}
