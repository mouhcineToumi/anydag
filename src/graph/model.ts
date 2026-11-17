/**
 * The graph view's model (#457): `GET /__board/graph`'s answer read into typed arrays, and what a
 * view (`view.ts`) makes of it — the shown subgraph, and the group of each shown document. The
 * colours are `palette.ts`'s. See `docs/architecture/graph.md`.
 *
 * **No field is known here by name.** A rule, a colouring and a grouping each name a field by its
 * key, and this reads whatever field that is through its type (`one` or `many`) and whether it is a
 * `tree`. A field the server adds later works here unchanged.
 *
 * **No object per document**: every per-document answer is a typed array, so a vault of 50,000
 * costs a few arrays rather than 50,000 objects for the collector.
 *
 * Pure: no DOM, no React, no `@/` alias — unit-tested in Node.
 */
import type { GraphField, GraphValue, GraphWire } from "./wire";
import { GRAPH_WIRE_VERSION } from "./wire";
import { GROUP_BY_LINKS, NONE, type GraphRule, type GraphView } from "./view";

/** A field, read: its values indexed by key, and its columns as typed arrays. */
export interface Field {
  key: string;
  label: string;
  none: string;
  type: "one" | "many";
  tree: boolean;
  values: readonly GraphValue[];
  /** A value's index by its key. */
  index: ReadonlyMap<string, number>;
  /** Type `one`: the value of each document, `-1` for none. */
  of: Int32Array | null;
  /** Type `many`: document `i`'s values are `items[start[i]] … items[start[i + 1] - 1]`. */
  start: Int32Array | null;
  items: Int32Array | null;
}

/** The whole vault as a graph. Documents are `0 … n - 1`, in the wire's (name) order. */
export interface Graph {
  n: number;
  ids: readonly string[];
  names: readonly string[];
  /** `null`: the last part of the name. */
  titles: readonly (string | null)[];
  /** Link `k` joins `src[k]` and `dst[k]`. */
  src: Int32Array;
  dst: Int32Array;
  /** Each document's links in the whole vault, whatever is shown. */
  degree: Int32Array;
  fields: readonly Field[];
  /** A field by its key. */
  field: ReadonlyMap<string, Field>;
}

/** An answer this page cannot read: a newer server. */
export class GraphVersion extends Error {}

const ints = (a: readonly number[] | undefined, length: number, fill: number): Int32Array => {
  const out = new Int32Array(length).fill(fill);
  if (a) out.set(a.length > length ? a.slice(0, length) : a);
  return out;
};

function fieldOf(f: GraphField, n: number): Field {
  const values = f.values;
  const index = new Map(values.map((v, i) => [v.key, i]));
  const head = { key: f.key, label: f.label, none: f.none, type: f.type, tree: f.tree === true, values, index };
  if (f.type === "one") {
    const of = ints(f.of, n, -1);
    for (let i = 0; i < n; i++) if (of[i]! >= values.length) of[i] = -1;
    return { ...head, of, start: null, items: null };
  }
  /* A malformed CSR is read as nobody having a value, rather than as an index out of range. */
  const ok = f.start?.length === n + 1 && f.items !== undefined && f.start[n] === f.items.length;
  const start = ok ? Int32Array.from(f.start!) : new Int32Array(n + 1);
  const items = ok ? Int32Array.from(f.items!) : new Int32Array(0);
  return { ...head, of: null, start, items };
}

/** The wire as typed arrays. A pair naming a document that is not there is dropped. */
export function read(wire: GraphWire): Graph {
  if (wire.v !== GRAPH_WIRE_VERSION) throw new GraphVersion(`graph answer version ${String(wire.v)}`);
  const n = wire.ids.length;
  const pairs = wire.links;
  let m = 0;
  const src = new Int32Array(pairs.length >> 1);
  const dst = new Int32Array(pairs.length >> 1);
  const degree = new Int32Array(n);
  for (let k = 0; k + 1 < pairs.length; k += 2) {
    const a = pairs[k]!;
    const b = pairs[k + 1]!;
    if (!(a >= 0 && a < n && b >= 0 && b < n) || a === b) continue;
    src[m] = a;
    dst[m] = b;
    degree[a]!++;
    degree[b]!++;
    m++;
  }
  const fields = wire.fields.map((f) => fieldOf(f, n));
  return {
    n,
    ids: wire.ids,
    names: wire.names,
    titles: wire.titles,
    src: src.slice(0, m),
    dst: dst.slice(0, m),
    degree,
    fields,
    field: new Map(fields.map((f) => [f.key, f])),
  };
}

