/**
 * Writing a table, one cell, line or tab at a time.
 *
 * **A write touches the smallest span that means it.** Every writer parses the text it is handed —
 * never a span remembered from earlier, which is one keystroke stale the moment the other writer has
 * saved — finds what it is about by id, and splices:
 *
 * | A write | Touches |
 * |---|---|
 * | a cell | that cell's segment, inside its row's line |
 * | a row added, removed, moved, its height | that one line |
 * | a column renamed, retyped, its options, its width | the header cell, and the delimiter's for a type |
 * | a column added, removed, moved | the header, the delimiter and every row of that tab |
 * | a tab added, renamed, sorted, filtered, removed, moved | its heading line, or its whole span |
 * | a problem repaired (*Repairs*, below) | the heading, header cell or row line it is on; a tab's stray text; a grid, to keep a row's extra cells |
 *
 * **Never padded.** A row a writer touches comes back as `| a | b |`, and every other row keeps the
 * bytes an author or an agent gave it — their alignment included. Re-padding a column would rewrite
 * every line of the tab on every write, and a tab's rows being their own lines is what lets `merge3`
 * merge two people's edits to two different rows.
 *
 * **A write that means nothing is not a write**: each returns the text it was given, the same
 * string, when nothing would change — which is how the page knows not to save.
 *
 * Every writer refuses by throwing `TableError`, whose message names what was not there; the ops
 * layer (`ops.ts`) turns that into the route's 404.
 */
import { serializeAttrs, type Attrs } from "../board/attrs";
import {
  cellSource,
  cellText,
  parseTable,
  readSort,
  splitRow,
  writeFilter,
  writeSort,
  type Column,
  type ColumnType,
  type FilterRule,
  type Row,
  type SortKey,
  type Tab,
  type Table,
} from "./parse";

export class TableError extends Error {}

/** The id alphabet the store uses (`store/ids.py`): no `i`, `l`, `o` or `u` to misread. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** A fresh row id: `r` and five characters, none of `taken`. */
function mintRowId(taken: ReadonlySet<string> = new Set()): string {
  for (;;) {
    const bytes = new Uint8Array(5);
    globalThis.crypto.getRandomValues(bytes);
    const id = "r" + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
    if (!taken.has(id)) return id;
  }
}

/** A name as an id: lowercase words joined by `-`, `col` for a name with no letters in it. */
export function slug(name: string, fallback = "col"): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return s || fallback;
}

/** `wanted`, or `wanted-2`, `-3` … whichever `taken` does not hold. */
function freeId(wanted: string, taken: ReadonlySet<string>): string {
  if (!taken.has(wanted)) return wanted;
  let n = 2;
  while (taken.has(`${wanted}-${n}`)) n++;
  return `${wanted}-${n}`;
}

const splice = (text: string, start: number, end: number, by: string): string => text.slice(0, start) + by + text.slice(end);

/** The line ending the file uses, so a line a writer adds matches the ones around it. */
const eolOf = (text: string): string => (text.includes("\r\n") ? "\r\n" : "\n");

function tabOf(table: Table, id: string): Tab {
  const tab = table.tabs.find((t) => t.id === id);
  if (!tab) throw new TableError(`no tab \`${id}\``);
  return tab;
}

function rowOf(tab: Tab, id: string): { row: Row; index: number } {
  const index = tab.rows.findIndex((r) => r.id === id);
  if (index === -1) throw new TableError(`no row \`${id}\` in the tab \`${tab.id}\``);
  return { row: tab.rows[index]!, index };
}

function columnOf(tab: Tab, id: string): { column: Column; index: number } {
  const index = tab.columns.findIndex((c) => c.id === id);
  if (index === -1) throw new TableError(`no column \`${id}\` in the tab \`${tab.id}\``);
  return { column: tab.columns[index]!, index };
}

/**
 * A `{…}` for a cell or a heading, with a leading space, or `""` when it would be empty. In a cell a
 * `|` is escaped, or an option or a filter holding one ends the cell early and the row gains a cell
 * the delimiter row does not have — which parses as no table at all. A heading is not a row.
 */
const braces = (a: Attrs, cell = true): string => {
  const s = serializeAttrs(a);
  if (!s) return "";
  return cell ? ` {${s.replace(/\|/g, "\\|")}}` : ` {${s}}`;
};

const attrs = (entries: [string, string | number | true | undefined][], extra: Attrs): Attrs => {
  const map: Attrs["map"] = {};
  const order: string[] = [];
  for (const [k, v] of entries) {
    if (v === undefined) continue;
    map[k] = v;
    order.push(k);
  }
  for (const k of extra.order) {
    if (k in map) continue;
    map[k] = extra.map[k]!;
    order.push(k);
  }
  return { map, order };
};

