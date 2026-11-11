/**
 * A table's problems as the grid says them: in words, on what each concerns, with what fixes it.
 *
 * The parser's messages (`src/table/parse.ts`) are for whoever holds the file — an agent through
 * `table_check`, a person in an editor — and they name the syntax, because that is how they fix it.
 * The page has no source to send anybody to, so here every code is a sentence with no Markdown in
 * it, placed on the tab, column, row or cell it is about, with a repair the page can make: a writer
 * in `src/table/write.ts`. A switch over the code, so a code added to `TABLE_CODES` fails the
 * typecheck until it is said here.
 */
import { assertNever } from "@/board/useBoard";
import type { TableCode, TableDiagnostic } from "@/table/codes";
import { COLUMN_TYPES, parseTable, readFilter, readSort, splitRow, type ColumnType, type Table } from "@/table/parse";
import { readCell, tableDiagnostics } from "@/table/values";
import {
  TableError,
  closeFence,
  dropUnknownAttrs,
  reidColumn,
  reidRow,
  reidTab,
  removeStray,
  setCell,
  setColumn,
  setTab,
  strayOf,
  trimRow,
  widenToRow,
  wrapLooseTable,
} from "@/table/write";

/** What a problem is about. Places are indexes into the parse — the tab's, the column's, the stored row's. */
type Where =
  /** The file as a whole, or what sits above its first tab. */
  | { kind: "file" }
  | { kind: "tab"; tab: number }
  | { kind: "column"; tab: number; column: number }
  | { kind: "row"; tab: number; row: number }
  | { kind: "cell"; tab: number; row: number; column: number };

export type Fix =
  /** Give the tab, column or row an id of its own. */
  | { kind: "reid" }
  /** Take the words it does not know off the heading or the header cell. */
  | { kind: "clean" }
  | { kind: "clear-cell" }
  | { kind: "make-text" }
  | { kind: "add-option"; option: string }
  | { kind: "trim-row" }
  | { kind: "widen" }
  | { kind: "drop-stray" }
  /** Rewrite the heading with only the keys and rules that read. */
  | { kind: "fix-sort" }
  | { kind: "fix-filter" }
  | { kind: "close-fence"; line: number }
  | { kind: "wrap-table"; line: number };

export interface Problem {
  /** Stable across renders while the problem stands, for a key and for a test. */
  key: string;
  code: TableCode;
  severity: TableDiagnostic["severity"];
  where: Where;
  words: string;
  /** Text the words quote and the fix would take away, so nobody presses it blind. */
  detail?: string;
  fixes: Fix[];
}

/** What a column's type expects, in the words a cell problem says. */
const EXPECTS: Record<ColumnType, string> = {
  text: "text",
  number: "a number",
  date: "a date, like 2026-10-01",
  checkbox: "a tick",
  select: "one of the column's choices",
  link: "a link",
};

/** The label on a fix's button. */
export function fixLabel(fix: Fix): string {
  switch (fix.kind) {
    case "reid":
      return "Give it its own";
    case "clean":
      return "Remove it";
    case "clear-cell":
      return "Clear the cell";
    case "make-text":
      return "Make the column text";
    case "add-option":
      return `Add “${fix.option}” to the choices`;
    case "trim-row":
      return "Drop the extra cells";
    case "widen":
      return "Add columns for them";
    case "drop-stray":
      return "Remove it";
    case "fix-sort":
    case "fix-filter":
      return "Remove it";
    case "close-fence":
      return "End the code block";
    case "wrap-table":
      return "Put it in a tab";
    default:
      return assertNever(fix);
  }
}

/** The place a diagnostic's line falls in: the last tab whose heading is on or above it, or -1 above the first. */
const tabAt = (table: Table, line: number): number => {
  let at = -1;
  table.tabs.forEach((t, i) => {
    if (t.line <= line) at = i;
  });
  return at;
};

/** The indexes of the columns, or rows, whose id an earlier one already has — what `ET_DUPLICATE_ID` is said of, in order. */
const repeats = (items: readonly { id?: string }[]): number[] => {
  const seen = new Set<string>();
  const out: number[] = [];
  items.forEach((x, i) => {
    if (x.id === undefined) return;
    if (seen.has(x.id)) out.push(i);
    else seen.add(x.id);
  });
  return out;
};

