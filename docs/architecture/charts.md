# Charts

> The `chart` dialect: its model, scales, colour, and the pointer's relationship to it.

## Charts

Thirteen dialects, and every one of them a grammar for something that *is* — what runs, what stores,
what a record can become, where somebody put a box. A **chart** is the fourteenth and describes none
of that. Its statements are numbers and the labels on them, what it needs from a layout is a scale
rather than a graph, and it answers a question none of the other thirteen can be asked: how big is
each, and how does it change. And its size is the author's: it has no natural one, which makes it the
second diagram type after `sketch` whose box is a choice rather than the layout's answer.

    bar stacked
    x Q1 Q2 Q3 Q4
    series web "Web" 120 140 160 180
    series mob "Mobile" 40 60 90 130 hue=coral
    legend bottom
    values
    unit "k€"
    max 400

Twelve words at the head of a line — `bar line pie donut x series slice legend values unit min max`
— and `docs/dsl/chart.md` is the whole grammar, plus a *Choosing a form* section that is the one
part of drawing a chart no diagnostic can help with.

Six decisions hold the design together, and the code argued back in places. As they now stand:

**1. One dialect, with the form as a body statement — not four types, and not a fence attribute.**
The thing a person places is *a chart*; which shape it takes is a property of the data's job and the
commonest edit to one is changing it, so it is a one-word edit. It is in the body and not on the
fence because `src/board/` must not know diagrams — `dir=` and `aspect=` are already two leaks of
that kind. Absent, the form is `bar`.

**2. The model is data, not a `Graph` — and the sixteen `type === "sequence"` guards became one
predicate.** A bar is not a node and a series is not a group; forcing them into `Graph` would put
chart cases into `size.ts`, `NodeView`, ELK's config, `scoreGraph` and `finalize()` for nothing any
of them do here. `sequence` established the shape. The hazard was the guards: a second literal beside
each one is how the sixteenth gets missed — so `OWN_MODEL_TYPES` in `ir.ts` is the list, `hasGraph()`
in `parse.ts` is the predicate, and `check-theme.mjs` and `check-skill.mjs` read the array by regex
instead of appending `"sequence"` by hand. **A sweep counted fifteen and there were sixteen**:
the `/__board/diagnostics` route had its own, outside `src/`, and no sweep of `src/`
finds it — which is the argument for the predicate, made by the one site that was missed while
writing the thing that replaces it.

**3. The statement shape is `<kind> <id> "Label" …`, so the editor is inherited.** `series web "Web"
120 140` has the same head as every node declaration in the twelve, which is what buys the pick, the
inline rename, `setTitle`, `setModifier`, `removeNode`, `duplicateStatement` and `moveStatement` for
nothing. `restate.ts` gained only `setValues` and the four writers for statements no other dialect
has. One amendment: `declaredAt`/`declaredOn` **parse the chart** rather than running the generic
token scan — the model carries the line of every series and slice, so the exact answer was the
cheaper one; the scan is still proven to find both statement shapes.

**4. Size is the author's box, not the layout's answer.** `resizeOf("chart")` is `box`: `w=`/`h=` set
the item and the plot fills it, defaulting to `metric.chart.w`/`h`. A chart has no natural size the
way an ELK diagram does — the same six bars are right at 320px in a margin and at 900px as a hero —
so `aspect` would be a lie and `none` would leave the one type whose size is purely a choice without
a handle. Layout is synchronous on the main thread as `sequence`'s is, and every width is measured
through `measurer` so nothing is read back off the page.

**5. Colour is a theme-owned ordered list of hue names, `color.chartHues`, assigned in declaration
order and never cycled — resolved in the layout, not the parser.** Every other dialect takes
`HUE_ORDER` in the parser and the first draft of this said a series would too. The doctrine's
validator says otherwise: in `HUE_ORDER` the ten hues fail the colour-vision and normal-vision
separation checks on *every* theme, and which order passes is a property of the theme's actual
colours — so the order is the theme's to state, and the parser, which is theme-free, leaves an
unwritten hue `undefined` for `layoutChart` to fill. It is seven names in all three themes (`coral,
magenta, ochre, indigo, moss, violet, crimson`), held there by `check-theme.mjs` against `HUE_ORDER`,
`CHART_HUES_MAX` and no repeats. A written `hue=` overrides one **without consuming a slot**, so
hueing the second series does not shift the third's colour. Past the end the rest draw `muted` and
`W_CHART_MANY` says where it started: the doctrine's own answer is to fold the tail into an "Other",
and a warning that names the fold is the honest way to draw it anyway.