/** What a column's header cell says, as a column the writers hold. */
export interface ColumnInput {
  id?: string;
  name: string;
  type?: ColumnType;
  options?: string[];
  w?: number;
  extra?: Attrs;
}

const NO_ATTRS: Attrs = { map: {}, order: [] };

/** One header cell's content: the name and its `{…}`. */
function headerCell(c: ColumnInput): string {
  const type = c.type && c.type !== "text" ? c.type : undefined;
  const a = attrs(
    [
      ["id", c.id],
      [type ?? "", type ? true : undefined],
      ["options", c.options && c.options.length ? c.options.map((o) => o.replace(/,/g, " ").trim()).join(",") : undefined],
      ["w", c.w],
    ],
    c.extra ?? NO_ATTRS,
  );
  return `${cellSource(c.name)}${braces(a)}`.trim();
}

const delimiterCell = (type: ColumnType | undefined): string => (type === "number" ? "---:" : "---");

/** What a row says: its cells as a person reads them, one per column, and its attributes. */
export interface RowInput {
  id?: string;
  h?: number;
  cells: readonly string[];
  extra?: Attrs;
}

/** A row's line in the house form, without its newline. */
function rowLine(r: RowInput, width: number): string {
  const a = attrs(
    [
      ["id", r.id],
      ["h", r.h],
    ],
    r.extra ?? NO_ATTRS,
  );
  const cells = Array.from({ length: Math.max(width, 1) }, (_, i) => {
    const src = cellSource(r.cells[i] ?? "");
    return i === 0 ? `${src}${braces(a)}`.trim() : src;
  });
  return `| ${cells.join(" | ")} |`.replace(/ {2}\|/g, " |");
}

/** A tab's heading line in the house form, without its newline. */
function headingLine(t: { id?: string; name: string; sort?: string; filter?: string; extra?: Attrs }): string {
  const a = attrs(
    [
      ["id", t.id],
      ["sort", t.sort || undefined],
      ["filter", t.filter || undefined],
    ],
    t.extra ?? NO_ATTRS,
  );
  return `## ${t.name.replace(/\s*\r?\n\s*/g, " ").trim()}${braces(a, false)}`;
}

/** A whole grid, header to last row, each line with `eol` — what a column add, remove or move writes. */
function gridText(columns: readonly ColumnInput[], rows: readonly RowInput[], eol: string): string {
  const header = `| ${columns.map(headerCell).join(" | ")} |`;
  const delimiter = `| ${columns.map((c) => delimiterCell(c.type)).join(" | ")} |`;
  return [header, delimiter, ...rows.map((r) => rowLine(r, columns.length))].map((l) => l + eol).join("");
}

const columnInput = (c: Column): ColumnInput => ({
  ...(c.id !== undefined ? { id: c.id } : {}),
  name: c.name,
  type: c.type,
  ...(c.options ? { options: c.options } : {}),
  ...(c.w !== undefined ? { w: c.w } : {}),
  extra: c.extra,
});

const rowInput = (r: Row): RowInput => ({
  ...(r.id !== undefined ? { id: r.id } : {}),
  ...(r.h !== undefined ? { h: r.h } : {}),
  cells: r.cells,
  extra: r.extra,
});

/** A row's first cell as written: its words, then its `{#id h=…}`. Every other cell of a row is its words alone. */
const firstCell = (r: Row, id: string | undefined): string =>
  `${cellSource(r.cells[0] ?? "")}${braces(
    attrs(
      [
        ["id", id],
        ["h", r.h],
      ],
      r.extra,
    ),
  )}`.trim();

/** Replace a tab's whole grid, or write one under a tab that has none. */
function replaceGrid(text: string, tab: Tab, columns: readonly ColumnInput[], rows: readonly RowInput[]): string {
  const eol = eolOf(text);
  if (columns.length === 0) {
    if (!tab.grid) return text;
    return splice(text, tab.grid.header.start, tab.grid.end, "");
  }
  const grid = gridText(columns, rows, eol);
  if (tab.grid) return splice(text, tab.grid.header.start, tab.grid.end, grid);
  /* No table yet: a blank line after the heading, then the grid, then whatever the tab held. */
  const at = tab.heading.end;
  const lead = tab.heading.end === text.length && !text.endsWith("\n") ? eol : "";
  const rest = text.slice(at).replace(/^(?:\r?\n)+/, "");
  return text.slice(0, at) + lead + eol + grid + (rest ? eol + rest : "");
}

// -- cells --------------------------------------------------------------------------------------

/**
 * One cell set. Only that cell's segment changes — the row's other cells keep their bytes, padding
 * included — unless the row is short of cells, when the row is written whole in the house form.
 */
