/**
 * What a cell means, and the view a tab's sort and filter make of its rows.
 *
 * A cell is text in the file, always. Its column's type says how that text is *read* — as a number,
 * a date, a tick, one of a select's options, a link — and a value that does not read is kept as it
 * was written, drawn that way and warned `WT_CELL`; it sorts after every value that does. Nothing
 * here rewrites a cell: a column changed from text to number shows its words as words until
 * somebody types numbers.
 *
 * Browser-free and alias-free, for `parse.ts`'s reason.
 */
import { parseDagUrl } from "../refs/extract";
import type { Column, ColumnType, FilterRule, Row, SortKey, Tab, Table } from "./parse";
import type { TableDiagnostic } from "./codes";

/** A cell as its type reads it. `null` is an empty cell; `ok: false` a value the type cannot read. */
export type Read =
  | { ok: true; value: null }
  | { ok: true; value: number }
  | { ok: true; value: string }
  | { ok: true; value: boolean }
  | { ok: true; value: LinkValue }
  | { ok: false; value: string };

export interface LinkValue {
  /** What the link says: the brackets' words, or the URL itself for a bare one. */
  text: string;
  url: string;
  /** For a `dag:` URL, the id and the part it names. */
  ref?: { id: string; part?: string };
}

const NUMBER = /^[-+]?(?:\d{1,3}(?:[, _]\d{3})+|\d+)(?:\.\d+)?$|^[-+]?\.\d+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MD_LINK = /^\[([^\]]*)\]\(\s*<?([^()\s>]+)>?\s*\)$/;
const URL_LIKE = /^(?:https?:\/\/|mailto:|dag:)\S+$/i;

const CHECKED = new Set(["[x]", "x", "true", "yes", "✓", "✔", "1"]);
const UNCHECKED = new Set(["[ ]", "[]", "false", "no", "0"]);

