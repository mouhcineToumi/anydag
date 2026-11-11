# The free canvas

> `sketch`, `layout=fixed`, geometric shapes, the pen's stroke and pictures.

## The free canvas

Twelve dialects, and every one of them a grammar for a *kind of system*: what runs, what stores,
what a record can become. Their whole value is that the author never says where anything goes.
`sketch` is the opposite claim: the author does say where everything goes, and it is the one
exception to the rule the other twelve hold — a grammar describes structure and never computes
pixels.

**`sketch` is a thirteenth dialect and not an item kind**, which is the decision the rest follows
from. A fence is an item, so a sketch inherits every gesture, snap, group, tidy, undo, clipboard,
export and link for free; a new item kind would have had to be plumbed through each of them, and
`resizeOf`, `TEMPLATES`, `locateItems`, `applyPatch` and the library would each have grown a case.
It also inherits the grammar: `hue=`, the status flags, a container, the shared arrow table, and
`E_UNKNOWN_KIND` naming its own vocabulary when somebody writes `rectangle`.

Its composition algebra is the third one, beside the two `library/types.ts` names. In `arch` and its
seven cousins a container is a brace and composition is nesting; in `sequence` and its three,
position in the file carries the meaning; here **coordinates carry the meaning**. `box`, `text`,
`button`, `input`, `img` and `sticky` are the vocabulary; `line` is not one of them, because a line
with no head is `---` and the arrow table already spells it.

**`layout=fixed` is the same claim about any of the other twelve** — the twelve that are laid out
for you, `chart` being neither those nor this — and it is a fence attribute rather than a dialect
for the reason a header is: an `arch` of three boxes somebody arranged by hand is still an `arch`,
with the same cards, hues, icons and edges. It parses in `parseBoard` beside `frame`, rides in the
item's `hash` — it changes the *parse*, not only the layout — and reaches `parseWith` as an
argument, because it has to be true before the first token goes past. A chart has no node to place,
so writing it on a chart fence is read and then ignored.

Seven things are load-bearing:

- **A sticky's hue is bound in the parser, never defaulted in the component.** `sketch.finish()`
  writes `hue = "ochre"` onto a sticky that has none, and it runs after `finalize`, so a sticky
  inside a group the author hued keeps that hue. This is the `hueVars()` rule applied one layer
  earlier: a component that reached for a colour when it had none would be thirteen more copies of
  one default, in a new place.
- **`sketch` turns the automatic group hue off** (`Dialect.autoHue`). Every other dialect hands an
  unhued group the next hue in `HUE_ORDER`, and that hue then *inherits onto its children* — so a
  phone frame would have arrived indigo with every field in it tinted to match. Greys are the
  drawing here; an explicit `hue=` still inherits, which is the half of the rule worth keeping.
- **`0` is a coordinate.** `modifiers()` had always read `w=` as `Number(value) || undefined`,
  which is harmless for a width and silently wrong for an origin: `x=0` came back `undefined` and
  the shape fell into the auto-placement grid instead of sitting at the top-left corner it named.
  `numberOf()` is that line, spelled so it can say zero.
- **A coordinate outside a fixed fence is read onto the node *and* warned about.** Dropping it would
  mean retyping every `x=` after switching a fence over; keeping it silently is what `extra` did, and
  what let `hue=purple` produce nothing at all. `W_UNKNOWN_ATTR` covers every unknown `key=`, and the
  known list has to include `kind` and `dir` — two working undocumented overrides `parseNode` and
  `parseGroup` read out of `extra`, which nothing had ever written down.
- **`layoutSketch` is a passthrough that still does four things**: snaps to `metric.grid`, resolves a
  container's children against its origin, places what has no coordinate, and routes. The third is
  what makes a freshly detached fence draw at all — thirty nodes and not one `x=` — and it starts
  *below* everything already placed, so a shape dropped from the library never lands on the last one.
  A container grows to hold what is in it whatever its declared box says: `test/layout.test.ts` holds
  every layout to "a node stays inside its group", and a container that clips its own contents is
  never what anyone meant.