export function setCell(text: string, tabId: string, rowId: string, columnId: string, value: string): string {
  const table = parseTable(text);
  const tab = tabOf(table, tabId);
  const { row } = rowOf(tab, rowId);
  const { index } = columnOf(tab, columnId);
  const next = value.replace(/\r\n?/g, "\n");
  if ((row.cells[index] ?? "") === next || cellSource(row.cells[index] ?? "") === cellSource(next)) return text;
  const seg = row.segments[index];
  if (!seg) {
    const cells = [...row.cells];
    cells[index] = next;
    return splice(
      text,
      row.span.start,
      row.span.end,
      rowLine({ ...rowInput(row), cells }, tab.columns.length) + lineEnd(text, row),
    );
  }
  let content = cellSource(next);
  if (index === 0) {
    const a = attrs(
      [
        ["id", row.id],
        ["h", row.h],
      ],
      row.extra,
    );
    content = `${content}${braces(a)}`.trim();
  }
  return splice(text, seg.start, seg.end, content ? ` ${content} ` : " ");
}

/** The newline a row's line ends with, or `""` for a last line with none. */
function lineEnd(text: string, row: Row): string {
  const s = text.slice(row.span.start, row.span.end);
  return s.endsWith("\r\n") ? "\r\n" : s.endsWith("\n") ? "\n" : "";
}

// -- rows ---------------------------------------------------------------------------------------

export interface AddedRow {
  text: string;
  id: string;
}

/**
 * A row added: after the row `after`, before the row `before`, or at the end — its cells by column
 * id, its id `id` when that is free, a fresh one otherwise. A tab with no columns is refused: a row
 * with nothing to hold would be a line nothing reads.
 */
export function addRow(
  text: string,
  tabId: string,
  at: { id?: string; values?: Readonly<Record<string, string>>; after?: string; before?: string } = {},
): AddedRow {
  const table = parseTable(text);
  const tab = tabOf(table, tabId);
  if (!tab.grid || tab.columns.length === 0) throw new TableError(`the tab \`${tabId}\` has no columns to put a row in`);
  const taken = new Set(tab.rows.flatMap((r) => (r.id ? [r.id] : [])));
  const id = at.id && !taken.has(at.id) && /^[A-Za-z0-9_-]+$/.test(at.id) ? at.id : mintRowId(taken);
  for (const k of Object.keys(at.values ?? {})) columnOf(tab, k);
  const cells = tab.columns.map((c) => (c.id !== undefined ? (at.values?.[c.id] ?? "") : ""));
  const eol = eolOf(text);
  const line = rowLine({ id, cells }, tab.columns.length) + eol;
  let pos: number;
  if (at.after !== undefined) pos = rowOf(tab, at.after).row.span.end;
  else if (at.before !== undefined) pos = rowOf(tab, at.before).row.span.start;
  else pos = tab.grid.end;
  /* The last line of a file with no newline after it: give it one before appending under it. */
  const prev = text.slice(0, pos);
  const lead = pos > 0 && !prev.endsWith("\n") ? eol : "";
  return { text: splice(text, pos, pos, lead + line), id };
}

export function removeRow(text: string, tabId: string, rowId: string): string {
  const tab = tabOf(parseTable(text), tabId);
  const { row } = rowOf(tab, rowId);
  return splice(text, row.span.start, row.span.end, "");
}

/** A row moved to before the row `before`, or to the end with `null`. Its bytes travel as they are. */
export function moveRow(text: string, tabId: string, rowId: string, before: string | null): string {
  const tab = tabOf(parseTable(text), tabId);
  const { row } = rowOf(tab, rowId);
  if (before === rowId) return text;
  const target = before === null ? null : rowOf(tab, before).row;
  const next = tab.rows[tab.rows.indexOf(row) + 1];
  if ((target === null && !next) || (target && next && target.id === next.id)) return text;
  const eol = eolOf(text);
  let line = text.slice(row.span.start, row.span.end);
  if (!line.endsWith("\n")) line += eol;
  const without = splice(text, row.span.start, row.span.end, "");
  const shift = (n: number) => (n > row.span.start ? n - (row.span.end - row.span.start) : n);
  const pos = target ? shift(target.span.start) : shift(tab.grid!.end);
  const lead = pos > 0 && !without.slice(0, pos).endsWith("\n") ? eol : "";
  return splice(without, pos, pos, lead + line);
}

/** A row's height, `null` to take it off. Rewrites only the first cell's `{…}`. */
export function setRowHeight(text: string, tabId: string, rowId: string, h: number | null): string {
  const tab = tabOf(parseTable(text), tabId);
  const { row } = rowOf(tab, rowId);
  const want = h === null ? undefined : Math.max(1, Math.round(h));
  if (row.h === want) return text;
  const seg = row.segments[0];
  const a = attrs(
    [
      ["id", row.id],
      ["h", want],
    ],
    row.extra,
  );
  const content = `${cellSource(row.cells[0] ?? "")}${braces(a)}`.trim();
  if (!seg)
    return splice(
      text,
      row.span.start,
      row.span.end,
      rowLine({ ...rowInput(row), h: want }, tab.columns.length) + lineEnd(text, row),
    );
  return splice(text, seg.start, seg.end, ` ${content} `);
}

