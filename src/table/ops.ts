/**
 * A list of edits to a table, applied in order — what `POST /__board/table` takes, and what the CLI
 * and an agent over MCP send.
 *
 * **Ops address everything by id**, never by position, so a list applies to whatever the text is
 * when it lands: the api re-applies it to the text that beat it on a conflict rather than refusing,
 * `/retitle`'s loop. An op naming a tab, a row or a column the table does not have refuses the whole
 * list — nothing half-applied is ever written — with a message naming what was not there.
 *
 * A row, a column or a tab an op adds may be given its id, so a later op in the same list can name
 * it; one it is not given is minted, and every id minted is in the answer.
 *
 * Browser-free and alias-free: the local server runs this, and the CLI.
 */
import { csvTab } from "./csv";
import { isColumnType, type ColumnType } from "./parse";
import {
  TableError,
  addColumn,
  addRow,
  addTab,
  moveColumn,
  moveRow,
  moveTab,
  removeColumn,
  removeRow,
  removeTab,
  setCell,
  setColumn,
  setRowHeight,
  setTab,
  stampTable,
} from "./write";

type TableOp =
  | { op: "cell"; tab: string; row: string; column: string; value: string }
  | { op: "addRow"; tab: string; id?: string; values?: Record<string, string>; after?: string; before?: string }
  | { op: "removeRow"; tab: string; row: string }
  | { op: "moveRow"; tab: string; row: string; before: string | null }
  | { op: "rowHeight"; tab: string; row: string; h: number | null }
  | { op: "addColumn"; tab: string; id?: string; name: string; type?: ColumnType; options?: string[]; w?: number; after?: string; before?: string }
  | { op: "setColumn"; tab: string; column: string; name?: string; type?: ColumnType; options?: string[] | null; w?: number | null }
  | { op: "removeColumn"; tab: string; column: string }
  | { op: "moveColumn"; tab: string; column: string; before: string | null }
  | { op: "addTab"; id?: string; name: string; after?: string }
  | { op: "setTab"; tab: string; name?: string; sort?: string | null; filter?: string | null }
  | { op: "removeTab"; tab: string }
  | { op: "moveTab"; tab: string; before: string | null }
  | { op: "importCsv"; id?: string; name: string; csv: string; after?: string };

const TABLE_OPS = [
  "cell",
  "addRow",
  "removeRow",
  "moveRow",
  "rowHeight",
  "addColumn",
  "setColumn",
  "removeColumn",
  "moveColumn",
  "addTab",
  "setTab",
  "removeTab",
  "moveTab",
  "importCsv",
] as const;

/** What applying a list minted, in the order the ops that added them came. */
export interface Minted {
  tabs: string[];
  columns: string[];
  rows: string[];
}

export type Applied = { ok: true; text: string; minted: Minted } | { ok: false; status: 400 | 404; error: string };

