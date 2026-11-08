/**
 * A table as data — what `GET /__board/table` answers, and what `anydag table show` and an agent's
 * `table_get` print.
 *
 * Every tab with its columns and rows, every row with its id and every cell twice: as written (a
 * person's text, `\|` a pipe and `<br>` a line break) and as its column's type reads it — a number, a
 * date, a tick, a link — or `null` for a value the type cannot read, beside which `ok` says so. With
 * `view`, a tab's rows are the ones it shows, in its order; without, every row in the file's order.
 *
 * Browser-free and alias-free: the local server answers this.
 */
import { titleOf } from "../refs/extract";
import type { TableDiagnostic } from "./codes";
import { parseTable, type ColumnType, type FilterRule, type SortKey } from "./parse";
import { readCell, tableDiagnostics, viewRows, type LinkValue } from "./values";

interface ColumnData {
  id: string | null;
  name: string;
  type: ColumnType;
  options: string[] | null;
  w: number | null;
}

interface RowData {
  id: string | null;
  line: number;
  h: number | null;
  /** By column id — or by `#<n>`, the column's place from 1, for a column with no id yet. */
  cells: Record<string, string>;
  values: Record<string, number | string | boolean | LinkValue | null>;
  /** The columns whose value its type cannot read. */
  unread: string[];
}

interface TabData {
  id: string | null;
  name: string;
  line: number;
  sort: SortKey[];
  filter: FilterRule[];
  columns: ColumnData[];
  /** How many rows the tab has, whatever `rows` holds. */
  total: number;
  rows: RowData[];
}

export interface TableData {
  title: string | null;
  description: string;
  tabs: TabData[];
  diagnostics: TableDiagnostic[];
}

/** A column's key in `cells`: its id, or its place for one with none. */
const columnKey = (id: string | undefined, index: number): string => id ?? `#${index + 1}`;

export function tableData(text: string, opts: { view?: boolean; tab?: string } = {}): TableData {
  const table = parseTable(text);
  const tabs = table.tabs
    .filter((t) => opts.tab === undefined || t.id === opts.tab)
    .map((tab): TabData => {
      const rows = opts.view ? viewRows(tab) : tab.rows.map((row, index) => ({ row, index }));
      return {
        id: tab.id ?? null,
        name: tab.name,
        line: tab.line,
        sort: tab.sort,
        filter: tab.filter,
        columns: tab.columns.map((c) => ({
          id: c.id ?? null,
          name: c.name,
          type: c.type,
          options: c.type === "select" ? (c.options ?? null) : null,
          w: c.w ?? null,
        })),
        total: tab.rows.length,
        rows: rows.map(({ row }) => {
          const cells: Record<string, string> = {};
          const values: RowData["values"] = {};
          const unread: string[] = [];
          tab.columns.forEach((c, i) => {
            const key = columnKey(c.id, i);
            const t = row.cells[i] ?? "";
            cells[key] = t;
            const r = readCell(c.type, t, c.type === "select" ? (c.options ?? undefined) : undefined);
            values[key] = r.ok ? r.value : null;
            if (!r.ok) unread.push(key);
          });
          return { id: row.id ?? null, line: row.line, h: row.h ?? null, cells, values, unread };
        }),
      };
    });
  return { title: titleOf(text) ?? null, description: table.description, tabs, diagnostics: tableDiagnostics(table) };
}