// -- columns ------------------------------------------------------------------------------------

export interface AddedColumn {
  text: string;
  id: string;
}

/**
 * A column added after the column `after`, or at the end: its id the slug of its name unless `id`
 * is given and free. Every row of the tab gains an empty cell — the one write a column costs every
 * line of its tab. A tab with no table yet gets one.
 */
export function addColumn(
  text: string,
  tabId: string,
  c: { id?: string; name: string; type?: ColumnType; options?: string[]; w?: number; after?: string; before?: string },
): AddedColumn {
  const table = parseTable(text);
  const tab = tabOf(table, tabId);
  const taken = new Set(tab.columns.flatMap((x) => (x.id ? [x.id] : [])));
  const id = c.id && /^[A-Za-z0-9_-]+$/.test(c.id) && !taken.has(c.id) ? c.id : freeId(slug(c.name), taken);
  const columns = tab.columns.map(columnInput);
  const at =
    c.after !== undefined
      ? columnOf(tab, c.after).index + 1
      : c.before !== undefined
        ? columnOf(tab, c.before).index
        : columns.length;
  const col: ColumnInput = {
    id,
    name: c.name,
    ...(c.type ? { type: c.type } : {}),
    ...(c.options ? { options: c.options } : {}),
    ...(c.w !== undefined ? { w: c.w } : {}),
  };
  columns.splice(at, 0, col);
  const rows = tab.rows.map((r) => {
    const cells = [...r.cells];
    cells.splice(at, 0, "");
    return { ...rowInput(r), cells };
  });
  return { text: replaceGrid(text, tab, columns, rows), id };
}

export function removeColumn(text: string, tabId: string, columnId: string): string {
  const tab = tabOf(parseTable(text), tabId);
  const { index } = columnOf(tab, columnId);
  const columns = tab.columns.map(columnInput).filter((_, i) => i !== index);
  const rows = tab.rows.map((r) => {
    const cells = r.cells.filter((_, i) => i !== index);
    return { ...rowInput(r), cells };
  });
  return replaceGrid(text, tab, columns, rows);
}

/** A column moved to before the column `before`, or to the end with `null`. */
export function moveColumn(text: string, tabId: string, columnId: string, before: string | null): string {
  const tab = tabOf(parseTable(text), tabId);
  const { index } = columnOf(tab, columnId);
  const to = before === null ? tab.columns.length : columnOf(tab, before).index;
  if (to === index || to === index + 1) return text;
  const order = tab.columns.map((_, i) => i);
  order.splice(index, 1);
  order.splice(to > index ? to - 1 : to, 0, index);
  const columns = order.map((i) => columnInput(tab.columns[i]!));
  const rows = tab.rows.map((r) => ({ ...rowInput(r), cells: order.map((i) => r.cells[i] ?? "") }));
  return replaceGrid(text, tab, columns, rows);
}

/**
 * A column renamed, retyped, given options or a width — its header cell and nothing else, and its
 * delimiter cell for a type, which is how GFM right-aligns a number. `null` takes options or a width
 * off. The cells are not touched: a column made a number shows its words as words.
 */
export function setColumn(
  text: string,
  tabId: string,
  columnId: string,
  change: { name?: string; type?: ColumnType; options?: string[] | null; w?: number | null },
): string {
  const tab = tabOf(parseTable(text), tabId);
  const { column, index } = columnOf(tab, columnId);
  const next: ColumnInput = columnInput(column);
  if (change.name !== undefined) next.name = change.name.replace(/\s*\r?\n\s*/g, " ").trim();
  if (change.type !== undefined) next.type = change.type;
  if (change.options === null) delete next.options;
  else if (change.options !== undefined) next.options = change.options;
  if (change.w === null) delete next.w;
  else if (change.w !== undefined) next.w = Math.max(40, Math.round(change.w));
  const cell = headerCell(next);
  const was = text.slice(column.span.start, column.span.end).trim();
  let out = text;
  const delim = tab.grid ? delimiterSegments(text, tab) : [];
  /* A number is right-aligned, as GFM says with a colon on the right; anything else loses that
     colon, and keeps whatever else an author wrote. */
  if (change.type !== undefined && change.type !== column.type && delim[index]) {
    const d = delim[index]!;
    const now = text.slice(d.start, d.end).trim();
    const want =
      change.type === "number"
        ? delimiterCell("number")
        : now.endsWith(":") && !now.startsWith(":")
          ? delimiterCell(undefined)
          : now;
    if (now !== want) out = splice(out, d.start, d.end, ` ${want} `);
  }
  if (was === cell) return out;
  return splice(out, column.span.start, column.span.end, ` ${cell} `);
}

