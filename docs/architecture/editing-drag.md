# Dragging a card and reaching what the file can say

> What a drop means in each dialect, the controls the file needed, and converting a Mermaid paste.

### Dragging a card

Every other drag on this board writes a coordinate. **This one cannot, and that is the whole
design.** ELK's layered algorithm has no fixed node — its `INTERACTIVE` strategies take a
coordinate as a *hint* and hand back a card near it, so a card dropped at a point would come to
rest somewhere else and the file would claim otherwise. And four of the five house layouts have an
axis that already *is* an ordinal: a lane band, a date, a commit's column, a participant's place in
the list. So the drop is read as what it said about the **structure**, and `src/edit/drag.ts` turns
that into one line of the fence moving. What comes back after the relayout is not to the pixel
where the pointer let go, which is the same honesty `resizeOf`'s `aspect` already states.

| Dialect | A drop means | Written by |
|---|---|---|
| `arch` `erd` `state` `class` `usecase` `c4` | onto a card → before or after it, in *its* container · onto a boundary → into it, at its end · onto the frame's padding → out, after the last top-level declaration | `moveStatement` |
| `flow` `activity` | the same, and a band is a container: onto another lane → into that `lane { }` | `moveStatement` |
| `mindmap` | onto another topic → re-indented under it, with its subtree | `moveTopic` |
| `sequence` | a participant header across its neighbour → its `participant` line moves · a drag between two lifelines → a new message, after the row above the drop | `moveStatement` · `insertStatement` |
| `chart` | a series or slice across its neighbour → its line moves, which is the order of the bars, the wedges and the legend | `moveStatement` |
| `timeline` | sideways → a new start date, snapped to a day, the range keeping its length | `redate` |
| `sketch`, any `layout=fixed` fence | anywhere → `x=`/`y=`, snapped to `metric.grid` | `setGeometry` |
| `gitgraph` | a branch's tip onto another lane → that branch merged into the lane's · a commit onto its neighbour on its own lane → the two swapped, where the history allows it | `gitMerge` · `gitMove` |

Ten things are load-bearing.

- **`alt` is the escape hatch, and it is not a nicety.** With a card picked, a press on it moves the
  card; on a board where every diagram has a pick standing there would otherwise be no way to move
  the *diagram* without pressing Escape first. Alt falls through to the item drag exactly as it was.
- **The card is the ghost — no clone.** A `.dag-node` is `position: absolute` with `left`/`top` from
  the layout, so a `transform` moves what is drawn and leaves `getBoundingClientRect()`'s *size*
  untouched, which is what the DEV size assertion measures. A clone would have duplicated the
  per-instance gradient ids `replaceIDs()` exists to keep unique, and `content-visibility` would
  have clipped it out of the item it was cloned from. Everything is painted inline and cleared on
  release; nothing reaches React until the drop.
- **The drop target comes out of the DOM, in one `closest()`.** `[data-dag-node],[data-dag-group],
  [data-dag-lane]` in a single selector gives the *innermost* of the three, which is the ranking a
  lane holding a group holding a card needs and which geometry would have to re-derive. The dragged
  card is `pointer-events: none` for the duration so it cannot answer for itself, and
  `data-dag-node-drag` turns the board links' hit strokes off for the reason a connect does.
- **`data-dag-group` is on the item as well as on a boundary** — both the board-level group and the
  boundary carry it — so a `closest()` that escapes the diagram reports the *item* as something to drop
  into. The hit has to be inside the item and not be it. Exactly the namespace hazard this file
  names, in its third incarnation.
- **"Before or after" is decided by the target's nearest neighbour, not by `dir`.** A reorder in a
  layered layout is a reorder *within* a layer, which is the axis **across** the flow: a `state`
  machine running RIGHT stacks two branches of one decision down the page, and a drop on the lower
  one is asking about y while `dir` says x. Global spread was the first answer and is wrong the same
  way — a third card in the next layer along dominates it and swings the axis back. The set of boxes
  includes the card being dragged, deliberately: leaving it out is what made two branches measure
  themselves against the decision instead of against each other.
- **The pointer's position arrives as a *fraction* of the thing under it**, not as a point in the
  diagram's coordinates. Converting would mean unpicking a frame's padding, a header, a timeline
  strip's overhang and the canvas zoom; the element's own client rect answers the only question a
  drop asks — which half — exactly, and agrees with what the reader can see by construction.
- **A drop outside the item is refused for a structural drag and ignored for a fixed one.** A card
  let go two hundred pixels away on the paper is not asking for anything a fence can say. But a
  sketch's frame is sized to its content, so moving a box clear of everything else *means* leaving
  the item — refusing that would refuse the commonest move on the one canvas whose premise is
  hand-placed geometry.
- **Reordering moves the order within a layer, never the layer.** `forceNodeModelOrder` — what
  `aspect=0` turns on — is a crossing-minimisation setting; which layer a card is in is decided by
  the edges, and no amount of moving a line changes that. Dragging the head of a chain past its tail
  rewrites the file and the drawing does not move, correctly. `col=` is what a person who meant it
  says instead.
