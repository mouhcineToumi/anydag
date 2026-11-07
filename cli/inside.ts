import type { BoardItem } from "../src/board/types";
import { isDiagramType } from "../src/board/types";
import { FORMS, parseChart, type ChartForm } from "../src/dsl/chart";
import { declaredAt } from "../src/dsl/declared";
import { STATUSES, type Graph } from "../src/dsl/ir";
import { hasGraph, kindsOf, parseDiagram } from "../src/dsl/parse";
import {
  addRow,
  moveStatement,
  moveTopic,
  removeEdge,
  removeNode,
  removeRow,
  renameId,
  replaceLine,
  rowLines,
  setCategories,
  setChartFlag,
  setChartForm,
  setChartOption,
  setDesc,
  setEdgeArrow,
  setEdgeFlag,
  setEdgeHue,
  setEdgeLabel,
  setFlag,
  setGeometry,
  setKind,
  setMeta,
  setModifier,
  setRow,
  setStatus,
  setTitle,
  setValues,
  isArrow,
  statementSpan,
  type Flag,
  type ModifierKey,
} from "../src/dsl/restate";
import { nearest, suggestKind } from "../src/dsl/suggest";
import { tokenize } from "../src/dsl/tokenizer";
import { appendEdge, freshNodeId, grow } from "../src/edit/build";
import type { Side } from "../src/edit/connect";
import { duplicateStatement, edgeAt } from "../src/edit/pick";

import { UsageError } from "./args";
import { hueOf } from "./ops";

/**
 * Reaching inside one diagram: what the Properties panel, the inline rename, the `+`, a picked
 * card's Delete and ctrl+D write — each a new body for one item, made by the same `restate.ts`
 * writer the panel calls, so the author's spacing, quoting and comments come through untouched.
 *
 * Every function here takes an item and answers its next body. Nothing is sent from here.
 */

type Value = string | number | true | null;

/** The diagram, or a usage error for an item that has no grammar to reach into. */
export function diagramOf(it: BoardItem): BoardItem {
  if (!isDiagramType(it.type)) throw new UsageError(`${it.id} is ${it.type === "md" ? "a note" : `an ${it.type} item`}, not a diagram — its body is edited whole with \`anydag item body\``);
  return it;
}

const graphOf = (it: BoardItem): Graph | null => (hasGraph(it.type) ? parseDiagram(it.type, it.body, it.dir, it.aspect, it.layout) : null);

/** Every id this diagram declares, for "did you mean". */
function declared(it: BoardItem): string[] {
  if (it.type === "chart") {
    const m = parseChart(it.body);
    return [...m.series, ...m.slices].map((s) => s.id);
  }
  const g = graphOf(it);
  return g ? [...g.nodes, ...g.groups, ...g.lanes].map((d) => d.id) : [];
}

/** The 1-based body line a card, a group, a lane, a series or a slice is declared on. */
function lineOf(it: BoardItem, id: string): number {
  const line = declaredAt(it.type, it.body, id, it.dir);
  if (line !== null) return line;
  const close = nearest(id, declared(it));
  throw new UsageError(`${it.id} declares no \`${id}\`${close ? ` — did you mean \`${close}\`?` : ""} (\`anydag node ls\` lists them)`);
}

const numbers = (raw: string): (number | null)[] =>
  raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((t) => {
      if (t === "-") return null;
      const n = Number(t);
      if (!Number.isFinite(n)) throw new UsageError(`\`${t}\` is not a number — write \`-\` for a gap`);
      return n;
    });

const FLAGS: readonly Flag[] = ["async", "external", "quiet", "bold", "italic"];

/**
 * One statement's properties, the Properties view's controls as `key=value`: `title`, `meta`,
 * `desc`, `kind`, `hue`, `icon`, `col`, `status`, the flags, `x`/`y`/`w`/`h`, and a chart's
 * `values`. `key=` takes one off; a flag given bare turns it on.
 */
