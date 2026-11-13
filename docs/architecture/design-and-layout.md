# Design rules and layout

> Design rules, the three ELK knobs and the six layouts that are not ELK's, what `data-dag-ready` means, and what was refused.

## Design rules

The diagram types share a handful of **design** rules, and some are enforced in code rather than
left to the author: a group's hue is inherited by what is in it, an edge takes its hue from its
source's group, and an edge into a `stop` node is drawn in the danger colour. See `finalize()` in
`src/dsl/common.ts`.

**There is no author-chosen accent.** "One blue thing per diagram: the subject" described `focus`,
an accent ring the author set, and it is gone — the accent now marks the card under the pointer and
nothing else. It was the one status that said something about the author rather than about the
system, it meant "the subject" in eight dialects and "where a record sits" in `state`, and one mark
cannot carry two meanings. `focus` and `current` still parse, warn `W_RETIRED_FLAG`, and are
ignored, so an old board draws. The properties view offers "Update it" for them — on the card that
wears one, and for the whole diagram in the item view — which takes the flag off (*Controls on the canvas*,
`editing.md`).

**A theme is the reader's, not the board's.** Every board draws in the theme chosen in Settings →
This vault → General (Appearance), or the one a `?theme=` URL names; a `theme:` in a board's frontmatter
changes nothing on screen. The line is ordinary frontmatter and stays in the file untouched — opening
a vault never writes a byte — so a board written before this decision keeps its text and simply draws
in the reader's theme. **It is not a diagnostic either**: a person has no action for a frontmatter
line that changes nothing, and the rule here is that a person only sees problems they can act on —
a one-click removal needs a control to sit in, and the Layout tab holds only the flow's two numbers,
so there is none. Snapshots and the
CLI's exports open `?snapshot=1`, which reads no preference, so they use the app's default theme
unless the URL names one. This is the same refusal as the accent one layer out: a document may not
decide how its reader sees it, and one vault must look the same board to board.

**The chrome has its own scale, apart from the diagram's** (#205). `theme.ui` holds the app's font
sizes and line heights, two weights, corners, three elevations, five layers, two durations and an
easing, control heights, the focus ring and spacing; `applyTheme()` writes them as
`--dag-ui-<group>-<step>`, with the group's unit (`UI_UNITS`), and `check:theme` proves every theme
has every group. They exist so the chrome stops typing its own numbers and stops borrowing the
diagram's: before, `--dag-metric-radius-chip` was every button's corner, so a theme could not round
a chip without rounding the app. `check-literals.mjs` counts the rules in `chrome.css` that still
type a font size, corner, shadow, layer or duration, against `scripts/chrome-literals.json`, and the
count may only fall. Every step is the value the chrome already used most, so a rule that moves onto
a token draws the same.

