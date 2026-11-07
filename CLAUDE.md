# AnyDag

A **local desktop app** that replaces Obsidian: open a folder — a **vault** — and its notes, boards,
quizzes, tables, tasks and attachments are listed, edited, linked and searched, with no account and
no cloud. Everything is a plain file in that folder; the app keeps only rebuildable indexes outside
it. This file is the map of the code for anyone working on it, person or agent: what each layer owns,
the rules the gate holds, and the things that will bite. `AGENTS.md` is the same file.

The heart of it is **an infinite canvas that renders technical diagrams from a DSL** —
**fourteen** types: twelve grammars for a kind of system, one for shapes where somebody put them
(`sketch`), and one that draws data (`chart`) — plus markdown, tables and images. **Claude drives it
by writing a file**: `<vault>/<name>.board.md`. The server watches the vault and the page
re-renders. In this checkout the development vault is `boards/local/`, where the repository's own
boards are.

A person can also **edit it with the pointer**, and that reaches inside a diagram: select and move an item, but also pick one of its cards, retype it where it is drawn,
change its kind, grow the next one with the edge already attached, or drag it into a group. Every
one of those is a write to the same file — so the board has two writers and neither can take a
lock. See *Editing on the canvas* below.

And a person can **ask a model for a diagram without Claude in the loop**: a *prompt card* holds a
description, the local server has Gemini (or GLM, or anything OpenAI-compatible) write the DSL with
the person's own key, the real parser checks it, and the card is replaced by the diagram in one
undoable edit. See *Prompt cards*.

And a person can **write a note**: any `.md` in the vault — `untitled.md` for a new one, and
`.note.md` still opens as one — listed and foldered beside the boards and opened full-window at
`?note=<name>` in a Notion-style block editor (BlockNote), under its title. It is plain Markdown an
agent writes too, and an edit rewrites only the block it touched; `[[wikilinks]]` and `![[embeds]]`
are drawn and followed by name, the way Obsidian writes them, and a rename made through the app
rewrites the ones that named what moved. See *Notes* and *Wikilinks follow a rename*.

And **Markdown anywhere holds equations**: TeX between dollars — `$x^2$` in a line, `$$` on lines of
their own — drawn by KaTeX in a note, its editor, a board's text card, a quiz and the PDF, with a single
`$` read by Pandoc's rule so a price stays a price. See *Equations*.

And **a note can be a task**: a `status:` in its frontmatter — `todo`, `in-progress` or `done` — and
an optional `due:` date make it one. **A folder can be a project**: a note with a `project:` in it.
**The three are on one timeline**: a note with a `start:` and no `status:` is an **event**, and the
**Calendar** draws events, tasks and notes. See *Tasks*, *Projects* and *The calendar*.

And a person can **write a quiz** (`<name>.quiz.md`, practised a question at a time, the misses kept
in **Mistakes**), **keep data in a table** (`<name>.table.md`, a typed grid of tabs), and **keep any
file** — a PDF, a picture, a spreadsheet — as an **attachment** in the vault's `attachments/` folder,
referred to by id from any note or board. See *Quizzes*, *Tables* and *Attachments*.

