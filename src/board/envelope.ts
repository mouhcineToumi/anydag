/**
 * A board's permanent id, carried across an export and an import.
 *
 * The id lives in the store and never in the board file, so a `.board.md`
 * saved to somebody's disk would arrive back as a stranger: a new document, and every reference to
 * the old one dangling. So the *export* writes `id:` into the frontmatter as an envelope, and the
 * *import* takes it out again before the text is stored and asks the store to adopt it. The file in
 * the store is what it was; only the copy in transit says who it is.
 *
 * No browser, no `@/` aliases: `src/board/`'s rule.
 */

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;
const ID_LINE = /^id:[ \t]*["']?([0-9a-z]{10})["']?[ \t]*$/m;

/** The text with `id: <id>` as the frontmatter's first key, a frontmatter made if there is none. */
export function sealId(text: string, id: string): string {
  const m = FRONT.exec(text);
  if (!m) return `---\nid: ${id}\n---\n\n${text}`;
  const yaml = m[1]!.replace(ID_LINE, "").replace(/^\s*\n/, "");
  const nl = m[2] || "\n";
  return `---\nid: ${id}${yaml ? `\n${yaml}` : ""}\n---${nl}${text.slice(m[0].length)}`;
}

/**
 * The envelope opened: the id it carried, if any, and the text without it. A frontmatter left
 * holding nothing is taken away with the blank line after it, so an export of a board that had
 * none imports byte for byte as the board it was.
 */
export function openId(text: string): { text: string; id?: string } {
  const m = FRONT.exec(text);
  if (!m) return { text };
  const found = ID_LINE.exec(m[1]!);
  if (!found) return { text };
  const yaml = m[1]!
    .replace(ID_LINE, "")
    .replace(/^\s*\n/, "")
    .replace(/\n\s*$/, "");
  const rest = text.slice(m[0].length);
  if (!yaml.trim()) return { text: rest.replace(/^\r?\n/, ""), id: found[1] };
  return { text: `---\n${yaml}\n---${m[2] || "\n"}${rest}`, id: found[1] };
}

/**
 * What a file coming back in becomes, by its name: a `.quiz.md` a quiz, a `.note.md` a note, and a
 * `.board.md` — or any Markdown with frontmatter, which is what a board exported under another name
 * still is — a board. `null` is text to be read onto the board it was dropped on, as items.
 *
 * **The suffix first.** Until the quiz both importers asked only "does it have
 * frontmatter", and every note has it — so an exported `.note.md` dropped back in came
 * out a board, named `x-note`, with its prose as loose items. The canvas's import and `anydag import`
 * both ask this, so the two cannot come to disagree.
 */
export function importKind(fileName: string, text: string): "board" | "note" | "quiz" | "table" | null {
  const name = fileName.toLowerCase();
  if (name.endsWith(".table.md")) return "table";
  if (name.endsWith(".quiz.md")) return "quiz";
  if (name.endsWith(".note.md")) return "note";
  if (name.endsWith(".board.md") || /^---\r?\n/.test(text)) return "board";
  return null;
}
