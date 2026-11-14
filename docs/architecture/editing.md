# Editing on the canvas

> Every gesture is a write to the board file: the table of gestures, the leader key, picking inside a diagram, the controls and text emphasis.

## Editing on the canvas

A board is edited the way Excalidraw and draw.io are: click to select, drag to move, a marquee on
the paper for several, Delete, ctrl+D, ctrl+C/X/V, double-click to edit, ctrl+Z. **Every one of
those is a write to the board file**, and that is the whole design: there is no editor state that
is not also in the document Claude reads. `src/edit/useEditor.ts` turns gestures and keys into ops;
`src/board/patch.ts` turns ops into the smallest change to the file that means the same thing.

| Do | Writes |
|---|---|
| tap or hold `space`, then a letter | nothing by itself — it opens a chord, and the letter is what acts; the whole set is `src/edit/bindings.ts` |
| drag one or several | `x=`/`y=` on each fence line, snapped to the neighbours' guides or else the grid; alt for the grid alone |
| the eight handles | `w=` and `h=`; `x=`/`y=` too from the left and top, so the far edge stays put |
| the same eight on hand-placed content — a `sketch`, or any fence opened `layout=fixed` | every shape's own `x=`/`y=`/`w=`/`h=`, scaled by the box ratio, and the fence's box cleared on whichever axis scaled |
| Delete / Backspace, or cut | the block gone, the blank line that separated it, and every link that named it or a card in it |
| ctrl+D, or paste | a block appended, with a fresh id |
| the editor panel (Enter, the toolbar's Edit, or a double-click where there is nothing to rename) | the body between the fences; `title=`, `subtitle=`, `dir=`, `note` |
| `space N`, or a double-click on the paper | a new `md` item, from `src/board/templates.ts`, its text open on the card |
| a double-click on an `md` card, or Enter with it selected | its text, as rich text on the card — see *An md card's text, in place* |
| the library (`space L`): click, or drag onto the board | a new item from `src/board/library/`; a fragment onto a diagram appends to its body — and nothing opens unless what landed is an `md`, whose text opens on the card |
| arrows, shift for ten | `x=`/`y=`, one grid step |
| ctrl+G, ctrl+shift+G | `group=<name>` on every selected fence line, or off it |
| the eight handles on a group's dashed box, every member selected | each member's `x=`/`y=`, and its `w=`/`h=` — or its shapes' own, in a drawing — scaled together; a laid-out diagram only moves |
| `]`, `[`, or the toolbar's front and back | one `MoveOp` per selected item, one commit — the fence block cut and pasted back at the front or back of its page's stack |
| ⌘⇧H / ctrl+shift+H | `hidden` toggled on every selected fence line |
| `space T`, the dock's Tidy, the selection toolbar's (two or more selected) | `x=`/`y=` on every item the tidy moved — the board's, or the selection's — as one undoable write |
| `space K`, Links in the dock's `⋯` | the page's `edges` fence, opened in the panel, or a new one if it has none |
| drag a round handle onto another item or a card | one `a --> b` statement appended to that fence |
| click a link, then Delete · or Enter | that statement's line gone · the `edges` fence it lives in, opened in the panel |
| drag the handle at a picked link's middle · double-click it | `via="x,y"` on that statement — the point the line bends through · the bend gone |
| ctrl+shift+K, Keep in the dock's `⋯`, the selection toolbar | a new `<vault>/components/<name>.board.md` holding the selection's own source |
| a file dropped on the board, or Import | an `image` fence and an attachment in `attachments/`; `md` items; or a new board file |
| `space P`, or the library's *Generate* | a new `prompt` fence, `w=420`, with the caret in it — its centre in the middle of the view when the chord makes it |
| typing on a prompt card · its type select | the card's body, under `body:<id>` · `as=` on its fence line |
| Generate on a prompt card, or ctrl+Enter in it | the card replaced by one diagram fence at its `x`/`y`, page and group — one commit, so one ctrl+Z brings the card back |
| a prompt card's Insert anyway | the same, with a draft that still has errors, to be fixed where it lands |
| an image pasted or imported | `w=` from the placement rule — its size on screen by default, not a fixed width — and `page=`, the page it was pasted on |
| the Settings modal (the gear at the sidebar's foot, or `ctrl+,`) | nothing in the board: a preference is not part of what a `?board=…` link means |
| Settings → This vault → Files and images' Unused images, then its confirm | the files in *this* board's legacy `.assets/` that no board's text names — never another board's, and never the directory |
| a diagram's two side handles | `aspect=` — the shape ELK folds to — and `w=` removed |
| the item view's Advanced → Wrapping, on a laid-out diagram | `aspect=` set to a ratio, to `0` (never wrap), or taken off (the theme's shape) — the one way to take it back off |
| the item view's Frame colour, on a diagram | `hue=` on the fence line — the tint of the frame's hairline and its title band |
| the top bar's `⋯` → Board settings, which opens Settings → This board → Layout | `flow:` in the frontmatter, through a `MetaOp` — only what differs from the default is written |
| the problems dock's repair, under a row for the settings block, an unknown fence, a bad `layout=` or `aspect=` | the readable settings kept and the rest dropped · the fence's label changed · that one attribute taken off — each one write, so one ctrl+Z |
| a second click on a card, once its diagram is selected | nothing: a pick is not an edit |
| a click on an edge's line inside a diagram | nothing, likewise |
| Delete on a picked card | its statement, its `{ }` block and every edge that named it, gone |
| Delete on a picked edge | that whole statement's line gone — a chain goes as one |
| ctrl+D on a picked card | the statement again below itself, under an id nothing else uses |
| the properties view's kind, title, swatches, **B** / **I**, meta, description, flags, status and icon | that one line of the pick's statement, through `src/dsl/restate.ts` — the colour and the emphasis first, which is what somebody reaching into a card came for |
| the same controls on an item that is one bare node | that node's line, not the fence: a frame has no fill, no kind and no icon to wear |
| the item view's Advanced disclosure | page, title, subtitle, direction, header, hidden, id, Detach / Re-layout — shut until asked for, and shut again on the next item |
| its rows list: an edit, a remove, "add a row" | `setRow` / `removeRow` / `addRow` on one line of the pick's `{ }` block — or, for the rows of a one-line block, on the nth `;`-separated row of the statement's own line |
| the properties view's Width, on a picked card in an automatic layout | `w=` on that card's line, or off it when the box is emptied — the one size ELK still takes from the author |
| the properties view's Width and Height, on a picked shape, group or frame in a `sketch` or a `layout=fixed` fence | `w=` / `h=` on that statement — each shape and each container on its own, where the eight handles only scale the whole drawing |
| the properties view's Direction on a picked group | `dir=LR` / `dir=TB` on the group's line, or off it to follow the diagram |
| the properties view's Kind on a card carrying `kind=`, and on a sequence participant | the first word, with the `kind=` taken off · `kind=` on the participant (off when it says what `participant` / `actor` already did) |
| "Update it", on a card or an item that wears a retired flag, and on a body that sets `dir=` | the flag off the line (a `legend` for a retired mark gone) · the body's `dir=` statement moved to the fence's `dir=` — one commit |
| the properties view on a picked edge or link | the label, its second string (Technology), the arrow, `quiet` and `hue=` on that segment of the statement |
| the From and To lists on a picked edge: a select per id, a cross, and `+ source` / `+ target` | one end of that segment: an id swapped (a card, a group, or a row — `api.content`), added with ` & id` (a bus, a fan), or taken off with its `&` |
| Then `→ continue to…` and Last hop on a picked edge | ` --> id` at the end of the statement, wearing the chain's own arrow · the last arrow and its id off again |
| the properties view on a picked `timeline` entry — **When**, **Section**, a three-option status picker | **When** is one free-text field read by `readWhen` (`src/dsl/graph/timeline.ts`): a year, a month or a day in the usual forms, or a range joined by `–`, `-`, `→` or `to`, echoed under the field in words ("Understood: March 2026 → June 2026") or with why not, and written by `setWhen` as the grammar's `YYYY` / `YYYY-MM` / `YYYY-MM-DD` at the precision *typed* — nothing is written while it cannot be read, and an empty end is a point. **Section** is `moveEntry`: an entry belongs to the nearest `section` above it, so choosing one moves its line to the end of that section (the pick follows the entry, because a move renumbers `t0…`). **Status** offers none / `done` / `wait` with an icon each — only what `parseTimeline` reads, not `stop` and `muted` |
| the properties view on a picked `series` or `slice` | its label, its hue, and the run of numbers on that one line — no kind, meta, status or flags, which a chart reads as data |
| the item view's Form, Stacked, Horizontal, Legend, Value labels, Unit, Min, Max, Categories | one statement of the chart's own body, written where there is none and taken away when it is emptied |
| a double-click on a card, a group, a band, an edge label, or a chart's legend row or wedge share | that one name, through `setTitle` or `setEdgeLabel` — Enter commits, Escape reverts |
| the `+` on a picked card | `<kind> <fresh> "New <kind>"` after the picked statement, in its block, plus the edge — one commit |
| the properties view's Wrap in a group / a lane, on a picked card, group or lane | that statement and its `{ }` block moved one level in, under a new `group <id> "Group" {` — a `lane` in `flow` and `activity`, a `system` in `usecase` and `c4` — and the rename open on it; in a fixed fence the container also gets its own `x= y= w= h=` and the card its place inside it |
| the properties view's Shape, on a picked group in `usecase` or `c4` | the line's first word, `group` or `system` |
| the properties view's Add start · Add end, on a picked card in `state` or `activity` | `start <id>` (or `end <id>`) after the picked statement, in its block, plus `<id> --> picked` (or `picked --> <id>`) — one commit |
| the library's Start · End (`state`, `activity`) · its Group (`erd`, `class`, `state`) | a `start <id>` / `end <id>` statement, or a `group` holding one card, appended to the diagram |
| the `+` on a picked mindmap topic · Tab · Enter | a new line, `New topic`, as the last child (the outer `+`, Tab) or right after the branch at the same indent (the lower `+`, Enter) — one commit, rename open on it |
| Shift+Tab · Alt+↑/↓ on a picked mindmap topic, and the panel's Indent · Outdent · Move up · Move down | the topic and its subtree re-indented or swapped past a sibling — the same lines in a different order, nothing re-typed |
| the panel's Make root on a mindmap topic | the whole tree re-hung from that topic, which takes the `root` word; every topic keeps its text |
| a round handle on a picked card, dropped on another card in the same diagram | `a --> b` appended to that diagram's body, never to `edges` |
| the same drop on a card's row, or on a group's boundary | `a --> card.row` · `a --> group` in the diagram's body; across two items it names the whole card, which is all an `edges` fence can say |
| the same drop with shift held · with alt held | folded into a statement that is there — `a --> c` and a drop from `b` onto `c` is `a & b --> c`; `f --> a` and a drop from `f` onto `b` is `f --> a & b` · carried on, `a --> b` from `b` onto `c` is `a --> b --> c`; with nothing to join, the plain edge |
| a drag on a picked card, onto a boundary, a band, a sibling or the frame | that statement moved — between brace blocks, into a `lane { }`, past its neighbour, out to the top level |
| the same drag on a `mindmap` topic · a `timeline` entry · a fixed fence | the topic re-indented under the one it landed on · the entry's date · `x=`/`y=` on that line |
| a drag on a picked `series` or `slice` | its statement past its neighbour — which is the order of the bars, the wedges and the legend |
| in a selected `sequence`, a drag from one lifeline to another | `a ->> b : "message"` after the row drawn above where it was let go, picked, with its label open |
| a click on a sequence message, shift for a run · Delete | the pick, or the run of messages from the first to this one · their lines gone |
| a picked message's panel: Text, From, To, Arrow, Activates, Ends, Up, Down, Note | that message's line — its label, its ends, `->>` `-->>` `-)` `->`, the `+` / `-` on its target · the line one row along the drawing · a `note over` under it |
| the selection bar's Wrap in ▾ on a picked message or run | `alt` / `opt` / `loop` / `par` before them, `end` after, and everything between one level deeper |
| a click on a fragment's tab · its panel's conditions, + else / + and branch, the bin, Unwrap · Delete | the pick · each branch's condition, a new `else` or `and` before `end`, a branch and what is in it, the frame gone and the messages kept · the fragment and everything in it |
| a double-click on a fragment's tab or a message's label | that branch's condition, or that message's text |
| a click on a note's tab · its panel's Text and Over | the pick · its words, and the participants it is drawn over |
| the item view's Add a participant | `participant participant2 "Participant"` after the last one (a participant's Kind is the menu in the row above that names one) |
| a selected `gitgraph`'s `+` past a branch's tip · **+ New branch** · a click on a branch's name | `commit "New commit"` on that branch, after the `checkout` it needs · `branch <fresh>` and a commit, off the picked commit or the current tip · that branch renamed in every statement that names it |
| a drag on a picked `gitgraph` commit | a branch's tip onto another lane: `merge` into that branch · onto its neighbour on its own lane: the two swapped, where the history allows |
| a picked `gitgraph` commit's Message, Tag, Earlier / Later, New branch from here | its label · a `tag` line after it · a swap with its neighbour · a branch off it |
| alt + that drag | nothing to the body: the whole diagram moves, as any item does |
| the properties view's Keep in column · Release | `col=` on the pick's line, or off it |
| the item view's hue, and Hidden and Id under Advanced | `hue=` on an `md`, a note or an image, `hidden`, and `#id` plus every `edges` reference to it (through `/put`) |
| `bold` · `italic` on a node statement | the title drawn at the theme's bold weight, or slanted — and **measured** that way, so the card is laid out at the width it draws at |
| the item view's Detach · Re-layout | `layout=fixed` and every card's `x=`/`y=` · both of those gone |
| the page tabs: `+`, double-click, `×` | `pages:` in the frontmatter, and `page=` on whatever moved |
| a tab dragged past another, or shift+←/→ | `pages:` in the new order — one write, one undo entry, no item touched |
| the panel's Page select | `page=` on that item |
| the panel's Convert, on a Mermaid paste | the fence's type and its whole body, rewritten |
| the sidebar: its New menu, a row's `⋯` or right-click — rename, duplicate, delete | the `.board.md` or `.note.md` file itself, and its `.assets/` — made `untitled`, titled *Untitled*, a rename is its `title:` with the file's name following, and a delete moves it to the trash |
| the sidebar: New folder, a folder's `⋯` — rename, move, delete | the directory under the vault, through `/mkdir`, `/mvdir` and `/rmdir` — a delete takes it to the trash with everything in it |
| the notice's Undo, or the Trash page's Restore · Delete forever · Empty trash | the trash entry put back where it was, or removed for good |
| a sidebar row dragged onto a folder, or its Move to… | that file renamed into the folder, or that folder moved with everything under it |
| sidebar rows picked with ctrl, ⌘ or shift — or a long press, on a phone — then the bar, a picked row's menu or a drag | each of them moved into a folder or another vault, or to the trash — the single operation, once per thing; let go on the board, a card for each file, in one write |
| a file's Add to favourites | `dag:favourites`, a preference: nothing in any board |
| a sidebar row let go over the canvas | an `md` card whose whole body is `![Title](dag:<id>)`, where the pointer let go — the library's *Your notes* card |
| a task card's status button | `status:` in the **task's** file, through `/__board/task`; the board's own file is not touched |
| a board dragged onto a folder, or its Move menu | that board renamed into the folder — `.assets/` and all |
| ctrl+Z, ctrl+shift+Z | a whole earlier (or later) version of the file, through `/put` — undo is a version, not an inverse op |

