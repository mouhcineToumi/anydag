# Architecture

How AnyDag is built, and why. This is the long-form account that used to be one file at the root;
it is split by area so a contributor, or an agent, can load the part they are changing instead of
all of it. Start with [CLAUDE.md](../../CLAUDE.md) (the short map) and [overview.md](overview.md),
then read the file for your area.

The text records the defects that shaped the code. When you fix something that bit you, add it to
the file for that area, not to a new place.

## Files

| File | What it holds |
|---|---|
| [`overview.md`](overview.md) | What AnyDag is, the three ways to run it, and the mark. |
| [`layers.md`](layers.md) | The layer table: what each directory owns and must not know; the split inside `src/edit/`; the no-colour rule. |
| [`things-that-will-bite.md`](things-that-will-bite.md) | The long list of traps found the hard way, each with the defect that found it. Read before touching the area it names. |
| [`design-and-layout.md`](design-and-layout.md) | Design rules, the three ELK knobs and the six layouts that are not ELK's, what `data-dag-ready` means, and what was refused. |
| [`notes.md`](notes.md) | The `.note.md` format, the block editor that never writes a byte, the two writers and the merge; TeX between dollars. |
| [`tasks-projects-calendar.md`](tasks-projects-calendar.md) | A note with a `status:`, a folder with a `project:`, an event with a `start:`, and the calendar that draws them; the time-zone rules. |
| [`quizzes.md`](quizzes.md) | The `.quiz.md` format, the runner, Mistakes and the practice record. |
| [`tables.md`](tables.md) | The `.table.md` format: tabs, typed cells, the smallest-span writers, sort and filter, CSV. |
| [`attachments.md`](attachments.md) | Any file kept in the vault: ids, previews, what the server serves inline, the zip export. |
| [`trash.md`](trash.md) | Nothing is deleted at once: the vault's trash, restore, expiry, and its routes. |
| [`references.md`](references.md) | Document ids, `dag:` references, embeds, backlinks, the references index, `?view=1`, and wikilinks following a rename. |
| [`search.md`](search.md) | The corpus on the server, the index in the page, ranking and snippets. |
| [`cli.md`](cli.md) | `anydag`, the MCP server, and the manifest that holds routes, commands and tools in step. |
| [`lock.md`](lock.md) | Read-only mode, in two layers, and what it keeps. |
| [`links.md`](links.md) | Links between items, the rule for when a diagram has a header, and drawing a link with the pointer. |
| [`free-canvas.md`](free-canvas.md) | `sketch`, `layout=fixed`, geometric shapes, the pen's stroke and pictures. |
| [`charts.md`](charts.md) | The `chart` dialect: its model, scales, colour, and the pointer's relationship to it. |
| [`getting-around.md`](getting-around.md) | Pan, zoom and the pan modifier. |
| [`settings.md`](settings.md) | Preferences, the Settings modal, and why a snapshot reads none of them. |
| [`prompt-cards.md`](prompt-cards.md) | A model writes the DSL: the card, the providers (Claude Code, OpenCode, HTTP), the fix loop, rewriting an existing diagram, and flashcards for a quiz. |
| [`sidebar.md`](sidebar.md) | The shell, the file tree and its operations, selection, the search dialog, folders and the page tabs. |
| [`icons.md`](icons.md) | Four vocabularies behind one `icon=` attribute, and where the art lives. |
| [`editing.md`](editing.md) | Every gesture is a write to the board file: the table of gestures, the leader key, picking inside a diagram, the controls and text emphasis. |
| [`editing-drag.md`](editing-drag.md) | What a drop means in each dialect, the controls the file needed, and converting a Mermaid paste. |
| [`library.md`](library.md) | Blueprints, the five composition layers, and keeping a component. |
| [`import-export.md`](import-export.md) | SVG, PNG, `.board.md`, the note PDF, and file import. |
| [`groups-guides-tidy.md`](groups-guides-tidy.md) | `group=`, alignment and spacing guides, and the tidy arithmetic. |
| [`diagnostics.md`](diagnostics.md) | Diagnostic codes and how they are earned; where a person reads what is wrong with a board. |
| [`server.md`](server.md) | The one Node process, the token and `Host` gate, the store, and several vaults in one server. |
| [`desktop.md`](desktop.md) | The Electron shell: the server child, the scheme, the token, signing, and the shim. |
| [`sync.md`](sync.md) | The end-to-end-encrypted sync client and its server half (`api/`), and the convergence harness. |
| [`assistant.md`](assistant.md) | The chat about the vault, run on the person's own Claude Code or OpenCode. |
| [`logs.md`](logs.md) | Opt-in anonymous logs: what a batch may hold and every hop that cleans it. |
| [`api.md`](api.md) | The api server: its features, config, what it stores and never stores, and running and deploying it. |
| [`feedback.md`](feedback.md) | Send feedback: the card, what leaves the machine, the stateless relay that makes a GitHub issue, and how to run it. |
| [`gate-and-releases.md`](gate-and-releases.md) | Versions, how a release is cut, and what `npm run gate`, `checks` and CI run. |
| [`limits.md`](limits.md) | What the app costs to run and where it slows down and stops, measured; the bench and the nightly guards. |

## Find a section by name

The text cross-refers by section name (*Picking a node*, *Wikilinks follow a rename*). This is where each one lives.

