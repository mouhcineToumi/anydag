import fs from "node:fs";
import path from "node:path";

import type { TableDiagnostic } from "../../src/table/codes";
import { tabCsv } from "../../src/table/csv";
import { COLUMN_TYPES, isColumnType, parseTable, type ColumnType } from "../../src/table/parse";

import { EXIT } from "../api";
import { UsageError, bool, str } from "../args";
import { confirm, emit, readText, short, table as aligned, type Command, type Ctx } from "../context";
import { checked } from "./docs";

/**
 * Tables: the fourth kind of file.
 *
 * Reading, writing, moving and deleting one are the `table` commands `docCommands` makes, as a
 * quiz's are. What is here is what only a table has: its grid printed, and an edit to one cell, row,
 * column or tab — each **one op sent to `POST /__board/table`**, which applies it to whatever the
 * text is when it lands. So none of these computes anything from a text it read: an op addresses by
 * id, and the server re-applies it to the text that beat it, `/retitle`'s loop, rather than the
 * CLI's `mutate` recomputing on a 409. CSV comes in through the same route (`importCsv`) and goes out
 * computed here from the text, with the page's own `tabCsv`.
 */

interface Listed {
  tables?: string[];
  ids: Record<string, string>;
  titles?: Record<string, string>;
}

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
  cells: Record<string, string>;
  unread: string[];
}

interface TabData {
  id: string | null;
  name: string;
  sort: { column: string; desc: boolean }[];
  filter: { column: string; op: string; value: string }[];
  columns: ColumnData[];
  total: number;
  rows: RowData[];
}

interface TableGot {
  name: string;
  id: string;
  base: string;
  title: string | null;
  description: string;
  tabs: TabData[];
  diagnostics: TableDiagnostic[];
}

interface Edited {
  name: string;
  base: string;
  text: string;
  changed: boolean;
  minted: { tabs: string[]; columns: string[]; rows: string[] };
  diagnostics: TableDiagnostic[];
}

const q = { kind: "table" };

/** One list of ops sent to the route, and what it did said back — the one door every edit here goes through. */
async function edit(ctx: Ctx, name: string, ops: Record<string, unknown>[], said: (e: Edited) => string): Promise<Edited> {
  const done = await ctx.api.post<Edited>("/__board/table", { name, ops });
  emit(ctx, done, () => ctx.io.err(done.changed ? `${said(done)} — base ${short(done.base)}` : `${name} unchanged`));
  return done;
}

/** A table's problems printed one a line, and the exit code they make — `quizLines`' shape. */
export function tableLines(ctx: Ctx, diagnostics: readonly TableDiagnostic[]): number {
  for (const d of diagnostics) ctx.io.out(`${d.line}:${d.col} ${d.severity} ${d.code}${d.tab ? ` [${d.tab}]` : ""} ${d.message}`);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  if (diagnostics.length)
    ctx.io.err(`${errors} error${errors === 1 ? "" : "s"}, ${diagnostics.length - errors} warning${diagnostics.length - errors === 1 ? "" : "s"}`);
  return errors > 0 ? EXIT.errors : EXIT.ok;
}

/** `name=Acme amount=12` as `{name: "Acme", amount: "12"}`: the cells a new row starts with. */
function valuesOf(words: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const w of words) {
    const at = w.indexOf("=");
    if (at <= 0) throw new UsageError(`\`${w}\` is not a cell: write it <column>=<value>`);
    out[w.slice(0, at)] = w.slice(at + 1);
  }
  return out;
}

const typeOf = (p: { flags: Record<string, unknown> }): ColumnType | undefined => {
  const t = p.flags.type;
  if (t === undefined) return undefined;
  if (!isColumnType(t)) throw new UsageError(`\`${String(t)}\` is not a column type: ${COLUMN_TYPES.join(", ")}`);
  return t;
};

const optionsOf = (raw: string | undefined): string[] | undefined =>
  raw === undefined ? undefined : raw.split(",").map((s) => s.trim()).filter(Boolean);

/** A width or a height in pixels, or `null` for `off`. */
function pixels(raw: string, what: string): number | null {
  if (raw === "off" || raw === "none") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`\`${raw}\` is not a ${what} in pixels (or \`off\`)`);
  return Math.round(n);
}

/** One tab as lines a terminal lines up: the ids over the names, then a row per line with its id first. */
function gridLines(tab: TabData): string[] {
  const head = ["", ...tab.columns.map((c) => `${c.name}${c.type === "text" ? "" : ` (${c.type})`}`)];
  const ids = ["#", ...tab.columns.map((c, i) => c.id ?? `#${i + 1}`)];
  const rows = tab.rows.map((r) => [
    r.id ?? `L${r.line}`,
    ...tab.columns.map((c, i) => {
      const key = c.id ?? `#${i + 1}`;
      const v = (r.cells[key] ?? "").replace(/\n/g, " ⏎ ");
      return r.unread.includes(key) ? `${v} ?` : v;
    }),
  ]);
  return aligned([ids, head, ...rows]);
}

