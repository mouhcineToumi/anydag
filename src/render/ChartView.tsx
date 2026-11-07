import type { CSSProperties } from "react";

import type { Hue } from "@/dsl/ir";
import type { Bar, ChartAxis, ChartLabel, ChartPlaced } from "@/layout/types";
import type { Theme } from "@/theme/contract";

import { hueVars } from "./hue";

/**
 * The chart view: one `<svg>`, and no arithmetic in it.
 *
 * `layoutChart` is the contract — every rectangle arrives with an `x`, `y`, `w` and `h`, every wedge
 * and every leader as a `d`, every label with its anchor and the `theme.type.chart*` token it wears.
 * So this file is a translation and not a second layout, which is what keeps the two from disagreeing
 * about where a bar is. The only geometry written here is `barPath()`, and only because SVG has no
 * way to round one side of a `<rect>`.
 *
 * Five things about it are load-bearing.
 *
 * **No colour and no length reaches an attribute.** Every stroke, fill and font size is a class in
 * `nodes.css` reading a `--dag-*`; the two attributes that are numbers — a marker's `r` and a
 * swatch's `rx` — are expressions over `theme.metric`. A hue is bound by `hueVars()` on the group
 * that owns the marks and read back as `var(--dag-h, …)` by the class, so a series past the end of
 * `color.chartHues` binds nothing and `dag-chart--other` gives it the theme's `muted`. That is the
 * M6 rule ("a hue is bound, never defaulted in a component") applied to a fourteenth type.
 *
 * **Text never wears the series colour.** A tick is `muted`, a category and a legend row `slate`, a
 * value and the hero `ink`. A value label drawn *inside* a wedge sits on a saturated fill, so it
 * carries the same `paint-order: stroke` halo an edge label has carried since M6 — the surface
 * painted out from under the text rather than a second colour invented for the occasion.
 *
 * **The gap between two touching fills is the layout's, never a stroke.** A stacked segment is
 * already `fillGap` short at its near end and a wedge is already inset by `sliceGap` at the rim, so
 * a paper stroke on top of either would draw the gap twice.
 *
 * **The marks of one series or slice are one `<g data-dag-node>`, and the labels are not in it.**
 * SVG has no z-index, so the only way a wedge's own percentage stays on top of the wedge next to it
 * is to draw every label after every mark. The group is therefore the marks alone, which is also
 * exactly what `placed.nodes` says its box is. The cost is that a name is drawn outside the element
 * that carries its id, which is why the label wears `data-dag-title-of` — everywhere else on the
 * board `Rename` finds a title by looking *inside* the picked thing.
 *
 * **A `clipPath` id is per item, not per module.** Two charts on one board would otherwise define
 * the same id and every `url(#…)` on the page would resolve to the first one's element — the same
 * defect `replaceIDs()` exists to stop for icons. The id is built from the *item's* id rather than
 * from `useId()` so that it is stable across renders, exports and screenshots.
 */

/** A rectangle with a radius on one side only: the data end of a bar, square at the baseline. */
function barPath(b: Bar): string {
  const r = Math.max(0, Math.min(b.r, b.w / 2, b.h / 2));
  const tl = b.round === "top" || b.round === "left" ? r : 0;
  const tr = b.round === "top" || b.round === "right" ? r : 0;
  const br = b.round === "bottom" || b.round === "right" ? r : 0;
  const bl = b.round === "bottom" || b.round === "left" ? r : 0;
  const { x, y, w, h } = b;
  return (
    `M ${x + tl} ${y}` +
    ` H ${x + w - tr}` +
    (tr ? ` A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr}` : "") +
    ` V ${y + h - br}` +
    (br ? ` A ${br} ${br} 0 0 1 ${x + w - br} ${y + h}` : "") +
    ` H ${x + bl}` +
    (bl ? ` A ${bl} ${bl} 0 0 1 ${x} ${y + h - bl}` : "") +
    ` V ${y + tl}` +
    (tl ? ` A ${tl} ${tl} 0 0 1 ${x + tl} ${y}` : "") +
    " Z"
  );
}

