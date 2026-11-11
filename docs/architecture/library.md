# The library and composition

> Blueprints, the five composition layers, and keeping a component.

### The library

`src/board/library/` is the data and `src/edit/Library.tsx` the panel. Everything in it is a
**blueprint**, and a blueprint may be composed of other blueprints — see *Composition* below for
why that is the shape. Three things about the panel itself:

- **A fragment is anything at layer 2 or below**, and it can only join a diagram of its own type:
  the same word means different things to two parsers. Dropped on the paper it starts a new diagram
  with just that in it; dropped on a diagram it is appended after one blank line.
- **The drag is pointer events, not HTML drag-and-drop.** The canvas sets `touch-action: none` and
  listens for pointers; the native API would hand it a `dragover` storm and a ghost it cannot
  style. The ghost is a painted chip, the drop target under it is marked with a painted
  `data-dag-drop`, and nothing reaches React until the drop.
- **The icons are an explicit map**, not `import * as Lucide`: the namespace is twelve hundred
  glyphs for the forty the panel uses, and tree-shaking cannot see through a name looked up at
  runtime. `test/library.test.ts` reads that map back out of the TSX and fails on a blueprint
  naming a glyph it does not hold — without it a typo falls back to a generic box and says nothing.

**The Objects shelves are not in a plain listing**. `libraryList` — and so
`GET /__board/library`, and the MCP `library` tool — leaves the 1,724 pictures out
and `objects` says how many there are and on which shelves; `q` searches everything, the pictures
included, the way the panel's box does, and lists at most `OBJECT_LIMIT` of them. Seventeen hundred
entries of one statement shape is a third of a context window spent saying one thing, and an agent
asking for a truck wants the truck. The prompt card's system prompt names the two hand-picked
shelves' pictures in one line for the same reason.

### Composition