- **The frame hugs the drawing, on every side.** The drawing's top-left is drawn at the frame's
  corner whatever the file says it is — negative, zero or `480` — and `Placed.origin` (published in
  `data-dag-layout`) says where the file put it. It used to translate only a *negative* corner,
  which kept `x=-40` inside the frame and left `x=480` 480px into it: a lone shape dragged right sat
  at the far end of an empty rectangle three times its size, and one dragged left did not move at
  all. So the numbers in the file are the drawing's *shape* and the fence's `x=`/`y=` is
  where it stands, and a writer that moves the corner moves the fence by the same amount in the same
  op — see *Things that will bite*. `parseAttrs` reads a negative number for the same class of
  reason. **A line or a label the boxes do not hold moves them**: a back
  edge along a row bows above it, so `layoutSketch` routes, moves every box clear of whatever line
  or label reaches past the top or the left by whole grid steps, routes again, and sizes the frame
  to the lines and labels too — `layoutGraph`'s `labelReach` rule, with `routeReach` beside it.
  The move comes off `origin`, so a box plus `origin` is still the file's number.
- **A shape, a group and a frame each take a width and a height from the panel.** The eight handles on
  a sketch scale the whole drawing, so one shape's own `w=`/`h=` — or a frame's — had only the source;
  the properties view's Width and Height write them on that one statement (`setExtent`), in a `sketch`
  and in any fence opened `layout=fixed`.
- **`resizeOf("sketch")` is `box`.** `aspect` would be a lie, since nothing folds, and `none` would
  leave the one type whose whole premise is hand-placed geometry with no handle at all.

Two smaller traps. `.dag-sketch` deliberately does **not** extend `.dag-node`: a card has a fill, a
border and a hue that say it is a thing in a system, and sharing the class would have meant unsetting
most of it six times and would have leaked the next `.dag-node` rule into the one drawing that is
meant to have no opinions. And the sketch container's style needs the *dialect*, which a `Group` has
no way to know — a group is a group in every language — so `DiagramItem` passes `graph.type` down and
`Group` adds `dag-group--sketch`, two class names deep so it outranks `.dag-group[data-level="1"]`.

`theme.metric.sketch` is twenty-three keys, byte-identical in all three themes, so `metricsHash()`
still matches across a theme switch. The library's **Shapes** section holds one atom per kind, a
`Frame` molecule and the `Wireframe` starter `TEMPLATES.sketch` is derived from, and it sorts first
after *Generate*: a person opening that panel to *draw* is not thinking about layers.

### Geometric shapes

`sketch` holds geometric shapes — circles, triangles, rectangles, and any other possible shape that
could be used in diagrams — each holding text and each linkable. Sixteen kinds, listed once in
`SHAPE_KINDS` (`src/dsl/ir.ts`) and one-to-one with their words, so the kind menu, `E_UNKNOWN_KIND`
and the renderer read the same list. Five things are load-bearing:

- **One outline, two readers.** `src/layout/shapes.ts` computes each outline from the box —
  `outlineOf` returns the path `SketchShape` strokes *and* the hull the router casts at — so the
  drawing and the routing cannot disagree about where a triangle's side is. Pixels from the box,
  never a unit `viewBox` stretched with `preserveAspectRatio="none"`: that bends a circle pulled
  wide into an egg with a calligraphic stroke. Arithmetic in `src/layout/` is exempt from
  `check-literals.mjs`, and none of it is a style value.
- **`onOutline` moves an anchor in along its side's normal and nowhere else.** `route.ts` puts every
  anchor on a box side, fanned; the anchor keeps its place *along* the side, so a fan stays a fan,
  and only its depth changes — to the first place the ray meets the hull. The normal is also the
  direction the curve leaves in, so nothing downstream had to learn the anchor moved. The same call
  is made in `sideArc` and for the detour's alternative side, where anchors are recomputed. Curves
  the router has no use for are a simpler hull: a cloud is its ellipse, a cylinder, a document, a
  stadium's flat sides and a callout's bubble are their rectangles. A ray that misses keeps the
  rectangle's point, which is no worse than before.
- **A board link meets the outline too.** `InnerBox.shape` is set by `DiagramItem` for any node whose
  kind is a shape, and `routeLinks` hands it to the same `onOutline`. `sameBoxes` in `App` compares
  it, or turning a circle into a diamond in the same box would not re-route anything.
- **A link naming a one-node item lands on the node** (`solo` in `routeLinks`, computed in `App` for
  graph dialects only — a chart of one series is still a chart). A lone shape's frame is bare
  padding nobody can see, and a line stopping there stopped short of the only thing drawn; for a
  triangle, short by a quarter of it. It applies to the one-node atoms as well, which moved the
  arrows on `reference/components` by the 8px of `frame.barePad`.
