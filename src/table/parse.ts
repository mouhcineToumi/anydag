/**
 * A table: `<name>.table.md`, the fourth kind of file.
 *
 *     ---
 *     title: Q3 pipeline
 *     ---
 *
 *     Anything before the first tab is the table's description.
 *
 *     ## Deals {#deals sort="amount:desc" filter="stage!=Lost"}
 *
 *     | Name {#name} | Amount {#amount number} | Stage {#stage select options="Lead,Won,Lost"} |
 *     | --- | ---: | --- |
 *     | Acme {#r7k2m} | 1200 | Won |
 *
 * **A tab is a `##` heading and everything up to the next one** — the quiz's rule, and for its
 * reason: only `##` delimits, and fences are tracked across the whole file, so a table inside a code
 * sample is code. The tab's grid is **the first GFM table under its heading**; anything else under
 * it is kept by every writer and warned `WT_STRAY`.
 *
 * **Every part knows its span**, so a writer (`write.ts`) splices exactly the cell, the line or the
 * tab it is about and leaves every other byte alone — an author's padded columns included.
 *
 * GFM is followed where it decides something: a header row and a delimiter row with the same number
 * of cells make a table, a row with fewer cells is padded and one with more is cut, `\|` is a pipe
 * inside a cell, and the table ends at a blank line or the start of another block.
 *
 * No browser, no React, no `@/` aliases: the local server and the CLI import this verbatim.
 */
import { parseAttrs, type AttrError, type Attrs } from "../board/attrs";
import type { TableCode, TableDiagnostic } from "./codes";

/** A range of the text, `[start, end)`, in string offsets. */
interface Span {
  start: number;
  end: number;
}

/** What a column holds. `text` is the default and is never written. */
export type ColumnType = "text" | "number" | "date" | "checkbox" | "select" | "link";

export const COLUMN_TYPES: readonly ColumnType[] = ["text", "number", "date", "checkbox", "select", "link"];

export const isColumnType = (s: unknown): s is ColumnType => typeof s === "string" && (COLUMN_TYPES as readonly string[]).includes(s);

export interface Column {
  /** `{#…}` on the header cell; absent until something mints one (`WT_NO_ID`). */
  id?: string;
  /** The header cell's words, without its `{…}`, as a person reads them. */
  name: string;
  type: ColumnType;
  /** A select's declared options, in order; absent when none are written. */
  options?: string[];
  /** Its width in pixels, as a person dragged it. */
  w?: number;
  /** Attributes this parser does not know, kept in their order so a rewrite puts them back. */
  extra: Attrs;
  /** The header cell's segment, between its two pipes. */
  span: Span;
}

export interface Row {
  id?: string;
  /** Its height in pixels, as a person dragged it. */
  h?: number;
  /**
   * Each cell as a person reads it, one per column: `\|` a pipe and `<br>` a line break. The first
   * cell's `{#id}` is taken off. A cell the row is short of is `""`.
   */
  cells: string[];
  /** Attributes on the first cell this parser does not know. */
  extra: Attrs;
  /** The row's line, 1-based. */
  line: number;
  /** The whole line, its newline included. */
  span: Span;
  /** Each cell's segment between its pipes, for the cells the line actually has. */
  segments: Span[];
}

export interface SortKey {
  column: string;
  desc: boolean;
}

export type FilterOp = "=" | "!=" | "~" | "!~" | ">" | ">=" | "<" | "<=";

export const FILTER_OPS: readonly FilterOp[] = ["=", "!=", "~", "!~", ">", ">=", "<", "<="];

export interface FilterRule {
  column: string;
  op: FilterOp;
  value: string;
}

/** Where a tab's grid sits: the header line, the delimiter line, and the end of its last row. */
interface Grid {
  header: Span;
  delimiter: Span;
  /** After the last row's newline — where a row appended at the end goes. */
  end: number;
}

