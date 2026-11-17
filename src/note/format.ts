/**
 * The `.note.md` file: optional frontmatter, then GitHub-flavoured Markdown.
 *
 * The frontmatter is carried **byte for byte**. The editor never sees it and never writes it, so
 * whatever an agent put there — a `title:`, keys this code has never heard of, a comment — comes
 * back exactly as it went in. `title` is read, for the toolbar and the top of the page, the way a
 * board's is. It is written by the api's `/retitle` and never here: the title at the top of the page
 * renames the file, so the server writes it.
 *
 * No browser, no React, no `@/` aliases: `src/board/`'s rule, for the reason it gives.
 */
import { parse as parseYaml } from "yaml";

import { markOf } from "./bom";
import { frontBlock } from "./front";
import { QUIET } from "./quiet";

export interface NoteFile {
  /**
   * Everything before the Markdown: the frontmatter block including both `---` lines and the newline
   * after them, or `""` — behind the file's byte-order mark when it opens with one, which is carried
   * here even with no frontmatter, so the body the editor holds never starts with it (`bom.ts`).
   */
  front: string;
  /** Everything after it: the Markdown the editor holds. */
  body: string;
  /** `title:` from the frontmatter, when it is a non-empty string. */
  title?: string;
}

/** What a new file is called until somebody names it. A title, never a name anybody has to see. */
export const UNTITLED = "Untitled";

/** The family a file nobody has named wears: `Untitled`, and the numbers `unique()` gives it. */
const UNNAMED = /^untitled(?: \d+)?$/i;

/**
 * A note's text as its frontmatter and its body. Only a block that is a frontmatter is one
 * (`front.ts`): a body that opens with a rule and has another further down is all body, rules
 * included, and is drawn so (#397). A byte-order mark goes in `front`, with the frontmatter behind
 * it or alone, so the body the editor holds never starts with one (#394).
 */
export function splitNote(text: string): NoteFile {
  const m = frontBlock(text);
  if (!m) {
    const mark = markOf(text);
    return { front: mark, body: text.slice(mark.length) };
  }
  const front = m[0];
  let title: string | undefined;
  try {
    const data = parseYaml(m[1]!, QUIET);
    if (data && typeof data === "object" && typeof (data as { title?: unknown }).title === "string") {
      const t = (data as { title: string }).title.trim();
      if (t) title = t;
    }
  } catch {
    /* A frontmatter YAML cannot read, but that opens with a `key:` line, is still carried; it names no title. */
  }
  return { front, body: text.slice(front.length), title };
}

export function joinNote(front: string, body: string): string {
  return front + body;
}

/**
 * What a note's page calls it: its frontmatter's `title:`, else the leaf of the name it is filed
 * under. The server keeps a title once, in the file's name, and drops the `title:` line when the
 * two agree (`titled()` in `POST /__board/create`), so a note made with a title — from the calendar,
 * the Tasks page or the sidebar — has only the name to read. A file nobody has named is `undefined`,
 * which the title field draws as its placeholder.
 */
export function pageTitle(name: string, title: string | undefined): string | undefined {
  if (title !== undefined) return title === UNTITLED ? undefined : title;
  const leaf = name.slice(name.lastIndexOf("/") + 1);
  return leaf && !UNNAMED.test(leaf) ? leaf : undefined;
}

/** Longer than anyone names a document, short enough that a pasted paragraph does not become one. */
export const TITLE_MAX = 200;

/** A title as typed: one line, trimmed, capped — or `null` when there is nothing to it. `clean_title`'s rule. */
export function cleanTitle(raw: string): string | null {
  return raw.split(/\s+/).filter(Boolean).join(" ").slice(0, TITLE_MAX).trim() || null;
}
