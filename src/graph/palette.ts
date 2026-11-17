/**
 * Which colour each value of a field is drawn in, as a **slot**: an index into `SLOT_TOKENS`, a
 * list of theme token names. A slot is never a colour — the renderer resolves the tokens of the
 * theme it draws in (`--dag-color-<token>`), so a theme change re-colours nothing here.
 *
 * A value's own hue when it has one (a tag's, a project's), else the ten theme hues (`HUE_ORDER`)
 * handed out from the commonest value down, skipping the hues values already own; the rest slate,
 * and "none" muted. No field is known by name: the page may hand its own hues for a field's values
 * (`own`), which is how it colours kinds.
 *
 * Pure: no DOM, no React, no `@/` alias.
 */
import { HUE_ORDER, type Hue } from "../dsl/ir";
import { type Graph, type Shown, standingValue } from "./model";
import type { GraphView } from "./view";

/** Slot `i` is drawn in `--dag-color-<SLOT_TOKENS[i]>`: slate, muted, then the ten hues in `HUE_ORDER`. */
export const SLOT_TOKENS: readonly string[] = ["slate", "muted", ...HUE_ORDER.map((h) => `hues-${h}`)];
export const SLOT_SLATE = 0;
export const SLOT_MUTED = 1;

/** The slot of one of the ten hues; slate for a name the theme does not own. */
export const slotOfHue = (hue: Hue): number => {
  const i = HUE_ORDER.indexOf(hue);
  return i < 0 ? SLOT_SLATE : 2 + i;
};

/** One field's colours. */
export interface Palette {
  field: string;
  /** Each value's slot. */
  slots: Uint8Array;
  /** The slot of a document with no value. */
  none: number;
  /** How many of the graph's documents carry each value, and none. */
  counts: Int32Array;
  noneCount: number;
  /** The values, commonest first (ties in the field's order): the order a legend lists them in. */
  order: Int32Array;
}

/**
 * The palette of field `key` over the whole graph — so filtering does not re-colour what stays — or
 * `null` when the graph has no such field. `own` gives values a hue by key, over the wire's.
 */
export function paletteOf(graph: Graph, key: string, own?: ReadonlyMap<string, Hue>): Palette | null {
  const f = graph.field.get(key);
  if (!f) return null;
  const counts = new Int32Array(f.values.length);
  let noneCount = 0;
  for (let i = 0; i < graph.n; i++) {
    if (f.of) {
      const v = f.of[i]!;
      if (v < 0) noneCount++;
      else counts[v]!++;
      continue;
    }
    const s = f.start![i]!;
    const e = f.start![i + 1]!;
    if (s === e) noneCount++;
    for (let k = s; k < e; k++) counts[f.items![k]!]!++;
  }
  const order = Int32Array.from(f.values, (_, v) => v).sort((a, b) => counts[b]! - counts[a]! || a - b);
  const slots = new Uint8Array(f.values.length);
  const hueOf = (v: number): Hue | null | undefined => own?.get(f.values[v]!.key) ?? f.values[v]!.hue;
  const taken = new Set<Hue>();
  for (let v = 0; v < f.values.length; v++) {
    const h = hueOf(v);
    if (h) taken.add(h);
  }
  const free = HUE_ORDER.filter((h) => !taken.has(h));
  let next = 0;
  for (const v of order) {
    const h = hueOf(v);
    slots[v] = h ? slotOfHue(h) : next < free.length ? slotOfHue(free[next++]!) : SLOT_SLATE;
  }
  return { field: f.key, slots, none: SLOT_MUTED, counts, noneCount, order };
}

/** The slot of each shown document: its value's (`standingValue`), or the palette's "none". */
export function slotsOf(graph: Graph, s: Shown, palette: Palette): Uint8Array {
  const out = new Uint8Array(s.n);
  const f = graph.field.get(palette.field);
  if (!f) return out.fill(palette.none);
  for (let i = 0; i < s.n; i++) {
    const v = standingValue(f, s.rules, s.from[i]!);
    out[i] = v < 0 ? palette.none : palette.slots[v]!;
  }
  return out;
}

/** The palette a view colours by, and each shown document's slot; `null` when the graph has no such field. */
export function colours(graph: Graph, s: Shown, view: GraphView, own?: ReadonlyMap<string, Hue>) {
  const palette = paletteOf(graph, view.colourBy, own);
  return palette ? { palette, slots: slotsOf(graph, s, palette) } : null;
}