/* ------------------------------------------------------------------------------------------ rules */

/** One rule compiled against its field: which values pass, and whether "none" does. */
export interface Allow {
  field: Field;
  /** `1` for each value the rule lets through. */
  ok: Uint8Array;
  none: boolean;
}

/** Whether a rule's key names value `v`: itself, or on a `tree` field anything under it. */
export const covers = (field: Pick<Field, "tree">, key: string, v: string): boolean =>
  key !== NONE && (v === key || (field.tree && v.startsWith(`${key}/`)));

function allowOf(field: Field, rule: GraphRule): Allow {
  const ok = new Uint8Array(field.values.length);
  const only = rule.only;
  const hide = rule.hide ?? [];
  field.values.forEach((v, i) => {
    const kept = only ? only.some((k) => covers(field, k, v.key)) : true;
    ok[i] = kept && !hide.some((k) => covers(field, k, v.key)) ? 1 : 0;
  });
  const none = (only ? only.includes(NONE) : true) && !hide.includes(NONE);
  return { field, ok, none };
}

/** A view's rules compiled against the graph. A rule on a field the graph does not have is passed over. */
function allows(graph: Graph, rules: readonly GraphRule[]): Allow[] {
  const out: Allow[] = [];
  for (const rule of rules) {
    const field = graph.field.get(rule.field);
    if (field) out.push(allowOf(field, rule));
  }
  return out;
}

/** Whether document `i` passes one compiled rule: at least one of its values is let through. */
function passesOne(a: Allow, i: number): boolean {
  const f = a.field;
  if (f.of) {
    const v = f.of[i]!;
    return v < 0 ? a.none : a.ok[v] === 1;
  }
  const s = f.start![i]!;
  const e = f.start![i + 1]!;
  if (s === e) return a.none;
  for (let k = s; k < e; k++) if (a.ok[f.items![k]!] === 1) return true;
  return false;
}

/** Whether document `i` passes every rule. */
function passes(compiled: readonly Allow[], i: number): boolean {
  for (const a of compiled) if (!passesOne(a, i)) return false;
  return true;
}

/**
 * The value that stands for document `i` in field `f` — what it is coloured and grouped by — or
 * `-1`. For a `many` field it is the first of its values every rule on that field lets through, so
 * a document tagged `#draft` and `#idea` with `#draft` hidden is an `#idea`; else its first.
 */
export function standingValue(f: Field, compiled: readonly Allow[], i: number): number {
  if (f.of) return f.of[i]!;
  const s = f.start![i]!;
  const e = f.start![i + 1]!;
  if (s === e) return -1;
  outer: for (let k = s; k < e; k++) {
    const v = f.items![k]!;
    for (const a of compiled) if (a.field === f && a.ok[v] !== 1) continue outer;
    return v;
  }
  return f.items![s]!;
}

/* ------------------------------------------------------------------------------------------ shown */

/** What a view shows of the graph: a subgraph with its own numbering, and the way back. */
export interface Shown {
  n: number;
  m: number;
  /** The graph's document for each shown one. */
  from: Int32Array;
  /** The shown index of each of the graph's documents, `-1` when it is not shown. */
  index: Int32Array;
  /** Shown link `k` joins shown documents `src[k]` and `dst[k]`. */
  src: Int32Array;
  dst: Int32Array;
  /** Links among what is shown. */
  degree: Int32Array;
  /** Adjacency as CSR: shown document `i`'s neighbours are `near[start[i]] … near[start[i + 1] - 1]`. */
  start: Int32Array;
  near: Int32Array;
  /** The shown documents, most links first, then in name order. */
  byDegree: Int32Array;
  /** The view's rules, compiled, for `standingValue`. */
  rules: readonly Allow[];
}