export function setNodeBody(it: BoardItem, id: string, props: Record<string, Value>): string {
  const n = lineOf(it, id);
  let line = it.body.split("\n")[n - 1] ?? "";
  for (const [key, v] of Object.entries(props)) {
    const text = v === null ? null : String(v);
    if (key === "title") line = setTitle(line, text, it.type);
    else if (key === "meta") line = setMeta(line, text);
    else if (key === "desc") line = setDesc(line, text);
    else if (key === "kind") {
      const kinds = kindsOf(it.type);
      if (!text || !kinds.includes(text)) throw new UsageError(`${it.type} has no kind \`${text}\` — ${kinds.join(" · ") || "it has no kind words"}`);
      line = setKind(line, text);
    } else if (key === "hue") line = setModifier(line, "hue", text === null ? null : hueOf(text));
    else if (key === "icon" || key === "col") line = setModifier(line, key, text);
    else if (key === "status") {
      if (text !== null && !(STATUSES as readonly string[]).includes(text)) throw new UsageError(`a status is one of ${STATUSES.join(", ")}`);
      line = setStatus(line, text as (typeof STATUSES)[number] | null);
    } else if ((FLAGS as readonly string[]).includes(key)) line = setFlag(line, key as Flag, v !== null);
    else if (key === "x" || key === "y" || key === "w" || key === "h") {
      /* `setModifier` is the general `key=value` writer with its key type narrowed to the three the
         panel's swatches write; taking a geometry key off is the same span removed. */
      if (v === null) line = setModifier(line, key as ModifierKey, null);
      else if (typeof v !== "number") throw new UsageError(`${key}= wants a number`);
      else line = setGeometry(line, { [key]: v });
    } else if (key === "values") line = setValues(line, text === null ? [] : numbers(text));
    else
      throw new UsageError(
        `\`${key}\` is not something a card says — title, meta, desc, kind, hue, icon, col, status, ${FLAGS.join(", ")}, x, y, w, h, values`,
      );
  }
  return replaceLine(it.body, n, line);
}

const indentOf = (line: string): string => /^[ \t]*/.exec(line)![0]!;

export interface AddNode {
  kind: string;
  id?: string;
  title?: string;
  /** A group or lane to put it in. */
  in?: string;
  /** Grow it from this card, with the edge — the `+` on a picked card. */
  from?: string;
  side?: Side;
  /** Its coordinate, in a sketch or a `layout=fixed` fence. */
  at?: { x: number; y: number };
  /** Whether to draw the edge from `from` in a fixed drawing, where the coordinate is the placement. */
  edge?: boolean;
  /** A chart series' or slice's numbers. */
  values?: string;
  /** What it wears — a figure's picture (`emoji:house`), a card's glyph or logo. */
  icon?: string;
}

