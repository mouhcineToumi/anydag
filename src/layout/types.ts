import type { Hue, Marker, ShapeKind } from "@/dsl/ir";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A node inside an item, as the board layer sees it.
 *
 * The flag is the whole reason this is not a `Box`. A board-level link may be routed *into* a
 * diagram, and there the same rule holds as inside one: a card is an obstacle and a boundary is
 * scenery. Without it a group's box walls off everything it contains, and a link asked to reach a
 * card in a group has nowhere to go — it gives up and draws straight through the cards instead.
 */
export interface InnerBox extends Box {
  group?: boolean;
  /** A geometric shape rather than a card: a board link ends on its outline, not on this box. */
  shape?: ShapeKind;
  /** A hull of its own, relative to this box — a `figure`'s picture and caption. */
  hull?: { x: number; y: number }[];
}

export interface MarkerAt {
  kind: Marker;
  x: number;
  y: number;
  /** Radians; 0 points along +x. The renderer rotates one shape rather than storing four. */
  angle: number;
  /** What the shape sits on, so a hollow triangle can be filled with it and read as hollow. */
  surface: "paper" | "group" | "card";
}

interface EdgeLabel {
  x: number;
  y: number;
  text: string;
  text2?: string;
  anchor: "middle" | "start" | "end";
  surface: "paper" | "group";
  /** Real data rather than prose — a path, an id, a status code. Set mono. */
  mono?: boolean;
}

export interface RoutedEdge {
  id: string;
  d: string;
  hue?: Hue;
  dash: boolean;
  quiet: boolean;
  danger: boolean;
  head?: MarkerAt;
  tail?: MarkerAt;
  label?: EdgeLabel;
  /**
   * Halfway along the line as it is actually drawn — where a board link's bend handle goes, and
   * where a bend that does not exist yet starts from.
   *
   * Read off the spine rather than worked out from the two endpoints, because those two answers
   * differ by the whole of the bow on every edge on the board, and a handle that is not on its own
   * line is a handle nobody can find. It is on every routed edge because the middle of a line is a
   * fact about it; only `BoardEdges` has any use for one, since a fixed point inside a diagram is
   * a claim the next relayout would make false.
   */
  mid?: { x: number; y: number };
  /** Where a bus trunk meets its drop, drawn as a dot. */
  junction?: { x: number; y: number };
}

export interface PlacedGroup extends Box {
  id: string;
  level: number;
  /**
   * A span rather than a container: drawn as a thin bar with its label inside.
   *
   * A timeline section is a stretch of time, not a box around things. Drawn full height, three
   * sections merge into one continuous tint and their labels sit on top of each other.
   */
  strip?: boolean;
}

/** A tick on a timeline's axis. */
export interface AxisTick {
  x: number;
  label: string;
  major: boolean;
}

/**
 * The date scale, in the three numbers that invert it: `x = ((t − min) / span) · px`.
 *
 * Nothing draws these — `Axis` needs the ticks and the baseline and no more. They are here because
 * a timeline is the one dialect where a drag along the page means a *value*, and reading a date
 * back off a dropped card is impossible without the mapping that put it there. Recomputing it in
 * the editor would be a second copy of `layoutTimeline`'s arithmetic and a second chance to
 * disagree with what the reader can see.
 */
interface AxisScale {
  /** Epoch ms at x = 0. */
  min: number;
  /** Milliseconds across the whole scale. */
  span: number;
  /** Pixels the span is drawn across — the width less the widest card, which is its own margin. */
  px: number;
}

export interface Placed {
  kind: "graph";
  size: { w: number; h: number };
  nodes: Record<string, Box>;
  /** Absolute y of each row's centre — where a port-anchored edge leaves. */
  rows: Record<string, Record<string, number>>;
  groups: PlacedGroup[];
  lanes: (Box & { id: string; labelY: number })[];
  edges: RoutedEdge[];
  /** Timelines only: the date scale drawn under the entries, and the mapping that produced it. */
  axis?: { y: number; ticks: AxisTick[]; scale: AxisScale };
  /**
   * Fixed layouts only: where the file's coordinates put the drawing's top-left, which the layout
   * moved to `0,0` so the frame hugs it. A top-level box at `x` here is `x + origin.x` in the file.
   */
  origin?: { x: number; y: number };
  /** The nodes whose words are cut off by the box they were given, which `Q_TEXT_CLIPPED` names. */
  clipped?: string[];
}

export interface SeqPlaced {
  kind: "sequence";
  size: { w: number; h: number };
  participants: Record<string, Box>;
  lifelines: { id: string; x: number; y0: number; y1: number }[];
  activations: { x: number; y0: number; y1: number; hue?: string }[];
  messages: RoutedEdge[];
  fragments: {
    box: Box;
    /** y of each `else` / `and` rule inside the box. */
    dividers: number[];
    tabs: { y: number; kind: string; text: string }[];
    /** A note is a fragment box with no operator — one tab, no dividers. */
    note?: boolean;
  }[];
}

/* ------------------------------------------------------------------ charts */

/**
 * Which type token and colour role a piece of chart text wears — **a name, never a size**.
 *
 * The layout says what a label *is* and the view looks the size up in `theme.type.chart*`. A number
 * here would be a length computed outside the theme, which is the one thing `check-literals.mjs`
 * exists to stop; the hero is the single exception and it carries `size` for the reason written
 * there.
 */
type ChartToken = "tick" | "value" | "legend" | "hero" | "heroLabel" | "category";