Six things about that are load-bearing:

- **`base` is a sha1 of the whole file**, sent with every write, and a write against a version that
  has moved is refused with 409 plus the text that replaced it. The file has two writers who cannot
  take a lock between them, so refusing a stale write is the entire concurrency story. A write the
  server never receives is a refusal too: `useBoard`'s `write` resolves `null` when `fetch` rejects
  (so `commit` returns `false` and clears the painted overrides) and raises `dag:upload-problem`,
  the notice a refused drop already uses. Board writes are not retried (`e2e/offline-write.spec.ts`).
- **Undo is a version of the file, not an inverse op.** `src/edit/history.ts` keeps the text from
  before and after each edit and `POST /__board/put` puts one back — under the same `base` rule,
  and with one more check on top: an entry whose *after* is no longer what the file holds is not
  applied, and the whole stack is dropped, because the edits it remembers happened to a document
  that no longer exists. Claude rewriting the board in between is exactly that case. Typing in the
  editor coalesces under one key, so one ctrl+Z takes back the run, not the keystroke.
- **Ids are agreed by construction.** `locateItems()` in `src/board/locate.ts` is the one place
  that says which bytes are item `md-2`, and `parseBoard` and `applyPatch` both walk its list. The
  patcher used to look only at fences carrying a `#id`, so anything the parser had *numbered* could
  be dragged but never written — and refused with "no item `md-2`", which is a strange thing to be
  told about something you are looking at. Pinning an anonymous item writes its auto id into the
  fence; auto ids skip any id already written, so the numbering of the rest does not shift.