/** A new card's statement, and the body with it written in — `{ body, id }`. */
export function addNodeBody(it: BoardItem, a: AddNode): { body: string; id: string } {
  const fixed = it.type === "sketch" || it.layout === "fixed";

  if (it.type === "chart") {
    if (a.kind !== "series" && a.kind !== "slice") throw new UsageError("a chart adds a `series` or a `slice`");
    const id = a.id ?? freshNodeId(it.body, a.kind);
    const values = numbers(a.values ?? "").map((v) => (v === null ? "-" : String(v))).join(" ");
    const statement = [a.kind, id, JSON.stringify(a.title ?? id), values].filter(Boolean).join(" ");
    const m = parseChart(it.body);
    const last = Math.max(0, ...[...m.series, ...m.slices].map((s) => s.line));
    return { body: insertAfter(it.body, last || it.body.replace(/\n+$/, "").split("\n").length, statement), id };
  }

  if (!hasGraph(it.type) || kindsOf(it.type).length === 0) {
    throw new UsageError(`a ${it.type} has no kind words to add a card with — edit its body whole with \`anydag item body\``);
  }

  if (a.from) {
    lineOf(it, a.from);
    if (fixed && !a.at) throw new UsageError("a hand-placed drawing needs --at x,y for the new card: the coordinate is the placement");
    const grown = grow(it.type, it.body, it.dir, a.from, { side: a.side ?? "e", edge: !fixed || a.edge === true, at: a.at });
    if (!grown) throw new UsageError(`\`${a.from}\` is not a card a new one can grow from`);
    let body = grown.body;
    let id = grown.id;
    if (a.id && a.id !== id) {
      if (declared({ ...it, body }).includes(a.id)) throw new UsageError(`${it.id} already declares \`${a.id}\``);
      body = renameId(body, id, a.id);
      id = a.id;
    }
    const props: Record<string, Value> = {};
    if (a.kind) props.kind = a.kind;
    if (a.title !== undefined) props.title = a.title;
    if (a.icon !== undefined) props.icon = a.icon;
    return { body: Object.keys(props).length ? setNodeBody({ ...it, body }, id, props) : body, id };
  }

  const kinds = kindsOf(it.type);
  if (!kinds.includes(a.kind)) {
    const close = suggestKind(a.kind, kinds);
    throw new UsageError(`${it.type} has no kind \`${a.kind}\`${close ? ` — did you mean \`${close}\`?` : ""} (${kinds.join(" · ")})`);
  }
  const id = a.id ?? freshNodeId(it.body, a.kind);
  if (declared(it).includes(id)) throw new UsageError(`${it.id} already declares \`${id}\``);
  let statement = [a.kind, id, a.title !== undefined ? JSON.stringify(a.title) : ""].filter(Boolean).join(" ");
  if (a.icon) statement = setModifier(statement, "icon", a.icon);
  if (a.at) statement = setGeometry(statement, a.at);

  const lines = it.body.split("\n");
  if (a.in) {
    const g = graphOf(it);
    if (!g?.groups.some((x) => x.id === a.in) && !g?.lanes.some((x) => x.id === a.in)) {
      throw new UsageError(`\`${a.in}\` is not a group or a lane in ${it.id}`);
    }
    const open = lineOf(it, a.in);
    const span = statementSpan(it.body, open);
    if (span.to === open) throw new UsageError(`\`${a.in}\` is written on one line; add to it with \`anydag item body\``);
    const inner = `${indentOf(lines[open - 1] ?? "")}  `;
    return { body: insertAfter(it.body, span.to - 1, `${inner}${statement}`), id };
  }
  /* After the last top-level declaration — ahead of the edges, where a person writing the board
     would put a new card. A body with none takes it at the top. */
  const g = graphOf(it);
  const tops = g ? [...g.nodes.filter((n) => !n.group && !n.lane), ...g.groups.filter((x) => !x.parent), ...g.lanes] : [];
  const last = Math.max(0, ...tops.map((d) => statementSpan(it.body, d.line).to));
  return { body: insertAfter(it.body, last, statement), id };
}

/** A line inserted after 1-based line `after` (0 is the top). */
function insertAfter(body: string, after: number, text: string): string {
  const lines = body.split("\n");
  return [...lines.slice(0, after), text, ...lines.slice(after)].join("\n");
}

export const removeNodeBody = (it: BoardItem, id: string): string => {
  lineOf(it, id);
  return removeNode(it.body, id, { type: it.type, dir: it.dir });
};

export function renameNodeBody(it: BoardItem, from: string, to: string): string {
  lineOf(it, from);
  if (!/^[A-Za-z_][\w-]*$/.test(to)) throw new UsageError(`\`${to}\` is not an id — letters, digits, \`_\` and \`-\``);
  const taken = new Set<string>();
  for (const t of tokenize(it.body, [])) if (t.kind === "word") taken.add(t.value);
  if (taken.has(to)) throw new UsageError(`\`${to}\` is already a word in ${it.id}`);
  return renameId(it.body, from, to);
}

export function dupNodeBody(it: BoardItem, id: string): { body: string; id: string } {
  lineOf(it, id);
  const copy = duplicateStatement(it.type, it.body, id, it.dir);
  if (!copy) throw new UsageError(`\`${id}\` cannot be copied`);
  return copy;
}

