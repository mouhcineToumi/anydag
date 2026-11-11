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
| `space N`, or a double-click on the paper | a new `md` item, from `src/board/templates.ts` |
| the library (`space L`): click, or drag onto the board | a new item from `src/board/library/`; a fragment onto a diagram appends to its body — and the panel stays shut unless what landed is an `md` |
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
| Settings → Vault's Unused images, then its confirm | the files in *this* board's legacy `.assets/` that no board's text names — never another board's, and never the directory |
| a diagram's two side handles | `aspect=` — the shape ELK folds to — and `w=` removed |
| the item view's Advanced → Wrapping, on a laid-out diagram | `aspect=` set to a ratio, to `0` (never wrap), or taken off (the theme's shape) — the one way to take it back off |
| the item view's Frame colour, on a diagram | `hue=` on the fence line — the tint of the frame's hairline and its title band |
| the top bar's `⋯` → Board settings | `theme:` and `flow:` in the frontmatter, through a `MetaOp` — only what differs from the default is written |
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
| the properties view on a picked edge or link | the label, the arrow, `quiet` and `hue=` on that segment of the statement |
| the properties view on a picked `series` or `slice` | its label, its hue, and the run of numbers on that one line — no kind, meta, status or flags, which a chart reads as data |
| the item view's Form, Stacked, Horizontal, Legend, Value labels, Unit, Min, Max, Categories | one statement of the chart's own body, written where there is none and taken away when it is emptied |
| a double-click on a card, a group, a band, an edge label, or a chart's legend row or wedge share | that one name, through `setTitle` or `setEdgeLabel` — Enter commits, Escape reverts |
| the `+` on a picked card | `<kind> <fresh> "New <kind>"` after the picked statement, in its block, plus the edge — one commit |
| a round handle on a picked card, dropped on another card in the same diagram | `a --> b` appended to that diagram's body, never to `edges` |
| a drag on a picked card, onto a boundary, a band, a sibling or the frame | that statement moved — between brace blocks, into a `lane { }`, past its neighbour, out to the top level |
| the same drag on a `mindmap` topic · a `timeline` entry · a fixed fence | the topic re-indented under the one it landed on · the entry's date · `x=`/`y=` on that line |
| a drag on a picked `series` or `slice` | its statement past its neighbour — which is the order of the bars, the wedges and the legend |
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
    space ?  the sheet

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
- **The strip is driven by the pick, with the caret as a feeder.** The caret was the truth once,
  and a double-click moved it; the pick is now, and `onSelect` on the textarea
  calls `pickFromLine`. One source of truth, three ways to move it, and none of them can disagree.
  Two consequences. The panel hands its **draft** to `pickFromLine` and to `declaredAt`, because
  what a person is looking at may be a quarter of a second ahead of the file. And the reveal effect
  that puts the caret on the pick's line **must check that the textarea has focus** before deciding
  the caret is already there: without that half of the guard it also swallowed the *first*
  placement, since a textarea nobody has touched reports a caret at offset zero, which is inside
  line 1.
- **The panel is Properties and Source, and only for a diagram.** A diagram's body is a language —
  everything it says has a control, so the text behind them is genuinely optional, which is the
  point. A note's body *is* the note, an image's is its caption, and an `edges` fence
  has no attributes at all: putting any of those behind a tab would hide the item's content from the
  person who opened the panel to see it. Which half is showing lives in `localStorage`
  (`dag:inspector-mode`), the same argument as the panel's width — a fact about this window, not part
  of what a `?board=…` link means. Double-clicking a card opens the **inline rename**, not
  Properties; Enter and the toolbar's Edit are what open the panel, and
  `reveal` survives only to place the caret when somebody switches to Source with a pick standing.
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
a person is working on is the innermost one they touched. The pick's half shows in both views —
it is what they are working on in either — and the item's only in Properties, which is what keeps
`pick.spec.ts`'s "the caret still moves the strip, once the source is showing" true.

- **The kind menu is `kindsOf(type)`, which is `Object.keys(dialect.kinds)`** — the same list
  `E_UNKNOWN_KIND` suggests from. Two lists would be two chances to offer a word the parser rejects.
  It is empty for `mindmap`, `timeline`, `gitgraph`, `sequence` and `chart`, whose parsers are their
  own and have no kind word to choose — `series` and `slice` are the statement, not a menu — and the
  control is left out rather than shown empty.
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
  about it. A group is reached by the double-click that renames it, then Escape; a plain click
  picks cards only.
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
a panel that flew open every time somebody clicked a line would be in the way of deleting one.

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
- **The board's frontmatter** — `theme:` and `flow: {width, gap}` — is *Board settings* in the top
  bar's `⋯`, a card over the board (`src/ui/BoardSettings.tsx`) written through `Editor.setMeta`, one
  `MetaOp` and one undo entry, as the page tabs write `pages:`. Only what differs from
  `FLOW_DEFAULT` is written and `flow:` leaves the file when both are the default, so a board nobody
  changed stays as short as it was; a number outside `FLOW_RANGE` is put back in the box with the
  range said. *Follow my settings* is **no `theme:` at all**. The board's theme is the one drawn
  (`pickTheme`, `src/theme/pick.ts`) unless the reader turned on *Use my theme on every board* in
  Settings → Appearance or the address names one (`?theme=`), so when the window is drawing another
  theme than the board asks for, the card says which and why (`data-dag-board-theme-note` carries
  the rule that decided: `board`, `mine`, `address`), instead of a setting that visibly did nothing.
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

### What the panel opens on, and what it opens with

The panel used to open uninvited: **it opened on every drop**, and what it opened on was
the frame. Three rules hold, and the first is the one that matters.

**A drop opens the panel only when the item's body is prose the canvas cannot edit.** That is `md` —
a note, a paragraph, a table — whose body *is* its content and for which the panel is the only way
in. A diagram, a sketch, a shape, a chart: nothing opens, and the person works on the drawing, which
is where every gesture already is. The rule is stated in `place()` and honoured in `add()`, which
needed no change to honour it: `add` is only ever called with `"md"` and `"prompt"` — `N`, a
double-click on the paper, and `P` — so the md case *is* the exception and the prompt card was
already exempt for its own reason. That line is a second place the panel
opens itself; it is the one place it should, and the comment there says so, because the next reader
will otherwise fix it.

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
