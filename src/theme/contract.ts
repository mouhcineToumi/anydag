/**
 * The theme contract — **the only place the renderer learns a colour or a size**.
 *
 * `themes/<name>/theme.json` is the single source of truth. Two consumers read it:
 *
 * - `applyTheme()` writes every leaf as a `--dag-<path>` custom property on `<html>`, which is what
 *   the CSS draws with.
 * - `layout/size.ts` and `layout/route.ts` read the same object as numbers, which is what decides
 *   where things go.
 *
 * Those two must agree to the pixel, which is why there is one file rather than a `.css` and a
 * `.json` that drift. Two checkers keep it honest: `scripts/check-theme.mjs` fails the build if
 * `src/` reaches for a `--dag-*` that no theme defines, and `scripts/check-literals.mjs` fails it if
 * the diagram surface writes a colour, a length or an SVG style value down instead of asking.
 *
 * The rule that follows from this: **no colour anywhere in `src/`, and no length or SVG style value
 * on the diagram surface.** The app chrome is exempt and lives in `src/styles/chrome.css`.
 */

/** A key of `color.hues` — never a colour, always a name the theme resolves. */
type Hue = string;

interface ThemeColor {
  /**
   * Which way round this theme is, published to the browser as `color-scheme`.
   *
   * Not decoration: it is what makes native widgets — the board and theme pickers, scrollbars, a
   * focus ring — follow the board instead of staying stubbornly light next to a dark canvas.
   */
  scheme: "light" | "dark";
  /** The board ground. Warm off-white in `paper`; every surface sits on it. */
  paper: string;
  /** Group tint, level 0. */
  paper100: string;
  /** Group tint, level 1 (a group inside a group). */
  paper200: string;
  /** A node's own fill. White on paper — the thing that makes a card read as a card. */
  card: string;

  ink: string;
  slate: string;
  /** De-emphasised text: the "18 more columns" row, a use-case id. */
  muted: string;

  outline: string;
  outlineSoft: string;
  /** Dashed border of a node we do not own. */
  externalBorder: string;

  /** The one accent. Marks the subject of the diagram and nothing else. */
  accent: string;
  accentSoft: string;

  success: string;
  successSoft: string;
  successBorder: string;
  successText: string;

  warning: string;
  warningSoft: string;
  warningText: string;

  danger: string;
  dangerSoft: string;
  dangerBorder: string;
  dangerText: string;

  /** Border of a node that ended without the outcome (a `muted` state). */
  mutedBorder: string;

  /** Named hues a group or lane can carry. Ten in `paper`, all one lightness band. */
  hues: Record<string, string>;
  /**
   * What an element with no hue draws with — a node outside every group, an unhued lane.
   *
   * One place, so the renderer never has to have an opinion. `hueVars()` binds nothing when there
   * is no hue and the CSS falls back to this.
   */
  defaultHue: string;
  /** Group fill by nesting level; the last entry repeats for deeper levels. */
  groupFills: string[];
  /**
   * The order a chart assigns hues in, and the one hue list the theme rather than the parser owns.
   *
   * Every other dialect takes `HUE_ORDER` in the parser, and the first draft of the chart plan said
   * a series would too. The dataviz validator says otherwise: in `HUE_ORDER` the ten hues fail the
   * colour-vision and normal-vision separation checks on every theme, and *which order* passes is a
   * property of the theme's actual colours — so the order is the theme's to state, and the parser,
   * which has never seen a colour, leaves an unwritten `hue` undefined for `layoutChart` to fill.
   *
   * Names from `HUE_ORDER`, at most `CHART_HUES_MAX` of them, and never cycled: a series past the
   * end draws in `muted` and the parse has already said so (`W_CHART_MANY`). `check-theme.mjs`
   * holds every theme to all three of those.
   */
  chartHues: Hue[];
  /**
   * Percent of the hue mixed into `card` for an icon tile or an activation bar.
   *
   * A mix rather than a lightness step, deliberately, and it is worth writing down why since the
   * obvious modernisation is to derive tints with `hsl(from var(--dag-h) h s <L>%)` instead.
   *
   * The original artboards are the visual spec, and their tile fills are *exactly* this
   * mix — `#DDECED` is teal at 14% into white, `#EBE7F9` is violet, and so on. The mix produces
   * tints whose lightness varies a little across the ten hues (89.8% to 94.1%) but whose chroma is
   * even; a fixed-lightness formula produces the opposite, and because sRGB mixing does not
   * preserve saturation ratios, it would land teal at 82% saturation where the spec has 31%. That
   * is a different tint family, not a refactor of this one.
   *
   * The usual argument for relative colour — that a mix toward `card` cannot serve a dark theme —
   * does not hold here either: `card` *is* the theme's own surface, so a dark theme mixes toward
   * its dark card and gets a dark tint. It only needs a larger percentage, which is this key.
   */
  tintMix: number;