export type Where = { into: string } | { after: string } | { top: true } | { under: string };

/** A statement moved — into a group or lane, after a sibling, to the top — or a topic re-indented under another. */
export function moveNodeBody(it: BoardItem, id: string, where: Where): string {
  const line = lineOf(it, id);
  if ("under" in where) {
    if (it.type !== "mindmap") throw new UsageError("--under is a mindmap's: a topic goes under another topic");
    return moveTopic(it.body, line, lineOf(it, where.under));
  }
  if ("into" in where) return moveStatement(it.body, line, { intoBlockLine: lineOf(it, where.into) });
  if ("after" in where) return moveStatement(it.body, line, { afterLine: lineOf(it, where.after) });
  return moveStatement(it.body, line, { toTop: true });
}

/* ---- edges inside one diagram ----------------------------------------------------------------- */

const refText = (r: { node: string; row?: string }) => (r.row ? `${r.node}.${r.row}` : r.node);

/** An edge by its two ends as written (`api`, or `api.identity` for one leaving a row), or by the parser's id. */
export function edgeOf(it: BoardItem, from: string, to?: string): { line: number; seg: number } {
  const g = graphOf(it);
  if (!g) throw new UsageError(`${it.id} is a ${it.type}, whose arrows are not edges between cards`);
  const hits = to === undefined ? g.edges.filter((e) => e.id === from) : g.edges.filter((e) => refText(e.from) === from && refText(e.to) === to);
  if (hits.length === 0) throw new UsageError(`${it.id} has no edge ${to === undefined ? `\`${from}\`` : `${from} → ${to}`}`);
  if (hits.length > 1) {
    throw new UsageError(`${hits.length} edges run ${from} → ${to}; name one by its id followed by \`-\`: ${hits.map((e) => `\`${e.id} -\``).join(" or ")}`);
  }
  const at = edgeAt(it.type, it.body, it.dir, hits[0]!.id);
  if (!at) throw new UsageError(`could not find where ${hits[0]!.id} is written`);
  return at;
}

export function addEdgeBody(it: BoardItem, from: string, to: string, s: { label?: string; arrow?: string }): string {
  const g = graphOf(it);
  if (!g) throw new UsageError(`${it.id} is a ${it.type}, whose arrows are not edges between cards`);
  const arrow = s.arrow ?? "-->";
  if (!isArrow(arrow)) throw new UsageError(`\`${arrow}\` is not an arrow`);
  for (const end of [from, to]) {
    const head = end.split(".")[0]!;
    if (!declared(it).includes(head)) {
      const close = nearest(head, declared(it));
      throw new UsageError(`${it.id} declares no \`${head}\`${close ? ` — did you mean \`${close}\`?` : ""}`);
    }
  }
  return appendEdge(it.body, [from, arrow, to, s.label ? JSON.stringify(s.label) : ""].filter(Boolean).join(" "));
}

export function setEdgeBody(it: BoardItem, at: { line: number; seg: number }, props: Record<string, Value>): string {
  let line = it.body.split("\n")[at.line - 1] ?? "";
  for (const [key, v] of Object.entries(props)) {
    if (key === "label") line = setEdgeLabel(line, v === null ? null : String(v), at.seg);
    else if (key === "arrow") {
      if (typeof v !== "string" || !isArrow(v)) throw new UsageError(`\`${v}\` is not an arrow`);
      line = setEdgeArrow(line, v, at.seg);
    } else if (key === "hue") line = setEdgeHue(line, v === null ? null : hueOf(String(v)));
    else if (key === "quiet") line = setEdgeFlag(line, "quiet", v !== null);
    else throw new UsageError(`an edge has no \`${key}\` — label, arrow, hue, quiet`);
  }
  return replaceLine(it.body, at.line, line);
}

export const removeEdgeBody = (it: BoardItem, at: { line: number }): string => removeEdge(it.body, at.line);

/* ---- rows ------------------------------------------------------------------------------------- */