| Section | File |
|---|---|
| A git graph's lanes | [`editing.md`](editing.md) |
| An md card's text, in place | [`editing.md`](editing.md) |
| AnyDag | [`overview.md`](overview.md) |
| Attachments | [`attachments.md`](attachments.md) |
| Charts | [`charts.md`](charts.md) |
| Choosing a board | [`sidebar.md`](sidebar.md) |
| Composition | [`library.md`](library.md) |
| Controls on the canvas | [`editing.md`](editing.md) |
| Converting a paste | [`editing-drag.md`](editing-drag.md) |
| `data-dag-ready` means *finished* | [`design-and-layout.md`](design-and-layout.md) |
| Deliberately out | [`design-and-layout.md`](design-and-layout.md) |
| Design rules | [`design-and-layout.md`](design-and-layout.md) |
| Diagnostics | [`diagnostics.md`](diagnostics.md) |
| Dragging a card | [`editing-drag.md`](editing-drag.md) |
| Editing on the canvas | [`editing.md`](editing.md) |
| Equations | [`notes.md`](notes.md) |
| Feedback | [`feedback.md`](feedback.md) |
| Flashcards from a model | [`prompt-cards.md`](prompt-cards.md) |
| Folders | [`sidebar.md`](sidebar.md) |
| Gate | [`gate-and-releases.md`](gate-and-releases.md) |
| Geometric shapes | [`free-canvas.md`](free-canvas.md) |
| Getting around | [`getting-around.md`](getting-around.md) |
| Groups | [`groups-guides-tidy.md`](groups-guides-tidy.md) |
| Icons | [`icons.md`](icons.md) |
| Import and export | [`import-export.md`](import-export.md) |
| Keeping a component | [`library.md`](library.md) |
| Layout, per diagram type | [`design-and-layout.md`](design-and-layout.md) |
| Links, and drawing bare | [`links.md`](links.md) |
| Logs | [`logs.md`](logs.md) |
| Notes | [`notes.md`](notes.md) |
| Home | [`sidebar.md`](sidebar.md) |
| Parity | [`cli.md`](cli.md) |
| Picking a node | [`editing.md`](editing.md) |
| Pictures | [`free-canvas.md`](free-canvas.md) |
| Problems | [`diagnostics.md`](diagnostics.md) |
| Projects | [`tasks-projects-calendar.md`](tasks-projects-calendar.md) |
| Protocol 2, and an older peer | [`sync.md`](sync.md) |
| Prompt cards | [`prompt-cards.md`](prompt-cards.md) |
| Prompt to edit | [`prompt-cards.md`](prompt-cards.md) |
| Quizzes | [`quizzes.md`](quizzes.md) |
| Quotas and history | [`sync.md`](sync.md) |
| Reaching what the file can say | [`editing-drag.md`](editing-drag.md) |
| Reading it as a tree | [`sidebar.md`](sidebar.md) |
| Resource use and limits | [`limits.md`](limits.md) |
| References, ids and the read-only view | [`references.md`](references.md) |
| Running the relay | [`feedback.md`](feedback.md) |
| Search | [`search.md`](search.md) |
| Sequence messages and fragments | [`editing.md`](editing.md) |
| Settings | [`settings.md`](settings.md) |
| Settings that had no source-free way in | [`editing.md`](editing.md) |
| Smart guides | [`groups-guides-tidy.md`](groups-guides-tidy.md) |
| Sync | [`sync.md`](sync.md) |
| The api server | [`api.md`](api.md) |
| The bench | [`limits.md`](limits.md) |
| Tables | [`tables.md`](tables.md) |
| Tasks | [`tasks-projects-calendar.md`](tasks-projects-calendar.md) |
| Text emphasis | [`editing.md`](editing.md) |
| The Assistant | [`assistant.md`](assistant.md) |
| The calendar | [`tasks-projects-calendar.md`](tasks-projects-calendar.md) |
| The command line | [`cli.md`](cli.md) |
| The desktop app | [`desktop.md`](desktop.md) |
| The dock's tooltip | [`getting-around.md`](getting-around.md) |
| The free canvas | [`free-canvas.md`](free-canvas.md) |
| The layers, and what each may not know | [`layers.md`](layers.md) |
| The leader key | [`editing.md`](editing.md) |
| The library | [`library.md`](library.md) |
| The local server | [`server.md`](server.md) |
| The lock | [`lock.md`](lock.md) |
| The page tabs | [`sidebar.md`](sidebar.md) |
| The pen's stroke | [`free-canvas.md`](free-canvas.md) |
| The sidebar | [`sidebar.md`](sidebar.md) |
| The time zone | [`tasks-projects-calendar.md`](tasks-projects-calendar.md) |
| The trash | [`trash.md`](trash.md) |
| Things that will bite | [`things-that-will-bite.md`](things-that-will-bite.md) |
| Tidy up | [`groups-guides-tidy.md`](groups-guides-tidy.md) |
| Vaults | [`server.md`](server.md) |
| What the server cannot forge | [`sync.md`](sync.md) |
| Versions and releases | [`gate-and-releases.md`](gate-and-releases.md) |
| What the panel opens on, and what it opens with | [`editing.md`](editing.md) |
| Why it stopped being a column | [`sidebar.md`](sidebar.md) |
| Wikilinks follow a rename | [`references.md`](references.md) |