function delimiterSegments(text: string, tab: Tab): { start: number; end: number }[] {
  const d = tab.grid!.delimiter;
  const line = text.slice(d.start, d.end).replace(/\r?\n$/, "");
  const out: { start: number; end: number }[] = [];
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  let end = line.length;
  while (end > i && /\s/.test(line[end - 1]!)) end--;
  if (line[i] === "|") i++;
  if (line[end - 1] === "|") end--;
  let from = i;
  for (let j = i; j <= end; j++) {
    if (j === end || line[j] === "|") {
      out.push({ start: d.start + from, end: d.start + j });
      from = j + 1;
    }
  }
  return out;
}

// -- tabs ---------------------------------------------------------------------------------------

export interface AddedTab {
  text: string;
  id: string;
}

/**
 * A tab added after the tab `after`, or at the end: a heading, and — given columns — a table under
 * it. Its id is the slug of its name unless `id` is given and free.
 */
export function addTab(
  text: string,
  t: { id?: string; name: string; after?: string; columns?: ColumnInput[]; rows?: RowInput[] },
): AddedTab {
  const table = parseTable(text);
  const taken = new Set(table.tabs.flatMap((x) => (x.id ? [x.id] : [])));
  const id = t.id && /^[A-Za-z0-9_-]+$/.test(t.id) && !taken.has(t.id) ? t.id : freeId(slug(t.name, "tab"), taken);
  const eol = eolOf(text);
  const cols = (t.columns ?? []).map((c, i, all) => {
    const before = new Set(all.slice(0, i).flatMap((x) => (x.id ? [x.id] : [])));
    return { ...c, id: c.id && !before.has(c.id) ? c.id : freeId(slug(c.name), before) };
  });
  /* Every id must be unique among the columns written together, the slugs of two "Name" included. */
  const seen = new Set<string>();
  for (const c of cols) {
    c.id = freeId(c.id!, seen);
    seen.add(c.id);
  }
  const rowIds = new Set<string>();
  const rows = (t.rows ?? []).map((r) => {
    const rid = r.id && !rowIds.has(r.id) ? r.id : mintRowId(rowIds);
    rowIds.add(rid);
    return { ...r, id: rid };
  });
  const block = headingLine({ id, name: t.name }) + eol + (cols.length ? eol + gridText(cols, rows, eol) : "");
  let pos: number;
  if (t.after !== undefined) pos = tabOf(table, t.after).span.end;
  else pos = text.length;
  const before = text.slice(0, pos);
  const after = text.slice(pos);
  /* One blank line before it and one after, whatever was there. */
  const lead = before === "" ? "" : before.endsWith(eol + eol) ? "" : before.endsWith("\n") ? eol : eol + eol;
  const trail = after === "" ? "" : after.startsWith("\n") || after.startsWith("\r\n") ? "" : eol;
  return { text: before + lead + block + trail + after, id };
}

/** A tab's name, sort or filter; `null` or `""` takes a sort or a filter off. Its heading line only. */
export function setTab(
  text: string,
  tabId: string,
  change: { name?: string; sort?: string | SortKey[] | null; filter?: string | FilterRule[] | null },
): string {
  const tab = tabOf(parseTable(text), tabId);
  const sort =
    change.sort === undefined
      ? tab.sortText
      : change.sort === null
        ? undefined
        : typeof change.sort === "string"
          ? change.sort
          : writeSort(change.sort);
  const filter =
    change.filter === undefined
      ? tab.filterText
      : change.filter === null
        ? undefined
        : typeof change.filter === "string"
          ? change.filter
          : writeFilter(change.filter);
  const line = headingLine({
    ...(tab.id !== undefined ? { id: tab.id } : {}),
    name: change.name !== undefined ? change.name : tab.name,
    ...(sort ? { sort: normaliseSort(sort) } : {}),
    ...(filter ? { filter } : {}),
    extra: tab.extra,
  });
  const was = text.slice(tab.heading.start, tab.heading.end).replace(/\r?\n$/, "");
  if (was === line) return text;
  return splice(text, tab.heading.start, tab.heading.start + was.length, line);
}

/** A sort as `readSort` would read it back, spaced one way. */
const normaliseSort = (s: string): string => {
  const { keys, bad } = readSort(s);
  return bad.length ? s.trim() : writeSort(keys);
};

