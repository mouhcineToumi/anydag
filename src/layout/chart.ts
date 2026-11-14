import type { ChartModel, Series, Slice } from "@/dsl/chart";
import type { Hue } from "@/dsl/ir";
import type { Theme } from "@/theme/contract";

import { fontOf, type TextMeasurer } from "./measure";
import type { Bar, Box, ChartAxis, ChartLabel, ChartPlaced, ChartTick, HeroBox, LegendBox, LinePath, Wedge } from "./types";

/**
 * Chart layout: a scale, a run of rectangles, and an arc.
 *
 * The sixth layout of our own, and the first one that is not placing *things* — a bar is a value on
 * a scale, and where it goes is arithmetic rather than a packing problem. So this is synchronous on
 * the main thread like `layoutSequence`, and like every sizer here it reads no DOM: the left margin
 * is the widest tick label put through `measurer`, not a rect read back off the page.
 *
 * The contract with `ChartView` is that the view does no arithmetic. Every rectangle arrives with
 * an `x`, `y`, `w` and `h`; every wedge and every leader arrives as a `d`; every label knows its
 * anchor and which `theme.type.chart*` token it wears. What never arrives is a colour: `hues` names
 * one per series or slice and the view binds it, because a colour computed in a layout is a colour
 * the theme does not own.
 *
 * Three things here are worth knowing before changing any of it.
 *
 * **`horizontal` is a transposition, not a second chart.** One pair of mappers — `catAt` and
 * `valAt` — decide which screen axis carries the categories and which carries the scale, and every
 * bar, point, tick and label is written once in terms of those two. `xAxis` is whatever runs along
 * the bottom and `yAxis` whatever runs down the left, so the two swap roles rather than swapping
 * names.
 *
 * **The grid is snapped and the scale is not.** `metric.grid` is where the drawing's *chrome* lands
 * — the plot rectangle, the legend, the hero — because those are boxes on a board like any other.
 * A bar's cap is a *value*: snapping it to 8px is rounding the data, and it would break the one
 * invariant a stacked chart has, that a segment's top is the running sum. Arc endpoints are not
 * snapped either, for the same reason and more visibly.
 *
 * **A label that will not fit is dropped, never clipped.** Every label is *offered*, and `flush()`
 * places them lowest rank first — ticks, categories, the legend, the hero, and last of all a direct
 * value or a wedge's share — refusing any that would collide with one already placed. That is the
 * doctrine's rule ("never clip a label: measure first") turned into the mechanism that makes "no
 * two labels overlap" an invariant of the layout rather than a hope about the data.
 */

const TAU = Math.PI * 2;

/** 12 o'clock. A wedge starts here and the angle grows clockwise, y being down. */
const TOP = -Math.PI / 2;

/** Everything on the board lands on the same grid, however it was arrived at. */
const snap = (v: number, grid: number): number => Math.round(v / grid) * grid;

/** Two decimals: enough for a path nobody can see the end of, and stable across runs. */
const n2 = (v: number): number => Math.round(v * 100) / 100;

const hit = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 1-2-5: the three steps a reader adds up in their head without being told the interval. */
function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

/** Float noise out of a repeated addition: `0.1 · 3` is not `0.30000000000000004` on an axis. */
const clean = (v: number): number => (v === 0 ? 0 : Number(v.toPrecision(12)));

export interface ChartScale {
  lo: number;
  hi: number;
  ticks: number[];
}

/**
 * The value scale, and the ticks on it.
 *
 * A pinned end (`min` / `max` in the body) is kept exactly and the ticks fall inside it; an open end
 * is widened out to the next step, which is what puts a round number at the top of the plot. The
 * fixed-point loop is because widening the range can call for a bigger step, which widens it again.
 */
export function niceScale(lo: number, hi: number, maxTicks: number, pinLo: boolean, pinHi: boolean): ChartScale {
  /* The parser keeps every number within `CHART_LARGEST`, so a span that is not finite never comes
     from a board; were one handed in, the scale is a unit rather than a loop over `Infinity`. */
  if (!Number.isFinite(hi - lo)) [lo, hi] = [0, 1];
  if (!(hi > lo)) hi = lo + 1;
  const budget = Math.max(2, Math.floor(maxTicks));

  let start = lo;
  let end = hi;
  let step = 1;
  for (let guard = 0; guard < 8; guard++) {
    step = niceStep((end - start) / (budget - 1));
    const s = pinLo ? lo : Math.floor(lo / step) * step;
    const e = pinHi ? hi : Math.ceil(hi / step) * step;
    if (s === start && e === end) break;
    start = s;
    end = e;
  }
  if (!(end > start)) end = start + step;

  /* A pinned end that the step does not divide can leave one tick more than the budget. Widening
     the step is the only answer that keeps the ticks round. */
  let ticks: number[] = [];
  for (let guard = 0; guard < 8; guard++) {
    ticks = [];
    const first = Math.ceil(start / step - 1e-9) * step;
    /* Never more than one tick past the budget, which is enough to know to widen; and never a step
       too small to move a number this large, which leaves `v` where it was for ever (#9). */
    for (let v = first; v <= end + step * 1e-9 && ticks.length <= budget; v += step) {
      ticks.push(clean(v));
      if (v + step === v) break;
    }
    if (ticks.length <= budget) break;
    step = niceStep(step * 1.5);
  }
  return { lo: clean(start), hi: clean(end), ticks };
}