/** A word the file wrote, quoted for a sentence: short, and with no way to run on. */
const quote = (s: string, max = 40): string => {
  const one = s.replace(/\s+/g, " ").trim();
  return `“${one.length > max ? one.slice(0, max - 1) + "…" : one}”`;
};

/**
 * What the page says about one diagnostic, or `null` for one it does not show. `nth` is how many
 * diagnostics of this code were reported at the same line and column before it: the parser reports
 * one per offender, in the order it found them, and the sentence is about that offender.
 */
export function said(text: string, table: Table, d: TableDiagnostic, nth: number): Problem | null {
  const key = `${d.code}:${d.line}:${d.col}:${nth}`;
  const make = (where: Where, words: string, fixes: Fix[], detail?: string): Problem => ({
    key,
    code: d.code,
    severity: d.severity,
    where,
    words,
    fixes,
    ...(detail ? { detail } : {}),
  });
  const ti = tabAt(table, d.line);
  const tab = table.tabs[ti];
  const inTab = (t: number): Where => (t >= 0 ? { kind: "tab", tab: t } : { kind: "file" });
  switch (d.code) {
    case "ET_DUPLICATE_ID": {
      if (!tab) return null;
      if (d.line === tab.line)
        return make(
          { kind: "tab", tab: ti },
          "This tab shares its identity with another one, so a link to either could reach the wrong one.",
          [{ kind: "reid" }],
        );
      if (tab.grid && d.line === tab.grid.line) {
        const column = repeats(tab.columns)[nth];
        if (column === undefined) return null;
        return make(
          { kind: "column", tab: ti, column },
          "This column shares its identity with another one, so a sort or a filter could pick the wrong one.",
          [{ kind: "reid" }],
        );
      }
      const row = tab.rows.findIndex((r) => r.line === d.line);
      if (row === -1) return null;
      return make(
        { kind: "row", tab: ti, row },
        "This row shares its identity with another one, so an edit, a move or a link could land on the wrong one.",
        [{ kind: "reid" }],
      );
    }
    /* An id is the file's business, written the first time anything is. */
    case "WT_NO_ID":
    /* The empty state says this one, with a button. */
    case "WT_EMPTY":
      return null;
    case "WT_UNKNOWN_ATTR": {
      if (!tab) return null;
      if (d.line === tab.line) {
        const word = tab.extra.order[nth];
        return make(
          { kind: "tab", tab: ti },
          word
            ? `This tab carries a setting the app doesn't know: ${quote(word)}.`
            : "This tab carries a setting the app doesn't know.",
          [{ kind: "clean" }],
        );
      }
      if (tab.grid && d.line === tab.grid.line) {
        const column = tab.columns.findIndex((c) => c.span.start === tab.grid!.header.start + d.col - 1);
        const c = tab.columns[column];
        if (!c) return null;
        const word = c.extra.order[nth];
        const flag = word !== undefined && c.extra.map[word] === true;
        return make(
          { kind: "column", tab: ti, column },
          word
            ? flag
              ? `${quote(word)} is not a column type. A column is one of ${COLUMN_TYPES.join(", ")}.`
              : `This column carries a setting the app doesn't know: ${quote(word)}.`
            : "This column carries a setting the app doesn't know.",
          [{ kind: "clean" }],
        );
      }
      /* A row's braces are attributes only when they hold nothing but an id and a height, so a row has no unknown ones. */
      return null;
    }
    case "WT_CELL": {
      if (!tab) return null;
      const row = tab.rows.findIndex((r) => r.line === d.line);
      const r = tab.rows[row];
      if (!r) return null;
      const column = tab.columns.findIndex(
        (c, i) =>
          c.type !== "text" &&
          (r.segments[i]?.start ?? r.span.start) - r.span.start + 1 === d.col &&
          !readCell(c.type, r.cells[i] ?? "", c.type === "select" ? c.options : undefined).ok,
      );
      const c = tab.columns[column];
      if (!c) return null;
      const value = (r.cells[column] ?? "").trim();
      const fixes: Fix[] = [{ kind: "clear-cell" }];
      if (c.type === "select" && value) fixes.unshift({ kind: "add-option", option: value });
      fixes.push({ kind: "make-text" });
      return make(
        { kind: "cell", tab: ti, row, column },
        `${quote(value)} is not ${EXPECTS[c.type]}, which the column ${quote(c.name || String(column + 1))} holds.`,
        fixes,
      );
    }
    case "WT_ROW_WIDTH": {
      if (!tab) return null;
      const row = tab.rows.findIndex((r) => r.line === d.line);
      const r = tab.rows[row];
      if (!r) return null;
      const lineText = text.slice(r.span.start, r.span.end).replace(/\r?\n$/, "");
      const extra = Math.max(1, splitRow(lineText).length - tab.columns.length);
      return make(
        { kind: "row", tab: ti, row },
        `This row has ${extra} more ${extra === 1 ? "cell" : "cells"} than the table has columns, so ${extra === 1 ? "it isn't" : "they aren't"} shown.`,
        [{ kind: "widen" }, { kind: "trim-row" }],
      );
    }
    case "WT_STRAY": {
      if (!tab) return null;
      const stray = strayOf(text, tab);
      return make(
        { kind: "tab", tab: ti },
        tab.grid
          ? "There is text under this tab that is not part of its table, so it isn't shown."
          : "There is no table under this tab the app can read, only text, so nothing is shown.",
        [{ kind: "drop-stray" }],
        stray.length > 160 ? `${stray.slice(0, 159)}…` : stray,
      );
    }
    case "WT_BAD_SORT": {
      if (!tab || tab.sortText === undefined) return null;
      const { bad, keys } = readSort(tab.sortText);
      const cols = new Set(tab.columns.map((c) => c.id));
      const missing = keys.filter((k) => !cols.has(k.column));
      const word = nth < bad.length ? bad[nth]! : missing[nth - bad.length]?.column;
      return make(
        { kind: "tab", tab: ti },
        nth < bad.length
          ? `The sort ${quote(word ?? "")} is not one the app can read.`
          : `This tab is sorted by ${quote(word ?? "")}, a column it doesn't have.`,
        [{ kind: "fix-sort" }],
      );
    }
    case "WT_BAD_FILTER": {
      if (!tab || tab.filterText === undefined) return null;
      const { bad, rules } = readFilter(tab.filterText);
      const cols = new Set(tab.columns.map((c) => c.id));
      const missing = rules.filter((r) => !cols.has(r.column));
      const word = nth < bad.length ? bad[nth]! : missing[nth - bad.length]?.column;
      return make(
        { kind: "tab", tab: ti },
        nth < bad.length
          ? `The filter ${quote(word ?? "")} is not one the app can read.`
          : `This tab is filtered on ${quote(word ?? "")}, a column it doesn't have.`,
        [{ kind: "fix-filter" }],
      );
    }
    case "WT_OPEN_FENCE":
      return make(
        inTab(ti),
        "A code block here never ends, so everything after it is read as code and the tabs below it are lost.",
        [{ kind: "close-fence", line: d.line }],
      );
    case "WT_LOOSE_TABLE":
      return make({ kind: "file" }, "This table is above the first tab, so it is part of the description and not a grid.", [
        { kind: "wrap-table", line: d.line },
      ]);
    default:
      return assertNever(d.code);
  }
}