export function rowsOf(it: BoardItem, node: string): { line: number; text: string }[] {
  return rowLines(it.body, lineOf(it, node));
}

export const addRowBody = (it: BoardItem, node: string, text: string): string => addRow(it.body, lineOf(it, node), text);

function rowAt(it: BoardItem, node: string, n: number): number {
  const rows = rowsOf(it, node);
  const row = rows[n - 1];
  if (!row) throw new UsageError(`\`${node}\` has ${rows.length} row${rows.length === 1 ? "" : "s"} it can address; there is no row ${n}`);
  return row.line;
}

export const setRowBody = (it: BoardItem, node: string, n: number, text: string): string => setRow(it.body, rowAt(it, node, n), text);
export const removeRowBody = (it: BoardItem, node: string, n: number): string => removeRow(it.body, rowAt(it, node, n));

/* ---- a chart's own statements ----------------------------------------------------------------- */

/** The item view's chart controls: form, stacked, horizontal, legend, values, unit, min, max, categories. */
export function setChartBody(it: BoardItem, props: Record<string, Value>): string {
  if (it.type !== "chart") throw new UsageError(`${it.id} is a ${it.type}, not a chart`);
  let body = it.body;
  for (const [key, v] of Object.entries(props)) {
    if (key === "form") {
      if (typeof v !== "string" || !(FORMS as readonly string[]).includes(v)) throw new UsageError(`a form is one of ${FORMS.join(", ")}`);
      body = setChartForm(body, v as ChartForm);
    } else if (key === "stacked" || key === "horizontal") body = setChartFlag(body, key, v !== null);
    else if (key === "values") body = setChartOption(body, "values", v === null ? null : true);
    else if (key === "legend") {
      if (v !== null && !["none", "right", "bottom"].includes(String(v))) throw new UsageError("legend= is none, right or bottom");
      body = setChartOption(body, "legend", v === null ? null : String(v));
    } else if (key === "unit") body = setChartOption(body, "unit", v === null ? null : String(v));
    else if (key === "min" || key === "max") {
      if (v !== null && typeof v !== "number") throw new UsageError(`${key}= wants a number`);
      body = setChartOption(body, key, v);
    } else if (key === "categories") {
      const raw = v === null || v === true ? "" : String(v);
      body = setCategories(body, raw.includes(",") ? raw.split(",").map((s) => s.trim()).filter(Boolean) : raw.split(/\s+/).filter(Boolean));
    } else throw new UsageError(`a chart has no \`${key}\` — form, stacked, horizontal, legend, values, unit, min, max, categories`);
  }
  return body;
}

/* ---- listing ---------------------------------------------------------------------------------- */

export interface Listed {
  nodes: { id: string; kind: string; title: string; in?: string; line: number }[];
  edges: { id: string; from: string; to: string; label?: string; line: number }[];
}

/** What a diagram declares, in the terms the commands above take. */
export function listDiagram(it: BoardItem): Listed {
  if (it.type === "chart") {
    const m = parseChart(it.body);
    return {
      nodes: [
        ...m.series.map((s) => ({ id: s.id, kind: "series", title: s.title, line: s.line })),
        ...m.slices.map((s) => ({ id: s.id, kind: "slice", title: s.title, line: s.line })),
      ],
      edges: [],
    };
  }
  const g = graphOf(it);
  if (!g) return { nodes: [], edges: [] };
  return {
    nodes: [
      ...g.groups.map((x) => ({ id: x.id, kind: "group", title: x.label, in: x.parent, line: x.line })),
      ...g.lanes.map((x) => ({ id: x.id, kind: "lane", title: x.label, line: x.line })),
      ...g.nodes.map((n) => ({ id: n.id, kind: n.kind, title: n.title, in: n.group ?? n.lane, line: n.line })),
    ].sort((a, b) => a.line - b.line),
    edges: g.edges.map((e) => ({ id: e.id, from: refText(e.from), to: refText(e.to), label: e.label, line: e.line })),
  };
}