And they **reference each other by id**: every document has a permanent one, `id:` in its own
frontmatter (an attachment's is in `<vault>/.anydag/files/`), a note links to or embeds a board with
`[Title](dag:<id>)`, and every document lists what links to it. Any of them can be opened read-only,
with no editor loaded, at `?view=1`. See *References, ids and the read-only view*.

And **all of it answers a terminal and an agent**: `anydag` (`cli/`) is a client of the same routes
the page calls — it finds the running app through `server.json`, or, with the app closed, runs the
server in-process on `--vault <folder>` — and **`anydag mcp --vault <folder>`** is an MCP server over
stdio whose every tool calls its route. `docs/parity.json` names every feature against its route,
its command and its tool. See *The command line* and *Parity*.

And **the app can be locked**: `ctrl+shift+L` or the switch at the top right of every page makes it
read only — every page draws its read-only half, and every place that writes refuses and says so —
for this window's storage, until it is unlocked. Opening, search, export and practice still work.
See *The lock*.

And **nothing is deleted at once**: a file or a folder deleted anywhere — the sidebar, the CLI, an
agent over MCP — goes to the vault's **trash**, `<vault>/.anydag/trash/`, kept thirty days
(`ANYDAG_TRASH_DAYS`) with its id and its images, and comes back as it was. Deleting asks nothing
and offers Undo; the Trash page at the sidebar's foot restores, and is the one place that deletes
for good. See *The trash*.

And **one server serves several vaults**: the page names one in its address as `?vault=<id>`, the
switcher holds the recent ones, *Open folder…* and *Create vault*, and *Close vault* never deletes a
folder. A file moves between vaults with its id. See *Vaults*.

And **it sends nothing about anyone until they say so**: the first page of the app asks once
whether it may send anonymous logs — errors, which features are used, how fast pages draw — and
Settings → Privacy changes the answer. They go to a sync server's `POST /v1/logs`. See *Logs*.

**Three ways to run it.** The desktop app (`desktop/`, Electron) spawns the server and loads the page
through its own `anydag://` scheme, adding the token from the main process. `anydag serve <folder>`
(`node server/dist/anydag-server.mjs <folder>`) serves the page to a browser on this machine. And
`npm run dev` → <http://localhost:3500/?board=demo> is Vite in front of that server on `boards/local/`,
with `.dev-home/` as the app's home. See *The local server* and *The desktop app*.

**The mark is drawn three times, and that is deliberate.** `desktop/icon.png`, `public/favicon.svg`
and `src/ui/Logo.tsx` — the last as JSX, because no colour may appear in `src/`: the component draws
in `currentColor` and `var(--dag-color-accent)`. The path data is shared and nothing checks it, so
moving one means moving the others. There are two cuts: the full mark (stroke 4.5, a coil of one and
a half turns) and the favicon cut (stroke 6, one turn, a wider opening), because below about 20px
the full mark's gap fills in. **The frame is an open path, never a `<rect>`** with the stroke drawn
over it: the two open ends are the mark, and anything that "tidies" them closed has destroyed it.
`index.html` points at a real icon file because the Playwright run fails on any console output and a
full Chromium asks for one; an icon that 404s would fail the gate.

## The layers, and what each may not know

| Layer | Owns | Must not know |
|---|---|---|
| `src/board/` | the `.board.md` format, fences, attrs, auto-flow, assets, the edit ops, an item's id, the links between items | diagrams, the browser |
| `src/edit/` | selection, the *pick* inside a diagram, gestures, the clipboard, undo, the panel and its controls — how a person changes a board | the format (it emits ops and `src/board/` turns them into bytes) and the grammar (it calls `src/dsl/`'s span writers and never spells a statement itself) |
| `src/dsl/` | tokenizer, one parser per type → **IR**, or a model of its own for `sequence` and `chart`, the span writers that put a control's answer back on the line it came from, diagnostics with line:col | pixels, colours, the pointer |
| `src/layout/` | sizing, ELK config, routing, and the six layouts that are not ELK's | React, CSS |
| `src/render/` | a component per node kind, markers, groups, the frame | how it was laid out |
| `src/theme/` | `theme.json` → `--dag-*` vars, and the object sizing reads | everything else |
| `src/export/` | one item as a standalone SVG | anything about boards |
| `src/quality/` | measuring a finished layout — crossings, routes over cards, label collisions | how any of it got there, or what to do about it |
| `src/settings/` | what the *app* does rather than what a board says — the preference keys, their defaults, the shape check, the sync to the app's home, and the rule that a snapshot reads none of them | diagrams, the board format, the DOM past `localStorage` and `window` |
| `src/auth/` | the one local user the page is told about (`/api/auth/me`), and the gate that loads the app or says the server is not answering | boards, diagrams; there is no sign-in |
| `src/note/` | the `.note.md` format: frontmatter, Markdown ↔ blocks through remark, the span map that rewrites only what was touched, the three-way merge, the editor's schema — and what `$…$` is (`math.ts`), which every Markdown parser here reads | the browser, React, the board format |
| `src/quiz/` | the `.quiz.md` format: the parser, its `EQ_`/`WQ_` codes, and the writers that rewrite one question and no other byte | the browser, React: the server and the CLI import it verbatim |
| `src/files/` | an attachment on the page: its sort and icon, the upload and its refusal, its own page and every preview (`PdfViewer` a lazy chunk with pdf.js behind it), and the page's half of a zip export | what a file *is* — the server decides that off the extension (`server/uploads.ts`), and this only ever mirrors it |
| `src/table/` | the `.table.md` format: the parser, its `ET_`/`WT_` codes, what a cell of each type reads as, sort and filter, the writers that rewrite one cell, line or heading, the ops the api applies, and CSV | the browser, React: the server and the CLI import it verbatim |
| `src/ui/table/` | a table's page: the grid, its menus and editors, the tab bar, Sort and Filter, Source, undo | the format: every change is a writer from `src/table/write.ts`, addressed by id |
| `src/blocks/` | BlockNote configured once — its menus, paste, upload and theme bridge — and loaded lazily | which file it writes: it takes blocks in and hands a `NoteEditor` back |
| `src/view/` | drawing a board or a note read-only — `?view=1`, a snapshot, and what an embed draws with — and what drawing shares with the canvas (`drawing.ts`) | `src/edit/`, BlockNote: a viewer must never fetch either, and `test/view-graph.test.ts` walks the import graph to hold it |
| `src/refs/` | what a reference *is* (`extract.ts`, browser-free), the page's copy of the index, and how a reference, an embed and the backlinks are drawn | a name: every reference is an id, resolved when it is followed |
| `src/calendar/` | what the calendar shows and where (`model.ts`): the days a view covers, each task's, event's and note's days in the viewer's zone, the lanes and the hour-grid columns they pack into, and what an event's bar writes | the DOM, React: `anydag event ls` narrows by the same spans |
| `src/vault/` | which vault this tab is in, the `?vault=` every request carries, the recent vaults and the switcher's calls, and what the desktop shell offers the page (`desktop.ts`) | React, but for the one hook; the disk — a path is only ever handed to the server |
| `icons/` | the brand vocabulary and its provenance — generated, and outside `src/` on purpose | anything about diagrams |
| `cli/` | `anydag`: arguments, finding the server (`server.json`, or one in-process on `--vault`), and turning a command into the op list the page would commit — through `src/board/`, `src/dsl/` and the pointer-free half of `src/edit/` | the disk: every read and write is a route, through the store and its watcher |
| `server/` | the local server: the token and `Host` gate, the vault store, the app's home and its SQLite index, every route, the MCP tools | React, the DOM; the page's state — it answers routes and writes files |
| `desktop/` | the Electron shell: spawning the server, the `anydag://` scheme and the token on every request, windows, the folder dialog, deep links, the `anydag` shim, `safeStorage`, updates | the vault's format: it is a browser and a process manager around the server |
| `sync/` | the sync server, a separate self-hostable process: `protocol/` (the wire and the cryptography, shared with the client), `server/` (Hono, Postgres or PGlite, blobs on disk, quotas, the usage ledger, `/metrics`, the admin CLI) | a path, a byte of plaintext, the app: everything it stores is sealed by the client |
| `src/telemetry/` | the page's half of logs: the answer as the server last said it, the events this page holds, the first-run question | what a log may hold — `sync/protocol/logs.ts` decides that, and every hop runs it |
| `server/sync/` | the app's sync client: `SyncEngine`, its state and bases in the app's home, the loop per linked vault, linking | the server's storage; the page — it says a `SyncStatus` and nothing else |

`src/edit/` is the layer that grew to reach inside a diagram, and it split along one line:
**the gesture is in `useEditor.ts`, the meaning is in a file with no pointer in it.** That is what makes a drop or a
`+` testable without a browser, and readable without one.

| Inside `src/edit/` | Owns | Must not know |
|---|---|---|
| `useEditor.ts` | every gesture and key, and the op each one commits | what a statement looks like |
| `pick.ts` | what a pick *is* — a card, a group, a lane or one segment of an edge — and how to find its line again | the pointer, React |
| `build.ts` | what the `+` appends and what Detach rewrites, as text over text | the DOM: the boxes reach it through `data-dag-layout` |
| `drag.ts` | what a drop inside a diagram *means* — a statement moving, a topic re-indenting, a date | the pointer; it is handed a target and a fraction |
| `Props.tsx` | one control per thing a statement can say, for a node, an edge, a link or the item | which line it writes — `declaredAt` answers that |
| `Rename.tsx` | the input over the drawing, and where the drawing put the text | how a card was sized (`size.ts` sizes a card, never the text in it) |
| `NodeHandles.tsx` | the four link handles and the four `+` handles on a picked card | `Item`: it is placed by `App` in board coordinates |
| `connect.ts`, `snap.ts`, `history.ts` | what may join what · where a dragged box wants to land · undo as versions of the file | all three: the pointer |

The boundary that matters most: **no colour anywhere in `src/`, and no length or SVG style value on
the diagram surface.** A colour comes from `var(--dag-color-…)` or `theme.color.…`; a size from
`theme.metric.…`. That is what makes a theme a folder rather than a refactor.

Two scripts hold it, and both are in the gate. `check-theme.mjs` proves every `--dag-*` the code
reads exists in every theme, and checks the shapes the `Theme` type cannot (`theme.json` arrives
through an unchecked cast). `check-literals.mjs` is the other half, and it exists because this
file once claimed `check-theme.mjs` did its job, and 99 px literals had accumulated behind the
claim. The app chrome is exempt and lives in `src/styles/chrome.css`: no theme has an opinion about
the height of a zoom button, and inventing keys nobody would set is how a design system stops
meaning anything.

## Things that will bite

- **`elk.bundled.js` is the wrong import.** On the main thread its "fake worker" runs the algorithm
  synchronously and blocks the canvas; inside a worker of ours it throws, because
  `elk-worker.min.js` stops exporting the fake `Worker` class once it detects it *is* the worker.
  Use `elk-api.js` + `elkjs/lib/elk-worker.min.js?worker`, which is what `src/layout/elk.ts` does.
- **ELK's port coordinates are deliberately thrown away.** Ports are declared `FIXED_ORDER` so
  crossing minimisation orders a node's targets the way its rows are ordered; the actual anchor is
  computed by `route.ts` from the row's y. ELK spaces ports evenly, and a row is where the text is
  (rule 9).
- **Ports are declared only where a row can be honoured — a horizontal exit.** A row is a horizontal
  band, so its y means something on the left and right of a card and nothing on the bottom;
  `route.ts` drops the row anchor on a vertical exit. Declaring them anyway, on the *diagram's*
  direction rather than the group's, is what made edges twist: a card inside a group running `DOWN`
  advertised an exit on a side no edge would leave from, ELK routed out of it and back around, and
  `route.ts` spliced its own anchors onto that detour. Ports also pull ELK's node placement — it
  aligns a chain on port positions, which staircases a group that should stack.
- **`colGap` is horizontal and `rowGap` is vertical**, whichever way the pass that produced them
  ran. ELK's two spacings are named for the algorithm — between layers, and within one — and which
  is horizontal depends on the direction, so a group running `DOWN` inside a diagram running `RIGHT`
  got them transposed and its cards sat 32px apart with an edge to fit between them.
- **A hoisted edge's bends belong to the groups, not the entities.** `hoist()` rewrites an edge for
  ELK's benefit; its bend points then describe a route between two group boxes. Splicing those onto
  anchors on two entities draws a tenancy line as a rectangle around the whole diagram, so
  `elk.ts` drops the bends for every edge it hoisted.
- **A dogleg is what gets past the card next door.** A row anchor is fixed on its card's side and
  the next card starts one `colGap` away, so the chord to anything not in that card runs through
  it and no bow leaving a fixed point can rise fast enough. `detour()` in `route.ts` leaves the
  row, turns in the gap, runs along a clearance row and comes in on the target's own side — on
  either axis, by solving the transposed plane — and `sideArc()` handles two cards in one column
  with a third between them. Both drop coincident points: a zero-length leg divides by itself and
  writes `NaN` into the path, and the browser then draws nothing and logs an error naming no edge.
- **`elk.separateConnectedComponents` has to be set on every group.** Root-only it was, and
  ELK's default is the opposite: inside a group, children with no edge between them were packed
  as separate components by size, and no model-order option could reach them.
- **Two facing control arms compete for one gap.** `edge.reach` has a 56px floor and an ERD stacks
  cards `rowGap` — 32px — apart, so a short hop got 112px of control arm in a 32px gap, each arm
  reaching past the other, and a straight little connector came out as a wiggle. When the two sides
  face each other (`na · nb < 0`) both arms are scaled back to meet at most in the middle. Scaled,
  not clamped: the ratio between them is the shape.
- **Two edges between one pair of cards tie on the fan, and a stable sort crosses them.** `a --> b`
  and `b --> a` point at the same centre from both ends, so the fan's angle cannot order them and
  each card kept them in written order — which, on two facing sides traversed in opposite
  directions, puts each edge's ends on opposite halves: an X in the gap with a label at the middle
  of each stroke. `fanOrder` in `route.ts` mirrors the tie between the two ends, and
  `bundleOutward` puts each label on its stroke's outer side. The scorer had excused it too — any
  two edges sharing a node were skipped — and a symmetric pair crosses exactly at a joint of both
  flattenings, which `crosses` does not count; a same-pair check flattens at an odd step count.
- **A label's `x` is where it is anchored, and it is centred only for `middle`.** Beside a vertical
  run a label starts or ends at `x`. `separateLabels`, `labelFor`'s obstacle test and the scorer
  all read `x` as the centre, which pushed two labels either side of a loop apart for a collision
  that was not there; and the graph layout's size was taken from the cards alone, so a long label
  beside the last column ran through the frame. `labelReach` is what the size adds — on all four
  sides, because `bundleOutward` hangs a loop's other label *left* of its stroke, and past the
  origin it is drawn outside the item where `content-visibility` clips it: "report the status back"
  came out ":he status back". `layoutGraph` moves every box and bend clear by a whole grid step and
  routes again, which is exact because routing is translation-invariant.
- **ELK places on fractional pixels.** Everything is snapped to `metric.grid` (8).
- **The frame's body offset is derived, never a key.** The theme carried `frame.bodyTop: 152` from
  the artboards while `nodes.css` drew the body at `pad + head + ruleGapTop + hair + ruleGapBottom`
  = 129, and the 23px between them put every board link into a framed card, and then every pick
  handle, 23px low — invisible for as long as the scratch boards were bare. `DiagramItem`
  now adds up the same parts the CSS does; `bodyTop` and `ruleY` are gone from the contract. A
  metric nothing draws from is a claim, and a claim drifts.
- **Sizing must never read the DOM.** `layout/size.ts` is arithmetic over theme metrics plus canvas
  `measureText`; the renderer is obliged to produce exactly those boxes. Measure-then-lay-out would
  mean two passes and a visible twitch.
- **Fonts change every measured width.** Layout keys include `measurer.generation`, which bumps once
  when the webfonts land, and everything re-lays out. A snapshot taken before `document.fonts.ready`
  is a different diagram — hence `data-dag-ready`.
- **`document.fonts.ready` waits only for faces something has asked for.** A card is measured on
  a canvas before it is drawn, and `measureText` does not reliably start a webfont loading, so a face
  nothing on the page had drawn yet was measured as the fallback — and `generation` never bumped,
  because `ready` had nothing to wait for. Editor pages got Fira Code by accident, from the chrome's
  mono labels; the read-only pages (`?view=1`, `?snapshot=1`) never did, and four reference
  baselines were taken with every meta line sized in the fallback. `main.tsx` now loads
  each face by name (`FACES`) before the first render, on every page; a face added to the imports
  there wants a line in that list.
- **`src/board/` and `src/dsl/` are bundled into the server and the CLI**, plain Node outside Vite
  entirely, as are `src/note/`, `src/quiz/` and `src/table/`. Keep them free of browser APIs **and
  of `@/` aliases**: that property is the whole reason the grammar is a function call in the
  server rather than a second implementation, and nothing checks it but this sentence. The *Vite
  plugin* is what first required it — `vite.config.ts` is loaded by Node before Vite's aliases
  exist — and the constraint outlived it for a better reason.
- **A wheel with `ctrlKey` set is not necessarily a ctrl key.** A trackpad pinch arrives as exactly
  that, whatever is or is not held down. One branch therefore serves both, and the wheel handler
  tests the modifier rather than trying to tell a gesture from a keypress — which is also why
  scroll-to-zoom cannot be reinstated without breaking pinch.
- **`data-zoom` on `.dag-viewport` is painted, never rendered.** `paint()` writes it in the same
  statement as the transform it describes. As a React attribute it was one frame stale by
  construction, and the dev size assertion fired on a random board every other run because a
  measurement taken during the initial fit divided a scaled rect by 1.
- **There is no server inside Vite.** The api is the local server (`server/`, Hono):
  `vite.config.ts` proxies `/__board` and `/api` to it with the token, and `npm run dev`
  (`scripts/dev.sh`) starts it on `boards/local/` before Vite. The live channel is SSE —
  `src/board/events.ts`, one `EventSource`
  for the page, fanned out to its hooks — and not `import.meta.hot`, which is `undefined` in a build
  and made a built app go quietly stale rather than fail.
- **`content-visibility: auto` clips.** It brings paint containment, so anything an item draws
  outside its own box — the selection chip above it, the handle at its corner — is cut off. A
  selected item turns it off; it is on screen anyway.
- **…and it skips before it decides.** A brand-new item's contents are *skipped* until the browser
  first works out whether it is on screen, and a skipped subtree measures 0×0. The dev size
  assertion checks on `document.fonts.ready`, which has almost always resolved — so it ran a
  microtask after mount, and a diagram small enough to be laid out that fast (a prompt card's
  three-card answer) reported every card as 0×0, one run in twenty. It now skips while
  `checkVisibility({ contentVisibilityAuto: true })` is false and checks again on
  `contentvisibilityautostatechange`.
- **`h=` is a minimum, and the measure is what the flow trusts.** Every body draws `h=` as
  `min-height`, so the measured height already includes it; `flow.ts` takes the measure first
  and `h` only before there is one. The earlier rule — skip the measurement when `h` is set —
  meant an item with `h=` never reported a size, and `data-dag-ready` waited for it forever. A
  *node* carries the same attribute with the same meaning, in `size.ts` and for every kind.
- **`pointer-events: none` belongs on what the drag *moves*, not on what was pressed.** A tab
  being dragged is translated by its `.dag-tab-wrap`, and the rule was written against the
  `.dag-tab` inside it — so the button stopped answering `elementFromPoint` and the span around it
  went on answering for every pixel of it. The drop target was therefore always the thing in your
  hand: the indicator never painted, the drop was refused as a non-move, and nothing anywhere said
  why. The `pointerup` target is what named it — the wrap, not the tab under the pointer.
- **A drag ends on a different element, so the `click` it would suppress never arrives.** Both new
  gestures set a flag on the drop and read it in `onClick`, and clearing it *there* leaks: a
  reorder or a drop into another folder dispatches no `click` at all — a `click` needs the press
  and the release on one element — so the flag stays set and swallows the **next** real click,
  which is a tab that will not open or a board that will not. It is cleared when a press starts.
- **A control that only exists on `:hover` cannot be waited for with `expect().toBeVisible()`
  alone.** The row actions are `display: none` until hovered, and the list re-renders under the
  pointer after every write — so a check that polls the *file*, sees the rename land and clicks
  immediately finds a button that had a box a moment ago and does not now. Waiting on the DOM
  state the test is actually about — the folder's "empty" line — is what settles it, which is the
  one-round-trip-stale rule below wearing a different hat.
- **The board is one round trip stale after a write.** `useBoard` adopts the server's text the
  moment the response lands, but between a commit and that response `board` still describes the
  file as it was. An op built in that window can name an item the previous op deleted, and the
  whole patch is refused. A person cannot type that fast; a test can, so the e2e specs wait on
  the DOM, not only on the file.
- **A gesture that repeats is a gesture that must paint and write separately, and the nudge was
  the one that did not.** `nudge` called `move`, which paints *and* commits — so a held arrow key
  was one `POST /patch` per OS key repeat, about thirty a second — roughly thirty times the
  sustained write rate a single document expects, and invisible only because each write is a few
  hundred bytes. `move` is
  `paintMove` + `writeMove` now, and the nudge paints on every repeat and writes on the keyup —
  exactly what a drag does on release, and why `onKeyUp` was already where the undo run is sealed.
  Two consequences worth keeping. **The pending targets accumulate in a ref rather than being
  recomputed from `places`**: two repeats inside one frame both read the same un-rendered position,
  and the second then writes the first one's answer — ten repeats moved an item 8px instead of 80.
  And **the seal happens after the write resolves**, because `history.push` runs once `patch` does
  and a seal landing first ends the run that push is meant to join. `NUDGE_SETTLE` is the safety
  net for a run that never gets its keyup, which is a window blurred with the key held.
- **A middle click is a paste on Linux.** Chromium fires `paste` with the X11 primary selection
  on a middle press, and a middle drag is how the board is panned over an item — so a pan dropped
  whatever text was last selected anywhere onto the board as a note. `useEditor` ignores a paste
  within half a second of a middle press. The e2e suite found it: one test's copy was the next
  test's paste.
- **The chrome and the diagram share one class namespace, and the diagram wins.** `chrome.css`
  loads first, so a name it shares with `nodes.css` is overridden wherever they disagree. The
  properties strip was `.dag-strip` for about ten minutes; `nodes.css` already owned that name
  for a timeline's section bar, and the panel's new block came out `position: absolute` on top of
  its own header. Chrome names are `dag-props`, `dag-offer`, `dag-board-row` — check `src/styles/`
  before adding one, because nothing fails and the symptom is a layout that looks deranged.
  **`data-dag-*` is the same namespace and the same hazard**, and it does not even need CSS to bite:
  the strip's icon field was `data-dag-icon`, which every card on the surface already carries, so a
  selector that should have found one input found three cards as well. Chrome hooks are
  `data-dag-prop-*`. It has now bitten three times: `data-dag-rename` was the board list's button
  before it was the inline input's box, and **`data-dag-group` is on `.dag-item`** — the board-level
  group — as well as on a boundary inside a diagram, so a `closest("[data-dag-group]")` that escapes
  its diagram reports the item as something to drop a card into. Check `src/styles/` *and* `grep`
  the attribute before adding either. The page strip and the folders added `dag-pagebar`,
  `dag-folder-row`, `dag-folder__act`, `dag-board__move` and `data-dag-pagebar`, `data-dag-tab-drop`,
  `data-dag-folder`, `data-dag-folder-drop`, `data-dag-folder-over`, `data-dag-new-folder`,
  `data-dag-folder-name`, `data-dag-folder-delete`, `data-dag-move`, `data-dag-move-to` — every one
  grepped first, and `dag-strip` rejected again on the way past, `nodes.css` already owning it.
- **A hardcoded number in a gesture is a setting nobody can reach.** `onPaste` and `importFiles`
  posted a literal `w: 520` for every image, and `.dag-image img` is `width: 100%` — so a
  1002-pixel screenshot was drawn at 52% and the obvious diagnosis, compression, was wrong: nothing
  between the clipboard and the disk has ever touched a pixel. It took reading the whole path to
  find that the defect was one literal, and the fix was arithmetic (`src/edit/image.ts`) rather than
  a quality slider — which would have been a control that changed nothing.
- **`page-1` is two different answers, and only one of them is a mistake.** It is the id of the
  implicit single page *and* what an item with no `page=` fell back to — so on a board declaring
  named pages, a fence appended with no page of its own reported `EB_UNKNOWN_PAGE` naming a page
  nobody had written, while drawing in plain view. `parseBoard` now tracks which items never named
  a page: those belong to the first page, whatever it is called, and only an item that *names* a
  page the board does not have is reported. The `/asset` route was the other half — it appended an
  image fence with no page at all, so a screenshot pasted on page four landed on page one.
- **A `:hover`-only control needs the pointer move and the click retried as *one* thing.** The
  board list's row actions are `display: none` until hovered, and the list re-renders whenever any
  board file appears or disappears — which, with the suite eight workers wide over one `boards/`
  directory, is constantly. `locator.hover()` is not enough (Chromium recomputes `:hover` against a
  new node only on a real move), and that half was understood; what was missing is that the
  re-render can land *between* the move and the click, leaving a pointer that was correct when it
  was made aimed at a node that no longer exists. Retrying the click alone cannot help.
  `e2e/hover.ts` is the pair under one `toPass`.
- **A poll whose condition the *starting* file already satisfies is not a wait.** The timeline drag
  check waited for its date to be `.not.toBe("")` and the board had been written with a date, so it
  returned immediately and the assertion under it raced the write. What it meant was "the date
  changed". Worth grepping for whenever a check reads bytes it seeded itself.
- **Waiting for a *file* is not waiting for the page.** The board is one round trip stale after a
  write, and the boxes a tidy runs over are measured a render after that — so pressing `T` twice,
  with only a poll on the file between, tidies stale boxes the second time, moves things again, and
  `moved` is never 0. Wait for something the page renders.
- **`typing()` counts a focused `BUTTON` and `SELECT`, so a dialog full of controls cannot use the
  window's Escape.** The chain in `useEditor` is skipped the moment focus lands on anything a person
  could be typing into, which is right and which means the settings card had to take focus and
  handle its own Escape — stopping it, so the chain's order is still one order. The shortcut sheet
  has the same shape and has always been closed by its scrim or its button.
- **A `--dag-*` custom property is a *theme token*, and `check-theme.mjs` reads the prefix
  literally.** The panel's remembered width is `--inspector-w` for exactly that reason: no theme has
  an opinion about how wide somebody dragged their editor, and naming it `--dag-inspector-w` demanded
  a key in all three themes. Same argument as `chrome.css` itself. `--canvas-x` and `--canvas-w`
  are the second pair to be named this way, for the same reason.
- **`.dag-body` is not the canvas, and five floating things were positioned as though it were.**
  The dock, the selection bar, the problems dock, the which-key strip and the zoom cluster are
  `position: absolute` inside `.dag-body` — right, because it keeps them out of the flex tree and
  leaves `.dag-viewport`'s `flex: 1; min-width: 0` contract alone — but `.dag-body` spans the board
  list and the panels too. So `left: 50%` was the middle of the *window*: with the list open on a
  1600px screen the dock sat 116px left of the board's middle, and `right: 12px` put the zoom
  cluster **on top of the library** whenever it was open, over the caption that says what a click
  does. The selection bar was the visible one — it grew a rewrite field, never shrinks, reaches
  944px, and on a narrower window it ran off both ends and covered the board list's search
  box. `App` publishes the viewport's box as `--canvas-x`/`--canvas-w` from a ResizeObserver and
  the five rules read `--canvas-mid` and `--canvas-right`; the bar is capped at the canvas and its
  row wraps. Painted rather than rendered, the way `data-zoom` and `data-pan` are, and for the same
  reason: state here would re-render every child of `App` on every drag of the inspector's edge.
- **A hue is bound, never defaulted in a component.** `hueVars()` sets `--dag-h`/`--dag-t` only when
  an element has a hue, and CSS falls back to `--dag-h-default`. Setting the property to an empty
  string would *not* trigger the `var()` fallback, which is why "bind nothing" is the mechanism.
- **A `--dag-metric-*` that is a ratio or a count needs `UNITLESS` in two files.** `donutInner`,
  `minLabelPct`, `maxTicks` and `markerMax` reach the browser as `0.62px` and `6px` otherwise, and
  nothing fails — `applyTheme.ts` holds the list and `check-theme.mjs` mirrors it, and the mirror is
  a copy that can drift.
- **A `<svg>` is `inline` by default, and an inline box sits on a text baseline.** The chart's
  wrapper came out four pixels taller than the layout said, on every chart, with nothing in the DOM
  to explain it — the descender room under the line the `<svg>` was sitting on. `.dag-chart` is
  `display: block` for exactly that, and the size assertion in `DiagramItem` is what said so.
- **A `clipPath` id belongs to the item, not to the module.** The legend column clips its labels
  through `url(#…)`, and a fragment id is resolved page-wide: two charts on one board sharing one id
  means the second one's labels are clipped to the first one's rectangle, silently and only when
  there are two. `ChartView` builds the id out of the *item's* id rather than from `useId()`, which
  also keeps it stable across a re-render, an export and a screenshot. Same defect `replaceIDs()`
  exists to stop for icons, one layer up.
- **`outline` draws nothing on an SVG `<g>`, and neither does `z-index`.** The pick ring is
  one line of `chrome.css`, and it resolves against a chart's series to an element the
  browser paints no box for — a picked series looked exactly like an unpicked one, with the
  attribute correctly on it. The marks carry it instead: a stroke on a bar, a wedge or a marker sits
  outside its own fill and changes no geometry, which is the property the outline was chosen for in
  the first place. A line is the one mark that already wears a stroke — its hue — so a picked line
  takes the accent for as long as it is picked.
- **`--update-snapshots` leaves a baseline alone when the change is inside the tolerance.** The
  screenshot checks allow 1% of pixels to differ, and Playwright's default update mode rewrites only
  a baseline that *fails* — so a small cloud moved 240px, or every link on a board shortened by 8px,
  passes, is not rewritten, and quietly spends the tolerance the next real change needed. A change
  that is *meant* to move pixels is regenerated with `--update-snapshots=all`, and read.
- **A check that asserts something is absent must be able to find it.** `[data-dag-error]` was
  asserted absent seventeen times while no element carried it, and `reference.spec.ts` asked for
  `.dag-error`, which a broken diagram stopped drawing the moment the problems dock landed. Both
  passed on anything. Search `src/` for a selector before trusting a `toHaveCount(0)` built on it.
- **OpenCode Go's HTTP endpoint is not ours to call.** `https://opencode.ai/zen/go/v1` answers the
  OpenAI shape and then refuses it: *"Request is missing x-opencode-session"*, and its docs say the
  plan is for coding agents that identify themselves and carry a session, with traffic monitored for
  abuse. AnyDag spoofing that header would be exactly the traffic singled out. GLM through Go
  goes through `opencode run` — the client it was built for — and Z.ai's own API is the HTTP route.
- **`opencode run` headless needs five things, and OpenCode 2 changed all of them.** 1.x took
  `--pure`, `--dir` and `--variant`; 2.2 prints its help for any of them and exits 0. What a run wants
  now: **`--standalone`**, or it goes through the person's background OpenCode service, whose config —
  MCP servers, plugins — is not the one handed to it; **`XDG_CONFIG_HOME` pointed into a throwaway
  working directory**, so the global config is not loaded either (on 1.x its MCP servers held every
  call for a minute and cost 66k input tokens of tool schemas), with the login left alone under
  `XDG_DATA_HOME`; **the agent in `OPENCODE_CONFIG_CONTENT`**, its prompt as `{file:/abs/path}`
  because an environment string has a ceiling of its own; **`permission: {"*": "deny"}`**, which 2.x
  reads and which leaves the tools out of the request — a one-word answer is about 500 input tokens,
  13,700 with the default agent's tools (1.x took `tools` by name and hung on `"*": false`); and
  **the session deleted after**, by the id its events carry, because a standalone run still writes
  one into the person's history — 1.x runs left a dozen behind. The thinking level is `model#variant`
  now. `opencodeComplete` in `plugins/generate/llm.ts` is all of it, `test/llm.test.ts` holds each,
  and `opencodeReady` refuses a 1.x with "upgrade" rather than half-working.
- **A stub is a claim about another module, and a wrong one passes every test.** The MCP tests
  stubbed the grammar once with a `{sheets: [...]}` shape `GET /dsl` had never returned, and a
  resource raised on every call while nineteen tests agreed it was fine. The rule is not "do
  not stub": it is that a stub written from what the caller *expects* tests the caller against
  itself. `test/fixtures/dsl-answers.json` is the grammar's own recorded answers, held to the live
  handler by `test/dsl-service.test.ts`, and a stub is copied from a route, never invented.
- **An `EventSource` cannot send a header, and that decided how the token travels.** The live
  channel is one `EventSource` per page, and an `<img src>` pointing at an attachment is another
  request no script dresses. In the desktop app the main process adds the header to every request
  on its scheme, so neither notices; in a browser it is the `anydag_token` cookie, which rides on
  both with no client change. A token in the query string would be a credential in every log there
  is, which is why `/?token=` is accepted once and then taken out of the address.
- **`?snapshot=1` strips the chrome, never the token.** Every Playwright check and both scripts
  open a board that way, and an exemption would be a query string any page on the machine could
  load. `scripts/session.mjs`, `e2e/global-setup.ts` and the CLI's `snapshot` find the token
  (`ANYDAG_TOKEN`, else `server.json` in `ANYDAG_HOME`, `.dev-home/` or `~/.anydag`) and hand the
  browser the `anydag_token` cookie.
- **A context made through Playwright's `browser` fixture inherits everything in `use`.** Not just
  `baseURL` — `storageState` too. So `browser.newContext()` in a test that wanted a browser which
  had never been here before arrived with the suite's stored state, the very mechanism it was
  testing switched on already. `storageState: undefined` is how to ask for a clean one.
- **A preference sync without a clock is a switch that flips back on its own.** The server's copy
  is written on a debounce; toggle the library and reload inside it and the older copy is what
  gets adopted, which reads as a click that did not register rather than as a sync. The bundle
  carries `at` and the browser keeps its own, and the newer one wins — `settings/sync.ts`.
- **Every span writer moves the key it rewrites to the end of the statement.** `writeModifier` cuts
  the old span and splices the new one at `insertAt`, so `x=0 y=0 w=120 h=48` rewritten on the x
  axis comes back `y=0 h=48 x=0 w=240`. It is uniform, it is stable after the first write, and it is
  what `setModifier`, `setGeometry`, `detach()` and every card drag have always done — so
  it is not a defect to fix inside one feature, but it is why a byte-exact test of a writer asserts
  an order nobody typed, and why a resize shows up in a diff as more churn than it is.
- **A fixed layout's numbers are not the file's.** `layoutSketch` draws the drawing's top-left at
  `0,0` so the frame hugs it, and says in `LaidOut.origin` where the file put that corner. A writer
  that turns a laid-out box back into `x=`/`y=` adds the origin at the top level (a child is
  relative to its container and needs nothing) — `fileAt()` in `src/edit/build.ts`. Writing the
  layout's number back as the file's is what made an 8px drag move a card 104px in any sketch with
  a negative coordinate in it. And a writer that moves the corner — the leftmost box dragged right,
  a `+` grown out past the top, Detach dropping ELK's padding — writes the fence's `x=`/`y=` by the
  same amount in the same op (`writeShifted` in `useEditor`), or everything else in the drawing
  slides the other way under the pointer.
- **A floating control keeps out of the handles, not out of the item.** A handle is absolutely
  positioned outside its owner's box, so neither the item's rectangle nor anything computed from
  it contains one. The selection bar kept 12 screen pixels clear of the item and sat on the south
  connect dot — 30 *board* pixels out — at every zoom from about 40% to 230%, and when it
  flipped above it sat on the north one. `SelectionBar`'s `place()` widens the box it keeps out of
  by every `.dag-handle`, `.dag-connect-handle`, group box and picked-card tool it can find, measured
  one by one; `selbar.spec.ts` asks `elementFromPoint` at every handle's centre at three zooms.

- **A request's `close` is not the client leaving.** Node emits it on the `IncomingMessage` once
  the body has been read — before a single token of a model's answer — so cancelling a generation
  on it cancelled every generation. `res.on("close")` with a `writableEnded` check is the client
  going away.
- **`ViewportHandle.reset()` is a *fit*, whatever the name says.** It is `() => fit()`, while the
  `0` key is `commit(1, applied.current.off)` — two different answers, and only the second is
  100%. A zoom readout wired to `reset()` would have framed the content instead, which is a
  control lying about its own label — hence `actual()` beside it, rather than reusing a
  name that was already taken by something else. The live percentage goes out on a `dag:zoom`
  document event for the reason `data-zoom` is painted rather than rendered: holding the zoom in
  `App` state re-renders every child of `App` on every wheel step.
- **A helper that normalises a font changes every box that never asked it to.** `titleFontFor` in
  `size.ts` was written to carry the emphasis flags to every place a title decides a box, and it
  defaulted the weight to 600 — right for ten of the eleven, and wrong for a sketch input, whose
  placeholder had always been measured in the meta's regular 400. Nothing failed: `TableMeasurer`
  short-circuits on mono before it looks at the weight, so every unit test agreed, and only a
  browser would have drawn the difference — a wider box around text that had not changed, on every
  board with an input on it. The weight is a parameter now, defaulting to what each site already
  passed, and the rule is that **the flag changes the font and the helper never does**. The 45
  reference baselines coming back byte-identical is what says it holds; they were the only
  instrument that could have said it.
- **A rotated `ChevronDown` points where the rotation puts it, not where you meant.** The Advanced
  disclosure turned its chevron 90° clockwise when it *opened*, which aims a down-arrow at the
  left margin. Shut is `-90deg` and open is `0`, so it points at what opening it would reveal.
- **BlockNote's own Markdown is not the file's, and must never be let near one.** Measured over
  every `md` body in `boards/local/`, its converter changes how 107 of 149 draw and 22 change again
  on a second save: every wrapped line becomes a hard break, bold around inline code becomes literal
  asterisks, list continuation lines break out. `src/note/markdown.ts` converts through remark both
  ways, and BlockNote only ever sees blocks — including on paste, where its default handler would
  otherwise parse `text/plain` with that same converter. See *Notes*.
- **ProseMirror redraws any attribute it did not set, on any node it owns.** A block a search
  result opened onto was marked by setting `data-dag-found` on its element, and the mark never once
  showed: the editor's `MutationObserver` saw a change to its own DOM and put the node back before
  the next frame, silently. The mark is a CSS highlight now — a `Range` registered in
  `CSS.highlights` and painted by `::highlight(dag-found)` — which touches no element at all. The
  same will be true of a class, a style or a child: inside the editor, the DOM is ProseMirror's.
- **TipTap's `code` mark excludes every other mark.** So BlockNote cannot hold `**`x`**` — handed
  the pair it throws `Invalid collection of marks for node text: bold,code`, and parsing HTML it
  silently splits the bold. `src/note/schema.ts` is `Code.extend({ excludes: "" })` through
  `createStyleSpecFromTipTapMark`, which keeps the backtick input rule and `Mod-E`.
- **A lazily imported dependency is discovered by Vite at the moment it is first imported.** The
  first note opened in a fresh dev server made Vite re-bundle and reload the page — twice, once per
  layer of the editor — under whoever was looking. `optimizeDeps.include` names the BlockNote and
  Mantine entry points so they are bundled before the first page is served.
- **A span map has to be re-based on every save that lands.** The first version kept the map from
  when the note was opened, so a paragraph a person had edited *and saved* still counted as edited;
  the next outside write replaced it rather than keeping it, and the caret in it went with it — to
  the start of the next block. `saved()` returns the map for the body it wrote.
- **A marker cleared by `.finally()` has to compare against the promise it was set to.**
  `writing.current = next.finally(() => { if (writing.current === next) … })` never clears — the
  stored promise is the `finally` one — so every outside write after the first save looked like a
  save was in flight and was ignored, for ever, with nothing logged.
- **Chromium logs any 4xx as a console error.** A note's 409 is the answer the merge tests are
  about, so those two filter exactly that line; every other check still fails on it.
- **A `keepalive` fetch over 64 KB is refused before it is sent.** Every note save carried
  `keepalive: true`, so a save fired from `pagehide` would outlive the page — and so every note
  larger than that silently stopped saving, with the notice scrolled out of sight above where the
  person was typing. Found by asking how the editor performs, not by any test. `keepalive` is now
  set only for a save fired as the page goes away, and only while the body fits.
- **A save that fails for no reason of its own goes again on its own.** It used to wait for the
  next keystroke, so text typed just before an api restart stayed unsaved for as long as the
  person had stopped typing — found by clicking "Start writing" while the container was being
  rebuilt. A network error or a 5xx retries on a backoff (1 s doubling to 15 s) on the same
  `timer` a keystroke sets, so typing brings it forward and the outside-write listener holds off
  for it; a 4xx other than a 409 is an answer about the request and still waits for a change.

- **A peek that slides over the control that summoned it swallows the click meant for it.** The
  sidebar's hover peek first ran the full height of the window, so it arrived on top of the toolbar
  toggle under the pointer, and the click that should have docked it landed on the sidebar's own
  logo — Playwright reported "subtree intercepts pointer events" one run in four, and a mouse would
  have done the same every time. It floats below the toolbar now. Anything that appears on hover
  must not cover what is hovered.
- **Swapping a button's icon under a still pointer is a `pointerenter` in React.** The sidebar's one
  toggle first drew `PanelLeftClose` docked and `PanelLeftOpen` away, and a click that put
  the column away peeked it straight back: the new `<svg>` replaced the node under the pointer,
  Chromium fired `pointerover` on it with no related target still in the tree, and React's
  enter/leave emulation read that as the pointer arriving at the button from outside. A real mouse
  does the same. The toggle wears one glyph in both states, as Claude.ai's does, and says which way
  it goes in its label — anything with a hover handler keeps its children's nodes still under a press.
- **A drag in a list the suite shares can be aimed at a row that moves mid-air.** Eight workers make
  and delete their own folders at the top of one `boards/`, and one appearing above a test's rows
  shifts every row down while the pointer is between press and release, so the drop lands on
  whatever slid into the target's place. `folders.spec.ts`'s `drag` re-aims until the target itself
  is marked: the hover-control rule above, met by a drag.
- **A script that hands its browser the token has not handed it to its own `fetch`.** `snapshot.mjs`
  put the session into Playwright's context and then asked `/__board/diagnostics` with a bare
  `fetch` — a 401, whose body has no `board` and no `items`, so it printed no diagnostic and exited 0
  on a board full of errors, the exit code the skill's loop branches on. Nothing failed, because a
  missing list reads as an empty one. `authed()` in `scripts/session.mjs` is the `fetch` with it.
- **A pasted image's id is the digest of its bytes, so the same picture twice was one id twice.**
  `/__board/asset` wrote `#image-<sha8>` without asking whether it was taken, and the second paste of
  one screenshot put `EB_DUPLICATE_ID` — an error — on the board. `free_item_id` numbers it; the file
  is one file either way, and the item is a second item.
- **Text measured to fill its box exactly is clipped at any zoom but 100%.** The canvas measures
  the advance the page lays out, and the two agree; where antialiasing paints the last glyph at a
  scaled transform they do not, and `overflow: hidden` takes it — a figure's caption came out
  "Orders on the apr" at 74% and "tick figure" at the other end. A box sized *to* its text wants
  slack inside the clip: `layout/figure.ts` wraps at `textPad` in from each side and the CSS draws
  that inset as padding, which `overflow: hidden` keeps.
- **Stdin is read when it is named, never because it is not a terminal.** The usual shortcut hangs
  for ever under a parent that starts a command with a pipe it never closes — `execFile` is one, and
  an agent's shell tool can be another. Every command that takes text takes `--file`, and `--file -`
  is stdin.
- **A rename and a write are two versions, and the feed reports whichever one it finds.** Setting a
  title and letting the name follow was first a rename then a write, then a write then a rename, and
  both orders left a moment when one name or the other held a version nobody wrote: the watcher
  reads the file when it gets round to the event, the page holding it open fetched it, and the file
  had gone — a 404 on the console, which fails the suite. `Store.rename` takes an `edit` now, and
  the renamed file *arrives* holding the edited text. Anything that both moves and changes
  a file wants the same shape.
- **A title in the text makes every write a change to the list.** A note being typed in is four
  writes a second, in every tab, and the page used to refetch `/__board/list` for each — requests
  that queue behind a note's own fetches in the browser's six connections, which is how those
  fetches come to reach the server late. A change event carries the file's `title` now and
  the list redraws that row in place; it asks for the whole list only for a name it has not got, a
  file that went, or a server too old to say, and never has two requests out. The files store's
  listing joins paths off its own walk rather than asking `_file`, which resolves the root once per
  name: nine milliseconds of fifty-five boards, on the busiest route there is.
- **A note opens with three fetches of itself in dev, and under load one can land after a rename.**
  StrictMode runs the mount effect twice and the change handler fetches while the first answer is
  out, so a note renamed a moment after it was made can answer one of those with a 404. It is not
  the rename machinery's: six copies of *New note makes one* at once, on a four-core machine
  running six workers, fail it about one run in twenty-five on the base commit and on this one
  alike. Not fixed — the
  honest fix is the change handler waiting for the first answer and comparing sha1s, and it is its
  own change. **And measure a flake at no more workers than the machine has cores**: oversubscribed,
  every spec that polls a file for five seconds fails somewhere, and two runs of it differ by more
  than any change being measured.
- **A cleanup that matches by prefix must refuse an empty one.** A spec removed every file in the
  vault whose name started with its per-test stem, which `beforeEach` set — and a browser that fails
  to launch fails the `page` fixture, so `beforeEach` never runs, the stem is `""`, and every name
  starts with that. One run against a missing Chromium emptied `boards/local/`, this repository's own
  boards with it, and git put them back. A cleanup takes the stem and clears it, does nothing without
  one, and matches only up to the stem's end. `afterEach` runs whether or not `beforeEach` did.
- **A print stylesheet that takes the app off the paper has to be scoped to the moment it means it.**
  `body > :not(.dag-print) { display: none }` on its own is a blank sheet for ctrl+P anywhere in the
  app, so every print rule reads `html[data-dag-printing]`, which `NotePrint` sets for as long as it
  is mounted. The same run found the other half: under a dark theme the root carries `color-scheme:
  dark` — inline, from `applyTheme` — and the canvas behind the sheet printed black whatever the
  sheet's own theme was. The print rule sets it back to `light`, with an `!important` only because
  the other is inline.
- **A table with rounded corners loses the bottom of its last row on paper.** `.dag-md table` rounds
  its corners with `overflow: hidden`, and Chromium's paginated layout clips the table's box short
  of its content — on screen it is exact, and `break-inside` makes no difference. In print a note's
  tables are square and unclipped. Found by reading the first PDF; no screenshot would have shown it.
- **A choice between two kinds is a third kind taken for a board.** `kind === "note" ? … : board`
  was written about forty times across the page, the api and the CLI while there were two kinds,
  and a quiz sent through any of them was a board — opened as one, listed as one, made as one by
  `anydag quiz new` (whose `kindQuery` sent no kind for anything but a note), and left out of the
  files store's `texts()`, so **Unused images** would have deleted a picture only a quiz named.
  `FileKind` is three now, and a site that picks between kinds is a `switch` ending in
  `assertNever` or a `Record<FileKind, …>`, so a fourth is a type error wherever it is not handled;
  the files store walks `KINDS` rather than naming kinds. Grep for `=== "note"` before trusting that
  a kind is handled.
- **A key listener put back after every render is a gap, and so is a reset that runs on mount.** The
  quiz runner's `1`–`9` and Enter were a `useEffect` keyed on its state: taken off and put back after
  each render, *after the paint*, so a key pressed as a question appeared — or between a pick and the
  redraw — landed while nothing listened. And its "new list, new round" effect also ran on mount,
  after the first paint, wiping a pick made in that moment. Both passed alone and failed one run in
  four beside another spec. One listener for the component's life, registered in a
  `useLayoutEffect` and reading a ref, and a reset that skips the list it started with.
- **An embed is a card until the index says what its id is, and a snapshot page has not asked yet.**
  On the editor's page the index is up long before anybody presses Export; under `?snapshot=1`,
  which is how `anydag note export` opens a note, it was not — so the first PDF from a terminal had
  a board's name where its drawing should have been, and nothing waited, because a card has nothing
  to wait on. `NotePrint` asks `readIndex()` before it looks for embeds.
- **A CSS animation that holds still is still running, and one of `box-shadow` restyles the page
  every frame.** One ten-second glow animation whose keyframes held the resting value for 84% of
  it made an idle page with the sidebar docked do 600 style recalculations every ten seconds, for
  as long as the tab was open — the browser cannot tell a keyframe that holds from one that moves.
  A `transform` or an `opacity` runs on the compositor and costs the main thread nothing; anything
  else does not. An animation that mostly holds still should run only while a state on the element
  asks for it. The same keyframes had a second surprise: a property named in only some of them —
  `border-color`, at the two flares — is interpolated from its own value across every keyframe in
  between, so the "still" border had been creeping toward the flares' colour for eight seconds of
  every ten.

- **Spreading a `react-markdown` `Components` costs the type checker seconds.** `{ ...components,
  img }` makes `tsc` build an object type of a hundred and seventy optional keys, each a union of up
  to a hundred and seventy element names, and compare it with `Components` key by key: that one
  expression in `NoteRead.tsx` was 7.4 of the 13.8 s `tsc` spent checking the whole project, and a
  JSX element over `Components["img"]` is checked against every tag the same way. `withComponents`
  (`Object.assign`, the same object) and the `MarkdownImg` cast are the fix, and
  `tsc --generateTrace` is how to find the next one: sort `checkSourceFile` by duration.

- **A `react-markdown` `Components` made during render is a new component type every render.**
  `refComponents()` built a fresh `p` and `img` on each call and `NoteMarkdown` wrapped the `img` in
  a fresh closure, so any re-render of a note drawn read-only unmounted every embed in it and mounted
  it again — an embedded board back to loading, `data-dag-embed-ready` gone. The PDF's sheet waits
  for every embed to say it is drawn and then prints, and a re-render in between printed the board as
  an empty frame, one run in eight of `export-menu.spec.ts`. `refComponents` keeps one object per set
  of options and `NoteMarkdown` memoises its own; anything that hands `react-markdown` components
  wants the same.

- **The e2e suite is CPU-bound on a laptop, so a worker more buys almost nothing.** One spec file
  run alone took 1.9 s a test and 4.8 s inside the full run at four workers: the run is as long as
  the CPU it needs, not as long as its slowest worker. So the question is CPU per test, per process,
  and not long ago the busiest process of the run was not a browser but the grammar worker — 538 s
  of CPU over thirteen minutes — because `/__board/index` handed it every text in the vault after
  every write in every open tab. Measure per process (`/proc/<pid>/stat`, and not `pstree -p`, which
  lists threads and counts the process once per thread) before adding workers or blaming Chromium.

- **The unit suite shares modules between the files a worker runs** (`isolate: false` in
  `vitest.config.ts`). A test that stubs a global or pins module state puts it back in
  `afterEach`, as every one in `test/` does today and five shuffled file orders confirmed; one that
  does not will fail a stranger's test in another file, depending on the order. That is the price of
  the unit suite costing a quarter of the CPU it did.

- **A modifier class declared above its base class loses every tie to it.** `.dag-purge__scrim`
  said `position: fixed; z-index: 60` and was worn beside `.dag-settings__scrim`, which is declared
  two thousand lines further down with one class and its own `position` and `z-index` — so the card
  wearing both was `absolute` at 20 from the day it was written, with the rule above it saying
  otherwise, and nothing noticed until the Settings modal (50) asked one from inside itself and
  Playwright could not click it. A rule meant to override a shared class says so with both classes.

- **Vite's `json: { stringify: true }` is slower on the dev server, measured.** It turns a JSON
  import into `JSON.parse("…")`, which is the textbook advice for a 2.5 MB file — and on the dev
  server it made a board 700 ms slower to be ready and doubled the page's heap. Measure a
  build before believing it there.

- **A note save that lands must keep the frontmatter the page holds *now*.** `flush` captures
  `held` when it starts; writing it back whole when the `put` answered meant a bar pressed while a
  save was out (a task's status, its date, an event's start) rewrote `held.front`, queued its own
  save, and then had it put back by the one landing: the queued save found nothing to write, and
  the second of two quick changes was dropped with nothing on the screen to say so. A
  person clicks too slowly to see it; Playwright filling a date and then a time did it every run.
  The landing keeps `held.current.front`.

- **A day is a string, and a day is not twenty-four hours.** The calendar reads every time in the
  viewer's zone and does its arithmetic on `YYYY-MM-DD` through `setDate`, because a day with a clock
  change in it is twenty-three or twenty-five hours and `+ 86_400_000` lands an hour off on one of
  them. And `new Date("2026-10-03")` is UTC midnight while `new Date("2026-10-03T09:00")` is local —
  ECMAScript's rule — so `momentOf` takes a date apart by hand. `test/calendar.test.ts` runs in any
  `TZ`; run it in two or three before believing a change to `src/calendar/`.

- **pdf.js's modern build calls a JavaScript built-in only this year's browsers have.** It reads
  `Map.prototype.getOrInsertComputed`, and the Chromium the suite and `snapshot.mjs` drive does not
  have it: the worker threw `getOrInsertComputed is not a function` and the PDF drew nothing, while
  a current desktop browser drew it fine. `PdfViewer` imports `pdfjs-dist/legacy/build/pdf.mjs`,
  which carries its polyfills, and `optimizeDeps` names that entry. The lesson is the snapshot
  rule's: a browser the gate does not run is not the one the page has to work in.

- **A board fence's unquoted attribute ends at the `}` that closes the braces.** `src=plan.assets/x.png}`
  is how a regex over the text reads the last attribute of an image fence if `}` is allowed in a
  path, and the zip export went looking for a file called `x.png}`. `namedAssets` in
  `src/export/bundle.ts` excludes both braces from a path; anything else that lifts a value off a
  fence line by pattern rather than through `parseAttrs` wants the same.

- **An id a file claims twice is a key React sees twice, and a write that lands on the wrong
  thing.** A table is a file an agent writes by hand, so two rows can say `{#rglob}` — which is
  `ET_DUPLICATE_ID`, reported, and also two `<tr>` with one React
  key (a console warning, so a failed suite) and a cell typed into the *second* row that a writer
  addressing `rglob` put into the *first*. `keysOf` in `src/view/TableRead.tsx` keys a row, a column
  or a tab by its id only the first time the id is seen and by its place after that; and the page
  refuses a write to an id that names two things (`only` in `TablePage.tsx`), saying so, rather than
  guessing. Anything that draws a list out of a file somebody else writes wants both halves.

- **A `|` inside a cell's `{…}` ends the cell.** A select's options are written on its header cell,
  and the grid adds whatever is typed into a select to them — so `In|Out` put a bare pipe in the
  header, the header gained a cell the delimiter row did not have, and the tab parsed as no table at
  all: 0 columns, 0 rows, and the next structural write laid a fresh grid over the broken lines. The
  cell's words had always been escaped; its attributes were not. `braces()` in `src/table/write.ts`
  escapes a pipe in a cell's `{…}` and `trailingAttrs` reads `\|` back, and a heading, which is not a
  row, is written as it was.

- **A key a widget takes has to stop there, or the window hears it too.** The pages without a canvas
  listen for `space O` on the window, and the table's grid is a focused `div` that `typing()` does not
  count — so a space that ticked a checkbox armed the chord, and the `o` typed into the next cell
  opened the search. The grid stops every key it handles (React's `stopPropagation` stops the native
  event at the root, which is before `window`).
- **The server is a bundle, and a bundle is as old as its last build.** `npm run dev` runs
  `server/dist/anydag-server.mjs`, which `node server/build.mjs` makes from `server/`, `src/board/`,
  `src/dsl/`, `src/note/`, `src/quiz/` and `src/table/` — so a change to any of those is not served
  until the bundle is rebuilt and the server restarted. `scripts/dev.sh` builds only when nothing
  answers on its port: a server left running from an earlier `npm run dev` goes on answering with
  last hour's grammar, and the e2e suite then fails on behaviour the source no longer has. Kill it
  by port. The CLI's launcher checks its own bundle's inputs on every run (`cli/dist/meta.json`);
  the server's does not.
- **The token is a header from a shell and a cookie for a browser, and never a value in page
  script.** Every request carries the per-launch token (`x-anydag-token`, or the `anydag_token`
  cookie), and the `Host` must be `127.0.0.1`, `localhost` or `[::1]` — anything else is a `421`,
  because a page on `evil.example` resolved to `127.0.0.1` still says its own name. Both checks are
  needed: a "simple" `POST` from any website the person has open needs no preflight, so without the
  token any site could write into a vault. The desktop shell adds the header in the main process;
  `anydag serve` prints `/?token=…` once and swaps it for an `httpOnly`, `SameSite=Strict` cookie and
  a redirect; Vite's proxy adds the header in development. A test or a script that `fetch`es the
  server directly needs `authed()` from `scripts/session.mjs`, or it reads a `401` as an empty list.
- **Opening a vault never writes a byte of it.** An existing `.md` with no `id:` is given one only
  when something links or embeds it by id, or when the app made it — never on its first edit: an id
  added during a `put` changes bytes the page sent, and the sha1 the page then holds is of a text
  the disk does not have, so its next save is a `409` against itself. `test/server/` holds both
  halves. A synced vault depends on it as well: a write on open is a conflict on every machine.
- **A name is any portable file name, and portable means three file systems.** `Meeting notes.md`
  and `Écoles.md` are names, so the store refuses what Windows or macOS would:
  `: * ? " < > | \`, a trailing dot or space, `CON` and its kin, and a name or a folder differing
  from one beside it only by case — the contract tests found `moveFolder` happily making `Work/`
  beside `work/` on Linux, a vault that would not open on a Mac.
- **The watcher outlives nothing it was not told about.** One `@parcel/watcher` per open vault,
  living as long as the vault: stopping one while another started on the same folder made the
  native unsubscribe reject unhandled, which took the whole server down under the e2e suite. A
  save arrives as a rename onto the file, and the feed says `tree` only for a path it had not seen
  — or every keystroke in a note was a listing refetch.

- **BlockNote builds a block's ProseMirror node when the schema is made, and calls its `render` for
  more than the editor.** `noteSchema.blockSpecs` are the processed specs, each carrying the node
  built from the `render` it was given — so a `render` swapped into one afterwards is never called,
  silently. The editor's code block wraps a *fresh* spec, `codeBlockSpec()`. And the same
  `render` serialises a block to HTML, BlockNote's own clipboard flavour among them, with
  `renderType: "dom"`: anything a wrapper adds for the editor is added there only for `"nodeView"`,
  or the label is text a paste reads back into the block. A node view that puts DOM of its own
  beside a `contentDOM` names it in `ignoreMutation`, or ProseMirror reads the block back off the DOM
  every time that DOM changes — a tick replacing a copy icon redrew the block, button and all.

- **BlockNote registers the extensions a *block* spec carries, and drops an inline spec's without a
  word.** `createReactInlineContentSpec` takes an extensions argument and documents it as "mirroring
  block specs"; 0.55's `ExtensionManager` walks `blockSpecs` alone, so the `$x$` input rule and
  ctrl+shift+E did nothing at all until they were handed to the editor's own `extensions`.
  Anything an inline spec needs from the editor goes there.

- **A Markdown paste reaches the editor as BlockNote's *lossy* HTML, which keeps a custom block's
  drawing and loses its type.** `BlockEditor`'s paste handler turns text into blocks through remark
  and inserts them with `pasteHTML(blocksToHTMLLossy(…))`; an inline spec's wrapper keeps its
  `data-inline-content-type` and props, and a block's is stripped. A pasted equation block came in as
  the text KaTeX had drawn, `x2+y2x^2 + y^2`, until the block's `parse` read its TeX back off its own
  element (`data-dag-equation-tex`). A custom block that can arrive by paste wants the same.

- **ProseMirror reads a selection the browser changed on `selectionchange`, which comes after a key
  pressed in the same moment.** A shortcut that acts on the selection — ctrl+shift+E straight after a
  shift+arrow — saw an empty one and made an empty equation; a person is never that fast, the suite
  always is. `makeInlineEquation` flushes the view's DOM observer first.

- **The SVG export read the `border` shorthand, which is empty whenever the four sides differ.** So
  a border on one side was never exported — a blockquote's bar, an equation fraction's, which
  KaTeX draws as a bottom border and nothing else: every exported equation lost its fraction lines
  and its radicals' bars, in a file that otherwise looked right. `inlineStyles` writes the sides that
  are drawn when the shorthand is empty, rather than four long values on every element of every file.

- **`querySelectorAll` on an element never finds the element.** The tree is the drop target for the
  top level (`data-dag-sidebar-drop=""`), and every clearing of the drop marks searched it for marked
  elements — its descendants — so once a drag had passed over its empty space the whole tree stayed
  outlined after the drag ended. Rare while the tree held still; usual once it scrolled under the
  pointer. `overMarks` in `Sidebar.tsx` is the one query.
- **BlockNote's `document` inside a `transact` still answers with the blocks as they were.** An open
  note whose only block changed elsewhere had `apply` remove that block and then insert before
  `editor.document[0]` — the block it had just removed — so BlockNote threw *Block with ID … not
  found*, the editor kept the old text, and leaving the page saved it over the outside write.
  `applySteps` in `src/note/markdown.ts`
  decides every anchor from the blocks before the transaction: before the first block the plan
  keeps, or one `replaceBlocks` when it keeps none. Anything else that edits several blocks in one
  transaction wants the same.
- **A read-only BlockNote takes no caret, so a key aimed at it goes to the page.** With `editable`
  false the editor is `contenteditable="false"` and cannot hold focus; a person who clicks in a locked
  note and types sends every letter to `<body>`. The lock's notice there is a window
  listener in `NoteView` that looks at a key only after every other listener has had it — a timeout
  and `defaultPrevented` — so the page's own `space O`, which takes both of its keys, is not mistaken
  for typing.

- **A quiz's snapshot had never said it was ready.** A quiz page under `?snapshot=1` drew
  the sheet with `data-dag-ready=""` on a `<div>`, while everything that waits — `snapshot.mjs`, the
  CLI's pictures, the suite — waits on `document.documentElement.dataset.dagReady === "1"`, so a
  picture of a quiz could only time out. Nothing failed because nothing had taken one; the first
  picture taken of a quiz holding embeds found it. `usePublishDrawn` in `src/view/drawn.ts` is the
  one wait now —
  fonts, the index, every embed's `data-dag-embed-ready`, equations, pictures — for the quiz sheet,
  the read-only quiz and, through `drawn`, a note's PDF.

- **In the skill's *Through MCP* section, any backticked word with an underscore is a tool name.**
  `check-skill.mjs` reads them all as the closed set, so `next_cursor` written there as a field name
  failed the commit hook as "a tool the server has not". Say a field in words in that section, or
  out of backticks.

- **Chromium lays SVG text out again at every zoom, and inside the zoomed layer it often never
  paints the result.** Text in an `<svg>` is hinted to the screen, so a change of the scale above it
  — `.dag-layer`'s transform, which every zoom and fit writes — re-lays it out, and after a fit the
  edge label kept its box and drew no ink while its line drew. A production build lost most labels
  that way after any refit, which `anydag snapshot` makes once it has sized its window; the dev
  server lost few, so the report came in as "an edge into a shape drops its label", the
  shape being the board it was seen on. `text-rendering: geometricPrecision` on every `<text>` on the
  surface (`nodes.css`) lays it out once, unhinted, which is also the width `measureText` gave the
  layout. Any new SVG text there wants the same rule, and a paint defect is chased with pixels, not
  the DOM: the label was present, visible, sized and on top the whole time.

- **A sketch's frame now moves with a bowed line, and a drag can move it.** The frame grows past
  the boxes to hold a back edge's bow and its label, so the drawing's top-left sits that
  far into the frame. A drag that changes how high the bow goes changes that margin, and the
  drawing moves by the difference — `fixedDrop`'s `shift` is worked out from the boxes, and cannot
  know where the next routing puts the line. It is what `layoutGraph` already does when a label
  hangs past the top, and the alternative is a line cut off at the frame. **What it can know, it
  must:** the frame's corner is the line's while the boxes sit in from it, so a writer that moves
  the boxes' corner moves the fence by `frameShift` (only as far as a box goes past the line), a
  resize scales `boxesOf` (the boxes' own extent, never from `0,0`), and a group resize reads the
  padding off `data-dag-layout`'s `size`. All three took the boxes for the frame, and a drag in
  such a sketch slid everything it did not touch by the bow's margin.

- **Lezer's TypeScript grammar refuses TypeScript.** `x is T`, and a few other forms, come back as
  error nodes on valid code — 16% of this repository's `.ts` files — so TypeScript is coloured and
  never checked. The Python grammar misses a bare `yield` and a float written `20.`, and
  `prepare` in `src/render/syntax-engine.ts` rewrites both at the same length before parsing; it also
  misses parenthesised `with (…)`, t-strings and a class pattern in a `case`, which are left. Measure a
  grammar against real code before checking a language with it: `test/syntax.test.ts` holds every
  tracked fenced block in a checked language to reading clean.
- **A language one unit test loads, every later test file in that worker sees** (`isolate: false`).
  `test/code-block.test.ts` pinned a Python block's exact HTML and failed whenever `syntax.test.ts` had
  run first in its worker, because Python had landed and the block came out coloured. Pin exact HTML
  in a language nothing colours.

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
ignored, so an old board draws.

## Layout, per diagram type

Three knobs in `theme.metric.elk`, and each exists because a board looked wrong without it:

- **`aspect`** — the shape to aim for. Without it an architecture diagram is one 2400px row (the
  delivery chain beside the cloud). ELK folds a long chain into rows to hit the target.
  **`aspect: 0` turns wrapping off**, which is what `state`, `flow` and `activity` want: a funnel
  that wraps stops reading as a funnel, and ELK reorders the states to fit the target rather than
  leaving them in the order they were written. **A board can override it on the fence** — an
  `arch` item opened `{#pipeline aspect=0}` — **and a diagram's two side handles now write it**,
  which is what a person pulling a diagram wider is actually asking for — because the theme's figure
  is a house default for the type, not a fact about every diagram of it: a pipeline drawn as `arch` really is one chain, and the fold that
  saves the average architecture diagram is what destroys that one. Anything but a number ≥ 0 is
  `EB_BAD_ASPECT`.
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
- **Dragging a `gitgraph` commit, or a `sequence` message.** A commit's column and a branch's lane
  are both ordinal and both the file's, so no drop means anything; a message is not draggable by
  construction, since only a participant header carries `data-dag-node`. See *Dragging a card*.
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

## Notes

A **note** is a file of its own: `<vault>/<name>.md` (a `.note.md` still opens as one, and `plan.md`
beside `plan.note.md` is refused), GitHub-flavoured Markdown with
optional frontmatter, listed and foldered beside the boards and opened full-window at `?note=<name>`
in BlockNote — the slash menu, the formatting toolbar, block drag handles, Markdown shortcuts.
Three design points: a note is a separate file (not
the tinted card a ` ```note ` fence draws — that is a different thing that shares the word, and
nothing here renames it), it sits in the board list beside the boards, and a note links to a
board, embeds one, and is carried on one as a card, all by id — see
*References, ids and the read-only view*. Nothing converts either into the other, and a note still
holds no diagram of its own.

**BlockNote never parses or writes a byte of a note.** That is the one decision everything else
follows from, and it is measured (*Things that will bite*).
`src/note/markdown.ts` is remark both ways — the parser `MarkdownItem` already draws board text with
— over a structural subset of BlockNote's block JSON, with no BlockNote import at all.

Seven things are load-bearing:

- **An edit rewrites only the blocks it touched.** `load` records, for each top-level mdast node, its
  source bytes, the whitespace before it and the ids of the blocks it became; `settle` records what
  each serialises to *as the editor holds them* (BlockNote normalises what it is given, and measured
  against the unnormalised blocks the first keystroke anywhere would rewrite everything); `saved`
  writes the original bytes for every group that still serialises as it did and the house form —
  `-`, `*`, `**`, fenced code — for the rest. So an agent's wrapping and a table's padding survive
  every edit that does not reach them, and opening a note writes nothing at all.
  `test/note-markdown.test.ts` holds it over every Markdown body in the repository: byte for byte
  untouched, stable when fully rewritten, and drawn the same but for a loose list. **A save
  compares JSON before it serialises anything**: each unit remembers its blocks as JSON, and only a
  group whose JSON changed is turned back into Markdown — 4 ms a save on a 118 KB note, where
  serialising every group was 65 ms of main thread every quarter-second while somebody typed.
  Opening is dominated by remark's own parse, about 0.3 MB/s, the same parser `MarkdownItem` pays.
- **The schema is the Markdown's.** Twelve blocks and four marks, `NOTE_BLOCKS`/`NOTE_STYLES`, and
  beside text two inline kinds of content, a reference and an equation; no
  underline, no toggle, no file, no colour (a colour the theme does not own — the *A custom colour*
  refusal). Leaving a block out of the schema is what takes it out of the menus; the slash menu is
  then cut to `SLASH` in `src/blocks/menus.ts` — three heading levels, the ones `markdown.css`
  styles — and the drag-handle menu to Delete. `test/note-menu.test.ts` holds schema, menu and
  bridge to one another, and `check:skill`'s sixth set holds the skill's table to `NOTE_BLOCKS`.
- **A note is its own page.** `App` is `NoteApp` or `BoardApp` on `?note=`, never both, so
  `useEditor`'s window keys and paste listener are not mounted under a note and cannot take a
  `Delete`, a `space` or a ctrl+V from the text. The note page has one chord of its own, `space O`,
  while the caret is not in the text.
- **Two writers, the board's contract, merged per line.** A save is a `put` against the sha1 last
  seen, 250 ms after the last change. An outside write with nothing pending is adopted through
  `plan()` — an LCS over unit sources, so the blocks whose bytes did not change keep their ids and
  the caret stays — outside the undo history, so ctrl+Z never takes back the other writer's edit. A
  save that meets a moved text is merged with `merge3` against the text both started from, which
  succeeds whenever the two edited different lines; otherwise the page asks, *Keep mine* or *Use
  theirs*, and writes nothing until it is answered.
- **One namespace, a `kind` beside the name.** A vault is a folder, so a name is one file:
  `server/names.ts` classifies a path by its suffix (`.board.md`, `.quiz.md`, `.table.md`, `.md` or
  `.note.md` for a note) and refuses a second file that would give a name two kinds. The
  routes take `kind=note` under `/__board`, and the four that are grammar never ask for a note, so
  they 404 one without a line of their own. `POST /__board/upload` stores an image and writes
  nothing. The feed says `dag:note`, so no board listener learned to ignore anything. `texts` keys a
  note by its file name, so the unused-image sweep sees what a note names and nothing mistakes one
  for a component, and a note may not live under `components/`.
- **The editor is a lazy chunk.** `src/blocks/index.ts` is `React.lazy`, so a board never loads
  BlockNote, TipTap, ProseMirror or Mantine, and `?snapshot=1` of a note draws it through
  `react-markdown` read-only — a picture of a note is a fact about the file. The 45 visual baselines
  are therefore untouched by construction. Mantine is **8**, not 9: 9 wants React 19.
- **The colours are the theme's.** `className="dag-blocks"` lands on the editor and on every menu
  BlockNote portals out of it, and `src/styles/blocks.css` sets each `--bn-*` from a `--dag-*` there,
  two classes and an attribute deep so it wins whichever stylesheet loads last. It is chrome in
  `chrome.css`'s sense — off the length list, on the colour rule — and invents no `--dag-*`.

**A note exports from the top bar** — a PDF through the browser's print, or its own
`.note.md` — and a PDF is the file drawn read-only, never the editor's DOM; see *Import and export*.

**A note's title is the first thing on its page**: a field above the text holding the
frontmatter's `title:`, which is what the note is called everywhere — so committing it,
on Enter or on leaving the field, is `/retitle` with `follow`, and the file's name follows. A task's
page is a note's page, so a task has one too, above its bar. Four things about it:

- **The page renames the file it holds, and keeps its editor.** `NoteApp` keeps `NoteView`'s key
  across a rename the page announced (`onRenamed`), and `NoteView` reads its name through `nameRef`
  rather than the prop: a save queued behind the rename, an image uploaded after it, and BlockNote's
  `resolveFileUrl` — given once, when the editor is made — all have to reach the file where it is
  now. The load effect does nothing for a name it already holds.
- **The rename is one more write in the note's queue** (`serial`): what was typed goes first, and
  what `/retitle` wrote is taken as the held text when only the frontmatter moved — never merged.
  A note with no frontmatter grows a block right against its first line, and a line merge reads that
  as a conflict with anybody typing there, which is exactly where Enter in the title puts the caret.
- ***Untitled* is an empty field**, with the word as the placeholder — `UNTITLED` is what a new file
  is called until somebody names it, and a field holding it looks answered. Emptied, a title is
  *Untitled* again. A note with no `title:` at all shows the same placeholder.
- **A new note is named here, not in its sidebar row.** `nameWhenOpened` marks the name before the
  page opens and the page focuses its title once, when it does. A board and a quiz have no page
  title and are still named in their rows.

The read-only note — `?view=1`, `?snapshot=1` — draws the title as the page's `<h1>`
(`NoteTitleRead`), at the field's size and place; the PDF has its own, `dag-print__title`.

Names claimed, grepped first: `dag-note-view*`, `dag-app--note`, `dag-blocks`, `dag-board__kind`, `data-dag-note`
(a list row), `data-dag-note-view`, `data-dag-note-editor`, `data-dag-note-conflict`,
`data-dag-note-keep`, `data-dag-note-theirs`, `data-dag-note-deleted`, `data-dag-note-failed`,
`data-dag-new-note`, `data-dag-new-note-here`, `data-dag-welcome-note`, `dag-note-title`,
`data-dag-note-title`, `data-dag-note-title-read`, and the SSE event
`dag:note`. `data-dag-note` is one letter from `data-dag-dock`; they are different attributes, and
a spec that wants one says which.

**Out, and why:** real-time co-editing (BlockNote can, the store is an optimistic sha1 — the same
refusal the boards make); a diagram inside a note (a fenced
` ```arch ` block survives the bridge as a code block, so nothing forecloses it); the GPL `xl-*`
packages; a note's saved version history (undo is the editor's, for the session); the block editor on
a board's own `md` cards — the editor exists for a note, a separate file, and a card's body is
prose in the board file.

## Equations

TeX between dollars, everywhere Markdown is drawn — a note read-only and in
its editor, an embedded note, the PDF, a board's text card, a quiz — and drawn by KaTeX.

| Written | Is | Drawn |
|---|---|---|
| `$x^2$` | an inline equation, when the dollars hug it | in the line |
| `$$x^2$$` in the middle of a line | an inline equation, display | centred on a line of its own, inside the paragraph |
| `$$` on a line, the TeX, `$$` on a line | an equation block | centred |
| a ```` ```math ```` fence | an equation block, written back as a fence | centred |
| `$5 and $10`, `\$x\$` | text | as written |

| Where | It |
|---|---|
| `src/note/math.ts` | the grammar: micromark's math with its text tokenizer forked for Pandoc's rule, display marked on the node, and the writer's handlers |
| `src/render/Math.tsx`, `katex.ts` | `MathTex`, KaTeX as a chunk of its own, the cache, and `mathSettled()` |
| `src/render/CodeBlock.tsx` | `MathCode` and `CodePre`'s branch: where `react-markdown` hands over an equation |
| `src/blocks/math.tsx` | the editor's inline `math` and block `equation`, the field, the input rules, ctrl+shift+E and Σ |

Eight things are load-bearing:

- **Pandoc's rule, inside the tokenizer.** A single `$` followed by a space opens nothing; the first
  single `$` after it is the only closing candidate, and if a space comes before it or a digit after
  it the opening `$` is a dollar and reading goes on after it. So "costs $5 and the formula $x$" is a
  price and an equation, `\$` inside a single-dollar formula does not close it, and Markdown between
  two prices is still Markdown. Doing it after the parse would have lost that, a formula's insides
  never being parsed. `$$…$$` has no rule: nobody writes two dollars for money.
- **One plugin, every parser** — the note bridge, the anchors, the references extractor, the search
  corpus and the three `react-markdown` sites — so the block a search names, the block an anchor sits
  on and the block the editor holds are one block. A reference inside an equation is TeX. The search
  finds an equation by its TeX. The block half is `micromark-extension-math`'s own, whose
  `sideEffects: false` is what keeps its KaTeX 0.16 out of every bundle, the server's included.
- **Display is recorded on the node**, as the class its HTML wears (`math-display` where
  `mdast-util-math` writes `math-inline`), by wrapping the package's `exit`: `parser.parse()` runs no
  transformers, and the note bridge reads the tree straight off it.
- **The file keeps the author's dollars.** An untouched group writes its own bytes; a touched one
  writes `$tex$`, `$$tex$$`, `$$` lines or a fence by what it was. A dollar in text is written bare, and
  `blocksToMd` parses what it wrote: only if the equations read back are not the ones written — a
  literal `$x$` somebody typed as text — is the group written again with every dollar escaped.
- **KaTeX is a chunk, and ready means drawn.** `src/render/katex.ts` is imported only dynamically,
  with its stylesheet and fonts; until it lands an equation is its TeX, faint. `mathSettled()` waits
  for it, two frames and `document.fonts.ready`, and the board (`usePublishReady`), the read-only note
  and quiz, the note editor and the PDF's sheet all wait on it before saying they are drawn.
- **An equation that does not parse is its TeX**, underlined in the danger colour with KaTeX's
  message as its title — `throwOnError` so the error is ours to draw, `strict: "ignore"` because
  KaTeX's warnings are console output the suite fails on, `trust: false` so no `\href` or raw HTML.
  `\color` and `\colorbox` draw in the ink: the theme owns the colour (`markdown.css`).
- **In the editor a change writes the node's attributes, never a new node** — `setNodeMarkup`, and
  `updateBlock` for a block — because BlockNote's `updateInlineContent` replaces the node, which is a
  new node view, which is a field closing under the person typing into it. The field is a portal on
  `<body>`, focused again a frame after it opens because ProseMirror takes the focus back once it has
  finished with the press that opened it. What opens by itself is named first (`opening`): a block by
  its id, an inline equation by where it starts.
- **An equation is spans all the way down**, KaTeX's display mode included, so one in the middle of a
  paragraph is still a paragraph's content and `display: block` is what centres it. Only an equation
  block is a `<div>`.

Names claimed, grepped first: `dag-math*`, `dag-math-chip*`, `dag-math-field*`, `dag-equation*`,
`data-dag-math`, `data-dag-math-chip`, `data-dag-math-field`, `data-dag-math-field-error`,
`data-dag-math-tex`, `data-dag-math-button`, `data-dag-equation`, `data-dag-equation-tex`,
`data-dag-equation-fenced`.

**Out, and why:** numbered equations and `\label`/`\ref` (a numbering scheme is a decision about the
document); macros a note defines once for all its equations; equations in a diagram's labels (sized
by `measureText` before anything is drawn); a table file's cells (typed values, not Markdown);
chemistry (`\ce`); and copying an equation as its TeX, which KaTeX's `copy-tex` would do with a
document-wide copy listener beside the board's own clipboard.

## Tasks

A **task** is a note whose frontmatter has a `status:` — `todo`, `in-progress` or `done` — with an
optional `due:` date, `YYYY-MM-DD`. Nothing else marks one. Three
design points: a task is a note with a status rather than a third kind of file, its card
on a board changes the task's file, and a sidebar row dropped on the canvas places it.

    ---
    title: Ship the pricing page
    status: in-progress
    due: 2026-10-03
    ---
    The copy is in [Pricing draft](dag:7q2m9xk4tb).

| Where | What it does with one |
|---|---|
| the sidebar | **Tasks** (with the open count) opens the Tasks page; **New task** makes `untitled` with `status: todo` and names it in its title; a task's row wears its status; a row's menu makes a note a task, marks it done or to do, or makes it a note again |
| the Tasks page, `?tasks=1` | a list — *In progress*, *To do*, *Done*, each by due date then title — or a board of three columns a card is dragged between; a filter, and a box in every group that makes a task named after what is typed |
| the task's own page | its title at the top, then its properties as a list over the text — status as three choices, *Starts*, *Due*, an empty date saying *Empty*; the top bar's `⋯` has *Not a task*, and a plain note's has *Make it a task* |
| a board, or a note, embedding one | a card — status as a button, title, due date — that writes the task's file; on a board, the one fixed-size card every placed document is, with a button that opens the task; read-only under `?view=1` and a snapshot |
| `?view=1`, a snapshot, the PDF | the status and date on a line above the text |

Seven things are load-bearing:

- **Everything a note is, a task is**, because it is one: the file is `.note.md`, the kind is `note`,
  and the editor, the references in its description, backlinks, search, export
  and the `anydag note` commands needed no case. A note becomes a task by gaining the line and
  stops being one by losing it, and nothing else in the file is touched to do either.
- **One parser reads a task.** The server imports the page's own `taskOf` and `withTask` from
  `src/note/task.ts` (`server/vault.ts` for the listing, `server/routes/docs.ts` for the write), so
  the list route, the page, the index and the CLI cannot disagree. `test/fixtures/tasks.json` is an
  ordinary unit test with one reader. Lenient in spelling only — case, and
  a space or an underscore for the hyphen — never in meaning: `doing` or `blocked` is not a status,
  and a note saying one is not a task. A `due:` alone is not one either.
- **A write touches one line of the frontmatter**, `withTitle`'s rule (`server/frontmatter.ts`): replaced where it is, added
  after the block's last line, or taken out — and a block a removal leaves empty goes altogether,
  because `---` twice with nothing between is not a frontmatter to any reader here and draws as two
  rules.
- **There are two ways to write one, and which is which matters.** On the task's own page the bar
  rewrites the frontmatter `NoteView` already holds and saves through the note's `put`, so the page
  is never an outside writer to itself and a status change and a paragraph being typed are one
  write. Everywhere else — the Tasks page, a card, a row's menu, the CLI — it is
  `POST /__board/task {name, status?, due?}`, which recomputes from the text that beat it on a
  conflict, as `/retitle` does.
- **The list, the feed and the index carry it**, as they carry a title: `/__board/list`'s `tasks`
  and `ids`, `task` on a note's `dag:note` event so a row is redrawn in place, and `task` on
  `/__board/index`'s docs, which is what a card reads. The vault keeps
  it in the stat-keyed cache the titles were already in.
- **A card shows its own write at once** and takes what the server wrote when it answers: the index
  is a wait behind the change feed, and a button that sat on the old status for most of a second
  would read as a press that did not land. The Tasks page does the same with `pending`, let go of
  when the list agrees.
- **The drop is an event, `dag:place-file`**, for `dag:chrome`'s reason — the sidebar is above both
  pages and knows neither. The board page answers with the library's own `place` and `noteCard`, so
  a row lands exactly as the library's *Your notes* entry would; the open board cannot be dropped on
  itself. **A card that only embeds a document opens no panel**: `place` opens the editor for an `md`
  because its body is prose, and a card's body is one line of `dag:` syntax.

Which layout the Tasks page shows is `dag:tasks-view`, this browser's and not the app's — view
state, like which folders are open — written with `writeLocal`. The list reads what is being worked
on first and the board's columns run the way work moves, so the three statuses come in two orders.

Names claimed, grepped first: `dag-task-*`, `dag-tasks*`, `dag-taskbar*`, `dag-embed--task`,
`dag-embed__task*`, `dag-toolbar__make-task`, `dag-sidebar__badge`, `data-dag-task*`,
`data-dag-tasks*`, `data-dag-taskbar*`, `data-dag-taskline`, `data-dag-embed-task`,
`data-dag-sidebar-task`, `data-dag-sidebar-tasks`, `data-dag-sidebar-tasks-open`,
`data-dag-sidebar-new-task`, `data-dag-note-make-task`, `data-dag-drop-file`, the storage key
`dag:tasks-view`, the event `dag:place-file` (in `test/prefs.test.ts`'s list), and the query key
`tasks`.

**Out, and why:** assignees, priorities, labels and reminders (each is a
decision about who does what); a status set of a person's own (three fixed words are what the
columns are and what both parsers can be held to); sub-tasks as files (a check item in the
description is one); and a manual order within a column (nothing stores one). Tasks are reached
over MCP too: `task_list`, `task_create`, `task_set`.

## Projects

A **project** is a folder holding a note whose frontmatter has a `project:` — `active`, `paused` or
`done` — with an optional `hue:`, one of the ten. Four
design points: a project note rather than store-side folder metadata, a status and a colour,
tagging as a link only, and the note with a bar as the project's page.

    work/pricing/pricing.note.md      ---
                                      title: Pricing relaunch
                                      project: active
                                      hue: coral
                                      ---
                                      Why we are doing this.

| Where | What it does with one |
|---|---|
| the sidebar | a project's folder wears a kanban folder in its hue (dimmed when paused or done), its note a briefcase; a plain folder's menu has *Make it a project*, a project's *Open project* and *Not a project* |
| the project's own page | a bar under the title: the status as three choices, the colour, how many of its tasks are in each status, *Open tasks*, *Not a project* |
| the Tasks page | a project filter — every project, one project, or none — carried as `project=<id>`, or `project=none`; a row names its project with a chip; a task typed in while filtered is made in the project's folder |
| a board, a note's `@` | the placed card says *Project · Active*; the reference picker labels a project as one |
| `?view=1`, a snapshot, the PDF | the status on a line above the text |

Six things are load-bearing:

- **Membership is a path.** A document is in a project when its name is under the project's folder,
  subfolders included — `within()` — so moving a file in or out is the only way to join or leave, a
  folder moved carries its project, and nothing anywhere has to be kept in step. `projectFolders()`
  maps each folder to the note directly in it, the first by name when there are two; a project note
  at the top level makes nothing a project.
- **Nested projects name a document by the innermost**, and a project's filter still includes them:
  "only the tasks inside that project" is everything under its folder. `projectFor()` is the name,
  `within()` the filter.
- **One parser reads it** — `projectOf` in `src/note/project.ts`, which the server imports rather
  than restating, held to `test/fixtures/projects.json`. Lenient in case and blanks only: `project: yes` is not a project.
- **A write touches two lines**, `withTask`'s rule — which is `withKeys` now, one function for both
  pairs of keys, on both sides. The project's page writes through the note's own save; the sidebar
  and the CLI through `POST /__board/project {name, status?, hue?}`, recomputed on a conflict.
- **The list, the feed and the index carry `project`** beside `task`, so a folder
  is redrawn in place and a card knows what it is. Membership is computed wherever it is needed —
  the sidebar, the Tasks page, the bar, the CLI — from names the listing already has.
- **A task and a project are independent keys.** A note may carry both; nothing on the page makes
  one, and *Make it a task* is not offered on a project's page.

Names claimed, grepped first: `dag-project*`, `dag-projectbar*`, `dag-sidebar__project`,
`dag-tasks__project`, `data-dag-project*`, `data-dag-projectbar*`, `data-dag-projectline`,
`data-dag-sidebar-project`, `data-dag-tasks-project`, and the query key `project`.

**Out, and why:** tagging as membership (a reference links and does not enrol);
store-side folder metadata and a folder id (a note already is both); a project page beyond the note
and its bar; and dates, owners and priorities. Projects are reached
over MCP too: `project_list`, `project_create`, `project_set`.

## The calendar

Tasks, events and notes on one timeline, at `?calendar=month`, `week`
or `days` — `1` for the view this browser used last — with `date=` and `days=` beside it. **Not
`view=`**, which is the read-only page's key.

    ---
    title: Team offsite
    start: 2026-10-03T09:00+02:00
    end: 2026-10-03T17:00+02:00
    ---
    Agenda, the address, who is bringing what.

| Where | What it does |
|---|---|
| the sidebar | **Calendar** opens the page; **New event** makes `untitled` at the next whole hour, an hour long, and names it in its title; an event's row wears a calendar clock; a row's menu makes a plain note an event, or an event a note |
| the Calendar page | a month of week rows whose bars span days, or a week or a run of 1–14 days as an all-day row over an hour grid; Tasks, Events and Notes switched on and off; the Tasks page's project filter; a click opens a thing, a drag or a click on empty time makes an event, a drag on an event or a task moves it, pulls one of its ends, or takes it between the all-day row and the hour grid |
| an event's own page | its properties under the title — all day, the start, the end and the zone they are shown in; the top bar's `⋯` has *Not an event*, and a plain note's has *Make it an event* |
| a task's own page | a *Starts* date beside *Due* |
| a board | a placed event's card says *Event* and when |
| a project's bar | *Open calendar*, filtered to it |
| `?view=1`, a snapshot, the PDF | the event's time on a line above the text, in the reader's zone |
| Settings | *Weeks start on*, the person's |

Nine things are load-bearing:

- **An event is a note with a `start:` and no `status:`.** A date is all day and a time is a time —
  there is no `all-day:` key, a second key that could disagree with the first. An all-day `end:` is
  the last day, inclusive; a timed one the moment it stops; an end in the other form is none; with no
  end an all-day event is a day and a timed one an hour. `status:` decides first: a note with one is a
  task, whose `start:` is its start date, so the page never offers *Make it a task* on an event.
- **One parser reads it**, `eventOf` from `src/note/event.ts`, which the server imports, held to
  `test/fixtures/events.json` — the moments too (`whenOf`), lenient in spelling only: a space or a `t` for the `T`,
  `+0200` and `+02` for `+02:00`. **They check the form and never the order**: whether an end comes
  before a start in two zones is the calendar's arithmetic, done in the viewer's zone.
- **A time carries its offset, and every writer the app owns writes one** — `timeOf` on the page and
  in the CLI, **the chosen zone's** offset for that date (see *The time zone*
  below). The route and the MCP tools take a time without one and put that zone's on
  (`placed` in `server/frontmatter.ts`); a file written by
  hand without one is read as that wall-clock time wherever it is viewed, because refusing it would
  take an agent's `09:00` off the calendar with nothing anywhere to say so.
- **A note's created date is the index's**, `Tree.created`, beside the id: the SQLite row's
  `created`, an instant in UTC, never a line in the file. A rename, a folder move and a
  transfer between vaults carry it; a copy is new. A file the index has never seen is dated at its
  birth time, else its last modification, and that is kept; if the index is rebuilt the dates fall
  back the same way.
- **`src/calendar/model.ts` is all of the arithmetic and none of the drawing.** Days are strings in
  the viewer's zone and a step is `setDate` (see *Things that will bite*); `itemsOf` places every task,
  event and note of the kinds shown; `lanes` packs a run of days' bars lowest-lane-first; `blocks`
  cuts timed events to a day and splits overlapping ones into columns; `fieldsOf`, `eventFrom`,
  `withStart` (which keeps an event's length), `withEnd` and `withAllDay` are what the event bar
  writes. `anydag event ls` narrows by the same spans.
- **A timed event of a day or more goes in the all-day row**, as every calendar draws a trip; shorter,
  it is in the hour grid, cut at midnight into each day it touches. A month caps a week at four lanes
  and says how many more a day holds, which opens that day on its own.
- **A drag on empty time makes an event, and a drag on an event or a task moves it**. A
  press anywhere but on an item starts a range, snapped to a quarter of an hour in the grid and to days
  in the all-day row and a month, and a small card asks for the title; the file is named after it, in
  the project's folder when the page shows one — the Tasks page's rule. A press on an item that does
  not move is a click that opens it (a real link, so a modifier opens a tab). One that does picks it
  up: along the days in a month and the all-day row, where the days it would land on wear the mark a
  range does, and in the hour grid by quarter hours and across the columns, where a ghost says the
  time it would start and end. It keeps how long it is — `shiftEvent` is `withStart` with the start
  carried past midnight, and a task's start and due move together (`shiftTask`). **The last few
  pixels at either end pull that end** — a bar's sides, a block's top and bottom — the other end kept
  and never passed (`withEdge`, `taskEdge`); an end off the page or cut at midnight has none. **In a
  week or a run of days one gesture covers both halves**, so a timed event let go on the all-day row
  is all day there over the days it touched (`asAllDay`), and an all-day one let go in the grid is an
  hour at that time (`asTimed`); a task is dates, and only follows the day. `useGrab` is all of it,
  and what it previews is exactly what it writes. Four things about it: **the move is measured from
  where it was pressed**, never from the item's top, so a block cut at midnight moves its real start;
  **an `end:` nobody wrote stays unwritten** by a move; **a note does not move**, because its day is
  the store's and no line of its file says it; and **a finger scrolls** — a touch press is never
  picked up, so the phone's week is as it was. Escape while it is held puts it back. The page shows
  the change at once and lets go once the list agrees (`pending`, the Tasks page's), because the
  change feed is a wait behind the write.
- **The toggles and the week start are the person's**, `dag:calendar-hide` (what is *off*, so a new
  kind is shown) and `dag:week-start` in `PREF_KEYS`, read through `useWeekStart`/`useCalendarHidden`
  (`src/calendar/usePrefs.ts`) — the Calendar page and Settings' Calendar tab both — so either
  redraws a calendar that is open. Which view a bare `?calendar=1` opens is this browser's
  (`dag:calendar-view`).
- **The event bar writes through the note's own save**, `changeTask`'s path, and a time is shown and
  written in the chosen zone — so an event written in Paris and moved in New York is written in
  New York's offset, naming the moment the person saw.

Names claimed, grepped first: `dag-calendar*`, `dag-cal-*`, `dag-app--calendar`, `dag-eventbar*`,
`dag-eventline`, `dag-sidebar__event`, `data-dag-calendar*`, `data-dag-cal-*`, `data-dag-eventbar*`,
`data-dag-eventline`, `data-dag-sidebar-calendar`, `data-dag-sidebar-new-event`,
`data-dag-sidebar-event`, `data-dag-note-make-event`, `data-dag-projectbar-calendar`, and for the
drag `data-dag-cal-moving`, `data-dag-cal-moving-to`, `data-dag-cal-moving-end`, `dag-cal-ghost--move`,
`dag-calendar__edge`, `data-dag-cal-edge`, `data-dag-cal-pulling` on the root, and `data-movable` and
`data-axis` on an item,
`data-dag-setting-week-start`, the storage keys `dag:calendar-hide`, `dag:week-start` and
`dag:calendar-view`, and the query keys `calendar`, `date` and `days`.

### The time zone

A time carries its offset, and **an offset is a fact about the day, not a constant**: Casablanca's
has been `+00` since tzdata 2026c, and the browser honouring it is what correctly drew an event
written `08:00+01:00` at seven. That is why every time is read and written in a time zone the
person can change, **defaulting to theirs**, used everywhere — the writer asks for the zone and
gets that date's offset.

- **`dag:time-zone` is the choice, `dag:time-zone-seen` the default**, both in `PREF_KEYS`' app-wide
  half. The first is Settings → Calendar's select, absent for *Automatic*; the second is written by
  the page (`watchZone`, from `main.tsx`) whenever the browser's zone differs
  from what it holds, because the server has no browser to ask and "the default is theirs" has to
  reach it. Two browsers in two zones take turns; the one used last wins.
- **One zone for the page, held in `src/note/zone.ts`**, not threaded through forty call sites: it
  plays exactly the part the machine's zone plays, a global nobody passed. `setZone` is called by
  `watchZone` and by the CLI; unset it is the machine's, which is what the server, a snapshot
  (which reads no preference) and a read-only view read. A test that sets it puts it back
  (`isolate: false`).
- **Nothing reads a `Date`'s local getters any more.** A moment becomes a wall clock through `Intl`
  with the zone named (`wallOf`, `offsetOf`), and a wall clock becomes a moment through `instantOf`,
  which is `Temporal`'s `compatible` by hand: the earlier of two in an overlap, an hour on in a gap.
  **A day is a calendar square**, `calendarDate` — noon UTC — and its arithmetic and its words are
  in UTC, so a zone fourteen hours from the machine's still calls 2026-10-03 a Saturday. `Date.UTC`
  reads a year under a hundred as 19xx, so `utc()` sets the full year.
- **The server reads the preferences, never writes them.** `zoneIn` in `server/frontmatter.ts`: the
  vault's choice, else the app's, else the seen zone, each checked against `Intl`.
  `/api/auth/me` answers `zone`, `event_list` answers `time_zone`, and the CLI's `event`
  commands read `/api/auth/me` first and write and print in that zone.

Names claimed, grepped first: `data-dag-setting-time-zone` and the storage keys `dag:time-zone` and
`dag:time-zone-seen`.

**Out, and why:** Google Calendar sync, reminders and notifications; recurring events (a small
language of its own, and the first thing that would need a time zone per event rather than an
offset); attendees and a location (the description holds them);
a colour per event (a project's is the colour); and quizzes and boards on the calendar
(a board's created date is already in the listing).

## Quizzes

A **quiz** is a file of its own: `<vault>/<name>.quiz.md`, listed and foldered beside the
boards and notes, opened at `?quiz=<name>`. A quiz is its own kind
(not a note with a key), its body is strict Markdown, a preset is one
quiz file, and a question leaves Mistakes after N right answers in a row inside the Mistakes run.

    ---
    title: Postgres internals
    ---

    Anything before the first question is the description.

    ## What does VACUUM reclaim? {#q7f3a2}

    - [ ] Index bloat only
    - [x] The space of dead tuples

    > The explanation, shown once it is answered.

    ## Which query lists every member? {#q5d3a1}

    - [x] The one with no filter
      ```sql
      select * from cd.members;
      ```
    - [ ] None of the above

    ## Write the query for members who joined after September {#q8e1f0}

    > ```sql
    > select * from cd.members where joindate >= '2012-09-01';
    > ```

| Where | What it does with one |
|---|---|
| the sidebar | **Quizzes** (with the Mistakes count) opens the Quizzes page; **New** → *Quiz* makes `untitled` titled *Untitled* with no questions and names it in the top bar; a quiz's row wears a cap |
| the Quizzes page, `?quizzes=1` | Mistakes first, then a card per quiz — questions, how many in Mistakes, Practice — a filter, a folder (with *Practice the folder* once one is chosen), and a box that makes a quiz named after what is typed |
| a folder's menu in the sidebar | *Practice the quizzes*, when anything under it is a quiz |
| a quiz's page, `?quiz=` | **Questions** (a card per question, every field Markdown source, an option a text area that grows; *Shuffle the options* and a pin on each option; *Add an open question*) or **Source** (the file and its problems); Practice, Export (the file) |
| a run, `&run=1` · `?quizzes=1&run=mistakes` · `?quizzes=1&run=folder:<path>` | one question at a time, `1`–`9` to pick and Enter to go on, ← → or Previous and Next to move without answering, the quiz's description beside it; an open question's box, ctrl+Enter to see the model answer and `1`/`2` to say whether it was had; the end says the score, what was skipped and what went into Mistakes |
| a board, or a note, embedding one | a card: the title, the questions, how many in Mistakes, Practice |
| `?view=1` | a run that records nothing |
| a snapshot | the sheet: every question with its answers marked |
| Settings | how many right in a row take a question out of Mistakes, 1 to 10 |

Thirteen things are load-bearing:

- **A question is a `##` heading and everything up to the next one**, and only `##` delimits. Fences
  are tracked across the whole file, so a `##` or a `- [ ]` in a code sample is code; and a line that
  opens a fence outside one always opens it, which is the one rule that keeps the server's
  heading ids (it imports `parseQuiz` rather than restating it) the ones the page finds.
  `test/fixtures/quizzes.json` holds the parser to that.
- **A write rewrites one question and no other byte.** Every writer in `src/quiz/write.ts` parses the
  text it is handed and splices one question's span; a rewrite whose meaning is unchanged writes
  nothing (`sameQuestion`), so an agent's wrapping survives a field focused and left.
- **A question's id is the file's and is minted by whatever first needs it** — `{#q…}` on its
  heading, written by the form on any write and by a run before it starts. Practice history is keyed
  by the quiz's store id and that, so a rename, a move and an edit keep it, and a duplicate does not.
- **What was answered is the person's, never the file's**: `server/practice.ts` keeps it in the
  app's home (`~/.anydag/anydag.sqlite`, through `server/home.ts`), keyed by the vault and the quiz's
  id, so a synced vault never carries somebody's mistakes. `server/practice.ts` owns the meaning —
  a record is folded in, never rewritten by hand. A record is never deleted; Mistakes leaves out
  a quiz or a question that is gone, off the listing's ids, and keeps it.
- **The threshold is read, never stored in a stat.** `inPool(stat, graduate)` takes it, so moving it puts
  questions back or takes them out on the next read. It lives with the record rather than in
  `PREF_KEYS`, because the server decides with it (`practice.graduate` in the same SQLite file).
- **An answer is an event.** The page queues a list, never a map, flushes on a debounce, at a run's
  end and on `pagehide`, and a landed flush says `dag:practice`; every reader of Mistakes on a page
  shares one fetch, so a board of quiz cards is one request.
- **A run asks what the quiz said when it started**, and the Mistakes run reads the pool once and
  again only on Again — both move under every answer, and a run that followed them would restart
  itself.
- **A field keeps what is being typed while it has the caret.** The form redraws from the file on
  every keystroke and the file's prompt is trimmed, so a field showing the file's answer would eat
  the space before the next word.
- **A question in a run is answered once, and a skip is no answer** (`src/ui/quiz/round.ts`).
  Going back to an answered question shows it read-only, because its answer was recorded the moment
  it was given and a second would count twice; a question left unanswered records nothing, never a
  miss, and the end offers the skipped ones as a round of their own.
- **An option is block Markdown, read the CommonMark way**: a line indented at least the
  item's content indent — two spaces for `- [x] ` — is the option's, whatever it looks like, blank
  lines kept when an indented line follows them, and a fence it opens runs to its close. The text is
  the lines with their common indent off (`optionMarkdown`, which the writers compare and write in
  too); the house form indents by two, and puts a first line that would open a block on a line of
  its own. A fence opened inside an option still opens a fence — the one rule `parseQuiz`'s
  heading ids on the server keep.
- **An open question is no checklist and a quote at its end**: `Question.open`, `why` the
  model answer. Of two quotes only the last is the answer, a `>` in a code block is code, and prose
  after the quote means there is none — still `EQ_NO_OPTIONS`. Its verdict is the person's, given
  once the answer is showing (`revealIn`, `judgeIn`), and a read-only box takes no typing, so `1`
  and `2` reach the run.
- **A shuffle is a run's, never the file's**: `optionOrder` draws one order per question
  when a run starts — pinned options at their own index — and the runner keeps it until Again or a
  new list; answering the skipped ones keeps the order seen. A pick is the file's index, so grading
  and what is recorded never see the order. The sheet is the written order.
- **One question over the wire is a route**: `src/quiz/ops.ts` through the grammar,
  `POST /__board/quiz` with the table's recompute-on-conflict loop. `set` writes the
  Markdown *as given*, minting an id only for a heading with none, and refuses anything that is not
  exactly one askable question; no other question is stamped or rewritten.

`POST /api/practice` is refused by the CLI with its reason — a command that posted answers would
clear Mistakes without anybody knowing anything — and `anydag quiz check`, `ls`, `mistakes` and
`threshold` are the rest, alongside `quiz question set|rm|mv` and `quiz practice <folder>`.
`check:skill`'s ninth set holds the skill's code table to `QUIZ_CODES`.

Names claimed, grepped first: `dag-quiz*`, `dag-quizzes*`, `dag-run*`, `dag-quiz-sheet*`,
`dag-quiz-page`, `dag-embed--quiz`, `dag-embed__quiz*`, `dag-toolbar__practice`, `data-dag-quiz`
(a search row), `data-dag-quiz-*`, `data-dag-quizzes*`, `data-dag-run*`, `data-dag-embed-practice`,
`data-dag-setting-graduate`, `data-dag-sidebar-quizzes*`, `data-dag-sidebar-new-quiz`, the storage
keys `dag:quiz-mode` and `dag:quiz-about`, the events `dag:quiz` and `dag:practice`, and the query keys `quiz`, `quizzes`
and `run` — and `dag-run__option--block`, `dag-run__option-text--block`,
`dag-run__answer*`, `dag-run__judge*`, `dag-quiz-sheet__option--block`, `dag-quiz-sheet__open`,
`dag-quiz__option-text`, `dag-quiz__pin`, `dag-quiz__shuffle`, `dag-quiz__adds`,
`dag-quizzes__practice-folder`, `dag-quizzes__count`, `data-dag-run-place`, `data-dag-run-open`,
`data-dag-run-answer`, `data-dag-run-reveal`, `data-dag-run-judge`, `data-dag-run-model`,
`data-dag-quiz-open`, `data-dag-quiz-pin`, `data-dag-quiz-shuffle`, `data-dag-quiz-add-open`,
`data-dag-quiz-sheet-open`, `data-dag-quizzes-practice-folder`, and the menu pick `practise`.

**Out, and why:** a button that asks a model to generate a quiz (an agent writes one with
`quiz_create` and `quiz_write`, and runs one in a conversation with `quiz_questions` and
`quiz_answer`); a pick of questions as a preset (a preset is one quiz file); shuffling the
*questions* of a run
(the options shuffle, an author's order of questions being a course's order); grading an open
answer automatically (the person's verdict is the answer); a recall schedule (records are kept, so
the counts one needs exist; when to ask again is a design decision); resetting a history, scores
over time and timers; a printed sheet; and practising on a
read-only view with a history, which has nowhere to keep it.

## Tables

A **table** is a file of its own: `<vault>/<name>.table.md`, listed and foldered beside the
boards, notes and quizzes, opened at `?table=<name>`, and `&tab=<id>` for a tab. The format is GFM
under a `##` heading per tab, there are no formulas, sort and filter live in the file on the tab,
and a link cell holds a URL or a `dag:` reference.

    ---
    title: Q3 pipeline
    ---

    Anything before the first tab is the table's description.

    ## Deals {#deals sort="amount:desc" filter="stage!=Lost"}

    | Name {#name} | Amount {#amount number} | Stage {#stage select options="Lead,Won,Lost"} | Site {#site link} |
    | --- | ---: | --- | --- |
    | Acme {#r7k2m} | 1200 | Won | [acme.com](https://acme.com) |
    | Globex {#r3p9x} | lots | Lead | [Pricing draft](dag:7q2m9xk4tb) |

| Where | What it does with one |
|---|---|
| the sidebar | **New** → *Table* makes `untitled` with one tab, two text columns and three rows, and names it in the top bar; a table's row wears a grid; a folder's `+` makes one in the folder |
| its page, `?table=` | the grid of one tab; the tab's bar — Sort, Filter, how many rows show of how many, undo and redo, Source; the tabs along the bottom; Import CSV and Export in the top bar |
| a board, or a note, embedding one | a card: its mark, title, tab and row count, then the tab's first rows as the tab shows them — ten on a board, twenty in a note; `#<tab>` picks the tab; Open, or a double-click, opens the table on it |
| `?view=1` | the grid read-only, the tabs in the strip |
| a snapshot | every tab, one after another, each under its name |
| the search | a row is a result, `part` `<tab>/<row>`; it opens the table on that tab with the row marked |

Nine things are load-bearing:

- **A tab is a `##` heading and everything to the next one; its grid is the first GFM table under
  it.** The heading's words are the tab's name and its `{…}` says `#id`, `sort=` and `filter=`; a
  header cell's `{#id type options= w=}` is a column; a row's first cell may end `{#id h=}`, because
  GFM has nowhere else in a row to put one. Fences are tracked across the file, so a table in a code
  block is code. Anything else under a tab is kept byte for byte and warned `WT_STRAY`.
- **A cell is kept as written and read by its column's type.** `readCell` in `src/table/values.ts`
  says what `1,200`, `2026-10-01`, `[x]` or `[Title](dag:…)` is to a number, a date, a checkbox or a
  link column; a value it cannot read stays, drawn red and wavy and warned `WT_CELL`, and sorts after
  every value that reads. Retyping a column never touches a cell — a column made a number shows its
  words as words.
- **A write touches the smallest span that means it, and never re-pads.** A cell is its segment of
  its row's line; a row added, moved, removed or resized is that one line; a column renamed or
  retyped is the header line (and the delimiter, where GFM says a number is right-aligned); a column
  added, moved or removed is the tab's grid. An author's aligned table survives every write that
  does not reach its rows, and two people's edits to two rows are two lines `merge3` can merge. A
  write that means nothing — a cell set to what it holds — is not a write.
- **Ids are minted by whatever first needs one**, the quiz's rule: a tab's and a column's is the slug
  of its name (`amount`, `amount-2`) and a row's `r` and five characters. The page runs `stampTable`
  before any write it makes, the server on a table it creates; an agent writing a table by hand gets
  `WT_NO_ID` and a table that works. Renaming a column or a tab keeps its id, which is why a sort or
  a filter survives the rename.
- **The grid's positions become ids in the edit, never before.** `Grid` hands the page a writer and
  where it wants it — row 2 of the view, column 3 — and `TablePage`'s `edit` stamps the text, reads
  it again and turns each position into the id there *in the text being written*. So the view's order
  (sorted, filtered) and the file's never have to agree, and an edit addresses what it meant however
  the other writer moved things. An id that names two things — `ET_DUPLICATE_ID` — is refused with a
  word rather than written to the first (*Things that will bite*).
- **A sort is how a tab shows its rows, never where they are.** `viewRows` is the one function that
  says what a tab shows: its filter kept, in its sort's order, stable, each row with its stored
  index. Dragging a row is refused while a sort is showing, because under a sort a row's place is not
  its own; clearing the sort gives the file's order back.
- **The file is kept by `useDocFile`, the quiz's controller** (`src/ui/docFile.ts`, which both pages
  share): a `put` 250 ms after a change against the sha1 last seen, a 409 merged line by line, *Keep
  mine* or *Use theirs* when both touched one line, a retry on a backoff. **Undo is a version of the
  file** — `History` from `src/edit/`, holding texts rather than sha1s — and a stack whose top is not
  what the page holds, because another writer's change was adopted, is dropped rather than applied.
- **A card reads the table's text once, however many show it.** `useTableText` in
  `src/view/tableText.ts` is one fetch per table and one `dag:table` listener while anything shows it,
  so ten cards of one table are one request and a change re-renders its cards and nothing else on the
  canvas. A card stops its double-click at itself, so the board does not also open the editor panel.
- **CSV is a conversion, never a format.** `src/table/csv.ts` reads RFC 4180 with the delimiter
  sniffed among `,`, `;` and a tab, and a column's type inferred from its values; a tab goes out as
  every row in its sort order, unfiltered — a filter hides rows from a person, not from a file they
  asked for.

`GET /__board/table?name=&tab=&view=` answers every tab with its rows and every cell as written and
as its type reads it; `POST /__board/table {name, base?, ops}` applies ops addressed by id — `cell`,
`addRow`, `removeRow`, `moveRow`, `rowHeight`, `addColumn`, `setColumn`, `removeColumn`,
`moveColumn`, `addTab`, `setTab`, `removeTab`, `moveTab`, `importCsv` — through the grammar's
`/table` (`handle()`, called in-process), recomputing on a conflict when no `base` was sent. `anydag table` and the `table_*` MCP
tools are that route. `check:skill`'s tenth set holds the skill's code table to `TABLE_CODES`.

Names claimed, grepped first: `dag-grid*`, `dag-tablepage*`, `dag-tablecard*`, `data-dag-grid*`,
`data-dag-tablepage*`, `data-dag-tablecard`, `data-dag-table` (a search row),
`data-dag-sidebar-new-table`, the event `dag:table`, and the query keys `table` and `tab`.
**`dag-table*` is left alone on purpose**: `.dag-md table` styles every Markdown table a board draws,
and the library already has a `table` entry, a three-column `md` item — one character from either is
the namespace hazard this file records. And since a card draws its grid inside `.dag-md`, whose
`th`/`td` rules are (0,1,1), every cell rule in `chrome.css` is two classes deep.

**Out, and why:** formulas and computed columns, charts from a table and views on one; a
multi-select, a person, a relation to another table's
row and a rich-text cell (each a decision about what a cell means); merged cells, frozen columns and
colour in a cell (the colour is the theme's); a Tables page like the Quizzes one (the sidebar and the
search find one); two people in one cell at once (the store is an optimistic sha1, as for every
kind); and a table's own version history.

## Attachments

An **attachment** is any file a person keeps: `<vault>/<name>.<ext>`,
by default in the vault's one `attachments/` folder. It is listed,
foldered, moved, favourited, searched and carried between vaults as a note is, with a permanent id
(`<vault>/.anydag/files/<id>.json` holds `{path, title}`, since a PDF has no frontmatter), and it is
opened at `?file=<name>`.

| Where | What it does with one |
|---|---|
| the sidebar | Upload (the actions, or a folder's `+`) and files dropped from the computer onto a folder; a row wears an icon for its sort — PDF, picture, sheet, slides, document, audio, video, archive, text |
| its own page, `?file=` | its title at the top, which renames it; the file drawn — a picture, a PDF through pdf.js, audio and video in the browser's players, text as text — or a card with its type, size and Download |
| a note | `/` *Upload file*, or a file dropped from the computer: kept beside the note and embedded at the caret; `![Title](dag:<id>)` draws a picture inline and anything else as a card that previews in place |
| a board | a file dropped on the canvas, Import, or a sidebar row let go over it: a picture is an `image` fence with `src="dag:<id>"`, anything else the placed card every document is |
| `?view=1` | the page read-only; a note or board draws the files it names |
| Export | a board or a note that names an attachment or a pasted picture saves as `<name>.zip` |
| Settings → Import and export | the largest file and the types this server takes, read-only |

Nine things are load-bearing:

- **A pasted image is an attachment too.** It is kept in
  the vault's attachments folder like any upload (`storePasted` in `server/routes/files.ts`), so one
  picture pasted into two notes is two references to one file — a screenshot belongs to the vault
  rather than to the document it was pasted into. `<name>.assets/` is read, so every
  existing document still draws, and never written again.
- **The name keeps its extension and nothing else's does.** `specs/Q3 report.pdf`: a portable stem
  (`cleanSegment` in `server/names.ts`), then an extension of `[a-z0-9]{1,12}` the vault lists —
  `md` and `assets` refused, so no attachment is ever a document or a picture folder. A move keeps
  the extension whatever `to` says (`fileTarget`): renaming a PDF does not change what it is.
- **The title is the index's**, because a PDF has no frontmatter: its `.anydag/files/<id>.json`.
  It starts as what the file was called on the uploader's disk, and
  `/retitle` with `follow` moves the name to the title's stem, extension kept.
- **The server decides what a file is, off the extension** (`server/uploads.ts`), and ignores the
  `Content-Type` the browser sent. It serves inline only what a browser draws safely — a picture, a
  PDF, audio, video, plain text — and everything else as a download; always `nosniff`, and a
  `sandbox` CSP on everything but a PDF, which Chrome will not draw under one. An `.html` uploaded
  here is a download and never a page on the app's origin; an `.svg` is drawn only as an `<img>`.
- **The bytes are the request body**, `POST /__board/file?name=&folder=&title=`: twenty-five
  megabytes are thirty-three as base64, and a multipart form wants a dependency the server does not
  need. The size is checked as it streams in, so an oversized file is refused at its first megabyte
  over. The page checks the same two limits before it sends anything (`refusal` in
  `src/files/upload.ts`, the server's sentences word for word), and a board says a refused drop in
  `UploadNotice`, off the `dag:upload-problem` document event.
- **A reference is an id**, as to anything: a rename or a move changes no file that names it, and one
  stored file serves every note and board that does. `attachmentOf` in `src/render/assets.ts` is how
  an image fence's `src` becomes `/__board/file?id=`; `ownAssets` is the one place a page decides
  where a picture is.
- **Deleting one moves it to the trash**. `anydag file rm` and `file_delete` still read
  the references index and name the documents that use it; the embeds in them draw as missing until
  it is restored, under the same id, and then draw it again.
- **The zip is the page's and the CLI's one function**, `src/export/bundle.ts`, pure and DOM-free:
  every `dag:` naming an attachment rewritten to its path in the zip (a board or a note stays a
  `dag:`), the files beside the Markdown, a pasted picture at the path its text already gives it. A
  document that names nothing still exports as the `.md` it was.

**An attachment is a file of a type this server knows** (the vault's `types`: `DEFAULT_TYPES` and
whatever `ANYDAG_UPLOAD_TYPES` adds), so a page or a script somebody
left in a folder is not listed or served. Both file routes answer a
`Range` with a 206 (`byteRange` in `server/uploads.ts`): a `<video>` will not seek without one, and
Safari will not play one at all. The size limit is `ANYDAG_UPLOAD_MAX_MB`, 512 by default.

The change feed says `dag:file` for an attachment, carrying its title, so a row is redrawn in place;
`useFiles` keeps the page's list of them, and the file's page draws nothing until that list says the
file exists — an `<img>` pointed at a missing file is a 404 on the console, which fails the suite.

Names claimed, grepped first: `dag-file*`, `dag-pdf*`, `dag-embed--file`, `dag-embed--picture`,
`dag-embed__filerow`, `dag-embed__preview`, `dag-embed__title`, `dag-embed__chev--open`,
`dag-upload-notice*`, `dag-blocks-drop`, `dag-sidebar-files`, `data-dag-file*`, `data-dag-pdf*`,
`data-dag-embed-download`, `data-dag-embed-kind`, `data-dag-embed-picture`, `data-dag-embed-preview`,
`data-dag-embed-previewing`, `data-dag-note-drop`, `data-dag-note-upload-problem`,
`data-dag-sidebar-upload*`, `data-dag-sidebar-uploading`, `data-dag-unlink*`,
`data-dag-upload-problem`, `data-dag-ref-kind`, `data-dag-setting-upload-max`,
`data-dag-setting-upload-types`, the events `dag:file` and `dag:upload-problem` (in
`test/prefs.test.ts`'s list), and the query key `file`.

**Out, and why:** text search inside a PDF, annotation, OCR, link previews;
importing an exported zip back; a new version of a file under its old id (an upload is a new file,
and replacing one is a decision about what every reference then means); and a thumbnail of a PDF's first page on its card, which would load
pdf.js on every page that shows one, for a picture of a page the preview is one click from.

## The trash

Every delete a person or an agent makes — a file of any
kind, or a folder with everything in it — moves the thing to the vault's trash, where it stays for
`ANYDAG_TRASH_DAYS` and comes back as it was; only the trash deletes for good.

| Where | What it does |
|---|---|
| the sidebar | Delete on a row, a picked row's menu or the selection's bar: to the trash at once, nothing asked; a **Trash** row at the foot opens the page |
| the notice | *Moved “Plan” to the trash* · **Undo** (every entry the delete made, the open file reopened, a favourite a favourite again) · **View trash**; eight seconds, held while the pointer or the focus is on it |
| the Trash page, `?trash=1` | newest first: the mark, the title, where it was, what a folder held, *Deleted 3 days ago · 27 days left*; Restore; Delete forever, asked in its row; a filter; Empty trash, asked once |
| Settings → Vault | how many days, read-only — the server's |
| `anydag trash ls\|restore\|rm\|empty` · `trash_list`, `trash_restore`, `trash_delete`, `trash_empty` | the same four, by an entry's id or the name it had; the two that delete for good ask, or want a `confirm` |

| Route | Does |
|---|---|
| `POST /__board/delete` `{name, kind}` · `POST /__board/rmdir` `{name, recursive?}` | to the trash, answering `trash`: the entry |
| `GET /__board/trash` | `{days, entries: [{id, name, kind, title, deleted, expires, doc, holds}]}` — what has expired removed on the way |
| `POST /__board/trash/restore` `{id}` | the entry as it landed: its `name` numbered when the old one was taken since |
| `POST /__board/trash/delete` `{id}` · `POST /__board/trash/empty` | for good: `{id}` · `{ids}` |

`server/vault.ts` owns it (`trash`, `trashFolder`, `trashList`, `restore`, `forget`), `server/trash.ts`
the days and the answer's shape, `server/routes/trash.ts` the four routes. Eight things are
load-bearing:

- **A trashed document is not a document.** It is in no listing, the references index, the search
  corpus or any route that reads by name; its id resolves to nothing, so a reference to it draws as
  missing. Its file keeps its `id:` and the entry keeps its index row — `created`, an attachment's
  title, every image — so a restore puts it back as it was and every reference works again.
- **One entry is one thing a person deleted**: a file, or a folder with what it held at that moment
  (`holds`, by kind, the folder itself among the folders). Several rows deleted at once are several
  entries, and the notice's Undo restores all of them, last first.
- **A restore never overwrites.** A name taken since is numbered, `/create`'s rule; a folder whose
  path exists now comes back as `work 2`, never merged, `/mvdir`'s; the folders above it are made
  again. An id a live document took in the meantime is that document's, and the restored one is
  given a fresh one, written into its frontmatter: stated, not guessed at.
- **The trash is in the vault and never among its documents**: `<vault>/.anydag/trash/<entry>/` —
  `entry.json`, and `files/` with what went exactly as it sat in the vault, moved there and back with
  `rename(2)`. Every dot-folder is unwalked, so nothing that lists had to learn to skip it, and a sync
  tool carries the trash with the vault — a delete on one machine is restorable on the other.
- **The manifest is written before the payload moves**, so a crash leaves an entry with nothing to
  restore, which Delete forever clears — never a payload nothing names.
- **Expiry is lazy.** `ANYDAG_TRASH_DAYS`, 30, anything but a whole number above zero read as 30. An
  entry past it is never listed and never restored from the moment it expires; its bytes go the next
  time the trash is listed. No scheduler: the app runs nothing while nobody opens it.
- **What stays permanent**: a saved component, the original a move to another vault leaves (a move,
  not a delete), and the unused-images sweep. `rmdir` kept its contract — a folder with anything in
  it is a 409 without `recursive: true`, the boolean.
- **The trash has its own event.** The watcher never looks in a dot-folder, so the vault emits
  `{type: "trash"}` itself and the feed sends `dag:trash`, which `onTrash` (`src/board/events.ts`)
  and the page's own calls dispatch on the window, `onBoards`' rule — so a Trash page open anywhere
  never offers to restore what another tab already has.

Deleting a file **on disk** — a file manager, an agent's own tools — is not a delete through the app,
and is for good: the trash is the app's. The skill says so.

Names claimed, grepped first: `dag-trash*`, `dag-trash-notice*`, `dag-app--trash`, `data-dag-trash*`,
`data-dag-sidebar-trash`, `data-dag-setting-trash-days`, `--trash-notice-left`, the event
`dag:trash` (in `test/prefs.test.ts`'s list), and the query key `trash`.

**Out, and why:** opening a trashed document read-only — the page lists, restores
and deletes; items deleted on a board's canvas (undo is a version of the file, and already brings
them back); a scheduled purge; restoring somewhere else (a restore puts a thing where it was, and
moving it after is one drag); and a reference that says *in the trash* rather than missing, which
wants the index to read the trash.

## References, ids and the read-only view

Four ids decide how things are pointed at: a document's is `id:` in its frontmatter, an item's is
its `#id` with loose prose fenced to carry one, a note block's is a lazy `^id`
anchor, and a reference is a Markdown link to `dag:<id>`.

| What | Its id | Minted by | Survives |
|---|---|---|---|
| board, note | ten characters of Crockford base32 (`server/ids.ts`), `id:` in its frontmatter | the server, on create, or the first time something links it by id | rename, move, edit, a copy to another machine — not a duplicate, which is a new document |
| canvas item | its `#id` | whoever makes it, else the stamp | move, edit, retitle, cut and paste, export and import; `renameItemId` is the one deliberate change |
| note block | ` ^name` at the end of its last line | whatever first points at it | edits to the block, moving it |

Ten things are load-bearing:

- **A document's id is in its frontmatter, and opening never writes.** `id:` is the truth and
  travels with the file through a copy, a sync and a `git mv`; the SQLite index in the app's home
  maps it to a path and is rebuilt from the vault. An existing `.md` with no id is given one the
  first time something links or embeds it by id (in the write that links it), or when the app
  creates it — not on its first edit, which would change bytes the page sent. `npm run stamp` is the
  one script, for items: an empty patch per board *is* a stamp.
- **A file moved outside the app keeps its id**, because the id is in it; the index learns the new
  path from the watcher or the next scan. Two files with one id — a copy made in a file manager —
  leave it with the older by created date, and the copy is given a new one.
- **An export no longer needs an envelope.** The id used to live in the store, so an export wrote
  `id:` into a frontmatter and the import took it out again (`src/board/envelope.ts`); it is in the
  file now, and the module is what is left of that.
- **The stamp is a fixed point that keeps every id**, held over every board in the repository, and
  is `applyPatch`'s own pinning rather than a second writer. `/put` is never stamped: it is the undo
  path, and a restore that changed the bytes it restored would be the history lying.
- **A reference holds an id and never a name**, and is followed through `?ref=<id>`, which the page
  resolves (`/__board/resolve`) and replaces with the name it stands for now. So a rename or a move
  changes nothing in any file, and every surface draws the target's *live* title — the words in the
  brackets are only a fallback, refreshed when the block holding them is next edited. **It is followed
  without loading the page**: `App` catches a plain click on a link to `?ref=` in its own
  workspace, and `follow()` (`src/refs/follow.ts`, the `dag:follow` event) is how the two links that
  navigate by hand ask — the editor's chip and a table's card. The id is resolved off the list when a
  list fetched on this page load knows it, and through `?ref=` otherwise, as a **pushed** history
  entry, so Back is the document it was followed from. A page nobody listens on — `?view=1` — and
  a click with a modifier still load.
- **`react-markdown` empties any URL protocol it does not know**, which is what makes it safe with
  `javascript:` and what turned every reference into a link to nowhere and every embed into a broken
  image. `urlTransform` in `src/refs/Ref.tsx` lets `dag:` through and nothing else, and every
  `ReactMarkdown` that can hold a reference has to be handed it.
- **An embed is a block, and a paragraph cannot hold one.** A `dag:` image alone on its line draws
  the target; anywhere else it is a one-line card, because a `<div>` in a `<p>` is a console error
  and the e2e suite fails on those. A board embedded in a board is a card too — a viewport inside a
  viewport pans two things — and a note embedded in a note stops at one level.
- **The index is one copy per page, and nothing on the canvas subscribes to it.** It reads every text
  the vault has, so it refreshes at most one wait after the first change rather than after the
  last — a debounce that restarts on every change never fires while another tab is writing — and a
  change arriving while a fetch is out asks again once it lands. The note editor reads it when a
  picker opens and never re-renders on it: handing BlockNote's suggestion menus a new `getItems`
  closes an open menu under the person typing, and only the suite running four notes at once showed
  it. `BoardApp` does not subscribe either; the open library and the backlinks count do.
- **A `[[wikilink]]` is resolved through a lookup, never a scan.** `wikiIndex` in
  `src/refs/wikilinks.ts` maps every folded name, every path tail and every title to its documents
  once per list, and `resolveWiki` memoises it on the array (a `WeakMap`, so a list must not be
  mutated after its first use). Three passes over the list per link was O(links × documents):
  `/__board/index` on 5,000 notes with thirty links each ran for over four minutes and held the
  server's only thread. `test/wikilinks.test.ts` holds the lookup to the three passes on vaults made
  to collide.
- **One document's references are `GET /__board/refs?name=&kind=`**: its references out, each with
  the document it names (`target`, or `null`), and its backlinks with their type. It is the index read
  for one name, so a client asking about one document is not sent every document's (4.6 KB where
  `/index` is 10.9 MB on 5,000 notes). The MCP `refs` tool with a `name`, `anydag <kind> refs`, and
  `file rm` and `file_delete` read it.
- **The vault reads a disk somebody else is deleting from.** A folder listed a moment ago can
  be gone when it is opened, and a board read a moment ago gone when it is written. Both always
  could; the index route lists the vault far more often than anything did, and turned a rare race
  into a 500 under the e2e suite. The walk skips a vanished folder, `read` and `texts` a vanished
  file, and `write`'s `NotFound` reaches `/patch`, `/put` and the MCP tools as the 404 `must_read`
  already gives.
- **A `#part` is looked for by whichever page opens, and let go once shown** (`src/refs/target.ts`).
  The board page frames the item and selects it once it is drawn — switching page first if it is on
  another — and the note page puts the caret on the block. It lives in the hash, where `?ref=`
  already carried it, and is cleared once used, or opening another board from the sidebar would look
  for the same item id there: `md-1` is on most boards. `replaceState` fires no `hashchange`, so
  setting one announces `dag:target`, which is how a result on the board already open moves the view.
- **`App` is a lazy chunk.** `Gate` mounts `ViewApp` for `?view=1` and otherwise loads the canvas on
  demand, so "without the editor" is a fact about the network rather than about the tree.
  `test/view-graph.test.ts` walks the static import graph from `main.tsx`, and `view.spec.ts` checks
  the requests a view page actually makes.

`@` and `[[` insert a reference and `![` (Markdown's own start of an image) an embed; the slash
menu's *Board* opens the `![` picker. Two documents with one title are told apart by their folders in
the picker — or, in one folder, by a number, with the file name under the row as the one thing left
that tells them apart — which is also what keeps BlockNote's rows, keyed by title, from
colliding. A board
carries a note as an `md` card whose whole body is the embed, placed from the library's *Your notes*.

**On a board an embed is never drawn, only named**: `refComponents({ placed: true })`,
which `MarkdownItem` asks for, turns every `![…](dag:…)` on its own line into `PlacedCard` — one
height for a note, a task and a board, the title on one line, what it is under it, and a button that
opens it. The title is not a link, because a press on the card is how the item is selected and moved,
and a linked title would leave the board on every press that did not move; the button stops the
press first. A target the index has not named yet, or has lost, is the same card (`PlacedMissing`),
so the board does not change height when the index answers. A quiz keeps `QuizCard`, which carries
Practice. In a note an embed still draws its target.

Names claimed, grepped first: `dag-ref*`, `dag-embed*`, `dag-backlinks*`, `dag-view-bar*`,
`dag-view-missing`, `data-dag-ref*`, `data-dag-embed*`, `data-dag-backlink*`, `data-dag-view*` —
and `dag-embed--placed`, `dag-embed__mark`, `dag-embed__text`, `dag-embed__name`,
`dag-embed__what`, `dag-embed__open`, `data-dag-embed-placed`, `data-dag-embed-open`,
`data-dag-embed-missing`.

**Out, and why:** a references table stored beside the texts (a second copy of what the files say;
the scan is right for tens of documents and is the thing to replace, with an index kept on write,
once a vault holds thousands); hiding a block's `^id` inside the editor (it wants a schema prop
on every block type, and nothing yet points at a block from the UI); a board embedded in a board; and
mobile viewing, which the view is built for. Sharing a vault stays the folder's: it is shared the
way any folder is.

### Wikilinks follow a rename

A `dag:<id>` reference survives any rename by construction; a `[[wikilink]]` holds a name, and a
name is the title the file carries. So every route that changes a document's name —
`/__board/retitle`
with `follow`, `/__board/rename` (not a copy), `/__board/mvdir` — runs inside `relinking()`
(`server/relink.ts`): the vault's list before, the change, the list after, and every text whose links
the change broke rewritten through the store under its sha1 base, recomputed on a conflict. The
arithmetic is `src/refs/relink.ts`, pure and browser-free; the answer carries
`relinked: {links, files, missed}`, or `null` when the vault has it off (`dag:update-links` = `"0"` in
`<vault>/.anydag/settings.json`; Settings → Vault, on by default). The CLI and MCP have it for nothing,
calling those routes. Seven things are load-bearing:

- **The invariant is "names what it named".** A link that resolved to a document before and does not
  resolve to it after is rewritten so it does; a link that resolves to it either way is left (`[[Plan]]`
  still names `Projects/Plan` moved to `Archive/Plan`); a link that named nothing is never touched — a
  document taking the name a dangling link asks for is the link coming alive. And when the moved
  document wins a tie it used to lose, the link that named the other one is rewritten to keep naming it.
- **Resolution is `resolveWiki`'s and no one else's**, called against the two lists, so the page, the
  index and this cannot disagree about what a link names. Both lists are built once per rename and
  never changed, which is what lets `resolveWiki` keep one index per list; and `changeOf` collects the
  folded leaves and titles of every document whose name or title differs, so a link none of whose keys
  is there is not even resolved, and a text with none of them is not even parsed.
- **Only the target is rewritten, in its own form.** The alias, the `#heading` or `#^block`, the spaces,
  a table's `\|`, the `!`, a `.md` or `.board` after the name — all kept. A full path is written as the
  new full path; a leaf or a partial path as the shortest tail of the new name that names it alone,
  never shorter than what was written; a title as the new title. A name a wikilink cannot hold (a `#`,
  a `|`) leaves the link alone rather than writing a broken one.
- **The places are `extract.ts`'s**: a note's, a quiz's and a table's Markdown outside code, maths, an
  ordinary link's text and the frontmatter, and a board's `md` and `note` items. A `[[x]]` in a code
  span or a diagram's DSL is text and stays as written.
- **It runs inside the request**, so when the Assistant renames something the chat's recorder holds the
  rewrites in the same op as the rename, and undoing the block undoes both (`test/server/relink.test.ts`).
  A page holding one of those notes open adopts the rewrite through the change feed like any outside write.
- **What it does not follow, and why.** A transfer to another vault: a link resolves within its vault,
  and the one left behind cannot name a document that is no longer in it. A restore from the trash that
  was numbered, and anything moved on disk outside the app: the app was not the one that moved it.
- **No notice and no undo of its own**, which is Obsidian's behaviour: a person who renames a file wants
  the links to keep working and nothing to ask. Undo is the Assistant's block undo; a rename made by
  hand is undone by renaming it back, which rewrites the links back.

## Search

`src/search/`. The search card (`space O`, the sidebar's Search, the board's own name)
matches file names as it always has, and under them lists every match **in the text** of every board
and note, in one ranked list. A result opens its document where the words are.

The design is **local-first, with the grammar on the server**, and it is a split of the work rather
than a choice of platform. Parsing a search in the browser would mean parsing every board and
every note on every keystroke, which is the slowest thing the page does (remark runs at
about 0.3 MB/s). So the work goes where the parsers already are: `GET /__board/corpus` reads every
text and cuts it into **units** in the server's grammar (`server/grammar.ts`, called in-process);
the page fetches that while its search card is open, builds a MiniSearch index, and matches every
keystroke with no round trip.

| Unit | Its `part` | Holds |
|---|---|---|
| a document's title | none — the result opens the document | the frontmatter `title:` |
| a board item | its `#id` | an `md` or `note` as the words a person reads, code included; a caption; a prompt; a diagram's every title, meta, description, row, label, legend entry and category |
| a note block | `^anchor` if it has one, else `L<line>` | a heading, a paragraph, a quote, code, a table a cell at a time — and each list item on its own |

Seven things are load-bearing:

- **A result is a link, so a unit is only ever something with a name.** On a board that is an item:
  its `#id` is in the file, and the item is what the canvas can frame and select. A
  card inside a diagram has an id only its dialect knows, so a diagram is one unit holding
  everything its parse draws. Hidden items and `edges` fences draw nothing a result could show, and
  are left out.
- **A block nothing has anchored is named by its line**, never by an anchor minted for the
  occasion. A search is a read, and writing ` ^name` into a note to link to it would turn it into a
  write into a file somebody may be typing in. A line is not a permanent name and does not need to
  be: the corpus is at most one change old, and the link is followed the moment it is made. Lines are
  the **file's**, frontmatter counted, which is what a person or an agent would count; the editor
  takes the frontmatter off and `blockAt` in `src/note/markdown.ts` finds the block — a list item by
  its own line, off the span map rather than a second parse.
- **Its own route, not more fields on `/index`.** The references index is read by every page that
  shows a backlink and is subscribed for as long as the page is up; this is the heavier of the two
  and is read only while somebody is searching. `useCorpus` subscribes when the card opens and lets
  go when it shuts, keeping what it had, so a card opened again shows the last answer at once and the
  fresh one replaces it. While the card is open it follows the change feed with `useIndex`'s
  debounce — at most one wait after the *first* change — so the index is kept updated
  on edit. Both routes read the vault through one listing, so they cannot
  disagree about what it holds.
- **Only a text that changed is parsed again.** The `Parsed` cache in `server/grammar.ts` keeps each
  document's units against the sha1 of the text they came from and parses the rest. `/patch` runs in
  the server's own process too, so an uncached whole-vault parse after every change is a pause every
  drag then queues behind (measured: a 5 ms `/diagnostics` took 390 ms while
  four of them ran, and 5 ms again with the cache). The reading of every text on each call is still
  `/index`'s cost and limit: right for tens of documents, the thing to replace with an index kept
  on write at thousands.
- **A whole-vault parse is on a thread of its own** (`server/grammar-worker.ts`). `/index`,
  `/corpus` and `/search` go to a worker; everything else stays inline, being quick. Measured on
  5,000 notes, a cold `/index` is 14 s of parsing, and on the server's one thread it was every
  request waiting, `/api/auth/me` included; now `/api/auth/me` answers in 2 ms while it runs. The
  worker is built beside each bundle (`server/build.mjs`, `cli/build.mjs`), and where there is none
  (the unit suite, or `ANYDAG_GRAMMAR_INLINE=1`) the calls run inline. `Parsed.of` runs one call at
  a time, so two cold asks parse once, and its `generation` moves only when its answer does.
- **A search keeps its engine.** Building MiniSearch is the cost, 3 s over 5,000 notes, and the
  query is not. `corpusOf` names the corpus with a `version` (the vault, the parse's `generation` and
  the names and titles), and `/search` sends the docs to the grammar once per version. After that it
  sends the version alone and gets a 412 back if that engine is gone (a worker restarted). Warm, a
  query is 0.25 s.
- **Every word must match, and every word is a prefix** (`combineWith: "AND"`, `prefix: true`), so
  the list narrows as it is typed, the way the names above it do, and `pay sett` finds "payments
  settle". A word of five letters or more forgives one typo in five and a shorter one none; accents
  and case are folded both ways. At most three hits come from one document and forty in all.
- **The snippet marks exactly what matched**, by word, folded the way the index folds — so a
  prefix hit marks the whole word it matched and nothing else — in a window around the first match
  cut on word boundaries. The tokenizer and the snippet split on one character class; two would mark
  words the index never matched.
- **A board opens on the item, a note on the block**, through the `#part` machinery *References*
  describes: the board frames the item with `ViewportHandle.show()` — a fit that never magnifies past
  100%, so a three-line note is shown at its size rather than as a letter of it, and that counts as
  the person having moved the view, so the next content change does not refit the board over it —
  and selects it, which is the highlight the canvas already has. A note puts the caret on the block
  and scrolls it to the middle.
- **The note's mark is a CSS highlight, never an attribute** — see *Things that will bite*.

Names claimed, grepped first: `dag-hit*`, `dag-hits*`, `data-dag-hit*`, `data-dag-hits*`, the event
`dag:target` (in `test/prefs.test.ts`'s list of events, which is what caught it), and the highlight
name `dag-found`.

**Out, and why:** a match inside a diagram opening on its card rather than on the diagram (a card's
id is the dialect's, and framing one needs the layout's box, which `App` has but a result cannot
name without a grammar for it); an agent's search tool over MCP (`/__board/corpus` is there, and a
tool is a decision about what an agent should read, not a mechanism); the read-only view framing an
item (it reads a block's anchor already and has no search to open it from); and ranking by recency
or by what is open, which would make the same query answer differently from one board to the next.

## The command line

`cli/`. `npm link` in the repository puts `anydag` on the PATH, or `npm run anydag -- <command>`
runs it; `anydag help` is the table and `anydag help --json` the same as data.

| Where | Owns |
|---|---|
| `cli/anydag.mjs` · `cli/build.mjs` | the launcher, and the bundle it rebuilds when `dist/meta.json` lists a source newer than it |
| `cli/main.ts` · `cli/args.ts` | which command the words name, and a parser that reads `-40` as a number |
| `cli/api.ts` · `server/connect.ts` | the one door to the server — a failure becomes an exit code — and finding it: the running app's `server.json`, or the server in-process on `--vault` |
| `cli/board.ts` | load, parse, and `mutate`: read, compute, write under the base, recompute once on a 409 |
| `cli/ops.ts` · `cli/inside.ts` | the gestures as text arithmetic — items, pages and links; the cards, edges, rows and a chart inside one diagram |
| `cli/commands/` | one file per group, each command declaring the routes it reaches |

Six things are load-bearing:

- **It is a client of the routes, never of the disk.** With the app running it reads
  `server.json` in the app's home and sends the token as a header; with none, `--vault <folder>`
  (or `ANYDAG_VAULT`, or the vault opened last) starts the same server in this process, on the same
  home and its SQLite index, so an id the CLI mints is the one the app will read. Either way a
  write goes through the store, its sha1 base and its watcher — which is why it never writes a
  vault's file with `fs` even though it could.
- **It runs the page's code, not a copy.** `src/board/` and `src/dsl/` come in verbatim, as the
  server takes them, and the pointer-free half of `src/edit/` through the `@/` alias esbuild reads
  from `tsconfig.json`. Where the page's logic is private to `useEditor` — `insert`, `freshId`, the
  page list, `anchorAt` — it is restated in `cli/ops.ts` and says so. **The bundle is the grammar of
  the checkout it was built from**, which is why the launcher checks `meta.json`'s inputs on every
  run; a CLI carrying last week's `restate.ts` would write lines this week's parser disagrees with.
- **A 409 recomputes, never re-sends.** Every gesture is a function of the board's text, so `mutate`
  runs it again over the text the conflict carried. The page retries the *same* ops, which re-sends a
  body written from the old text over the other writer's change to that item; here it cannot.
  `board write` is the one whole-text write and wants `--base` or `--force`; `board edit` merges with
  `merge3` and keeps your text aside when both of you changed a line.
- **Parity is a closed set.** Every route `server/routes/` declares is reached by some command's
  `routes` or is in `REFUSED` with a reason, and every route a command claims exists. `REFUSED` is
  read out of `docs/parity.json`, which holds the same set across the MCP tools too (*Parity*).
  `check-skill.mjs`'s eighth set holds the skill's `anydag …` lines to `anydag help --json`, and
  every command group to being named at least once.
- **The picture is the page's.** `snapshot`, `tidy`, `board export --format svg|png` and `note
  export --format pdf` open the page in Playwright with the token as its cookie under
  `?snapshot=1`, the way `scripts/snapshot.mjs` does. Export goes through `dag:export`, a document
  event whose `detail.reply` gets the SVG's text or the PNG as a data URL — a callback rather than a
  data attribute, because an SVG with its fonts is megabytes — so the file is the Export menu's to
  the byte. A note's PDF replies with a title rather than the file: the page sets the sheet out and
  Chromium's `page.pdf()` prints it. Playwright is `external` in the bundle and imported only there.
- **What reads the laid-out page is refused, with its headless spelling beside it.** Detach, the
  structural drag, a `+` in a fixed fence, a lone shape's handles and the pen read `data-dag-layout`
  or a pointer; `node move` is `moveStatement` without the drop, `node add --at` writes the
  coordinate, `node set w= h=` sizes a shape. A position written on a page with unpositioned items
  says those will re-flow, because the page's answer — pin them where they are drawn — needs sizes
  only a browser has measured.

Exit codes are the snapshot script's, and every command's `--json` is the route's own answer: `0`
done · `1` refused · `2` usage · `3` a conflict, or untidy under `--check` · `4` errors · `5` not
ready · `6` no server · `7` no vault. Names claimed, grepped first: the `dag:export` event, and
nothing in the DOM.

**A route's new body field is a parity gap no route list can see.** `/rmdir`'s `recursive: true`
arrived after the CLI was written: the route was already reached, so the closed set was satisfied
while `folder rm` went on saying *never recursive* about a thing the app did. It is `folder rm -r`,
which counts what is inside from `/list` and asks, and wants `--yes` without a terminal. Read the
diff of `server/routes/` when rebasing over a change to it.

**`anydag mcp --vault <folder>`** is the MCP server (`server/mcp/`) over stdio, on the same door:
the running app's server through `server.json`, or one in this process. It is a command because it
is the same connection, and it speaks on stdout, so it takes no `--json`. See *Parity*.

**Out, and why:** undo (the page's history is the tab's memory, and `board write --base` with an
earlier text is the same act). `login` and `logout`, because there is no account to sign into, and
`share` and `feedback`, because there is no share link or feedback card for them to reach.

## Parity

`docs/parity.json`. The local server is reached three ways — the routes
the page calls, the `anydag` CLI and the MCP server — and the manifest is one line per feature: the
routes, the commands and the tools that reach it, or for any of the three `{"via": […], "why"}`
(covered by something more general) or `{"refused": "…"}`. `docs/PARITY.md` is the matrix drawn
from it by `npm run parity`. **A feature with nothing for one interface is a gap, and a gap is a red
test.**

| Where | Holds |
|---|---|
| `test/parity.test.ts` | the manifest against the routes (regex over `server/routes/`), the commands (`COMMANDS`, with each one's `routes`) and the tools (`TOOLS` from `server/mcp/tools.ts`), both ways; a feature's commands between them declare its routes; `PARITY.md` is current; `REFUSED` is the manifest's |
| `check-skill.mjs` | the skill's *Through MCP* section names every tool, read off `TOOLS` through esbuild |

Five things are load-bearing:

- **A tool calls its route** (`server/mcp/`): every tool runs the route with the body the page would
  send — in-process, or over loopback with the token — and turns the answer, or the refusal, into a
  tool's. So a rule changed in a route changes for the tool too, and the manifest is only ever a
  map. A tool's URL is an `anydag://open?…` deep link the desktop app opens.
- **A gesture inside a diagram is text on MCP.** The CLI's ~45 commands that pick a card, an edge, a
  row, a page or a link compute a patch with the page's TypeScript; an agent writes the DSL itself
  through `board_patch` and `board_write`. The manifest marks each `via`.
- **Notes and quizzes have tools of their own** — `note_*`, `quiz_*` — over a `kind` on the board
  tools. Renaming a tool breaks every client connected, so names stay.
- **What stays refused is what cannot work or must not be an agent's**: a snapshot, a tidy and an
  export need a browser; a change feed is a stream. Everything else is a tool, with a `confirm`
  naming the thing wherever the page would have asked in a modal — emptying a folder, closing a vault.
- **The grammar's answers are recorded, not written.** `test/fixtures/dsl-answers.json` is the
  grammar's own answers to the routes the tools reach, held to the live handler by
  `test/dsl-service.test.ts` — the rule *Things that will bite* states about stubs, made mechanical.

**Definition of done:** a new route, command or tool is a line in `docs/parity.json` in the same
commit, and `npm run parity` redraws the matrix — the checks fail otherwise, on every commit.

## The lock

Read only, so nothing changes by accident: `ctrl+shift+L`, or the switch at
the end of every page's top bar, and the notice under it says when it switched and when it refused
something.

| Where | Holds |
|---|---|
| `src/settings/lock.ts` | `dag:locked` (`writeLocal`, never `PREF_KEYS`), `isLocked`, `setLocked`, `toggleLock`, `useLocked`, `refuseLocked`, `mayEdit`, and the events `dag:lock` and `dag:lock-refused` |
| `src/ui/Lock.tsx` | `LockButton` (in `Toolbar`), `LockNotice`, `useLockKey` and `useLockedRoot` (in `Shell`), which paints `html[data-dag-locked]` |

Seven things are load-bearing:

- **Two layers, and both are needed.** Each page draws its read-only half — no dock, no handles, an
  editor not `editable`, a grid `readOnly`, a quiz drawn as its sheet, the sidebar's menus without the
  rows that write, a Trash page with nothing to restore or delete — and each write asks `isLocked()` again where it happens: `useEditor`'s `commit`,
  `put`, every `/create` and the paste's `/asset`, the methods on `ctl` (wrapped by `held`), the
  note's title and bars, the table's `write` and `restore`, the Shell's `files` (wrapped the same
  way, `trash` among them), the sidebar's bulk moves, the Vault pane's delete and sweep, and the
  trash's restore, delete for good and empty (`post` in `src/ui/trashApi.ts`, which the notice's Undo goes
  through too). The drawing is what a
  person sees; the floor is what holds when a key, a menu or a test reaches a write anyway.
- **A refusal is said, never silent.** `refuseLocked()` is the call, and it returns `false` so a write
  that answers with whether it landed can return it. A page that does nothing and says nothing reads
  as a broken page, which is the one thing a read-only mode must not look like.
- **It is this browser's.** The point is a phone locked against a finger brushing a board while a
  laptop edits. `writeLocal`, and every other tab follows through the `storage` event — so
  `useLocked` subscribes to both `dag:lock` and `storage`. A snapshot reads none of it, as it reads no
  preference.
- **A lock is heard past `Item`'s memo by a hook, and by a prop where the page draws.** The board page
  passes `locked` to `useEditor`, `Item` (in its comparator) and `SelectionBar`; a task card on a board
  sits inside a memoised item and reads `useLocked()` itself, which a URL test like `mayWrite()` could
  not do on a switch.
- **A locked board keeps what reads.** A click selects and returns before a drag is armed; a finger
  always pans; the arrows pan rather than nudge; select all, copy, Escape, the search, help, Settings,
  the select and hand tools and a selected item's Export all stay. The chords that make something are
  refused (`READS` in `useEditor` is the four that may run), and a drop is still cancelled — or the
  browser would open the file in place of the app.
- **A locked quiz is practised, and records only what has an id.** Starting a run stamps ids into a
  quiz that lacks them, which is a write; locked, the stamp is skipped, so such a question is asked
  and not recorded.
- **The key is ctrl+shift+L, in the capture phase and stopped**, so it works with the caret in a note
  and with the table's grid focused, which stops every key it handles. Nothing in BlockNote or TipTap
  binds it; Obsidian's own ctrl+E is the note editor's inline code.

Names claimed, grepped first: `dag-readonly*` (not `dag-lock*`: the logo owns `dag-lockup`),
`data-dag-readonly`, `data-dag-readonly-notice`, `data-dag-readonly-unlock`, `data-dag-locked`,
`dag-sidebar__menu-locked`, `data-dag-sidebar-menu-locked`, `data-dag-quiz-locked`,
`data-dag-trash-locked`, the storage key
`dag:locked`, and the events `dag:lock` and `dag:lock-refused` (in `test/prefs.test.ts`'s list).

**Out, and why:** a lock that follows the vault (it would lock every machine that opens the
folder); a lock per document (a property of the file, which every writer would have to honour); a
refusal in the api (an agent over MCP or the CLI is a deliberate writer, not an accident); and
practice records, which are not files.

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
  `applyPatch` writes it, undo covers it, the clipboard carries it. It draws nothing and takes no
  position, which is why `placeItems` and the paper both skip it — the second is not tidiness.
  `ready` waits for every item on the paper to report a measured size, and one that never renders
  never reports, so `data-dag-ready` would never fire and every Playwright check would hang.
- **The parser guesses and the resolver overrules.** `parseLinks` splits `a.b` on the last dot with
  no knowledge of the board; `resolveLinks` tries the whole string as an item id first, so an item
  whose own id contains a dot wins. That is `makeRef`/`resolveRefs` one layer up. Resolution runs
  *after* the pages are settled: an item on a page nobody declared is moved onto the first one and
  drawn there, and resolving before would report `EB_LINK_UNKNOWN_ITEM` for a card in plain view.
- **An endpoint that does not resolve takes its link with it**, so nothing downstream carries a
  case for an end that is not anywhere. One wrong id costs one diagnostic however many times the
  statement names it — a chain says its middle twice, a bus says its target once per source.
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

## Charts

Thirteen dialects, and every one of them a grammar for something that *is* — what runs, what stores,
what a record can become, where somebody put a box. A **chart** is the fourteenth and describes none
of that. Its statements are numbers and the labels on them, what it needs from a layout is a scale
rather than a graph, and it answers a question none of the other thirteen can be asked: how big is
each, and how does it change. And its size is the author's: it has no natural one, which makes it the
second diagram type after `sketch` whose box is a choice rather than the layout's answer.

    bar stacked
    x Q1 Q2 Q3 Q4
    series web "Web" 120 140 160 180
    series mob "Mobile" 40 60 90 130 hue=coral
    legend bottom
    values
    unit "k€"
    max 400

Twelve words at the head of a line — `bar line pie donut x series slice legend values unit min max`
— and `docs/dsl/chart.md` is the whole grammar, plus a *Choosing a form* section that is the one
part of drawing a chart no diagnostic can help with.

Six decisions hold the design together, and the code argued back in places. As they now stand:

**1. One dialect, with the form as a body statement — not four types, and not a fence attribute.**
The thing a person places is *a chart*; which shape it takes is a property of the data's job and the
commonest edit to one is changing it, so it is a one-word edit. It is in the body and not on the
fence because `src/board/` must not know diagrams — `dir=` and `aspect=` are already two leaks of
that kind. Absent, the form is `bar`.

**2. The model is data, not a `Graph` — and the sixteen `type === "sequence"` guards became one
predicate.** A bar is not a node and a series is not a group; forcing them into `Graph` would put
chart cases into `size.ts`, `NodeView`, ELK's config, `scoreGraph` and `finalize()` for nothing any
of them do here. `sequence` established the shape. The hazard was the guards: a second literal beside
each one is how the sixteenth gets missed — so `OWN_MODEL_TYPES` in `ir.ts` is the list, `hasGraph()`
in `parse.ts` is the predicate, and `check-theme.mjs` and `check-skill.mjs` read the array by regex
instead of appending `"sequence"` by hand. **A sweep counted fifteen and there were sixteen**:
the `/__board/diagnostics` route had its own, outside `src/`, and no sweep of `src/`
finds it — which is the argument for the predicate, made by the one site that was missed while
writing the thing that replaces it.

**3. The statement shape is `<kind> <id> "Label" …`, so the editor is inherited.** `series web "Web"
120 140` has the same head as every node declaration in the twelve, which is what buys the pick, the
inline rename, `setTitle`, `setModifier`, `removeNode`, `duplicateStatement` and `moveStatement` for
nothing. `restate.ts` gained only `setValues` and the four writers for statements no other dialect
has. One amendment: `declaredAt`/`declaredOn` **parse the chart** rather than running the generic
token scan — the model carries the line of every series and slice, so the exact answer was the
cheaper one; the scan is still proven to find both statement shapes.

**4. Size is the author's box, not the layout's answer.** `resizeOf("chart")` is `box`: `w=`/`h=` set
the item and the plot fills it, defaulting to `metric.chart.w`/`h`. A chart has no natural size the
way an ELK diagram does — the same six bars are right at 320px in a margin and at 900px as a hero —
so `aspect` would be a lie and `none` would leave the one type whose size is purely a choice without
a handle. Layout is synchronous on the main thread as `sequence`'s is, and every width is measured
through `measurer` so nothing is read back off the page.

**5. Colour is a theme-owned ordered list of hue names, `color.chartHues`, assigned in declaration
order and never cycled — resolved in the layout, not the parser.** Every other dialect takes
`HUE_ORDER` in the parser and the first draft of this said a series would too. The doctrine's
validator says otherwise: in `HUE_ORDER` the ten hues fail the colour-vision and normal-vision
separation checks on *every* theme, and which order passes is a property of the theme's actual
colours — so the order is the theme's to state, and the parser, which is theme-free, leaves an
unwritten hue `undefined` for `layoutChart` to fill. It is seven names in all three themes (`coral,
magenta, ochre, indigo, moss, violet, crimson`), held there by `check-theme.mjs` against `HUE_ORDER`,
`CHART_HUES_MAX` and no repeats. A written `hue=` overrides one **without consuming a slot**, so
hueing the second series does not shift the third's colour. Past the end the rest draw `muted` and
`W_CHART_MANY` says where it started: the doctrine's own answer is to fold the tail into an "Other",
and a warning that names the fold is the honest way to draw it anyway.

**6. The drawing follows the doctrine where it is a rule and the theme where it is a number.** Zero
in the domain of every bar; one series draws no legend and two or more draw one; direct labels only
when asked, except on a pie, which labels its wedges regardless; declaration order everywhere,
nothing sorted; a marker only when a line has few enough points for one to mean something; a paper
gap between adjacent fills and a ring on every marker; a bar rounded at the data end alone. Every one
of those numbers is a key under `theme.metric.chart` — **thirty** of them, plus six `type.chart*`
tokens, byte-identical across the three themes so `metricsHash()` still matches on a switch. Three
amendments, all from the drawing: **a written `min`/`max` beats the zero rule** (a control that
silently changes nothing is worse than a baseline the author truncated on purpose; zero is the
default, and a value the pinned scale excludes is drawn *at* the scale's edge); **the hero is drawn
for a `donut` only** (a pie has no hole, and a number over the wedges sits on the data it is
summarising); and **`tabular-nums` is refused**, though the doctrine asks for it — see *Still
deliberately out*.

Twelve things are load-bearing, and four more are in *Things that will bite* because they are
lessons about the codebase rather than about charts.

- **`parseChart` must not sniff for Mermaid, and `pie` is why.** `detectMermaid` treats a line
  beginning `pie` as a *header* — fatally, because a header means the block is another language end
  to end — and `pie` is this dialect's own form word. Sniffing here would make the commonest chart
  body in existence a parse error against a language nobody wrote. `mindmap`, `timeline` and
  `gitgraph` do not sniff either; only `parseWith` and `parseSequence` do. The other side of it is
  the converter's: Mermaid's `pie` is recognised by what is **Mermaid's alone** — the `showData`/`title` suffix,
  or a `"Label" : 42` row under it, which no chart statement can be — and `mermaidPie()` is that one
  predicate, called by the detector *and* by the converter's door, because the Inspector's Convert
  offer runs `detectMermaid` over any fence body whatever its type, and two spellings of one question
  is how an offer and the conversion behind it come to disagree.
- **A value nobody can read is a gap, not a dropped token.** Dropping it shortens the series, which
  then disagrees with the categories, which raises a `W_CHART_LENGTH` describing a symptom of the
  `E_CHART_VALUE` one line up. `ctx.broken`'s argument in a dialect with no ids: one wrong word costs
  one diagnostic.
- **`legend` means two things and is two fields.** `legend bottom` places the key; `legend solid "in
  sync"` is the shared glyph legend every model carries and `DiagramItem` reads off any model at all.
  So `ChartModel.legend` is `LegendEntry[]` like everything else and the placement is `legendAt` —
  the grammar tells them apart by whether a string follows the word.
- **`horizontal` is a transposition, not a second chart.** One pair of mappers — `catAt` for the
  category axis, `valAt` for the scale — decides which screen axis carries which, and every bar,
  point, tick and label is written once in terms of the two. `xAxis` is whatever runs along the
  bottom and `yAxis` whatever runs down the left, so the two swap *roles* rather than names, and
  `ChartAxis.kind` is what the view reads to know which one carries the gridlines. The test is that
  the bar count and the ratio of two bars' lengths are identical either way round.
- **A label that will not fit is dropped, and the rank decides which.** Every label is *offered*, and
  `flush()` places them lowest rank first — ticks, categories, the legend, the hero, and last a
  direct value or a wedge's share — refusing any that would collide with one already placed. That is
  the doctrine's "never clip a label: measure first" turned into a mechanism, and it is what makes
  "no two labels overlap" an invariant of the layout rather than a hope about the data. A token is
  therefore exactly a size *and* a weight: the test measures the same font the layout did, or it
  reports collisions that never happened.
- **A value is never snapped to the grid, and a chart is where that first mattered.** `metric.grid`
  is where the drawing's *chrome* lands — `layoutChart` snaps the plot rectangle, the legend box and
  the hero, and nothing else — because a bar's cap, a tick's position and an arc endpoint are the
  data. Round a cap to the nearest 8px and a stacked chart stops claiming the one thing it claims,
  that a segment's far edge is the running sum. `test/chart.test.ts` holds that to a pixel.
- **`Math.max(...[])` is `-Infinity`, and a margin is a measurement.** Every widest-label figure in
  `layoutChart` is guarded by "is there any text at all" first: a chart with no `x` line has blank
  categories by design (`1…n`, drawn as blank ticks), and unguarded that spread makes the bottom
  margin negative and the plot taller than the item it is drawn in. The same guard is why a chart
  with no ticks — a pie — reserves no left margin rather than a nonsense one.
- **`w=`/`h=` are not in an item's `hash`, and a chart is the one type whose box changes its
  layout.** Without the box in the key a chart dragged wider is handed the layout it had at the old
  width, cached and correct-looking. `layoutKey(hash, theme, box?)` takes one and only `DiagramItem`'s
  chart branch passes it, so no graph item's cache moved. The box it passes is the *content*
  rectangle: `metric.chart.w`/`h` are the **item's** default box, and the frame's padding, header and
  rule come off it in the same arithmetic the size effect adds back on.
- **A framed chart is 169px shorter than its `h=`.** `frame.pad` twice, the header and the rule come
  off the item's box before `layoutChart` sees it, so `metric.chart.h`'s 320 is 151px of drawing the
  moment somebody writes a `title=`. Nothing is wrong with that — it is what `chartBox` computes and
  what the size effect adds back — but a chart *designed* at 320 comes out squashed, and
  `boards/reference/chart.board.md` is 420 for that reason.
- **Text never wears the series colour, and the halo is what makes that hold on three themes.** A
  tick is `muted`, a category and a legend row `slate`, a value and the hero `ink`; identity comes
  from the swatch. The one label drawn *on* a fill is a wedge's own share, and the answer there is
  `paint-order: stroke` with the **surface** behind it — not a fixed light or dark, because
  `paper-dark`'s hues are light and its ink is light too, so no single colour reads on both.
  `edge.labelHalo` could not be reused: three pixels sized for a 600-weight mono edge label swallows
  an 11px wedge label whole, so `metric.chart.labelHalo` is two and is a key of its own. A value on
  the paper wears none at all — a halo the colour of what is already behind it is a stroke around
  nothing.
- **The gap between two touching fills is the layout's, never a stroke.** A stacked segment arrives
  `fillGap` short at its near end and a wedge arrives inset by `sliceGap` at the rim, so the view
  draws neither a border nor a paper stroke: either would draw the gap a second time and double it.
  The doctrine's "gap and ring, never a border" is split across two layers, and the view's half is to
  leave it alone.
- **A pie shrinks to fit the label it is not drawing.** The radius has to leave room for the shares
  that go outside on a leader, and the first version reserved the widest label on the *chart*: one 6%
  sliver whose own label reads `Other 6%` cost the pie the width of the longest name on it, and a
  440px card drew an 88px pie. `outsideW()` measures only the slices actually going outside, at the
  radius being tried, which is why it is re-measured each pass.

Three more about the pointer — the pick and its controls meeting a model that is not a graph.

- **A picked series wears no handles**, because `growable()` is `hasGraph()` — see *Controls on the
  canvas*. `web --> mob` in a chart body is `E_UNKNOWN_KIND`, so a `+` there would break the thing
  it was pressed on. `sequence` falls out of the same predicate deliberately: it *has* arrows, but
  one is a message, and a plus that quietly said two people talk is a different claim from "a card
  beside this one".
- **A series' marks are one `<g data-dag-node>` and its labels are not in it.** SVG has no z-index, so
  the only way a wedge's share stays on top of the wedge beside it is to draw every label after every
  mark — which also keeps the group's box exactly what `placed.nodes` claims, and that is what a
  board link into `chart.web` lands on. `data-dag-title-of` is the consequence and the first title on
  the board drawn outside the thing it names: `Rename`'s `nameElement` looks *inside* the picked
  element for a `[data-dag-title]` and would have opened the box over the bars. It is deliberately
  **not unique** — a pie names a slice twice, its legend row and the share on its wedge — so
  `querySelector` takes the first in document order, which is whichever the layout offered first;
  both are that slice's name and both open the same box, and a test that wants one of them says which
  by class. And **the centre of a series' box is paper**: a `<g>`'s rectangle is the union of its
  marks, so a bar series spans the whole plot and its middle is empty air between two bars — nothing
  can click it, least of all Playwright, which aims at an element's centre. Every gesture reaches a
  series through a *mark*.
- **The panel shows a pick's label, its hue and its numbers, and leaves the rest out rather than
  showing it and ignoring it.** A meta is a second string the parser reads and never draws; a status
  or a flag is a *bare word in the position the values are read from*, so `done` on a `series` line is
  `E_CHART_VALUE` — the control would break the chart it was used on. The Values field is the run as
  the author wrote it (`valuesText`, the inverse of `setValues`, beside `rowLines` and for the same
  reason), and a slice's says `Value` and writes one, because a second would parse and warn
  `W_CHART_LENGTH` about a document the person is looking at. The item view is the one on the board
  whose controls write a **body** — Form, Stacked and Horizontal, Legend, Value labels, Unit, Min,
  Max and Categories are statements, not fence attributes, because the first decision above put the
  form in the body. A drag on a picked series or slice reorders it (`dragMode("chart")` is `"order"`), and
  `orderDrop` had to learn that `DECLARES` is per dialect: it scanned back for `participant|actor`
  only, so a series dropped on a leading half found nothing and went `toTop` — above the `bar` line,
  a data statement standing in front of the statement that says what shape the chart is.

`boards/reference/chart.board.md` is the fourteenth fixture — a grouped bar, a stacked horizontal one
with `values`, a three-series line with a gap and a written `min`, a five-slice pie, a donut with a
hero, and one untitled chart beside a note so the bare form is in the baselines too. Three
screenshots, and **every other baseline byte-identical**, which is what says the guard rewrite
changed nothing about how anything else is drawn. Two tests walking `boards/reference/` had a
`sequence` literal of their own and were what found the last of them: `parse-dialects.test.ts` called
`parseDiagram` on a chart and failed with "chart has no dialect", and `layout.test.ts` survived only
because `parseDiagram` returns `null` and a later filter dropped it. The first reference board of a
new non-`Graph` type is what finds the guards in `test/`.

A chart publishes no `data-dag-quality` and cannot: `scoreGraph` measures crossings and routes over
cards, and a chart has neither. `snapshot.mjs` prints `quality: not measured` under one, which is
expected rather than a gap.

## Getting around

Navigation is draw.io's and Excalidraw's. **The wheel moves the paper; ctrl (or cmd) and the wheel
zoom about the pointer.** The earlier code had it the other way round — defensible
on a canvas holding one graph sized to fit, wrong on a plane you travel across.

| Gesture | Does |
|---|---|
| wheel, or a two-finger swipe | move |
| shift + wheel | move sideways, for a mouse whose wheel has one axis |
| ctrl/cmd + wheel, or a trackpad pinch | zoom about the pointer |
| drag the paper | select what the rectangle crosses (`space V`); move, under the hand tool (`space H`) |
| **hold space or ctrl/cmd** and drag anything | move — items included |
| middle-drag | move, over an item, without a modifier |
| arrows · `F` · `+` `-` · `0` | move · fit · zoom · 100% — arrows nudge the selection instead when there is one |

The pan modifier is load-bearing rather than a convenience: a press on an item *moves the item*, so
on a full board there is no paper left to grab and the view could only be reached with the wheel.
`Viewport` paints `data-pan` on `.dag-viewport` while one is held and `Item` reads it back off the
nearest one — the same channel as `data-zoom`, for the same reason. As React state it would
re-render every item on the board twice per gesture, and `Item` is memoised, so it would have had to
become a prop threaded through `App` to be seen at all.

`data-pan` is the *cursor's* copy of that answer, not the authority. A modifier already held when
the window takes focus delivers no keydown, so `Item` reads `ctrlKey`/`metaKey` off the press as
well, and the press is what decides. Space has no equivalent — a `PointerEvent` does not report it —
which is the whole reason both mechanisms exist rather than one.

## Settings

What the *app* does, as opposed to what a board says. A board file is the document Claude reads and
every gesture on the canvas is a write to it; these are the other thing — preferences about this
window that no board should carry. `src/settings/store.ts` owns the keys, `Settings.tsx` the modal,
`tabs.ts` its tabs and `panes/` one file per tab. The gear at the
sidebar's foot or `ctrl+,` opens it on the last tab this browser had open, and the vault switcher's
*Vault settings…* on Vault.

| Group | Tab | Holds |
|---|---|---|
| Account | Calendar | the time zone times are shown and written in, where a week starts, and which kinds the calendar shows — the Calendar page's own switches, through one hook |
| | Shortcuts | the shortcut sheet's list (`ShortcutList`, one component in both places) |
| | Privacy | whether this install sends anonymous logs, where to, and what they hold — the server's answer, see *Logs* |
| | About | the build's `VERSION` and the server's |
| *the vault's name* | Preferences | the theme, problems, pasted images, and the quiz threshold (the person's, and says so) |
| | Vault | where it is, where its attachments go, whether a rename updates the `[[wikilinks]]` to it, the open board's unused images, and Close vault — never deleting the folder |
| | AI and agents | the prompt card's provider, model and thinking; how to reach this vault from the CLI and MCP |
| | Import and export | the export's PNG detail, paper and margin, where importing is, and the largest attachment and its types this server takes (read-only) |

The *Account* group keeps its name for what it now means: the person's, in every vault, kept in the
app's home. There is no account to sign into.

Four things about the modal are load-bearing:

- **It is over everything, in a portal on `<body>`** at z-index 50, the sidebar dimmed under it. The
  card it replaced sat inside the page and left the sidebar live beside it. A delete question asked
  from inside it sits above it, at 60 — which is where `.dag-purge__scrim` had
  always claimed to be and never was (see *Things that will bite*).
- **It owns every key aimed at it.** It handles Escape and `ctrl+,` itself, walks its tabs on the
  arrows (`stepTab`), keeps Tab inside, and stops every other key at its edge; and `useEditor`, whose
  window handler runs first in the capture phase, returns on any key whose target is inside
  `[data-dag-settings]`. Without the second half, a click on a blank part of a tab left the focus on
  the modal rather than on a control, and a Delete pressed there deleted the board's selection behind
  it — which the old card could do too.
- **Every control saves as it changes, on every tab**, and each tab's Reset resets what that tab
  shows and nothing else (`resetSettings(only)`). The attachments folder, the one text field, saves on
  Enter or when it is left; Escape with a change in it takes the change back, and the next closes.
- **The tab is this browser's** (`dag:settings-tab`, written with `writeLocal`, never synced) and a
  request that names one wins. `dag:chrome` carries `{ what, tab? }` (`src/ui/chrome.ts`). Under
  720px the modal is the window: the tab list, then one tab with a back arrow.

Everything below is from the card's first version, and still holds of the tabs that carry it.

**It exists because of a defect with no setting behind it.** A pasted screenshot looked soft, and the
obvious explanation — compression — was not the cause and never had been: `onPaste` reads the
clipboard with `FileReader`, `/asset` decodes the base64 and writes those bytes, and no
decoder, no `sharp`, no `toDataURL` quality argument and no max dimension exists anywhere between the
two. What did exist was **a literal `w: 520` in both `onPaste` and `importFiles`**, and
`.dag-image img` is `width: 100%` — so a 1002-pixel capture was drawn into a 520-pixel box, 52% of its
pixels, and then resampled again by whatever the board's zoom was. A "quality" slider would have been
a control that changed nothing, which is the thing this codebase refuses most often. `src/edit/image.ts`
is the arithmetic that replaced the literal.

Six things are load-bearing:

- **`?snapshot=1` reads no preference at all** — not `dag:settings`, and not
  `dag:theme` either. `scripts/snapshot.mjs`, `scripts/tidy.mjs` and every Playwright check open a
  board that way, and a picture of a board must be a fact about the board rather than about whoever
  last opened it on this machine. The guarantee held **by accident** at first, because a fresh
  browser context has empty storage; a person pointing the snapshot script at a persistent profile
  got their own theme in the picture and nothing said so. `readSettings()` and `useTheme`'s third
  argument are the mechanism. The query is read *per call*, never cached at module load: `App`
  rewrites it with `replaceState` as boards and pages are opened.
- **A setting is read at the moment of the gesture, never threaded through `Item`.** `readSettings()`
  is a plain function called inside `onPaste`, `importFiles`, `exportAs` and the toolbar's per-item PNG.
  `useSettings()` — a `useSyncExternalStore` over a `dag:settings` window event — exists for the two
  places that *show* a value: the dialog, and the Export menu's caption, which has to say
  `Board as PNG (3×)` the moment the scale is three. `Item` is memoised, and a preference reaching it
  as a prop would re-render every item on the board when somebody changed the export scale. The hook
  caches its snapshot because `readSettings()` parses a string into a fresh object every call, and
  `useSyncExternalStore` compares by identity — uncached, it re-renders forever.
- **The placement rule is the setting; there is no compression to reduce.** `screen` (the default) is
  `naturalWidth / devicePixelRatio` — the size it was on the screen it came from; `pixels` is its own
  pixels, for someone who wants a 2× capture sharp at 50% zoom; `width` is one fixed number, which is
  what the app did before. The floor is one grid step, so a 1×1 tracking pixel does not become an item
  too small to select. The fence still carries an explicit `w=`, so the *file* says what the image is
  and `flow.ts` never learns a preference exists.
- **`paste.maxWidth` is the only thing here that can lose a pixel, and it is off.** Over it, the image
  is resampled once through `createImageBitmap(file, { resizeWidth, resizeQuality: "high" })` and
  re-encoded — **as PNG, always**, because what lands on this board is a screenshot with text in it.
  **An SVG and a GIF are never resampled**: a vector has no pixels to lose and a canvas would drop
  every frame but the first. **And only a paste is**: an image imported or dropped from the computer
  is an attachment, kept exactly as it was uploaded, and the placement rule decides only its `w=`.
- **The theme `<select>` became the gear** — net zero in a row that was thinned deliberately. The
  theme keeps its own `dag:theme` key and its three sources in the same order (`?theme=` beats the stored
  choice beats the board's `theme:` beats the default): it is the one preference with a third source
  and its own test, and folding it into the object would be a migration for a key that is not wrong.
  Choosing a theme while a `?theme=` is present clears the query key, because choosing now is choosing.
- **The modal takes focus and owns its own Escape.** `typing()` in `useEditor` counts a focused
  `BUTTON`, `SELECT` or `INPUT` as somebody typing and leaves the keys alone — correctly — so the
  moment a person touches a control in the dialog the window's Escape chain can no longer see the
  key. The modal handles it and stops it, which keeps the chain's order intact: the innermost thing
  held is the first thing let go. It opens with the focus on its open tab, so its handler hears the
  key from the start; the window handler's `[data-dag-settings]` branch is what closes it when the
  focus has somehow left.

**Storage — on the Vault tab — is the one thing in Settings that is not a preference, and it is scoped to a board.**
Deleting an image item removed its fence and left `paste-<sha1>.png` on disk; nothing swept, and only
deleting a whole board took its `.assets/` with it. `unused` in `server/routes/files.ts` is the rule —
`GET /__board/assets/unused?name=` counts, `POST /__board/assets/sweep?name=` removes — over the
board's legacy `<name>.assets/` folder (new pictures live in `attachments/`, which a sweep never
touches), and three things about it are load-bearing:

- **Never on delete, and never automatic.** Undo here is a *version of the file*, so a deleted image
  is one ctrl+Z from being drawn again and a cut one is one paste from it. Freeing the bytes when the
  fence goes would break both. A sweep somebody asks for, twice, is the only safe shape.
- **Scoped to the open board, never the vault** — the same refusal `/rmdir` makes by not being
  recursive. A vault-wide button is one click that reaches into thirty boards, and the first
  version of the e2e check for it caught exactly that: run from a preferences dialog it would have
  deleted files out of every board in `boards/`, this repository's own included.
- **A file is kept if its *basename* appears in any board's text**, which is deliberately blunter
  than reading `src=` off a fence. A `src` is relative to the board's *directory*, so one board may
  legitimately name another's asset; a markdown item can embed one as `![](x.assets/y.png)`, which no
  fence attribute shows; and a saved component is a board too. A pasted name is `paste-<sha1:8>.png`
  and effectively unique, so the blunt test costs nothing and cannot delete something in use — which
  is the only error here worth being careful about. An empty `.assets/` directory is left where it
  is: a directory is not something anybody lost.

Names claimed, grepped first as this file has learned to: `dag-settings`, `dag-settings__*`,
`data-dag-settings`, `data-dag-settings-toggle`, `data-dag-setting-*`, and the storage key `dag:settings`
— and for the modal `dag-settings-modal*`, `data-dag-settings-tab`, `data-dag-settings-tab-button`,
`data-dag-settings-pane`, `data-dag-settings-group`, `data-dag-settings-view`, `data-dag-settings-back`,
`data-dag-settings-close`, `data-dag-vault-settings`, and the
storage key `dag:settings-tab`. `dag-settings__*` is also the vocabulary of other cards (the rewrite
dialog, the delete questions), so a change to one of its rules is a change to all of them.
The CSS is chrome and lives in `chrome.css`; nothing here wanted a `--dag-*`, which would have demanded
a key in all three themes for how wide a dialog is.

**Deliberately out**: a lossy quality slider (there is nothing to compress, and the content is text);
a config file the server reads (it would put a person's preference into every visual baseline, and
`src/board/` could not read one anyway); per-board settings (the file already says what it can, in
frontmatter and in `w=`); un-embedding the fonts from an export (the layout was measured against the
theme's face, so a file without it is a different diagram); and the window keys — the library and
the inspector's mode and width — which each have a control where they act. (There were five; the
board list's went with the column.)

## Prompt cards

A person describes a diagram and a model draws it where the description was. The card is
`src/render/PromptItem.tsx`, the gesture `ctl.generate` in `useEditor`, the edit it makes
`src/edit/generate.ts`, and everything that talks to a model is `plugins/generate/` — server-side,
plain Node, no `@/` aliases, called in-process by `server/routes/meta.ts`.

    ```prompt {#ask x=80 y=240 w=420 as=arch}
    A browser talking to an API that stores orders in Postgres.
    ```

`prompt` is its own item family (`PROMPT_TYPES`, beside `LINK_TYPES`) rather than a flag on `md`:
nothing in it is prose to render or DSL to parse, and the one thing that happens to it is that it
goes away. It is a fence all the same, so an unrun prompt survives a reload, is undone and copied
like anything else, and is in the file Claude reads. `as=` asks for a type; an unknown one is
`WB_BAD_AS` and dropped, so the card still runs and the model chooses.

Eight things are load-bearing:

- **The server writes nothing; the client commits the answer.** Undo here is a version of the file,
  and an edit the history did not make drops the stack. So `/generate` returns a draft, and
  `replacement()` turns it into one patch — insert right after the card, remove the card — which is
  one history entry. The answer took seconds, so it is applied to the board as it is *then*: a card
  moved meanwhile is replaced where it now is, and a card deleted meanwhile drops the answer.
- **The diagram takes the card's place in every sense the file states** — `x`/`y` when the card had
  them, and its page and group *as written*, not `item.page`, which is derived and says `page-1` for
  a card that never named one — **and not its width**: a card's `w=` is a text box's, and on a
  diagram `w=` widens the frame and leaves the content where it was. A diagram usually comes out far
  bigger than the card it replaces and may overlap what is beside it; `T` is the answer, and doing
  it automatically was left out because tidying a whole board nobody asked to have tidied is a
  bigger edit than the one requested.
- **The system prompt is files, never a string in code.** `docs/generate/guide.md` (the answer's
  shape, which type answers which question, the house rules), then `docs/dsl/common.md` and every
  cheat sheet — or only the one `as=` names — then the library, rendered, as the house idiom to
  copy. The grammar changes in the commit that changes the parser; a prompt that restated it would
  be the one copy nobody updates. About 50 KB with every type in, 13–23 KB with one. The guide's
  *Which type* table is a closed set and `test/generate.test.ts` holds it to `DIAGRAM_TYPES`.
- **The fix loop branches on codes.** Find the first diagram fence in the answer (unwrapping a
  reply fenced whole in ````markdown), check it with `parseBoard` and the dialect's parser — the
  *exact* text that will be inserted, with only the allowed attributes left on it — and if anything
  is wrong, send back every error and every *fixable* warning as `line:col CODE message` counted
  from inside the fence, and ask for the whole block again. Fixable is a word the model got wrong:
  an unknown icon, hue, attribute or row, a retired flag, a chart's length. `W_CHART_MANY` is a
  design choice and is not retried. The best draft wins — fewest errors, then fewest warnings — and
  a draft in the wrong type for an `as=` counts as an error, `EG_WRONG_TYPE`.
- **Where the diagram goes is never the model's.** The allowed fence attributes are `title`,
  `subtitle`, `dir`, `aspect` and `frame`, plus `w`/`h` on a `chart` or `sketch`, whose size is a
  choice; anything else a model writes — `x=`, `#id`, `page=`, `hidden` — is dropped before the
  check, not after it.
- **How hard the model thinks is the person's, not the machine's.** Settings → AI and agents offers
  `none · low · medium · high` beside the provider, and the level rides with the request — so trying
  `high` on a dense description is a select, not an edit to `.env.local` and a restart. It outranks
  `ANYDAG_LLM_REASONING`, because the environment is how this machine is set up and the select is
  somebody choosing now; `default` is a choice too, and means the model's own. **The level is passed
  through rather than checked against a list**: which levels exist is the model's business — Gemini
  3.8 Flash takes those four and refuses `minimal` in so many words, and that refusal is worth
  showing on the card. The server checks only the shape, because it ends up in a request body. For
  `opencode` it becomes a variant written `model#variant`, which is the *model's* vocabulary — GLM
  5.3 Flash has `low`, `high` and `max`, Kimi K3 only `max` — so `variantFor()` maps none and low
  onto `low`, high onto `high`, and the middle of the range is "say nothing".
- **A provider is a row in a table** (`providers.ts`), resolved per request from `.env.local` and
  the process environment, so a key added mid-session counts; in the desktop app the person's own key
  is kept in the OS keychain and never in a file anybody syncs.
  `GET /__board/llm` reports which could answer and why not, and never a key; the page names a
  provider by id. `ANYDAG_LLM_MODEL` is the default provider's model only — a Gemini name sent to Z.ai
  because somebody picked Z.ai in the settings card is the bug that rule prevents.
- **Two adapters and one interface.** `complete(messages, signal) → text`. HTTP is a bare `fetch`
  to `{base}/chat/completions` — no SDK — and scrubs the key out of anything a provider says back.
  **Gemini is sent `reasoning_effort: low`** (`ProviderSpec.defaults`): 3.x Flash thinks by default,
  and on a diagram the thinking is nearly all of the wait — one description took 42 s at the model's
  default, 14 s at `low`, 10 s at `none`, the same diagram each time, and round 2 came back ten for
  ten at `low` in 1.5–7 s. `ANYDAG_LLM_REASONING` overrides it; `default` sends none.
  The CLIs are `claude -p` and `opencode run --standalone`, each fenced off from the machine: see
  below for Claude and *Things that will bite* for OpenCode.
- **The route is the one here that spends money**, and the server's token and `Host` check are
  what keep a web page the person happens to have open from calling it. A description is at most 4000 characters, at most four run at once, each has a
  timeout (`ANYDAG_LLM_TIMEOUT`, 120 s), and the client going away cancels the call.

The card itself: its controls stop the press that would select and drag the item — the header strip
is what you grab it by — and its text is written through the editor under `body:<id>`, the key the
panel types under, a quarter of a second after the last keystroke. Its run state is its own
`useState`: `Item` is memoised and a generation in flight is nothing the board needs to know about.
An empty card that becomes selected takes the caret, which is why `add` and `place` do not open the
panel for one — the panel would take the focus straight back. `as` is in no hash and is added to
`Item`'s memo comparison, because the select draws it. Under `?snapshot=1` the card draws its
description read-only.

**`scripts/generate.mjs`** is the card without the card — the same route, the answer printed with
its attempts, time and every leftover diagnostic — and is how models are compared. The e2e spec mocks `/generate` in every check: what is under test is what the page does
with an answer, and a real model would make the suite slow, paid for and different every run.

**`claude` is the person's own Claude subscription**, through the Claude Code signed in on this
machine — no key anywhere in AnyDag. `claudeComplete` runs `claude -p`
in an empty directory with the system prompt as `--system-prompt-file` and the request on stdin, and
reads `result` out of `--output-format json`. In the desktop app it is the default when it can answer
(`ANYDAG_DESKTOP=1`, which the shell sets); elsewhere a person picks it. Five things bit:

- **`--bare` is the wrong flag.** It reads like "answer and nothing else", and it reads only
  `ANTHROPIC_API_KEY` — never the subscription's login — so the one run that should work is the one it
  refuses. `--safe-mode` is the isolation: no CLAUDE.md, skills, plugins, hooks or MCP, and the login
  untouched. `--tools ""`, `--strict-mcp-config` with no config and `--no-session-persistence` go
  with it; a real run sees no tool and about 900 tokens of context besides ours.
- **A refusal is JSON and an exit of 1.** Signed out, the CLI prints `is_error: true` with "Not logged
  in · Please run /login" in `result`, so the object is read before the exit code is, and that
  sentence is what the card shows.
- **A GUI-launched app has no login shell's `PATH`**, so `~/.local/bin`, where the installer links
  `claude`, is usually missing from it. `findClaude` asks `ANYDAG_CLAUDE_BIN`, then `PATH`, then the
  installers' places. "Signed in" is `claude auth status`, 0.2 s, remembered a minute when yes and
  three seconds when no. **The Assistant finds both CLIs the same way** (`findClaude`,
  `findOpencode`), and its picker asks the same readiness: it used to look on the `PATH` alone, so a
  desktop app started from a menu drew prompt cards with Claude Code and said the Assistant could not
  find it.
- **The child's environment is cleaned** (`claudeEnv`): an `ANTHROPIC_API_KEY` in the server's would
  bill that key instead of the plan, and `CLAUDECODE` from a dev server started inside a Claude Code
  session makes the child think it is nested.
- **`ANYDAG_LLM_MODEL` is read against the provider the environment named**, never the desktop's
  implicit Claude: a Gemini model name is not one Claude Code knows. The models are its aliases
  (`sonnet`, `opus`, …), so the row does not go stale with a release; Thinking maps onto `--effort`,
  which has no `none`, so none is `low`. A diagram came back clean on the first attempt in about four
  seconds at both.

**`opencode` is the person's own OpenCode login** the same way — OpenCode Go, or any provider they
connected with `opencode auth login` — through `opencodeComplete`, and in the desktop app it is the
default when Claude Code cannot answer and it can. OpenCode **2 or later**: the run is the five things
in *Things that will bite*, and four more are this row's.

- **"Ready" is three questions, each answered by the CLI in well under a second**: found
  (`ANYDAG_OPENCODE_BIN`, `PATH`, then `~/.opencode/bin` and the shared installers' places — mise's
  shim among them); new enough (`opencode --version`); and signed in **to the provider the model
  names** (`opencode auth list --format json`), so `anthropic/…` on a machine signed in only to
  OpenCode Go says so in the settings card rather than on the card after a run.
- **A refusal is an event and an exit of 1** — `{type: "error", error: {message}}`, "Variant
  unavailable for opencode-go/kimi-k3: high", "Model unavailable: …" — so the events are read before
  the exit code, and that sentence is what the card shows.
- **The request is on stdin**, as Claude's is, and the run has `ANYDAG_LLM_TIMEOUT` too; 1.x took it
  as the last argument and had neither.
- **The environment is cleaned** (`opencodeEnv`): the server's token, and `OPENCODE_CONFIG` or
  `OPENCODE_CONFIG_DIR`, which would load a config beside the one handed to it.

**Deliberately out**: more than one item per card; streaming the answer into the card (a
half-written fence is nothing the parser can show); and OpenCode Go over HTTP, for the reason in
*Things that will bite*.

**Board context is not the card's job, and the answer is next door.** A prompt *card* still sees
only its own text and type — it is drawing something new, and there is nothing around it to know
about. Editing the diagram *beside* the card is a different gesture with a different answer: the ids
come from the board, not from the model. See *Prompt to edit*.

## Prompt to edit

A prompt card draws something **new** and disappears. This is the other half: select a diagram that
is already on the board, press ✨ in the selection toolbar, describe the change in the dialog it
opens, and a model rewrites that item in place. *"Make the cache
a Redis cluster"*, *"split the API into two services"* — all of which meant opening Source and typing
DSL by hand.

It is the same route (`POST /__board/generate`), which grew a `source`: the existing fence body. With
one, the run is a **rewrite** — a different user turn, a rewrite section in the system prompt, and
a `from` naming the item's type now. It used to send `as` instead, pinned to that type, on the
argument that `EG_WRONG_TYPE` then guarded type drift for nothing; what it guarded was the one
rewrite with no other route, and *"use another diagram type"* failed on every attempt.
`from` tells the model what it is changing from and forbids nothing: every grammar is in the system
prompt, the model keeps the type unless the change asks for another, and the answer is judged with
no `as`. It is a type word or nothing — the server drops anything else rather than quote it into a
prompt.
`SOURCE_MAX` is 16 000 and separate from the description's 4 000: a legitimate diagram body can
exceed a cap calibrated for "longer than anyone types". The provider table, both adapters, the caps,
the timeout, the cancel-on-disconnect and the fix loop are all untouched.

Six things are load-bearing:

- **`extract()` takes the *first* diagram fence, and in rewrite mode that is a defect with no
  symptom.** A model asked to rewrite often quotes the original before its corrected version, so the
  first fence is the *original* — which then checks clean, ends the loop on attempt 1, and silently
  replaces a diagram with itself. Rewrite mode takes the **last** fence, and refuses a draft
  byte-identical to the source outright. Both, because the last-fence rule is a heuristic and the
  echo check is the thing that actually holds. A live model walked straight into it: asked to return
  a diagram unchanged, it echoed, was refused, and came back changed on attempt 2.
- **The landing is one `SetOp`, never `replacement()`'s insert-and-remove.** `SetOp`'s own doc
  comment already made the argument for Convert: remove-and-insert costs a new id, which loses the
  selection, every link that named it, and the item's place in the file. Keeping the id *is* the
  whole of link safety. Several items would be one `SetOp` each in a single `commit`, which is what
  makes it one undo entry — `remove` and `restack` are the existing shape.
- **What the model may write is the item's, not its own.** `rewriteOps` merges only the allowed
  fence attributes and never `x`, `y`, `page`, `group` or `id`. With nothing to merge it
  omits `attrs` entirely rather than sending `{}`, which would still trip `applyPatch`'s
  anonymous-id pinning — a file change the rewrite did not ask for. **`type` is written when the
  draft's differs**, through `SetOp.type` as a Mermaid conversion is, so the id and every link
  naming it survive a retype; and `retyped()` takes off what only the old type meant — `layout=fixed`,
  whose coordinates the new body does not carry, and a chart's or a sketch's `w=`/`h=`, which on
  any other type widen an empty frame.
- **A dropped id removes the whole curve, not half of it.** `resolveLinks` pushes a link only when
  *both* ends resolve, so a rewrite that loses a referenced node makes a line vanish rather than
  dangle, which is far harder to notice. `src/board/survive.ts` answers which ids something else
  points at would stop existing, and `nodeIdsOf` was **lifted out of `resolveLinks`** rather than
  written twice — a second implementation that disagreed one parse later is the failure the module
  exists to prevent.
- **The preview is the item itself.** Nothing rendered a diagram from text that was not the board
  file, and nothing needed to: `Item` takes a `BoardItem`, so `App` substitutes a shallow copy
  carrying the draft's body — and its type, less what `retyped()` would take off — and the parse,
  the layout and the render run on it unchanged. `proposedItem` sits beside `rewriteOps` so the
  preview and what Accept writes are one rule. Its `hash` is rebuilt, or the layout cache hands back
  the old drawing. Not under `?snapshot=1`: a screenshot is a fact about the file.
- **Accept can be refused, and the proposal survives it.** A write against a version that moved
  answers `false`; clearing the preview then would take a draft that cost seconds and a paid call
  with it and say nothing. The proposal stands with the reason beside it.

**A rewrite that changes nothing cannot be asked for**, and it falls out of the echo rule — the model
invents a change on the retry rather than standing its ground. The right failure for a route whose
purpose is to change something, and a real edge all the same.

**Deliberately out**: rewriting more than one item at once — what one instruction means across three
bodies is a design question, and it is refused with a reason rather than half-done; and letting the
model rename an id, which `renameItemId` could carry across the board's `edges` fences but which
nothing yet asks it to.

## The sidebar

`src/ui/Shell.tsx` and `src/ui/Sidebar.tsx`. A column the full height
of the window: the lockup beside the toggle, the vault switcher, then Search, Tasks, Calendar, Quizzes and
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
window, and the home screen when nothing is open. From 720px it docks, and its
default width gives way to a quarter of the window, never under 232px, which is what a 929px laptop
window had room for and could not keep. A width somebody dragged is theirs up to half the window and
640px: under the quarter rule the grip on that same window moved nothing at all.
`data-sidebar-sized` on `.dag-shell` (React's) and `data-sidebar-dragging` (the grip's, for the length
of a drag) are what switch `--sidebar-cap`. It is open by default,
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
- **Every file operation lives here and only here.** A row's `⋯`, a right-click and `shift+F10` open
  one menu; a folder's `+` makes things in it. The search dialog carried the same four operations on
  hover icons, and a control in two places is two places to keep in step, so it lost them.
  `Delete` is deliberately not a key: undo is a version of a board's *text* and never reaches the
  file.
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
  a file nobody titled, and the rows sort by what they say. With the column put away, it floats
  over the page to ask.
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
  files…* from *Nothing here yet*; `fresh` says the server has answered on this page load, and only a
  fresh list resolves an id to a name, because a kept one may name a file that has moved since.
- **A drag carries a chip, and the tree scrolls under it**. On the first move a
  `.dag-sidebar-ghost` — the row's mark and name, or *N items* — is put on `<body>` and moved by a
  painted transform, `pointer-events: none` so `elementFromPoint` still finds the row; the rows it
  lifted wear `data-dag-sidebar-lifted` and fade. A pointer within `GLIDE_EDGE` of the tree's top or
  bottom scrolls it on a frame loop, faster the closer, and aims again after every frame that moved,
  since what is under a still pointer changed. A folder move says *Moving “name”…* under the tree
  while it runs and the server's reason there when it is refused.

Names claimed, grepped first: `dag-shell`, `dag-sidebar*`, `data-dag-sidebar*`, `data-dag-crumb`,
`dag-toolbar__crumb*`, the storage keys `dag:sidebar`, `dag:sidebar-w`, `dag:sidebar-open` and
`dag:favourites`, and the event `dag:chrome` — and for the folder-delete modal `dag-purge*`, `data-dag-purge*`
and `data-dag-sidebar-dialog` — and for the drag ghost and the cached list `dag-sidebar-ghost`, `data-dag-sidebar-ghost`,
`data-dag-sidebar-lifted`, `data-dag-sidebar-loading`, the storage key `dag:file-list` and the event
`dag:follow`. The retired `dag-sidebar__*` of the old board-list column
survives only in a comment in `chrome.css`. The sidebar's rows are deliberately **not**
`data-dag-board` or `.dag-board`: the search keeps those, and `boards.spec.ts` counts `.dag-board`.

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

Names claimed, grepped first: `dag-sidebar__bulk*`, `data-dag-sidebar-bulk*`, `data-dag-sidebar-picked`
(and `data-dag-bulk-delete*`, gone with its modal).

**The suite runs with it put away.** `e2e/global-setup.ts` seeds `dag:sidebar=0`, because a column
open by default would move the canvas under every check that measures `.dag-viewport`, for a reason
none of them is about. `sidebar.spec.ts` clears the key and checks what a person sees, and
`e2e/sidebar.ts` docks it for a check that needs a row.

**Out, and why:** a manual order within a folder (nothing stores one); pages
inside pages; titles instead of names (`/list` carries names alone); Recent.

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

### Nothing open

**The app used to open a board nobody asked for.** `boardName` was `?board=` *or `boards[0]`*, so a
cold load landed on whichever file sorted first — a reference fixture as often as not — and the
only signal that this was an accident rather than a choice was not recognising it. It is
`query.get("board")` now, and `src/ui/Welcome.tsx` stands where the fallback did: an empty board,
with **Start drawing** (which makes one, because there is nothing to draw *on* until one exists)
and **Open a board**. The layer is `pointer-events: none` and the card turns it back on, so the
paper behind it still pans and zooms — an invitation, not a gate.

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

## Icons

Four vocabularies, one attribute. `icon=server` is a Lucide glyph for a *kind*; `icon=postgresql`
is the brand in its own colours; `icon=mono:postgresql` is the brand as a silhouette wearing the
node's hue; `icon=aws:lambda` is a cloud service; and `icon=emoji:house` is a picture — every
Unicode emoji, Fluent's, loaded on demand, `mono:emoji:house` in the hue (see *Pictures*).
`icons/README.md` is the full account — read it before touching anything under `icons/`.

Five things are load-bearing:

- **The art is fetched when something draws it; the names are always there.** `src/render/art.ts`
  loads four files on demand — `icons.json`, every Lucide glyph, and the emoji's two cuts — and
  `src/render/icon-index.ts` (generated, about 60 KB) holds which names each set has, so `iconFor`
  still decides synchronously and `DiagramItem` holds `data-dag-ready` until the files its model
  draws from have landed. The page's first chunk was 4.1 MB (1.2 MB gzipped) while the logos and
  `import * as icons from "lucide-react"` were in it, and is 0.9 MB (0.3 MB) without them. Every pack
  is still all there for the library, the picker and the drawing. The chrome's own glyphs stay named
  imports. `check-icons.mjs` holds the index to the bundle and to the installed `lucide-react`.
- **The artwork lives outside `src/` because `check-literals.mjs` scans `src/` for colour.** A brand
  logo is nothing but colours the theme does not own, so `icons/data/*.json` is data the renderer
  imports rather than style, and the no-colour rule survives intact instead of gaining an exception.
- **A brand mark is drawn unmodified, and that is a licence constraint as much as a design one.**
  Azure's terms say "don't distort or change icon shape in any way"; AWS's own redistribution is
  CC-BY-**ND**. Tinting a vendor icon through `hueVars()` would be a derivative work — so `brand` is
  a separate mode with a neutral tile and the hue moved to the card border, and the design decision
  and the licence agree. `mono:` is CC0-only for the same reason. See `icons/NOTICE`.
- **`replaceIDs()` runs per rendered instance, never at build time.** 998 of the 1140 colour marks
  carry a `<linearGradient>` or `<mask>` whose id is fixed in the data, so two Azure cards on one
  board would both define it and the second would resolve `url(#…)` to the first one's element.
  Worse, 84 ids are shared across *different* icons — `azure:intune`, `azure:intune-app-protection`
  and `azure:intune-for-education` ship the same three gradient UUIDs. Prefixing per icon at build
  time fixes only the second case; per-instance replacement at the mount point fixes both, and is
  also what makes an exported standalone SVG internally consistent.
- **`brandTile` is a light surface in every theme, dark ones included.** Brand marks are drawn for
  light backgrounds; on the dark theme's own `paper100`, Express vanished completely and Vercel's
  triangle was a shape you had to hunt for.

Two smaller ones. The build prefers a `-icon` sibling over a wordmark — `logos` ships `docker` as
the whale *beside the word*, and at 8.8:1 `anthropic` printed straight across the card it belonged
to. And a brand beats a Lucide glyph where both claim a name; `check-icons.mjs` prints that overlap
(five names today) on every run, because the day a sixth arrives some board's concept glyph silently
becomes a logo.

`npm run icons:build` regenerates `icons/data/*`, `src/dsl/icon-names.ts` — the DSL needs the
name list to report `W_UNKNOWN_ICON`, and it is the one layer that must stay loadable by plain Node —
and `src/render/icon-index.ts` (`scripts/icons/index.mjs`, also runnable alone).

**The vocabulary has a route: `GET /__board/icons`.** `/dsl` serves the grammar and `/library` the
parts; this is the third thing an agent cannot invent, because `ICON_NAMES` was read only by the two
validators that use it to say no — `dbt` and `gcp:bigquery` both exist and nothing outside one
person's memory said so. The payload is `{ icons: [{ name, mode }], total, returned, truncated }`,
where `mode` is what the name resolves to — `brand` (own colours, neutral tile), `mono`
(silhouette, inherits the hue) or `concept` (Lucide, `currentColor`) — which is not inferable from
the spelling and is what decides how it draws. `?q=` narrows by substring before ~2,900 names have
to travel, `?mode=` to one way of drawing, and a truncated answer says so (`total` versus
`returned`) rather than reading as the whole set; no SVG bodies, it is a vocabulary not artwork.
`plugins/icons.ts` derives the modes from the bundle's own maps in `iconFor()`'s order — alias,
colour, silhouette, concept by elimination — instead of restating them, so the route and the
renderer cannot disagree. `W_UNKNOWN_ICON` suggests on the same principle the other closed
vocabularies do (`src/dsl/suggest.ts`'s `suggestIcon`): `icon=postgre` names `postgres`, a
`mono:`/`lucide:` prefix rides back on the suggestion, and a small alias table answers the words
edit distance cannot reach — `lambda` → `aws:lambda`, `py` → `python` rather than `pg`.

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
| `space P`, or the library's *Generate* | a new `prompt` fence, `w=420`, with the caret in it |
| typing on a prompt card · its type select | the card's body, under `body:<id>` · `as=` on its fence line |
| Generate on a prompt card, or ctrl+Enter in it | the card replaced by one diagram fence at its `x`/`y`, page and group — one commit, so one ctrl+Z brings the card back |
| a prompt card's Insert anyway | the same, with a draft that still has errors, to be fixed where it lands |
| an image pasted or imported | `w=` from the placement rule — its size on screen by default, not a fixed width — and `page=`, the page it was pasted on |
| the Settings modal (the gear at the sidebar's foot, or `ctrl+,`) | nothing in the board: a preference is not part of what a `?board=…` link means |
| Settings → Vault's Unused images, then its confirm | the files in *this* board's legacy `.assets/` that no board's text names — never another board's, and never the directory |
| a diagram's two side handles | `aspect=` — the shape ELK folds to — and `w=` removed |
| a second click on a card, once its diagram is selected | nothing: a pick is not an edit |
| a click on an edge's line inside a diagram | nothing, likewise |
| Delete on a picked card | its statement, its `{ }` block and every edge that named it, gone |
| Delete on a picked edge | that whole statement's line gone — a chain goes as one |
| ctrl+D on a picked card | the statement again below itself, under an id nothing else uses |
| the properties view's kind, title, swatches, **B** / **I**, meta, description, flags, status and icon | that one line of the pick's statement, through `src/dsl/restate.ts` — the colour and the emphasis first, which is what somebody reaching into a card came for |
| the same controls on an item that is one bare node | that node's line, not the fence: a frame has no fill, no kind and no icon to wear |
| the item view's Advanced disclosure | page, title, subtitle, direction, header, hidden, id, Detach / Re-layout — shut until asked for, and shut again on the next item |
| its rows list: an edit, a remove, "add a row" | `setRow` / `removeRow` / `addRow` on one line of the pick's `{ }` block |
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
  take a lock between them, so refusing a stale write is the entire concurrency story.
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
  A row sharing its line with a brace is not listed, for the reason `setRow` refuses one: `{ id
  uuid pk; slug text }` is two rows on one line and a line number cannot say which.
- **The strings are read through the tokenizer, not off the line.** A regular expression for quoted
  text also matches `icon="two words"` and shifts every slot along by one; `textSlots`' rule is the
  *consecutive* run right after the id, and the panel reads the same run the writer writes.
- **The arrow menu is the tokenizer's own `ARROWS`,** plus whatever is on the line in case it is not
  in it. The ER cardinalities are matched structurally there rather than enumerated — sixty
  spellings would be sixty typos — so a menu built from the table alone would silently drop
  `}o--||` the moment somebody opened it.

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
| `sequence` | a participant header across its neighbour → its `participant` line moves | `moveStatement` |
| `chart` | a series or slice across its neighbour → its line moves, which is the order of the bars, the wedges and the legend | `moveStatement` |
| `timeline` | sideways → a new start date, snapped to a day, the range keeping its length | `redate` |
| `sketch`, any `layout=fixed` fence | anywhere → `x=`/`y=`, snapped to `metric.grid` | `setGeometry` |
| `gitgraph` | nothing — refused | — |

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

Two refusals with reasons. A **`gitgraph` commit** cannot be dragged: a column is a commit and a
lane is a branch, both ordinal and both the file's, so there is no drop that means anything and
inventing one would be a gesture that silently rewrote history. The cursor says `not-allowed` and
the panel carries the line. And a **sequence message** cannot be dragged either, by construction
rather than by a rule: only a participant header carries `data-dag-node`, so a message can never be
picked in the first place.

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
  remembered in a browser must not change what a screenshot shows.
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
`GET /__board/library`, the MCP `library` tool and `anydag library` — leaves the 1,724 pictures out
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

### Import and export

`src/export/` grew two files beside `svg.ts`: `png.ts` rasterises an SVG through an `<img>` and a
canvas, and `save.ts` hands the browser a file. `boardToSvg()` is the board-level export — one
`<foreignObject>` per item at its board position, the paper as a `<rect>`, the fonts once. Import
lives in `useEditor.importFiles()`, reached by a file drop on the board or Import in the dock's `⋯`.

**Export is at the end of the top bar** — `src/ui/Export.tsx`, on a board and
on a note — and not in the `⋯` any more: it was found there by nobody, and a note has no dock. A board
saves as SVG, as PNG at the export scale the menu states, or as its `.board.md`;
a note as **a PDF** or its `.note.md`. Four things about the PDF:

- **It is the browser's own print** (`src/export/print.ts`, `printAs`; Electron's `printToPDF` in the
  desktop app), which is the only way a page can make a PDF whose text is text. The title is the document's for the length of the dialog,
  because it is what the dialog offers as the file name.
- **What is printed is the file, drawn read-only** — `NotePrint` in `src/view/`, `react-markdown`
  with the embeds and references `?view=1` draws, and the frontmatter's title as its first line,
  since on screen the title is in a top bar paper does not have. Never BlockNote's DOM, which is an
  editor's: handles, placeholders, a caret. The text comes from `NoteView`'s `handle`, after a
  pending save has been sent, off the editor's blocks — so a save that could not land still exports
  what the person was looking at.
- **It is paper, so it is light.** `paperTheme()` is the screen's theme when that is light and the
  default otherwise, applied to the sheet's own element — `applyTheme` takes one — so the app behind
  keeps its own. The dark theme shares the default's metrics, so nothing is measured twice.
- **It prints once it is drawn**, and gives up waiting at twenty seconds rather than never printing.
  Laid out but hidden at 170mm — inside A4's margins and Letter's — so an embedded board is fitted,
  once, to the width it prints at; `content-visibility` is off inside it, because it is never on the
  glass.

`anydag note export --format pdf` is the same sheet through Chromium's own PDF writer: the note page
answers `dag:export` with `kind: "pdf"` by setting the sheet out and replying with its title once it
is drawn, and leaves it up for the script to print. Names claimed, grepped first: `dag-export*`,
`data-dag-export-menu`, `data-dag-export-as`, `data-dag-export-failed` — and `data-dag-export`
itself, which was the `⋯` menu's `<select>` and is the button's hook now — `dag-print*`,
`data-dag-print`, `data-dag-printing` and `data-dag-embed-ready`.

Two things that will bite:

- **An SVG with `<foreignObject>` must reach the canvas as a data URL.** Loaded from a blob URL,
  Chrome taints the canvas it is drawn on and `toBlob` throws `SecurityError`; the same bytes as
  `data:image/svg+xml;charset=utf-8,…` draw clean. Every HTML-to-image library does the same,
  and this is why.
- **`dragover` has to be cancelled**, or the browser opens the dropped file itself — and only over
  the board, so a drop on the chrome around it still does nothing.

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

## Diagnostics

Every diagnostic carries a stable `code` from `src/dsl/codes.ts` as well as a message. **Branch on
the code**; the message is written for a person and may be reworded. `E_`/`W_` is the diagram DSL,
`EB_`/`ANYDAG_` the board file around it — which is what distinguishes the two grammars that can both
report "unterminated string" — and `EG_` what the generator says about a model's answer to a prompt
card, which may parse clean and still be wrong (`EG_WRONG_TYPE`). None of them is drawn on the
canvas — see *Problems* for where a person reads them. `GET /__board/diagnostics?name=` is the same
parse, server-side, through the same `diagnoseBoard` the page's dock calls, and `anydag snapshot`
prints it. The
three `EB_LINK_*` codes ride in `board.errors` and reach that endpoint with no change to it, and the
five `*_CHART_*` codes are the only family named for a dialect — everything else `parseChart` raises
is one of the shared ones, which is what says the statement shape really was inherited.

**A diagnostic is only as good as the mistake it names**, and for a long time these named symptoms.
Six lines of Mermaid pasted into an `arch` fence came back as sixteen errors, not one of which
contained the word "Mermaid"; `database pg "Postgres"` came back as five, not one of which contained
the word "kind". Four things now stand between a wrong word and that:

- **`E_UNKNOWN_KIND`.** `word word` is a node declaration and can be nothing else — an edge's second
  token is an arrow, a `&` or the `.` of a row ref. So a leading word that is not a kind is knowable
  rather than a mystery, and the message carries the dialect's whole vocabulary and a suggestion.
- **`E_MERMAID_SYNTAX`** (`src/dsl/mermaid.ts`). Sniffed before the tokenizer, because the tokenizer
  has no way to say this. A *header* — `graph LR`, `erDiagram` — means the block is another language
  end to end, so it replaces the parse rather than joining it; an inline habit (`A[Label]`, a piped
  edge label, `subgraph`) is reported where it is and parsing goes on. Its patterns are anchored to
  statement start on purpose: brackets are not foreign here (`list[str]`, and every node with rows
  carries `{ … }`), and an unanchored match fires on two of the reference boards.
- **`ctx.broken`.** An id whose declaration was rejected does not then phantom as `E_UNKNOWN_ID` on
  every correct line that names it. One wrong word costs one error, however much depends on it.
- **`tidy()`.** Sorted by line — `resolveRefs` appends, so the list used to arrive out of order —
  deduped, and stripped of the symptoms on any line whose cause is already named.
- **`W_UNKNOWN_ATTR`.** `modifiers()` swallowed every unknown `key=value` into `extra` and said
  nothing, so `colour=red` produced no diagnostic, and an `x=` on a node the layout places was
  read, kept and ignored. It now names the keys the dialect knows — and, for a coordinate, says
  `layout=fixed` and `sketch`, which are the two things that make it mean something. See *The free
  canvas*.
- **`W_UNKNOWN_HUE`.** `hue` was always a *known* key — `modifiers()` read it straight into
  `Node.hue`/`Edge.hue` — so `W_UNKNOWN_ATTR` never caught it: `hue=purple` on a node, a group, a
  lane or an edge was read, kept, and handed to `hueVars()`, which bound `--dag-h`/`--dag-t` to a CSS
  custom property nobody had set. That is worse than the value being ignored outright — no colour
  appeared, no diagnostic said why, and the one clue was a card that looked like it had inherited a
  hue it had not asked for, anything but silent. The value is dropped rather than kept: the card
  falls back to what it would have had with no `hue=` at all, and the message offers the close
  match a table already has for `icon=` and node kinds — `purple` → `did you mean violet?` — against
  the ten names in `HUE_ORDER`.

`src/dsl/suggest.ts` is the "did you mean". Edit distance catches typos; a table catches the rest,
because the mistakes that matter here are semantic, not typographic — `database` is *six* edits from
`db`, further from the right answer than from every wrong one, and it is the word a model reaches
for. Every entry in that table would be unremarkable in any other diagramming tool.

**That is all about the *text* of a board.** What is wrong with the *drawing* is a different phase
and a different vocabulary: `Q_` codes in `src/quality/codes.ts`, found by measuring a layout rather
than by parsing anything. They carry no line — no character in the file is responsible for where
ELK put three cards — and no severity, because every one of them is advisory. A `usecase` diagram
is a dense bipartite graph and some of its edges will cross whatever anyone does; refusing to draw
it would be absurd. Each names the ids involved instead, which is the part an author can move.

Every graph diagram scores itself and publishes the result as `data-dag-quality`, and `anydag snapshot`
reads it back — **under `?snapshot=1` only**, which is how every reader opens a board: in
the editor the crossing pass ran after every layout for nobody. There is no server endpoint for it and there cannot easily be one: scoring needs a
layout, and a layout needs ELK, which reaches the page through `elk-worker.min.js?worker` — a
specifier only Vite can resolve. The page has the answer already, measured in the real webfonts
rather than the arithmetic stand-in the unit tests use, so it is also the better answer.

## The local server

`server/`. One Node process, Hono, answering every route the page, the CLI
and MCP call, from one or more vaults on this machine, and the grammar is a function call in it
rather than a service on another port (`server/grammar.ts`, `server/handle.ts`).

| Where | Owns |
|---|---|
| `server/main.ts` | `anydag serve <folder>`: bind `127.0.0.1`, mint the token, write `server.json`, print the URL |
| `server/app.ts` | the gate — the `Host`, then the token — which vault a request means, the routes, and the built page |
| `server/context.ts` | the `Session`: the open vaults, `?vault=<id>` through `AsyncLocalStorage`, so no route learned there is more than one |
| `server/vault.ts` | the store over a folder: every kind listed and foldered, names that are titles, ids in frontmatter, attachments, the watcher |
| `server/home.ts` | the app's home — `ANYDAG_HOME`, else the platform's data folder — and its `node:sqlite` index |
| `server/grammar.ts` · `grammar-worker.ts` | the grammar as function calls, its parse caches, and the worker the whole-vault parses run on |
| `server/routes/` | one module per family: documents, folders, files, meta, events, vaults, preferences |
| `server/mcp/` | the MCP server: `TOOLS`, each calling its route |
| `server/connect.ts` | how the CLI and MCP reach a server: `server.json`, or one in-process |

Seven things are load-bearing:

- **Nothing the app needs to be correct lives only outside the vault.** A document's id is `id:` in
  its frontmatter; an attachment's is `<vault>/.anydag/files/<id>.json`; a vault's own id and
  settings are in `<vault>/.anydag/`. The SQLite file in the app's home maps id → path, created,
  title and kind so the app, the CLI and MCP agree without walking the vault, and it is an index:
  delete it and the next open rebuilds it, losing practice records and nothing else. **SQLite is
  never in the vault**, because a sync tool copies a database while it is written.
- **Frontmatter wins.** Two files with one id — a copy made in a file manager — keep it for the
  older by created date, and the copy is given a new id, written into it. A file moved outside the
  app keeps its id and the index learns the new path from the watcher.
- **The token and the `Host` are the whole security model**, and both are checked on every request —
  see *Things that will bite*. `server.json` is written mode `0600`.
- **One server, several vaults.** Each vault has its own change feed, and `/__board/transfer` moves
  a document or a folder between two open vaults with its id and created date.
- **Nothing the store may do may block sync**: no single shared index file in
  the vault, `.git/ .stversions/ *.sync-conflict-* *.icloud .trash/` ignored, the sha1 base, the 409 and
  `merge3` kept, and opening never writes.
- **`/api/auth/me` answers the one local user, always.** The page's account context is a constant;
  there is no sign-in, no session, no share link and no feedback card. Logs are sent only once the
  person says yes — see *Logs*.
- **Generation is the person's key** (`plugins/generate/`): the prompt card's providers
  read it from the environment or `.env.local` in development and, in the desktop app, from the OS
  keychain through `safeStorage`.

`test/server/` is the store contract and the routes in vitest over a real folder and a real index.

## Vaults

A **vault** is a folder — Obsidian's word and Obsidian's model. The sidebar's first row
names the open one and opens the switcher: the recent vaults, *Open folder…*, *Create vault* and
*Close vault*. Settings → Vault says where it is, where its attachments go, and closes it.

| Route | Does |
|---|---|
| `GET /api/vaults` | the recent vaults, the open ones first |
| `POST /api/vaults/open` `{path}` · `/create` `{path}` · `/close` `{id}` | open a folder, make one and open it, close one — **never deleting it** |
| `POST /__board/transfer` `{name, kind, to}` · `{folder, to}` | a file, or a folder whole, to another open vault |

Six things are load-bearing:

- **Closing never deletes, and nothing in the app removes a vault's folder.** A vault is a folder
  the person already owns; the file manager is where it is renamed or thrown away.
- **A vault inside another is refused**, both ways: one file would be two documents with two
  owners, and the watchers would report every change twice.
- **An existing `.obsidian/` is never touched**, and every dot-folder is neither listed nor walked.
- **The page names its vault in its address**, `?vault=<id>`, pinned once at startup by
  `src/vault/current.ts` and carried on every request by a `fetch` wrapper, the `EventSource` and
  `<img src>`; a bare `/` resumes the vault opened last. **Switching is a page load**, so no
  subscription, cache or preference is left behind, and it happens once per page.
- **A vault's own preferences are `<vault>/.anydag/settings.json`** — the theme, the favourites, the
  attachments folder — so a vault opened on another machine looks the same; the person's own are the
  app's home's. `WORKSPACE_PREF_KEYS` is still the name of the split in `src/settings/`.
- **A file keeps its id across a transfer**, and a reference from a file left behind stops resolving
  there: an id resolves within its vault.

**Out, and why:** collaborators and permissions (a vault is a folder; a person shares it the way they
share any folder); references across vaults; and sync, which is the folder's — Syncthing, iCloud,
git — and which nothing here may break.

## Remote access

A **second door** onto the running server, for a phone (`server/remote.ts`; the plan and the
phases are `docs/remote-access.md`). The mobile app is a thin client: no vault on the phone, the
desktop must be running, and everything runs there.

| Where | Owns |
|---|---|
| `server/remote.ts` | the setting (`remote.*` in the home's `kv`), the `devices` table, pairing codes, `localOnly`, cutting a revoked device's sockets |
| `server/app.ts` (`door: "remote"`, `remoteGate`) | the remote door's gate: the `Host`, the setting, a device token or a code being spent |
| `server/main.ts` (`remoteDoor`) | the second listener: opened, moved or closed when the setting changes |
| `server/routes/remote.ts` | `/api/remote*` (the local door's) and `/api/device*` (the remote door's) |
| `server/tailscale.ts` | the `tailscale` CLI asked: this machine's tailnet address, whether `tailscale serve` passes it to the door, and `serve --bg` on a button |
| `src/settings/panes/Devices.tsx` | Settings → Devices: the switch, the address, Tailscale, a pairing code drawn as a QR code, the devices; on a phone, *this device* and Forget |
| `cli/commands/remote.ts` | `anydag remote status\|on\|off\|serve\|pair\|devices\|revoke` |

Nine things are load-bearing:

- **The local door is not widened.** The remote door is another listener with its own gate, on a
  fixed port (4319) so a phone finds it again — and it listens on `127.0.0.1` too: what a phone
  reaches is `tailscale serve` in front of it, which holds the certificate. A hosted bridge later is
  one more proxy of that kind.
- **The device token is the gate, the `Host` the defence behind it.** The remote door takes this
  machine's names and the host of `remote.url`, and never the launch token. A token is shown once and
  kept as its SHA-256.
- **Pairing is one code, 128 bits, five minutes, single use**; making one burns the last, five wrong
  tries burn it, turning remote access off burns it. A browser spends it at `/?pair=` for an
  `httpOnly`, `SameSite=Strict` cookie; the native app at `POST /api/device/pair`.
- **What only the desktop may do** — the `/api/remote` routes, opening, making or closing a vault,
  linking sync, answering the logs question — is a 403 `local-only` on the remote door, so a phone
  never pairs another phone or closes the door it stands in. A chat's `x-anydag-chat` there is a 400.
  The logs question is therefore not asked there: `GET /api/telemetry` answers `answerable: false`
  on the remote door, and a question a phone cannot answer is a modal it cannot close.
- **Revoking cuts now**: the device's next request is a 401 and every socket it holds — the change
  feed's included — is destroyed (`hold`, through `c.env.incoming.socket`). Off closes the listener
  and every connection on it.
- **The desktop starts the server with `--remote-page`**, `dist/` unpacked from the asar, because it
  serves the page itself and runs the server `--no-page`.
- **The page asks which door it is on with `GET /api/device`**, which is `{device: null}` on the
  local door: every `/api/remote` route is a 403 from a phone, and a 4xx is a console error the suite
  fails on. A browser that pairs by link is named from its `User-Agent` (`browserName`), never with it.
- **The QR code is a light theme's ink on its paper in every theme** — a camera reads an inverted
  code badly — drawn from `uqr` on the page, with nothing sent anywhere; `paperTheme`, not a literal.
- **Every route that serves vault bytes sends `fileHeaders`' guards** — a scriptless `sandbox` CSP
  and `nosniff`, and anything but a picture a download. `/__board/assets/*`, the legacy picture
  folders, sent an SVG bare: opened as a page on the remote door its script ran on the app's origin
  with the device's cookie and wrote to the vault, measured. A file is not a picture because of the
  folder it is in; a new route that serves bytes takes the headers too.

Names claimed, grepped first: the `x-anydag-device` header, the `anydag_device` cookie, the `pair`
query key, the `devices` table, the Settings tab `devices`, `dag-remote__*`, `data-dag-remote-*` and
`data-dag-setting-remote`.

**Out, and why:** read-only devices (not wanted yet); a door the server itself puts on a network
interface (a certificate this process would have to hold); working with the desktop off, which
the thin-client model rules out; and Tailscale's local API, when its CLI is the documented surface
and what a person would type.

## The desktop app

`desktop/`. Electron around the one server and the built page:
`npm run desktop:dev` runs it on a checkout, `npm run desktop:dist` packages it for the
platform it runs on (`desktop/package.mjs`) — an AppImage for x64 Linux, an NSIS installer for x64
Windows, a `.dmg` and a `.zip` each for arm64 and x64 macOS — and `npm run desktop:smoke` opens the
packaged app on a fresh vault, waits for `data-dag-ready` (`ANYDAG_DESKTOP_SMOKE=1`) and passes on
one printed line; `-- --dev` runs it on `desktop/dist/` instead, `-- --app <exe>` names another
build. `.github/workflows/desktop.yml` builds and smokes all three systems on a pull request that
touches the app — on macOS both architectures, the x64 one under Rosetta — and keeps what it built
for a week.
`check:case`, in the fast tier, refuses two tracked files that are one file on their case-insensitive
disks — `src/ui/trash.ts` beside `Trash.tsx` was, and an import of `./Trash` built Linux clean and
failed on both.

| Where | Owns |
|---|---|
| `desktop/main.ts` | the server child, the `anydag://` scheme, windows, deep links, the shim, the keys, updates |
| `desktop/preload.ts` | `window.anydagDesktop`: the folder dialog, reveal, the keys (written, never read), the page's write key |
| `desktop/build.mjs` · `electron-builder.yml` | the two CJS bundles; what is packed, and what is unpacked for the child |
| `desktop/package.mjs` | electron-builder for this OS: whether to sign, and the second macOS architecture's watcher |
| `desktop/smoke.mjs` | the packaged app's one check, on all three systems |
| `src/vault/desktop.ts` | the page's side of the bridge — every use optional, so a browser on `anydag serve` works without it |

Eleven things are load-bearing:

- **The server is a child run by Electron's own binary as Node** (`ELECTRON_RUN_AS_NODE=1`), so the
  app ships one runtime. Its bundle and its one native module, `@parcel/watcher`, are unpacked from
  the asar: a child cannot `dlopen` out of one. The child's death ends the app, and the app's quit
  stops the child first — **by closing the IPC channel it was spawned with**, which the server
  answers with its own `quit` (`server/main.ts`). Windows has no SIGTERM: `kill()` there is
  TerminateProcess, which left `server.json` behind. A channel that closes because the app died
  takes the server with it on every system.
- **electron-builder packs every production dependency, whatever `files` lists.** The page and the
  server are bundles, so that was 238 MB of `node_modules` in the asar that nothing read, and the
  watcher's own package was packed rather than unpacked — it resolved only because a from-source
  rebuild happened to mark it native. `!node_modules/**/*` and then the five runtime modules by name
  is the list now (19 MB), and `npmRebuild: false`: the watcher is N-API and prebuilt, and a
  rebuild from its `binding.gyp` cannot cross-compile, which is what the macOS job does.
- **Each macOS architecture is its own build, from one job.** Not universal: that is both Electrons
  in one bundle for everybody. One job, so there is one `latest-mac.yml` naming both zips, and
  `electron-updater` picks the one whose name says its arch. `npm ci` installs only the runner's
  `@parcel/watcher-darwin-*`, so `package.mjs` fetches the other at the lockfile's version and
  checks it against the lockfile's integrity; `files` packs whichever are on the disk.
- **Signing is the environment's.** `package.mjs` signs macOS with `CSC_LINK` (notarising with
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) and Windows with `WIN_CSC_LINK`,
  hands each OS only its own, and treats an empty variable as absent. Without a certificate,
  `CSC_IDENTITY_AUTO_DISCOVERY=false`, Windows is unsigned and macOS is signed **ad hoc**
  (`-c.mac.identity=-`) — an Apple Silicon Mac runs nothing unsigned, and the hardened runtime's
  default entitlements turn library validation off so the watcher loads. The shell is rebuilt with
  `ANYDAG_SIGNED`, because an ad-hoc macOS app cannot update itself (Squirrel.Mac checks the new
  version against a designated requirement an ad-hoc signature does not have), so it does not try.
  electron-builder skips signing on a pull request, ad hoc included, so `CSC_FOR_PULL_REQUEST` is
  set when there is no certificate to protect. `desktop.yml` is handed no secrets at all.
- **The token is the main process's alone.** It is minted per launch and handed to the child in its
  environment — never on its command line, which every user of the machine can read — and
  `protocol.handle("anydag")` adds it to every `/__board/*` and `/api/*` request it forwards to
  `127.0.0.1`. The page, its `localStorage` and its `EventSource` live on one stable origin,
  `anydag://app`, and no script in it ever sees the token.
- **Only the page writes.** Chromium gives a custom scheme's handler no `Origin` and runs no CORS
  preflight for it — measured: a sandboxed frame's `POST` with any header it liked reached the
  handler — so the handler asks every write for a per-launch **page key**, which the preload asks
  for synchronously and the main process gives only to **the top frame of a window showing the
  page** (`page:key`), and the page's `fetch` wrapper puts on every write (`marked` in
  `src/vault/current.ts`). And a window never shows an api path as a document: `will-navigate` and
  `window.open` to one download it instead. An SVG attachment can carry script; between the two, it
  can read at most.
- **The window is isolated and sandboxed with no Node**, no webviews, and only `http(s)://` and
  `mailto:` go to the OS (`shell.openExternal`): `file://`, `smb://` or a registered handler's
  scheme in a note is one click from running something, and a note is text anybody could write.
- **A key is kept by `safeStorage`** in the app's home (`keys.json`, mode 0600), and only the names
  in `PROVIDER_KEY_ENVS` are accepted. The page can store one and ask which are stored; it never
  reads one back. The server reads keys at spawn, so storing one **restarts the server**, reopening
  every vault it had open (each keeps its id, which is in the folder). A machine with no keyring
  gets the value encoded, not encrypted, and the console says so. **The server is spawned after
  `ready`**: its spawn reads the keys and the home secret, `safeStorage` throws before `ready`, and
  that throw read as "no keyring" — every first launch stored the home secret merely encoded. The
  macOS smoke log is what showed it.
- **A load always names `index.html`.** `anydag://app/?x` canonicalises to a pathname of `//`, and
  the page's own `history.replaceState` then resolves to an address with no host, which Chromium
  refuses as another origin — the smoke run's `ready=never` before it was found.
- **A deep link is `anydag://open?vault=<id>&board=…`** and a window is a vault: the link lands in
  that vault's window, or opens one. The single-instance lock hands a second launch's argv — a link
  or a folder — to the first. A tool's `url` is such a link. macOS hands a link over as `open-url`,
  never in argv, and a cold one arrives before the server has its port: it is kept (`coldLink`) for
  `whenReady`. The scheme is registered by the bundle's Info.plist on macOS and by
  `setAsDefaultProtocolClient` on Windows — the NSIS installer registers none of its own.
- **The `anydag` shim is `~/.local/bin/anydag`**, written on launch unless a file that is not ours is
  there — `anydag.cmd` under the app's home on Windows. From an AppImage it mounts the image
  (`--appimage-mount`, extracting when that fails) and runs the CLI inside it with the image's own
  Electron as Node; anywhere else it is one `exec`. The cmd shim is recognised as ours by the same
  `anydag shim —` the sh one carries, and says `setlocal`, or its `set` would outlive it in the
  shell that ran it. A Mac app running from its disk image or a translocated quarantine path writes
  none: that path is gone next launch. `~/.local/bin` is not on a Mac's PATH and
  Windows has no such folder, so the page is told where the shim is (`cli:path`) and Settings → AI
  and agents writes the MCP lines with that absolute path.

**Not yet, and why:** signing certificates, so the builds are unsigned and an unsigned Mac updates
by hand (the release workflow signs and notarises the moment the secrets exist); Windows on arm64
and Linux on arm64; a `.deb`; and registering
the `anydag://` scheme from an AppImage, which `appimaged` or the `.desktop` file it ships owns
rather than the app.

## Sync

A vault syncs to a **sync server** somebody runs — `sync/`, in this repository, one Node
process over Postgres (or PGlite when `DATABASE_URL` is unset) — **end to end encrypted**: the server
holds opaque keys, sealed blobs and sealed metadata, and never a path or a byte of a file.

| Where | Owns |
|---|---|
| `sync/protocol/wire.ts` · `crypto.ts` | every route body and `ES_*` code · the vault key, its three HKDF subkeys, AES-256-GCM seals bound to what they seal, Argon2id, the recovery code |
| `sync/server/` | `anydag-sync serve`, the routes under `/v1`, `Meta` (`meta/pg.ts`) and `DiskBlobs`, pairing, quotas, the usage ledger, `/metrics`, the collector (`gc.ts`), and the admin CLI (`cli.ts`) |
| `server/sync/engine.ts` | one pull, push or resync at a time: decisions per key, merges, conflict copies, renames recognised |
| `server/sync/loop.ts` · `link.ts` | one loop per linked vault (catch-up, poke or a 30 s poll, a 2 s/10 s debounce on raw watcher events) · pair, link, unlink, devices |
| `server/routes/sync.ts` | `GET /api/sync`, `POST /api/sync/{pair,link,unlink,now}`, `GET /api/sync/{remotes,devices}`, `POST /api/sync/devices/revoke` — the contract is `server/sync/types.ts` |
| `src/sync/` · `src/settings/panes/Sync.tsx` | the status hook and the calls · Settings → Sync |

| Run | Does |
|---|---|
| `npm run sync:serve` | build `sync/dist/` and serve on `ANYDAG_SYNC_PORT` (8790), PGlite in `ANYDAG_SYNC_DATA` |
| `npm run sync:up` · `sync:db` | the server and Postgres in compose · Postgres alone, on `ANYDAG_SYNC_PG_PORT` |
| `node sync/dist/anydag-sync.mjs account add <name>` · `pair <account>` | an account · a one-time code a device pairs with |
| `anydag sync pair <server> <code>` · `link --upload\|--download <remote>\|--merge <remote>` · `status` · `now` · `devices` · `unlink` | the app's side; a passphrase is typed or `--passphrase-file` |
| `npm run sync:test:pg` · `sync:converge` | the meta, routes and gc suites on the compose Postgres · a hundred convergence seeds |

Eleven things are load-bearing:

- **The model is a file, not an operation.** Per vault the server keeps a head per key and a gapless
  log; a commit is all or nothing and is accepted only if every change's `parent` is its key's head
  `seq` — a tombstone's too; `null` means the key never had one. A rename is a delete and a create in
  one commit, recognised by the client.
- **Every write sync makes is a compare-and-set on the sha1 it decided against** (`writeRawIf`,
  `removeRawIf`), so the page or an agent writing in between wins and sync decides again. It writes
  raw: `write`/`create` parse and stamp, and sync puts back exactly the bytes another device committed.
- **No echo.** After applying a version, its bytes are the key's base, so the watcher's event for
  that write finds the disk equal to the base and pushes nothing.
- **A conflict is visible**: ours stays at the path and theirs is written beside it as
  `<stem> (conflict <device> <YYYY-MM-DD HH.mm>)<suffix>`, keeping its id unless ours has the same
  one. Text merges with `merge3` first; a merged board, quiz or table that would not parse is not a
  merge; `.anydag/settings.json` merges by key (`src/settings/merge.ts`).
- **Two devices settle a duplicate id the same way**: the known path only in a vault that has never
  synced (`syncs:<vault>` in the index), else the earlier `created`, else the path in code-point
  order, so a file-manager copy made in its original's second is decided by path: a rule reading
  anything one device alone knows was tried and broke the agreement under load. That holds only
  because one document has one created on every device: it travels in the sealed metadata, every pull
  that ends on the committed bytes adopts it (`adoptCreated`), a conflict copy included, a birth
  `createdOf` reports is remembered until the index walks the file, and a document renamed before the
  walk keeps its id's created rather than its new file's birth (`movedCreated`). The first download
  holds id fixes (`holdFixes`) until it has every file. **Run the harness loaded** — four batches at
  once — before believing a change to any of this: its timing defects do not show on an idle machine.
- **One name is one document.** `ideas.md` from one device and `ideas.board.md` from another are two
  keys and both land; the engine's `settleKinds` moves every one but the oldest (created, then path)
  to a numbered name, so every device makes the same move.
- **A key arrives at the spelling the disk already has.** A remote change for a key this device has
  no record of, with a file of another case on disk, is decided there (`SyncFs.spelled`), or a rename
  on one device and a case rename on the other leave two spellings that trade places every round.
- **A folder that held only what another device removed goes too** (`pruneUp`), up to the first
  folder that is an entry of its own; one the other device kept arrives as an empty-folder entry.
- **Known limit**: under concurrent renames and copies two devices can each settle one duplicate id
  from a different set of files, and both fixes commit — the id dangles, nothing is lost (four seeds
  in twelve hundred).
- **Only a process that stays up runs a loop.** The app and `anydag mcp` do; the CLI's in-process
  server (`connect`, `SyncLinks.auto` off) does not, says the vault is resting, and syncs on
  `anydag sync now`.
- **Linking adopts the remote's id.** Upload creates the remote under the vault's own id; download
  (into an empty vault) and merge call `Session.rekeyVault`, which moves the home's rows and the
  sync folder, and the page reloads onto `?vault=<new id>`.
- **Nothing about sync is in the vault.** `<home>/sync/<vault>/` holds `pair.json` (the device token,
  mode 0600), `key` (the vault key sealed under the home secret — `ANYDAG_HOME_SECRET`, which the
  desktop app keeps in `safeStorage`, else `<home>/home.secret`), `state.sqlite` and `bases/`. A vault
  is linked when `key` and `pair.json` both exist, so an unlinked vault costs one `existsSync`. **Once
  the app keeps the secret, nothing else makes one**: the CLI with the app closed refuses
  (`SecretElsewhere`) rather than seal a vault key under a second secret.
- **A failed upload is taken up again.** `createVault` under the id of an unkeyed, empty remote of the
  same account answers that remote, so a retry makes no second one.
- **The passphrase and the recovery code never leave the call that uses them.** The recovery code is
  answered once by an upload and kept nowhere; an agent cannot link — MCP has `sync_status` and
  `sync_now` only, and `docs/parity.json` says why.
- **A failure is the vault's.** `ES_NETWORK` is `offline` with a backoff; `ES_AUTH` (a revoked
  device) and a quota are `paused` with a reason; the loop never unlinks on its own. The app answers
  a sync server's `ES_AUTH` as **403**, not 401, which the page would read as its own token gone.
- **The feed's event is `dag:vault-sync`**, carrying a `SyncStatus`. `dag:sync` is the preference
  sync's key and stays it.
- **The convergence harness is the instrument** (`sync/test/converge.test.ts`): one server, two or
  three devices on real vaults, seeded schedules of edits, renames, case renames, deletes, binaries,
  outside writes, stale page saves, offline spells and dropped answers; every seed must end with the
  same bytes everywhere, no token anybody wrote lost, and no dangling or duplicated id. It found
  every defect in the client the unit tests missed. A printed seed replays with `ANYDAG_SYNC_SEED`.

The unit suite loads `node:sqlite` through an alias in `vitest.config.ts` (`test/node-sqlite.ts`):
Vite strips the `node:` prefix from a built-in it does not know, and the sync client's tests failed
with *Failed to load url sqlite* whenever they shared a worker with another file.

Names claimed, grepped first: `dag-sync-row`, `dag-sync__*`, `dag-sync-spin`, `data-dag-sync-*`, the
Settings tab `sync`, and the event `dag:vault-sync` (in `test/prefs.test.ts`'s list).

**Out, and why:** hosting it (running it is up to whoever wants it); billing (the usage ledger and
`/metrics` are in place for when it is decided); chunking a large file; sharing a vault between
accounts; history a person can browse; and real-time co-editing, which the file model cannot be.

## The Assistant

A chat about the vault, run on the person's **own** Claude Code or
OpenCode — their subscription, signed in on this machine — that answers with `dag:` citations and,
in Edit mode, makes and reorganises documents. A panel down the right of any page (`space A`, the top
bar's sparkle) and a full page at `?chat=<id>|new|1` with the vault's chats down the side and the
chat's change blocks in a Changes column.

| Where | Owns |
|---|---|
| `server/chat/store.ts` | `<vault>/.anydag/chats/<id>/`: `chat.json`, one write-once file per turn, one per undo |
| `server/chat/record.ts` | a write's before-image, and undoing a block back to it |
| `server/chat/live.ts` | the `Assistant`: turns, the guard every chat request passes, approvals, grants, blocks, undo |
| `server/chat/claude.ts` · `opencode.ts` · `fake.ts` | one harness each: argv, environment, its event stream parsed into steps, resume, stop |
| `server/chat/models.ts` | what the picker offers, per provider, and why one is unavailable — `claudeReady` and `opencodeReady`'s own sentence |
| `plugins/generate/cli.ts` | what a prompt card's run and a chat's turn both do around a CLI child: its lines, ending it, and deleting a standalone OpenCode session |
| `server/mcp/chat.ts` | chat mode for `anydag-server mcp --chat <id> --mode ask\|edit`: the tool list, `change_block`, `vault_request` |
| `server/routes/chat.ts` | the routes, the guard's registration, the SSE stream |
| `src/assistant/` | the panel, the page, the composer and its picker, the steps, the approval, access and block cards |
| `cli/commands/chat.ts` | `anydag chat ls\|models\|new\|cat\|say\|stop\|approve\|grant\|undo\|redo\|rename\|rm` |

Nine things are load-bearing:

- **The app owns the conversation; the harness owns one turn.** A turn is one process (or, for
  OpenCode, one request to a `serve` the chat keeps), parsed into steps and written to disk when it
  ends. The provider's session id is this machine's and lives in SQLite, never in a turn file; the
  next turn resumes it only on the same provider and machine, and otherwise starts fresh **seeded
  with the transcript**. That one rule is what makes a mid-chat switch of provider work, and a chat
  continued on another device after sync.
- **The agent's only tools are ours.** Claude Code runs with its built-in tools off and a strict MCP
  config naming one server; OpenCode with every permission denied but `anydag_*`. That server reaches
  this one over loopback with the launch token and `x-anydag-chat: <id>` on every call, so every
  write goes through the route the page uses — the base sha1, the 409 and `merge3` included.
- **The guard is the server's, never the prompt's.** Every request carrying `x-anydag-chat` passes
  `Assistant.guard` **before** the vault scoping: no running turn is 409 `no-turn`; a write route not
  on its list is 403 `chat-refused`; a vault the chat was not granted, 403 `not-granted`; a write in
  Ask mode or in a vault granted to read, 403 `ask-mode`. A delete, a folder move or trash, a
  transfer, an image sweep and a trash delete wait for the person on an approval card, and are
  403 `declined` on No or after five minutes.
- **The approval card is ours, not the harness's**: OpenCode reports a tool call only once it has
  finished, so a call blocked on the person is invisible in its stream. Each harness's own tool
  timeout is set above the approval's expiry.
- **Chat mode lists only the tools the mode allows**, rather than listing everything and refusing at
  call time: a listed schema is ~300 input tokens a request, and a tool the model can see is a tool it
  tries. `NEVER_IN_CHAT` leaves out opening, making or closing a vault, settings, sync, a second model,
  the quiz record, emptying the trash and uploads. **A document's eight everyday tools are one each
  with a `kind`** — `doc_list`, `doc_read`, `doc_create`, `doc_write`, `doc_rename`, `doc_duplicate`,
  `doc_delete`, `doc_title` stand for the per-kind tools in `FOLDED`, and a call is held to the named
  tool's own schema before it runs it — and a description loses the `vault` sentence the system prompt
  says once. Edit went from 81 tools and about 15k tokens a request to 52 and 9.3k, Ask from 32 and
  6.2k to 25 and 4.3k. The page and the CLI name a `doc_*` step by the tool its kind stands for
  (`verbOf`). Outside agents get **no** `chat_*` tools, and the per-kind names stay theirs;
  `docs/parity.json` says why.
- **Every file but `chat.json` is written once.** A running turn lives in memory and the SSE stream;
  undoing a block writes a new file under `undo/`, and a block's state is its last undo file by time.
  So sync never merges a turn, and `chat.json` merges by key — a grant is its own top-level
  `grant:<vaultId>` key and a revoke sets it to `null`, so neither side's grant is lost.
- **A block undoes to its before-images if each file is still what the block left**; a file changed
  since is listed as a conflict and left alone, the rest undone. A deleted file comes back from the
  trash, and undo is itself recorded, so it redoes.
- **OpenCode's `serve` is keyed per system prompt and MCP command**, because `{file:system.md}` is
  read once when it starts: a chat whose prompt changed (a new grant) needs another. The prompt goes
  in on stdin, and a turn is cancelled with `POST /api/session/<id>/interrupt`.
- **`ANYDAG_CHAT_FAKE=1` is a scripted harness** (`server/chat/fake.ts`) that reaches the vault the
  way a real one does — over HTTP, with the header, through the guard and the recorder — so a test of
  it is a test of everything but the model. `GET /__board/chat/models` answers `fake: true` under
  it, and `e2e/assistant.spec.ts` refuses to run against a server that would reach a real model:
  Playwright reuses a dev server it finds on its port.

Nothing here draws under `?snapshot=1`, and the canvas never learns a chat exists: a turn's writes
reach an open board through the change feed like any other writer's. The panel's open state is not
remembered across a reload, and Settings → AI and agents holds the default engine and mode.

Names claimed, grepped first: `dag-assistant*`, `dag-chat*`, `data-dag-assistant*`, `data-dag-chat*`,
the setting `assistant`, the leader binding `space A`, and the query key `chat`.
`src/assistant/panelState.ts` is not `panel.ts`, which `check:case` refuses beside `Panel.tsx`.

**Out, and why:** `chat_*` tools for an outside agent (an agent driving another agent's chat is a
loop nobody asked for); attaching a file or a picture to a message; a chat written on two machines at
once (both turns land and interleave by id, with no lock, which the file model cannot give); and
running a turn while the app is closed.

## Logs

Anonymous logs from installs whose person said yes, and from no other. Off
until answered; asked once per install, on the first page anybody opens; changed in Settings →
Privacy or with `anydag telemetry on|off|ask`.

| Where | Owns |
|---|---|
| `sync/protocol/logs.ts` | what a log may hold: `EVENTS`, each prop a count, a duration, a boolean or one word of a list; `scrub`; `cleanEvent` and `cleanBatch`, which every hop runs |
| `src/telemetry/client.ts` | the page's half: the answer (`useTelemetry`), `track`, `fail`, the error listeners, a post every 30 s and on `pagehide` |
| `src/telemetry/Prompt.tsx` · `what.ts` | the first-run question, drawn by `Shell` · the two lists it and the Privacy tab both say |
| `server/telemetry.ts` · `server/routes/telemetry.ts` | the answer in the home's `kv`, the install id, what is held, the route summary, where it goes, the send |
| `sync/server/routes/logs.ts` | `POST /v1/logs`: open, rate-limited, one JSONL file a day in `<data>/logs/` |

| Route | Does |
|---|---|
| `GET /api/telemetry` | `{consent, destination}`; `consent` is `null` until answered, `destination` a host or `null` |
| `PUT /api/telemetry` `{enabled}` | `true`, `false`, or `null` to be asked again — not on the Assistant's list, so a chat cannot answer it |
| `POST /api/telemetry/events` `{events}` | the page's events; `{accepted}`, `0` unless the answer is yes |
| `POST /v1/logs` (the sync server) | a batch `{v, env, events}`; `202 {accepted}` always, `0` for what is over a rate or not describable |

What a batch holds: errors and crashes (page and server — message and stack, scrubbed), `app.open`
and `page.ready` (which *kind* of page, and in how many milliseconds), `board.open` (how many items,
pages and of each diagram type), `feature.use` (export, generate, tidy — one word of `FEATURES`),
`route.timing` (each route template's count, 5xx count, mean and max, summed per minute), and an
`env` of the version, desktop or browser, the system, the arch, the language, and a random install id.

Eight things are load-bearing:

- **No prop can hold a person's words.** Every prop is a number, a boolean, a route *template* or
  one word from a list in `logs.ts`; an unknown event or prop is dropped, not kept. The two free-text
  props are an error's `message` and `stack`, and `scrub` takes out every quoted run (the app quotes
  what it reports), every URL and path but a script's own file name and line, every email, every
  file name and every long token with a digit in it. `test/logs.test.ts` holds the cases.
- **Every hop cleans again.** The page runs `cleanEvent` before it holds anything, the app's server
  before it keeps anything, the sync server before it writes anything — so a hop that forgot, or a
  sender somebody wrote by hand, cannot put more on disk than the vocabulary allows.
- **The answer is the install's, in the app's home** (`telemetry.consent` in `kv`), not a browser's
  and not a vault's: one question per machine, read by the page, the CLI and Settings alike. A no
  deletes the install id and drops everything held; a yes makes a new one. Nothing is measured
  before a yes — `record`, `routeDone`, `fail`, `track` all return first.
- **Never under `?snapshot=1` or `?view=1`.** `startTelemetry` does nothing there: no request, no
  question, no listener. `telemetry.spec.ts` asserts the page makes no `/api/telemetry` request at all.
- **Where it goes**: `ANYDAG_LOGS_URL` (an address, or `off`), else `ANYDAG_LOGS_BUILD_URL` baked in
  by `server/build.mjs`, else the sync server of the first vault paired on this machine, else
  nowhere — and nowhere means nothing is kept for later. Only a server that stays up sends (`start`
  in `server/main.ts`); the CLI's in-process one never does.
- **The question is a modal the board cannot hear behind.** `useEditor`'s capture-phase key handler
  runs before any card can stop a key, so it skips targets inside `[data-dag-telemetry-ask]` as it
  skips `[data-dag-settings]`; Escape is *No*.
- **`/v1/logs` is open, and stands in for a token with limits**: 256 KB a batch, 30 a minute an
  address, 3000 a minute in all, and what is over is `{accepted: 0}` rather than an error a client
  would retry. Nothing about the request — no address, no header — is written. `ANYDAG_SYNC_LOGS=off`
  makes it a 404; `ANYDAG_SYNC_LOGS_DAYS` (30) is how long a day file stays.
- **The suite answers no.** `e2e/global-setup.ts` answers the dev home's question once, or a card
  over every page would take every click; `telemetry.spec.ts` stands in its own answer with
  `page.route`.

Names claimed, grepped first: `dag-telemetry*`, `data-dag-telemetry*`, `data-dag-setting-telemetry*`,
the Settings tab `privacy`, and the event `dag:telemetry` (in `test/prefs.test.ts`'s list).

**Out, and why:** a third-party SDK (a vendor, and a second place deciding what is sent); session
recordings, clicks, or anything with a coordinate; and a per-vault or per-browser answer — a person
says it once.

## Problems

Where a person reads what is wrong with a board. **Not on the canvas**, which is the whole rule: the
board's own errors were a red card hung above its content, a diagram's replaced the diagram, and a
warning was a strip that changed a diagram's size, and none of them could be put away. The canvas is
the picture. `src/ui/problemList.ts` is the meaning with no DOM in it, `src/ui/Problems.tsx` the dock,
and the editor panel is the third reader.

| Where | Shows |
|---|---|
| the count, bottom centre | errors and warnings on the board, while there are any; a click opens the list |
| the notification, above it | the first *new* error, with Show and ×, for six seconds |
| the list | every problem, its code, item, line and page; a row opens it |
| the editor panel, under the source | the open item's own problems; a row puts the caret on the line |
| a red dot on a diagram | it is drawing its last good version, not the file's current text |
| a grey dashed stand-in | a diagram opened broken, with no good version to fall back on |

Six things are load-bearing:

- **One question, three askers.** `diagnoseBoard` in `src/dsl/diagnose.ts` is what the dock, the
  panel and `/__board/diagnostics` all call, and `parseItem` is the per-type dispatch `DiagramItem`
  used to spell out by itself. There were two copies of it, and the route's forgot `aspect` and
  `layout` once already. `test/diagnose.test.ts` holds the new function to the old route's output,
  byte for byte, on every board in `boards/`. It takes the item's fields structurally rather than a
  `BoardItem`, so `src/dsl/` still does not know the board format; plain relative imports, because
  the plugin loads it.
- **A broken body is never laid out.** `DiagramItem` keeps `drawn` — the last parse with no errors —
  beside `model`, and `placed` is always `drawn`'s layout. It used to lay out the broken partial
  parse and then hide it behind the card. A page opened on a broken board has no `drawn`, and that is
  the one case for the placeholder, which is `inline-block` so it reports its own width: as a block
  it measured the wrapper sized from its own report and could never be smaller than the 520px guess.
- **The notification waits and does not repeat.** A second of stillness before it speaks, because
  the panel writes a quarter-second after each keystroke and a half-typed line is an error per pause.
  A problem's `key` is `code|item|message` with **no line**, so typing above a broken statement does
  not make it new; `seen` is the keys at the last settled reading, so × holds until something
  genuinely new arrives. It never speaks about the item open in the panel or about a warning.
- **"Show" waits for the page.** A problem on another page switches the page first and opens the
  panel after, because selecting an item that is not on the drawn page is undone by the effect that
  keeps `selected` naming things on the paper. `App` holds the request until the page matches.
- **`editor.openAt(id, line)` is a line, not a pick.** The panel's other caret effect follows the
  pick, which keeps moving while the caret walks the source; a line asked for once is its own
  effect, or it would pin the caret against every pick after it. A diagnostic's line is the board
  file's and the panel counts the body's — `line - item.line`.
- **`[data-dag-error]` finally exists.** Seventeen e2e assertions checked for it and nothing in `src/`
  had ever set it, so every one passed by matching nothing. The placeholder carries it now, and all
  seventeen still pass — which is the first time that meant anything.

Nothing here is computed under `?snapshot=1`: there is no chrome to show it in, and the agent reads
the same answer from the endpoint. `problems.show` in `src/settings/` is `notify` (the default),
`badge` (the count only) or `off` (nothing outside the panel). Names claimed, grepped first:
`dag-problems*`, `data-dag-problems*`, `dag-broken*`, `dag-stale`, `data-dag-stale`,
`dag-inspector__problem*`, `data-dag-inspector-problems`, `data-dag-setting-problems`.

**Out, and why:** the stray `y` that started this almost certainly came in through the panel — K
and Enter open a fence with the source focused and its caret at offset zero, so the next letter
typed as a shortcut lands on the body's first line. That is a separate defect and is not fixed here.
## Versions and releases

The version is semver, `MAJOR.MINOR.PATCH` with an optional pre-release (`0.2.0-beta.1`), and it is
said in two files that must agree: `VERSION`, which every build reads, and `package.json`'s
`version`, which electron-builder names a release by. `check:version` (in `npm run checks`) refuses a
tree where they differ or where either is not semver.

It reaches the server's `/api/health` through `server/build.mjs`'s `__ANYDAG_VERSION__`, the desktop
shell through `desktop/build.mjs`, the page's `<meta name="version">` and Settings' About tab through
`vite.config.ts`, and `anydag --version`.

| Bump | For |
|---|---|
| `MINOR` | a feature, a page, a route — anything a person would notice (while `MAJOR` is 0, a breaking change too) |
| `PATCH` | a fix to something already released |

**A release is a tag.** Bump `VERSION` and `package.json` together in one commit on `main`, then push
`v<version>`: `.github/workflows/release.yml` checks the tag against both files
(`node scripts/check-version.mjs v0.2.0`), runs the fast tier once, packages the app on Linux,
Windows and macOS (signing where the secrets allow — see *The desktop app*), opens each on a temp
vault, and creates the GitHub Release with every installer, its blockmap and the three files the
app's updater reads: `latest-linux.yml`, `latest.yml` (Windows) and `latest-mac.yml`. The release is
not created unless all three are there. A tag with a `-` in it is a pre-release. The notes are
generated from the merged pull requests and can be edited on GitHub afterwards.

**The file names are the updater's URLs**, so none has a space: `AnyDag-<v>.AppImage`,
`AnyDag-Setup-<v>.exe`, `AnyDag-<v>-<arm64|x64>.dmg` and `.zip`. electron-builder's default
Windows name has spaces, which GitHub turns into dots on upload, and `latest.yml` would then name a
file the release does not have.

## Gate

`npm run gate` runs everything in the order that fails fastest: typecheck (all three tsconfigs) →
`check:version` → `check:case` → `check:theme` → `check:literals` → `check:icons` → `check:skill` →
vitest → the Playwright suite. `npm run typecheck && npm test` is the quick loop.

**Everything before Playwright is `npm run checks`** (`scripts/checks.sh`), and it has three readers:
`gate.sh`, the pre-commit hook, and the `checks` job in CI — one list, so a check added is added
everywhere. It needs no browser and no network and takes seconds, which is what lets it sit in a
commit hook: `tsc` is incremental (its build info under `node_modules/.cache/tsc/`) and the unit
suite shares modules between the files each worker runs. `.githooks/pre-commit` is the hook, and
`npm run prepare` installs it with `git config core.hooksPath .githooks` — relative on purpose, so one
setting serves every worktree. `prepare` is `scripts/hooks.mjs`, which does nothing without git or a
repository, because `npm ci` runs it where there may be neither — and is Node, because npm runs a
script line with `cmd.exe` on Windows, where `command -v` and `true` are not commands and the shell
form failed `npm ci` there. `ANYDAG_NO_HOOK=1` skips the hooks.

**CI runs the fast tier and no Playwright.** The screenshot baselines are compared against one pinned
Chromium, and a runner's fonts rasterise differently, so a green tick on GitHub does not mean the app
was opened in a browser. The browser suite is `npm run e2e:local` (`scripts/e2e-local.sh`): against
the dev server, baselines compared, the only run that can fire the dev size assertion, under `nice`
and three browsers wide (`ANYDAG_E2E_WORKERS`). `.githooks/pre-push` runs it.

**`playwright.config.ts` sets `retries: 1`.** A check that passes on its second try is reported as
`flaky` on Playwright's summary line; one that fails twice is a failure.

**The hooks never stash**, the usual trick for checking the index rather than the working tree: the
stash stack is shared with every worktree, so a hook that pushes and pops could restore somebody
else's work over yours. They check the working tree, and `tsc` and `vitest` are whole-project
questions anyway.

`check:icons` fails on a manifest name that did not make it into the bundle, on a stale
`src/dsl/icon-names.ts`, and on any `icon=` in `boards/` that resolves to nothing — the vocabulary is
dense with near-misses, and `groq`/`grok`, `together`/`tether` and `zookeeper`/`keeper` are each two
different companies.

`check:skill` holds `skills/anydag/SKILL.md` — the document an agent reads before it draws anything —
to the code it describes, through the closed sets a prose document still contains: every theme is
named; the *Which type* table, `docs/dsl/` and `DiagramType` + `OWN_MODEL_TYPES` list the same
fourteen; the *Library* section names every layer and `GET /__board/library`; `docs/dsl/chart.md`'s
vocabulary is `chart`'s statement and form words; *Writing a note* names every block in
`NOTE_BLOCKS`; *Through MCP* names every tool in `TOOLS` and no other; every `anydag …` in *Through
the CLI* is a command `anydag help --json` lists, and every command group is named; and the quiz and
table code tables match `QUIZ_CODES` and `TABLE_CODES`. A missing skill is a failure, not a skip. The
cheat sheets under `skills/anydag/references/dsl` are a symlink to `docs/dsl/`, so they cannot drift.

`test/parity.test.ts` runs in `npm run checks` too, so **a route, a command or a tool that
`docs/parity.json` does not name fails the commit that adds it** (see *Parity*).

Two things about the Playwright run. Baselines are `-linux` and will not match elsewhere;
regenerate rather than fight them. And a stale HMR module can fail every check at once with a
"does not provide an export named …" error, or make the size assertion fire — restart the dev server
before believing a mass failure.
