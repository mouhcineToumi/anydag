/**
 * A stable name for every way a table can be wrong.
 *
 * The quiz's rule one kind over (`src/quiz/codes.ts`): the message is for a person and may be
 * reworded, the code is for a program and is not. `ET_` is an error and `WT_` a warning about a table
 * that still works — and a table almost always does: a cell its type cannot read is drawn as written,
 * a row with no id is given one, a sort naming a column that went is ignored. The one error is two
 * things claiming one id, because an agent addressing either would reach whichever came first.
 *
 * The skill's *Writing a table* section names every one of these, and `check-skill.mjs` reads this
 * file by regex to hold it to that, so a code added here is a line added there.
 *
 * Codes are append-only. Retiring one is fine; reusing a retired one for something else is not.
 */
const TABLE_CODES = {
  /** Two tabs, or two columns or two rows in one tab, claiming one `{#id}`. */
  ET_DUPLICATE_ID: "ET_DUPLICATE_ID",
  /** A tab, a column or a row with no `{#id}` yet. It works; it is given one the first time anything writes. */
  WT_NO_ID: "WT_NO_ID",
  /** A word in a `{…}` that means nothing there — on a heading, a header cell or a row's first cell. */
  WT_UNKNOWN_ATTR: "WT_UNKNOWN_ATTR",
  /** A value its column's type cannot read: a word in a number column, a date that is not `YYYY-MM-DD`. */
  WT_CELL: "WT_CELL",
  /** A row with more cells than the header. Every GFM reader ignores the extra ones, and so does this. */
  WT_ROW_WIDTH: "WT_ROW_WIDTH",
  /** Something under a tab that is not its table: a paragraph, a second table. Kept, and ignored. */
  WT_STRAY: "WT_STRAY",
  /** A tab's `sort=` naming a column the tab does not have, or a direction that is not `asc` or `desc`. */
  WT_BAD_SORT: "WT_BAD_SORT",
  /** A tab's `filter=` rule that does not read, or that names a column the tab does not have. */
  WT_BAD_FILTER: "WT_BAD_FILTER",
  /** A code block opened and never closed, so everything after it is code and no tab. */
  WT_OPEN_FENCE: "WT_OPEN_FENCE",
  /** A table above the first `##`: part of the description, and no tab. */
  WT_LOOSE_TABLE: "WT_LOOSE_TABLE",
  /** A table with no tabs in it yet. */
  WT_EMPTY: "WT_EMPTY",
} as const;

export type TableCode = keyof typeof TABLE_CODES;

export interface TableDiagnostic {
  code: TableCode;
  severity: "error" | "warning";
  /** The file's line, 1-based, frontmatter counted — the number a person or an agent would count. */
  line: number;
  /** 1-based. */
  col: number;
  message: string;
  /** The tab it is about, when it has an id. */
  tab?: string;
}