**6. The drawing follows the doctrine where it is a rule and the theme where it is a number.** Zero
in the domain of every bar; one series draws no legend and two or more draw one; direct labels only
when asked, except on a pie, which labels its wedges regardless; declaration order everywhere,
nothing sorted; a marker only when a line has few enough points for one to mean something; a paper
gap between adjacent fills and a ring on every marker; a bar rounded at the data end alone. Every one
of those numbers is a key under `theme.metric.chart` — **thirty** of them, plus six `type.chart*`
tokens, byte-identical across the three themes so `metricsHash()` still matches on a switch. Three
amendments, all from the drawing: **a written `min`/`max` beats the zero rule** (a control that
silently changes nothing is worse than a baseline the author truncated on purpose; zero is the
default, and a value the pinned scale excludes is drawn *at* the scale's edge); **the hero is drawn
for a `donut` only** (a pie has no hole, and a number over the wedges sits on the data it is
summarising); and **`tabular-nums` is refused**, though the doctrine asks for it — see *Still
deliberately out*.

Twelve things are load-bearing, and four more are in *Things that will bite* because they are
lessons about the codebase rather than about charts.

- **`parseChart` must not sniff for Mermaid, and `pie` is why.** `detectMermaid` treats a line
  beginning `pie` as a *header* — fatally, because a header means the block is another language end
  to end — and `pie` is this dialect's own form word. Sniffing here would make the commonest chart
  body in existence a parse error against a language nobody wrote. `mindmap`, `timeline` and
  `gitgraph` do not sniff either; only `parseWith` and `parseSequence` do. The other side of it is
  the converter's: Mermaid's `pie` is recognised by what is **Mermaid's alone** — the `showData`/`title` suffix,
  or a `"Label" : 42` row under it, which no chart statement can be — and `mermaidPie()` is that one
  predicate, called by the detector *and* by the converter's door, because the Inspector's Convert
  offer runs `detectMermaid` over any fence body whatever its type, and two spellings of one question
  is how an offer and the conversion behind it come to disagree.
- **A value nobody can read is a gap, not a dropped token.** Dropping it shortens the series, which
  then disagrees with the categories, which raises a `W_CHART_LENGTH` describing a symptom of the
  `E_CHART_VALUE` one line up. `ctx.broken`'s argument in a dialect with no ids: one wrong word costs
  one diagnostic.
- **`legend` means two things and is two fields.** `legend bottom` places the key; `legend solid "in
  sync"` is the shared glyph legend every model carries and `DiagramItem` reads off any model at all.
  So `ChartModel.legend` is `LegendEntry[]` like everything else and the placement is `legendAt` —
  the grammar tells them apart by whether a string follows the word.
- **`horizontal` is a transposition, not a second chart.** One pair of mappers — `catAt` for the
  category axis, `valAt` for the scale — decides which screen axis carries which, and every bar,
  point, tick and label is written once in terms of the two. `xAxis` is whatever runs along the
  bottom and `yAxis` whatever runs down the left, so the two swap *roles* rather than names, and
  `ChartAxis.kind` is what the view reads to know which one carries the gridlines. The test is that
  the bar count and the ratio of two bars' lengths are identical either way round.
- **A label that will not fit is dropped, and the rank decides which.** Every label is *offered*, and
  `flush()` places them lowest rank first — ticks, categories, the legend, the hero, and last a
  direct value or a wedge's share — refusing any that would collide with one already placed. That is
  the doctrine's "never clip a label: measure first" turned into a mechanism, and it is what makes
  "no two labels overlap" an invariant of the layout rather than a hope about the data. A token is
  therefore exactly a size *and* a weight: the test measures the same font the layout did, or it
  reports collisions that never happened.
- **A value is never snapped to the grid, and a chart is where that first mattered.** `metric.grid`
  is where the drawing's *chrome* lands — `layoutChart` snaps the plot rectangle, the legend box and
  the hero, and nothing else — because a bar's cap, a tick's position and an arc endpoint are the
  data. Round a cap to the nearest 8px and a stacked chart stops claiming the one thing it claims,
  that a segment's far edge is the running sum. `test/chart.test.ts` holds that to a pixel.
- **`Math.max(...[])` is `-Infinity`, and a margin is a measurement.** Every widest-label figure in
  `layoutChart` is guarded by "is there any text at all" first: a chart with no `x` line has blank
  categories by design (`1…n`, drawn as blank ticks), and unguarded that spread makes the bottom
  margin negative and the plot taller than the item it is drawn in. The same guard is why a chart
  with no ticks — a pie — reserves no left margin rather than a nonsense one.
- **`w=`/`h=` are not in an item's `hash`, and a chart is the one type whose box changes its
  layout.** Without the box in the key a chart dragged wider is handed the layout it had at the old
  width, cached and correct-looking. `layoutKey(hash, theme, box?)` takes one and only `DiagramItem`'s
  chart branch passes it, so no graph item's cache moved. The box it passes is the *content*
  rectangle: `metric.chart.w`/`h` are the **item's** default box, and the frame's padding, header and
  rule come off it in the same arithmetic the size effect adds back on.
- **A framed chart is 169px shorter than its `h=`.** `frame.pad` twice, the header and the rule come
  off the item's box before `layoutChart` sees it, so `metric.chart.h`'s 320 is 151px of drawing the
  moment somebody writes a `title=`. Nothing is wrong with that — it is what `chartBox` computes and
  what the size effect adds back — but a chart *designed* at 320 comes out squashed, and
  `boards/reference/chart.board.md` is 420 for that reason.
- **Text never wears the series colour, and the halo is what makes that hold on three themes.** A
  tick is `muted`, a category and a legend row `slate`, a value and the hero `ink`; identity comes
  from the swatch. The one label drawn *on* a fill is a wedge's own share, and the answer there is
  `paint-order: stroke` with the **surface** behind it — not a fixed light or dark, because
  `paper-dark`'s hues are light and its ink is light too, so no single colour reads on both.
  `edge.labelHalo` could not be reused: three pixels sized for a 600-weight mono edge label swallows
  an 11px wedge label whole, so `metric.chart.labelHalo` is two and is a key of its own. A value on
  the paper wears none at all — a halo the colour of what is already behind it is a stroke around
  nothing.
- **The gap between two touching fills is the layout's, never a stroke.** A stacked segment arrives
  `fillGap` short at its near end and a wedge arrives inset by `sliceGap` at the rim, so the view
  draws neither a border nor a paper stroke: either would draw the gap a second time and double it.
  The doctrine's "gap and ring, never a border" is split across two layers, and the view's half is to
  leave it alone.
- **A pie shrinks to fit the label it is not drawing.** The radius has to leave room for the shares
  that go outside on a leader, and the first version reserved the widest label on the *chart*: one 6%
  sliver whose own label reads `Other 6%` cost the pie the width of the longest name on it, and a
  440px card drew an 88px pie. `outsideW()` measures only the slices actually going outside, at the
  radius being tried, which is why it is re-measured each pass.

Three more about the pointer — the pick and its controls meeting a model that is not a graph.

- **A picked series wears no handles**, because `growable()` is `hasGraph()` — see *Controls on the
  canvas*. `web --> mob` in a chart body is `E_UNKNOWN_KIND`, so a `+` there would break the thing
  it was pressed on. `sequence` falls out of the same predicate deliberately: it *has* arrows, but
  one is a message, and a plus that quietly said two people talk is a different claim from "a card
  beside this one".
- **A series' marks are one `<g data-dag-node>` and its labels are not in it.** SVG has no z-index, so
  the only way a wedge's share stays on top of the wedge beside it is to draw every label after every
  mark — which also keeps the group's box exactly what `placed.nodes` claims, and that is what a
  board link into `chart.web` lands on. `data-dag-title-of` is the consequence and the first title on
  the board drawn outside the thing it names: `Rename`'s `nameElement` looks *inside* the picked
  element for a `[data-dag-title]` and would have opened the box over the bars. It is deliberately
  **not unique** — a pie names a slice twice, its legend row and the share on its wedge — so
  `querySelector` takes the first in document order, which is whichever the layout offered first;
  both are that slice's name and both open the same box, and a test that wants one of them says which
  by class. And **the centre of a series' box is paper**: a `<g>`'s rectangle is the union of its
  marks, so a bar series spans the whole plot and its middle is empty air between two bars — nothing
  can click it, least of all Playwright, which aims at an element's centre. Every gesture reaches a
  series through a *mark*.
- **The panel shows a pick's label, its hue and its numbers, and leaves the rest out rather than
  showing it and ignoring it.** A meta is a second string the parser reads and never draws; a status
  or a flag is a *bare word in the position the values are read from*, so `done` on a `series` line is
  `E_CHART_VALUE` — the control would break the chart it was used on. The Values field is the run as
  the author wrote it (`valuesText`, the inverse of `setValues`, beside `rowLines` and for the same
  reason), and a slice's says `Value` and writes one, because a second would parse and warn
  `W_CHART_LENGTH` about a document the person is looking at. The item view is the one on the board
  whose controls write a **body** — Form, Stacked and Horizontal, Legend, Value labels, Unit, Min,
  Max and Categories are statements, not fence attributes, because the first decision above put the
  form in the body. A drag on a picked series or slice reorders it (`dragMode("chart")` is `"order"`), and
  `orderDrop` had to learn that `DECLARES` is per dialect: it scanned back for `participant|actor`
  only, so a series dropped on a leading half found nothing and went `toTop` — above the `bar` line,
  a data statement standing in front of the statement that says what shape the chart is.
- **Every statement has a control, so the Source tab is not needed to reach one.** A donut's hero is
  two fields (Centre figure, Centre caption) shown for a `donut` only, written by `setChartHero` as
  the *strings* on the form line, so a flag or a `%%` comment beside them stays; an emptied figure
  takes the caption too, because the grammar has no caption without a figure. The key's rows
  (`legend solid "…"`) are a list — glyph select, text, remove, add — read by `chartKeyRows` and
  written by `setChartKeyRows`, which rewrites the n-th row in place. `legend` is **two statements
  under one word**, so `setChartOption("legend", …)` (the placement select) finds only the one with
  no string behind its second word; before it did, a row written earlier in the body was the line a
  change of placement replaced. *Add a series* / *Add a slice* is `addChartData`: the next free
  `series1`/`slice1`, one `1` per category (a zero draws nothing, and the new mark is picked so its
  Values field is the next thing typed into), written after the last data statement. A pick's **Id**
  is `renameChartId`, which writes the declaration token only and is deliberately *not* `renameId`:
  that renames every word equal to the id, and in a chart a word may be a category (`x web mob`).
  A chart body names an id nowhere but its declaration, so that one token is the whole fence; the
  pick is re-pointed at the new id in the same handler, or the panel would find no statement under
  the old one and close. A clash (`chartIdProblem`) is refused in the box. Board-level `edges`
  references to `chart.web` are *not* rewritten — the panel writes one body, and the item-level
  `renameItemId` that does touch `edges` knows items, not the nodes inside them.

`boards/reference/chart.board.md` is the fourteenth fixture — a grouped bar, a stacked horizontal one
with `values`, a three-series line with a gap and a written `min`, a five-slice pie, a donut with a
hero, and one untitled chart beside a note so the bare form is in the baselines too. Three
screenshots, and **every other baseline byte-identical**, which is what says the guard rewrite
changed nothing about how anything else is drawn. Two tests walking `boards/reference/` had a
`sequence` literal of their own and were what found the last of them: `parse-dialects.test.ts` called
`parseDiagram` on a chart and failed with "chart has no dialect", and `layout.test.ts` survived only
because `parseDiagram` returns `null` and a later filter dropped it. The first reference board of a
new non-`Graph` type is what finds the guards in `test/`.

A chart publishes no `data-dag-quality` and cannot: `scoreGraph` measures crossings and routes over
cards, and a chart has neither. `snapshot.mjs` prints `quality: not measured` under one, which is
expected rather than a gap.
