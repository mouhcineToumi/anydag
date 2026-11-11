# `chart` — how big is each, and how does it change?

    bar
    x Q1 Q2 Q3 Q4
    series web "Web" 120 140 160 180
    series mob "Mobile" 40 60 90 130
    unit "k"

The other thirteen types are grammars for a *kind of system* — what runs, what stores, what a record
can become. This one draws **data**: its statements are numbers and the labels on them, what it needs
from the layout is a scale rather than a graph, and its size is yours rather than the layout's.

Reach for it whenever the question is *how much* rather than *what talks to what*: revenue by
quarter, share of traffic, latency over a release, the split of a budget. For anything about
structure, use the type that names the question it answers.

## The vocabulary

Twelve words, and every statement is one of them at the head of a line.

| Statement | Syntax | Means |
|---|---|---|
| `bar` | `bar [stacked] [horizontal]` | columns, one group per category. `stacked` piles them into a total; `horizontal` turns the plane on its side |
| `line` | `line` | one path per series across the categories |
| `pie` | `pie` | wedges from 12 o'clock, clockwise, in declaration order |
| `donut` | `donut ["<hero>" ["<label>"]]` | the same with a hole, and optionally a number in it |
| `x` | `x <label> <label> …` | the categories, as words or `"quoted strings"` |
| `series` | `series <id> "<Label>" <value> … [hue=] [icon=]` | one value per category |
| `slice` | `slice <id> "<Label>" <value> [hue=] [icon=]` | one value, full stop |
| `legend` | `legend none \| right \| bottom` | where the key goes |
| `values` | `values` | a number drawn on every bar, point and wedge |
| `unit` | `unit "k€"` | a suffix on every tick and every value label |
| `min` | `min <number>` | pin the bottom of the scale |
| `max` | `max <number>` | pin the top |

`%%` and `//` comments and `;` separators work here as everywhere else, and `legend` keeps its
second, shared meaning — see *The options*.

## The form

    bar | line | pie | donut

**Write it first.** The parser will take it anywhere in the body and the panel puts it at the top,
but it is the statement that says what the rest of the lines are for, and a dragged series will
never land above it. Leave it off entirely and the form is `bar`. A *second* form line is
`E_CHART_FORM`, and the first one stands.

`bar` takes two flags on the same line, in either order:

    bar stacked         segments piled to a total, not side by side
    bar horizontal      the plane transposed — reach for it when the labels are long
    bar stacked horizontal

A `donut` may carry a **hero**: the number in the hole, and the word under it. It is sized to fit
the hole rather than by a theme key, and it is drawn for a `donut` only — a pie has no hole, and a
number over the wedges sits on the data it is summarising.

    donut "1.2M" "users"

## The data

    series <id> "<Label>" <value> <value> …    one value per category
    slice  <id> "<Label>" <value>              one value, full stop

Both have the same head as a node declaration in any other dialect — `<kind> <id> "Label"` — which
is what buys the pick, the inline rename, the hue swatch and the properties panel through code that
already existed. The id is yours and has to be unique on the item (`E_DUPLICATE_ID`); it is also
what a board link ends on, so `chart.web` in an `edges` fence lands on that series' marks.

A value is a word `Number()` accepts — `120`, `3.5`, `-4`. **`-` is a gap**: a missing point on a
line, no bar in that slot. A word that is neither is `E_CHART_VALUE` and is *kept* as a gap, so one
unreadable number costs one diagnostic rather than two.

**Both statements parse in every form, with a meaning of their own**, which is what makes changing
the form safe:

- a `series` in a `pie` or `donut` is **one wedge worth the series' total**, its gaps skipped;
- a `slice` in a `bar` or `line` chart is **a category of its own**, named by its own label and
  appended after whatever `x` declared, carrying one value and its own hue.

Order is declaration order, everywhere it shows: the legend, the bars within a group, the wedges
round the circle. Nothing sorts anything.

