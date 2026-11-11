# Links, and drawing bare

> Links between items, the rule for when a diagram has a header, and drawing a link with the pointer.

## Links, and drawing bare

A board was a set of diagrams and some prose, and an edge was a line inside one fence. So two things
could not be joined: there was nowhere in the file to write it, and no parser owns both `actor` and
`service` to be asked. A **link** is that missing thing — an edge between two items, or between an
item and a card inside a diagram, written in an `edges` fence.

Composition supplies what a link is usually drawn between: an **atom** dropped on the paper is one
node, and one node is a poor diagram.

**A header is something the author asks for, and nothing else decides it.** `framed()` in
`src/board/types.ts` is the whole rule — `frame === "full" || (frame !== "none" && (title ||
subtitle))` — and it reads three fields off the item, never a parsed model: `frame=full` puts a
header on anything, titled or not; `frame=none` takes it off anything, titled or not; absent
either, a `title=` or a `subtitle=` is the ask. Everything else is **drawn bare**: no header, no
type chip, no rule over a card that already says what it is. No dialect is exempt — a lone
`gitgraph` commit or a `mindmap` root draws exactly as bare as an untitled twelve-node `arch`,
because what decides is what the author wrote and not what the diagram is. A standalone title is
its own `Heading` atom, placed where the author wants it.

The model is never counted. An earlier rule counted it — one node was bare, two was a diagram — so
a component grew a header the moment a second card joined it, titled with its own generated id
(`arch-f4t8`). Nothing counts anything now, which is also why the rule needs no parse:
`src/dsl/bare.ts` was that counting and is gone.

**"Bare" is the word on purpose, and "component" is not.** This file already spends that word twice
— on any `Blueprint`, and on what a person keeps off their own board with ctrl+shift+K — and a
third sense would make all three useless. Bare is a fact about how one item is *drawn*, and nothing
else.

Five things about the links are load-bearing:

- **`edges` is a fence, not frontmatter**, because a fence is an item: the panel edits it,
  `applyPatch` writes it, undo covers it, the clipboard carries it. **The panel never shows its
  text** (#145): a link is picked on the canvas, Enter opens the fence on it, and its controls are
  the whole of what a person changes — the ends (`EdgeEnds`, fed by `linkEndChoices` in
  `src/edit/linkEnds.ts`, which offers exactly what `resolveLinks` accepts: the page's items, each
  diagram's cards as `item.node`, and the board groups), the label and the second one, the line in
  words (`LINK_LINES` in `Props.tsx`, never an arrow spelling), Reverse (`reverseEdge`, one arrow
  only) and Delete. With nothing picked the fence says how to pick or draw one. It draws nothing and takes no
  position, which is why `placeItems` and the paper both skip it — the second is not tidiness.
  `ready` waits for every item on the paper to report a measured size, and one that never renders
  never reports, so `data-dag-ready` would never fire and every Playwright check would hang.
- **The parser guesses and the resolver overrules.** `parseLinks` splits `a.b` on the last dot with
  no knowledge of the board; `resolveLinks` tries the whole string as an item id first, so an item
  whose own id contains a dot wins. That is `makeRef`/`resolveRefs` one layer up. Resolution runs
  *after* the pages are settled: an item on a page nobody declared is moved onto the first one and
  drawn there, and resolving before would report `EB_LINK_UNKNOWN_ITEM` for a card in plain view.
- **An endpoint that does not resolve leaves its link hanging** (#173), when the other end does.
  The link stays in `board.links` with `loose: "from" | "to"` naming the missing end, kept as it was
  typed, and its diagnostic carries `target: { what: "link", id }`. **Every reader of `from`/`to`
  that means a thing on the board checks `loose` first** — `routeLinks`, `referencedInto` in
  `survive.ts` — because that end is a name and not an item. With both ends missing there is nothing
  to hang it from and the link is dropped, as #168 drops a diagram's edge between two undeclared
  names. One wrong id costs one diagnostic however many times the statement names it — a chain says
  its middle twice, a bus says its target once per source — and it points at the first link it left
  hanging. The paragraph on it below has the drawing, the drag and the delete.
- **A link into a diagram lands on the card, and the frame becomes scenery.** Anchoring on the
  frame level with the node is the mechanism a port row uses and it is defensible on paper. On
  screen a frame is `paper` on `paper` with no border, so the arrow stopped at an edge nobody can
  see, forty pixels short of the thing it named. `routeLinks` puts the node's box into the route
  and declares its diagram `isGroup` — which is exactly what `routeEdges` already means by a group
  box, scenery rather than an obstacle. The diagram's other cards go in as obstacles so the line
  threads between them, and a *boundary* inside it is scenery too: left as an obstacle a group's
  box walls off everything in it, the router gives up, and the line runs straight through the
  cards. Only a diagram something links into becomes scenery, or an unrelated link would cut
  across a diagram it has no business with.
- **The layer goes over the items**, which is the opposite of how a diagram stacks its own edges,
  and it is because a frame paints an opaque background: underneath it a link into a card was drawn
  and then covered. Over the top is safe here in a way it would not be inside a diagram, because
  the board router already has every item as an obstacle.

`routeLinks` returns coordinates relative to an origin it chose and `BoardEdges` moves the layer
there; the board is infinite in all four directions and a `viewBox` starting at a negative number
is a fight nobody needs. Routing is translation-invariant, which is what makes that free.

**Drawing one with the pointer** is `ctl.connect` in `useEditor` and `src/edit/connect.ts`. Four
things about it:

- **The drop target comes out of the DOM, not out of geometry.** Every card carries `data-dag-node`
  and every item `data-dag-item`, so `elementFromPoint` and two `closest()` calls say which card
  inside which diagram is under the pointer. Hit-testing the boxes here would be a second copy of a
  layout the page already has, and a chance to disagree with what the reader can see.
- **The handles sit thirty pixels out, past the resize squares.** They share the four side
  midpoints with the resize handles, and two targets on one point is a coin toss. Anything that
  floats beside a selection has to keep out of them — the chip that used to hang above an item was
  moved to clear the north one, and the selection bar under it never cleared the south one. The
  selection toolbar measures every handle rather than knowing this number.
- **A link needs a hit stroke.** It is drawn as a hairline nobody can hit, so `.dag-edge-hit` is an
  invisible stroke twenty times as wide. It was the board layer's alone — a diagram's own edges were
  lines of DSL inside a fence, and the fence was what you edited — until edges inside a diagram
  became pickable too, and the rule lost its scope rather than gaining an exception.
  `data-dag-connecting` turns every one
  of them off mid-gesture so they cannot answer `elementFromPoint` before the card under them does.
- **A picked link is not part of `selected`.** A link cannot be moved, resized, grouped or copied,
  and widening the selection to hold two kinds of thing would put a `typeof` in every place that
  reads it.

**The link layer is the one tree allowed to re-render during a gesture.** Everywhere else a drag
paints `transform` and nothing reaches React until the pointer lifts, because `Item` is memoised and
re-rendering every item sixty times a second is what that rule exists to prevent. This is a handful
of paths, so the drag publishes its moving boxes on `dag:links-preview` and the routing is simply
done again — an event rather than a prop, for the same reason `data-pan` is an attribute. A line
left hanging off a card that has moved is worse than the frames it costs.

**Deleting a link takes its whole statement.** `a --> b --> c` is one line and two links, so
deleting either takes both. Every link the pointer draws is a line of its own, so the two only
diverge on text somebody wrote by hand, where seeing the whole statement go is honest anyway: half
a chain is not a thing the grammar can say.

**Deleting an item takes its links**, in the same write. A link to an item that is not
there is `EB_LINK_UNKNOWN_ITEM`, an error, so leaving one behind was a delete that broke the board
on a fence nobody touched. It is `applyPatch`'s, not the gesture's, so the CLI and MCP keep it too:
every link naming the removed item — or a card inside it, `arch1.db` for `arch1` unless an item has
that literal id — goes by `removeNode`'s rules, a bus losing a source and a chain split rather than
joined. Only links *this* patch broke: one that already named nothing is somebody's typing.

**A board link to nothing hangs from a loose end** (#173) — #168's loose end one level up. Four
things about it:

- **The stub is the router's, not a node's.** A diagram's loose end is a `loose` node laid out with
  its cards; a board link has no layout to join, so `routeLinks` places the stub itself: beside the
  item the known end is in — after it for a missing target, before it for a missing source — level
  with the card it leaves, `edge.reach.min` out from the frame, several on one side stacked a
  `node.gap` apart. It is a circle node in the route (`outline: "circle"`), so the line meets its
  ring, and it counts towards the overlay's extent for the bend's reason. `Edges` draws it with
  #168's look and names (`dag-loose`, `data-dag-loose` = the name as typed, plus
  `data-dag-loose-link` = the link's id), inside the overlay's own SVG, so an export carries it.
- **Dragging it is `ctl.looseLink`**, `connect`'s gesture from the stub: `targetAt` reads the drop
  out of the DOM, `wholeCard` takes off a row or a boundary an `edges` fence cannot name, and
  `reattachLink` in `connect.ts` rewrites that one end through `retargetRef` — the label, the
  arrow, `via=` and the other ends stay as written, and a chain through the name is mended at every
  hop. `reattachable` refuses the thing it hangs from, and a card in the same diagram, which would
  be a link between two cards of one diagram (see `addLink`). A press that does not travel picks
  the link.
- **Deleting it takes the name, not the line.** `removeLink` hands a hanging link to
  `removeLooseLink`, which runs `removeRefs` over its own line for the missing name — `removeNode`'s
  rules, as `dropLinks` uses them: a bus keeps its other sources, a chain the hops that did not run
  through it. A plain link still takes its whole statement.
- **Opening a board writes nothing.** The parse keeps the link and the page draws it; the file
  changes only when somebody drags, deletes or edits it — the rule `dropLinks` already follows for a
  link that named nothing before a patch.

**Renaming follows the link.** `renameItemId` rewrites every `edges` line that names a renamed
item, and `renameNodeLinks` (`src/board/rename.ts`) does the same one level down: renaming a node
*inside* an item — a chart's series or slice, from the panel — rewrites `<item>.<old>` to
`<item>.<new>` on every page, exact whole-token matches only, and a token that is a literal item id
stays that item's. It never touches the item's own fence; the dialect's writer (`renameChartId`)
does, and the editor writes both as one string, so one undo. Any diagram's rename can reuse it.

**Bending one is `via="320,180"`**, and the one input the router takes that is a person's
rather than a layout's. A picked link grows a round handle at its middle; pulling it writes the
point, double-clicking it takes the point off. **The point wins outright**: an edge carrying one
takes neither the bow, nor the dogleg, nor the side arc, because all three exist to guess at what
somebody has now said. **It is a quadratic elevated to a cubic**, so the curve passes through the
point exactly and the router keeps one spine type — `pathOf`, `pointOn`, `labelFor` and the markers
all read a cubic already; two straight legs would have been cheaper and wrong, since a board of
S-curves with one elbow in it reads as two diagrams. **The markers read the spine rather than the
side they anchored on**, and only here: everywhere else the tangent *is* the outward normal by
construction. **The value is always quoted** — `,` is punctuation to the tokenizer, so `via=320,180`
reads as a value ending at the comma, the question `ink`'s `pts="0,0 14,9 …"` already settled. One
point, and board links only: a second would be a polyline, and a diagram's own edges run between
cards ELK placed, where a fixed point is a claim the next relayout would make false. Three
consequences belong here as well. The point **counts
towards the overlay's extent**, because a line pulled out past both its items goes there and the
overlay is the element
an SVG export becomes — `overflow: visible` hides that omission on screen, which is exactly how it
would have reached a file with the curve cut off. The handle is drawn by `Edges` and only where
`BoardEdges` passed an `onBend`, so a diagram's edges never grow one and `?snapshot=1` never draws
one. And the preview rides its **own** event, `dag:link-bend`, rather than a second field on
`LinkPreview`: the two gestures clear independently, and an item drag ending with `moves: null`
would otherwise take a standing bend with it.

`docs/dsl/edges.md` is the cheat sheet, and it is the one file in there that is not a diagram type
— `check:skill` exempts it beside `common.md`.

See also *Composition* for the library the atoms come from, and *Editing on the canvas* for the
gestures.
