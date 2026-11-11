# Groups, smart guides and tidy up

> `group=`, alignment and spacing guides, and the tidy arithmetic.

### Groups

A group is a `group=` attribute shared by its members, and nothing else — no wrapper in the file,
no node in the tree. `withGroups()` in `useEditor` widens any set of ids to every member of any
group they touch, and the three places a selection is made (a press, shift-press, the marquee)
go through it; everything after that — moving, deleting, copying, nudging — already acts on the
selection and needs no idea of groups. Two consequences worth knowing: a plain click on a member
of a selected group picks that member out, which is the same rule as for any multi-selection; and
`insert()` renames the groups in a batch, so a paste or a duplicate keeps its copies together and
apart from the originals. Claude can write `group=` by hand; any name works.

**A group resizes as one** from the eight handles on its dashed box, which appear only when
every member is selected: a member picked out of its group wears its own eight, and two sets around
one thing would say nothing about which acts on what. Each member answers the way its own handles
would — a box scales, a drawing's shapes scale, a laid-out diagram only moves — and
`test/group-resize.test.ts` holds the arithmetic.

A **diagram's** `group` is a different thing: a brace in the fence, with a hue, a sublabel, an optional
`dir=` and — in `usecase` and `c4` — the word `system` for the same statement. The properties view
writes all of it: Wrap in a group (a lane in `flow` and `activity`, a `system` in `usecase` and `c4`, where a box round cards is the system's boundary), Shape (`group` ↔ `system`) and Direction (`dir=TB|LR`,
only where ELK lays the container out — not in a `sketch`, a fixed fence or a lane layout). See
*Controls on the canvas* in `editing.md`.

### Smart guides

`src/edit/snap.ts` is the geometry: given the box being dragged and every other box on the page,
which position on each axis is close enough to take, and what to draw. Two families of candidate,
the nearest within eight screen pixels wins, a spacing candidate wins a tie:

- **Alignment** — the mover's left, centre or right meets another box's; top, middle, bottom on
  the other axis. Drawn as one line, widened to every box that shares it.
- **Spacing** — the mover sits exactly between two boxes it is in line with, or as far from one
  as that one is from its neighbour. Drawn as the two equal gaps, with ticks.

Three things worth knowing. **Guides outrank the grid**: an axis with a guide takes it and an axis
without falls back to `metric.grid`, so a centre between two cards can land off the grid, which is
what "centred" means. **A selection is one box** — `union()` of its parts — so a row of three
aligns by its outer edges and its own centre. And **the overlay is the layer's own `<svg>`**,
`inset: 0` with `overflow: visible` and non-scaling strokes, painted by the drag and cleared on
release: a zero-sized svg would have been tidier and Chrome paints nothing outside one, whatever
`overflow` says.

Gestures paint and commit once, the split `Viewport` uses for pan and zoom: a drag writes
`transform` on every selected item and nothing reaches React until release; the marquee is a
painted rectangle. `ctl` — the object `Item` calls — never changes identity, so a selection change
re-renders the two items whose outline changed and nothing else. The editor panel writes the file a
quarter of a second after the last keystroke and the diagram redraws beside it through the same
path Claude's writes take; there is no second copy of the item to keep in step.

### Tidy up

`src/board/tidy.ts` is the arithmetic, `useEditor.tidy()` runs it over the page's measured boxes,
and `scripts/tidy.mjs` runs that from a shell. It reads the arrangement off the boxes rather than
imposing one: **slice** where a line could pass between items on either axis (bands, columns),
**recurse** into each piece, and **lay the tree out** — a stack one gap apart aligned to its leading
edge, a grid with the widest cell setting its column and the tallest its row, a pile of overlapping
boxes stacked along its longer side by centre. So three notes down the left of a diagram stay a
column beside a diagram, and a re-flow into reading order — what `flow.ts` does for items with no
position — is never what it does. A grid is only a grid when it has `rows + cols − 1` filled cells;
two boxes on a diagonal would otherwise stay a diagonal.

Four things worth knowing:

- **Sizes are rounded up to the grid, and so is the gap.** Exact gaps and on-grid edges cannot both
  hold against a 293px measured note, and an edge a nudge cannot reach is the worse defect. So a
  gap is the board's gap plus up to seven pixels.
- **It is a fixed point.** A tidy board tidies to itself — checked over five hundred random boards —
  which is what lets the page skip the write, and lets an agent run it at the end of every draw as
  a check. One pass is not always one: a stack of rows can come out lined up into columns by
  chance, and the next reading sees a grid; `tidy()` therefore iterates until the reading and the
  layout agree, which takes one extra pass in practice and is capped regardless.
- **The page is the authority, not the server.** A diagram's height is known only once ELK has
  laid it out in the real webfonts, so there is no `/__board/tidy` and cannot easily be one.
  `scripts/tidy.mjs` opens the board under `?snapshot=1`, dispatches `dag:tidy` on the document,
  and reads the result off `data-dag-tidy` (`{ moved, of, ids, dry }`); `--check` is a dry run that
  exits 3 when the board is not tidy. The event works whether or not the editor is enabled.
- **A group is tidied inside first, then as one box.** Its members keep their arrangement among
  themselves and move together, which is what `group=` promises everywhere else.

**The skill should run it last.** After the board is written and before the snapshot that judges
it: `node scripts/snapshot.mjs <board> --tidy` is the one command that does both. An untidy board
is not an error the parser can raise or a `Q_` code the scorer can find — it is only visible — and
a note that overlaps the table beside it because the table came out taller than guessed is the
commonest way a correct board looks wrong.