  /**
   * How strongly ink is laid down. A colour concern, not a geometric one.
   *
   * These sit under `color` rather than `metric` on purpose: `metricsHash()` keys the layout cache
   * on the whole `metric` block, so an opacity filed there would make a theme that only softens its
   * edges re-run every ELK layout to arrive at identical coordinates.
   */
  opacity: {
    edge: number;
    marker: number;
    edgeQuiet: number;
    markerQuiet: number;
    bus: number;
    /** The dot where a bus meets a node, drawn firmer than the bus itself. */
    junction: number;
    /** A timeline section's rule, which sits under its own label. */
    stripRule: number;
  };
}

interface ThemeType {
  /**
   * One multiplier over every size below, resolved to plain numbers by `resolveTheme()` before
   * anything reads them.
   *
   * A ramp rather than eighteen independent edits: a theme that wants "one notch bigger" moves this
   * and keeps every ratio the artboards established. It must resolve to a number, not a `calc()` —
   * `layout/measure.ts` builds a canvas font string and `TableMeasurer` parses the px back out of
   * it, so anything that is not a literal length silently measures as 14.
   */
  base: number;

  title: number;
  subtitle: number;
  chip: number;
  nodeTitle: number;
  nodeMeta: number;
  rowName: number;
  rowDetail: number;
  pill: number;
  edgeLabel: number;
  groupLabel: number;
  groupSub: number;
  stepTitle: number;
  stepId: number;
  decision: number;
  ucId: number;
  ucTitle: number;
  classStereo: number;
  classVis: number;
  entityName: number;
  rowMore: number;
  c4Name: number;
  c4Type: number;
  c4Desc: number;
  c4DescLeading: number;
  seqLabel: number;
  seqTab: number;
  legend: number;

  /**
   * A chart's six sizes. Identical in all three themes, like `metric.chart`, so `metricsHash()`
   * matches across a theme switch and a cached layout survives it.
   *
   * `chartHero` is the doctrine's floor rather than a suggestion — a hero figure is at least 48px
   * and in the same sans as everything else, never a display face. It is a *ceiling* at layout
   * time: `layoutChart` shrinks it to fit the hole it is drawn in, which is the one font size
   * computed outside this file and the only one that depends on the chart's own geometry.
   */
  chartTick: number;
  chartLabel: number;
  chartValue: number;
  chartLegend: number;
  chartHero: number;
  chartHeroLabel: number;

  /** Markdown items carry their own scale: a board is read at a glance, not settled into. */
  mdBody: number;
  mdLeading: number;
  mdH1: number;
  mdH2: number;
  mdH3: number;
  mdCode: number;
  mdCodeLeading: number;
  /** A code block's language, above its text: a label, so a step under the code. */
  mdCodeLang: number;
  mdTable: number;
  mdTh: number;
  /**
   * The caption under a `figure` — a picture's name, set smaller than a card's title
   * because it labels something that is already saying most of it.
   */
  figureCaption: number;

  /**
   * The weight a bold title is drawn at, `bold` in the DSL.
   *
   * A weight rather than a size, which is why it is exempt from the `base` ramp: scaling 700 by a
   * base of 1.1 would produce 770, and no face carries a weight that does not exist. A theme
   * reaching for one that its fonts do not ship gets the browser's synthesis instead — a slanted or
   * fattened copy rather than a drawn one — so the number is here for the theme to pin exactly.
   * The italic slant has no token because a slant is a binary the face has or does not; there is
   * nothing for a theme to say about it that `font-style: italic` does not already say.
   */
  weightBold: number;
}