## The categories

    x Q1 Q2 Q3 Q4
    x "Jan 24" "Feb 24"

Words or quoted strings, and optional. Leave the line off and there are as many categories as the
longest series has values, drawn as blank ticks — which is what lets a line of twelve readings need
no invented axis text.

A series with **more or fewer values than there are categories is padded with gaps or cut**, and
warned (`W_CHART_LENGTH`) — never refused. A fragment dropped from the library must not be able to
break the chart it landed on.

## The options

    legend none | right | bottom    where the key goes; absent, `right` for two or more, else none
    values                          a number on every bar, point and wedge
    unit "k€"                       a suffix on every tick and every value label
    min 0                           pin the bottom of the scale
    max 400                         pin the top

`legend` still takes the shared glyph form as well — `legend solid "in sync"` — and the two are told
apart by whether a string follows the word.

**A pie labels its wedges whether or not you write `values`**; what `values` changes there is *what*
the label says — the number instead of the computed percentage. A wedge worth less than 3% of the
whole is left unlabelled, and a wedge whose label will not fit inside it goes outside on a leader,
carrying its own name with it.

**The scale holds zero unless you take it away.** A bar is read as a length, so zero is in the
domain of every bar chart and of anything `stacked`, and a `line` floats only when you write a
`min`. A written `min` or `max` is a pin: it is kept exactly, the ticks fall inside it, and a value
it excludes is drawn *at* the edge of the plot rather than outside it.

## Colour

**Ten hues, and you do not have to pick any of them.** A series or slice with no `hue=` takes the
next name from `color.chartHues` — the theme's own ordered list, seven long, which is where the
separation between two adjacent things is guaranteed. Writing `hue=` overrides one without
consuming a slot, so hueing the second series does not shift the third's colour.

Past the end of that list the rest draw in the theme's `muted` and `W_CHART_MANY` says where it
started. The list is **never cycled** — two series in one colour is two series a reader cannot tell
apart — and there is no eighth hue to invent. The answer is to fold the tail into an "Other".

`icon=` parses on a series or a slice and is checked against the icon vocabulary, and **nothing
draws it today**: a chart's key is a swatch. It is read rather than dropped so a board that carries
one keeps it.

Text never wears the series colour anywhere — a tick, a category, a legend row and a value are all
theme text tokens, and identity comes from the swatch beside the label.

## Choosing a form

The one decision here no diagnostic can help with. All four forms will draw whatever you hand them,
and three of the four will draw it wrong.

- **`pie` and `donut` are for part-of-whole, at a glance, with at most six slices** — and the sixth
  is usually "Other". An eye compares angles badly and areas worse, so two close values read as
  equal. If the question is *which is bigger*, that is a `bar`. Never a two-slice pie: a sentence
  says it better.
- **`bar` is for comparison.** Grouped bars compare magnitudes; `stacked` is for *composition*,
  where the total is the point and only the bottom segment can honestly be compared across
  categories. Reach for `horizontal` when the category names are long — turning the plane on its
  side is what a long label needs, not a smaller font.
- **`line` is for change over time**, and for at most four series before the ends collide and the
  reader loses which is which. Past four, several charts beside each other read better than one
  crowded one.
- **One axis, and never two.** There is no second scale in this grammar on purpose: two axes let any
  two series be made to cross wherever the author would like them to.
- **Zero is the baseline unless you write `min` on purpose.** Truncating it exaggerates every
  difference on the chart. `min` is for the case where the range really is the story — latency over
  a week, a percentage between 90 and 100 — and writing it is how you say you meant it.
- **Hues go in order and are never cycled.** Seven is the ceiling, and `W_CHART_MANY` at the eighth
  is asking you to fold rather than to colour.
- **One series draws no legend; two or more always draw one.** There is nothing to tell apart in
  the first case, and colour alone is never the answer in the second.