- **`col=` is a rank, not an index.** `elk.partitioning.activate` constrains the partitions against
  each other and then *compacts*, so a lone `col=4` on a three-card chain moves nothing — there is
  no other partition for it to come after. Two numbers hold two cards apart, which is the useful
  half. The panel offers the column a card is drawn in, which is a good number to start from and
  not a promise about the answer; `test/layout.test.ts` holds both halves. It reaches inside a group
  under `hierarchy: separate` too, because the option is set on every group one of whose children
  carries one — the group is the pass that lays them out.
- **The ELK option is absent, not merely inert, when nobody wrote a `col=`.** That is what lets the
  frozen `route-quality` totals over the reference boards stand as evidence that this changed
  nothing about how anything is drawn.

A **`gitgraph` commit** is dragged only where the history can say what the drop meant. A column is
a commit and a lane is a branch, both ordinal and both the file's, so a coordinate means nothing —
but two drops do. The **tip** of a branch let go on another lane (the band, or a commit drawn in
it) is that branch merged into the lane's: `gitMerge` appends the `checkout` and the `merge`. A
commit let go on the commit just before or after it on its *own* lane is the two swapped, and
`gitMove` refuses that unless nothing else descends from the earlier one. Everything else — a
commit from the middle of a branch over another lane, a drop on the paper — writes nothing. Both
writers read the whole history, which is why they are in `src/dsl/graph/gitgraph.ts` beside the
parser rather than in `restate.ts`; see *A git graph's lanes* in `editing.md`. A **sequence
message** cannot be dragged at all, by construction rather than by a rule: only a participant
header carries `data-dag-node`, so a message can never be picked in the first place.

`AxisScale` on `Placed.axis` is the timeline's half of this — the three numbers that invert
`x = ((t − min) / span) · px`, published because a drag along the page is asking for a *value* and
recomputing the mapping in the editor would be a second copy of `layoutTimeline`'s arithmetic. It
rides in `data-dag-layout` beside the boxes, and the ticks do not: a `data-` attribute is not where
a drawing goes.

### Reaching what the file can say

The board file has always been able to say more than the canvas could. `hidden`, `aspect`, `frame`,
`page`, a node's hue and a link's label were all expressible in the document and reachable only by
typing into it, and two things — a board, a page — could not be made from the app at all. This is
that list, closed where closing it was honest.

- **A diagram resizes by `aspect`, not by `w`.** `resizeOf()` in `src/board/types.ts` says which of
  the three a type is — and `resizeOfItem()` beside it asks the same thing of an *item*, which is
  the honest form of the question wherever one is in hand: a fence opened `layout=fixed` is drawn by
  `layoutSketch` and has stopped folding, so `aspect` there is an ELK option nothing consults. `md`
  and `image` own their box. A diagram's box is the layout's answer, so
  its handle sets the shape ELK folds towards and `w=` is removed with it; only the two side handles
  appear, because width is the whole of that instruction. `OWN_LAYOUT` — `flow`, `activity`,
  `sequence`, `timeline`, `gitgraph` — gets no handles at all: those five ignore `aspect`, so a
  handle that wrote one would be the same lie in a different attribute. **The two exceptions are the
  two layouts of our own that are not in `OWN_LAYOUT`**, and both are `box`, with all eight handles:
  `sketch`, because its coordinates are the author's so its box is too, and `chart`, because it has
  no natural size at all — the same six bars are right at 320px in a margin and at 900px as a hero,
  so `aspect` would fold nothing and `none` would leave the one type whose size is purely a choice
  with no handle. What comes back after an ELK relayout is not to the pixel where the pointer let
  go, and that is the honest answer.
- **A card knows its line.** `declaredAt()` in `src/dsl/declared.ts` maps a node id to the line that
  declares it, and the panel selects that line in the source — the browser's own selection, because
  a `<textarea>` cannot be styled per line without a second element tracking its wrapping.
  `declaredOn()` is the inverse. **The pick decides; the caret feeds it.** The strip followed
  the *caret* once, and it follows the *pick* now, with the caret feeding it through `declaredOn`.
  Still one source of truth, and arrowing down the source still walks the cards — see *Picking a
  node*.