/** A tab and everything under it, and the blank lines after it, gone. */
export function removeTab(text: string, tabId: string): string {
  const table = parseTable(text);
  const tab = tabOf(table, tabId);
  const next = table.tabs[table.tabs.indexOf(tab) + 1];
  if (next) return splice(text, tab.span.start, next.span.start, "");
  /* The last tab going: the blank lines before it go too, so the file does not end in a gap. */
  const kept = text.slice(0, tab.span.start).replace(/(?:\r?\n)+$/, "");
  return kept ? kept + eolOf(text) : "";
}

/** A tab moved to before the tab `before`, or to the end with `null`. Its bytes travel as they are. */
export function moveTab(text: string, tabId: string, before: string | null): string {
  const table = parseTable(text);
  const tab = tabOf(table, tabId);
  if (before === tabId) return text;
  const at = table.tabs.indexOf(tab);
  const target = before === null ? null : tabOf(table, before);
  const next = table.tabs[at + 1];
  if ((target === null && !next) || (target && next && target === next)) return text;
  const eol = eolOf(text);
  let block = text.slice(tab.span.start, tab.span.end);
  if (!block.endsWith("\n")) block += eol;
  /* Out with the blank lines after it, which a tab's span does not own. */
  const cutEnd = next ? next.span.start : text.length;
  const removed = splice(text, tab.span.start, cutEnd, "");
  const shift = (n: number) => (n >= cutEnd ? n - (cutEnd - tab.span.start) : n);
  if (target) {
    const pos = shift(target.span.start);
    return splice(removed, pos, pos, block + eol).replace(/(?:\r?\n)+$/, eol);
  }
  const trimmed = removed.replace(/(?:\r?\n)*$/, "");
  return trimmed + eol + eol + block;
}

// -- repairs ------------------------------------------------------------------------------------

/*
 * What the page offers to mend a problem the file has. Each is addressed by **position** — the
 * tab's, the column's, the row's place in the file — because a problem is often an id that is missing
 * or shared, and an id that names two things names neither. Each looks again at what it was asked
 * to mend and returns the text it was given when that is no longer wrong, so a repair meant for a
 * file the other writer has since mended is not a write.
 */

const tabAt = (table: Table, index: number): Tab => {
  const tab = table.tabs[index];
  if (!tab) throw new TableError("that tab is not here any more");
  return tab;
};

const rowAt = (tab: Tab, index: number): Row => {
  const row = tab.rows[index];
  if (!row) throw new TableError("that row is not here any more");
  return row;
};

/** A row's line as written, without its newline. */
const lineOfRow = (text: string, row: Row): string => text.slice(row.span.start, row.span.end).replace(/\r?\n$/, "");

/** A tab's heading rewritten from what it holds, the line's own bytes replaced and its newline kept. */
function rewriteHeading(text: string, tab: Tab, change: { id?: string; extra?: Attrs }): string {
  const id = change.id ?? tab.id;
  const line = headingLine({
    ...(id !== undefined ? { id } : {}),
    name: tab.name,
    ...(tab.sortText ? { sort: tab.sortText } : {}),
    ...(tab.filterText ? { filter: tab.filterText } : {}),
    extra: change.extra ?? tab.extra,
  });
  const was = text.slice(tab.heading.start, tab.heading.end).replace(/\r?\n$/, "");
  return line === was ? text : splice(text, tab.heading.start, tab.heading.start + was.length, line);
}

/** The tab at `tabIndex` given an id of its own, when it shares one (`ET_DUPLICATE_ID`). */
export function reidTab(text: string, tabIndex: number): string {
  const table = parseTable(text);
  const tab = tabAt(table, tabIndex);
  if (tab.id === undefined || table.tabs.filter((t) => t.id === tab.id).length < 2) return text;
  const taken = new Set(table.tabs.flatMap((t) => (t.id ? [t.id] : [])));
  return rewriteHeading(text, tab, { id: freeId(slug(tab.name, "tab"), taken) });
}

/** The column at `columnIndex` of a tab given an id of its own, when it shares one. */
export function reidColumn(text: string, tabIndex: number, columnIndex: number): string {
  const tab = tabAt(parseTable(text), tabIndex);
  const column = tab.columns[columnIndex];
  if (!column) throw new TableError("that column is not here any more");
  if (column.id === undefined || tab.columns.filter((c) => c.id === column.id).length < 2) return text;
  const taken = new Set(tab.columns.flatMap((c) => (c.id ? [c.id] : [])));
  const id = freeId(slug(column.name), taken);
  return splice(text, column.span.start, column.span.end, ` ${headerCell({ ...columnInput(column), id })} `);
}