**The chrome's buttons are two components** (#207), `Button` and `IconButton` in
`src/ui/controls.tsx`, beside `Switch`, `Check` and `TextField`. The shell had 42 mixes of height,
corner, size, weight, fill and border, 16 to 37 px tall, and four kinds of primary — white with an
accent border, pale, solid and round. Now there are four variants — `primary` (solid accent: the one
action a card asks for), `secondary` (bordered, the default), `quiet` (no box) and `danger` — and
three sizes, `sm` 24, `md` 30 and `touch` 44, from `--dag-ui-control-*`, with the corner
`--dag-ui-radius-control` and the words `--dag-ui-text-*`. **Under 720px `md` is `touch` by
itself**, in the stylesheet, so no screen has to remember to grow its buttons on a phone; `sm` was a
choice and stays small. The classes are `dag-button--<variant>`, `dag-button--<size>`,
`dag-icon--<size>` and `dag-icon--danger`; a bare `.dag-button` is still the secondary at `md`, for
the screens that have not moved yet. `IconButton` is square and quiet, **needs an `aria-label`**,
and its tooltip is the drawn one (`Tooltip`) saying that label — or `tip` where the accessible name
carries more, with `shortcut` for the chord. A `title` passed to it is kept as the one tooltip and
none is drawn: that is how a control says a sentence rather than a name (*New*'s list of kinds, the
lock's hint). Without a label it renders nothing in development and says why on the console; a build
renders it anyway, since a missing control is worse than an unnamed one. `test/controls-button.test.ts`
holds the classes, the pass-through of every `data-dag-*` and the refusal.

The shell is on them: the sidebar's square tools, its close, the top bar's sidebar toggle,
Assistant and `⋯`, the home and no-vault cards, the dock, the zoom bar, the vault menu's forms and
*Remove from the list*, and the trash, lock and upload notices. What stays a `<button>` says why where
it is: a row of the sidebar or a list (full width, an ellipsis, the column's hover), a menu item (moved
by the arrow keys), the vault switcher (a picker's trigger), the wordmark, the folders and the title in
the top bar (words that go somewhere), the empty board's tiles (a key under each name), and the lock,
which is a glyph unlocked and a pill locked and must keep focus across the press. Out of scope: the
buttons inside the diagram, Settings (#186), the page tabs and the problems dock; the other local
families (`dag-prompt__btn`, `dag-run__button`, `dag-chat-send`…) fold in one screen at a time.

## Layout, per diagram type

Three knobs in `theme.metric.elk`, and each exists because a board looked wrong without it:

- **`aspect`** — the shape to aim for. Without it an architecture diagram is one 2400px row (the
  delivery chain beside the cloud). ELK folds a long chain into rows to hit the target.
  **`aspect: 0` turns wrapping off**, which is what `state`, `flow` and `activity` want: a funnel
  that wraps stops reading as a funnel, and ELK reorders the states to fit the target rather than
  leaving them in the order they were written. A `mindmap` is `0` too: it was `1.2` until 0.4.0,
  and ELK folded any map wider than that into rows, drawing grandchildren under the root, left of
  the topic they hang from. Big maps are tall and never tripped it; the small map a person grows
  from the keyboard always did (`e2e/mindmap.spec.ts`, *a small map is never folded*). **A board can override it on the fence** — an
  `arch` item opened `{#pipeline aspect=0}` — **and a diagram's two side handles now write it**,
  which is what a person pulling a diagram wider is actually asking for — because the theme's figure
  is a house default for the type, not a fact about every diagram of it: a pipeline drawn as `arch` really is one chain, and the fold that
  saves the average architecture diagram is what destroys that one. Anything but a number ≥ 0 is
  `EB_BAD_ASPECT`. The item view's *Wrapping* select writes all three states — off the line, `0`, a
  ratio — and the problems dock's repair for `EB_BAD_ASPECT` takes the bad value off (`editing.md`,
  *Settings that had no source-free way in*).
- **`hierarchy`** — `separate` lays each group out on its own and then arranges the boxes; `include`
  is one global pass. `separate` is what makes the ERD look hand-drawn: domains side by side,
  entities stacked, every group hugging its content. Under `include` one direction serves both axes
  and groups come out hundreds of pixels taller than what is in them. `include` still wins where the
  diagram really is one flow.
- **`colGap` / `rowGap`** — ordinary spacing.

A fourth knob is the *author's* rather than the theme's: **`col=` on a node** switches on
`elk.partitioning.activate` and pins how far along the flow that card sits, while ELK still chooses
where in the layer it goes. It is a rank rather than an index and the option is absent when nobody
wrote one — see *Dragging a card* for both, and `docs/dsl/common.md` for the grammar.

**Cross-boundary edges are hoisted** to the nearest sibling ancestors before ELK sees them
(`hoist()` in `elk.ts`): ELK ignores an edge whose endpoints are not siblings, and without the hoist
the groups look unconnected and stack in a column. The router still anchors the real endpoints, so
the drawn edge starts on the entity it belongs to.

That applies to **every** type, not just the `separate` ones, and it did not until a data pipeline
was drawn as `arch`. `SEPARATE_CHILDREN` is ELK's default and nothing here sets `hierarchyHandling`,
so an `include` diagram is in the same mode — `include` decides only whether a group gets its own
direction and spacing. Hoisting was gated on it anyway, so an `arch` whose flow *ran through* its
groups had every one of those edges dropped from layout: the sources group was placed below the
cloud it fed, Power BI above it, and no amount of rewriting the board could move them, because as
far as ELK could see nothing connected them.

**Six layouts are ours, not ELK's**, each because the diagram has an axis ELK has no concept of —
or, in the last two's case, because it has no axis at all and because its axes are numbers:

- `layout/lanes.ts` — `flow` and `activity`. A swimlane has two axes: the column is how far along
  the flow you are, the band is who does it. ELK's `partitioning` orders layers *along* the flow,
  not bands across it.
- `layout/sequence.ts` — columns across, a clock down. One pass over the event list; the order in
  the file is the order on the page, which is the only property a reader relies on.
- `layout/timeline.ts` — x is real time (linear in days, not one column per entry), y is a packing
  problem.
- `layout/gitgraph.ts` — a column per commit, a lane per branch. Both ordinal, and ELK would
  reorder the commits to reduce crossings, destroying the only ordering the diagram has.
- `layout/sketch.ts` — `sketch`, and any fence opened `layout=fixed`. The coordinates are the
  author's, so there is nothing to compute; see *The free canvas*. Its branch is **first** in
  `layoutGraph`, and has to be: `layout=fixed` on a `flow` fence means the bands stop placing
  things, and a check made after the lane branch would never be reached.
- `layout/chart.ts` — `chart`. Nothing here is a *thing being placed*: a bar is a value on a scale
  and where it goes is arithmetic, so this is a scale, a run of rectangles and an arc rather than a
  packing problem. It never reaches `layoutGraph` at all — `client.ts` branches on
  `model.kind === "chart"` before ELK, synchronously, as it does for `sequence`. See *Charts*.

`sequence` and `chart` are the two dialects whose **model is not a `Graph`** — `dsl/sequence.ts` →
`SequenceModel`, `dsl/chart.ts` → `ChartModel`. Two messages between the same pair are two moments,
not one relationship drawn twice; and a series is not a group. `OWN_MODEL_TYPES` in `ir.ts` is the
list and `hasGraph()` in `parse.ts` the predicate every guard that means "not a `Graph`" now calls.
`Layout` in `layout/types.ts` is the union; `DiagramItem` branches on `kind`.

## `data-dag-ready` means *finished*

The snapshot script and the Playwright gate both wait on it, and the bar is higher than it looks:
**every item has reported its own measured size**, which for a diagram happens only once its layout
comes back. The earlier version waited on "every item has a position", which is true the moment a
board is parsed — items get a placeholder box — so a snapshot could catch a board of empty frames.
Two related rules follow:

- **`main.tsx` waits for `document.fonts.ready` before the first render.** Sizing measures text, so
  a layout computed against the fallback face is a *different layout*. Measuring twice and
  re-laying out is worse: the diagram visibly resizes after paint and a screenshot catches neither
  state.
- **`npm run e2e` fails on any console output.** The dev-only size assertion in `DiagramItem`
  reports through `console.error` when a card renders at a different size than it was laid out at —
  a check no screenshot comparison would catch, because a uniformly-too-tall diagram looks fine
  until two cards touch.

## Deliberately out

Each of these was *refused* rather than deferred:

- **A coordinate inside an automatically laid out diagram.** A `sketch` or a `layout=fixed` fence is
  where one belongs and Detach is how a diagram becomes one; there is no half-way, because ELK's
  `INTERACTIVE` strategies take a coordinate as a hint and hand back a card somewhere near it, and a
  file that claims a position the drawing does not have is worse than no position at all.
- **Dissolving a group.** Delete on a picked group takes its children with it, which is what
  `removeNode` documents and `restate.test.ts` freezes. Re-parenting one level up is what *ungroup*
  means, and it wants a `dissolveGroup` writer and a button of its own — see the end of *Controls on
  the canvas*.
- **A coordinate for a `gitgraph` commit, or dragging a `sequence` message.** A commit's column and
  a branch's lane are both ordinal and both the file's, so a drag there is a merge or a swap, never
  a position; a message is not draggable by construction, since only a participant header carries
  `data-dag-node`. See *Dragging a card*.
- **A custom colour.** Ten hues, and `check-literals.mjs` is why: a hex typed into a board is a
  colour the theme does not own, and the swatches are `HUE_ORDER`. A chart is where that costs the
  most and it still holds: `color.chartHues` is seven *names*, and past the seventh a series draws
  muted with a `W_CHART_MANY` rather than taking a generated eighth.
- **A sequential or diverging scale.** No theme has a ramp — a hue is one colour plus a runtime
  `color-mix` tint, by design — so "light to dark in one hue" has nothing to be made of, and the two
  places that want one (a heatmap, a choropleth) are not among the four forms. Categorical is the
  only encoding a chart has, and the doctrine's own rule about it (fixed order, never cycled) is
  what `chartHues` implements.
- **Darker chart-only hue steps for `paper-dark`.** Every one of the ten hues fails the
  doctrine's dark lightness band — they sit at OKLCH L 0.68–0.73 against a 0.67 ceiling, because
  they were tuned to read as *text* on a dark ground rather than as marks — and no subset or reorder
  fixes a per-swatch check. A second set of steps is the fix and it is a **design-system** decision,
  not a chart's: the theme's hue set is one colour per hue on purpose, and the first thing to add a
  second should not be the fourteenth diagram type.
- **`tabular-nums` on the ticks**, which the doctrine explicitly asks for. Canvas `measureText` does
  not apply the feature, so the rendered width would stop matching the measured one — and the left
  margin *is* the widest measured tick, and "no two labels overlap" is an invariant of the layout
  rather than a hope. A typographic improvement that silently breaks the two things holding the
  drawing together is not one.
- **An icon on a series or a slice.** `icon=` parses, is checked against the icon vocabulary, and
  draws nothing: a chart's key is a swatch, which is the identity the marks already carry, and a
  brand mark may not be tinted — the vendor packs' licence rule — so it would name a series
  in a colour that is not that series'. The value is read rather than dropped, so a board that
  carries one keeps it.
- **A second `data-dag-node` for the legend row.** A legend row names a series that already has one,
  and two elements answering for one id is exactly the namespace hazard this file has now recorded
  three times: `nodeUnder` would find whichever came first in document order. `data-dag-title-of` on
  the label is what makes a legend row pick and rename instead, which is one hook rather than a
  second identity.
- **Un-hiding from the canvas.** `hidden` has a checkbox and a key, and both are one-way: a hidden
  item leaves `selected`, so nothing on the board can reach it to turn it back on. The file can, and
  that is the only route today.
- **The candidates-and-cost label placement**, which `src/quality/` already measures.