/** Every problem the page shows for a table, in the file's order. */
export function problemsOf(text: string, table: Table): Problem[] {
  const seen = new Map<string, number>();
  const out: Problem[] = [];
  for (const d of tableDiagnostics(table)) {
    const at = `${d.code}:${d.line}:${d.col}`;
    const nth = seen.get(at) ?? 0;
    seen.set(at, nth + 1);
    const p = said(text, table, d, nth);
    if (p) out.push(p);
  }
  return out;
}

/** The problems a tab's page draws above its grid: the file's, and the tab's own. */
export const aboveGrid = (problems: readonly Problem[], tab: number): Problem[] =>
  problems.filter((p) => p.where.kind === "file" || (p.where.kind === "tab" && p.where.tab === tab));

/** Where a problem is, as a place a person can go to: its tab, or `null` for the file. */
export const tabOfProblem = (p: Problem): number | null => (p.where.kind === "file" ? null : p.where.tab);

/**
 * The ids a repair that goes by id needs, of the thing a problem is on — or a refusal when two things
 * share one, which a writer would resolve to the first of them. `reid` is what mends that.
 */
function idsOf(text: string, w: Where): { tab: string; row?: string; column?: string } {
  if (w.kind === "file") throw new TableError("that is not on a tab");
  const table = parseTable(text);
  const tab = table.tabs[w.tab];
  if (!tab?.id || table.tabs.filter((t) => t.id === tab.id).length > 1)
    throw new TableError("two tabs share an id: give one its own first, from the problem marked on it");
  const out: { tab: string; row?: string; column?: string } = { tab: tab.id };
  if (w.kind === "row" || w.kind === "cell") {
    const row = tab.rows[w.row];
    if (!row?.id || tab.rows.filter((r) => r.id === row.id).length > 1)
      throw new TableError("two rows share an id: give one its own first, from the problem marked on it");
    out.row = row.id;
  }
  if (w.kind === "column" || w.kind === "cell") {
    const column = tab.columns[w.column];
    if (!column?.id || tab.columns.filter((c) => c.id === column.id).length > 1)
      throw new TableError("two columns share an id: give one its own first, from the problem marked on it");
    out.column = column.id;
  }
  return out;
}