/** A number as a person writes one: `1200`, `-3.5`, `1,200`, `1 200`. */
export function readNumber(text: string): number | null {
  const t = text.trim();
  if (!NUMBER.test(t)) return null;
  const n = Number(t.replace(/[, _]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** A `YYYY-MM-DD` that is a real day. */
export function readDate(text: string): string | null {
  const m = DATE.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d ? m[0]! : null;
}

export function readCheckbox(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  if (t === "") return false;
  if (CHECKED.has(t)) return true;
  if (UNCHECKED.has(t)) return false;
  return null;
}

export function readLink(text: string): LinkValue | null {
  const t = text.trim();
  const md = MD_LINK.exec(t);
  const url = md ? md[2]! : URL_LIKE.test(t) ? t : null;
  if (!url || !URL_LIKE.test(url)) return null;
  const ref = parseDagUrl(url);
  return { text: md ? md[1]!.trim() || url : url, url, ...(ref ? { ref } : {}) };
}

/** The options a select offers: its declared ones, or — with none declared — the values its column holds. */
export function optionsOf(column: Column, rows: readonly Row[], index: number): string[] {
  if (column.options?.length) return column.options;
  const seen: string[] = [];
  for (const r of rows) {
    const v = (r.cells[index] ?? "").trim();
    if (v && !seen.includes(v)) seen.push(v);
  }
  return seen;
}

/** One cell read by its column's type. */
export function readCell(type: ColumnType, text: string, options?: readonly string[]): Read {
  const t = text.trim();
  if (type !== "checkbox" && t === "") return { ok: true, value: null };
  switch (type) {
    case "text":
      return { ok: true, value: text };
    case "number": {
      const n = readNumber(t);
      return n === null ? { ok: false, value: text } : { ok: true, value: n };
    }
    case "date": {
      const d = readDate(t);
      return d === null ? { ok: false, value: text } : { ok: true, value: d };
    }
    case "checkbox": {
      const b = readCheckbox(t);
      return b === null ? { ok: false, value: text } : { ok: true, value: b };
    }
    case "select":
      return !options || options.length === 0 || options.includes(t) ? { ok: true, value: t } : { ok: false, value: text };
    case "link": {
      const l = readLink(t);
      return l === null ? { ok: false, value: text } : { ok: true, value: l };
    }
  }
}

/** What a type expects, in the words a `WT_CELL` uses. */
const EXPECTS: Record<ColumnType, string> = {
  text: "text",
  number: "a number, such as `1200` or `-3.5`",
  date: "a date written `YYYY-MM-DD`",
  checkbox: "`[x]` or `[ ]`",
  select: "one of the column's options",
  link: "a link, `[words](https://…)` or `[Title](dag:<id>)`, or a bare URL",
};

/**
 * `WT_CELL` for every cell of a table its column cannot read. Separate from `parseTable` because it
 * is the part of a parse only a checker wants — the page reads cells itself as it draws them, and
 * reading every cell twice to say nothing is a cost on the busiest thing the page does.
 */
function cellDiagnostics(table: Table): TableDiagnostic[] {
  const out: TableDiagnostic[] = [];
  for (const tab of table.tabs) {
    tab.columns.forEach((col, i) => {
      if (col.type === "text") return;
      const options = col.type === "select" ? col.options : undefined;
      for (const row of tab.rows) {
        const r = readCell(col.type, row.cells[i] ?? "", options);
        if (!r.ok)
          out.push({
            code: "WT_CELL",
            severity: "warning",
            line: row.line,
            col: (row.segments[i]?.start ?? row.span.start) - row.span.start + 1,
            message: `\`${r.value.trim()}\` is not ${EXPECTS[col.type]}, which the column \`${col.name || col.id || i + 1}\` holds.`,
            ...(tab.id ? { tab: tab.id } : {}),
          });
      }
    });
  }
  return out;
}

/** Every diagnostic a table has: the parse's and the cells'. */
export function tableDiagnostics(table: Table): TableDiagnostic[] {
  return [...table.diagnostics, ...cellDiagnostics(table)].sort((a, b) => a.line - b.line || a.col - b.col);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Where a read value sorts: a key within its rank, the ranks being value, unreadable, empty. */
function sortable(type: ColumnType, text: string, options: readonly string[]): { rank: number; key: number | string } {
  const r = readCell(type, text, options);
  if (!r.ok) return { rank: 1, key: r.value.trim() };
  const v = r.value;
  if (v === null) return { rank: 2, key: 0 };
  if (type === "checkbox") return { rank: 0, key: v === true ? 1 : 0 };
  if (type === "select") {
    const at = options.indexOf(String(v));
    return { rank: 0, key: at === -1 ? options.length : at };
  }
  if (typeof v === "number") return { rank: 0, key: v };
  if (typeof v === "object") return { rank: 0, key: (v as LinkValue).text };
  return { rank: 0, key: String(v) };
}

const compareKeys = (a: number | string, b: number | string): number =>
  typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));

/**
 * The rows in the order the tab's sort puts them, each with its stored index. **Stable**: the
 * stored order breaks every tie, which is what makes clearing a sort give the order back and what
 * makes two readers agree. Empty cells go last whichever the direction, and a value the type cannot
 * read goes after every value that reads.
 */
export function sortRows(tab: Pick<Tab, "columns" | "rows">, keys: readonly SortKey[]): { row: Row; index: number }[] {
  const indexed = tab.rows.map((row, index) => ({ row, index }));
  const cols = keys
    .map((k) => {
      const i = tab.columns.findIndex((c) => c.id === k.column);
      return i === -1 ? null : { i, desc: k.desc, col: tab.columns[i]!, options: optionsOf(tab.columns[i]!, tab.rows, i) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (cols.length === 0) return indexed;
  const keyed = indexed.map((e) => ({ ...e, keys: cols.map((c) => sortable(c.col.type, e.row.cells[c.i] ?? "", c.options)) }));
  keyed.sort((a, b) => {
    for (let k = 0; k < cols.length; k++) {
      const x = a.keys[k]!;
      const y = b.keys[k]!;
      if (x.rank !== y.rank) return x.rank - y.rank;
      if (x.rank === 2) continue;
      const c = compareKeys(x.key, y.key);
      if (c !== 0) return cols[k]!.desc && x.rank === 0 ? -c : c;
    }
    return a.index - b.index;
  });
  return keyed.map(({ row, index }) => ({ row, index }));
}

/** Whether one row passes one rule. */
function passes(column: Column, text: string, rule: FilterRule, options: readonly string[] = []): boolean {
  const cell = text.trim();
  const want = rule.value.trim();
  if (want === "" && (rule.op === "=" || rule.op === "!=")) {
    const empty = column.type === "checkbox" ? readCheckbox(cell) === false : cell === "";
    return rule.op === "=" ? empty : !empty;
  }
  const r = readCell(column.type, cell, options);
  const words = (
    r.ok && r.value !== null && typeof r.value === "object"
      ? (r.value as LinkValue).text + " " + (r.value as LinkValue).url
      : cell
  ).toLowerCase();
  const target = want.toLowerCase();
  switch (rule.op) {
    case "~":
      return words.includes(target);
    case "!~":
      return !words.includes(target);
    default:
      break;
  }
  /* A comparison, typed where both sides read as the column's type and as words where either does not. */
  let order: number | null = null;
  if (column.type === "number") {
    const a = readNumber(cell);
    const b = readNumber(want);
    if (a !== null && b !== null) order = a - b;
  } else if (column.type === "date") {
    const a = readDate(cell);
    const b = readDate(want);
    if (a !== null && b !== null) order = a < b ? -1 : a > b ? 1 : 0;
  } else if (column.type === "checkbox") {
    const a = readCheckbox(cell);
    const b = readCheckbox(want);
    if (a !== null && b !== null) order = Number(a) - Number(b);
  } else if (column.type === "select" && options.includes(cell) && options.includes(want)) {
    order = options.indexOf(cell) - options.indexOf(want);
  }
  if (order === null) {
    if (cell === "" && rule.op !== "!=") return false;
    /* More or less than a number that is not one, or a date that is not one, is neither. */
    if (rule.op !== "=" && rule.op !== "!=" && (column.type === "number" || column.type === "date")) return false;
    /* A link compares by what it says, which is what a person sees in the cell. */
    const seen = r.ok && r.value !== null && typeof r.value === "object" ? (r.value as LinkValue).text : cell;
    order = collator.compare(seen, want);
  }
  switch (rule.op) {
    case "=":
      return order === 0;
    case "!=":
      return order !== 0;
    case ">":
      return order > 0;
    case ">=":
      return order >= 0;
    case "<":
      return order < 0;
    case "<=":
      return order <= 0;
  }
  return true;
}

/** The rows a tab shows: its filter kept, in its sort's order, each with its stored index. */
export function viewRows(
  tab: Pick<Tab, "columns" | "rows" | "sort" | "filter">,
  sort: readonly SortKey[] = tab.sort,
  filter: readonly FilterRule[] = tab.filter,
): { row: Row; index: number }[] {
  const rules = filter
    .map((rule) => {
      const i = tab.columns.findIndex((c) => c.id === rule.column);
      return i === -1 ? null : { rule, i, col: tab.columns[i]!, options: optionsOf(tab.columns[i]!, tab.rows, i) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return sortRows(tab, sort).filter(({ row }) => rules.every((r) => passes(r.col, row.cells[r.i] ?? "", r.rule, r.options)));
}