export interface ThemeMetric {
  radius: {
    card: number;
    group: number;
    tile: number;
    tileC4: number;
    chip: number;
    pill: number;
    /** A legend swatch. */
    small: number;
    /** A fork/join bar, and a timeline section's rule. */
    bar: number;
    /** Inline code in a markdown item. */
    code: number;
  };
  /**
   * Border weights. One hairline and one heavier rule, so a theme can thicken every line at once —
   * which a dark theme generally must, since a 1px line on a dark ground reads lighter than the
   * same line on paper.
   */
  line: { hair: number; rule: number };
  /** The frame every diagram item is drawn inside: title, rule, body, legend. */
  frame: {
    pad: number;
    /**
     * The padding of a *frameless* diagram — no head, no rule, because nobody asked for one. It is
     * not a smaller `pad`: it holds the hover ring and the selection outline off the card's edge
     * and nothing else, because an element with no header is meant to read as itself, not as a box
     * around itself.
     */
    barePad: number;
    headerH: number;
    legendH: number;
    headGap: number;
    subGap: number;
    chipPadY: number;
    chipPadX: number;
    ruleGapTop: number;
    ruleGapBottom: number;
    /** Height held for a diagram that has parsed but not yet laid out. */
    pendingMinH: number;
  };
  tile: { size: number; sizeC4: number; icon: number; iconC4: number; stroke: number };
  node: {
    padX: number;
    padXEntity: number;
    gap: number;
    /** Between a node's title and the meta line under it. */
    textGap: number;
    headerArch: number;
    headerEntity: number;
    headerClass: number;
    headerClassStereo: number;
    rowArch: number;
    rowEntity: number;
    rowClass: number;
    rowPad: number;
    plainH: number;
    plainMinW: number;
    plainMaxW: number;
    pillPadY: number;
    pillPadX: number;
    stepW: number;
    stepH: number;
    stepGap: number;
    stepPadY: number;
    stepPadX: number;
    stepRowGap: number;
    /** The `done` tick drawn beside a step id. */
    tickSize: number;
    tickStroke: number;
    decisionH: number;
    decisionPadX: number;
    decisionGap: number;
    stateW: number;
    stateH: number;
    stateGap: number;
    statePadX: number;
    ucW: number;
    ucH: number;
    ucPadX: number;
    participantW: number;
    participantH: number;
    classMinW: number;
    classGap: number;
    /** The visibility glyph column in a class row. */
    visW: number;
    c4W: number;
    c4Pad: number;
    c4PadX: number;
    c4Gap: number;
    c4HeadGap: number;
    entityMinW: number;
    entityGap: number;
    keyPadY: number;
    keyPadX: number;
    fkPadY: number;
    fkPadX: number;
    topicPadX: number;
    start: number;
    end: number;
    endInner: number;
    bar: number;
    barMin: number;
    /** The accent ring a node wears while the pointer is over it. */
    hoverRing: number;
  };
  group: { padTop: number; padSide: number; padBottom: number; labelX: number; labelY: number; dot: number; labelGap: number };
  legend: {
    gap: number;
    itemGap: number;
    padTop: number;
    swatchW: number;
    swatchH: number;
    /** The line glyphs. They draw with `edge` values so the legend cannot describe a stroke the diagram does not use. */
    glyphW: number;
    glyphH: number;
  };
  lane: {
    labelW: number;
    labelLeft: number;
    bandLeft: number;
    bandGap: number;
    padY: number;
    minH: number;
    colGap: number;
    labelH: number;
    labelGap: number;
  };
  /** A timeline section: a rule over the stretch of time it covers, labelled above it. */
  strip: { gap: number; ruleH: number };
  /** Board items that are neither a diagram nor prose. */
  item: { captionGap: number };
  /**
   * The sketch vocabulary's boxes: a wireframe's parts, and the paper on a sticky wall.
   *
   * These are floors and paddings rather than sizes, because `sketch` is the one dialect where
   * `w=`/`h=` *are* the box — the author drew it that big. What a theme decides here is what a
   * shape is when nobody said: how tall a button is, how big a sticky note comes out of the pad.
   *
   * Identical in all three themes on purpose. `metricsHash()` keys the layout cache on the whole
   * `metric` block, and `paper-dark` differs from `paper` only in colour, so a figure that
   * drifted between them would re-run every ELK layout on a theme switch to arrive at the same
   * coordinates.
   */
  sketch: {
    /** A plain rectangle: the floor under it, and the inset its label sits at. */
    boxMinW: number;
    boxMinH: number;
    padX: number;
    padY: number;
    /** A bare line of text has no chrome, only enough room not to clip its own descenders. */
    textPad: number;
    textH: number;
    buttonMinW: number;
    buttonH: number;
    buttonPadX: number;
    inputMinW: number;
    inputH: number;
    inputPadX: number;
    stickyW: number;
    stickyH: number;
    stickyPad: number;
    imgMinW: number;
    imgMinH: number;
    /** The caption band under a picture placeholder. */
    imgCaptionH: number;
    /** What a container leaves past the far edge of whatever is inside it. */
    groupPad: number;
    /** Between two shapes the author has not placed — the reading-order grid in `layout/sketch.ts`. */
    gap: number;
    /**
     * A geometric shape when nobody gave it a size (`layout/shapes.ts`). A circle, a star and the
     * other shapes that only read as themselves square take `shapeSide` both ways; the rest — a
     * parallelogram, a cylinder, a speech bubble, which hold a line of text across — are wider.
     */
    shapeSide: number;
    shapeW: number;
    shapeH: number;
    /**
     * How wide the pen draws (`render/nodes/Sketch.tsx`). The one thing a theme has an opinion
     * about on a freehand stroke: its colour is the author's `hue=` or the ink, and its shape is
     * the author's own hand.
     */
    inkW: number;
    /**
     * A picture with a caption under it — `figure` (`layout/figure.ts`).
     *
     * `figureSide` is the picture's square when nobody sized it; `figureCaptionW` is how wide a
     * caption may run before it wraps, so a long name makes a figure wider up to a point and then
     * taller; `figureLineH` is one caption line, stated as a length so the layout and the CSS are
     * reading one number rather than each multiplying a leading. `figureStroke` is a line glyph's
     * weight in its own 24-unit grid — at 64px it lands near the pen's own weight, which is what
     * makes a Lucide house read as drawn rather than as a UI icon blown up.
     */
    figureSide: number;
    figureGap: number;
    figureCaptionW: number;
    figureLineH: number;
    figureStroke: number;
  };
  /** A timeline's date scale. */
  axis: { pad: number; tickMajor: number; tickMinor: number; labelY: number };
  /**
   * A chart's box when nobody has said.
   *
   * The whole of `metric.chart` is here, and deliberately so: a chart is the one diagram type with no
   * natural size — the same six bars are right at 320px in a margin and at 900px as a hero — so
   * `resizeOf("chart")` is `box` and this is what a fence with no `w=`/`h=` comes out as. The rest
   * of the block is filled the same way (the gaps, the radii, the marker, the tick budget); a key
   * nothing draws from is a claim, and a claim drifts, so nothing is written here ahead of a reader.
   *
   * Identical in all three themes, like `sketch` and `seq`: `metricsHash()` keys the layout cache on
   * the whole `metric` block, and a figure that drifted between two themes that differ only in
   * colour would re-run every layout on a theme switch to arrive at the same coordinates.
   */
  chart: {
    /** The item's box when nobody wrote a `w=`/`h=`. `resizeOf("chart")` is `box`: a chart has no
        natural size the way an ELK diagram does, so this is a house default and not an answer. */
    w: number;
    h: number;
    /** The drawing's inset inside that box, before any axis margin. */
    padX: number;
    padY: number;
    /** Between two bars of one category, and between one category's group and the next. */
    barGap: number;
    groupGap: number;
    /** The doctrine's ceiling: a bar is a length, and past this it reads as a block. */
    barMaxW: number;
    /** Rounded at the data end only, square at the baseline. Clamped per bar by the layout. */
    barRadius: number;
    /** Paper between two touching fills — a gap, never a border, which would be a second mark. */
    fillGap: number;
    /**
     * The halo under a label that is drawn *on* a mark — a wedge's own share, and nothing else.
     *
     * Its own key rather than `edge.labelHalo`, which is three pixels tuned for a 600-weight mono
     * edge label: at a chart value's eleven the same three swallow the glyph and the number reads
     * as the halo's colour rather than as ink. A value on the paper wears none at all.
     */
    labelHalo: number;
    lineW: number;
    markerR: number;
    /** The surface-coloured ring that lifts a marker off the line it sits on. */
    markerRing: number;
    /** Past this many points a marker stops meaning anything and the line is drawn bare. */
    markerMax: number;
    /** One-step-off-surface hairline, solid. Never dashed, never heavy. */
    gridW: number;
    tickLen: number;
    /** Between a tick's mark and its number. */
    tickGap: number;
    /** Between the plot and the category labels under (or beside) it. */
    labelGap: number;
    /** Between a mark and the number `values` writes beside it. */
    valueGap: number;
    legendSwatch: number;
    legendGap: number;
    legendRowH: number;
    /** How wide the right-hand legend column may grow before a label is left to be dropped. */
    legendCol: number;
    /** The paper gap between two wedges, as a distance at the rim — the layout turns it into an angle. */
    sliceGap: number;
    /** The hole, as a fraction of the radius. A ratio, so it survives every size the chart is drawn at. */
    donutInner: number;
    /** A slice under this share of the whole draws no label at all rather than a clipped one. */
    minLabelPct: number;
    /** The elbow out to a label that would not fit inside its wedge. */
    leader: number;
    /** Between the hero figure and the word under it. */
    heroGap: number;
    /** At most this many ticks on the value axis, however wide the plot is. */
    maxTicks: number;
    /**
     * One line of chart text.
     *
     * A length rather than a ratio because it is what a *margin* reserves — the band under the plot,
     * the row a value label needs — and a margin is a box, not a font metric. Every chart size is
     * within a couple of points of every other, so one figure serves all six.
     */
    lineH: number;
  };
  edge: {
    stroke: number;
    dash: string;
    quiet: { stroke: number; markerStroke: number; dotR: number };
    chevron: { len: number; half: number };
    crow: { len: number; spread: number };
    dotR: number;
    triangle: { w: number; h: number };
    diamond: { w: number; h: number };
    bus: { offset: number; junctionR: number; stroke: number };
    corner: number;
    fanSpan: number;
    reach: { min: number; max: number; along: number; across: number };
    labelOffset: number;
    /**
     * How much of the surface a label paints out from under itself, drawn as a stroke behind the
     * glyphs (`paint-order: stroke`).
     *
     * A halo rather than the chip that was tried on the artboards and pulled: at this size a chip's
     * own border competes with the line it sits on, while a halo is invisible until it is needed.
     */
    labelHalo: number;
    selfLoop: { reach: number; t0: number; t1: number };
  };
  seq: {
    colGap: number;
    rowPitch: number;
    firstRow: number;
    lifelineDash: string;
    /** The rule between an `alt` fragment's branches. Distinct from a lifeline so the two do not read as one mark. */
    dividerDash: string;
    activationW: number;
    activationR: number;
    fragmentR: number;
    fragmentPadX: number;
    fragmentPadRight: number;
    tabH: number;
    tabGap: number;
    tabPadX: number;
    /** How far a fragment's tab is inset from its box. */
    tabInset: number;
    elseH: number;
    endH: number;
    labelLift: number;
  };
  /**
   * Per-diagram-type ELK spacing, and the shape to aim for.
   *
   * `aspect` is the one that stops an architecture diagram running off the side: a chain of five
   * deploy steps beside a cloud is 2400px wide and unreadable, and ELK will fold it into two rows
   * to hit the target. A state machine sets a high value on purpose — a funnel that wraps stops
   * reading as a funnel.
   */
  elk: {
    colGap: Record<string, number>;
    rowGap: Record<string, number>;
    aspect: Record<string, number>;
    /**
     * `include` lays every node out in one global pass; `separate` lays each group out on its own
     * and then arranges the boxes.
     *
     * `separate` is what makes an ER diagram look like the hand-drawn one: three domain groups side
     * by side with their entities stacked inside, each group hugging its content. Under `include`
     * one direction has to serve both axes, and the groups end up hundreds of pixels taller than
     * what is in them. `include` still wins where the diagram really is one flow — a state machine,
     * an architecture whose pipeline has to line up across group boundaries.
     */
    hierarchy: Record<string, "include" | "separate">;
  };
  /** Markdown items: prose spacing, which no diagram metric describes. */
  md: {
    notePadY: number;
    notePadX: number;
    blockGap: number;
    headGapTop: number;
    headGapBottom: number;
    h3GapTop: number;
    h3GapBottom: number;
    listPad: number;
    itemGap: number;
    ruleGap: number;
    codePadY: number;
    codePadX: number;
    prePadY: number;
    prePadX: number;
    /** Between a code block's language and its first line. */
    codeLangGap: number;
    quotePad: number;
    quoteBar: number;
    cellPadY: number;
    cellPadX: number;
    tdPadY: number;
  };
  /** Everything ELK returns is snapped to this. ELK places on fractional pixels. */
  grid: number;
}

export interface Theme {
  name: string;
  fonts: { sans: string; mono: string };
  color: ThemeColor;
  type: ThemeType;
  metric: ThemeMetric;
  /** Node kind → Lucide icon name. `icon=` in the DSL overrides per node. */
  icons: Record<string, string>;
}