/** The row at `rowIndex` of a tab given an id of its own, when it shares one. */
export function reidRow(text: string, tabIndex: number, rowIndex: number): string {
  const tab = tabAt(parseTable(text), tabIndex);
  const row = rowAt(tab, rowIndex);
  const seg = row.segments[0];
  if (row.id === undefined || !seg || tab.rows.filter((r) => r.id === row.id).length < 2) return text;
  const id = mintRowId(new Set(tab.rows.flatMap((r) => (r.id ? [r.id] : []))));
  return splice(text, seg.start, seg.end, ` ${firstCell(row, id)} `);
}

/**
 * A tab, or one of its columns, with the `{…}` words it does not know taken off (`WT_UNKNOWN_ATTR`)
 * — only that heading or header cell is rewritten, and what it does know (its id, type, options,
 * width, sort and filter) stays. A row has none to drop: its braces are attributes only when they
 * hold nothing but an id and a height.
 */
export function dropUnknownAttrs(text: string, tabIndex: number, columnIndex?: number): string {
  const tab = tabAt(parseTable(text), tabIndex);
  if (columnIndex !== undefined) {
    const column = tab.columns[columnIndex];
    if (!column) throw new TableError("that column is not here any more");
    if (column.extra.order.length === 0) return text;
    return splice(text, column.span.start, column.span.end, ` ${headerCell({ ...columnInput(column), extra: NO_ATTRS })} `);
  }
  if (tab.extra.order.length === 0) return text;
  return rewriteHeading(text, tab, { extra: NO_ATTRS });
}

/** A row with more cells than the tab has columns, written again with the cells past the last column gone (`WT_ROW_WIDTH`). */
export function trimRow(text: string, tabIndex: number, rowIndex: number): string {
  const tab = tabAt(parseTable(text), tabIndex);
  const row = rowAt(tab, rowIndex);
  const line = lineOfRow(text, row);
  if (splitRow(line).length <= tab.columns.length) return text;
  return splice(text, row.span.start, row.span.start + line.length, rowLine(rowInput(row), tab.columns.length));
}

/**
 * The tab given the columns a row's extra cells need, named `Column 3` and so on, and each row's own
 * cells past the old last column carried into them — the other way to mend `WT_ROW_WIDTH`, which keeps
 * what was written instead of dropping it. Every row of the tab is written again, as any column add is.
 */
export function widenToRow(text: string, tabIndex: number, rowIndex: number): string {
  const tab = tabAt(parseTable(text), tabIndex);
  const row = rowAt(tab, rowIndex);
  const width = tab.columns.length;
  const need = splitRow(lineOfRow(text, row)).length;
  if (need <= width) return text;
  const taken = new Set(tab.columns.flatMap((c) => (c.id ? [c.id] : [])));
  const columns = tab.columns.map(columnInput);
  for (let n = width; n < need; n++) {
    const name = `Column ${n + 1}`;
    const id = freeId(slug(name), taken);
    taken.add(id);
    columns.push({ id, name });
  }
  const rows = tab.rows.map((r) => {
    const segs = splitRow(lineOfRow(text, r));
    const cells = [...r.cells];
    for (let n = width; n < need; n++) cells.push(cellText(segs[n]?.raw ?? ""));
    return { ...rowInput(r), cells };
  });
  return replaceGrid(text, tab, columns, rows);
}

/** What a tab holds that is not its table: from the table's end (or the heading's) to its last line (`WT_STRAY`). */
export function strayOf(text: string, tab: Tab): string {
  const from = tab.grid ? tab.grid.end : tab.heading.end;
  return from < tab.span.end
    ? text
        .slice(from, tab.span.end)
        .replace(/^(?:\r?\n)+/, "")
        .replace(/\s+$/, "")
    : "";
}

/** A tab with everything under it that is not its table taken away. */
export function removeStray(text: string, tabIndex: number): string {
  const tab = tabAt(parseTable(text), tabIndex);
  const from = tab.grid ? tab.grid.end : tab.heading.end;
  if (from >= tab.span.end) return text;
  return splice(text, from, tab.span.end, "");
}

/**
 * The text with the code block opened on `line` (1-based, the file's) closed (`WT_OPEN_FENCE`):
 * before the next `##` heading, so the tabs it swallowed come back, or at the end when there is none.
 */