- **A first pin pins every visible item, not just the one that moved.** `flow.ts` places unpinned
  items in rows *below* the lowest pinned one, so pinning one item on an all-unpinned board would
  shift every other item. A move, a paste and an add all do this, once per board.
- **`applyPatch` rewrites one span**, last block first so the offsets from a single scan stay
  valid, preserving unknown attributes in their original order. A board file is a document a person
  edits; a drag must not show up in a diff as a rewrite of the whole thing. Loose prose has no fence
  line to carry an attribute, so pinning it wraps it in one.
- **The clipboard flavour is the item's own source** — the fence line, the body, the closing
  fence — so a copy pastes into an editor, into another board, or back into this one, where a
  taken id is replaced and a free one (a cut, say) is kept. Text with no fence in it becomes a note.

### The leader key

Every command used to be a **bare letter** — `n` for a note, `t` for tidy, `l` for the library —
while everything else on the board was already modifier-prefixed. The bare letters were the
inconsistent half, not the rule, and they had already cost a defect this file records under
*Problems*: `K` and Enter open a fence with the source focused and its caret at offset zero, so the
next letter typed as a shortcut landed **in the board file** and drew as a broken `edges` fence. A
chord cannot be mistaken for typing.

`src/edit/bindings.ts` is the table, and the leader is **Space**:

    space n  a note        space p  a prompt card    space l  the library
    space k  the links     space t  tidy up          space v  select · space h  hand
    space m  a note from a template      space ?  the sheet

Seven things are load-bearing:

- **It is not `Super`, and it cannot be.** A literal Super modifier
  is the one thing a web page cannot have: on Hyprland it is the compositor's own and is swallowed
  before Chrome sees it, and on macOS `Meta` is `Cmd`, where `⌘N`, `⌘T`, `⌘W` and `⌘L` belong to the
  browser and `preventDefault` does not reliably reclaim them. A leader survives both, and it scales
  past the alphabet in a way one modifier does not.
- **Space is also the pan modifier, and the two do not collide because a pan involves the
  pointer.** The chord is taken back the instant a button goes down (`onPress` in `useEditor`), so
  space-drag pans exactly as it did. Space-then-letter and space-held-plus-letter both run the
  command — the second because a hand that has held a modifier before will hold this one.
- **The chord is live immediately and *named* four hundred milliseconds later.** `chordRef` is a
  ref set on the press, because the letter may arrive in the same tens of milliseconds and somebody
  who knows the chord must never be made to wait for it; `chord` is React state and draws the
  which-key strip, once per gesture rather than once per frame. Two answers on purpose — which is
  the paint/render split wearing a different hat.
- **The leader's own press is `preventDefault`ed and never `take()`n.** `take()` calls
  `stopPropagation`, and the viewport arms its pan from this same press in the bubble phase — so
  swallowing it here would be a chord that quietly took hold-to-pan away, with nothing anywhere
  saying so.
- **A key that is not a binding closes the chord and does nothing else.** Falling through to the
  bare meaning would put back exactly the flat namespace this replaced, one press deeper.
- **Navigation stayed bare, and that is a rule rather than an oversight.** The arrows, `F`, `0`,
  `+`/`−` and the `]`/`[` pair are pressed in runs, and `<leader>+` four times to zoom in is not a
  shortcut anybody would use. Everything that *names a thing to make* moved.
- **The table has three readers and one source.** The chord handler, the which-key strip and the
  Commands section of the shortcut sheet are all printed from `BINDINGS`, so a binding added
  appears in all three or in none — `test/bindings.test.ts` freezes the rest: no duplicate key, no
  command without one, and no binding claiming a key that stayed bare.

**`typing()` was left alone**, though narrowing it would be a benefit. It is what keeps
the settings card and the shortcut sheet closable in one Escape order, and narrowing a guard that
five surfaces depend on is its own change with its own risk — not something to fold into the change
that makes it *possible*. The chord closes itself the moment focus reaches a control, which is the
half of the benefit that costs nothing.

### Picking a node

A card inside a diagram was 27 kinds of `<div>` with no handler on any of them. `Item` always
pressed `item.id`, the marquee walked a map of item boxes, and dragging a card moved the whole
diagram — so the pointer could reach an *item* and nothing in one, and everything a card, a group or
an edge says had to be typed into a fence. A **pick** is that missing thing: `pickedNode` and
`pickedEdge` in `useEditor`, and the keys and controls that act on one.

- **The second click picks the card out.** The first still selects the diagram, exactly as before,
  so nothing about clicking a diagram changed; once the diagram is the whole selection the next
  click reaches inside it. That is not a new rule — it is the one a *group* has always followed
  ("a plain click on a member of a selected group picks that member out"), and reusing it means a
  card is reachable without a modifier nobody would guess. The press that picks returns before any
  drag is armed: a press that both picks a thing and starts moving something else is how a click
  turns into an accidental edit. A press on a card that is *already* picked drags the **card** —
  the structural move, see *Dragging a card* — and `alt` on that press falls through to the item
  drag, which moves the diagram.