/** One piece of text on a chart, ready to draw. */
export interface ChartLabel {
  x: number;
  /**
   * The **centre** of the line, not its baseline.
   *
   * A centre is what the layout can reason about — every label is placed against a bar's cap, a
   * tick's y or a wedge's mid-angle, and none of those know a font's ascent. The view draws with
   * `dominant-baseline: central`, which is the same claim spelled in CSS.
   */
  y: number;
  text: string;
  anchor: "start" | "middle" | "end";
  token: ChartToken;
  /** The series or slice it names, when it names one — a legend row, a value, a wedge's share. */
  of?: string;
  /** Only the hero has one: shrunk to fit the hole, which is a fact about this chart, not a look. */
  size?: number;
}

/** A tick, and the mark drawn for it. `x` is the position *along* the axis, as on a timeline. */
export interface ChartTick extends AxisTick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * One of a chart's two axes.
 *
 * `side` is where it is drawn and `kind` is what it carries, and the pair is what makes `horizontal`
 * a transposition rather than a second code path: a vertical bar chart has its value axis on the
 * left and its categories along the bottom, a horizontal one has exactly the opposite.
 */
export interface ChartAxis {
  side: "bottom" | "left";
  /** `value` carries the scale and the gridlines; `category` carries one tick per band. */
  kind: "value" | "category";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ticks: ChartTick[];
}

/** One rectangle of a bar chart: a grouped bar, or one segment of a stacked one. */
export interface Bar extends Box {
  /** The series or slice it belongs to. */
  id: string;
  hue: Hue | null;
  /** Which category band it stands in. */
  cat: number;
  value: number;
  /** The corner radius, already clamped so a thin bar is not a blob. */
  r: number;
  /** Which end is rounded — the data end only, square at the baseline; `none` mid-stack. */
  round: "top" | "bottom" | "left" | "right" | "none";
}

/** One series of a line chart. */
export interface LinePath {
  id: string;
  hue: Hue | null;
  /** One `M…L…` run per unbroken stretch: a `-` in the data opens the next one. */
  d: string;
  /** Where a marker is drawn. Empty when the series has more points than `metric.chart.markerMax`. */
  markers: { x: number; y: number }[];
  /** Every plotted point, gaps skipped — what a value label and the series' box are measured from. */
  points: { x: number; y: number; cat: number; value: number }[];
}

/** One wedge of a pie or a donut. */
export interface Wedge {
  id: string;
  hue: Hue | null;
  d: string;
  /** Radians. 0 is 12 o'clock and the angle grows clockwise, which is the order they are declared in. */
  a0: number;
  a1: number;
  value: number;
  /** Its share of the whole, 0–1 — the percentage its label states. */
  pct: number;
  /** The elbow out to a label that did not fit inside the wedge. */
  leader?: string;
}

/** The legend: a column down the right, or a row along the bottom. Its text is in `labels`. */
export interface LegendBox extends Box {
  at: "right" | "bottom";
  rows: { id: string; hue: Hue | null; swatch: Box }[];
}

/** The number in the hole of a donut. Its text is in `labels`, wearing these sizes. */
export interface HeroBox {
  /** Centre of the hole. */
  x: number;
  /** Centre of the value's own line — the pair is centred in the hole, label included. */
  y: number;
  size: number;
  labelSize?: number;
}

/**
 * A laid-out chart: geometry only, with every number the view needs already in it.
 *
 * The contract is that `ChartView` does no arithmetic. Every rect has an `x`, `y`, `w` and `h`;
 * every wedge and every leader is a `d` string; every label knows where it goes, what it says and
 * which token it wears. What is *not* here is any colour: `hues` names a hue per series or slice
 * and the view binds it through `hueVars()`, because a colour in a layout is a colour outside the
 * theme.
 */
export interface ChartPlaced {
  kind: "chart";
  size: { w: number; h: number };
  /** The data rectangle, inside the margins the axes and the legend took. */
  plot: Box;
  /** The bounding box of each series' marks, or of each wedge — what a board link lands on. */
  nodes: Record<string, Box>;
  bars: Bar[];
  lines: LinePath[];
  slices: Wedge[];
  /** The axis along the bottom, whichever of the two it is. */
  xAxis?: ChartAxis;
  /** The axis down the left. */
  yAxis?: ChartAxis;
  /**
   * Where each gridline crosses the value axis.
   *
   * A single number because a gridline is perpendicular to the axis that gave it: with `yAxis.kind
   * === "value"` each entry is a y and the rule spans the plot's width, and transposed it is an x.
   */
  grid: number[];
  legend?: LegendBox;
  hero?: HeroBox;
  labels: ChartLabel[];
  /** `null` past the end of `color.chartHues` — the theme's `muted`, never a generated colour. */
  hues: Record<string, Hue | null>;
}

export type Layout = Placed | SeqPlaced | ChartPlaced;

/** What the worker is handed: the graph plus every size the main thread measured. */
export interface SizedNode {
  w: number;
  h: number;
  /** Row centre offsets from the node's top, in row order. */
  rowY: { id: string; y: number }[];
  /** Where a line meets it, when that is not its box — a `figure`'s picture and caption. */
  hull?: { x: number; y: number }[];
  /**
   * Its words are wider than the box the author gave it, so they are cut off at its edge — a sketch
   * box, text, button or input with a `w=` too narrow for its title or meta.
   */
  clipped?: true;
}
