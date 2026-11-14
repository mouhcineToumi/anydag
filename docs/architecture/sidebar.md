# The sidebar and choosing a board

> The shell, the file tree and its operations, selection, the search dialog, folders and the page tabs.

## The sidebar

`src/ui/Shell.tsx` and `src/ui/Sidebar.tsx`. A column the full height
of the window: the lockup beside the toggle — which goes home, one press from any page back to the
welcome card, as it does in the toolbar while the column is away — the vault switcher, then Search, Tasks, Calendar, Quizzes and
one **New** row whose menu makes every kind, then Favourites, then the files as a tree,
then Settings at the foot. The sidebar is "in Notion
style", the place people "find their way to most of what the app has to offer"; Notion is the
model for the tree and the peek.

**It reverses the earlier call on its own terms.** The board list's permanent 232px column had been
taken away because a list consulted for two seconds had no business costing canvas on every board.
This is the app's navigation, and it costs
canvas only for somebody who chose to keep it: `ctrl+\` (Notion's chord) or the toggle puts it away
and `dag:sidebar` remembers, with the person's preferences; while it is away a hover on the toggle floats it over
the page; and a window under 720px never docks it — a phone, where it is a sheet over the whole
window, and the home screen when nothing is open. The sheet carries a **Home** row at the top,
because the toolbar hides its logo there with the breadcrumbs and the sheet's head has no mark:
without it, a file open on a phone had no way back to the welcome card. From 720px it docks, and its
default width of 272px gives way to a quarter of the window, never under 232px, which is what a
929px laptop window had room for and could not keep. A width somebody dragged is theirs up to half
the window and 640px: under the quarter rule the grip on that same window moved nothing at all, and
raising the default moves nobody's column — a width already saved is read as it was.
`data-sidebar-sized` on `.dag-shell` (React's) and `data-sidebar-dragging` (the grip's, for the length
of a drag) are what switch `--sidebar-cap`. The grip is a 7px strip that stays invisible until the
pointer reaches it, and then draws the edge it moves as an accent hairline. It is open by default,
because a new person has not learned the key yet. **The toggle is one button in the window's
top-left corner that never moves** (Claude.ai's arrangement): `Shell` draws it above the
column and the page, and the docked header or the toolbar keeps a slot for it.

Fourteen things are load-bearing:

- **The shell is above both pages, which is the whole reason it exists.** `App` renders a `NoteApp`
  or a `BoardApp` and never both, so a sidebar inside either would be torn down and rebuilt on every
  board-to-note switch: the scroll gone, the list fetched again, a flash of nothing. `useBoardList`
  moved up with it, so there is one subscription to the list for the window. `?snapshot=1` renders
  no shell at all — not even the wrapper — so the 45 baselines see the `.dag-app` they always have.
- **The pages still draw the cards.** Settings and the search are rendered by the
  page, because the page knows the theme (`useTheme` holds it in state and hears nobody else's write)
  and the board. The sidebar asks with a document event, `dag:chrome` — **not** `dag:settings`, which
  is the settings-changed event, and one name meaning two things is the hazard recorded above. The
  note page gained both cards, and `ctrl+,`, which it had no way to reach before.
- **The dock is this board, and the sidebar is the app.** Settings left the dock's `⋯` for the
  sidebar's foot, and a dock with nothing to edit now draws
  nothing at all rather than a menu of nothing.
- **The tree is flat rows with a depth**, `rows()` in `src/ui/tree.ts`, rather than nested
  elements: `aria-level`, `aria-setsize` and `aria-posinset` are said on each row, the keyboard walks
  the rows in order (the WAI tree pattern: arrows, Home, End, → into a folder, ← to its parent, F2 to
  rename, `shift+F10` for the menu), and every row carries the folder a drop onto it means. Which
  folders are open is `dag:sidebar-open`, this browser's and deliberately not synced — view state,
  like a scroll position — written with `writeLocal`, which does not wake the preference sync.
  **A row's `⋯` and a folder's `+` live inside its `role="treeitem"`**, because they act on that
  row; the tree owns only treeitems and groups. The loading line, *Nothing here yet* and a refused
  create sit beside it rather than in it, so the tree is never a tree with a paragraph in it.
- **Every file operation lives here and only here.** A row's `⋯`, a right-click and `shift+F10` open
  one menu; a folder's `+` makes things in it, and that row menu's **New in “<folder>”…** opens the
  New menu scoped to that folder — the way a folder is filled on a phone, where the `+` is hidden
  and a finger has no hover. The tree's own empty space — below the last row,
  down to the foot — right-clicked opens the `+` menu at the pointer, which is the only control beside
  Files and the only way a top-level file was made before #121. The open file's row keeps its `⋯` up
  without a hover, and a favourite keeps its star beside it, so a first-time reader sees that a file
  has actions; every other row keeps the hover reveal and every tool is `tabIndex=-1`, so the tree is
  still one tab stop and `shift+F10` is the keyboard's way to the menu. That menu's `here` is carried in the
  state that opens it: the `+` says the open file's folder, the tree's space says the top level, and
  where there is no file to be in the head says *New at the top level* and offers no toggle. The menu
  opens when the vault is locked — as a row's does — with every entry `aria-disabled` and in the
  chrome's blocked style, a press answered by the lock's notice; the `+` still refuses before its menu
  opens. The search dialog carried the same four operations on
  hover icons, and a control in two places is two places to keep in step, so it lost them.
  `Delete` is deliberately not a key: undo is a version of a board's *text* and never reaches the
  file.
- **New note from template is a row of the New menu, and of a folder's menu** — *Note from template…* /
  *New note from template…* — which makes nothing itself: it opens the dialog that asks for a title and a
  template (`openTemplates({ folder })`, a store like the Assistant's, drawn by `Shell`). See *Note
  templates* in [`notes.md`](notes.md).
- **Make, then name — and the name is the title**. The New menu, a folder's `+`, a
  duplicate and the welcome card all make a file under `untitled` (numbered if taken) carrying
  `title: Untitled` (`blankBoardText`, `blankNoteText`), open it, and name it **where its title is
  drawn**: a board, a quiz or a table in a box that opens in the top bar with the title
  selected (`nameInBar`, given the title the file was made with — the board page stays up across a
  board switch, and until the new file is read it holds the last one's), a note or a task in the
  title at the top of its page (`nameWhenOpened`). Escape keeps *Untitled*; leaving the box
  keeps what was typed. The New menu makes the file **in the open file's folder**, says which, and
  offers *Top level*; the creation flow it answers is one that put the next file far from the
  work and said nothing. Enter is `/retitle` with `follow`:
  the title line is written and the file moves to the title, verbatim (`titleName` in
  `server/names.ts`), in the same step, so what
  an agent or Obsidian reads on disk says exactly what the person typed. A `/` in a title is a character,
  never a folder — moving is Move to… and a drag. A row says its title, or its name's last part for
  a file nobody titled, and the rows sort by what they say; a name the column cuts short is whole in
  the row's tooltip. With the column put away, it floats
  over the page to ask. **The menu is the only control beside Files**, with its title naming every
  kind it makes; the folder-with-plus that made a top-level folder at once is gone, because beside
  the `+` it read as a second kind of New. **Folder** is the menu's own row, made where the menu says
  — the open file's folder or the top level — still as `Untitled`, numbered when taken, with the
  row's rename box open.
- **Shell owns the operations, because it knows what is open.** A renamed or moved file stays open
  under the name the server settled on, a folder move carries the open file and the open folders
  with it (`rebase`), and a deleted one leaves nothing open. `fileActions` in `App` went with the
  dialog's file half.
- **A folder moves whole, through `/mvdir`.** A name already taken, or a folder into its own
  subtree, is said in the row as it is typed and never sent; the server refuses both anyway, with a
  409 rather than a number, because merging two folders is not a rename. See *Folders* below for
  the rest of what a folder is.
- **Favourites are names, so they have to be told.** `follow()` in `tree.ts` carries them through
  every rename, move, folder move and delete made here; one renamed somewhere else — an agent over
  MCP, a file moved on disk — names nothing and is left undrawn rather than drawn broken.
  `dag:favourites` is in `PREF_KEYS`: which files somebody keeps at hand follows them.
- **The drawing does not move when the column does.** `Viewport` offsets its pan by however far its
  own left edge moved on a resize, so opening, closing or widening the docked sidebar leaves every
  item where it was on the glass. A view nobody has touched still refits, as it always did.
- **A finger scrolls the list, and only a held row drags**. A row is
  `touch-action: pan-y`, so the browser scrolls a swipe; `startDrag(e, h, HOLD)` arms a touch drag
  only after 450 ms held still, ends the gesture quietly if the finger moves first, and lets
  `holdStill` cancel the `touchmove`s once it is held — a non-passive listener on the tree itself,
  because one on the document is passive and its `preventDefault` does nothing. The hold is the selection's
  long press: `onHold` begins the selection with the row in it, and a move from there carries that
  selection, so there is one timer and one meaning. A finger that lands on a list still gliding from
  a swipe is the browser's: it goes on scrolling and cancels the pointer, so nothing is picked — the
  safe way round.
- **A row asks for its file before the click**. Resting on it 80 ms with a mouse, or
  pressing it with anything, calls `prefetchDoc`; the page's opening read is `openDoc`, which takes
  that answer if it is under ten seconds old and the feed has not reported the file changed. A taken
  answer stays a second, because a page mounted twice in a row — StrictMode — would otherwise open on
  a second request. Every other read of a document still goes to the server.
- **The list is drawn from what this browser kept, and then from the server**.
  `useBoardList` starts from `dag:file-list` — the last list fetched in this workspace, kept with the
  uid it was fetched for and through `readPref`, so a snapshot reads none of it — and the fetch
  replaces it. `BoardTree.loaded` says there is an answer at all, which is what tells *Loading your
  files…* from a vault that really holds nothing; `fresh` says the server has answered on this page
  load, and only a
  fresh list resolves an id to a name, because a kept one may name a file that has moved since.
  **A listing that cannot be asked for is a third state, not a longer wait.** `useBoardList` returns
  `{ tree, failed, retry }`: a 500 or a refused connection sets `failed`, the column draws
  *Can't reach your files*, one line saying nothing saved is lost, and **Try again** — and the
  `refresher` under it keeps asking by itself on a growing delay (1 s doubling to 30 s). A list this
  browser already had stays below the message, dimmed (`data-dag-sidebar-stale`), so a server that
  went quiet does not take the rows away; the first answer clears `failed` and the message goes
  without a reload.
  **An empty vault draws no line under the tree at all**: the Home card says *This vault is empty*,
  and a second set of instructions in the column was the thing that said it twice.
- **A drag carries a chip, and the tree scrolls under it**. On the first move a
  `.dag-sidebar-ghost` — the row's mark and name, or *N items* — is put on `<body>` and moved by a
  painted transform, `pointer-events: none` so `elementFromPoint` still finds the row; the rows it
  lifted wear `data-dag-sidebar-lifted` and fade. A pointer within `GLIDE_EDGE` of the tree's top or
  bottom scrolls it on a frame loop, faster the closer, and aims again after every frame that moved,
  since what is under a still pointer changed. A folder move says *Moving “name”…* under the tree
  while it runs and the server's reason there when it is refused.
- **The open file's row is brought into view once per open file, not on every change in the list.**
  The effect that shows it (`"center"`, and only when it is out of view) depends on `lines.length` so
  that it can find the row when the list arrives after the file does, and `lines.length` is also
  every file or folder anyone makes or removes anywhere in the vault. Run on each of those it pulled
  the list back to the open row whenever a person had scrolled away from it — and undid a drag's
  glide a few pixels a frame as fast as another writer added a row. `shownKey` remembers which file
  it has shown. `e2e/folders.spec.ts` holds it (*a file somebody else makes does not bring the list
  back to the open board*), and the glide's own check passed under load only after it.

**A phone's shell is finger-sized.** Under 720px the sheet's acts, its rows, the Settings row and each
row's `⋯` are 44×44; the `⋯` keeps its 14px glyph inside a 44px box, because a phone has no
right-click and that button is the only way to rename, move or delete. The page tabs' close and the
search card's field and rows follow the same floor. At every width nothing in the shell, the search,
a quiz's answer ticks or a table's strip is under 24×24 — `e2e/touch-targets.spec.ts` holds both
floors, at 390×844 and 1440×900.

Names claimed, grepped first: `dag-shell`, `dag-sidebar*`, `data-dag-sidebar*`, `data-dag-crumb`,
`dag-toolbar__crumb*`, `data-dag-toolbar-home`, `data-dag-sidebar-sheet-home`, the storage keys
`dag:sidebar`, `dag:sidebar-w`, `dag:sidebar-open` and
`dag:favourites`, and the event `dag:chrome` — and for the folder-delete modal `dag-purge*`, `data-dag-purge*`
and `data-dag-sidebar-dialog` — and for the drag ghost and the cached list `dag-sidebar-ghost`, `data-dag-sidebar-ghost`,
`data-dag-sidebar-lifted`, `data-dag-sidebar-loading`, `dag-sidebar__failed*`, `dag-sidebar__retry`,
`data-dag-sidebar-failed`, `data-dag-sidebar-stale`, the storage keys `dag:file-list` and
`dag:recent-files` and the event `dag:follow`. The Home card's own names — `dag-welcome--home`,
`dag-welcome--vault-empty`, `dag-welcome__acts--home`, `dag-welcome__section`, `dag-welcome__sectiontitle`,
`dag-welcome__rows`, `dag-welcome__row`, `dag-welcome__rowtitle`, `dag-welcome__rowmeta`,
`data-dag-welcome-empty`, `data-dag-welcome-start`, `data-dag-welcome-more`, `data-dag-home-recent`,
`data-dag-home-recent-item`, `data-dag-home-recent-kind`, `data-dag-home-due` and `data-dag-home-due-item` —
were grepped too; the diagram owns none of them. The retired `dag-sidebar__*` of the old board-list column
survives only in a comment in `chrome.css`. The sidebar's rows are deliberately **not**
`data-dag-board` or `.dag-board`: the search keeps those, and `boards.spec.ts` counts `.dag-board`.

**A create that fails says why under the tree.** `/create` and `/mkdir` answer the server's own
sentence now — `boardCall` carries `{ok: true, data}` or `{ok: false, error}` rather than a bare
`null`, and `createFolder` returns `{folder}` or `{error}` — and `Shell` hands it back to the column.
The row the list guessed at is taken back, the list stays as it was, and the sentence is drawn where
a row would have appeared (`data-dag-sidebar-create-problem`). While locked, the New control refuses
before its menu opens and the lock's notice says so, with **Unlock**: the same notice every other
refusal uses, not a second one here.

**Deleting asks nothing.** A row's Delete — a file, or a folder with everything in it
— and a selection's go straight to the trash through `Shell`'s `trash`, which lets go of what went the
way a delete always has (the open file, a favourite, a folder shown open, read off what the server
says went) and raises `TrashNotice`, whose Undo puts it all back. The modal that counted what a
folder held, the one that said where an attachment was used and the row's
*Delete x?* were each there because nothing could bring anything back, and went with that reason. A
delete the server refused is said under the tree, as a refused move is. See *The trash*.

**A selection** is several rows acted on at once. Ctrl or ⌘ and a click picks a row or lets
it go, shift and a click picks every row from the anchor — the last one clicked, else the open file —
to this one, and shift and an arrow grows it from the keyboard; a plain click still opens, and lets
the selection go. **On a phone a finger held still on a row begins it** (`HOLD`, 450 ms, or the
context menu Android sends for a long press), and until it is empty again a tap picks or lets go
rather than opening; the row's `⋯` is still its menu. What can be done to it is deliberately short:
**move to a folder, move to another vault, delete**, from a bar under the tree, from the menu of
any picked row (the right-click, the `⋯`, `shift+F10`), or — moving — by dragging any picked row onto a
folder. Six things about it:

- **Anything inside a picked folder goes with the folder**, never on its own as well (`picked` in
  `tree.ts`) — doing it twice is doing it the second time to something no longer there. Folders and
  files mix freely.
- **Each thing goes the way it would alone**, one request at a time, in order: the single
  operations already carry the open file, the favourites and the open folders with them, so a bulk
  action is a loop over them and owns nothing of that. `trash`, `move` and `moveFolder` resolve
  what landed, which is all the loop needed from `Shell`.
- **What could not be done stays selected**, and is said under the tree: a folder whose name is taken
  where it is going is not merged — the single move's rule — and a vault's refusal is its own.
- **The delete is one trip to the trash**: every
  thing picked, each folder with everything in it, and one notice whose Undo takes all of it back.
- **A drag of a selection onto a board places a card for every file in it**, in one write and one
  undo entry, side by side from where it was let go and selected (`placeAll` in `useEditor`): a row,
  because a card's height is the page's to measure and a row cannot overlap itself. The folders in it
  have no card, and the open board is not placed on itself. `dag:place-file` carries the list of
  files it places.
  Onto a folder it refuses one of its own, or one everything picked is already in.
- **The bar is under the tree**: appearing above it would move every
  row under a pointer in the middle of picking them. A selection is kept by whether its rows exist,
  not by whether they are drawn, so a picked row in a folder somebody shut stays picked; one deleted
  elsewhere is let go.
- **The bar says what its actions do.** Each action is its mark and its word — *Move*, *To vault*,
  *Trash* — so none of them is a guess until hovered; a narrow column wraps them onto the line under
  the count, the trash wears the danger colour, and the `×` beside the count lets the selection go as
  Escape does.

Names claimed, grepped first: `dag-sidebar__bulk*`, `data-dag-sidebar-bulk*`, `data-dag-sidebar-picked`
(and `data-dag-bulk-delete*`, gone with its modal).

**The suite runs with it put away.** `e2e/global-setup.ts` seeds `dag:sidebar=0`, because a column
open by default would move the canvas under every check that measures `.dag-viewport`, for a reason
none of them is about. `sidebar.spec.ts` clears the key and checks what a person sees, and
`e2e/sidebar.ts` docks it for a check that needs a row.

**Out, and why:** a manual order within a folder (nothing stores one); pages
inside pages; titles instead of names (`/list` carries names alone); and Recent, which is Home's
(`src/ui/recents.ts`) rather than a second list in the column.

## Choosing a board

`src/ui/BoardBrowser.tsx` — **the search**, a dialog with the file operations on it. It was a
permanent column down the left once, and a `<select>` in the toolbar before
that. What follows is its history as the board list, kept because the reasons still hold; *The
sidebar* above is where the files are worked on now. Three things it does that the
dropdown could not:

- **It filters on every token, in any order.** A board name is words joined by `-` and `/`, so a
  single substring match makes a reader type the separators from memory. `gym data` finds
  `gym-data-model`; `ref seq` finds `reference/sequence`.
- **It draws the folders as a tree.** `boards/local/reference/` is one set — fifteen boards, one
  per diagram type plus `components`, that are also the e2e fixtures and the skill's examples — and
  a flat list of paths said `reference/` fifteen times to say so. See *Reading it as a tree*.
- **Focus roves over real buttons** rather than an `aria-activedescendant` combobox. Enter and
  space already open a button, so the only thing left to write is which one an arrow key moves to.
  Enter in the search box opens the first match.

**The list used to own the file**, and the sidebar's rows do now. `+` made a board, and
every row carried rename, move, duplicate and delete behind a hover — `/create` had existed since the import work with no way to reach it that
did not involve dropping a file on the canvas, and there was no route at all for the other three.
Each one asks its question *in the row* rather than through `prompt()` or `confirm()`: a **browser**
dialog blocks the page, cannot be styled, and cannot be driven by the Playwright checks that prove
it works. That argument was never about ours, which is React, themed, and opened by the suite. The
server keeps names unique by numbering and returns the one it used, so a caller opens what it was
given rather than what it asked for.

### Why it stopped being a column

The column answered everything the dropdown could not and then charged 232px of canvas for it,
permanently, on every board — to show a list somebody consults for the two seconds it takes to
switch. That trade is what ended the column. Six things are load-bearing:

- **The board's own name is what opens it.** Not a `PanelLeft` toggle beside the name, which is
  what the toolbar had: a reader looking for "which board is this, and what else is there" looks at
  the name first, so the name is the control. `space O` is the chord, and the leader rule bends by
  exactly one word to admit it — everything under the leader names a thing to *make*, and this
  names somewhere to go, which it has to because the list is no longer a thing you can see.
- **It opens showing where you already are.** `scrollIntoView({ block: "nearest" })` on the
  `aria-current` row, once, on open. A column could leave this to chance because it was up the
  whole time and stayed where somebody left it; fifty-four boards is six screens, and a card that
  opens at the top makes a person scroll to find out where they are before deciding where to go.
  The empty dependency list is deliberate: re-running it on every `board` change would yank the
  list back under the pointer when a rename or a duplicate lands.
- **Opening a board closes it, and so does making one.** Both are answers to "which board". A
  duplicate is not — it is a file operation, and the next thing anybody does to a copy is rename
  it, which is a row in this card.
- **One Escape, innermost first**: a half-finished rename, then the filter, then the card. Handled
  on the card and stopped, for the reason the settings card states — `typing()` counts a focused
  INPUT, BUTTON or SELECT as somebody typing, which is everything in here, so the window's chain
  cannot see the key.
- **`dag:sidebar` is gone from `PREF_KEYS`.** Whether a dialog was open is not a preference, and a
  key removed from that array simply stops being saved with the preferences; nothing has to migrate.
- **`dag-panel__*` is not `dag-browser__*`.** The search row, the scrolling list, the group
  heading, the empty line and the footer count are shared with the component library, which is a
  column down the *right*. They were `dag-sidebar__*` while the board list was the sidebar; one of
  the two surfaces is now a modal and the other never was a sidebar, so the name says what they
  are — the parts of a filterable list panel. `dag-browser` is the dialog alone.

**`?snapshot=1` shows neither this nor the toolbar**, which is what keeps the 45 visual baselines
independent of the chrome — and is why moving the list changed no baseline at all.

### Reading it as a tree

The card's first rendering was a **flat list of sections sorted by full
path**, each headed by that path in 11px uppercase letterspaced `muted`, with every board at the
same indent whatever folder it was in. So the one line carrying the structure was simultaneously
the hardest thing in the card to read and the only thing saying there *was* any structure — and
with three levels on disk it printed `WORK/PLANNING/DESIGN` above boards indented exactly
as far as a board at the top level. Sorting by path put the descendants next to their ancestor and
left it at that.

`tree()`, `prune()` and `flatten()` in `src/ui/BoardBrowser.tsx` are the answer, and five things
about it are load-bearing:

- **A folder heading says its leaf and nothing else**, in the same mono at the same size as the
  board names it governs, in `ink` at 600 with the folder mark beside it. The contrast against a
  row is weight and colour rather than a different alphabet, and the indent says what the path
  used to. The whole path is the `title`, for the one case where the leaf is ambiguous.
- **One rule per level, at the horizontal centre of the mark above it.** `margin-left: 15px` is
  the row's 8px of padding plus half a 14px icon, and the 9px of `padding-left` after it is what
  puts the line *between* the mark's column and the rows. Four levels of nesting are four lines a
  reader can walk back up.
- **`.dag-panel__folder` stopped being shared.** The component library still wants micro-caps —
  `Generate`, `Shapes`, `Charts` are half a dozen prose headings, which is the treatment's job —
  and a tree is what it is bad at. `.dag-browser__folder`, `.dag-browser__group` and
  `.dag-browser__children` are the browser's; the search row, the list, the empty line and the
  count stay `dag-panel__*`, because those really are the same thing in both.
- **Folders before boards at every level, numerically.** Every file browser's order, and it is
  what puts the structure on screen rather than under twenty loose boards. `localeCompare(…,
  { numeric: true })` is why `round-2` precedes `round-10` instead of following `round-15` — the
  names here are as often numbered as worded, and a plain string sort scatters exactly the sets
  somebody made a folder for.
- **"Empty" is read off the unfiltered tree, and means no boards *and* no subfolders.** Both
  halves were wrong before: it tested a filtered list, so any folder looked empty the moment a
  search excluded what was in it, and it counted only boards — so `planning`, which holds
  `svg/` and nothing else, drew "empty" and offered a Delete that `/rmdir` refuses, being never
  recursive. A button the server would refuse is a lie, which is the rule that button was added
  under.

**Folders-first buried the loose root boards, and that is how the scroll defect surfaced.** The
reveal was `block: "nearest"`, which scrolls the least it can and so leaves the current board
flush against the edge it came in from: the row is on screen and the rows *around* it are not, so
a copy made from its own row lands below the fold, where nothing can hover it. `"center"` costs
nothing when the target is already in the first screenful, because `scrollIntoView` will not
scroll past the top. `e2e/hover.ts` gained the other half — `boundingBox()` answers for a row
scrolled out of an `overflow: auto` list, with a real viewport coordinate outside it, so
`mouse.move` lands on whatever is drawn there and the hover silently does nothing.

### Home

**The app used to open a board nobody asked for.** `boardName` was `?board=` *or `boards[0]`*, so a
cold load landed on whichever file sorted first — a reference fixture as often as not — and the
only signal that this was an accident rather than a choice was not recognising it. It is
`query.get("board")` now, and `src/ui/Welcome.tsx` stands where the fallback did. The layer is
`pointer-events: none` and the card turns it back on, so the paper behind it still pans and zooms —
an invitation, not a gate.

**It is three parts, and no more.** First the ways to start, as tiles: **Board**, **Note**, **Task**,
**More…** (which opens Event, Quiz and Table under them) and **Search**, which shows the board
dialog's `space O`. The tiles have **no bare-letter keys** of their own: the app moved every command
off bare letters after a typed letter landed in a board file (*The leader key*, `editing.md`), and a
single-key shortcut that cannot be turned off is WCAG 2.1.4's failure. They are buttons, and Tab
reaches them.

Then **Recent**, the last five files this browser opened in this vault, newest first, each a row
that opens it again. It is not the index and it is not a preference: `src/ui/recents.ts` keeps
`kind` + `name` in `localStorage` under `dag:recent-files`, scoped to the vault by `storageKey` and
written by the page when a file's address comes up in `App`. Opening a vault therefore writes no
byte of it — the folder never learns what somebody looked at — and a name the list no longer holds
is filtered out rather than drawn as a row that opens nothing. The list is five, as the issue says;
a repeated open moves rather than duplicates.

Then **Due soon**: the tasks the sidebar's own `/__board/list` says are not done and are due by the
end of the coming week, soonest first. It reuses `list.tasks` and `list.titles`, so it is the same
answer the Tasks page draws and there is no second request or second parser. A task past its date
is still due and stays at the top, marked *Overdue*.

**An empty vault gets its own card.** The same *Nothing open* over a folder of two hundred files and
a folder of none said the same thing in both, and the sidebar's *Nothing here yet* line was a second
set of instructions a few pixels away. The title is **This vault is empty**, every kind is a tile,
and Search is not offered because it can find nothing. The sidebar draws no line of its own for the
same state. *Empty* means the server answered and the vault holds no files and no folders: before
that answer the card stays *Nothing open*, so a listing on its way is never mistaken for an empty
vault.

**With nothing open the bar has no `⋯`.** It held Lock and nothing else over a card whose whole job
is to say what can be done, so `Toolbar` draws it only for a file (`boardName`) or a listing page
(which passes a `title`). The Assistant keeps its place there: with nothing open is exactly when
somebody may want to ask it about the vault.

One thing had to give for it. **`contentBounds` answers `1 × 1` when nothing is placed**, and
fitting a 1px box is the maximum zoom, so the window's first resize left the empty plane reading
**400%**. The effect that fits on new content already guarded on `w <= 1`; the ResizeObserver
beside it did not, because that state was only reachable on a board with no items and is now the
first screen anybody sees. A zoom figure about nothing is worse than no figure.

Deleting the open board goes back to this rather than to the first survivor — which was the same
arbitrary pick the `boards[0]` fallback made, landing somebody on a file they did not choose at the
exact moment they deleted one.

### Folders

**A folder is a directory, and a board's name carries the one it is in.** `reference/erd` *is* the
board in `reference/`, which is why the list draws folders as sections and why
**moving a board between them is `/rename` and nothing else** — the route already carried the
board's `.assets/` with it, already made the directory, and already confined the name to the vault.
No move endpoint was written because there was nothing for one to do.

What a name cannot express is a folder with **nothing in it yet**, and that is the whole of what
was added: `POST /mkdir` and `POST /rmdir` (`server/routes/folders.ts`), and a folder listing that reports the folders it walks rather than leaving them to be derived from
the board names. Without it a person presses "new folder", the directory appears on disk, and the
sidebar shows exactly nothing — which is the state anybody is in for the moment between making a
folder and filling it.

Six things are load-bearing:

- **`server/names.ts` exists so the rules about a name can be tested** (`test/server/names.test.ts`).
  `folderFrom`, `folderMove`, `unique` and `cleanSegment` are the rules; it is plain Node with no
  `@/` aliases. A name is any portable file name, not a slug: spaces and capitals stay, what
  Windows cannot store is replaced, and two names that differ only by case are one.
- **`/rename` to the name a board already has moved it to `draft-2`.** `unique` numbers any
  stem whose file exists and cannot tell "taken by somebody else" from "taken by the board being
  renamed"; the guard above it has to run *before* the numbering (a case-only rename is let through
  as itself in `server/vault.ts`). It never showed while the only caller was the rename row, which
  refuses an unchanged name — and then a drop onto the folder a board is already in became exactly
  that call.
- **`folderFrom` reads its refusals off the raw string, before the character filter.** A
  dot-folder or a `.assets` folder is refused rather than made into an ordinary-looking name: by the
  time the segment is cleaned, `book.assets` has become `book assets`, no longer refusable, and one
  character from a board's legacy image store. `components` at the top is the saved-component
  directory, which the listing deliberately does not look in.
- **The whole `<section>` is the drop target, not the folder heading.** The root has no heading,
  so a heading-based target would give the top level nowhere to be dropped; `data-dag-folder-drop`
  carries `""` for the root, which is why every read of it tests `=== undefined` rather than
  truthiness. An empty folder draws an "empty" line partly to say so and partly to be a target
  taller than four pixels.
- **A folder with anything in it is deleted only after a modal that says what goes**.
  Until then it could not be deleted at all — `/rmdir` refused, and a button the server would refuse
  is a lie, so none was drawn — because one click that takes N boards and their assets with them is
  how somebody loses work they cannot get back. The click is a question now: *Delete folder…* counts
  the boards, notes and folders inside, and only its answer sends `recursive: true`. Without the
  flag `/rmdir` is exactly what it was, a 409 for anything not empty — which is what the MCP tool
  still sends, having nobody to ask.
- **A directory appearing is not a board changing, so it has its own event.** `dag:board` carries a
  board's text and a `base`; a directory appearing or going carries neither, so the watcher
  (`@parcel/watcher`, `server/routes/events.ts`) pushes `dag:boards`
  and `useBoardList` refetches. `createFolder`/`deleteFolder` also dispatch it on the window: a
  directory created and populated in one burst is precisely the case a watcher can miss, and a
  folder that does not appear until the next reload reads as a button that did nothing.

`renameBoard` is what `moveBoard` calls, so **the open board follows itself into a folder** exactly
as it follows a rename. The gesture is a drag, and the keyboard's way in — and the pointer's second
— is Move to… in a row's menu, a `<select>` of every folder plus "(top level)", asked in the row
like every other question. Both live in the sidebar, where a drop target is a row's
`data-dag-sidebar-drop` rather than a section, and a folder moves too — see *The sidebar*.

## The page tabs

`src/ui/PageBar.tsx`, along the bottom of the page, rendered by `App` as the **last child of
`.dag-app`** — a sibling of `.dag-body`, so the strip spans the page under the inspector. It
stops at the sidebar, which runs the full height of the window beside `.dag-app`: the
tabs are the board's, and the column is the app's. That is where a spreadsheet puts its sheets and where Excalidraw puts its scenes,
and it is not only convention: in the toolbar the tabs shared a row with the tools, so a page called
"What the office actually produces" came out **wrapped onto three lines inside a box with no
border**, and a reader could not tell one tab from the next. Wrapping the viewport instead was
rejected — that puts an element between `.dag-body` and `.dag-viewport`, whose `flex: 1; min-width: 0`
contract every selector in `canvas.css` is written against, for a cosmetic gain.

**It is drawn only once a board has two pages**: a strip of one tab says
nothing and costs a row of canvas on every board, so a one-page board makes its second page from the
top bar's `⋯` — *Add a page*, wearing the strip's own `data-dag-page-add` — and the strip's `+` does
it after that. Removing the second page takes the strip away again.

Four things about it:

- **A tab has a minimum width, a maximum, and one line.** Truncated with an ellipsis, the whole
  name in the `title`; the strip scrolls sideways rather than letting the tabs shrink, because a
  squeezed tab is what the complaint was. The active one is lifted onto the surface the board is
  drawn on and capped with the accent — a background change alone did not read as *the* page.
- **A reorder is one `MetaOp` and one undo entry.** `reorderPages` in `src/board/pages.ts` is the
  meaning with no pointer in it, and it returns **the same array** when the drop asks for the
  order the board already has, so `pages.reorder` skips the write rather than landing an undo
  entry that undoes nothing. No item is touched: an item names its page by id, and the ids do not
  move. `test/pages.test.ts` freezes the case that would break if they did — a frontmatter that
  declared its pages as bare strings, whose ids `parseBoard` assigns *positionally*.
- **`src/ui/pointerDrag.ts` is the gesture skeleton both new drags share** — arm on `DRAG_SLOP`,
  mark the document, listen on the window, tear down however it ended. Pointer events, never HTML
  drag-and-drop, for the reason the library's drag already gives.
- **Shift and an arrow reorder from the keyboard**, and a plain arrow roves the tablist. That is
  the WAI pattern, and the only way this is reachable without a pointer.
