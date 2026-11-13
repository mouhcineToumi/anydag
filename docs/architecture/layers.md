# The layers

> The layer table: what each directory owns and must not know; the split inside `src/edit/`; the no-colour rule.

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
| `src/ui/table/` | a table's page: the grid, its menus and editors, the tab bar, Sort and Filter, the file's problems in words with their fixes, undo | the format: every change is a writer from `src/table/write.ts`, addressed by id |
| `src/blocks/` | BlockNote configured once — its menus, paste, upload and theme bridge — and loaded lazily | which file it writes: it takes blocks in and hands a `NoteEditor` back |
| `src/view/` | drawing a board or a note read-only — `?view=1`, a snapshot, and what an embed draws with — and what drawing shares with the canvas (`drawing.ts`) | `src/edit/`, BlockNote: a viewer must never fetch either, and `test/view-graph.test.ts` walks the import graph to hold it |
| `src/refs/` | what a reference *is* (`extract.ts`, browser-free), the page's copy of the index, and how a reference, an embed and the backlinks are drawn | a name: every reference is an id, resolved when it is followed |
| `src/calendar/` | what the calendar shows and where (`model.ts`): the days a view covers, each task's, event's and note's days in the viewer's zone, the lanes and the hour-grid columns they pack into, and what an event's bar writes | the DOM, React |
| `src/vault/` | which vault this tab is in, the `?vault=` every request carries, the recent vaults and the switcher's calls, and what the desktop shell offers the page (`desktop.ts`) | React, but for the one hook; the disk — a path is only ever handed to the server |
| `icons/` | the brand vocabulary and its provenance — generated, and outside `src/` on purpose | anything about diagrams |
| `cli/` | `anydag`: arguments, finding the server (`server.json`, or one in-process on `--vault`), and turning a command into the op list the page would commit — through `src/board/`, `src/dsl/` and the pointer-free half of `src/edit/` | the disk: every read and write is a route, through the store and its watcher |
| `server/` | the local server: the token and `Host` gate, the vault store, the app's home and its SQLite index, every route, the MCP tools | React, the DOM; the page's state — it answers routes and writes files |
| `desktop/` | the Electron shell: spawning the server, the `anydag://` scheme and the token on every request, windows, the folder dialog, deep links, the `anydag` shim, `safeStorage`, updates | the vault's format: it is a browser and a process manager around the server |
| `api/` | the api server, a separate self-hostable process (and api.anydag.com's: `docs/architecture/api.md`): `protocol/` (the wire and the cryptography, shared with the client), `server/` (Hono, Postgres or PGlite, blobs on disk, quotas, the usage ledger, `/metrics`, the admin CLI, the feature switches) | a path, a byte of plaintext, the app: everything it stores is sealed by the client |
| `src/telemetry/` | the page's half of logs: the answer as the server last said it, the events this page holds, the first-run toast | what a log may hold — `api/protocol/logs.ts` decides that, and every hop runs it |
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
| `repair.ts` | what a problem about the file itself can be put right with, in words — the plan and the fix as data | the pointer, React; it never writes: `Editor.repair` does, through `src/board/repair.ts` |
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
meaning anything. Its fifth section does hold the chrome's text tone: a `color: var(--dag-color-muted)`
there is refused unless its selector is listed, with a reason, in
`scripts/chrome-muted-allowlist.json` — and only a disabled control, a separator or a decorative
glyph belongs there. Readable text is `slate`; `muted` is not a text colour.