Five layers, each made of the one below. An **atom** (0) is a single statement of one dialect; a
**molecule** (1) is a container with something in it; a **pattern** (2) is several of those wired
together; a **diagram** (3) is a whole board item; a **stack** (4) is several items. The fourteen
*diagram* templates a new item starts as are compositions, so those entries of `TEMPLATES` are
*derived* from the library rather than kept beside it and cannot drift from the parts a person drops
onto them (`md`, `note`, `image` and `edges` are literal, and `edges` is deliberately empty — the
ids it would name are this board's).

Seven things are load-bearing:

- **Layer 4 is only ever what somebody saved.** `saved.ts` is the one place that writes it, for a
  selection of more than one item; nothing in the static library is a `layer: 4`. The five worked
  starters — `arch-web-app`, `arch-pipeline`, `sequence-auth`, `flow-review`, `erd-shop` — are
  `layer: 3`, and they are also the only entries in the whole library that still carry an
  `attrs.title`. A `title=` is precisely what gives an item a header, and everything
  else is bare, so the two facts have to be read together.

- **There are three composition algebras, because there are three kinds of grammar.** In `arch`,
  `erd`, `state`, `flow`, `activity`, `class`, `usecase` and `c4` a container is a brace and
  composition is nesting. In `sequence`, `timeline`, `gitgraph`, `mindmap` — and `chart` — position
  carries the meaning: a sequence's messages *are* its wiring and `activate` sits between two of
  them, a `section` owns everything until the next one, `branch` mutates an ambient HEAD, and a
  chart's series and slices are ordered concatenation with the form line as an ambient `main`,
  standing over the statements after it and saying what shape they are drawn as. `parts` is an
  **ordered list** for exactly that reason: a children-slot plus a wiring block fits the first eight
  and cannot express the next five. The third: in `sketch` **coordinates** carry the
  meaning, and a fragment brings its own `x=`/`y=` to be placed against whatever is already there.
  (`library/types.ts`'s own header still says "two", and predates `sketch`.)

  **Every dialect with brace containers has a group fragment**, so `fk=<group>` in an ERD and a `group` in
a class or state diagram can be dropped rather than typed: `part-arch-group`, `part-erd-group`,
`part-class-group`, `part-state-group` (a `group` holding one card) beside `part-flow-lane`,
`part-activity-lane`, and the two `system` fragments. `state` and `activity` also have a **Start** and an
**End** atom (`start ${self}` / `end ${self}`) — declared pseudostates, because a library atom is one
statement with an id and the connect handle can only end on something that has one. Their ids are
`begin1` and `finish1`, not `start1`: the `activity` starter already has an `action start`.

**A chart has nothing at layer 1 or 2, and that is the grammar rather than an omission.** A chart
  molecule at either of those layers cannot exist: a fragment is
  appended to a body that already carries a form line, and a second form word is `E_CHART_FORM` — so
  a "bar chart molecule" dropped onto a chart would break the chart it landed on. The forms fold into
  the five layer-3 charts, leaving two atoms (`series`, `slice`) and five whole ones. The `series`
  atom carries four values because `chart-bar` has four quarters: a count that disagreed would warn
  `W_CHART_LENGTH` under a component somebody had just dropped, which is the failure
  `test/library.test.ts` exists to catch.
- **Holes are delimited — `${name}`, not `$name`.** The old library wrote `$id_a` and substituted
  `$id`, which produced `x1_a`; it parsed only because a sequence invents a participant for any id
  it has not met, so "add an alt fragment" quietly put its messages between two strangers, and a
  second drop reused the same two because `x1` itself never appeared for the allocator to see.
- **Only a declaration gets a `slot`; a row never does.** Three entities each carrying `id uuid pk`
  are three columns called `id`, not a collision. Rows and class members ride as a prop inside their
  node's source, where an allocator cannot see them.
- **`${parent}` points upward, and a `Use`'s props are written in the composing blueprint's
  vocabulary.** Both resolve during a pre-order allocation walk, before anything is rendered, which
  is why `grp1_svc` works and why an `alt` can hand its branch labels down to the messages in it.
- **A saved component is stored literally, not parameterised.** It is a board —
  `<vault>/components/<name>.board.md` — and a body full of `${slots}` would not parse, so it could
  not be opened. Its ids are the real ones the person wrote, and the collisions are settled when it
  lands, by `src/dsl/rebind.ts`. That is the one place the two kinds of component differ: an
  authored blueprint fills holes, a saved one renames what clashes.
- **Three dialects are exempt from rebinding, by name rather than by luck.** `mindmap` and
  `timeline` declare no author ids at all, and `gitgraph`'s are its branch names — including `main`,
  which the parser seeds whether or not anyone wrote it and renaming which turns `checkout main`
  into an error about a branch that does not exist.

`test/__golden__/library.txt` holds every blueprint's rendered text. It is the reason the
decomposition could be trusted — it was written from the flat library first, and the composed one
reproduced it byte for byte — and it goes on earning its place: an atom is shared by everything
above it, so editing one is a change to a dozen composites at once, and this is where that arrives
as a diff to read rather than a surprise to find.

### Keeping a component

`<vault>/components/` is what a person saved off their own board — ctrl+shift+K, Keep in the dock's `⋯`,
or the selection toolbar. One diagram item becomes a fragment they can drop onto another diagram of its
type; anything else becomes a stack that goes down together, keeping its arrangement and any groups
inside it. Three consequences, each handled in exactly one line somewhere:

- `listBoards` skips the directory, so a palette is not a list of boards.
- **`check-icons.mjs` skips it too, and that one matters most**: the gate walks `boards/` for every
  `icon=` anyone has written, and a typo in something a *user* saved must not be able to fail this
  repository's build. The app already says so where it belongs, as a `W_UNKNOWN_ICON` under the
  diagram.
- The endpoint reads the frontmatter itself. `parseBoard` keeps only the keys it knows, and what a
  component *is* — its name, what it is for — is exactly what it would drop.
