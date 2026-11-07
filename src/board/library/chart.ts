import type { Blueprint } from "./types";

/**
 * The Charts section: the four forms, and the two statements every one of them is made of.
 *
 * Every other family in the library is a statement about a *system* — a service, an entity, a lane
 * — and the panel's sections are named for what those statements are made of. A chart is data, and
 * a person reaching for one is thinking about the shape their numbers should take, which is why
 * `categoryOf` sends the whole dialect to one section rather than spreading it across three.
 *
 * **There is nothing at layer 1 or 2, and that is the grammar rather than an omission.** The plan
 * asked for four form molecules — the smallest working `bar`, `line`, `pie` and `donut` — beside
 * five worked starters. A blueprint at layer 2 or below is a *fragment*: it is dropped onto a
 * diagram of its own type and appended to that diagram's body. A form word appended to a body that
 * already has one is `E_CHART_FORM`, so nothing carrying a form line can be a fragment, and a form
 * line is the only thing that would have told the four apart. They are layer 3 — one whole board
 * item, which is exactly what a chart with a form and its data *is* — and they are the same five
 * charts the starters were, at the one size that earns a row in the panel.
 *
 * What is left at layer 0 is `series` and `slice`, which is the whole of the droppable vocabulary:
 * both parse in every form with a meaning of their own, so either one lands clean on any chart on
 * the board. `x`, `unit`, `legend` and the rest are single directives a chart may hold exactly one
 * useful copy of — a second `x` line lengthens the categories and leaves every series short — so
 * they belong in the starters that already say them, not in the panel as things to drop.
 *
 * **A value count is a contract with the categories.** The `series` atom carries four, because the
 * `chart-bar` template it is appended to has four quarters and a series that disagrees warns
 * `W_CHART_LENGTH` — a component that lands with a diagnostic under it is what the library test
 * exists to prevent.
 *
 * **No hue, on purpose.** A series or slice the author did not hue takes the next colour from the
 * theme's own ordered list, which is where the separation between two adjacent series is
 * guaranteed; writing one into a ready-made would spend that guarantee on nothing. The single
 * exception is the "Other" wedge of the donut, which is a fold rather than a series and wears the
 * theme's most muted hue to say so.
 */

const datum = (
  id: string,
  name: string,
  description: string,
  icon: string,
  source: string,
  props: Record<string, string>,
  slot: string,
): Blueprint => ({ id, layer: 0, type: "chart", name, description, icon, source, props, slot });

export const CHART_ATOMS: Blueprint[] = [
  datum("part-chart-series", "Series", "chart · a value per category: one line, or one group of bars.", "LineChart",
    'series ${self} "${title}" ${values}${?attrs}',
    { title: "Series", values: "12 18 9 14", attrs: "" }, "s"),
  datum("part-chart-slice", "Slice", "chart · one value: a wedge of a pie, or a bar of its own.", "PieChart",
    'slice ${self} "${title}" ${value}${?attrs}',
    { title: "Slice", value: "30", attrs: "" }, "sl"),
];

/**
 * Layer 3: one whole chart, one per form — and the stacked bar, because piling and grouping are
 * two different questions asked of the same numbers.
 *
 * Composed of the two atoms above, so the day a `series` statement gains a default every one of
 * these has it. The literal lines between them — the form, the categories, the unit — are the
 * directives that have no atom, for the reason above.
 */
export const CHART_DIAGRAMS: Blueprint[] = [
  {
    id: "chart-bar",
    layer: 3,
    type: "chart",
    name: "Bar chart",
    description: "Two series across four quarters, side by side.",
    icon: "BarChart3",
    parts: [
      "bar",
      "x Q1 Q2 Q3 Q4",
      { use: "part-chart-series", props: { id: "web", title: "Web", values: "120 140 160 180" } },
      { use: "part-chart-series", props: { id: "mob", title: "Mobile", values: "40 60 90 130" } },
      'unit "k€"',
    ],
  },
  {
    id: "chart-bar-stacked",
    layer: 3,
    type: "chart",
    name: "Stacked bars",
    description: "Three series piled to a total per quarter.",
    icon: "BarChart3",
    parts: [
      "bar stacked",
      "x Q1 Q2 Q3 Q4",
      { use: "part-chart-series", props: { id: "web", title: "Web", values: "120 140 160 180" } },
      { use: "part-chart-series", props: { id: "mob", title: "Mobile", values: "40 60 90 130" } },
      { use: "part-chart-series", props: { id: "api", title: "API", values: "20 35 55 70" } },
      "legend bottom",
    ],
  },
  {
    id: "chart-line",
    layer: 3,
    type: "chart",
    name: "Line chart",
    description: "Three latency percentiles over six months, one of them missing a reading.",
    icon: "LineChart",
    parts: [
      "line",
      "x Jan Feb Mar Apr May Jun",
      { use: "part-chart-series", props: { id: "p50", title: "p50", values: "120 118 124 119 115 112" } },
      /* `-` is a gap: the month nobody measured, drawn as a break rather than as a plunge to zero. */
      { use: "part-chart-series", props: { id: "p95", title: "p95", values: "240 260 250 - 232 228" } },
      { use: "part-chart-series", props: { id: "p99", title: "p99", values: "480 520 505 498 470 455" } },
      'unit "ms"',
    ],
  },
  {
    id: "chart-pie",
    layer: 3,
    type: "chart",
    name: "Pie",
    description: "Where the traffic comes from, in five slices.",
    icon: "PieChart",
    parts: [
      "pie",
      { use: "part-chart-slice", props: { id: "direct", title: "Direct", value: "34" } },
      { use: "part-chart-slice", props: { id: "search", title: "Search", value: "28" } },
      { use: "part-chart-slice", props: { id: "social", title: "Social", value: "18" } },
      { use: "part-chart-slice", props: { id: "referral", title: "Referral", value: "12" } },
      { use: "part-chart-slice", props: { id: "other", title: "Other", value: "8" } },
    ],
  },
  {
    id: "chart-donut",
    layer: 3,
    type: "chart",
    name: "Donut",
    description: "A share of a whole, with the total in the hole.",
    icon: "Donut",
    parts: [
      'donut "1.2M" "users"',
      { use: "part-chart-slice", props: { id: "free", title: "Free", value: "62" } },
      { use: "part-chart-slice", props: { id: "pro", title: "Pro", value: "24" } },
      { use: "part-chart-slice", props: { id: "team", title: "Team", value: "10" } },
      { use: "part-chart-slice", props: { id: "other", title: "Other", value: "4", attrs: "hue=bronze" } },
    ],
  },
];

/** The starter a new `chart` fence begins as. `TEMPLATE_BY_TYPE` in `index.ts` reads this. */
export const CHART_TEMPLATE_IDS = ["chart-bar"];