/**
 * One repair a problem offers, as the text it leaves: a writer from `src/table/write.ts` and nothing
 * else. `text` is the file with every id given (`stampTable`), which the positions in `p` survive.
 * A repair that does not apply to where the problem is returns the text it was given.
 */
export function repair(text: string, p: Problem, f: Fix): string {
  const w = p.where;
  switch (f.kind) {
    case "reid":
      if (w.kind === "tab") return reidTab(text, w.tab);
      if (w.kind === "column") return reidColumn(text, w.tab, w.column);
      if (w.kind === "row") return reidRow(text, w.tab, w.row);
      return text;
    case "clean":
      if (w.kind === "tab") return dropUnknownAttrs(text, w.tab);
      if (w.kind === "column") return dropUnknownAttrs(text, w.tab, w.column);
      return text;
    case "clear-cell": {
      if (w.kind !== "cell") return text;
      const id = idsOf(text, w);
      return setCell(text, id.tab, id.row!, id.column!, "");
    }
    case "make-text": {
      if (w.kind !== "cell") return text;
      const id = idsOf(text, w);
      return setColumn(text, id.tab, id.column!, { type: "text", options: null });
    }
    case "add-option": {
      if (w.kind !== "cell") return text;
      const id = idsOf(text, w);
      const column = parseTable(text).tabs[w.tab]!.columns[w.column]!;
      return setColumn(text, id.tab, id.column!, { options: [...(column.options ?? []), f.option] });
    }
    case "trim-row":
      return w.kind === "row" ? trimRow(text, w.tab, w.row) : text;
    case "widen":
      return w.kind === "row" ? widenToRow(text, w.tab, w.row) : text;
    case "drop-stray":
      return w.kind === "tab" ? removeStray(text, w.tab) : text;
    case "fix-sort": {
      if (w.kind !== "tab") return text;
      const id = idsOf(text, w);
      const { sort } = parseTable(text).tabs[w.tab]!;
      return setTab(text, id.tab, { sort: sort.length ? sort : null });
    }
    case "fix-filter": {
      if (w.kind !== "tab") return text;
      const id = idsOf(text, w);
      const { filter } = parseTable(text).tabs[w.tab]!;
      return setTab(text, id.tab, { filter: filter.length ? filter : null });
    }
    case "close-fence":
      return closeFence(text, f.line);
    case "wrap-table":
      return wrapLooseTable(text, f.line);
    default:
      return assertNever(f);
  }
}