export const TABLE: Command[] = [
  {
    name: ["table", "ls"],
    args: "[<folder>]",
    summary: "every table, with its title",
    routes: ["GET /__board/list"],
    async run(ctx, p) {
      const listed = await ctx.api.get<Listed>("/__board/list");
      const under = p.pos[0]?.replace(/\/+$/, "");
      const rows = (listed.tables ?? [])
        .filter((n) => !under || n.startsWith(`${under}/`))
        .map((name) => ({ name, id: listed.ids[name] ?? "", title: listed.titles?.[name] ?? name.slice(name.lastIndexOf("/") + 1) }));
      emit(ctx, rows, () => {
        if (!rows.length) return ctx.io.err("no tables");
        for (const line of aligned(rows.map((r) => [r.name, r.id, r.title]))) ctx.io.out(line);
      });
    },
  },
  {
    name: ["table", "check"],
    args: "[name]",
    min: 0,
    summary: "what the parser says about a table, without writing it; exit 4 on an error",
    help:
      "Every problem with its line and its code — ET_ for two things claiming one id, WT_ for everything that " +
      "still works: a cell its column cannot read, a row with no id yet, a sort naming a column that went. " +
      "--file checks a draft that is not in the vault, writing nothing.",
    flags: [{ name: "file", type: "string", value: "<path|->", help: "check this draft instead of a file in the vault; `-` is stdin" }],
    routes: ["GET /__board/diagnostics", "POST /__board/diagnostics"],
    async run(ctx, p) {
      const got = await checked<{ tabs: number; rows: number; diagnostics: TableDiagnostic[] }>(ctx, p, "table");
      if (ctx.json) {
        ctx.io.out(JSON.stringify(got, null, 2));
        return got.diagnostics.some((d) => d.severity === "error") ? EXIT.errors : EXIT.ok;
      }
      const code = tableLines(ctx, got.diagnostics);
      if (!got.diagnostics.length) ctx.io.err(`${p.pos[0] ?? str(p, "file")}: ${got.tabs} tab(s), ${got.rows} row(s), nothing wrong`);
      return code;
    },
  },
  {
    name: ["table", "show"],
    args: "<name>",
    min: 1,
    summary: "a table's tabs as grids — every row with its id, every column with its id and type",
    help:
      "The ids are what `table set`, `table row`, `table col` and `table tab` address. A row with no id yet is " +
      "shown by its line; --stamp gives every tab, column and row that has none an id first, which writes the " +
      "file. --view shows each tab's rows as the tab does — filtered, in its sort order — where the default is every " +
      "row in the file's order. A value its column cannot read is marked `?`.",
    flags: [
      { name: "tab", type: "string", value: "<id>", help: "one tab only" },
      { name: "view", type: "boolean", help: "each tab's rows filtered and sorted as it says" },
      { name: "stamp", type: "boolean", help: "give everything that has no id one, in the file, first" },
    ],
    routes: ["GET /__board/table"],
    async run(ctx, p) {
      const got = await ctx.api.get<TableGot>("/__board/table", {
        name: p.pos[0],
        tab: str(p, "tab"),
        view: bool(p, "view") ? "true" : undefined,
        stamp: bool(p, "stamp") ? "true" : undefined,
      });
      emit(ctx, got, () => {
        ctx.io.out(`${got.title ?? got.name}  ${got.id}`);
        for (const tab of got.tabs) {
          ctx.io.out("");
          const how = [
            tab.sort.length ? `sorted ${tab.sort.map((s) => (s.desc ? `${s.column}:desc` : s.column)).join(", ")}` : "",
            tab.filter.length ? `filtered ${tab.filter.map((f) => `${f.column}${f.op}${f.value}`).join("; ")}` : "",
            tab.rows.length !== tab.total ? `${tab.rows.length} of ${tab.total} rows` : `${tab.total} row${tab.total === 1 ? "" : "s"}`,
          ].filter(Boolean);
          ctx.io.out(`## ${tab.name}  {#${tab.id ?? "?"}}  ${how.join(" · ")}`);
          if (tab.columns.length) for (const line of gridLines(tab)) ctx.io.out(line);
          else ctx.io.out("(no columns yet)");
        }
      });
    },
  },
  {
    name: ["table", "set"],
    args: "<name> <tab> <row> <column> <value…>",
    min: 4,
    summary: "set one cell — the rest of the line is its value; an empty one clears it",
    help:
      "Addressed by id: `anydag table show <name>` prints them. The value is written as the cell's text — a number, " +
      "`YYYY-MM-DD`, `[x]` or `[ ]`, one of a select's options, `[words](https://…)` or `[Title](dag:<id>)` — and a " +
      "value its column cannot read is kept and warned about rather than refused.",
    routes: ["POST /__board/table"],
    async run(ctx, p) {
      const [name, tab, row, column, ...rest] = p.pos as [string, string, string, string, ...string[]];
      await edit(ctx, name, [{ op: "cell", tab, row, column, value: rest.join(" ") }], () => `set ${tab}/${row}/${column}`);
    },
  },
  {
    name: ["table", "row", "add"],
    args: "<name> <tab> [<column>=<value>…]",
    min: 2,
    summary: "add a row, with its cells by column id; prints its id",
    flags: [
      { name: "after", type: "string", value: "<row>", help: "put it after this row rather than at the end" },
      { name: "before", type: "string", value: "<row>", help: "put it before this row" },
      { name: "id", type: "string", value: "<id>", help: "the row's id, when it is free" },
    ],
    routes: ["POST /__board/table"],
    async run(ctx, p) {
      const [name, tab, ...cells] = p.pos as [string, string, ...string[]];
      const done = await edit(
        ctx,
        name,
        [{ op: "addRow", tab, values: valuesOf(cells), after: str(p, "after"), before: str(p, "before"), id: str(p, "id") }],
        (e) => `added row ${e.minted.rows[0]} to ${tab}`,
      );
      if (!ctx.json && done.minted.rows[0]) ctx.io.out(done.minted.rows[0]);
    },
  },
  {
    name: ["table", "row", "rm"],
    args: "<name> <tab> <row>",
    min: 3,
    summary: "remove a row",
    routes: ["POST /__board/table"],
    async run(ctx, p) {
      const [name, tab, row] = p.pos as [string, string, string];
      await edit(ctx, name, [{ op: "removeRow", tab, row }], () => `removed row ${row} from ${tab}`);
    },
  },
  {
    name: ["table", "row", "mv"],
    args: "<name> <tab> <row>",
    min: 3,
    summary: "move a row before another, or to the end — its stored place, which a sort does not change",
    flags: [{ name: "before", type: "string", value: "<row>", help: "the row it goes before; the end without one" }],
    routes: ["POST /__board/table"],
    async run(ctx, p) {
      const [name, tab, row] = p.pos as [string, string, string];
      await edit(ctx, name, [{ op: "moveRow", tab, row, before: str(p, "before") ?? null }], () => `moved row ${row}`);
    },
  },
  {
    name: ["table", "row", "height"],
    args: "<name> <tab> <row> <px|off>",
    min: 4,
    summary: "a row's height in pixels, or off",
    routes: ["POST /__board/table"],
    async run(ctx, p) {
      const [name, tab, row, raw] = p.pos as [string, string, string, string];
      await edit(ctx, name, [{ op: "rowHeight", tab, row, h: pixels(raw, "height") }], () => `row ${row} is ${raw === "off" ? "its own height" : `${raw}px`}`);
    },
  },
  {
    name: ["table", "col", "add"],
    args: "<name> <tab> <column name…>",
    min: 3,
    summary: "add a column — its id is its name's slug unless --id says; prints the id",
    flags: [
      { name: "type", type: "string", value: "<type>", help: `${COLUMN_TYPES.join(", ")} (text when absent)` },
      { name: "options", type: "string", value: "<a,b,c>", help: "a select's options" },
      { name: "after", type: "string", value: "<column>", help: "put it after this column rather than at the end" },
      { name: "id", type: "string", value: "<id>", help: "the column's id, when it is free" },
      { name: "width", type: "string", value: "<px>", help: "its width in pixels" },
    ],
    routes: ["POST /__board/table"],
    async run(ctx, p) {
      const [name, tab, ...words] = p.pos as [string, string, ...string[]];
      const w = str(p, "width");
      const done = await edit(
        ctx,
        name,
        [
          {
            op: "addColumn",
            tab,
            name: words.join(" "),
            type: typeOf(p),
            options: optionsOf(str(p, "options")),
            after: str(p, "after"),
            id: str(p, "id"),
            w: w === undefined ? undefined : (pixels(w, "width") ?? undefined),
          },
        ],
        (e) => `added column ${e.minted.columns[0]} to ${tab}`,
      );
      if (!ctx.json && done.minted.columns[0]) ctx.io.out(done.minted.columns[0]);
    },
  },
  {
    name: ["table", "col", "set"],
    args: "<name> <tab> <column>",
    min: 3,
    summary: "rename a column, change its type, its options or its width — its cells are not rewritten",
    flags: [
      { name: "name", type: "string", value: "<name>", help: "what it is called" },
      { name: "type", type: "string", value: "<type>", help: COLUMN_TYPES.join(", ") },
      { name: "options", type: "string", value: "<a,b,c|off>", help: "a select's options, or off to read them off its values" },
      { name: "width", type: "string", value: "<px|off>", help: "its width in pixels, or off" },
    ],
    routes: ["POST /__board/table"],
    async run(ctx, p) {
      const [name, tab, column] = p.pos as [string, string, string];
      const op: Record<string, unknown> = { op: "setColumn", tab, column };
      if (str(p, "name") !== undefined) op.name = str(p, "name");
      if (p.flags.type !== undefined) op.type = typeOf(p);
      const options = str(p, "options");
      if (options !== undefined) op.options = options === "off" ? null : optionsOf(options);
      const w = str(p, "width");
      if (w !== undefined) op.w = pixels(w, "width");
      if (Object.keys(op).length === 4) throw new UsageError("say what to change: --name, --type, --options or --width");
      await edit(ctx, name, [op], () => `changed column ${column}`);
    },
  },
  {
    name: ["table", "col", "rm"],
    args: "<name> <tab> <column>",
    min: 3,
    summary: "remove a column and every cell in it",
    flags: [{ name: "yes", short: "y", type: "boolean", help: "do not ask" }],
    routes: ["POST /__board/table"],
    async run(ctx, p) {
      const [name, tab, column] = p.pos as [string, string, string];
      await confirm(ctx, `remove the column ${column} from ${name}, with every cell in it?`, bool(p, "yes"));
      await edit(ctx, name, [{ op: "removeColumn", tab, column }], () => `removed column ${column}`);
    },
  },
  {
    name: ["table", "col", "mv"],
    args: "<name> <tab> <column>",
    min: 3,
    summary: "move a column before another, or to the end",
    flags: [{ name: "before", type: "string", value: "<column>", help: "the column it goes before; the end without one" }],
    routes: ["POST /__board/table"],
    async run(ctx, p) {
      const [name, tab, column] = p.pos as [string, string, string];
      await edit(ctx, name, [{ op: "moveColumn", tab, column, before: str(p, "before") ?? null }], () => `moved column ${column}`);
    },
  },
  {
    name: ["table", "tab", "add"],
    args: "<name> <tab name…>",
    min: 2,
    summary: "add a tab — its id is its name's slug unless --id says; prints the id",
    flags: [
      { name: "after", type: "string", value: "<tab>", help: "put it after this tab rather than at the end" },
      { name: "id", type: "string", value: "<id>", help: "the tab's id, when it is free" },
    ],
    routes: ["POST /__board/table"],
    async run(ctx, p) {
      const [name, ...words] = p.pos as [string, ...string[]];
      const done = await edit(ctx, name, [{ op: "addTab", name: words.join(" "), after: str(p, "after"), id: str(p, "id") }], (e) => `added tab ${e.minted.tabs[0]}`);
      if (!ctx.json && done.minted.tabs[0]) ctx.io.out(done.minted.tabs[0]);
    },
  },
  {
    name: ["table", "tab", "set"],
    args: "<name> <tab>",
    min: 2,
    summary: "rename a tab, or set its sort and filter — which the page, a card and every reader apply",
    help:
      "--sort is column ids, each `:asc` or `:desc`: `amount:desc, name`. --filter is rules joined by `;`, every " +
      "one of which must hold: a column id, an operator (= != ~ !~ > >= < <=) and a value — `stage!=Lost; " +
      "amount>=1000`; `col=` alone is *is empty* and `col!=` *is not empty*. `off` takes either away. Neither moves a " +
      "row: the stored order is untouched, and taking a sort off gives it back.",
    flags: [
      { name: "name", type: "string", value: "<name>", help: "what it is called" },
      { name: "sort", type: "string", value: "<keys|off>", help: "the sort, or off" },
      { name: "filter", type: "string", value: "<rules|off>", help: "the filter, or off" },
    ],
    routes: ["POST /__board/table"],
    async run(ctx, p) {
      const [name, tab] = p.pos as [string, string];
      const op: Record<string, unknown> = { op: "setTab", tab };
      if (str(p, "name") !== undefined) op.name = str(p, "name");
      const sort = str(p, "sort");
      if (sort !== undefined) op.sort = sort === "off" ? null : sort;
      const filter = str(p, "filter");
      if (filter !== undefined) op.filter = filter === "off" ? null : filter;
      if (Object.keys(op).length === 2) throw new UsageError("say what to change: --name, --sort or --filter");
      await edit(ctx, name, [op], () => `changed tab ${tab}`);
    },
  },
  {
    name: ["table", "tab", "rm"],
    args: "<name> <tab>",
    min: 2,
    summary: "remove a tab and everything in it",
    flags: [{ name: "yes", short: "y", type: "boolean", help: "do not ask" }],
    routes: ["POST /__board/table"],
    async run(ctx, p) {
      const [name, tab] = p.pos as [string, string];
      await confirm(ctx, `remove the tab ${tab} from ${name}, with every row in it?`, bool(p, "yes"));
      await edit(ctx, name, [{ op: "removeTab", tab }], () => `removed tab ${tab}`);
    },
  },
  {
    name: ["table", "tab", "mv"],
    args: "<name> <tab>",
    min: 2,
    summary: "move a tab before another, or to the end",
    flags: [{ name: "before", type: "string", value: "<tab>", help: "the tab it goes before; the end without one" }],
    routes: ["POST /__board/table"],
    async run(ctx, p) {
      const [name, tab] = p.pos as [string, string];
      await edit(ctx, name, [{ op: "moveTab", tab, before: str(p, "before") ?? null }], () => `moved tab ${tab}`);
    },
  },
  {
    name: ["table", "import"],
    args: "<file.csv|->",
    min: 1,
    summary: "a CSV as a new table, or with --into as a new tab of one; the types are read off the values",
    help:
      "The first record is the header. The delimiter is sniffed — a comma, a semicolon or a tab — and each " +
      "column's type is inferred: a number, a date, a checkbox or a link when every value says so, text otherwise. " +
      "Without --into a table is made, titled after the file (or --title), and its name printed.",
    flags: [
      { name: "into", type: "string", value: "<table>", help: "add a tab to this table rather than make one" },
      { name: "tab", type: "string", value: "<name>", help: "the new tab's name (the file's, without one)" },
      { name: "title", type: "string", value: "<title>", help: "a new table's title" },
      { name: "name", type: "string", value: "<name>", help: "a new table's name; it may be numbered" },
    ],
    routes: ["POST /__board/create", "POST /__board/table"],
    async run(ctx, p) {
      const file = p.pos[0]!;
      const csv = await readText(ctx, file, "the CSV");
      const stem = file === "-" ? "Imported" : path.basename(file).replace(/\.[^.]+$/, "");
      const tab = str(p, "tab") ?? stem;
      let name = str(p, "into");
      if (!name) {
        const title = str(p, "title") ?? stem;
        const made = await ctx.api.post<{ name: string }>("/__board/create", {
          name: str(p, "name") ?? title,
          text: `---\ntitle: ${JSON.stringify(title)}\n---\n`,
          kind: "table",
        });
        name = made.name;
      }
      const done = await edit(ctx, name, [{ op: "importCsv", name: tab, csv }], (e) => `imported ${file} into ${name} as the tab ${e.minted.tabs[0]}`);
      if (!ctx.json) ctx.io.out(`${name}  ${done.minted.tabs[0] ?? ""}`.trim());
    },
  },
  {
    name: ["table", "export"],
    args: "<name>",
    min: 1,
    summary: "a tab as CSV — every row, in its sort order, unfiltered — to stdout or --out",
    flags: [
      { name: "tab", type: "string", value: "<id>", help: "which tab (the first without one)" },
      { name: "out", type: "string", value: "<file>", help: "write it here rather than to stdout" },
      { name: "delimiter", type: "string", value: "<,|;|tab>", help: "what separates the fields (a comma)" },
    ],
    routes: ["GET /__board/get"],
    async run(ctx, p) {
      const name = p.pos[0]!;
      const got = await ctx.api.get<{ text: string }>("/__board/get", { name, ...q });
      const table = parseTable(got.text);
      const want = str(p, "tab");
      const tab = want ? table.tabs.find((t) => t.id === want) : table.tabs[0];
      if (!tab) throw new UsageError(want ? `no tab \`${want}\` in ${name}` : `${name} has no tabs`);
      const d = str(p, "delimiter") ?? ",";
      const csv = tabCsv(tab, d === "tab" ? "\t" : d);
      const out = str(p, "out");
      if (out) {
        fs.writeFileSync(out, csv);
        ctx.io.err(`wrote ${tab.rows.length} row${tab.rows.length === 1 ? "" : "s"} of ${name} to ${out}`);
      } else ctx.io.write(csv);
    },
  },
];