export interface Tab {
  id?: string;
  /** The heading's words, without its `{…}`. */
  name: string;
  /** `sort=` as written, and as read; a key naming no column is dropped from `sort`. */
  sortText?: string;
  sort: SortKey[];
  /** `filter=` as written, and as read; a rule that does not read is dropped from `filter`. */
  filterText?: string;
  filter: FilterRule[];
  /** Heading attributes this parser does not know. */
  extra: Attrs;
  columns: Column[];
  rows: Row[];
  /** The heading's line. */
  line: number;
  /** The heading line, its newline included. */
  heading: Span;
  /**
   * From the start of the heading line to the end of the tab's last line that is not blank. The
   * blank lines after it belong to nobody, which is what lets a writer move or remove a tab without
   * touching the gap before the next one.
   */
  span: Span;
  /** Absent for a tab with no table under it yet. */
  grid?: Grid;
}

export interface Table {
  /** The frontmatter block, delimiters and newline included, or `""`. */
  front: string;
  /** Everything between the frontmatter and the first tab, trimmed of blank lines. */
  description: string;
  descriptionSpan: Span;
  tabs: Tab[];
  diagnostics: TableDiagnostic[];
}

/** The frontmatter pattern `splitNote`, `titleOf` and `parseQuiz` use: a block at the very start. */
const FRONT = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const HEADING = /^ {0,3}##(?=[ \t]|$)(.*)$/;
/** Any ATX heading, which ends a table as another block would. */
const ANY_HEADING = /^ {0,3}#{1,6}(?=[ \t]|$)/;
const CLOSING = /(?:^|[ \t]+)#+[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const QUOTE = /^ {0,3}>/;
const DELIMITER_CELL = /^:?-+:?$/;

interface Line {
  text: string;
  start: number;
  /** After its newline. */
  end: number;
  n: number;
}

function linesOf(text: string, from: number, firstLine: number): Line[] {
  const out: Line[] = [];
  let at = from;
  let n = firstLine;
  while (at < text.length) {
    const nl = text.indexOf("\n", at);
    const stop = nl === -1 ? text.length : nl + 1;
    const raw = text.slice(at, nl === -1 ? text.length : nl);
    out.push({ text: raw.endsWith("\r") ? raw.slice(0, -1) : raw, start: at, end: stop, n });
    at = stop;
    n++;
  }
  return out;
}

function fenceOpen(line: string): { char: string; len: number } | null {
  const m = FENCE_OPEN.exec(line);
  if (!m) return null;
  if (m[1]![0] === "`" && m[2]!.includes("`")) return null;
  return { char: m[1]![0]!, len: m[1]!.length };
}

function fenceCloses(line: string, fence: { char: string; len: number }): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return !!m && m[1]![0] === fence.char && m[1]!.length >= fence.len;
}

/** One cell's segment of a row line: the raw text between its pipes, and where it is. */
export interface Segment {
  /** Trimmed, escapes intact — the cell as it is written. */
  raw: string;
  /** Absolute offsets of everything between the two pipes, padding included. */
  start: number;
  end: number;
}

/**
 * A GFM row split into its cells. A leading and a trailing pipe are optional, and a pipe preceded by
 * a backslash is part of a cell rather than the end of one — which is GFM's rule inside code spans
 * too, so backticks need no case of their own. `null` for a line with no pipe at all, which is not a
 * row this parser will start a table with (though it continues one, as GFM does).
 */
export function splitRow(line: string, offset = 0): Segment[] {
  let i = 0;
  while (i < line.length && i < 3 && line[i] === " ") i++;
  let end = line.length;
  while (end > i && (line[end - 1] === " " || line[end - 1] === "\t")) end--;
  if (line[i] === "|") i++;
  /* A trailing pipe closes the row unless it is escaped. */
  if (end > i && line[end - 1] === "|" && line[end - 2] !== "\\") end--;
  const out: Segment[] = [];
  let from = i;
  for (let j = i; j <= end; j++) {
    if (j === end || (line[j] === "|" && line[j - 1] !== "\\")) {
      out.push({ raw: line.slice(from, j).trim(), start: offset + from, end: offset + j });
      from = j + 1;
    }
  }
  return out;
}

const hasPipe = (line: string): boolean => /(^|[^\\])\|/.test(line);