export function closeFence(text: string, line: number): string {
  const eol = eolOf(text);
  const lines = text.split("\n");
  const open = /^ {0,3}(`{3,}|~{3,})/.exec(lines[line - 1] ?? "");
  if (!open) return text;
  const fence = `${lines[line - 1]!.match(/^ */)![0]}${open[1]}`;
  let at = lines.findIndex((l, i) => i >= line && /^ {0,3}##(?=[ \t]|$)/.test(l));
  if (at < 0) return `${text.replace(/\s+$/, "")}${eol}${fence}${eol}`;
  while (at > line && !lines[at - 1]!.trim()) at--;
  lines.splice(at, 0, eol === "\r\n" ? `${fence}\r` : fence);
  return lines.join("\n");
}

/**
 * A table above the first tab given a tab to be in (`WT_LOOSE_TABLE`): a `## Tab n` heading over the
 * line it starts on, with a blank line between if the description ran right up to it.
 */
export function wrapLooseTable(text: string, line: number): string {
  const table = parseTable(text);
  const first = table.tabs[0];
  const at = text
    .split(/(?<=\n)/)
    .slice(0, line - 1)
    .join("").length;
  if (first && at >= first.heading.start) return text;
  const names = new Set(table.tabs.map((t) => t.name));
  let n = table.tabs.length + 1;
  while (names.has(`Tab ${n}`)) n++;
  const eol = eolOf(text);
  const before = text.slice(0, at);
  const lead = before === "" || /(?:\r?\n){2}$/.test(before) ? "" : eol;
  return splice(text, at, at, `${lead}## Tab ${n}${eol}${eol}`);
}

// -- ids ----------------------------------------------------------------------------------------

/**
 * Every tab, column and row that has no id given one — the tab's and the column's the slug of its
 * name, the row's `r` and five characters — and nothing else changed. What the page runs before it
 * writes a table for any other reason, and the api over a table it creates: an id is minted by
 * whatever first needs one. A table with every id already is returned
 * as it was.
 */
export function stampTable(text: string): string {
  let out = text;
  for (let pass = 0; pass < 3; pass++) {
    const table = parseTable(out);
    const tabIds = new Set(table.tabs.flatMap((t) => (t.id ? [t.id] : [])));
    /* From the end, so each splice leaves the spans before it where the parse put them. */
    const edits: { start: number; end: number; by: string }[] = [];
    for (const tab of table.tabs) {
      if (tab.grid) {
        const cols = new Set(tab.columns.flatMap((c) => (c.id ? [c.id] : [])));
        for (const c of tab.columns) {
          if (c.id !== undefined) continue;
          const id = freeId(slug(c.name), cols);
          cols.add(id);
          edits.push({ start: c.span.start, end: c.span.end, by: ` ${headerCell({ ...columnInput(c), id })} ` });
        }
        const rows = new Set(tab.rows.flatMap((r) => (r.id ? [r.id] : [])));
        for (const r of tab.rows) {
          if (r.id !== undefined) continue;
          const id = mintRowId(rows);
          rows.add(id);
          const seg = r.segments[0];
          if (seg) edits.push({ start: seg.start, end: seg.end, by: ` ${firstCell(r, id)} ` });
        }
      }
      if (tab.id === undefined) {
        const id = freeId(slug(tab.name, "tab"), tabIds);
        tabIds.add(id);
        const was = out.slice(tab.heading.start, tab.heading.end).replace(/\r?\n$/, "");
        edits.push({
          start: tab.heading.start,
          end: tab.heading.start + was.length,
          by: headingLine({
            id,
            name: tab.name,
            ...(tab.sortText ? { sort: tab.sortText } : {}),
            ...(tab.filterText ? { filter: tab.filterText } : {}),
            extra: tab.extra,
          }),
        });
      }
    }
    if (edits.length === 0) return out;
    edits.sort((a, b) => b.start - a.start);
    for (const e of edits) out = splice(out, e.start, e.end, e.by);
  }
  return out;
}

// -- a new table --------------------------------------------------------------------------------

/**
 * What a table made from the sidebar starts as: titled *Untitled* like every new file, one tab and
 * two text columns, and three empty rows — somewhere to click and type, which an empty grid is not.
 */
export function blankTable(title = "Untitled"): string {
  const rows = Array.from({ length: 3 }, () => ({ cells: ["", ""] }));
  const ids = new Set<string>();
  const withIds = rows.map((r) => {
    const id = mintRowId(ids);
    ids.add(id);
    return { ...r, id };
  });
  return (
    `---\ntitle: ${title}\n---\n\n` +
    headingLine({ id: "tab-1", name: "Tab 1" }) +
    "\n\n" +
    gridText(
      [
        { id: "name", name: "Name" },
        { id: "notes", name: "Notes" },
      ],
      withIds,
      "\n",
    )
  );
}

/**
 * A new table holding one CSV as its one tab, named and titled after the file it came from — what a
 * `.csv` dropped on a board's canvas becomes (decision 6). `null` for a CSV with no header to read.
 * The title is quoted, since a file name may hold anything YAML reads as something else.
 */
export function tableFromCsv(title: string, tab: { columns: ColumnInput[]; rows: RowInput[] }): string | null {
  if (tab.columns.length === 0) return null;
  return addTab(`---\ntitle: ${JSON.stringify(title)}\n---\n`, { name: title, columns: tab.columns, rows: tab.rows }).text;
}