const isStr = (v: unknown): v is string => typeof v === "string";
const optStr = (v: unknown): boolean => v === undefined || typeof v === "string";
const nullStr = (v: unknown): boolean => v === null || typeof v === "string";
const isRecordOfStrings = (v: unknown): boolean =>
  v === undefined || (!!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string"));

/** Why one op is the wrong shape, or `null` when it is a `TableOp`. */
export function opProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "an op is an object with an `op`";
  const o = raw as Record<string, unknown>;
  const need = (...keys: string[]): string | null => {
    const missing = keys.find((k) => !isStr(o[k]));
    return missing ? `\`${String(o.op)}\` needs \`${missing}\`, a string` : null;
  };
  switch (o.op) {
    case "cell":
      return need("tab", "row", "column", "value");
    case "addRow":
      return need("tab") ?? (optStr(o.id) && optStr(o.after) && optStr(o.before) && isRecordOfStrings(o.values) ? null : "`addRow` takes `values` as `{column: text}`, and `id`, `after`, `before` as strings");
    case "removeRow":
      return need("tab", "row");
    case "moveRow":
      return need("tab", "row") ?? (nullStr(o.before) ? null : "`moveRow` needs `before`: a row's id, or null for the end");
    case "rowHeight":
      return need("tab", "row") ?? (o.h === null || (typeof o.h === "number" && o.h > 0) ? null : "`rowHeight` needs `h`: pixels above zero, or null");
    case "addColumn":
      return (
        need("tab", "name") ??
        (o.type !== undefined && !isColumnType(o.type) ? `\`${String(o.type)}\` is not a column type` : null) ??
        (o.options !== undefined && !(Array.isArray(o.options) && o.options.every(isStr)) ? "`options` is a list of strings" : null) ??
        (o.w !== undefined && typeof o.w !== "number" ? "`w` is a number of pixels" : null) ??
        (optStr(o.id) && optStr(o.after) && optStr(o.before) ? null : "`id`, `after` and `before` are strings")
      );
    case "setColumn":
      return (
        need("tab", "column") ??
        (o.type !== undefined && !isColumnType(o.type) ? `\`${String(o.type)}\` is not a column type` : null) ??
        (o.options !== undefined && o.options !== null && !(Array.isArray(o.options) && o.options.every(isStr)) ? "`options` is a list of strings, or null" : null) ??
        (o.w !== undefined && o.w !== null && typeof o.w !== "number" ? "`w` is a number of pixels, or null" : null) ??
        (optStr(o.name) ? null : "`name` is a string")
      );
    case "removeColumn":
      return need("tab", "column");
    case "moveColumn":
      return need("tab", "column") ?? (nullStr(o.before) ? null : "`moveColumn` needs `before`: a column's id, or null for the end");
    case "addTab":
      return need("name") ?? (optStr(o.id) && optStr(o.after) ? null : "`id` and `after` are strings");
    case "setTab":
      return (
        need("tab") ??
        (optStr(o.name) && (o.sort === undefined || nullStr(o.sort)) && (o.filter === undefined || nullStr(o.filter))
          ? null
          : "`setTab` takes `name`, `sort` and `filter` as strings, and null to take a sort or a filter off")
      );
    case "removeTab":
      return need("tab");
    case "moveTab":
      return need("tab") ?? (nullStr(o.before) ? null : "`moveTab` needs `before`: a tab's id, or null for the end");
    case "importCsv":
      return need("name", "csv") ?? (optStr(o.id) && optStr(o.after) ? null : "`id` and `after` are strings");
    default:
      return `\`${String(o.op)}\` is not an op: ${TABLE_OPS.join(", ")}`;
  }
}

/** Apply every op, in order, to one text. Missing ids are stamped first, so every op can name what it sees. */
export function applyTableOps(text: string, ops: readonly unknown[]): Applied {
  for (const raw of ops) {
    const problem = opProblem(raw);
    if (problem) return { ok: false, status: 400, error: problem };
  }
  const minted: Minted = { tabs: [], columns: [], rows: [] };
  let out = ops.length ? stampTable(text) : text;
  try {
    for (const op of ops as TableOp[]) {
      switch (op.op) {
        case "cell":
          out = setCell(out, op.tab, op.row, op.column, op.value);
          break;
        case "addRow": {
          const r = addRow(out, op.tab, op);
          out = r.text;
          minted.rows.push(r.id);
          break;
        }
        case "removeRow":
          out = removeRow(out, op.tab, op.row);
          break;
        case "moveRow":
          out = moveRow(out, op.tab, op.row, op.before);
          break;
        case "rowHeight":
          out = setRowHeight(out, op.tab, op.row, op.h);
          break;
        case "addColumn": {
          const c = addColumn(out, op.tab, op);
          out = c.text;
          minted.columns.push(c.id);
          break;
        }
        case "setColumn": {
          const change: Parameters<typeof setColumn>[3] = {};
          if (op.name !== undefined) change.name = op.name;
          if (op.type !== undefined) change.type = op.type;
          if (op.options !== undefined) change.options = op.options;
          if (op.w !== undefined) change.w = op.w;
          out = setColumn(out, op.tab, op.column, change);
          break;
        }
        case "removeColumn":
          out = removeColumn(out, op.tab, op.column);
          break;
        case "moveColumn":
          out = moveColumn(out, op.tab, op.column, op.before);
          break;
        case "addTab": {
          const t = addTab(out, op);
          out = t.text;
          minted.tabs.push(t.id);
          break;
        }
        case "setTab": {
          const change: Parameters<typeof setTab>[2] = {};
          if (op.name !== undefined) change.name = op.name;
          if (op.sort !== undefined) change.sort = op.sort;
          if (op.filter !== undefined) change.filter = op.filter;
          out = setTab(out, op.tab, change);
          break;
        }
        case "removeTab":
          out = removeTab(out, op.tab);
          break;
        case "moveTab":
          out = moveTab(out, op.tab, op.before);
          break;
        case "importCsv": {
          const { columns, rows } = csvTab(op.csv);
          const t = addTab(out, { ...(op.id ? { id: op.id } : {}), name: op.name, ...(op.after ? { after: op.after } : {}), columns, rows });
          out = t.text;
          minted.tabs.push(t.id);
          break;
        }
      }
    }
  } catch (e) {
    if (e instanceof TableError) return { ok: false, status: 404, error: e.message };
    throw e;
  }
  return { ok: true, text: out, minted };
}
