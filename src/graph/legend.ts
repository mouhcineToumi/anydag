/**
 * The Graph page's legend, which **is** the filter (#459): the values of the field the graph is
 * coloured by, with their counts and whether each is shown, and the edits a press on one makes to the
 * view's rules. And the chips: a rule on a field the legend is not showing stays in force, and says
 * so where it can be taken off.
 *
 * Every edit returns a new `GraphView` and names values by key, never by index, so what is
 * remembered still means the same after the vault moved. No field is known here by name.
 *
 * Pure: no DOM, no React, no `@/` alias.
 */
import { covers, type Graph, type Field } from "./model";
import { paletteOf, type Palette } from "./palette";
import { NONE, type GraphRule, type GraphView } from "./view";

/** One line of the legend. `key` is `NONE` for the documents with no value. */
export interface LegendRow {
  key: string;
  label: string;
  /** The palette slot its dot is drawn in. */
  slot: number;
  /** How many of the vault's documents have it, whatever is shown. */
  count: number;
  /** Whether the rules on this field let it through. */
  shown: boolean;
}

/** One rule on a field the legend is not showing: what the chip says. */
export interface Chip {
  field: string;
  label: string;
  /** How many of the field's values (and "none", when some document has none) it lets through. */
  shown: number;
  total: number;
}

/** Whether every rule on `field` lets value `key` through — the model's semantics, one value at a time. */
function lets(field: Pick<Field, "tree">, rules: readonly GraphRule[], key: string): boolean {
  for (const r of rules) {
    const hit = (k: string) => (key === NONE ? k === NONE : covers(field, k, key));
    if (r.only && !r.only.some(hit)) return false;
    if (r.hide?.some(hit)) return false;
  }
  return true;
}

const rulesOn = (view: GraphView, field: string) => view.rules.filter((r) => r.field === field);

/** The legend's keys for a field, in the legend's order: commonest first, then "none" if any document has none. */
function keysOf(f: Field, p: Palette): string[] {
  const out = Array.from(p.order, (v) => f.values[v]!.key);
  if (p.noneCount > 0) out.push(NONE);
  return out;
}

/** The legend for the field `palette` colours by, or `[]` when the graph has no such field. */
export function legendOf(graph: Graph, view: GraphView, palette: Palette): LegendRow[] {
  const f = graph.field.get(palette.field);
  if (!f) return [];
  const rules = rulesOn(view, f.key);
  const rows: LegendRow[] = Array.from(palette.order, (v) => ({
    key: f.values[v]!.key,
    label: f.values[v]!.label,
    slot: palette.slots[v]!,
    count: palette.counts[v]!,
    shown: lets(f, rules, f.values[v]!.key),
  }));
  if (palette.noneCount > 0)
    rows.push({ key: NONE, label: f.none, slot: palette.none, count: palette.noneCount, shown: lets(f, rules, NONE) });
  return rows;
}

/**
 * The view with field `field`'s rules replaced by `rule`. A rule that lets every value through, or
 * none of them, is dropped: a filter that hides everything shows everything, rather than an empty
 * page nobody asked for.
 */
function withRule(view: GraphView, f: Field, every: readonly string[], rule: GraphRule): GraphView {
  const hide = [...new Set(rule.hide ?? [])];
  const only = rule.only ? [...new Set(rule.only)] : undefined;
  const clean: GraphRule = { field: f.key, ...(hide.length ? { hide } : {}), ...(only ? { only } : {}) };
  const passing = every.filter((k) => lets(f, [clean], k)).length;
  const others = view.rules.filter((r) => r.field !== f.key);
  const keep = passing > 0 && passing < every.length;
  return { ...view, rules: keep ? [...others, clean] : others };
}

/** One rule standing for every rule `view` has on a field: the values all of them hide, and what all of them keep. */
function merged(view: GraphView, f: Field, every: readonly string[]): { hide: string[]; only?: string[] } {
  const rules = rulesOn(view, f.key);
  const hide = rules.flatMap((r) => r.hide ?? []);
  if (!rules.some((r) => r.only)) return { hide };
  /* Several `only`s are one: the keys that pass them all. */
  return {
    hide,
    only: every.filter((k) => rules.every((r) => !r.only || r.only.some((o) => (k === NONE ? o === NONE : covers(f, o, k))))),
  };
}

function fieldAndKeys(graph: Graph, field: string): { f: Field; every: string[] } | null {
  const f = graph.field.get(field);
  const p = f ? paletteOf(graph, field) : null;
  return f && p ? { f, every: keysOf(f, p) } : null;
}

/**
 * A press on a legend line: the value is hidden if it was shown, shown if it was hidden. A rule that
 * was an *Only* stays one, so a value the vault gains later is still left out; any other stays a
 * list of what is hidden, so one gained later is shown.
 */
export function toggleValue(graph: Graph, view: GraphView, field: string, key: string): GraphView {
  const got = fieldAndKeys(graph, field);
  if (!got) return view;
  const { f, every } = got;
  const rule = merged(view, f, every);
  const hit = (k: string) => (key === NONE ? k === NONE : covers(f, k, key));
  if (lets(f, rulesOn(view, f.key), key)) {
    if (rule.only) rule.only = rule.only.filter((k) => k !== key);
    if (lets(f, [{ field, ...rule }], key)) rule.hide.push(key);
  } else {
    rule.hide = rule.hide.filter((k) => !hit(k));
    if (rule.only && !rule.only.some(hit)) rule.only.push(key);
  }
  return withRule(view, f, every, { field, ...rule });
}

/** *Only*: just this value of the field — or, pressed on the one value already alone, every value again. */
export function onlyValue(graph: Graph, view: GraphView, field: string, key: string): GraphView {
  const got = fieldAndKeys(graph, field);
  if (!got) return view;
  const { f, every } = got;
  const rules = rulesOn(view, f.key);
  const alone = every.filter((k) => lets(f, rules, k));
  if (alone.length === 1 && alone[0] === key) return { ...view, rules: view.rules.filter((r) => r.field !== f.key) };
  return withRule(view, f, every, { field, only: [key] });
}

/** Every rule on `field` taken off: what a chip's press does. */
export const dropRules = (view: GraphView, field: string): GraphView => ({
  ...view,
  rules: view.rules.filter((r) => r.field !== field),
});

/** A chip for each field with a rule that the legend is not showing and that leaves something out, in the order the rules were made. */
export function chipsOf(graph: Graph, view: GraphView): Chip[] {
  const out: Chip[] = [];
  const seen = new Set<string>([view.colourBy]);
  for (const r of view.rules) {
    if (seen.has(r.field)) continue;
    seen.add(r.field);
    const got = fieldAndKeys(graph, r.field);
    if (!got) continue;
    const rules = rulesOn(view, r.field);
    const shown = got.every.filter((k) => lets(got.f, rules, k)).length;
    /* A rule that leaves out no value this vault has (the default's hidden attachments, in a
       vault with none) is kept for the day it has one, but there is nothing yet to take off. */
    if (shown === got.every.length) continue;
    out.push({ field: r.field, label: got.f.label, shown, total: got.every.length });
  }
  return out;
}

/** How many of the vault's documents have no link at all: what *Files with no links* counts. */
export function orphansOf(graph: Graph): number {
  let n = 0;
  for (let i = 0; i < graph.n; i++) if (graph.degree[i] === 0) n++;
  return n;
}