/** The visible subgraph: the documents every rule passes (and, without orphans, that have a link), in name order. */
export function shown(graph: Graph, view: GraphView): Shown {
  const rules = allows(graph, view.rules);
  const index = new Int32Array(graph.n).fill(-1);
  let n = 0;
  for (let i = 0; i < graph.n; i++) {
    if ((view.orphans || graph.degree[i]! > 0) && passes(rules, i)) index[i] = n++;
  }
  const from = new Int32Array(n);
  for (let i = 0; i < graph.n; i++) if (index[i]! >= 0) from[index[i]!] = i;
  let m = 0;
  for (let k = 0; k < graph.src.length; k++) if (index[graph.src[k]!]! >= 0 && index[graph.dst[k]!]! >= 0) m++;
  const src = new Int32Array(m);
  const dst = new Int32Array(m);
  const degree = new Int32Array(n);
  for (let k = 0, j = 0; k < graph.src.length; k++) {
    const a = index[graph.src[k]!]!;
    const b = index[graph.dst[k]!]!;
    if (a < 0 || b < 0) continue;
    src[j] = a;
    dst[j] = b;
    degree[a]!++;
    degree[b]!++;
    j++;
  }
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i]! + degree[i]!;
  const near = new Int32Array(2 * m);
  const fill = start.slice(0, n);
  for (let k = 0; k < m; k++) {
    near[fill[src[k]!]!++] = dst[k]!;
    near[fill[dst[k]!]!++] = src[k]!;
  }
  const byDegree = new Int32Array(n);
  for (let i = 0; i < n; i++) byDegree[i] = i;
  byDegree.sort((a, b) => degree[b]! - degree[a]! || a - b);
  return { n, m, from, index, src, dst, degree, start, near, byDegree, rules };
}

/* ----------------------------------------------------------------------------------------- groups */

/** The group of each shown document by one field's value. */
export interface Groups {
  /** The field grouped by. */
  by: string;
  /** Each shown document's group, `-1` for none; group `0` is the biggest. */
  of: Int32Array;
  count: number;
  /** How many shown documents each group holds. */
  sizes: Int32Array;
  /** Each group's value key and label. */
  keys: readonly string[];
  names: readonly string[];
}

/**
 * The shown documents grouped by `view.groupBy`'s field, numbered from the biggest group down (ties in
 * the field's own order). `null` for no grouping, for a field the graph does not have, and for
 * `GROUP_BY_LINKS`, whose clusters are found from the links (`clusters.ts`, #458).
 */
export function groupsOf(graph: Graph, s: Shown, view: GraphView): Groups | null {
  if (view.groupBy === null || view.groupBy === GROUP_BY_LINKS) return null;
  const f = graph.field.get(view.groupBy);
  if (!f) return null;
  const raw = new Int32Array(s.n);
  const size = new Int32Array(f.values.length);
  for (let i = 0; i < s.n; i++) {
    const v = standingValue(f, s.rules, s.from[i]!);
    raw[i] = v;
    if (v >= 0) size[v]!++;
  }
  const used: number[] = [];
  for (let v = 0; v < f.values.length; v++) if (size[v]! > 0) used.push(v);
  used.sort((a, b) => size[b]! - size[a]! || a - b);
  const group = new Int32Array(f.values.length).fill(-1);
  used.forEach((v, g) => {
    group[v] = g;
  });
  const of = new Int32Array(s.n);
  for (let i = 0; i < s.n; i++) of[i] = raw[i]! < 0 ? -1 : group[raw[i]!]!;
  return {
    by: f.key,
    of,
    count: used.length,
    sizes: Int32Array.from(used, (v) => size[v]!),
    keys: used.map((v) => f.values[v]!.key),
    names: used.map((v) => f.values[v]!.label),
  };
}
