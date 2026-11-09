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

export interface NoteFile {
  /** The frontmatter block including both `---` lines and the newline after them, or `""`. */
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

const FRONT = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitNote(text: string): NoteFile {
  const m = FRONT.exec(text);
  if (!m) return { front: "", body: text };
  const front = m[0];
  let title: string | undefined;
  try {
    const data = parseYaml(front.replace(/^---\r?\n/, "").replace(/\r?\n---[ \t]*(?:\r?\n)?$/, ""));
    if (data && typeof data === "object" && typeof (data as { title?: unknown }).title === "string") {
      const t = (data as { title: string }).title.trim();
      if (t) title = t;
    }
  } catch {
    /* A frontmatter that is not YAML is still carried; it just names no title. */
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