- **Label selectively.** `values` puts a number on every mark, which is a table drawn as a chart.
  Leave it off unless the reader needs the figures, and let the axis carry the scale.

## Size

A chart resizes by **its own box** — `w=` and `h=` on the fence — not by `aspect`. It has no natural
size the way an ELK diagram does: the same six bars are right at 320px in a margin and at 900px as a
hero, so the box is purely a choice and the plot fills whatever it is given. Absent, the theme's
`metric.chart.w`/`h` (560 × 320) are the defaults.

**A header costs 169 pixels of that height.** A `title=` or a `subtitle=` frames the item, and the
frame's padding twice, the header and the rule come off the box before the chart is drawn — so a
titled chart designed at `h=320` has 151px of drawing left in it and comes out squashed. The
reference boards are `h=420` for exactly that reason. Leave the title off and the chart is drawn
bare, like anything else on the paper.

## What it will say when it is wrong

| code | means |
|---|---|
| `E_UNKNOWN_KIND` | the first word of a line is not one of the twelve — the message lists them and suggests one |
| `E_CHART_FORM` | a second form line; the first one stands |
| `E_CHART_VALUE` | a word where a number or a `-` belongs — also a `min`/`max` that is not a number |
| `E_EXPECTED_ID` | a `series` or `slice` with no id |
| `E_DUPLICATE_ID` | two series or slices with one id; they share a namespace |
| `E_BAD_LEGEND` | `legend` followed by neither a placement nor a glyph and a label |
| `E_EXPECTED_VALUE` | `unit` with nothing after it, or a `key=` with nothing after it |
| `E_UNEXPECTED` | a token where a statement should start — usually a stray string |
| `W_CHART_LENGTH` | a series longer or shorter than the categories, or a slice given more than one value |
| `W_CHART_EMPTY` | no `series` and no `slice` — the axes are drawn and nothing else |
| `W_CHART_MANY` | more unhued series and slices than the theme has chart hues |
| `W_UNKNOWN_HUE` | a `hue=` outside the ten; it is dropped, and a near miss is suggested |
| `W_UNKNOWN_ICON` | an `icon=` naming nothing |
| `W_UNKNOWN_ATTR` | a `key=` that is neither `hue` nor `icon` |

There are no `Q_` findings for a chart: the quality scorer measures a laid-out graph — crossings,
routes over cards — and a chart has no routes. `quality: not measured` under one is expected.

## Drawing it

The library (`L`) opens on **Shapes** and then **Charts**: a working chart of each form — a grouped
bar, a stacked one, a line with a gap in it, a pie, and a donut with a hero — plus a bare `series`
and a bare `slice` to drop onto a chart that already exists. A new `chart` item starts as the
grouped bar.

With the item selected, the panel's Properties view is the whole body without the text: Form,
`stacked` and `horizontal` (bar only), the donut's Centre figure and caption (donut only), Legend,
Key rows (the `legend solid "…"` form: a glyph and a text each), Value labels, Unit, Min, Max and
Categories, and the *Add a series* / *Add a slice* buttons, which write the next free `series1` /
`slice1` and pick it. A second
click picks a series or a slice out of the chart, and that gives its Id, its Label, its Values (or its
Value) and the hue swatches — a new Id is the declaration alone, refused if another series or slice
has it; a double-click on a legend row or on a wedge's own number retypes the
label in place. Dragging a picked series or slice past its neighbour **reorders the statement**,
which is what moves it in the legend, in every bar group and round the circle.

There is no `+` handle and no connect handle on a picked series: a chart has no arrow grammar, so
there is nothing for one to write. The item's own handles are still there, and a board-level link
into `chart.web` lands on that series' marks.

A Mermaid `pie` or `xychart-beta` pasted into a fence is offered a **Convert** in the panel and
becomes one of these. What it cannot translate — a title, the second form of a combo chart — comes
through as a `%%` comment and is counted before the button is pressed.