/**
 * A number a reader takes in at a glance: `1.2k`, `3.4M`, and no trailing zeros.
 *
 * The unit rides on the end rather than being formatted into the number, because `unit "k€"` is a
 * suffix the author wrote and not a magnitude this can reason about.
 */
function compact(v: number, unit?: string): string {
  const trim = (x: number, d: number): string => {
    const s = x.toFixed(d);
    return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
  };
  const abs = Math.abs(v);
  const head =
    abs >= 1e9 ? `${trim(v / 1e9, 1)}B` : abs >= 1e6 ? `${trim(v / 1e6, 1)}M` : abs >= 1e3 ? `${trim(v / 1e3, 1)}k` : trim(v, 2);
  return unit ? head + unit : head;
}

/** A series' total, gaps skipped — what it is worth as one wedge of a pie. */
const sumOf = (s: Series): number => s.values.reduce<number>((a, v) => a + (v ?? 0), 0);

const isSeries = (s: Series | Slice): s is Series => "values" in s;

export function layoutChart(model: ChartModel, box: { w: number; h: number }, theme: Theme, measurer: TextMeasurer): ChartPlaced {
  const c = theme.metric.chart;
  const grid = theme.metric.grid;

  const W = Math.max(c.padX * 2 + grid * 2, Math.round(box.w));
  const H = Math.max(c.padY * 2 + grid * 2, Math.round(box.h));

  const tickFont = fontOf(theme, theme.type.chartTick);
  const catFont = fontOf(theme, theme.type.chartLabel);
  const valueFont = fontOf(theme, theme.type.chartValue, 500);
  const legendFont = fontOf(theme, theme.type.chartLegend);
  const width = (text: string, font: string): number => measurer.width(text, font);
  const fmt = (v: number): string => compact(v, model.unit);

  /*
   * One list, in one order, for hues, for the legend, for the order bars sit in a group and for the
   * order wedges go round. `[...series, ...slices]` is the parser's own order in `W_CHART_MANY`, so
   * the hue a warning counts to and the hue drawn are the same hue. A chart carries one kind or the
   * other in practice, where the two orders coincide.
   */
  const identities: (Series | Slice)[] = [...model.series, ...model.slices];

  /*
   * Decision 5: the theme owns the order, the parser owns nothing.
   *
   * `i` counts only the ones nobody hued, so writing `hue=` on the second series does not shift the
   * third off its colour. Past the end of the list the answer is `null` — never a cycled hue, which
   * is two series a reader cannot tell apart, and never a generated one, which is a colour the theme
   * does not own. `W_CHART_MANY` has already said so on the parse.
   */
  const palette: readonly Hue[] = theme.color.chartHues ?? [];
  const hues: Record<string, Hue | null> = {};
  let auto = 0;
  for (const s of identities) {
    if (s.hue) {
      hues[s.id] = s.hue;
      continue;
    }
    hues[s.id] = auto < palette.length ? palette[auto]! : null;
    auto++;
  }

  const round = model.form === "pie" || model.form === "donut";

  /* The legend is a default about the data, not about the form: two or more things that need
     telling apart get one. In a bar or line chart that is the series (a slice is a category there
     and is labelled on the axis); in a pie every wedge is an identity of its own. */
  const legendIds = round ? identities : model.series;
  const legendAt = model.legendAt ?? (legendIds.length >= 2 ? "right" : "none");

  /**
   * Every label wants a rectangle, and the ones that cannot have theirs are dropped.
   *
   * A label is *offered* here and placed at the end, lowest rank first, so what survives a
   * collision is always the more load-bearing of the two. A tick label carries the scale and
   * outranks a category; a category outranks the legend, which the reader can still read on its
   * own; the hero outranks a direct value; and a wedge's share goes last, because a pie that has
   * lost one percentage is still a pie and a clipped one is not.
   *
   * "Never clip a label: measure first" is the doctrine's rule. This is the mechanism, and it is
   * what makes "no two labels overlap" an invariant of the layout rather than a hope about the data.
   */
  const RANK = { tick: 0, category: 1, legend: 2, hero: 3, heroLabel: 3, value: 4 } as const;
  const offered: { label: ChartLabel; font: string; lineH: number }[] = [];
  const offer = (label: ChartLabel, font: string, lineH = c.lineH): void => {
    if (label.text) offered.push({ label, font, lineH });
  };
  const labels: ChartLabel[] = [];
  const flush = (): void => {
    const taken: Box[] = [];
    for (const { label, font, lineH } of [...offered].sort((a, b) => RANK[a.label.token] - RANK[b.label.token])) {
      const w = width(label.text, font);
      const x = label.anchor === "middle" ? label.x - w / 2 : label.anchor === "end" ? label.x - w : label.x;
      const b: Box = { x, y: label.y - lineH / 2, w, h: lineH };
      if (taken.some((o) => hit(b, o))) continue;
      taken.push(b);
      labels.push(label);
    }
  };

  /* ---------------------------------------------------------------- the legend takes its side */

  const legendRows = legendIds.map((s) => ({ id: s.id, title: s.title, hue: hues[s.id] ?? null }));
  const legendTextW = legendRows.map((r) => width(r.title, legendFont));
  const cellW = (i: number): number => c.legendSwatch + c.legendGap + (legendTextW[i] ?? 0);

  let legendW = 0;
  let legendH = 0;
  if (legendAt === "right" && legendRows.length) {
    legendW = Math.min(c.legendCol, Math.max(...legendRows.map((_, i) => cellW(i))));
    legendH = legendRows.length * c.legendRowH;
  } else if (legendAt === "bottom" && legendRows.length) {
    const avail = W - c.padX * 2;
    let line = 0;
    let x = 0;
    for (let i = 0; i < legendRows.length; i++) {
      const need = cellW(i) + (x > 0 ? c.legendGap * 2 : 0);
      if (x > 0 && x + need > avail) {
        line++;
        x = cellW(i);
      } else {
        x += need;
      }
      legendW = Math.max(legendW, x);
    }
    legendH = (line + 1) * c.legendRowH;
  }

  const area: Box = {
    x: c.padX,
    y: c.padY,
    w: W - c.padX * 2 - (legendAt === "right" && legendW ? legendW + c.legendGap : 0),
    h: H - c.padY * 2 - (legendAt === "bottom" && legendH ? legendH + c.legendGap : 0),
  };
  area.w = Math.max(grid, area.w);
  area.h = Math.max(grid, area.h);

  /* ---------------------------------------------------------------- the data, read for this form */

  /*
   * The cross-form readings, in the two lines that are the whole of them.
   *
   * A `slice` in a bar or line chart is a category of its own with one value in it; a `series` in a
   * pie is one wedge worth its own total. Both are defined so the panel's Form select can never
   * produce an error against data that was already there — switching a bar of five slices to a pie
   * draws the same five numbers as five wedges.
   */
  const baseN = model.categories.length || model.series.reduce((most, s) => Math.max(most, s.values.length), 0);
  const catLabels: string[] = model.categories.length
    ? [...model.categories]
    : /* No `x` line: the categories are 1…n and drawn as blank ticks, which is what makes a line of
         twelve readings need no invented axis text. */
      new Array<string>(baseN).fill("");
  for (const s of model.slices) catLabels.push(s.title);
  const nCats = catLabels.length;

  const members = identities.map((s) => {
    const row = new Array<number | null>(nCats).fill(null);
    if (isSeries(s)) {
      for (let i = 0; i < baseN; i++) row[i] = s.values[i] ?? null;
    } else {
      row[baseN + model.slices.indexOf(s)] = s.value;
    }
    return { id: s.id, hue: hues[s.id] ?? null, row };
  });

  const bars: Bar[] = [];
  const lines: LinePath[] = [];
  const slices: Wedge[] = [];
  const gridAt: number[] = [];
  const nodes: Record<string, Box> = {};
  let xAxis: ChartAxis | undefined;
  let yAxis: ChartAxis | undefined;
  let hero: HeroBox | undefined;
  let plot: Box;

  const grow = (id: string, b: Box): void => {
    const was = nodes[id];
    if (!was) {
      nodes[id] = { ...b };
      return;
    }
    const x = Math.min(was.x, b.x);
    const y = Math.min(was.y, b.y);
    nodes[id] = { x, y, w: Math.max(was.x + was.w, b.x + b.w) - x, h: Math.max(was.y + was.h, b.y + b.h) - y };
  };

  if (!round) {
    /* ------------------------------------------------------------ bar and line */

    /* Zero is in the domain for every bar and for anything stacked, and for a line too unless the
       author pinned a `min` — which is the one way to say "this is a range, not a magnitude". */
    const seen: number[] = [];
    if (model.stacked) {
      for (let i = 0; i < nCats; i++) {
        let pos = 0;
        let neg = 0;
        for (const mem of members) {
          const v = mem.row[i];
          if (v === null || v === undefined) continue;
          if (v >= 0) pos += v;
          else neg += v;
        }
        seen.push(pos, neg);
      }
    } else {
      for (const mem of members) for (const v of mem.row) if (v !== null && v !== undefined) seen.push(v);
    }
    let dLo = seen.length ? Math.min(...seen) : 0;
    let dHi = seen.length ? Math.max(...seen) : 1;
    if (model.form === "bar" || model.stacked || model.min === undefined) {
      dLo = Math.min(dLo, 0);
      dHi = Math.max(dHi, 0);
    }
    if (model.min !== undefined) dLo = model.min;
    if (model.max !== undefined) dHi = model.max;
    const scale = niceScale(dLo, dHi, c.maxTicks, model.min !== undefined, model.max !== undefined);

    const tickTexts = scale.ticks.map(fmt);
    const tickW = tickTexts.length ? Math.max(...tickTexts.map((t) => width(t, tickFont))) : 0;
    const anyCat = catLabels.some((t) => t.length > 0);
    const catW = anyCat ? Math.max(...catLabels.map((t) => width(t, catFont))) : 0;

    /* The widest number that will be written beside a mark, which is the room `values` needs at the
       far end of a horizontal bar. Measured, not guessed: a clipped label is the anti-pattern. */
    const valueW = model.values && seen.length ? Math.max(...seen.map((v) => width(fmt(v), valueFont))) : 0;

    /* A tick label is as wide as it is; a category label is capped, because one long category must
       not eat the plot it labels. */
    const catCap = Math.floor(area.w * 0.4);

    const mLeft = model.horizontal
      ? anyCat
        ? Math.min(catW, catCap) + c.labelGap
        : 0
      : tickW
        ? tickW + c.tickGap + c.tickLen
        : 0;
    const mBottom = model.horizontal ? c.lineH + c.tickGap + c.tickLen : anyCat ? c.lineH + c.labelGap : 0;
    const mTop = !model.horizontal && model.values ? c.lineH + c.valueGap : 0;
    const mRight = model.horizontal && model.values ? valueW + c.valueGap : 0;

    plot = {
      x: Math.ceil((area.x + mLeft) / grid) * grid,
      y: Math.ceil((area.y + mTop) / grid) * grid,
      w: Math.max(grid, Math.floor((area.w - mLeft - mRight) / grid) * grid),
      h: Math.max(grid, Math.floor((area.h - mTop - mBottom) / grid) * grid),
    };

    const span = scale.hi - scale.lo || 1;
    /*
     * 0 at the scale's floor, 1 at its ceiling — the one mapping both axes are written in terms of,
     * and the clamp is what keeps a mark inside the plot when the author pinned a scale that does
     * not cover the data. `max 100` with a 500 in the series is a *decision*, not a mistake, and a
     * bar drawn four hundred pixels out of the frame is not what it asked for.
     */
    const t = (v: number): number => (Math.min(Math.max(v, scale.lo), scale.hi) - scale.lo) / span;
    const valAt = (v: number): number => (model.horizontal ? plot.x + t(v) * plot.w : plot.y + plot.h - t(v) * plot.h);
    const band = nCats > 0 ? (model.horizontal ? plot.h : plot.w) / nCats : 0;
    const catAt = (i: number): number => (model.horizontal ? plot.y : plot.x) + (i + 0.5) * band;
    const zero = valAt(Math.min(Math.max(0, scale.lo), scale.hi));

    /* The two axes, by role rather than by name: whichever carries the scale is the value axis, and
       `horizontal` is the whole of what decides which side of the plot it is drawn on. */
    const valueTicks: ChartTick[] = scale.ticks.map((v, i) => {
      const at = valAt(v);
      return model.horizontal
        ? { x: at, label: tickTexts[i]!, major: v === 0, x1: at, y1: plot.y + plot.h, x2: at, y2: plot.y + plot.h + c.tickLen }
        : { x: at, label: tickTexts[i]!, major: v === 0, x1: plot.x - c.tickLen, y1: at, x2: plot.x, y2: at };
    });
    const catTicks: ChartTick[] = catLabels.map((label, i) => {
      const at = catAt(i);
      return model.horizontal
        ? { x: at, label, major: false, x1: plot.x - c.tickLen, y1: at, x2: plot.x, y2: at }
        : { x: at, label, major: false, x1: at, y1: plot.y + plot.h, x2: at, y2: plot.y + plot.h + c.tickLen };
    });

    const valueAxis: ChartAxis = model.horizontal
      ? {
          side: "bottom",
          kind: "value",
          x1: plot.x,
          y1: plot.y + plot.h,
          x2: plot.x + plot.w,
          y2: plot.y + plot.h,
          ticks: valueTicks,
        }
      : { side: "left", kind: "value", x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.h, ticks: valueTicks };
    const catAxis: ChartAxis = model.horizontal
      ? { side: "left", kind: "category", x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.h, ticks: catTicks }
      : {
          side: "bottom",
          kind: "category",
          x1: plot.x,
          y1: plot.y + plot.h,
          x2: plot.x + plot.w,
          y2: plot.y + plot.h,
          ticks: catTicks,
        };
    xAxis = model.horizontal ? valueAxis : catAxis;
    yAxis = model.horizontal ? catAxis : valueAxis;
    for (const tk of valueTicks) gridAt.push(tk.x);

    for (const tk of valueTicks) {
      offer(
        model.horizontal
          ? { x: tk.x, y: plot.y + plot.h + c.tickLen + c.tickGap + c.lineH / 2, text: tk.label, anchor: "middle", token: "tick" }
          : { x: plot.x - c.tickLen - c.tickGap, y: tk.x, text: tk.label, anchor: "end", token: "tick" },
        tickFont,
      );
    }
    for (const tk of catTicks) {
      offer(
        model.horizontal
          ? { x: plot.x - c.labelGap, y: tk.x, text: tk.label, anchor: "end", token: "category" }
          : { x: tk.x, y: plot.y + plot.h + c.labelGap + c.lineH / 2, text: tk.label, anchor: "middle", token: "category" },
        catFont,
      );
    }

    /* ---- the marks ---- */

    const drawnAt = (i: number) => members.filter((mem) => mem.row[i] !== null && mem.row[i] !== undefined);
    const kMax = Math.max(1, ...Array.from({ length: nCats }, (_, i) => drawnAt(i).length));
    const inner = Math.max(1, band - c.groupGap);
    const slotW = model.stacked
      ? Math.max(1, Math.min(c.barMaxW, inner))
      : Math.max(1, Math.min(c.barMaxW, (inner - (kMax - 1) * c.barGap) / kMax));

    /* Collected inside the mark loops and offered in one place at the end, so the bar branch and the
       line branch read the same. Which of them survives a collision is `flush()`'s business, not
       this list's — a value ranks below everything else wherever it was offered from. */
    const valueLabels: { label: ChartLabel; font: string }[] = [];

    if (model.form === "bar") {
      for (let i = 0; i < nCats; i++) {
        const drawn = drawnAt(i);
        if (drawn.length === 0) continue;

        if (model.stacked) {
          const mid = catAt(i);
          const near = mid - slotW / 2;
          let pos = 0;
          let neg = 0;
          /* The last non-null member in this category is the cap: only the cap is rounded, and only
             at the data end. Everything under it is square on both sides. */
          const lastPos = drawn.filter((mem) => (mem.row[i] ?? 0) >= 0).at(-1)?.id;
          const lastNeg = drawn.filter((mem) => (mem.row[i] ?? 0) < 0).at(-1)?.id;
          let first = true;
          for (const mem of drawn) {
            const v = mem.row[i]!;
            const from = v >= 0 ? pos : neg;
            const to = from + v;
            if (v >= 0) pos = to;
            else neg = to;
            const a = valAt(from);
            const b = valAt(to);
            /* A paper gap between touching fills, taken off the *near* end so the far end — the one
               the reader reads the running sum off — stays exactly on the scale. */
            const gap = first ? 0 : c.fillGap;
            first = false;
            const cap = mem.id === (v >= 0 ? lastPos : lastNeg);
            const bar: Bar = model.horizontal
              ? {
                  x: Math.min(a, b) + (b >= a ? gap : 0),
                  y: near,
                  w: Math.max(0, Math.abs(b - a) - gap),
                  h: slotW,
                  id: mem.id,
                  hue: mem.hue,
                  cat: i,
                  value: v,
                  r: 0,
                  round: cap ? (v >= 0 ? "right" : "left") : "none",
                }
              : {
                  x: near,
                  y: Math.min(a, b) + (b <= a ? 0 : gap),
                  w: slotW,
                  h: Math.max(0, Math.abs(b - a) - gap),
                  id: mem.id,
                  hue: mem.hue,
                  cat: i,
                  value: v,
                  r: 0,
                  round: cap ? (v >= 0 ? "top" : "bottom") : "none",
                };
            bar.r = bar.round === "none" ? 0 : Math.min(c.barRadius, slotW / 2, model.horizontal ? bar.w : bar.h);
            bars.push(bar);
            grow(mem.id, bar);
          }
          if (model.values) {
            const total = pos + neg;
            const end = valAt(total);
            valueLabels.push({
              label: model.horizontal
                ? { x: end + c.valueGap, y: mid, text: fmt(total), anchor: "start", token: "value" }
                : { x: mid, y: end - c.valueGap - c.lineH / 2, text: fmt(total), anchor: "middle", token: "value" },
              font: valueFont,
            });
          }
          continue;
        }

        const total = drawn.length * slotW + (drawn.length - 1) * c.barGap;
        const start = catAt(i) - total / 2;
        drawn.forEach((mem, j) => {
          const v = mem.row[i]!;
          const near = start + j * (slotW + c.barGap);
          const end = valAt(v);
          const bar: Bar = model.horizontal
            ? {
                x: Math.min(zero, end),
                y: near,
                w: Math.abs(end - zero),
                h: slotW,
                id: mem.id,
                hue: mem.hue,
                cat: i,
                value: v,
                r: 0,
                round: v >= 0 ? "right" : "left",
              }
            : {
                x: near,
                y: Math.min(zero, end),
                w: slotW,
                h: Math.abs(end - zero),
                id: mem.id,
                hue: mem.hue,
                cat: i,
                value: v,
                r: 0,
                round: v >= 0 ? "top" : "bottom",
              };
          bar.r = Math.min(c.barRadius, slotW / 2, model.horizontal ? bar.w : bar.h);
          bars.push(bar);
          grow(mem.id, bar);
          if (model.values) {
            valueLabels.push({
              label: model.horizontal
                ? {
                    x: end + (v >= 0 ? c.valueGap : -c.valueGap),
                    y: near + slotW / 2,
                    text: fmt(v),
                    anchor: v >= 0 ? "start" : "end",
                    token: "value",
                    of: mem.id,
                  }
                : {
                    x: near + slotW / 2,
                    y: end + (v >= 0 ? -(c.valueGap + c.lineH / 2) : c.valueGap + c.lineH / 2),
                    text: fmt(v),
                    anchor: "middle",
                    token: "value",
                    of: mem.id,
                  },
              font: valueFont,
            });
          }
        });
      }
    } else {
      for (const mem of members) {
        const points: LinePath["points"] = [];
        const runs: string[] = [];
        let run: string[] = [];
        let at: { x: number; y: number } | null = null;
        /* A run of one is drawn as a zero-length line rather than a lone `M`, which paints nothing:
           with a round cap that is a dot, so an isolated reading between two gaps is still visible
           on a series with too many points for markers. */
        const close = (): void => {
          if (run.length === 1 && at) run.push(`L ${n2(at.x)} ${n2(at.y)}`);
          if (run.length) runs.push(run.join(" "));
          run = [];
          at = null;
        };
        for (let i = 0; i < nCats; i++) {
          const v = mem.row[i];
          if (v === null || v === undefined) {
            /* A `-` is a gap, and a gap is a new `M`: a line drawn straight across a missing
               reading is a reading nobody took, asserted. */
            close();
            continue;
          }
          const along = catAt(i);
          const across = valAt(v);
          const p = model.horizontal ? { x: across, y: along } : { x: along, y: across };
          points.push({ ...p, cat: i, value: v });
          run.push(`${run.length ? "L" : "M"} ${n2(p.x)} ${n2(p.y)}`);
          at = p;
        }
        close();
        if (points.length === 0) continue;
        const markers = points.length <= c.markerMax ? points.map((p) => ({ x: p.x, y: p.y })) : [];
        lines.push({ id: mem.id, hue: mem.hue, d: runs.join(" "), markers, points });
        /* The box is the marks, which for a line is the stroke and whatever ring sits on it. */
        const pad = Math.max(c.lineW / 2, markers.length ? c.markerR + c.markerRing : 0);
        for (const p of points) grow(mem.id, { x: p.x - pad, y: p.y - pad, w: pad * 2, h: pad * 2 });
        if (model.values) {
          for (const p of points) {
            valueLabels.push({
              label: model.horizontal
                ? { x: p.x + c.valueGap + pad, y: p.y, text: fmt(p.value), anchor: "start", token: "value", of: mem.id }
                : {
                    x: p.x,
                    y: p.y - pad - c.valueGap - c.lineH / 2,
                    text: fmt(p.value),
                    anchor: "middle",
                    token: "value",
                    of: mem.id,
                  },
              font: valueFont,
            });
          }
        }
      }
    }

    for (const { label, font } of valueLabels) offer(label, font);
  } else {
    /* ------------------------------------------------------------ pie and donut */

    plot = {
      x: Math.ceil(area.x / grid) * grid,
      y: Math.ceil(area.y / grid) * grid,
      w: Math.max(grid, Math.floor(area.w / grid) * grid),
      h: Math.max(grid, Math.floor(area.h / grid) * grid),
    };
    const cx = plot.x + plot.w / 2;
    const cy = plot.y + plot.h / 2;

    const parts = identities.map((s) => ({
      id: s.id,
      title: s.title,
      hue: hues[s.id] ?? null,
      value: Math.max(0, isSeries(s) ? sumOf(s) : (s.value ?? 0)),
    }));
    const total = parts.reduce((a, p) => a + p.value, 0);

    const point = (a: number, r: number): { x: number; y: number } => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    const textOf = (p: { title: string; value: number }, pct: number, outside: boolean): string => {
      const head = model.values ? fmt(p.value) : `${Math.round(pct * 100)}%`;
      /* Outside on a leader there is room, and a line pointing at a bare number is a puzzle. */
      return outside && p.title ? `${p.title} ${head}` : head;
    };

    const fits = (r: number, span: number): boolean => {
      const innerR = model.form === "donut" ? r * c.donutInner : 0;
      return c.lineH <= (r - innerR) * 0.9 && span >= Math.PI / 6;
    };

    /*
     * How much room the labels that go *outside* need, at this radius.
     *
     * Measured over those slices alone, and re-measured each pass. Taking the widest label on the
     * chart would let one 6% sliver — whose own label is `Other 6%` — shrink the pie by the width
     * of the longest *name* on it, and a pie small enough to leave room for a label nobody is
     * drawing is the same defect as a clipped one, arrived at from the other side.
     */
    const outsideW = (r: number): number => {
      let widest = 0;
      for (const p of parts) {
        const pct = total ? p.value / total : 0;
        if (pct < c.minLabelPct || fits(r, pct * TAU)) continue;
        widest = Math.max(widest, width(textOf(p, pct, true), valueFont));
      }
      return widest;
    };

    /* Passes, because whether a label goes outside depends on the radius and the radius has to
       leave room for the ones that do — and shrinking it can push one more out. Three is enough and
       terminates; iterating to a fixed point would wobble a pixel either way for nothing a reader
       can see. */
    let R = Math.max(grid, Math.min(plot.w, plot.h) / 2);
    for (let pass = 0; pass < 3 && total > 0; pass++) {
      const need = outsideW(R);
      const reserveX = need ? c.leader * 2 + c.tickGap + need : 0;
      const reserveY = need ? c.leader + c.lineH : 0;
      const next = Math.max(grid, Math.min(plot.w / 2 - reserveX, plot.h / 2 - reserveY));
      if (Math.abs(next - R) < 0.5) break;
      R = next;
    }
    const innerR = model.form === "donut" ? R * c.donutInner : 0;

    let cursor = 0;
    for (const p of parts) {
      if (total <= 0) break;
      const pct = p.value / total;
      const a0 = TOP + cursor * TAU;
      const a1 = TOP + (cursor + pct) * TAU;
      cursor += pct;
      if (pct <= 0) continue;

      /* The gap between wedges is a paper stroke, so it is a *distance* at the rim turned into an
         angle — a fixed angle would open a hairline crack on a big wedge and swallow a small one. */
      const gapA = Math.min((a1 - a0) / 4, Math.max(1e-4, c.sliceGap / 2 / Math.max(R, 1)));
      const s = a0 + gapA;
      const e = a1 - gapA;
      const large = e - s > Math.PI ? 1 : 0;
      const o0 = point(s, R);
      const o1 = point(e, R);
      const d =
        model.form === "donut"
          ? (() => {
              const i1 = point(e, innerR);
              const i0 = point(s, innerR);
              return `M ${n2(o0.x)} ${n2(o0.y)} A ${n2(R)} ${n2(R)} 0 ${large} 1 ${n2(o1.x)} ${n2(o1.y)} L ${n2(i1.x)} ${n2(i1.y)} A ${n2(innerR)} ${n2(innerR)} 0 ${large} 0 ${n2(i0.x)} ${n2(i0.y)} Z`;
            })()
          : `M ${n2(cx)} ${n2(cy)} L ${n2(o0.x)} ${n2(o0.y)} A ${n2(R)} ${n2(R)} 0 ${large} 1 ${n2(o1.x)} ${n2(o1.y)} Z`;

      const wedge: Wedge = { id: p.id, hue: p.hue, d, a0, a1, value: p.value, pct };

      const mid = (a0 + a1) / 2;
      if (pct >= c.minLabelPct) {
        const inside = fits(R, a1 - a0);
        if (inside) {
          const at = point(mid, (innerR + R) / 2);
          offer({ x: at.x, y: at.y, text: textOf(p, pct, false), anchor: "middle", token: "value", of: p.id }, valueFont);
        } else {
          const a = point(mid, R);
          const b = point(mid, R + c.leader);
          const dir = Math.cos(mid) >= 0 ? 1 : -1;
          const tipX = b.x + dir * c.leader;
          wedge.leader = `M ${n2(a.x)} ${n2(a.y)} L ${n2(b.x)} ${n2(b.y)} L ${n2(tipX)} ${n2(b.y)}`;
          offer(
            {
              x: tipX + dir * c.tickGap,
              y: b.y,
              text: textOf(p, pct, true),
              anchor: dir > 0 ? "start" : "end",
              token: "value",
              of: p.id,
            },
            valueFont,
          );
        }
      }

      slices.push(wedge);
      grow(p.id, arcBox(cx, cy, innerR, R, a0, a1));
    }

    /*
     * The hero, sized to fit the hole.
     *
     * Donut only: a pie has no hole, and a number printed over the wedges is a number sitting on
     * the data it is summarising. `type.chartHero` is the ceiling — the doctrine's 48px floor is the
     * theme's figure — and the shrink is the only place a font size is computed here, because how
     * much room a hole has is a fact about *this* chart and not a look.
     */
    if (model.hero && model.form === "donut") {
      const holeW = innerR * 2 * 0.9;
      const holeH = innerR * 2 * 0.9;
      const base = theme.type.chartHero;
      const at = width(model.hero.value, fontOf(theme, base, 600));
      let size = at > 0 ? Math.min(base, (holeW / at) * base) : base;
      const labelSize = model.hero.label ? theme.type.chartHeroLabel : undefined;
      const need = size + (labelSize ? c.heroGap + labelSize : 0);
      if (need > holeH) size = Math.max(theme.type.chartHeroLabel, size - (need - holeH));
      size = Math.round(size * 2) / 2;
      const stack = size + (labelSize ? c.heroGap + labelSize : 0);
      const y = cy - stack / 2 + size / 2;
      hero = { x: cx, y, size, labelSize };
      offer({ x: cx, y, text: model.hero.value, anchor: "middle", token: "hero", size }, fontOf(theme, size, 600), size);
      if (labelSize && model.hero.label) {
        offer(
          { x: cx, y: y + size / 2 + c.heroGap + labelSize / 2, text: model.hero.label, anchor: "middle", token: "heroLabel" },
          fontOf(theme, labelSize),
          labelSize,
        );
      }
    }
  }

  /* ---------------------------------------------------------------- the legend, placed and labelled */

  let legend: LegendBox | undefined;
  if (legendRows.length && legendW && legendH) {
    const swatchY = (rowTop: number): number => rowTop + (c.legendRowH - c.legendSwatch) / 2;
    if (legendAt === "right") {
      const x = snap(area.x + area.w + c.legendGap, grid);
      const y = snap(Math.max(area.y, area.y + (area.h - legendH) / 2), grid);
      legend = {
        x,
        y,
        w: legendW,
        h: legendH,
        at: "right",
        rows: legendRows.map((r, i) => ({
          id: r.id,
          hue: r.hue,
          swatch: { x, y: swatchY(y + i * c.legendRowH), w: c.legendSwatch, h: c.legendSwatch },
        })),
      };
    } else {
      const y = snap(area.y + area.h + c.legendGap, grid);
      const x = snap(area.x, grid);
      const avail = W - c.padX * 2;
      const rows: LegendBox["rows"] = [];
      let line = 0;
      let cur = 0;
      for (let i = 0; i < legendRows.length; i++) {
        const need = cellW(i) + (cur > 0 ? c.legendGap * 2 : 0);
        if (cur > 0 && cur + need > avail) {
          line++;
          cur = 0;
        } else if (cur > 0) {
          cur += c.legendGap * 2;
        }
        const rowTop = y + line * c.legendRowH;
        rows.push({
          id: legendRows[i]!.id,
          hue: legendRows[i]!.hue,
          swatch: { x: x + cur, y: swatchY(rowTop), w: c.legendSwatch, h: c.legendSwatch },
        });
        cur += cellW(i);
      }
      legend = { x, y, w: legendW, h: legendH, at: "bottom", rows };
    }
    legend.rows.forEach((r, i) => {
      offer(
        {
          x: r.swatch.x + c.legendSwatch + c.legendGap,
          y: r.swatch.y + c.legendSwatch / 2,
          text: legendRows[i]!.title,
          anchor: "start",
          token: "legend",
          of: r.id,
        },
        legendFont,
      );
    });
  }

  flush();

  return {
    kind: "chart",
    size: { w: W, h: H },
    plot,
    nodes,
    bars,
    lines,
    slices,
    xAxis,
    yAxis,
    grid: gridAt,
    legend,
    hero,
    labels,
    hues,
  };
}

/**
 * The bounding box of an annulus sector.
 *
 * The four corners are not enough: a wedge spanning 3 o'clock reaches further right than either of
 * its ends does, so every cardinal direction inside the span is a candidate too. A board link ends
 * on this box, and a box that stops short of the wedge it names is a line pointing at nothing.
 */
function arcBox(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (a: number, r: number): void => {
    xs.push(cx + Math.cos(a) * r);
    ys.push(cy + Math.sin(a) * r);
  };
  for (const a of [a0, a1]) {
    add(a, r0);
    add(a, r1);
  }
  for (let k = -2; k <= 6; k++) {
    const a = (k * Math.PI) / 2;
    if (a >= a0 && a <= a1) add(a, r1);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