- **A lone shape's handles mean the shape.** `loneShape()` in `src/edit/build.ts` is a bare `sketch`
  with one node and no group; `resize` then writes that node's `w=`/`h=` — by exactly the change in
  the item's box, read off `data-dag-layout` — and removes any `w=`/`h=` on the fence, in one op. The
  fence's size would otherwise have widened an empty frame around a circle that stayed the size it
  was — the same bigger-empty-box defect, one dialect over.

The words sit in `textBoxOf` — the part of the box the shape can hold, a triangle's base, a bubble
without its tail — centred, wrapping and clipped, never sizing the shape. A circle, a triangle, a
star, a pentagon and an octagon default square (`shapeSide`), and given one side a square shape
stays square; the rest default `shapeW` × `shapeH`. Hued, a shape fills with the tint and strokes
in the hue — the sticky's rule; `box` keeps its own. The hover ring and the pick outline every node
wears are rectangles, so on a shape they are unset and the **outline** takes the accent instead.
`suggest.ts` points `rectangle`, `oval`, `rhombus`, `pill`, `bubble` and a few more at the right word.

### The pen's stroke

`ink` is the seventeenth word in this vocabulary and the only one nobody types: the pen writes it.
The statement is `ink <id> pts="0,0 14,9 …" x= y=`, the points whole numbers in the stroke's own
space with their minimum at `0,0`. `pen` is the third `Tool` beside select and hand, reached with
`space B` (`p` is the prompt card's).

**The file holds a polyline and the browser draws a curve.** A release is simplified
(Ramer–Douglas–Peucker, ε = 3 *screen* pixels divided by the zoom — an epsilon that reads well on the
glass destroys a stroke drawn zoomed out), normalised so its minimum is `0,0`, and written as whole
numbers; the smoothing is Catmull-Rom in the renderer. So retuning how ink *looks* changes no byte
any board carries. **The position is on the node's `x=`/`y=` and never in the path**, which is what
makes moving a stroke a two-number edit rather than a rewrite of eight hundred. It splits over three
files because the layers force it: `src/dsl/ink.ts` is the grammar and the simplification (`src/edit/`
needs both and may import `src/dsl/`), `src/layout/ink.ts` is `inkPath` (a tension constant is a
style literal in `src/render/` and geometry in `src/layout/`), and `src/edit/ink.ts` is
`inkStatement`, the release with no pointer in it. Four things are load-bearing:

- **`ink` is deliberately not a `ShapeKind`.** So an arrow into a stroke stops at its bounding box:
  the router falls back to the rectangle for anything it has no hull for.
- **A stroke takes no title, and the rename is refused on it.** The grammar reads a title slot and
  the renderer draws nothing for it, so a rename box would set a title nothing draws.
- **The pen's `insert` does not select what it just wrote** — the only caller that does not. The pen
  stays armed, so a selected stroke would wear handles and the selection bar after every stroke, none
  of them clickable, and Escape would clear the selection instead of putting the pen down.
- **The pen skips `DRAG_SLOP` and captures on the press**: the first few pixels are the stroke. A
  double-click is refused too — two quick strokes are two strokes.

A flat stroke — a line ruled under a word — has zero extent on one axis, so `scaleInto` centres a
degenerate axis instead of dividing by it.

What belongs in *this* section is the one thing it says about the
dialect: a stroke is the third kind of thing `sketch` holds — after a wireframe
part and a geometric shape — and it is the only one whose box is neither a theme default nor a
measured text, but the extent of what somebody drew. `theme.metric.sketch.inkW` is its single
theme key, 2 in all three; its colour is `hue=` or the ink, and there is no pen colour picker for
the reason there is no custom colour anywhere.

`docs/dsl/sketch.md` is the cheat sheet. `boards/reference/sketch.board.md` is the fixture — a login
wireframe, a sticky wall, an `arch` opened `layout=fixed` so both halves are in the baselines, all
sixteen shapes in two rows with a lone cloud linked into one of them, and three pen strokes — a
tick, a deliberately flat underline for the degenerate-axis path, and a circled annotation with a
board link running from it onto a lone stroke.

### Pictures

    figure buyer "Customer" icon=emoji:person x=0 y=0
    figure van "Delivery" icon=emoji:delivery-truck x=200 y=0
    buyer --> van

`figure` is the fourth kind of thing `sketch` holds, after a wireframe part, a geometric shape and a
stroke: a **picture with a caption under it**. The picture is `icon=` — an emoji, the same emoji in
the hue, a Lucide line drawing, a logo — and none is a stick figure (`theme.icons.figure`,
`PersonStanding`). The caption is the title and is optional. Eight things are load-bearing:

- **One kind, many pictures.** The subject is data — `icon=` — for the reason a shape's outline is
  data: every reader of the vocabulary (the resolver, the picker, `/__board/icons`,
  `W_UNKNOWN_ICON`) already existed, and fifteen hundred kind words would have been the kind menu.
  A picture's name written where the kind goes — `house home "Home"` — is `E_UNKNOWN_KIND` naming
  `figure home "…" icon=emoji:house`, looked up rather than guessed (`suggestPicture`, no edit
  distance over four thousand names), and a drawing tool's synonym still wins: `rectangle` is `box`.
- **The emoji are a namespace, not new bare names.** `emoji:house` is new; a bare `house` draws
  Lucide's house, and a colour emoji answering to it would redraw every board that wrote
  it. `iconFor` calls the colour cut `brand` and the silhouette `mono`, which is exactly how a tile,
  the picker and the route already treat a logo and its silhouette — the *mode* says how it draws,
  and `Icon` alone knows the art is in another file.
- **The art is loaded, the names are not.** `icons/data/emoji-{color,mono}.json` are dynamic
  imports, each its own chunk; `src/dsl/icon-names.ts` carries the 1,593 `emoji:` names so the
  parser can say `W_UNKNOWN_ICON` synchronously, and `src/dsl/emoji-names.ts` their categories for
  the shelves. Until a cut lands, `Icon` draws a blank of the glyph's size — never a fallback glyph,
  which would be a stick figure flickering into a house.
- **Ready means drawn.** `DiagramItem` asks `useArtReady` for every file its model draws from and holds
  its `onSize` until they land, so `data-dag-ready` never fires over blank squares. A diagram with
  none asks for nothing.
- **`layout/figure.ts` is read by the sizer and by the renderer**, the split `shapes.ts` makes for a
  triangle: `figureSize` says how big, `figureParts` where the picture and the words go inside
  whatever box a resize wrote. Left alone a figure is `figureSide` (64) of picture over a caption as
  wide as it needs up to `figureCaptionW` (160) and then wrapped, **never breaking a word** — the
  measurer's greedy wrap keeps one whole, so a word wider than that widens the figure. One side given,
  the picture follows it, as a circle keeps round.
- **The caption is wrapped narrower than it is drawn.** Measured to fill its box exactly, a caption
  painted a hair wide at any zoom but 100% and lost its last glyph ("Orders on the apr" at 74%): the
  canvas and the page agree about the advance, not about where antialiasing puts the edge. The wrap
  is measured `textPad` in from each side and the CSS draws that inset as padding, inside what
  `overflow: hidden` keeps.
- **A line meets the picture, not the box.** A figure's box is as wide as its caption and the
  caption is usually wider than the picture, so a line stopping at the box stopped a caption's
  width short of it. `figureHull` is the picture's square over the caption's band, carried on
  `SizedNode.hull` into `RouteNode.hull` and on `InnerBox.hull` for a board link, and cast at by
  `onHull` — the shapes' `onOutline` with a polygon handed in. `sameBoxes` compares it, or a caption
  rewrapped in the same box would not re-route a link.
- **An empty caption is allowed on this card and no other.** The inline rename refuses an empty box
  on a card because a nameless card draws as nothing; a figure with no caption is still a picture,
  so `commitRename` takes the title off instead — and the caption span is drawn at no height when
  empty, which is what gives the rename box somewhere to open under the picture.

The library's **Objects** section is `src/board/library/objects.ts`: *Drawn* (131 Lucide line
drawings, `lucide:snowflake` the one that has to say so), *Essentials* (61 emoji picked by hand in
the order a story about a system needs them) and then every other emoji on its category's shelf,
each picture on exactly one shelf so a search never answers twice. A tile is the picture, not a row
of words, drawn by the card's own `iconFor` and `Icon`; a shelf shows a handful and a count, and a
search is one grid. `Blueprint.shelf` is what `categoryOf` sends to *Objects* ahead of the shapes'
own test, and `Blueprint.picture` is what a tile draws without rendering the blueprint. The golden
freezes them one line each, because the long form would be thirty thousand lines of the Wireframe
starter with a figure appended twice.

`e2e/figures.spec.ts` holds the gestures and the console under all three themes; no reference board
carries a figure, so no baseline moved — a fixture here would have to be photographed on the
machine the other forty-five were.