- **A group, a frame or a lane is picked by the same click** (#145). `nodeUnder` in `Item.tsx` asks
  for a card first — cards are drawn over their containers — and then for the `data-dag-group`,
  `data-dag-lane` or `data-dag-lane-label` under the pointer, *inside the drawing*: the item's own
  box carries `data-dag-group` too, and that is the board's group, not one of the diagram's. A click
  on the empty inside of a container picks the container; a click on the diagram outside any clears
  the pick. It used to take a double-click, which opens the rename, and an Escape to put it away. A
  press on a picked container moves the diagram (there is no card for `nodeDrag` to drag), and only
  a picked **card** comes forward (`z-index`): a picked group raised over its own cards took every
  click meant for them.
- **A pick is not part of `selected`, for the reason `pickedLink` is not.** A card cannot be
  marquee'd, grouped, copied or moved as an item, and widening the selection to hold two kinds of
  thing would put a `typeof` in every place that reads it. It clears on every change to `selected`
  that no longer contains its item, which is one rule covering the paper, another item, a marquee, a
  page and a board at once. Escape lets go of the pick first and the selection second: innermost
  thing held, first thing let go.
- **A node pick remembers the id; an edge pick remembers the line.** An author's id survives an edit
  above it and `declaredAt` finds the line again on demand; `e3` is the *parser's*, renumbered by
  anything that adds an edge before it, so an edge carries its line — and its `seg`, because every
  edge of `a --> b --> c` is written on one line and the line alone cannot say which arrow is meant.
  `edgeAt` in `src/edit/pick.ts` recovers `seg` by counting what each arrow produced: `parseEdge`
  emits one edge per (source, target) pair, so a bus `a & b --> c` is two edges from *one* arrow and
  a chain is two from two.
- **The ring is painted, then rendered** — the split `Viewport` uses for pan and zoom. `Item` is
  memoised and a per-node prop on it would re-render every diagram on the board whenever anybody
  clicked a card in one of them, so the gesture writes `data-dag-picked` onto the element and React
  state follows for the panel's benefit. It survives a re-render by construction: `NodeView` never
  renders that attribute, and `Edges` renders it as `undefined` when nothing was passed, which React
  writes nowhere on either side of a diff. **The repaint effect has no dependency list, on purpose.**
  ctrl+D picks a card that does not exist yet — the copy reaches the DOM only once the new body has
  been parsed and ELK has answered, several renders later with nothing about the pick changing — and
  a dep list would have to name a signal from inside a memoised, asynchronously laid out subtree.
  There is none; one `querySelector` per render is cheaper than inventing one.
- **The strip is driven by the pick.** The caret in the source box was the truth once, and a
  double-click moved it; the pick is now, and with the box gone (#145) nothing else feeds it. A
  control that makes a statement hands its line to `pickFromLine`, with the panel's **draft**,
  because what a person is looking at may be a quarter of a second ahead of the file.
- **The panel is controls, with no Source tab** (#145, decided on #132: removed, not hidden behind
  a setting). It was Properties and Source for a diagram, with the half showing kept as a
  preference, `dag:inspector-mode`; the tab, the preference, the `mode` and `reveal` the editor kept
  for it, and the CLI's `inspector.mode` are gone, and a value left in a browser is read by nothing.
  A diagram's body is a language and everything it says has a control; an agent writes the DSL and
  a person never has to read it. The panel's text box is left only for what is not a language: an
  image's caption and a prompt card's request. An `md` card's text is written on the card (*An md
  card's text, in place*) and an `edges` fence's statements are its links on the canvas.
  Double-clicking a card opens the **inline rename**; Enter and the toolbar's Edit open the panel.
- **A picked edge's swatch recolours the line instead of claiming to.** `setEdgeHue` once wrote an
  attribute `parseEdge` did not read; `parseEdge` reads the hue now — three lines — and `finalize()`
  still derives an edge's hue from its source's wherever the author wrote none. See *Controls on
  the canvas*.
- **`.dag-edge-hit` lost its scope.** It was `.dag-board-edges .dag-edge-hit` because a diagram's edges
  were lines of DSL inside a fence and the fence was what you edited; now they are pickable too. The
  stroke is only ever drawn when `Edges` is handed an `onPick`, which `?snapshot=1` never does, so a
  photographed board has none — and `.dag-edges` is `pointer-events: none` in both places, with a
  child re-enabling it being how either is reachable at all.

### Controls on the canvas

Every change a card's statement can ask for has a control, and that is the point of the panel: the
user who opens the UI must be able to make every change from the UI without seeing the text or
DSL. `restate.ts` grew from a strip of three controls — a hue, a status, an icon — to the whole
statement. A control that is missing is a line somebody has to go and type.

`src/edit/Props.tsx` is the panel's Properties half, `src/edit/Rename.tsx` the box you type a name
into, `src/edit/NodeHandles.tsx` the handles on a picked card, and `src/edit/build.ts` the text
arithmetic behind the `+` and behind Detach.

**One subject at a time.** A pick *replaces* the item's fields rather than stacking under them: a
diagram's six fields plus a card's twelve plus a rows list is a panel nobody can read, and the thing
a person is working on is the innermost one they touched.

- **The kind menu is `kindsOf(type)`, which is `Object.keys(dialect.kinds)`** — the same list
  `E_UNKNOWN_KIND` suggests from. Two lists would be two chances to offer a word the parser rejects.
  It is empty for `mindmap`, `timeline`, `gitgraph`, `sequence` and `chart`, whose parsers are their
  own and have no kind word to choose — `series` and `slice` are the statement, not a menu — and the
  control is left out rather than shown empty. A sequence participant is the exception with a menu
  of its own, `PARTICIPANT_KINDS`, because its grammar *does* have a kind — see *Sequence messages
  and fragments*.
- **A row is edited as a line**, and `rowLines()` is the inverse of `addRow`. A `Row` is what the
  dialect's row grammar made of one — a name, a detail, some tags, an `fk=` — and rebuilding a line
  from that would be the reserialisation `restate.ts` exists to avoid. The line is also the one form
  in which an entity's columns and a class's members are the same shape, so one editor serves both.
  The rows of a one-line block — `{ id uuid pk; slug text }` — share their line, so a line number
  cannot say which; each is listed with `nth`, its place on the line, and `setRow` / `removeRow`
  take it as a third argument. The boundary is a `;` outside a quoted string found by walking the
  characters, **not** the tokenizer's separators: the tokenizer collapses a run of them into one,
  which is right for a parser and wrong for counting. `setRow` rewrites that one span, and refuses
  text holding `;`, `{` or `}` — it would be two rows, or no statement. A row sharing its line with
  a *multi-line* block's brace is still not listed; `addRow` never writes one.
- **The strings are read through the tokenizer, not off the line.** A regular expression for quoted
  text also matches `icon="two words"` and shifts every slot along by one; `textSlots`' rule is the
  *consecutive* run right after the id, and the panel reads the same run the writer writes.
- **The arrow menu is the tokenizer's own `ARROWS`,** plus whatever is on the line in case it is not
  in it. The ER cardinalities are matched structurally there rather than enumerated — sixty
  spellings would be sixty typos — so a menu built from the table alone would silently drop
  `}o--||` the moment somebody opened it.

**Sizing and describing.** The panel's size, description and kind controls are span writers like the
rest, and each has one rule worth knowing before changing it:

- **Width is offered where it is the author's to give.** A card in an automatic layout takes `w=` and
  nothing else (ELK decides the height, and a `h=` there is read and ignored); a shape, a group or a
  frame in a `sketch` or a `layout=fixed` fence takes `w=` and `h=`. A group in an automatic layout
  has no box to size — it has a `dir=`, which is its own direction and not the diagram's. A pen
  stroke gets neither: its box is its points' bounds and only a resize writes it. `setExtent`
  refuses a size that is not a positive number, and `NumberField`'s `min` keeps the box honest
  about it. A group is picked by a click on it, as a card is (*Picking a node*).
- **The description is the string the card draws.** Only `C4Box` draws a third string, so
  `descriptionSlot(type, word, strings)` in `src/dsl/parse.ts` says which kinds have one and *where*:
  a C4 `container` and `db` write it as the third string, but a C4 `person` and `extsystem` are
  documented with two (name, description) and `c4.finish` moves the second into `desc` — until a
  third is written, which wins. The panel used to offer a "Description" in slot 2 on a person whose
  real description sat in the field called "Meta"; now the Meta box is left out there and the
  Description box writes the slot the card reads. A card that draws none is offered none.
- **`kind=` is read by the parser after the word, so it wins.** `kindOf()` in `Props.tsx` shows the
  kind the card is drawn as, and `setKind` takes a `kind=` off in the same write — a menu that
  changed the word under an override changed nothing. A sequence participant has no kind word at
  all (`participant` and `actor` are one statement), so its menu writes `kind=`, and takes it off
  when it says what the word already did (`PARTICIPANT_KINDS`, `participantKind`,
  `setParticipantKind`).
- **A retired flag is updated from the parser's own lines.** `retiredLines()` (`src/dsl/diagnose.ts`)
  answers with the lines `W_RETIRED_FLAG` was raised on, and `updateRetired(body, lines)` takes the
  flag off those lines only — `current` is also a column name, and only the parse knows which it read
  as a flag. A `legend` for a retired mark goes whole. It is offered on the picked card's own line
  and, for the whole diagram, in the item view, outside Advanced: it is a thing to fix, not a
  setting. A body that sets `dir=LR` in a statement of its own (`takeBodyDir`) is the same kind of
  thing — the statement wins over the fence's, so the Direction control would answer with no change
  — and "Update it" moves its value to the fence in one op through `editor.replace`.

**Inline rename is an input over the drawing, never `contentEditable` in it**, and there are four
reasons rather than one. A card's box is arithmetic done in `layout/size.ts` before anything exists
in the DOM, so an editable card would grow with what is typed into it and the dev size assertion
would fire on every keystroke — correctly, because the cards around it really would be in the wrong
places. `Item` is memoised, so text typed into a node would have to reach it as a prop and every
keystroke would re-render the diagram. A `contentEditable` holds a second copy of the text, in the
DOM, with its own idea of when it is finished, and this codebase has exactly one rule about that.
And **what is drawn is not what is written**: a group draws a dot, a label and a sublabel in one
element and an `img` draws its `meta` falling back to its title, so the box opens with the value
read out of the *parse*.

- **`data-dag-title` is the hook**, on eighteen title spans across `nodes/` (`Sketch` alone carries
  five), `Group`, `Lane` and `SequenceView`. Where there is none the box covers the whole card, which is right for a topic chip
  (whose text *is* the element) and harmless for the two pseudostates (which draw none).
  A lane's label is the band's **sibling** — it sits outside the band so a one-node lane still reads
  as one — so `[data-dag-lane]` finds nothing to cover and `data-dag-lane-label` is what says where a
  lane's name is actually drawn.
- **It lives in `.dag-layer`, so the board's own transform carries it.** No `data-zoom` arithmetic,
  and it stays over the thing it is renaming through a pan. The element is found in the DOM and
  measured through `toBoard`, which is the only honest route from "the title of this card" to a
  rectangle: `size.ts` sizes a card, never the text inside it.
- **The measure effect has no dependency list**, the same argument `paint()` makes. The `+` opens
  the box on a card that does not exist yet — the body is written, the file comes back, the parse
  runs, ELK answers — several renders later with nothing about the rename having changed.
- **An empty box on a card writes nothing.** A nameless card draws as nothing and a mindmap topic
  *is* its line, so clearing one would leave a blank where a statement was. On a *label* an empty
  box means "take the label off", which the grammar can say. Emptying a title is what the panel's
  Title field is for, where it is deliberate rather than a slip.
- **`data-dag-rename` was already taken** — the board list's own button for renaming a *file*
  carries it — so a selector meant to find one input found forty buttons. The hook is
  `data-dag-rename-box`. Exactly the hazard this file names, and it did not need CSS to bite.

**The `+` writes two statements and commits once.** `<kind> <fresh> "New <kind>"` goes in straight
after the picked statement **in the same block**, so a card grown from something inside a group is
inside that group; the edge goes at the end of the body, joining a run of edges with no blank line
and getting one after a declaration. East and south make the picked card the source, west and north
point back at it: a reader follows an arrow the way they read the page. The kind is read off the
picked *line*, not out of the IR, because the IR holds the renderer's kind and several words map to
one of those — `store` and `db` are both a cylinder, and growing a `db` should write `db`. One
commit, so one ctrl+Z takes back the card and its edge together; two would make undo mean "leave a
card nothing points at". Then the new card is picked and the rename opens on it.

**Wrap is a statement writer too, and it is gated by what the grammar can say.** `wrapStatement` in
`src/dsl/restate.ts` takes a statement and the `{ }` block it opens, indents them two spaces and puts a
container line above and a `}` below; edges are not touched, because they name ids and no id changed.
`wrapPlan` in `build.ts` is the gate and picks the word — `lane` in the two dialects that draw
swimlanes, `group` in every other one that has containers (`containersOf(type)`, read off the dialect so
the button and the parser cannot disagree) — and refuses where the result would not mean what was
asked: a lane in a lane, a lane round a group, a group in a body with lanes (a file uses groups *or*
lanes), a card on the same line as another statement (`lane r "R" { step a "A" }` declares `a` on the
lane's line, and wrapping that line wraps the lane), a legacy `[*]` (declared on an edge), and a body
that does not parse clean. `usecase` and `c4` wrap in a `group` as everywhere else; the Shape control
on the new container is how it becomes a `system`, which keeps a wrap one gesture with one word.

**A fixed fence's container carries its own box.** There the layout does not place a container round
what is in it, so `wrapGeometry` reads the picked box off `data-dag-layout`, draws the container one
`gridRef × 2` clear of it, and writes the card at that padding inside it — the card does not move, the
container appears round it. It is the `+`'s three steps over again, for the same reasons: pin what is
unplaced first, write in the file's numbers (`fileAt`, relative to the card's own container), and move
the item by what the new corner took from the frame's (`frameShift`).

**Start and end states are declared, not only written as `[*]`.** `start <id>` and `end <id>` are kind
words in `state` and `activity` (`kinds` in the dialect, so the Kind menu offers them and `E_UNKNOWN_KIND`
lists them). A `[*]` is only ever written *inside* an edge, so there is nothing for a handle to end on
until the edge exists and nothing for the library to drop; a declared one has an id, which is all the
connect handle, `+` and the library atom need. Both spellings draw the same dot and ring, and one
`end` can take several edges, which `[*]` cannot (each mention is its own bullseye). They take no
title (`parseNode` leaves it empty, as for a figure), so the panel hides the text, colour, icon, status
and flag controls on one. `grow(…, { pseudo })` writes one off a picked card — a start state pointing at
it, an end state pointed at, whichever handle asked — and a `+` from a start or end state grows a real
card, never a second dot. A legacy `[*]` has no statement of its own (its "declaration" is the edge
line), so it has no Wrap and no Delete of its own; removing one is deleting its edge. Picked, its
panel offers one thing instead of controls that would write into the edge: **Make it a start
state** (or an end state, #145). `convertPseudo` in `build.ts` declares `start start2` above the line
and puts `start2` where that one `[*]` was — the n-th pseudostate on a line is the n-th `[*]` outside
quotes, the order `finalize` makes them in — and leaves every other `[*]` as written. The pick follows
it to the new id. Names claimed: `data-dag-legacy-pseudo`, `data-dag-prop-convert-pseudo`.

**A mindmap grows by indentation, so its `+` writes a line and no edge.** `grow()` returns `null` for
one — there is no kind word to copy and `a --> b` in a mindmap body is a topic with that for its
name — and `growTopic()` is what the topic's `+` calls instead: `addTopic` in `restate.ts`, the
mindmap's writer, puts `New topic` after everything the picked topic holds (a child as the last
child, at the indent the first child already has; a sibling right after the branch, so it lands
where an outliner puts one and never between a parent and its first child). The id is the parser's
counter, which no writer can hand back, so `growTopic` parses the body it just wrote and asks which
topic sits on the new line. A picked topic therefore wears **two `+` and no round handles**
(`topicHandles` in `pick.ts`, drawn by `NodeHandles`): the child's on the side *away from the
root* — read from the layout's boxes, because a radial map puts a topic wherever ELK chose and the
file says nothing about it — and the sibling's below, or to the right for a topic that grows up or
down the page. The root has no sibling `+`: a second line at depth 0 is a second root. Both are a
tap, not a pull — a topic's place is its indentation, so there is nothing for a pull to say.

**The outliner keys are scoped to a picked topic**, and that scope is how their clashes are settled
(`topicKeyFor` in `bindings.ts`; it is not a leader chord, because these are pressed in runs). Tab
a new child, Enter a new sibling (a child on the root, which has none), Shift+Tab out one level,
Alt+↑/↓ past a sibling. With anything else picked every one of them still means what it did: Enter
opens the panel, Alt+arrows nudge. The one real clash is Enter, which opened the panel for every
pick; on a topic the panel is one click away (the toolbar's Edit) and a new topic is not, so the
topic keeps the outliner's Enter. A key with no move to make — Shift+Tab from directly under the
root — is still taken, because letting Tab through would walk the focus off the canvas mid-run.
Moving a topic gives the *same topic* a different id (the counter restarts at every line), so
`moveTopicPick` re-aims the pick at the line the topic moved to; the panel's buttons do the same
through `pickFromLine`.

**The restructuring writers all go through `topicRows`**, which finds a parent the way
`parseMindmap` does — pop everything at least as deep, take what is left — so a file mixing tabs
and spaces, or indenting by three, is read as the page draws it. Outdent stops at a child of the
root and `topicMoves()` says so, which is also what disables the panel's buttons: a dimmed button
is the grammar answering, not a click that quietly does nothing. **Make root turns the tree over**:
the topic keeps its own children and its old parent becomes one more of them, with that parent's other
children under it, and so on up to the old top — depth *is* the indent, so a branch that changed
parent has a new depth whatever was typed. It is the one writer here that rewrites lines it was not
pointed at (the tree, at one indent unit), and a comment or blank line travels with the topic that
follows it.

**A mindmap line is bare text, so the panel offers it no hue, status, icon or flags** — `hue=coral`
or `done` written onto a topic is part of its name (`Topic hue=coral`), because `parseMindmap` reads
no modifier. Its colour is its branch's, from depth. A chart is left out of the same controls for the
same reason, one dialect over.

**The same answer holds for a timeline entry, a gitgraph commit and a sequence participant, and
`pickControls` in `Props.tsx` is the gate the statement controls read.** A timeline entry's tail is
read for `done` and `wait` only, so its panel is the date, the section and a three-option status —
no hue, icon, flags or meta; a section keeps its hue, because `parseTimeline` reads that one. Its
title is read and written by `labelOf` / `setLabel` (`timeline.ts`, through `setTitle(…, "timeline")`)
rather than the tokenizer's string slots: the tokenizer reads a range's `..` as an arrow, so to it a
ranged entry had no title, and the label is required, so clearing it writes `""`. A
gitgraph commit is a command whose first quoted string is its whole message, so `Props` sends it to
its own `GitProps` panel — message, tag, order, branch — and offers no statement word. A bare word
after a sequence participant's two strings is read as the next statement, so
`participant api "API" done` is `E_EXPECTED_ARROW`; it keeps `hue=`, `icon=` and `kind=` and loses
the status and flags. `test/props-gate.test.ts` holds the gate to each parser.

**In a fixed fence the coordinate is the placement, so the edge is a separate claim only a drag
makes.** Everywhere else the edge *is* the placement — ELK has no reason to put an unconnected card
anywhere near the one it grew from — which is why a plain click writes one there and not here. The
new box lands one gap off the picked one on the side that was pulled, read out of `data-dag-layout`.

**Connecting from a card writes into the diagram's body, not into `edges`.** An `edges` fence exists
because no parser owns both `actor` and `service`; inside one fence the dialect owns both ends, so
`a --> b` belongs where every other edge of that diagram is written — it inherits the hue, the
markers and the routing the dialect gives its own edges, and it survives being copied, kept as a
component or dropped onto another board of that type. A board-level line drawn over the top of the
diagram it was drawn inside is a different picture. `connectable()` already allowed it: two
different cards under one item pass, and only `from.node === undefined` refused.

**Every form of edge has a control, because the Source tab is going.** The grammar says four things
about an edge a drop cannot say alone, and each has one control, over a writer in `restate.ts`:

- *A second string* — C4's technology chip, `a --> b "Uses" "HTTPS"`: the Technology field under the
  label (`setEdgeLabel2`). It is positional behind the label and the router draws a second line
  only under a label, so the field is disabled until there is one rather than writing a string
  nothing would show; clearing it takes away the `""` that only held the label's place. A board
  link takes the same field: `parseLinks` reads the second string and `routeLinks` hands it on.
- *A bus and a fan* — `a & b --> c`, `f --> a & b`: `EdgeEnds` lists each end's ids as selects and
  adds one with `addEdgeEnd`. It is one statement on purpose: state draws a bus as one trunk with
  one label, which a line per pair (what the handle writes) cannot say. On the canvas it is shift
  on the drop, `joinEdge` in `connect.ts`, which folds the drop into the first statement whose end
  is *exactly* the card dropped on (or dragged from) and writes the plain edge when there is none
  — never a guess about which of two statements was meant. A middle list of a chain belongs to two
  arrows, so a bus only ever grows a statement's first list or its last.
- *A chain* — `a --> b --> c`: "continue to…" (`appendHop`) and Last hop (`dropHop`), both on the
  end of the *statement* whichever segment is picked, because the person who has just carried a
  chain on is still looking at its first hop; alt on the drop does the same from where a statement
  ends. A hop is appended after everything the last one wrote, since a label and the modifiers
  belong to the hop *before* the arrow that follows them.
- *A group or a row* — `workspace --> intake`, `api.content --> store`: every select offers the
  diagram's cards, groups and rows (`edgeTargets`, off the parse — a list kept beside the text
  would drift), and `targetAt` now answers a row (`data-dag-row` inside the card) and a group's
  boundary (a `data-dag-group` that is *not* the item's own), marking the one the drop will name.
  A row wins over its card and the header is still the card, so the highlight says which. Only a
  diagram's own body can name either — an `edges` fence splits on the last dot, so `d.api.content`
  would be a node `content` of an item `d.api` — so `wholeCard` folds a row to its card and a
  boundary to its diagram when a link crosses items.

A board link has the second string and the plain edge; its ends are items on the page, which the
panel does not list, so it has no bus or chain control. The grammar reads both in an `edges` fence
all the same, and shift and alt on a drop between items write them there.

**The handles are in the layer, not in the item**, and that is what keeps `Item`'s memo honest.
They are also the dialect's to have: `growable()` beside `detachable()` in `build.ts` is
`hasGraph()`, because both families write a declaration *and an edge to it*, and a chart has no
arrow grammar to write one with. So a picked series wears none, and the *item's* own stay up — the
boolean `Item` is handed is "a card has taken the handles", not "a card is picked in here".
`Item` knows nothing about layouts, so it has no way to position anything over one card inside its
own diagram; `App` already holds every diagram's node boxes — a board link needs them to end on a
card — so it places these in board coordinates exactly as it places the dashed box around a selected
group. The one thing `Item` gains is a **boolean**: `picked`, false for every item but the one
involved, so the memo bails out for the rest just as it does for `selected`. The item's own resize
and connect handles go while a card's are up, because eight squares and four dots around the frame
plus eight more around the card is a thicket, and nothing on either set would say which thing it
acted on. Escape lets go of the pick and gets them back — which is what `links.spec.ts`'s `pullFrom`
now does between two pulls.

**Detach and Re-layout are declared whole-body conversions**, the family `fromMermaid` started, and
each asks in the row rather than through `confirm()` — the board list's argument. Detach writes
`layout=fixed` **and** every card's coordinate in one op: the attribute alone would hand the fence
to `layoutSketch`, which finds nothing placed and grids the cards in reading order — a *different
diagram*, and the opposite of what somebody who wants to nudge one card asked for. Three things
follow:

- **The layout's answer only exists on the page.** ELK runs in a worker reached through a specifier
  only Vite resolves, so there is no server route and `useEditor` cannot ask for one.
  `data-dag-layout` on `.dag-diagram` is the channel — the same one `data-dag-quality` uses, for the
  same reason. `App`'s `nodeBoxes` is deliberately not reused: those are in the *item's*
  coordinates with the frame's padding and header folded in, and a conversion has to write the
  layout's own numbers or the drawing shifts as it lands.
- **Coordinates are relative to the container**, because that is how `layoutSketch` reads them. A
  group carries its own box and its children are written against its origin, so ELK's absolute
  answer is offset by each thing's parent. A group also gets `w=`/`h=`: without them a boundary
  drawn deliberately roomy would shrink to hug its contents at the moment of the conversion.
- **`detachable()` is derived, never listed.** `kindsOf(type)` is non-empty only where `parseWith`
  reads the body, and `modifiers()` — which promotes `x=`/`y=` onto a node — runs only there;
  `resizeOf(type) === "aspect"` is the ELK diagrams. Their intersection is the answer, and `sketch`
  falls out of both because it is fixed already, `chart` out of both because it has no node to
  place and no body `parseWith` reads. Re-layout strips every `x=`/`y=` and removes
  `layout=` with them; `w=` and `h=` stay, because the author sized those and only the position was
  the fixed layout's.

**An item's id is renamed through `put`, not through a patch op.** `renameItemId` rewrites spans in
every `edges` fence on every page and `applyPatch` addresses one item at a time — so this is the
undo path used forwards, under the same `base` rule, and it lands in the history like everything
else. A collision is refused in the row, because two items with one id is what `locateItems` would
report the moment it next ran.

Two smaller ones. **Hiding an item from the panel closes the panel**, because the effect that keeps
`selected` and `editing` naming things that exist filters hidden items out — the same thing ⌃⇧H
does, and the reason `props.spec.ts` clicks that box rather than `check()`ing it. And **a picked
board link's controls are reached with Enter**, which opens the `edges` fence its statement lives in;
a panel that flew open every time somebody clicked a line would be in the way of deleting one. A
board link to nothing (#173) is picked the same way, by its line or by a click on its loose stub, and
a press on the stub that travels pulls the missing end onto whatever it is let go over
(`ctl.looseLink`; the paragraph on it in `links.md`); the problem's "Show" picks it and opens
the fence's panel in one go, since the person asked about it.

**Deleting a picked group without its children was refused**, deliberately: Delete still removes it
*with its children*, which is what `removeNode` documents, what `restate.test.ts` freezes, and what every
canvas tool does. Re-parenting one level up is what "ungroup" means, not what "delete" means, and
giving Delete two meanings depending on what is picked is the kind of thing a person finds out about
by losing work. A `dissolveGroup` writer with a button of its own is the honest shape for it, and it
is not built.

### Settings that had no source-free way in

Four things a person could only change by typing, each now a control (`feat(canvas)` #142, part of
#132's "no source in the UI"):

- **`aspect=`** has a *Wrapping* select in the item view's Advanced half, on a diagram whose box is
  the layout's (`resizeOfItem(item) === "aspect"`): *theme default* (the attribute off), *never
  wrap* (`aspect=0`, a pipeline that must read as one line) and *fold to a shape* with a width ÷
  height box. The side handles write the third, and nothing could take any of them back — which is
  the gap. `src/board/settings.ts` holds the rules (`aspectChoice`, `aspectAttr`). A half-typed
  ratio writes nothing: `Number("")` is `0`, and `0` is *never wrap*, so a box that coerced would turn
  wrapping off by being empty. A value the parser rejected (`EB_BAD_ASPECT`) is its own disabled
  option and a sentence, so the select says what the file holds instead of "default".
- **A diagram's own `hue=`** is drawn: a hairline round the frame and the title band tinted behind
  the header, in the theme's hue and its tint (`--dag-color-hues-*`, `--dag-tint-*`, which every
  theme has), with a *Frame colour* swatch row — *none* first — in the item view for every
  diagram. Three load-bearing things. **It binds `--frame-h`/`--frame-t`, not `--dag-h`/`--dag-t`**
  (`frameHueVars` beside `hueVars`): every card inside a diagram inherits the second pair, so binding
  it on the frame would recolour each card that has no hue of its own. **It adds nothing to the
  box.** The hairline is an inset shadow, not a border, and the band is the header stretched out to
  the frame's edge by exactly the padding the frame inset it by, with that padding put back inside —
  `size.ts` measures a frame and the dev size assertion would report any growth. An inset shadow
  also survives the SVG export, which freezes computed styles of real elements and has no
  pseudo-element to freeze. **A bare frame has no band to tint** and keeps the hairline (and the
  group radius it otherwise drops). The two swatch rows in a lone-node diagram's panel are told apart
  by hook and label: `data-dag-prop-hue` is the node's, `data-dag-frame-hue` the frame's.
- **The board's frontmatter** — `flow: {width, gap}` — is *Settings → This board → Layout*,
  which the top bar's `⋯` opens (`src/settings/panes/BoardLayout.tsx`), written through
  `Editor.setMeta`, one `MetaOp` and one undo entry, as the page tabs write `pages:`. Only what
  differs from `FLOW_DEFAULT` is written and `flow:` leaves the file when both are the default, so a
  board nobody changed stays as short as it was; a number outside `FLOW_RANGE` is not written, stays
  in the box and its row says the range. **There is no theme row**: a theme is the reader's, never
  the board's (#162), so a `theme:` in the frontmatter is left in the file and read by nothing
  (`design-and-layout.md`).
- **A file that would not parse far enough to have a control** gets a repair in words, under its
  row in the problems dock (`src/edit/repair.ts` plans it, `Problems.tsx` draws it, `Editor.repair`
  does it). `EB_FRONTMATTER` keeps every top-level setting that reads on its own, **byte for byte**,
  and names what it dropped; `EB_UNKNOWN_TYPE` relabels the fence — a select led by the nearest
  kind — and leaves its text alone; `EB_BAD_LAYOUT` and `EB_BAD_ASPECT` take the one attribute off.
  The first two go through `put` (`src/board/repair.ts`): no item id addresses a block the parser
  skipped, and `MetaOp` refuses a block it cannot read so as not to throw away what somebody was
  half-way through writing. Each checks the file *now* — a relabel is refused if its line no longer
  says what it was offered for — so a repair clicked after Claude rewrote the file does nothing
  rather than something to the wrong line.

### A git graph's lanes

A gitgraph is a list of commands run against a HEAD — `commit`, `branch`, `checkout`, `merge`,
`tag` — so almost nothing a person wants to say about one is "the line for this thing". Commit on
this branch, start a branch here, merge that into this: each is a command written at the right
point in the history, with the `checkout` that puts HEAD there. A card's `+` has no edge to write
(`c1 --> c2` is an unknown command), so `growable()` is false for it and a picked commit wears no
handles. The controls are the lanes instead, which are already drawn: `src/edit/GitLanes.tsx`.

- **The chrome is the selected graph's, and editing chrome only.** While exactly one gitgraph is
  selected, `App` draws a chip over each branch name, a `+` just past each branch's tip and
  **+ New branch** under the last lane. In the layer beside `NodeHandles`, for the same reason — the
  positions are a layout's answer and `Item` is memoised — and never in `?snapshot=1`, an export or
  the read-only view. Placed by measuring the drawn labels and tip commits through `toBoard` after
  every render, which is `Rename`'s argument: a commit just written reaches the DOM several renders
  later, with nothing about the chrome having changed.
- **The writers read the whole history**, so they live beside the parser in
  `src/dsl/graph/gitgraph.ts`, the way `redate` lives beside the timeline's. The parser publishes
  what they need in `GitMeta`: each branch's tip, where HEAD ends, where HEAD is after every line,
  and which lines tagged which commit. `gitCommit` and `gitMerge` **append**, because the end of the
  body is the one place a statement cannot change what another commit descends from, and write a
  `checkout` only when HEAD is elsewhere. `gitBranch` off a picked commit writes straight after it
  (and its tag), the one point at which HEAD's tip *is* that commit, then a `checkout` back so the
  statements below land where they did — left out when the next statement chooses a branch itself.
- **A branch is renamed everywhere it is named.** `branch`, every `checkout`/`switch` to it and
  every `merge` of it — so a lane's rename does not go through `setTitle`, which would write line 1
  (the parser gives every lane that line). `commitRename` routes a gitgraph lane to
  `gitRenameBranch`, which refuses `main` (no statement declares it), a taken name and anything that
  is not one word; the chip on `main` is disabled for the first reason.
- **A new commit or branch opens the rename on itself**, as a card's `+` does: the commit's message,
  or the branch's name, since `feature2` is a name nobody chose.
- **A picked commit's panel is its own, `GitProps`.** A gitgraph line has no `key=value` grammar, so
  a hue, a status, an icon or a flag written onto it is a word the parser reads past, and a second
  string is not a meta: `PickProps` would offer a dozen controls that write nothing. What a commit
  has is a message (the first string, the parser's own rule), a tag — a statement of its own, which
  `gitSetTag` writes straight after the commit and rewrites or removes in place — and an order.
  **Earlier** and **Later** are disabled, not missing, where `gitMove` refuses the swap.
- **Reorder only where the history allows.** Two commits swap only when they follow each other
  directly on one branch, both are plain commits and the earlier has no other child — no branch
  started from it, no merge took it. Anywhere else the swap would change what some other commit
  descends from, which is a different history rather than the same one reordered. What is swapped
  is the two statements' text, which in a gitgraph is the whole of a commit; the ids are positional
  and the count does not change, so the tags are moved by id afterwards.

### What the panel opens on, and what it opens with

The panel used to open uninvited: **it opened on every drop**, and what it opened on was
the frame. Three rules hold, and the first is the one that matters.

**A drop opens nothing unless the item's body is prose, and prose opens on the card.** That is `md`
— a note, a paragraph, a table — whose body *is* its content: its text opens where it is drawn, as
rich text (*An md card's text, in place*). A diagram, a sketch, a shape, a chart: nothing opens, and
the person works on the drawing, which is where every gesture already is. The rule is stated in
`place()` and honoured in `add()`: `add` is only ever called with `"md"` and `"prompt"` — `N`, a
double-click on the paper, and `P` — and both are typed into where they land. A card that places a
note, a task or a board (`noteCard`) is `md` and still not prose, and opens nothing.

### An md card's text, in place

An `md` card is edited as rich text on the card itself (#145), and the panel holds no Markdown for
one: it has the card's settings and an **Edit the text** button. A double-click on the card, Enter
with it selected, and a new card (`N`, a double-click on the paper, the library) open it; Escape, or
a press anywhere outside the box and its menus, closes it.

- **BlockNote never reads or writes a byte of the card**, as it never does a note's (*Notes*):
  `CardText` (`src/edit/`) hosts `FieldEditor`'s `card` variant — every block a note can hold — and
  the body goes in and out through `src/note/markdown.ts`. A block nobody touched keeps the bytes it
  was written with, so an agent's `*` bullets and table padding survive an edit beside them, and a
  card opened and left writes nothing.
- **Over the card, not in it**, for `Rename`'s reasons: a box in the layer on the card's own
  rectangle, growing down while somebody types; the card under it is redrawn from the file.
- **Each change is the panel's write**: `setBody`, 250 ms after the last keystroke, under the
  `body:<id>` key, so one sitting is one undo, sealed when the box closes.
- **A card just made is not in the board yet** (one round trip stale): `write` opens on the id, and
  the page mounts the box when the card arrives.
- **The editor's chunk is fetched the first time a card is opened.** `?snapshot=1` and `?view=1`
  never reach `CardText`.

Names claimed, grepped first: `dag-card-text`, `data-dag-card-text`, `data-dag-write-card`.

**A one-node item shows that node.** A shape dropped from the library is an item holding exactly one
node, and the item's frame has no fill, no kind and no icon while the node has all three — so the
hue, the emphasis, the kind and the icon in the item view are the *node's*, written on its line in
the body the way a pick writes. `loneNode()` in `build.ts` is the test, and it is deliberately not
`loneShape()`: that one asks whether the item's **handles** may mean the shape, refuses a framed
item and refuses anything but `sketch`, and the resize path depends on exactly that. This asks a
different question and gates on `kindsOf(type)` rather than `hasGraph()` — a lone `mindmap` topic, a
`timeline` entry and a `gitgraph` commit each parse into a one-node `Graph` whose line is *bare
text*, so a modifier written onto one would become part of the label. `kindsOf` is non-empty exactly
for the nine dialects whose statements go through `modifiers()`, which is the set whose lines these
controls can honestly write. A multi-node diagram gets **no** style block: there is no one line a
swatch could recolour, and offering one that guessed would be worse than the second click.

**The structural half is behind a disclosure**, shut by default and shut again on the next item:
page, title, subtitle, direction, header, hidden, id, Detach and Re-layout. Plain React state, not
`localStorage` — `src/settings/` is for a preference worth a key and how somebody left a twisty is
not one. Title and subtitle were **moved, not cut**: deleting them
would leave `title=` and `subtitle=` reachable only by typing, and *a control that is missing is a
line somebody has to go and type* is the rule this panel exists to serve. What was wrong with them
was their position — at the top, as though every component should have a header, when a header is
drawn only when the author asks for one. `Heading` in `src/board/library/diagrams.ts` is the
component for a standalone title.

### Text emphasis

`bold` and `italic`, two bare words in the flag grammar, on a node's own title. Four things about
them:

- **They are flags, not a `key=value`,** because that is how everything of this shape is already
  written and because they are independent: `service api "API" bold italic`, and "normal" is the
  absence of both. They join `FLAGS` in `common.ts`, which meant giving `modifiers()` explicit
  branches for them — the existing fall-through looks the word up in `STATUS_OF`, and `bold` would
  have resolved to `undefined` and cleared a status the node was already carrying.
- **They reach a node's title and nothing else.** A group label, a lane band, a sequence
  participant, a chart series and an edge label keep the theme's weight: those are labels on
  scenery, and a diagram where anything can be bold is a diagram where nothing is. Only the nine
  dialects that parse through `modifiers()` have the words at all.
- **The weight is in the measure.** `size.ts` decides a card's box by measuring its text and the
  renderer is obliged to produce exactly that box, so a bold title measured at a regular weight is
  the disagreement `DiagramItem`'s dev assertion reports through `console.error` — which `npm run
  e2e` then fails on. `fontOf` gained the slant, **in front of the weight**, because that is the CSS
  font shorthand's order and in the wrong one `measureText` ignores the whole string silently.
- **`theme.type.weightBold` is the token and the slant has none.** 700 in all three themes, exempt
  from the `base` ramp in `resolve.ts` — 700 scaled by 1.1 is a weight no face carries and the
  browser would synthesize the difference — and in `UNITLESS` in `applyTheme.ts` *and* its
  hand-written mirror in `check-theme.mjs`. A slant is a binary the face has or does not, so there
  is nothing for a theme to say about it that `font-style: italic` does not.

It reaches the drawing as `data-dag-em` on the title span, and one attribute-selector pair at the
**end** of `nodes.css` covers all eleven title elements. Last in the file on purpose: it shares its
specificity with every `font-weight: 600` a title class above it sets, and between equals the
cascade is all there is — higher up, a bold entity name would have lost to `.dag-entity__name`.

### Sequence messages and fragments

A sequence diagram's content is its messages, and until #135 only a participant could be picked:
a message, a fragment, a note and `activate` were reachable only by typing. They have controls now,
and a sequence can be built from an empty body without the Source tab. The writers are
`src/dsl/sequence-write.ts`; what the pointer means is `src/edit/message.ts`, with no pointer in it.

- **A message is drawn, not grown.** `growable()` still excludes `sequence` — a `+` on a participant
  would put a message between two people on the strength of a click — so a message is a drag from
  one lifeline to another in a diagram that is already selected (a press on a lifeline of one that
  is not selects and moves it, as a press anywhere on it does). The sender is the lifeline it
  started on, the receiver the one nearest where it let go (its own is a message to itself), and the
  **height** is where the statement goes: after the last row drawn above that point. That is honest
  in this dialect and nowhere else, because the layout walks the events once, top to bottom, so the
  drawing order *is* the file's order. The rows — every message, note, fragment head, `else`/`and`
  and `end`, each with its `y` — are published as `data-dag-layout` (`SeqPlaced.rows`), the channel
  every other diagram publishes its boxes on; a row that opens a block puts the statement inside
  it. The new message lands picked with its label open, as the `+` hands over a card.
- **A pick id is counted, not named.** `msg:3` is the fourth message the file says, `frag:1` the
  second fragment it opens, `note:0` the first note (`seqParts`), and the layout counts the same
  walk. An ordinal rather than a line because a line moves with every edit above it and the count
  only when one is added before it; the colon because it is punctuation to the tokenizer, so no
  participant id can collide with one. `declaredAt`, `declaredOn` and `edgeAt` answer them, so the
  caret in Source picks a message, a fragment or a note as it picks a participant.
- **A message is an edge pick, a fragment and a note are node picks.** A message is drawn by
  `Edges` and takes the same hit stroke and ring a diagram's edge does; a fragment's or a note's tab
  carries `data-dag-frag` and `data-dag-branch`, which `Item`'s `nodeUnder` returns as the thing
  under a press and `nameableUnder` as the thing to rename — the branch says which condition. The
  panel dispatches on the id: `MessageProps`, `FragmentProps`, `NoteProps` in `Props.tsx`.
- **Shift picks a run.** `PickedEdge.to` is the far end, and the run is every message between the
  two in the count — consecutive by construction. **Wrap in ▾** on the selection bar is offered only
  when the run's first and last message share one list (the top level, or one branch), because a run
  that starts inside an `else` and ends after its `end` would have to cut the fragment in half; it
  writes the head before, `end` after and indents what is between, then picks the new fragment.
- **Up and Down move a message one row along the drawing**, through `moveRow`: up past an `alt`'s
  head takes it out of the fragment, down past an `else` puts it into the next branch, up from under
  an `end` puts it into the last branch. The pick follows it, because passing another message
  changes its place in the count.
- **The busy bar is Mermaid's `+` and `-`**, written on the target: `a ->> +b` starts `b`'s bar and
  `b -->> -a` ends `b`'s. The parser read only the trailing form (`a ->> b +`) and the documented
  Mermaid spelling was an error, so that was fixed with it. Explicit `activate`/`deactivate` lines
  still parse and draw; the panel offers the mark on the message, which is one control rather than
  two lines to keep in step.
- **A hand-off is two lines, because Mermaid cannot say `+` and `-` on one** (#135). A message that
  starts the receiver's bar *and* ends the sender's is written `web ->> +api : "x"` followed by
  `deactivate web`, both valid Mermaid; the old one-line `a ->> +b - : "x"` is still read. The panel
  shows the pair as one message with both boxes ticked. The rule is `pairedDeactivate`: a
  `deactivate <sender>` directly after a message that has no `-` of its own *is* that message's
  `-`. So `messageParts` reads it, unticking either box removes exactly its part (the `+`, or the
  line — touching the old one-line form rewrites it as two), changing the sender renames the line,
  and everything that moves or cuts by line carries it: `moveRow`, `removeMessage` (what Delete
  calls), `wrapIn`, and `placeIn` (a statement dropped "after" the message goes after the pair, never
  between). `Ends` alone stays one line, `b -->> -a`, which is valid Mermaid. These writers are
  body-level (`setMessageMark(body, line, …)`, `setMessageEnd(body, line, …)`) for that reason.
- **A participant has no status and no flags.** Its line is two strings, `icon=`, `hue=` and
  `kind=`, and a bare word after them starts the next statement — so those controls would break the
  diagram they were used on. It has the Kind menu its grammar has instead — `participantKind` and
  `setParticipantKind` in `restate.ts`, over `kind=` (off when it says what `participant` or `actor`
  already draws).
- **Unwrap keeps the messages, Delete does not.** Delete on a picked fragment takes it with
  everything in it, the rule a group's Delete follows; Unwrap is the separate button for "take the
  frame away", for the reason the paragraph on deleting a picked group gives under *Controls on
  the canvas*.