/** The hue, or the theme's `muted` when the palette ran out. Never a generated colour. */
const hueOf = (hue: Hue | null): { className: string; style: CSSProperties } =>
  hue ? { className: "", style: hueVars(hue) } : { className: " dag-chart--other", style: {} };

function AxisLine({ axis }: { axis: ChartAxis }) {
  return (
    <g className="dag-chart__axis">
      <path d={`M ${axis.x1} ${axis.y1} L ${axis.x2} ${axis.y2}`} />
      {axis.ticks.map((t, i) => (
        <path key={i} d={`M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`} />
      ))}
    </g>
  );
}

export function ChartView({ placed, theme, id }: { placed: ChartPlaced; theme: Theme; id: string }) {
  const c = theme.metric.chart;
  const { w, h } = placed.size;

  /* One namespace per item, so two charts on a board cannot share a `clipPath`. */
  const uid = `dag-chart-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`;

  /*
   * Which screen axis the scale runs along — the whole of what `horizontal` means to this file.
   * `grid` is one number per gridline, perpendicular to the axis that produced it, so a value axis
   * along the bottom makes each entry an x and the rule spans the plot's height.
   */
  const valueOnX = placed.xAxis?.kind === "value";

  const bars = new Map<string, Bar[]>();
  for (const b of placed.bars) {
    const run = bars.get(b.id);
    if (run) run.push(b);
    else bars.set(b.id, [b]);
  }
  const lines = new Map(placed.lines.map((l) => [l.id, l]));
  const wedges = new Map(placed.slices.map((s) => [s.id, s]));

  /* Declaration order: `hues` is built by the layout over `[...series, ...slices]`, which is the
     order bars sit in a group, wedges go round and legend rows stack. */
  const order = Object.keys(placed.hues);

  const rightLegend = placed.legend?.at === "right";
  const legendRow = new Map(placed.legend?.rows.map((r, i) => [r.id, i]) ?? []);

  const label = (l: ChartLabel, i: number) => {
    const clip = l.token === "legend" && rightLegend && l.of !== undefined ? legendRow.get(l.of) : undefined;
    /* The one label that is drawn on top of a fill: a wedge's share, when it fitted inside. A leader
       means it went outside, onto the paper, where a halo would be a stroke around nothing. */
    const wedge = l.token === "value" && l.of !== undefined ? wedges.get(l.of) : undefined;
    const onMark = wedge !== undefined && !wedge.leader;
    /*
     * Whether this label is the *name* of a series or a slice — a legend row, or the share written
     * on a wedge, which is the only text a pie draws for one.
     *
     * `data-dag-title` says "this is the text"; `data-dag-title-of` says whose, and it has to,
     * because the labels are drawn after every mark and are therefore **not inside** the `<g>`
     * carrying the id. Everywhere else on the board a title span sits within its own card and
     * `Rename` finds it by nesting; here nesting would put a wedge's own share under the wedge
     * next to it, since SVG has no z-index. So the id travels on the label instead.
     */
    const names = l.of !== undefined && (l.token === "legend" || wedge !== undefined) ? l.of : null;
    const text = (
      <text
        className={`dag-chart__text dag-chart__text--${l.token}${onMark ? " dag-chart__text--on-mark" : ""}`}
        x={l.x}
        y={l.y}
        textAnchor={l.anchor}
        /* The hero is the one size the layout computes, because how much room a hole has is a fact
           about this chart rather than a look. Everything else is a class over `theme.type`. */
        style={l.size ? { fontSize: l.size } : undefined}
        {...(names ? { "data-dag-title": "", "data-dag-title-of": names } : null)}
      >
        {l.text}
      </text>
    );
    /* The legend column caps the *space*, not the text (`legendCol`), so a name longer than the
       column is cut rather than allowed to run out over the plot. Only the right-hand column caps
       anything: a legend along the bottom wraps to a second row instead. */
    return clip === undefined ? (
      <g key={i}>{text}</g>
    ) : (
      <g key={i} clipPath={`url(#${uid}-lg-${clip})`}>
        {text}
      </g>
    );
  };

  /* No `aria-hidden` and no `role="img"`, unlike the edge and axis layers: this one *is* the
     content, and its `<text>` is the only place a reader without the picture has to go. */
  return (
    <svg className="dag-chart" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {rightLegend && placed.legend ? (
        <defs>
          {placed.legend.rows.map((r, i) => (
            <clipPath key={i} id={`${uid}-lg-${i}`}>
              <rect
                x={r.swatch.x + c.legendSwatch + c.legendGap}
                y={r.swatch.y + c.legendSwatch / 2 - c.lineH / 2}
                width={Math.max(0, c.legendCol - c.legendSwatch - c.legendGap)}
                height={c.lineH}
              />
            </clipPath>
          ))}
        </defs>
      ) : null}

      {/* A solid hairline, one step off the surface and recessive: never dashed, never heavy. */}
      <g className="dag-chart__grid">
        {placed.grid.map((g, i) => (
          <path
            key={i}
            d={
              valueOnX
                ? `M ${g} ${placed.plot.y} L ${g} ${placed.plot.y + placed.plot.h}`
                : `M ${placed.plot.x} ${g} L ${placed.plot.x + placed.plot.w} ${g}`
            }
          />
        ))}
      </g>

      {placed.yAxis ? <AxisLine axis={placed.yAxis} /> : null}
      {placed.xAxis ? <AxisLine axis={placed.xAxis} /> : null}

      {order.map((seriesId) => {
        const hue = hueOf(placed.hues[seriesId] ?? null);
        const rects = bars.get(seriesId) ?? [];
        const line = lines.get(seriesId);
        const slice = wedges.get(seriesId);
        if (!rects.length && !line && !slice) return null;
        return (
          <g
            key={seriesId}
            data-dag-node={seriesId}
            /* What is *drawn*, which is what this layer knows: a `slice` statement in a bar chart
               is a bar, and a `series` in a pie is a wedge. The statement's own word is the
               parser's, and the panel reads it from there. */
            data-dag-kind={slice ? "slice" : "series"}
            className={`dag-chart__marks${hue.className}`}
            style={hue.style}
          >
            {rects.map((b, i) =>
              b.r > 0 && b.round !== "none" ? (
                <path key={i} className="dag-chart__bar" d={barPath(b)} />
              ) : (
                <rect key={i} className="dag-chart__bar" x={b.x} y={b.y} width={b.w} height={b.h} />
              ),
            )}
            {line ? <path className="dag-chart__line" d={line.d} /> : null}
            {line?.markers.map((p, i) => (
              <circle key={i} className="dag-chart__marker" cx={p.x} cy={p.y} r={c.markerR} />
            ))}
            {slice ? <path className="dag-chart__wedge" d={slice.d} /> : null}
            {slice?.leader ? <path className="dag-chart__leader" d={slice.leader} /> : null}
          </g>
        );
      })}

      {placed.legend?.rows.map((r) => {
        const hue = hueOf(r.hue);
        return (
          <rect
            key={r.id}
            className={`dag-chart__swatch${hue.className}`}
            style={hue.style}
            x={r.swatch.x}
            y={r.swatch.y}
            width={r.swatch.w}
            height={r.swatch.h}
            rx={theme.metric.radius.small}
          />
        );
      })}

      {/* Last, all of it: a wedge's own share has to sit over the wedge beside it, and SVG paints
          in document order. */}
      <g className="dag-chart__labels">{placed.labels.map(label)}</g>
    </svg>
  );
}