/** The delimiter row's cells, or `null` when the line is not one. */
function delimiterCells(line: string): Segment[] | null {
  if (!/^[ \t|:-]+$/.test(line) || !line.includes("-")) return null;
  const cells = splitRow(line);
  if (cells.length === 0 || !cells.every((c) => DELIMITER_CELL.test(c.raw))) return null;
  return cells;
}

/** A cell as a person reads it: `\|` is a pipe and `<br>` a line break. */
export function cellText(raw: string): string {
  return raw.replace(/<br\s*\/?>/gi, "\n").replace(/\\\|/g, "|");
}

/** A cell as the file writes it: one line, a pipe escaped, a break as `<br>`. */
export function cellSource(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\|/g, "\\|")
    .split("\n")
    .map((l) => l.trim())
    .join("<br>")
    .trim();
}

/**
 * A cell's trailing `{…}` — its attributes — split from its words.
 *
 * The leftmost `{` from which the rest of the cell parses as an attribute list, closed by the cell's
 * last character: so `Amount {#amount number}` is a name and two attributes, a quoted value may hold
 * a brace (`filter="name~{x}"`), and `Set {a} {#id}` is the words `Set {a}` and an id. `strict` is for
 * a row's first cell, which is data: there a `{…}` is attributes only when it says something a row
 * can mean (`#id`, `h=`), so a value like `Use {braces}` stays a value.
 */
function trailingAttrs(raw: string, strict: boolean): { words: string; attrs: Attrs; errors: AttrError[] } | null {
  if (!raw.endsWith("}")) return null;
  for (let p = raw.indexOf("{"); p !== -1; p = raw.indexOf("{", p + 1)) {
    if (p > 0 && !/\s/.test(raw[p - 1]!)) continue;
    const errors: AttrError[] = [];
    /* A cell writes a `|` inside its braces as `\|`, GFM's escape, or the pipe would end the cell. */
    const inner = raw.slice(p + 1, -1).replace(/\\\|/g, "|");
    const attrs = parseAttrs(inner, errors);
    if (errors.length) continue;
    if (strict && !attrs.order.every((k) => k === "id" || k === "h")) continue;
    if (attrs.order.length === 0) continue;
    return { words: raw.slice(0, p).trim(), attrs, errors };
  }
  return null;
}

const without = (a: Attrs, keys: readonly string[]): Attrs => ({
  map: Object.fromEntries(Object.entries(a.map).filter(([k]) => !keys.includes(k))),
  order: a.order.filter((k) => !keys.includes(k)),
});

const EMPTY_ATTRS: Attrs = { map: {}, order: [] };

const posInt = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;

/** `sort="amount:desc, name"` read, keeping only what names a column. */
export function readSort(text: string): { keys: SortKey[]; bad: string[] } {
  const keys: SortKey[] = [];
  const bad: string[] = [];
  for (const part of text.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const m = /^([A-Za-z0-9_.\-/]+)(?:\s*:\s*(asc|desc))?$/i.exec(p);
    if (!m) bad.push(p);
    else keys.push({ column: m[1]!, desc: (m[2] ?? "asc").toLowerCase() === "desc" });
  }
  return { keys, bad };
}

/** `sort` written back: what `readSort` reads. */
export const writeSort = (keys: readonly SortKey[]): string => keys.map((k) => (k.desc ? `${k.column}:desc` : k.column)).join(", ");

/** `filter="stage!=Lost; amount>=1000"` read. Longest operator first, so `>=` is never `>` and `=1000`. */
export function readFilter(text: string): { rules: FilterRule[]; bad: string[] } {
  const rules: FilterRule[] = [];
  const bad: string[] = [];
  for (const part of text.split(";")) {
    const p = part.trim();
    if (!p) continue;
    const m = /^([A-Za-z0-9_.\-/]+)\s*(!=|!~|>=|<=|=|~|>|<)\s*(.*)$/.exec(p);
    if (!m) bad.push(p);
    else rules.push({ column: m[1]!, op: m[2] as FilterOp, value: m[3]!.trim() });
  }
  return { rules, bad };
}

/** `filter` written back. A value is trimmed and may not hold a `;`, which ends a rule. */
export const writeFilter = (rules: readonly FilterRule[]): string =>
  rules.map((r) => `${r.column}${r.op}${r.value.replace(/;/g, ",").trim()}`).join("; ");

