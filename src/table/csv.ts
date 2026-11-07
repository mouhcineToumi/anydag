/**
 * CSV in and out of a table.
 *
 * **A conversion, never a format.** A table is its `.table.md`; CSV is what arrives from a
 * spreadsheet and what leaves for one. Reading is RFC 4180 — quoted fields, a doubled quote inside
 * one, a line break inside one, a byte-order mark — with the delimiter sniffed among a comma, a
 * semicolon and a tab, because a European spreadsheet writes semicolons and a paste from one writes
 * tabs. Writing quotes a field only when it has to.
 *
 * Browser-free and alias-free, for `parse.ts`'s reason: the CLI's `table import` reads a file with
 * this, and the page reads a picked one.
 */
import { readCheckbox, readDate, readLink, readNumber } from "./values";
import { viewRows } from "./values";
import type { ColumnType, Tab } from "./parse";
import type { ColumnInput, RowInput } from "./write";

const DELIMITERS = [",", ";", "\t"] as const;

/** The delimiter a CSV most likely uses: the one that splits its first lines into the most, evenly. */
export function sniffDelimiter(csv: string): string {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best: string = ",";
  let score = -1;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => splitOutsideQuotes(l, d));
    if (counts.length === 0) continue;
    const first = counts[0]!;
    if (first === 0) continue;
    const even = counts.filter((c) => c === first).length;
    const s = even * 100 + first;
    if (s > score) {
      score = s;
      best = d;
    }
  }
  return best;
}

/** How many times a delimiter occurs outside quotes in one line — a sniff, not a parse. */
function splitOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === d && !quoted) n++;
  }
  return n;
}

/** Every record of a CSV, each a list of fields. Trailing empty lines are dropped. */
export function parseCsv(csv: string, delimiter = sniffDelimiter(csv)): string[][] {
  const text = csv.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1]!.every((f) => f === "")) rows.pop();
  return rows;
}

/** One field as CSV writes it: quoted when it holds the delimiter, a quote or a line break. */
const field = (v: string, d: string): string => (/["\r\n]/.test(v) || v.includes(d) ? `"${v.replace(/"/g, '""')}"` : v);

/** Records as CSV, lines ending `\r\n` as RFC 4180 has it. */
export function toCsv(rows: readonly (readonly string[])[], delimiter = ","): string {
  return rows.map((r) => r.map((v) => field(v, delimiter)).join(delimiter)).join("\r\n") + (rows.length ? "\r\n" : "");
}

/**
 * The type a column's values say it is: a number when every value that is not empty reads as one,
 * and the same for a date, a checkbox and a link — else text. A column with nothing in it is text.
 * A checkbox needs more than `0`/`1`, which is far likelier a count.
 */
export function inferType(values: readonly string[]): ColumnType {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (filled.length === 0) return "text";
  if (filled.every((v) => readNumber(v) !== null)) return "number";
  if (filled.every((v) => readDate(v) !== null)) return "date";
  if (filled.every((v) => readCheckbox(v) !== null) && filled.some((v) => !/^[01]$/.test(v))) return "checkbox";
  if (filled.every((v) => readLink(v) !== null)) return "link";
  return "text";
}

/**
 * A CSV as the columns and rows a new tab is written from: its first record the header, each
 * column's type inferred, a checkbox written as `[x]` or `[ ]`. A header cell that is empty is named
 * after its place. A record shorter than the header is padded and a longer one cut, as GFM would.
 */
export function csvTab(csv: string): { columns: ColumnInput[]; rows: RowInput[] } {
  const records = parseCsv(csv);
  if (records.length === 0) return { columns: [], rows: [] };
  const header = records[0]!;
  const body = records.slice(1);
  const width = header.length;
  const columns: ColumnInput[] = header.map((name, i) => {
    const values = body.map((r) => r[i] ?? "");
    return { name: name.trim() || `Column ${i + 1}`, type: inferType(values) };
  });
  const rows: RowInput[] = body.map((r) => ({
    cells: Array.from({ length: width }, (_, i) => {
      const v = r[i] ?? "";
      if (columns[i]!.type === "checkbox") return readCheckbox(v) ? "[x]" : "[ ]";
      return v;
    }),
  }));
  return { columns, rows };
}

/** A cell as a spreadsheet wants it: a checkbox as `true` or `false`, and everything else as read. */
function cellOut(type: ColumnType, text: string): string {
  if (type === "checkbox") return readCheckbox(text) ? "true" : "false";
  return text;
}

/**
 * A tab as CSV: its header, then **every row, in its sort order, unfiltered** — a filter hides rows
 * from a person looking at the tab, not from a file they asked for.
 */
export function tabCsv(tab: Pick<Tab, "columns" | "rows" | "sort" | "filter">, delimiter = ","): string {
  const rows = viewRows(tab, tab.sort, []);
  return toCsv(
    [tab.columns.map((c) => c.name), ...rows.map(({ row }) => tab.columns.map((c, i) => cellOut(c.type, row.cells[i] ?? "")))],
    delimiter,
  );
}