- **The properties strip writes one line.** `src/dsl/restate.ts` sets `hue=`, `icon=` and the status
  flag on a single statement, through the tokenizer — `stop` inside `"we stop here"` is a `string`
  and cannot be mistaken for the flag, and `state done "Done"` keeps its id. Reserialising the IR
  would have been a second writer for the whole grammar, reformatting every line it touched. The
  hue is read back off the *line*, not off the IR, because `finalize()` has already inherited a
  group's hue onto its children and the strip would otherwise offer to write what a card is already
  showing.

  **`restate.ts` now covers the whole statement**, on the same argument: the title, the meta, the
  desc, the kind, the flags, the rows, the arrow, the label, and the deletes and moves that span
  several lines. Each one is still a span in and a span out — a chain that loses its middle is
  *split* into slices of the line it was written on, so the author's spacing, quoting and trailing
  comment come through untouched, and it is never collapsed to `a --> c`, which is transitivity
  nobody asked for. Two things bit, both of them cases where a word is not what it looks like.
  **The token after a kind word is the id, whatever it is called** — `state done` with no title had
  the flag scan reading `done` as the status and offering to overwrite the node's name; the scan
  starts past the id now, which is a position rather than a word, and `setStatus` was quietly wrong
  about this before anything else needed it. And **deleting a group deletes ids nobody can see**:
  the block goes with the statement, so every id declared inside it is dead too and the edges
  naming *those* have to go as well — anything less leaves a board that does not parse, which is
  the one thing a writer here may not produce. One caveat went away:
  `setEdgeHue` wrote an attribute `parseEdge` did not read, because an edge's hue was derived in
  `finalize()` from its source's and a `hue=` on an edge statement landed in `modifiers().extra`.
  `parseEdge` reads it now, and the derivation still fills in an edge the author left alone.
- **Pages are a patch op.** `MetaOp` (`{ meta: … }`) merges keys into the frontmatter and is applied
  *last*, since frontmatter sits before every item and rewriting it first would move every offset
  `locateItems` computed. It rides in `applyPatch` rather than in a route of its own so a page added
  and a card moved onto it are one history entry. The whole `pages` list travels on every write:
  `parseBoard` derives it from what the items use when the frontmatter declares none, so writing
  only the new page would drop the ones it had inferred.
- **A board is a file, and the list can make one.** `/create`, `/rename`, `/duplicate` and
  `/delete` are the list's operations on it, and the last three carry the board's `.assets/` with
  them — an image lives beside the board that pasted it.
  Every question is asked *in the row* rather than through `prompt()` or `confirm()`: a modal dialog
  blocks the page, cannot be styled, and cannot be driven by the suite that has to prove it works.
- **The theme choice outlives the tab.** `localStorage`, the same argument as the library's open
  state — a preference about this window, not part of what a `?board=…` link means. `?theme=` still
  outranks it, because `snapshot.mjs --theme` and every Playwright check are that, and a preference
  remembered in a browser must not change what a screenshot shows. A board's own `theme:` comes
  before it unless the reader turned on *Use my theme on every board* (`settings.md`).
- **A Mermaid paste converts.** `src/dsl/from-mermaid.ts` is the other half of `detectMermaid`:
  `flowchart`/`graph` → `flow`, `erDiagram` → `erd`, `sequenceDiagram` → `sequence`, and `pie` and
  `xychart-beta` → `chart`. It is offered
  only where the detector is already certain — a header means the block is another language end to
  end — and it changes the fence's *type* as well as its body, which is why `SetOp` grew `type`. See
  *Converting a paste*.

Two of those needed something further down to give: `ready` no longer requires an item, because an
empty page is legitimately finished the moment it is parsed and a page somebody had just added would
otherwise never fire `data-dag-ready`. And `SetOp.type` rewrites the block through `renderFence`,
because the info word is on the opening fence line and `rewriteFenceAttrs` deliberately only touches
what is inside the braces.

### Converting a paste

`detectMermaid` recognised a paste and printed a paragraph of prose telling a person what to write
instead; for forty lines that is an afternoon of retyping, which is why "importing Mermaid" was
listed as deliberately not built. `fromMermaid` writes it. Five things about it:

- **It converts the common core of five Mermaid families and says how much it did not.**
  `flowchart`/`graph` → `flow`, `erDiagram` → `erd`, `sequenceDiagram` → `sequence`, and `pie` and
  `xychart-beta` → `chart`. Anything inside them it cannot translate comes through as a `%%`
  comment rather than being dropped, and `left` counts those so the panel can say so before the
  button is pressed. A converter that silently loses a statement is worse than one that refuses: the
  loss is invisible until somebody reads the diagram and believes it.
- **`pie` is our own form word, and it took a predicate to tell the two apart.** A header that fired
  on the word alone would read the commonest chart body in existence as another language — in the
  parser, and in the Convert offer, which sniffs any fence body whatever its type. See *Charts*.
- **The test asserts the output *parses*, not that it looks right.** Handing an author a fresh crop
  of diagnostics about a language they did not write is the one outcome worse than no converter, so
  every case in `test/from-mermaid.test.ts` runs the result back through the real parser and insists
  on zero errors and on `detectMermaid` no longer recognising it.
- **A relationship may name a table Mermaid never describes.** Mermaid draws an empty box; here an
  id nothing declares is `E_UNKNOWN_ID`, so every entity is declared whether or not it had a block.
- **A hyphen is in both an id and an arrow.** `A-->>W` read as a participant called `a-` talking
  over `->>` until the id pattern allowed a hyphen only *between* alphanumerics — two phantom
  columns on every sequence with a return message in it.

Styling is not attempted and will not be: it is the theme's here (rule 2), so there is nothing to
write instead. `click` has no equivalent either — a board is a picture.