/** Split a comma list of a select's options, trimmed, empty ones dropped, first of each kept. */
const readOptions = (text: string): string[] => [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];

interface HeadingRead {
  name: string;
  attrs: Attrs;
}

function headingOf(line: string): HeadingRead | null {
  const m = HEADING.exec(line);
  if (!m) return null;
  const rest = m[1]!.trim().replace(CLOSING, "").trim();
  const split = trailingAttrs(rest, false);
  return split ? { name: split.words, attrs: split.attrs } : { name: rest, attrs: EMPTY_ATTRS };
}

/** Parse a table. Never throws: whatever is wrong is a diagnostic. */
export function parseTable(text: string): Table {
  const fm = FRONT.exec(text);
  const front = fm ? fm[0] : "";
  const firstLine = 1 + (front.match(/\n/g)?.length ?? 0);
  const lines = linesOf(text, front.length, firstLine);
  const diagnostics: TableDiagnostic[] = [];
  const say = (code: TableCode, line: number, col: number, message: string, tab?: string) =>
    diagnostics.push({ code, severity: code.startsWith("E") ? "error" : "warning", line, col, message, ...(tab ? { tab } : {}) });

  const tabs: Tab[] = [];
  const description: Line[] = [];
  let descEnd = text.length;
  let fence: { char: string; len: number; line: Line } | null = null;
  let loose = false;

  /** The tab being read, and where in it the reader is. */
  let cur: { tab: Tab; phase: "before" | "grid" | "after"; last: Line; stray: boolean } | null = null;

  const finish = () => {
    if (!cur) return;
    cur.tab.span = { start: cur.tab.heading.start, end: cur.last.end };
    tabs.push(cur.tab);
    cur = null;
  };

  /** A table starting at `i`: its header and delimiter, or `null`. */
  const tableAt = (i: number): { header: Segment[]; delimiter: Segment[] } | null => {
    const head = lines[i];
    const next = lines[i + 1];
    if (!head || !next) return null;
    if (!head.text.trim() || !hasPipe(head.text + next.text)) return null;
    const delimiter = delimiterCells(next.text);
    if (!delimiter) return null;
    const header = splitRow(head.text, head.start);
    if (header.length !== delimiter.length) return null;
    return { header, delimiter };
  };

  const readColumns = (header: Segment[], line: Line, tabId: string | undefined): Column[] =>
    header.map((seg) => {
      const split = trailingAttrs(seg.raw, false);
      const attrs = split?.attrs ?? EMPTY_ATTRS;
      const types = attrs.order.filter((k) => attrs.map[k] === true && isColumnType(k));
      const type = (types[0] ?? "text") as ColumnType;
      const options = typeof attrs.map.options === "string" ? readOptions(attrs.map.options) : undefined;
      const w = posInt(attrs.map.w);
      const id = typeof attrs.map.id === "string" ? attrs.map.id : typeof attrs.map.id === "number" ? String(attrs.map.id) : undefined;
      const known = ["id", "options", "w", ...(types[0] ? [types[0]] : [])];
      const extra = without(attrs, known);
      for (const k of extra.order)
        say(
          "WT_UNKNOWN_ATTR",
          line.n,
          seg.start - line.start + 1,
          attrs.map[k] === true
            ? `\`${k}\` is not a column type. A column is one of ${COLUMN_TYPES.join(", ")}.`
            : `\`${k}=\` means nothing on a column. A header cell takes \`{#id type options="a,b" w=160}\`.`,
          tabId,
        );
      return {
        ...(id !== undefined ? { id } : {}),
        name: cellText(split ? split.words : seg.raw),
        type,
        ...(options && options.length ? { options } : {}),
        ...(w !== undefined ? { w } : {}),
        extra,
        span: { start: seg.start, end: seg.end },
      };
    });

  const readRow = (line: Line, columns: Column[], tabId: string | undefined): Row => {
    const segs = splitRow(line.text, line.start);
    let first = segs[0]?.raw ?? "";
    let id: string | undefined;
    let h: number | undefined;
    let extra = EMPTY_ATTRS;
    const split = trailingAttrs(first, true);
    if (split) {
      first = split.words;
      const v = split.attrs.map.id;
      id = typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
      h = posInt(split.attrs.map.h);
      extra = without(split.attrs, ["id", "h"]);
    }
    if (segs.length > columns.length && columns.length > 0)
      say(
        "WT_ROW_WIDTH",
        line.n,
        (segs[columns.length]?.start ?? line.start) - line.start + 1,
        `This row has ${segs.length} cells and the header ${columns.length}. The cells past the last column are ignored.`,
        tabId,
      );
    const cells = columns.map((_, i) => cellText(i === 0 ? first : (segs[i]?.raw ?? "")));
    return {
      ...(id !== undefined ? { id } : {}),
      ...(h !== undefined ? { h } : {}),
      cells,
      extra,
      line: line.n,
      span: { start: line.start, end: line.end },
      segments: segs.slice(0, Math.max(columns.length, 1)).map((s) => ({ start: s.start, end: s.end })),
    };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const blank = line.text.trim() === "";

    if (fence) {
      if (cur) {
        cur.last = line;
        if (cur.phase === "grid") cur.phase = "after";
      } else description.push(line);
      if (fenceCloses(line.text, fence)) fence = null;
      continue;
    }

    const heading = headingOf(line.text);
    if (heading) {
      if (cur) finish();
      else descEnd = line.start;
      const a = heading.attrs;
      const id = typeof a.map.id === "string" ? a.map.id : typeof a.map.id === "number" ? String(a.map.id) : undefined;
      const sortText = typeof a.map.sort === "string" ? a.map.sort : undefined;
      const filterText = typeof a.map.filter === "string" ? a.map.filter : undefined;
      const extra = without(a, ["id", "sort", "filter"]);
      for (const k of extra.order)
        say("WT_UNKNOWN_ATTR", line.n, 1, `\`${k}\` means nothing on a tab. A tab's heading takes \`{#id sort="…" filter="…"}\`.`, id);
      cur = {
        tab: {
          ...(id !== undefined ? { id } : {}),
          name: heading.name,
          ...(sortText !== undefined ? { sortText } : {}),
          sort: [],
          ...(filterText !== undefined ? { filterText } : {}),
          filter: [],
          extra,
          columns: [],
          rows: [],
          line: line.n,
          heading: { start: line.start, end: line.end },
          span: { start: line.start, end: line.end },
        },
        phase: "before",
        last: line,
        stray: false,
      };
      continue;
    }

    const opens = fenceOpen(line.text);

    if (!cur) {
      if (!opens && !loose && tableAt(i)) {
        loose = true;
        say("WT_LOOSE_TABLE", line.n, 1, "This table is above the first tab, so it is part of the description. Put a `## Tab name` heading over it.");
      }
      description.push(line);
      if (opens) fence = { ...opens, line };
      continue;
    }

    const c = cur;
    if (!blank) c.last = line;

    if (c.phase === "grid") {
      const ends = blank || ANY_HEADING.test(line.text) || !!opens || QUOTE.test(line.text);
      if (!ends) {
        const tab = c.tab;
        tab.rows.push(readRow(line, tab.columns, tab.id));
        tab.grid!.end = line.end;
        continue;
      }
      c.phase = "after";
      if (blank) continue;
    }

    if (c.phase === "before" && !opens) {
      const found = tableAt(i);
      if (found) {
        const next = lines[i + 1]!;
        c.tab.columns = readColumns(found.header, line, c.tab.id);
        c.tab.grid = { header: { start: line.start, end: line.end }, delimiter: { start: next.start, end: next.end }, end: next.end };
        c.last = next;
        c.phase = "grid";
        i++;
        continue;
      }
    }

    if (!blank) {
      if (!c.stray) {
        c.stray = true;
        say(
          "WT_STRAY",
          line.n,
          1,
          c.phase === "before"
            ? "Only the tab's table belongs under its heading. This is kept, and not part of the table."
            : "Only one table belongs under a tab. This is kept, and not part of the table.",
          c.tab.id,
        );
      }
      if (c.phase === "before") c.phase = "after";
      if (opens) fence = { ...opens, line };
    }
  }
  finish();
  if (fence) say("WT_OPEN_FENCE", fence.line.n, 1, "This code block is never closed, so everything after it is code and no tab.");

  /* Ids, sort and filter: read once every tab and its columns are known. */
  const tabIds = new Set<string>();
  for (const tab of tabs) {
    if (tab.id === undefined) say("WT_NO_ID", tab.line, 1, "This tab has no id yet. It is given one, `{#…}`, the first time the table is written.");
    else if (tabIds.has(tab.id)) say("ET_DUPLICATE_ID", tab.line, 1, `Another tab already has the id \`${tab.id}\`. Give this one its own.`, tab.id);
    else tabIds.add(tab.id);

    const cols = new Set<string>();
    let unnamedColumn = false;
    for (const col of tab.columns) {
      if (col.id === undefined) unnamedColumn = true;
      else if (cols.has(col.id))
        say("ET_DUPLICATE_ID", tab.grid ? lineOf(text, tab.grid.header.start) : tab.line, 1, `Two columns of this tab have the id \`${col.id}\`.`, tab.id);
      else cols.add(col.id);
    }
    if (unnamedColumn && tab.grid)
      say("WT_NO_ID", lineOf(text, tab.grid.header.start), 1, "A column here has no id yet. It is given one, `{#…}`, the first time the table is written.", tab.id);

    const rows = new Set<string>();
    let unnamedRows = 0;
    for (const row of tab.rows) {
      if (row.id === undefined) unnamedRows++;
      else if (rows.has(row.id)) say("ET_DUPLICATE_ID", row.line, 1, `Another row of this tab already has the id \`${row.id}\`.`, tab.id);
      else rows.add(row.id);
    }
    if (unnamedRows)
      say(
        "WT_NO_ID",
        tab.rows.find((r) => r.id === undefined)!.line,
        1,
        `${unnamedRows === 1 ? "A row" : `${unnamedRows} rows`} here ${unnamedRows === 1 ? "has" : "have"} no id yet. Each is given one, \`{#r…}\`, the first time the table is written.`,
        tab.id,
      );

    if (tab.sortText !== undefined) {
      const { keys, bad } = readSort(tab.sortText);
      for (const b of bad) say("WT_BAD_SORT", tab.line, 1, `\`${b}\` is not a sort key. Write a column's id, then \`:asc\` or \`:desc\`.`, tab.id);
      for (const k of keys) {
        if (cols.has(k.column)) tab.sort.push(k);
        else say("WT_BAD_SORT", tab.line, 1, `This tab has no column \`${k.column}\` to sort by.`, tab.id);
      }
    }
    if (tab.filterText !== undefined) {
      const { rules, bad } = readFilter(tab.filterText);
      for (const b of bad)
        say("WT_BAD_FILTER", tab.line, 1, `\`${b}\` is not a filter rule. Write a column's id, an operator (${FILTER_OPS.join(" ")}), and a value.`, tab.id);
      for (const r of rules) {
        if (cols.has(r.column)) tab.filter.push(r);
        else say("WT_BAD_FILTER", tab.line, 1, `This tab has no column \`${r.column}\` to filter on.`, tab.id);
      }
    }
  }
  if (tabs.length === 0) say("WT_EMPTY", firstLine, 1, "This table has no tabs yet. A tab starts at a `##` heading, with a table under it.");

  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
  const descStart = front.length;
  return {
    front,
    description: trimBlank(description.filter((l) => l.start < descEnd).map((l) => l.text)).join("\n"),
    descriptionSpan: { start: descStart, end: Math.max(descStart, tabs.length ? tabs[0]!.span.start : descEnd) },
    tabs,
    diagnostics,
  };
}

/** The 1-based line an offset is on. */
function lineOf(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

const trimBlank = (lines: string[]): string[] => {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a]!.trim() === "") a++;
  while (b > a && lines[b - 1]!.trim() === "") b--;
  return lines.slice(a, b);
};

/** A tab by its id. */
export function findTab(table: Table, id: string): Tab | undefined {
  return table.tabs.find((t) => t.id === id);
}
