---
name: anydag
description: Draw technical diagrams on AnyDag, a local infinite whiteboard, by writing a board file. Use whenever the user asks for a diagram, a data model, an ERD, a schema drawing, a flowchart, a workflow, a swimlane diagram, an architecture diagram, a system diagram, "what runs where", a RAG diagram, a state machine, an activity diagram, a class diagram, a UML diagram, a use case diagram, a sequence diagram, a C4 diagram, a mindmap, a roadmap, a timeline, a gantt, a git graph, a wireframe, or a chart — a bar chart, a line chart, a pie chart or a donut — and whenever they say "diagram this", "draw this", "visualise this", "chart this", "plot this", "put this on the whiteboard", "put this on anydag", "show me the architecture", "map out the flow", or hand over a screenshot of a diagram and ask for it redrawn. Also use to add markdown notes, tables or images beside a diagram on the same board, and to write a note on AnyDag: a page of prose (a spec, meeting notes, a plan) stored beside the boards as its own `.md` file and edited in a block editor. Fourteen diagram types render from one Mermaid-flavoured DSL, laid out automatically and themed by a swappable design system; boards are ordinary Markdown files that hot-reload in the browser. Prefer this over plain Mermaid (unstyled, no layout control) and over hand-placed drawing tools whenever the diagram is technical and should look like the house style.
---

# AnyDag

Draw a diagram by **writing a file** in a **vault** — a folder on the person's disk, opened in the
AnyDag desktop app (or `anydag serve <folder>`), the way an Obsidian vault is. `<vault>/<name>.board.md`;
the page watching it re-renders in under 200ms. In this repository the development vault is
`boards/local/`, which is where its own boards are.

**There is no account.** Everything is on this machine: a vault is a folder, its notes are plain
`.md` (Obsidian's `[[links]]` work), and the app's own state is in `<vault>/.anydag/` and `~/.anydag/`
— never write either. The app can have several vaults open; `anydag vault ls` names them, and every
command and MCP tool takes `--vault`/`vault` and uses the default one when it is left out. Write
where the person is working, and ask if it is not clear.

## Three ways in, and this is how to tell which you have

**Look for a tool called `board_read`.** If this client has the AnyDag MCP tools, use them: they
need no checkout, and they are the whole app — every feature the page has, down to one card, one
question or one cell. The CLI is not a second copy of them: **`anydag` is an admin tool** (vaults,
whole files, the trash, sync, logs, and the pictures and exports only a browser can make), so a client
with no MCP tools can still write a whole board and look at it, but cannot edit inside one. If you
have no MCP tools and `anydag` is on the PATH (the desktop app installs it), write the whole file
with the CLI or straight into the vault — the app watches the folder — and look at it with
`anydag snapshot`. Do not mix the three in one session: they all write the same files, and two mental
models of where a board lives is how one of them gets written to the wrong place.

### Through MCP

Every feature the page has (`docs/PARITY.md` is the whole matrix; the CLI carries only the admin part of it), and the ones to
reach for first at the top. **Every one that touches a file takes a `vault`** — an id from
`vault_list` — and acts in the default vault when it is left out:

| Tool | For |
|---|---|
| `board_list` | what boards there are — like every `*_list`, narrowed by `folder` and a page at a time: `limit` (100) at a time, passing the cursor each page answers back as `cursor` while there is more |
| `board_read` | a board's text, and the `base` a write of it must carry |
| `board_create` | a new board — the name comes back settled, and may be numbered |
| `board_write` | replacing a board's whole text, which is how a diagram is drawn or redrawn |
| `board_patch` | changing one item and leaving the rest of the file alone — also how a page, a link, a card or a row inside a diagram is changed: you write the DSL. `{insert: "<fences, as the file writes them>", after: "<id>"}` adds items where you say; a fence with no `#id` is given one |
| `board_diagnose` | the codes, after every write — or, given `text`, of a draft before anything is written |
| `board_fences` | what items are on a board, without reading all of it |
| `dsl_reference` | one type's cheat sheet — **pass a `type`**; with none it lists the names |
| `library` | ready-made pieces, rendered, plus the user's own saved components — `q` searches, and is how the ~1,700 pictures under *Objects* are found |
| `icons` | what `icon=` may say — every emoji too, as `emoji:<name>` |
| `board_title` · `board_rename` · `board_duplicate` · `board_delete` | a board's title (with `follow`, its name follows) and the file operations |
| `board_mkdir` · `board_rmdir` · `board_mvdir` | folders; `board_mvdir` moves one whole and refuses a destination that exists; `board_rmdir` moves one to the trash, and one with anything in it only with `recursive` |
| `note_list` · `note_read` · `note_create` · `note_write` · `note_rename` · `note_duplicate` · `note_delete` · `note_title` | notes, the same way — Markdown, under the same `base` rule |
| `quiz_list` · `quiz_read` · `quiz_create` · `quiz_write` · `quiz_rename` · `quiz_duplicate` · `quiz_delete` · `quiz_title` · `quiz_check` | quizzes, the same way, and `quiz_check` for the `EQ_`/`WQ_` codes (with `text`, a draft's) |
| `quiz_question_set` · `quiz_question_remove` · `quiz_question_move` | **one question at a time** by its `{#id}`, every other byte of the quiz left alone: add or replace one (its Markdown from the `##`, written as given), remove one, reorder — use these rather than `quiz_write` for anything but a new quiz |
| `quiz_questions` · `quiz_answer` · `quiz_mistakes` · `quiz_threshold` | running one in the conversation: the questions as data, then **only the answers the person gave**; what is still in Mistakes; how many right in a row take one out |
| `table_list` · `table_read` · `table_create` · `table_write` · `table_rename` · `table_duplicate` · `table_delete` · `table_title` · `table_check` | tables, the same way, and `table_check` for the `ET_`/`WT_` codes (with `text`, a draft's) |
| `table_get` · `table_edit` | a table as data — every tab, column and row with its id, and each cell as written and as read — and edits to its cells, rows, columns and tabs by those ids, which never lose a person's edit to another row |
| `task_list` · `task_create` · `task_set` | tasks — notes with a `status:` and maybe a `due:` and a `start:` |
| `event_list` · `event_create` · `event_set` | events — notes with a `start:` and maybe an `end:`; a time **as the person said it, with no offset** — the server puts their zone's on, and `whoami` says which zone that is |
| `project_list` · `project_create` · `project_set` | projects — a folder whose note has a `project:` |
| `search` · `refs` · `resolve` | the page's search over every board, note, quiz and table; references and backlinks; what a `dag:<id>` names |
| `image_add` · `image_get` · `image_unused` · `image_sweep` | a picture beside a board (placed) or a note (kept) — **by `url` when it is on the web**, which the server fetches, rather than its bytes through the conversation; looking at one; the ones nothing names any more |
| `file_upload` · `file_list` · `file_get` · `file_rename` · `file_duplicate` · `file_title` · `file_delete` | attachments: any file — a PDF, a picture, a sheet — kept beside the boards and notes and referred to by `dag:<id>` (see *Attachments*), given as base64 `data` or as an `https://` `url` the server fetches (a private address is refused) — and its `sha256` comes back, to prove the bytes arrived; `file_list` says what this vault accepts, `file_get` shows a picture or a text file, and `file_delete` moves it to the trash and says what used it |
| `trash_list` · `trash_restore` · `trash_delete` · `trash_empty` | what was deleted: **every `*_delete` and `board_rmdir` moves a thing to the trash**, where it stays for `days` (thirty) and `trash_restore` puts it back with its id; `trash_delete` and `trash_empty` delete for good, each with a `confirm` — **ask the person first** |
| `sync_status` · `sync_now` | whether the vault syncs to a sync server and how it is going (`state`, `pending`, `conflicts`, `last`), and a pull-and-push now — **only in builds with the `cloud` switch on: if they are not in the tool list, this build has none**. Pairing and linking are the person's — they take a one-time code and a passphrase, typed in Settings → Sync or `anydag sync` — so there is no tool for either; a vault that is not linked says `unlinked` |
| `component_delete` | removing a saved component, for good — keeping one is `board_create` under `components/` |
| `vault_list` · `vault_open` · `vault_create` · `vault_close` · `board_transfer` | the vaults (folders) this app serves, opening a folder as one, making one, closing one — **never deleting its folder** — and moving a file or a whole folder from one vault to another with its id |
| `settings` · `whoami` · `llm` · `generate` | the person's preferences (change them only when asked); who this is and what is answering; which models could draw; asking one to (it spends money, and you can usually write the DSL) — or, with `kind: "flashcards"`, asking one for flashcards from a topic or a note's text, each already read by the quiz parser |
| `feedback` | a bug or an idea sent to AnyDag's maintainers as a **public** GitHub issue — **only when the person asked you to send feedback**, never to report your own trouble; tell them first exactly what goes: their words, each file, the whole text of each board or note they named, and the app's version, system and arch |

Nothing here can see the drawing or tidy it — a snapshot, a tidy and an SVG, PNG or PDF export need
the page in a browser — and nothing here streams: `base` is how you learn a document moved.

**`base` is the whole concurrency story.** It is a sha1 of the file, it comes back from
`board_read`, and passing it to `board_write` or `board_patch` is what stops a write from throwing
away an edit the person made while you were thinking. A board that moved underneath answers by
naming its new `base`: read it again and redo the change against what is there.

**The loop is the same one, minus the eyes.** `board_diagnose` is the parser's half — the `E_`,
`W_` and `EB_` codes, exactly as below. The `Q_` quality half and the picture need a laid-out page
in the real webfonts, which the MCP server has no browser for, so **every board tool hands back a
`url`** — `anydag://open?…`, which the desktop app opens — or use `anydag snapshot` from a shell:
finish by giving the person that link, or the picture, and saying what you would like them to check. An
untidy board is not an error a parser can raise; it is only visible.

*Connecting one, if the user asks how:* `claude mcp add anydag -- anydag mcp --vault <folder>`, or the
same command in Claude Desktop's config — Settings → This vault → Agent access prints both. It runs over stdio
against the running app, or opens the vault itself when the app is not running. No key, no consent
card: it is their own machine.

### Through the CLI

`anydag`, in the repository — `npm link` there once puts it on the PATH, or `npm run anydag --
<command>` runs it without that. It is a client of the routes the page calls, never of the disk,
so it works whichever of the two it finds and uses the running app when there is one, else opens `--vault <path>` itself.

**It is the admin CLI, not the app's other half.** It manages vaults, reads and writes whole files,
moves them to the trash and back, runs sync, answers for logs, and — the one thing MCP cannot do —
**sees the drawing**: `anydag snapshot`, `anydag tidy` and the exports open the page in Playwright.
Everything finer than a whole file — an item's attributes, a page, a link, a card, an edge, a row, a
task's status, a quiz question, a table cell, a search, the library, a model asked to draw, the
Assistant — is **not a CLI command**: it is an MCP tool (`board_patch`, `task_set`, `quiz_question_set`,
`table_edit`, `search`, `library`, `generate`, …, listed above), or text you write into the file.
With no MCP tools, write the whole board with `board write` and check it with `board diagnose`.

```bash
anydag vault ls                        # the vaults there are, and the default one (`*`)
anydag board new plan                  # prints the settled name — it may come back numbered
anydag board cat plan --json           # the text, and the `base` a write has to carry
anydag board write plan --base <sha1> --file plan.board.md   # prints the diagnostics; exit 4 on an error
anydag board diagnose --file draft.board.md   # a draft checked before it is written anywhere; `quiz check` and `table check` take --file too
anydag snapshot plan -o /tmp/plan.png  # the picture, every diagnostic, every Q_ finding
anydag tidy plan                       # straighten it, as `space T` does, and write that
```

| Commands | For |
|---|---|
| `anydag ls` | every board, note, quiz, table, attachment and folder in the vault, with `--ids`, a folder to look in, and `--boards`/`--notes`/`--quizzes`/`--tables`/`--files` to narrow it |
| `anydag board` · `anydag note` · `anydag quiz` · `anydag table` | one file as a whole, the same five for each kind: `new`, `cat`, `write` (under the `base` you read, or `--force`), `mv` (a rename, or a move with a `/`) and `rm` (to the trash). Beside them `anydag board diagnose`, `anydag quiz check` and `anydag table check` say what the parser thinks, with `--file` for a draft |
| `anydag folder` | `new`, `mv` and `rm` (`-r` for one with anything in it) — the folder goes to the trash whole |
| `anydag file` | attachments: `anydag file upload report.pdf --folder specs` prints its name and id, `anydag file ls` what there is and what this vault accepts, `get`, `mv`, and `rm`, which says what uses it first |
| `anydag trash` | what was deleted — every `rm` above moves a thing there for thirty days: `anydag trash ls`, `anydag trash restore <id-or-name>` (back where it was, with its id), `anydag trash rm` and `anydag trash empty`, which delete for good and ask first |
| `anydag sync` | this vault's end-to-end encrypted link to a sync server: `anydag sync status`, `anydag sync now`, `anydag sync devices`; `anydag sync pair <server> <code>` then `anydag sync link --upload`, `--download <remote>` or `--merge <remote>`, which ask for the passphrase with no echo (or `--passphrase-file`) — **the person's to run, never an agent's**, and an upload prints the recovery code once. Only in builds with the `cloud` switch on: an off build answers `anydag sync …` with one line saying so, and lists none of it in `anydag --help` |
| `anydag snapshot` · `anydag tidy` · `anydag board export` · `anydag note export` | the laid-out page — and a note as a PDF: `anydag note export <name> --format pdf -o notes.pdf`, the page's own print of it, embedded boards and all; `--format zip` is the text with every picture and attachment it names beside it |
| `anydag vault` | `anydag vault ls`, `open <path>`, `create <parent> <name>`, `close <id>` (`--forget` takes it off the list), and `anydag vault transfer <name> --to <id>` — every other command acts in the vault `--vault <path-or-id>` or `ANYDAG_VAULT` names, else the one opened last; nothing here ever deletes a folder |
| `anydag settings` | the app's preferences and the vault's, as `key=value` |
| `anydag telemetry` | whether this install sends anonymous logs and where: `anydag telemetry` says, and `on`, `off` or `ask` change it — **the person's answer, never yours to give**; MCP has no tool for it. Only in builds with the `cloud` switch on, like `anydag sync` |
| `anydag serve` · `anydag mcp` | serve a vault and the page to a browser; run the MCP server over stdio |

`anydag help` lists all of it, and `anydag help --json` is the same as data. The exit codes are the
snapshot script's: `3` the file moved under a whole-text write (read it again and redo it — the CLI
never sends your text over theirs), `4` the file has errors, `5` the page never became ready, `6` no
server, `7` no vault. Read `--help` before guessing a flag; text comes from `--file`, and stdin only
as `--file -`.

### Through the files

```bash
anydag vault ls                          # the vaults the running app has open, and their folders
anydag serve <folder>                    # if nothing is running: serves one vault and prints its URL
```

In this repository, `npm run dev` serves `boards/local/` behind Vite on :3500 (`curl -s
localhost:3500/api/health` says whether it is up). If nothing can be started, say so and stop — this
skill cannot draw anything without the page. Do not fall back to hand-writing SVG.

A file written into the vault is picked up by the app's watcher, whoever wrote it — that is the
loop. Writing through the routes works too, and is what the CLI does: `POST /__board/create`, and
`POST /__board/put?name=<board>` with the `base` from `GET /__board/get?name=<board>`. A route wants
the server's token (`x-anydag-token`, from `~/.anydag/server.json`); Vite's proxy and
`anydag` add it for you.

**Deleting a file on disk is for good**: the trash is the server's (`POST /__board/delete` moves a
document there, and every `rm` and `*_delete` goes through it), and an agent that removes a
`.board.md` with its own tools has removed it — so delete through the CLI or MCP when you can.

**A synced vault is an ordinary vault to you.** If `anydag sync status` says it is linked, a file you
write — through the CLI, MCP or your own tools — is pushed to the person's other devices like their
own edits, and a delete on disk is pushed as a delete, still for good. It is pushed by the app, or
by `anydag mcp`, while one is running; with neither, `anydag sync status` says the vault is resting
and `anydag sync now` pushes it. An edit that meets another
device's edit of the same lines leaves a `(conflict <device> <date>)` copy beside the file; read
both and tell the person rather than deleting either.

## The loop

1. **Pick the type.** Use the table below. Getting this wrong is the most expensive mistake here:
   an architecture diagram drawn as a flowchart reads as steps rather than things.
2. **Write** it — `board_write` or `board_create` over MCP, or `<vault>/<name>.board.md` on
   the files. See `references/board-format.md` for what goes in it either way. Give it a `title:`
   in its frontmatter: that, not `<name>`, is what the sidebar, the toolbar and every reference
   call it — the name is a path and a URL, which the person does not have to read.
3. **Render it.** Over MCP you cannot: call `board_diagnose`, hand over the `url`, and skip to 8.
   Through the CLI, or on the files — the CLI reaches the vault either way:
   ```bash
   anydag snapshot <name> -o /tmp/<name>.png             # whole board, and every problem it has
   anydag snapshot <name> --item <id> -o /tmp/x.png      # one diagram
   anydag board export <name> --item <id> -o out.svg     # one diagram as a standalone SVG
   ```

   Three themes: `paper` is the default, `paper-dark` is the dark one, and `neutral` is
   cool greys and system fonts. `--theme <name>` renders in another. A theme is the reader's
   setting, never part of a board: a `theme:` in frontmatter is ignored, so do not write one.
   They share every metric, so switching costs no re-layout.
4. **Read what it printed.** `anydag snapshot` exits `4` when the board has errors and prints one line per
   diagnostic: a stable code, the line in *your* board file, and a message.

   ```
   E_UNKNOWN_ID     8  bad: unknown id `nope`
   W_UNKNOWN_ICON   10 bad: no icon named "postgres-ql" — drawing the default for a store
   ```

   Branch on the **code**, never on the message — the message is written for a person and may be
   reworded; the code will not be. `E_*` stops the diagram drawing, `W_*` does not. `EB_*` is the
   board file itself (frontmatter, a fence line, an attribute) rather than the DSL inside it.
5. **Read the quality report.** Under the diagnostics, it prints what is wrong with the
   *drawing* rather than the text — measured off the layout the browser actually produced.

   ```
   quality: 2 finding(s) across 1 diagram(s)
   Q_EDGE_OVER_NODE           infra  e4 runs through `cache`, which is neither of its ends
   Q_EDGE_CROSSING            infra  e2 crosses e7, and they share no node
   ```

   These never change the exit code, and they are not all worth the same. Chase them in the order
   they print. A dialect that publishes no score says so — `quality: not measured` is not a pass:

   | Code | What to do |
   |---|---|
   | `Q_NODE_OVERLAP` | Never expected. Two cards on top of each other is a bug — say so rather than working around it. |
   | `Q_EDGE_OVER_NODE` | Worth fixing. A line through an unrelated card reads as a connection to it. Three things move it: a group, a different edge order, or **anchoring the edge on a row** so it leaves from a port at that row's height rather than from the card's edge (rule 9). |
   | `Q_LABEL_OVER_NODE` | Worth fixing. Shorten the label, or drop it if the arrow already says it. |
   | `Q_LABEL_OVERLAP` | Look. Two labels on one spot are unreadable; one of them is usually redundant. |
   | `Q_TEXT_CLIPPED` | Worth fixing. A sketch `box`, `text`, `button` or `input` was given a `w=` narrower than its title or meta, and the words are cut off at its edge. Widen `w=`, or shorten the string. |
   | `Q_EDGE_OUTSIDE` | Never expected. A line or its label reaches past the diagram's own box, where the page clips it — say so rather than working around it. |
   | `Q_WIDE_DIAGRAM` | Look. A diagram past 3:1 is one nobody can take in. The cheapest lever is `dir=TB` on the group holding the longest chain — it stacks that group instead of laying it along the diagram, and often halves the width on its own. Then splitting it. |
   | `Q_EDGE_CROSSING` | Judgement. A dense `usecase` or `class` diagram will always have some. **Reordering declarations will not help** — ELK minimises over the graph, not the file. Move a node between groups or lanes instead, and do not contort the board. |

   `Q_*` names the ids involved, not a line, because no character in your file decided where the
   layout put a card. Branch on the code here too.
6. **Read the PNG.** Actually look at it, even when nothing was printed. The report measures
   geometry it was taught to measure; it has no opinion on whether a label is clipped, an icon is
   wrong, a group says what you meant, or the diagram reads at a glance in the order you intended.
   That is still yours.
7. **Fix and repeat**, at most three rounds. Overwrite the same file — never `v2`.
8. **Hand over** the board path and the PNG path.

## Which type

| The question it answers | Type |
|---|---|
| What tables exist and how do they reference each other? | `erd` |
| Who does what, in what order, and where can it stop? | `flow` |
| What runs, what stores, and what calls what? | `arch` |
| What values can this field hold, and what changes it? | `state` |
| What happens at the same time as what? | `activity` |
| What types exist and how do they relate? | `class` |
| Who comes to this system, and what for? | `usecase` |
| What is separately deployable, and what is it built with? | `c4` |
| One conversation, in order, over time | `sequence` |
| How does an idea break down? | `mindmap` |
| What happens when? | `timeline` |
| What landed on which branch? | `gitgraph` |
| Where does the button go on the screen? Or: a circle, a diamond, a cloud, with words in it. Or: a picture of how it happens — a person, a phone, a parcel, a truck | `sketch` |
| How big is each, and how does it change? | `chart` |

**A `sketch` diagram, or any fence opened `layout=fixed`, is the user's geometry — append to it,
do not re-place it.** Everywhere else you describe structure and the layout computes the pixels
(`references/rules.md`), and that rule still holds. These two are the exception, stated in the file
itself: `sketch` is a vocabulary of shapes — `box` `text` `button` `input` `img` `sticky`, the
sixteen geometric ones (`circle` `ellipse` `triangle` `diamond` `hexagon` `pentagon` `octagon`
`star` `parallelogram` `trapezoid` `cylinder` `document` `stadium` `cloud` `callout` `arrow`), the
`figure` below, plus `group` as a container whose children are relative to it — and `layout=fixed` says the same thing
about any of the twelve types that are laid out for you. Adding to one means writing a new statement
with its own `x=`/`y=` clear of what is there; rewriting the coordinates somebody dragged is
destroying their drawing. Outside a fixed fence an `x=` is a `W_UNKNOWN_ATTR`, so this never happens
by accident. See `references/dsl/sketch.md`.

**A `figure` is a picture with a caption under it, for illustrating rather than diagramming.** A
person, a house, a book, a truck: `figure <id> "<caption>" icon=<picture>`, where the picture is any
emoji by its Unicode short name — `emoji:house`, `emoji:office-building`, `emoji:delivery-truck`,
`emoji:man-technologist` — in its own colours, `mono:emoji:<name>` in the figure's `hue=`, a Lucide
line drawing (`house`, `users`), or a logo. No `icon=` is a stick figure, and no caption is the
picture alone. It sizes itself, and a line into it meets the picture. When a brief tells a story
about people and things, a row of these joined by arrows says it better than boxes do:

    ```sketch {#order x=0 y=0}
    figure buyer "Customer" icon=emoji:person x=0 y=0
    figure app "Orders on the app" icon=emoji:mobile-phone x=200 y=0
    figure van "Delivery" icon=emoji:delivery-truck x=400 y=0
    figure home "Home" icon=emoji:house x=600 y=0
    buyer --> app
    app --> van
    van --> home
    ```

`icons` with `q` finds a picture's exact name, and a wrong one is
`W_UNKNOWN_ICON` naming the near miss. `house home "Home"` — a picture's name where the kind goes —
is `E_UNKNOWN_KIND` naming the figure you meant. See *Pictures* in `references/dsl/sketch.md`.

**A `chart` draws data rather than a system, and its size is yours.** The other thirteen say what
runs, what stores, what a record can become, where a box goes; this one answers *how much*, and
there is nothing
in it to lay out but a scale — so `w=`/`h=` on the fence *are* the chart, the way they are for a
note, and there is no `aspect` to fold. **The data is the statement**: a form word, an `x` line of
categories, and one `series` (a value per category) or `slice` (one value) line per thing being
measured, with the numbers written after the label and `-` for a gap.

    ```chart {#rev x=0 y=0 w=560 h=420 title="Revenue by quarter"}
    bar
    x Q1 Q2 Q3 Q4
    series web "Web" 120 140 160 180
    series mob "Mobile" 40 60 90 130
    unit "k€"
    ```

Colour is not yours to pick and usually should not be: a series with no `hue=` takes the next name
from the theme's own chart order, which is the one order proven to separate. **Read *Choosing a
form* in `references/dsl/chart.md` before deciding which of the four to draw** — a pie past six
slices, a line past four series, a truncated baseline and a number on every mark are the four ways a
correct chart still reads wrong, and none of them raises a diagnostic.

**Architecture draws nouns; workflow draws verbs.** If your nodes are "Extract the text", "Chunk",
"Embed", that is a `flow`. If they are "Ingest worker", "Vector index", "Ask API", that is an
`arch`, and the steps become the worker's rows.

## Building blocks and links

A board is not only diagrams. **Anything with no title is drawn bare** — an actor, a service, a
store standing alone, or a whole diagram nobody has named — no header, no type chip and no rule
over a card that already says what it is. A header is something you ask for: give the fence a
`title=` or a `subtitle=` and it draws one, whatever the diagram holds; leave both off and it draws
bare, whatever it holds too — a component keeps no header just because a second card joined it.

    ```usecase {#recruiter x=0 y=0}
    actor recruiter "Recruiter"
    ```

    ```arch {#cv x=0 y=200}
    service cv "CV parser" "mistral ocr" icon=server
    ```

A **link** joins two items, in an `edges` fence. It is the one line that can cross families: no
dialect has both `actor` and `service` in its vocabulary, so no dialect can hold the line between
them.

    ```edges {#links}
    recruiter --> cv "uploads a CV"
    cv -.-> stack.api "notifies" quiet
    bucket --> stack.db hue=teal
    ```

`stack.api` ends the link on a node *inside* the diagram `stack`, and lands on that card.
`references/dsl/edges.md` is the whole of it. A person can also draw one with the mouse, by
dragging from a handle on a selected item, which writes the same statement into the same fence.

`via="320,180"` bends a link through one point, in board coordinates, and the router stops choosing
its route. Write one only where the line the router drew is actually wrong; a person sets these by
dragging the handle at a picked line's middle, and a point you guessed at is one they will have to
undo. A diagram's own edges take none — those run between cards ELK placed.

**Reach for a bare node when the thing has no diagram to be in** — a piece of the picture you are
still assembling, or one that belongs to two of them. Reach for a diagram when the nodes share a
grammar and the layout should be automatic. Leave title and subtitle off unless you are naming the
drawing for a reader — most things on a board should not wear a header at all. `frame=full` puts a
header on anything, titled or not; `frame=none` takes it off anything, titled or not.

## The library

Everything droppable is a **blueprint**, each layer composed from the one below it:

| Layer | Is |
|---|---|
| 0 | **atom** — one statement of one dialect |
| 1 | **molecule** — a container with something in it |
| 2 | **pattern** — several of those, wired together |
| 3 | **diagram** — a whole board item |
| 4 | **stack** — several items, moving together |

`GET /__board/library` serves every blueprint's *rendered* text, not its template — `?type=arch`
narrows it to one dialect, `?id=<blueprint>` fetches one by id — plus `saved`, the user's own
components under `<vault>/components/` (the same list `GET /__board/components` returns), so one
fetch answers "what is there to reach for" instead of two.

Reach for one before writing from the cheat sheet: a starter or a pattern is faster and more
consistent than typing the grammar out by hand. Prefer a saved component over a built-in blueprint
when its name matches what the brief asks for — it is the user's own vocabulary, and reusing it is
how a board stays readable to them. A `sketch` atom — `box`, `text`, `button`, `input`, `img`,
`sticky`, or any of the sixteen geometric shapes — is how you put a plain shape on the paper with no
diagram around it. One shape alone in a fence *is* the item: its words go inside it, a link in an
`edges` fence may name the fence's own id (`api.svc --> db`), and a line meets its outline rather
than the box around it.

The panel opens on **Generate** — the prompt card, below — then **Shapes**, **Objects** and
**Charts**: the `sketch` vocabulary; the pictures, one `figure` each, on shelves (*Drawn*,
*Essentials*, then every emoji by what it is); then a working chart of each of the four forms plus
a bare `series` and `slice` to append to a chart that already exists. *Yours*, *Notes*,
*Diagrams*, *Patterns*, *Parts* and *Atoms* follow. **The pictures are not in a plain listing** —
seventeen hundred entries of one statement shape — so `GET /__board/library` leaves them out and
says how many it left out (`objects`), and `?q=` searches them with everything else:
`?q=truck` answers with `object-delivery-truck`, whose text is `figure delivery-truck1
"Delivery truck" icon=emoji:delivery-truck`.

**A `prompt` fence is a person's request, not content.** It holds a description of a diagram; the
person presses Generate and a model on the dev server replaces the card with the diagram. If you
find one on a board, leave it for them — or, if they ask you to draw it, write the diagram yourself
and delete the card, which is exactly the edit Generate would have made. Never hand-edit a card's
body into DSL in place: it is not parsed as a diagram and will not draw as one.

## Writing a note

A **note** is a file of its own, not something on a board: any plain `<vault>/<name>.md` (an older
`<name>.note.md` opens as one too), listed and foldered beside the boards, opened full-window at `?note=<name>`, where a person writes in a
block editor — headings, lists, check items, tables, code, images, a `/` menu. Write one when what
was asked for is prose — a spec, meeting notes, a plan, a write-up — rather than a picture.

    ---
    title: Onboarding
    ---
    Wrap lines however you like: a wrapped line is one paragraph, exactly as on a board.

    - [ ] a check item
    - [x] a done one

It is plain GitHub-flavoured Markdown with optional frontmatter; `title:` there is what the sidebar,
the toolbar and every reference call it, and every other key is carried untouched. **The title is
drawn as the page's own heading**, above the text, where a person edits it and renaming it renames the
file — so do not open the text with a `#` line repeating it; a note with no `title:` shows an empty
title asking for one. What the editor holds:

| Block | Written as |
|---|---|
| `paragraph` | plain text, **bold**, *italic*, ~~strike~~, inline code, links |
| `heading` | `#` to `######` (the menu offers three) |
| `bulletListItem` | a `-` or `*` item, nested by indent |
| `numberedListItem` | a `1.` item |
| `checkListItem` | a `- [ ]` or `- [x]` item |
| `quote` | a `>` line |
| `codeBlock` | a fenced block, with its language — drawn as its label (`text` when it names none), beside a copy button, and coloured by it; Python, JS, JSON, YAML and CSS are also checked, and a block they cannot read says how many syntax errors beside its label |
| `divider` | a `---` line |
| `table` | a GFM table; centred and right-aligned columns are kept |
| `image` | `![alt](attachments/file.png "caption")`, relative to the note |
| `embed` | `![Title](dag:<id>)` on a line of its own — a board drawn inside the note, another note as a card, an attachment's picture inline or its card |
| `equation` | `$$` on a line, the TeX, `$$` on a line — or a ```` ```math ```` fence — drawn centred by KaTeX |

**Equations are TeX between dollars, everywhere Markdown is drawn** — a note, a board's text card, a
quiz: `$x^2$` in a line, and `$$\sum_i x_i$$` written mid-line is drawn centred on a line of its own.
A single `$` follows Pandoc's rule, so a price stays a price: the dollars must hug the formula — no
space just inside either one, and no digit straight after the closing one — and `\$` is always a
dollar. So `$5 and $10` is text and `$W_Q$` is an equation. A formula KaTeX cannot read is drawn as its
TeX, underlined; `\color` draws in the ink, because the theme owns the colour.

Anything else Markdown can say — raw HTML, footnotes, a definition — is kept exactly as you wrote it
for as long as nobody edits that block, and becomes plain text in it if somebody does.

**Only the block a person edits is rewritten**, into the house form (`-` bullets, `*` emphasis,
unwrapped lines), so their edit to one paragraph never shows up in a diff of another you wrote — and
a paragraph of yours they edited comes back unwrapped. That is by design. A write of yours while a
note is open lands in the editor as it stands, and one that crosses theirs is merged line by line.

**A task is a note with a `status:`** — `todo`, `in-progress` or `done` — and an optional `due:`
date, and nothing else marks one. It is listed with the notes, drawn with its status in the sidebar,
and gathered on the Tasks page (a list, and a board of three columns); its body is its description,
written exactly as any note's.

    ---
    title: Ship the pricing page
    status: in-progress
    due: 2026-10-03
    ---
    The copy is in [Pricing draft](dag:7q2m9xk4tb).

Write the three words as they are: `doing`, `blocked` or `closed` is not a status, and a note saying
one is not a task. A `due:` is `YYYY-MM-DD`; a due date without a status is ignored. A `start:`, also
`YYYY-MM-DD`, is the day it begins, and the calendar spans the task from one to the other. To change
one without touching the text, `POST /__board/task {name, status?, due?, start?}` (`null` takes a line
out, and all three `null` make it a plain note again) or the `task_set` tool. On a board, a task's embed
card draws its status as a button that changes the file.

**An event is a note with a `start:` and no `status:`**, and an optional `end:`. A date is all day and
a time is a time — there is no `all-day:` key — and an all-day `end:` is the last day, inclusive:

    ---
    title: Team offsite
    start: 2026-10-03T09:00+02:00
    end: 2026-10-03T17:00+02:00
    ---
    Agenda, the address, who is bringing what.

    ---
    title: Conference
    start: 2026-10-12
    end: 2026-10-14
    ---

**Through the route, a tool or the CLI, write the time the person asked for and no offset** —
`2026-10-03T09:00` — and it is written with the offset of **their** time zone on that date: the one
chosen in Settings → Calendar, or their browser's (the time zone `whoami` and `event_list` report,
`zone` in `/api/auth/me`). Never guess an offset from a city: zones move — Casablanca left `+01:00`
for `+00:00` on 2026-09-20 — and a wrong guess draws the event an hour off. An offset you do write is
kept as the moment it names; a time without one is given the zone this machine is in. **In a file
written by hand, write the offset** (`+02:00`, or `Z`): one without is read as that wall-clock time
wherever it is viewed. The calendar shows every time in the viewer's zone. An `end:` in the other form from its `start:` is no end; without one, a timed event
is an hour. A `status:` makes the note a task instead, whose `start:` is its start date.
`POST /__board/event {name, start?, end?}` or the `event_set` tool changes it without touching the text.
The Calendar page (`?calendar=1`) draws tasks, events and notes together — a note on the day it was
made, which is the store's record (`created` in `/__board/list`), never a line in the file.

**A project is a folder holding a note with a `project:`** — `active`, `paused` or `done` — and an
optional `hue:`, one of the ten hues. The note is the project's description; everything under its
folder, subfolders included, is in the project, and the Tasks page filters by it. Nothing else joins
one: a reference to a project's note links to it and does not enrol anything.

    work/pricing/pricing.note.md
    ---
    title: Pricing relaunch
    project: active
    hue: coral
    ---
    Why we are doing this, and where things are.

One project note per folder; with two, the first by name is the folder's. A project note at the top
level makes nothing a project. Nested projects are allowed, and a document's project is the
innermost. `project_create` writes the note; `POST /__board/project {name, status?,
hue?}` or `project_set` changes the two lines without touching the text.

**A note and a board reference each other by id.** Every board and note has a permanent id — `id:`
in its frontmatter, written when the app makes the file or the first time something links to it,
and unchanged by a rename or a move — which `GET /__board/index` lists
beside each one's title and the references it makes (MCP's `board_list` carries the ids too). A
reference is a Markdown link to `dag:<id>`:

    See [the architecture](dag:k3f9x2m1qa) before changing the cache.

    ![The architecture](dag:k3f9x2m1qa)

The first is a link that shows the target's **current** title; the second, on a line of its own, is
an embed — a board drawn read-only inside the note, pannable and zoomable. On a board, an `md` card
whose body is `![Title](dag:<id>)` draws a card of one fixed size naming that note, task or board —
its title, what it is, and a button that opens it, never the note's text — so give it `w=360` and no
`h=`. The words in the brackets are only
a fallback; write the title as it is now. `dag:<id>#^name` points at a block of a note carrying the
anchor ` ^name` at the end of its last line — add one only when you are pointing at it — and
`dag:<id>#<item>` at one item of a board, which opens with the view on that item and it selected.
To find where something was written, `GET /__board/corpus` is every board's items and every note's
blocks as plain text, each with the part a link names (the item id, the `^name`, or `L<line>` for a
block nothing has anchored) — the same answer the app's search matches against. A person
gets the same with `@` or `[[` (a reference) and `![` (an embed), and every board and note lists
what links to it. A vault's own `[[wikilinks]]` work too, as in Obsidian — `[[Meeting notes]]`,
`[[Projects/Plan#Budget]]`, `[[Plan|the plan]]`, `![[diagram.png]]` — followed by name, counted as
backlinks, and kept naming their document when it is retitled, renamed or moved — or its folder
moved — through the app, the CLI or MCP, which rewrite them as Obsidian does (on unless the vault
turned it off in Settings → This vault → Files and images; the route's answer says `relinked`). A file moved on disk outside
the app takes its links nowhere. Write one when the folder is somebody's Obsidian vault, and a
`dag:<id>` link when the target may be moved outside the app. A ` ```note ` fence on a board is something else — the tinted text card — and has
nothing to do with this. A board and a note cannot share a name in one folder; the
second one made is numbered. A new note is named after its title, verbatim. Through the API rather than the disk: `POST /__board/create {name,
text, kind: "note"}`, `GET /__board/get?name=…&kind=note`, `POST /__board/put?name=…&kind=note
{text, base}`.

## Attachments

An **attachment** is any file somebody keeps beside their boards and notes — a PDF, a picture, a
spreadsheet, slides, audio, video, an archive — listed and foldered with them, opened at
`?file=<name>`, and, like every document, given a permanent id. Its name keeps its extension
(`specs/q3-report.pdf`); what it is *called* (`Q3 Report.pdf`) is its title, and the extension is
what decides its type. Keep one with `file_upload` or `anydag file upload`; `file_list` says the
largest file and the types this vault takes, and anything else is refused with why.

Refer to one by its id, exactly as to a board or a note. In a note, `![Q3 Report.pdf](dag:1eaj124s6h)`
on a line of its own draws a picture inline and anything else as a card to open or download, and
`[the report](dag:1eaj124s6h)` is a link to it anywhere in prose. On a board a picture is an `image`
fence whose `src` is the reference, and anything else is an `md` card holding the embed:

    ```image {#chart src="dag:vbety0hbap" w=480}
    ```

One file, referred to from as many places as you like; nothing is copied. **New attachments go into
the vault's `attachments/` folder**, a pasted screenshot included; an older `<name>.assets/` beside a
document is still read, never written. On disk an attachment is simply the file; through the API it is
`POST /__board/file?name=<file>&folder=<folder>` with the bytes as the body.

## Writing a quiz

A **quiz** is the third kind of file: `<vault>/<name>.quiz.md`, listed and foldered beside the
boards and notes, opened at `?quiz=<name>` in a form of its own, and practised there. Write one when
what was asked for is questions somebody will answer — revision for an exam, a check after a
training, a drill. It is strict Markdown:

    ---
    title: Postgres internals
    ---

    Anything before the first question is the quiz's description.

    ## What does VACUUM reclaim? {#q7f3a2}

    Anything between the heading and the options is the rest of the prompt: a paragraph, a code block.

    - [ ] Index bloat only
    - [x] The space of dead tuples
    - [ ] Old WAL segments

    > The explanation, shown once the question has been answered. Optional.

    ## Which fields decide a row's visibility? {#q2b91c}

    - [x] `xmin`
    - [x] `xmax`
    - [ ] `ctid`

    ## Which query lists every member? {#q5d3a1}

    - [x] The one with no filter
      ```sql
      select * from cd.members;
      ```
    - [ ] The one with a filter
      ```sql
      select * from cd.members where memid > 0;
      ```

- **A question is a `##` heading and everything up to the next one.** A `#` or `###` inside it is
  prose, and so is anything in a fenced code block.
- **The options are one checklist**, `[x]` for each correct one: two options at least, one correct
  at least. One ticked asks for one answer; several ask for all of them; `{#id multi}` asks for all
  of them when only one is right.
- **An option is Markdown, and may run over several lines**: every line indented under it (two
  spaces) is the option's, blank lines and fenced code blocks included. When the answers are
  snippets — which query, which config, which function — put each snippet *in its option*, as
  above, rather than in the prompt labelled A to D: the run draws it beside its checkbox.
- **`shuffle: true` in the frontmatter shows each question's options in a fresh order every run**,
  so a question in Mistakes cannot be passed by remembering where its answer was. An option ending
  in `{pin}` keeps its place, and so does one that begins *All of the above*, *None of the above*,
  *Both* or *Neither*. Off by default; the sheet a snapshot draws keeps the written order.
- **The explanation is one `>` quote after the options.** Anything else after the options is refused.
- **A question with no checklist and a `>` quote at its end is an open question**, answered in
  words: the run gives a text box (a code box when the quote holds a code block), then shows the
  quote as the model answer, and the person says whether they had it — which is what goes into
  Mistakes. Nothing grades the words. Write one when the honest question is "write the query" or
  "explain why", rather than inventing three wrong answers:

      ## List the members who joined after September 2012 {#q8e1f0}

      The table is `cd.members`.

      > ```sql
      > select * from cd.members where joindate >= '2012-09-01';
      > ```
      >
      > `>=` keeps the first day itself.

- **`card` on the heading makes an open question a flashcard**: the run shows the front with no box
  to type in, the person thinks of the answer, shows the back (the quote), and says whether they had
  it. Write cards for terms, definitions and facts to recall, a quote of a paragraph or less as the
  back. A bare word, beside the id — `{#q… card}`, never `.card` — and no checklist:

      ## What is MVCC? {#q3c9d2 card}

      > Multi-version concurrency control: each transaction reads a snapshot, so readers never
      > block writers.

- **A person can have a model write flashcards in the app**: the quiz page's *Generate flashcards*
  takes a topic or one of their notes, shows the cards with a box each, and adds only the ones kept.
  You write cards yourself — from a note you read with `note_read`, with `quiz_question_set` — and
  `generate` with `kind: "flashcards"` is for when the person asks for *their* model to do it; show
  them what comes back and add only what they keep.
- **`{#id}` names the question**, and a person's record of it is kept against that name, so keep an
  id when you rewrite a question and never reuse one for a different question. You may leave it off
  — `q` and six characters are written in the first time the quiz is edited or answered — but when
  you rewrite a quiz that already has ids, carry them over.

`anydag quiz check <name>`, `quiz_check`, or `quiz write`, prints what is wrong with its line. Branch
on the code:

| Code | Means |
|---|---|
| `EQ_NO_PROMPT` | a `##` with nothing but its `{…}` |
| `EQ_NO_OPTIONS` | no checklist under a question, and no `>` quote ending it to make it an open question — or a `card` with no back |
| `EQ_ONE_OPTION` | only one option |
| `EQ_NO_ANSWER` | no option ticked `[x]` |
| `EQ_EMPTY_OPTION` | a `- [ ]` with no text |
| `EQ_STRAY` | something after the options that is not the one `>` explanation |
| `EQ_DUPLICATE_ID` | two questions with one `{#id}` |
| `WQ_NO_ID` | a question with no id yet — fine, one is written in later |
| `WQ_UNKNOWN_ATTR` | a word in the heading's `{…}` other than `#id`, `multi` and `card`; `multi` on an open question or a card; `card` on a question with options |
| `WQ_OPEN_FENCE` | a code block never closed, so everything after it is code |
| `WQ_EMPTY` | no questions yet |

**A course is a folder of quizzes**, one per topic, and it is practised as one run as well as quiz
by quiz: the folder's menu in the sidebar has *Practice the quizzes* (`?quizzes=1&run=folder:<path>`), which asks every quiz under it — subfolders too — in the order the
sidebar shows them, so name them so they sort (`1 · Basics`, `2 · Joins`, … `10 · Windows`).

What somebody answered is theirs, not the file's: a question they missed goes into **Mistakes**, and
leaves it once they get it right twice in a row there (a number they can change in Settings). None of
that is in the quiz, and nothing you write changes it — but deleting a question takes it out of
Mistakes, and changing its id starts its history again. Through the API: `POST /__board/create {name,
text, kind: "quiz"}`, `GET /__board/get?name=…&kind=quiz`, `POST /__board/put?name=…&kind=quiz
{text, base}`. A quiz is embedded on a board as `![Title](dag:<id>)` in an `md` card, like a note.

**A board is drawn inside a quiz**: `![The schema](dag:<board id>)` on a line of its own in the
description, a question's prompt, an option of more than one line or the explanation is the board
itself, read-only and fitted to the question's width — so a schema question shows the `erd` and a
system-design question its `arch`. Draw the diagram as a board first, then embed it by its id; never
hand-draw an SVG of something AnyDag can draw.

## Writing a table

A **table** is the fourth kind of file: `<vault>/<name>.table.md`, listed and foldered beside
the others, opened at `?table=<name>` as a grid. Write one when what was asked for is data — rows of
things with the same fields: a pipeline, an inventory, a list of people, the numbers behind a chart.
It is Markdown, a GFM pipe table per tab:

    ---
    title: Q3 pipeline
    ---

    Anything before the first tab is the table's description.

    ## Deals {#deals sort="amount:desc" filter="stage!=Lost"}

    | Name {#name} | Amount {#amount number} | Close {#close date} | Won {#won checkbox} | Stage {#stage select options="Lead,Won,Lost"} | Site {#site link} |
    | --- | ---: | --- | --- | --- | --- |
    | Acme {#racme} | 1200 | 2026-10-01 | [x] | Won | [acme.com](https://acme.com) |
    | Globex {#rglo} | 800 | | [ ] | Lead | [Pricing draft](dag:7q2m9xk4tb) |

- **A tab is a `##` heading and the first table under it.** Its `{#id}` names it; `sort="…"` and
  `filter="…"` are how it is shown, and never move a row.
- **A header cell is a column**: its name, then `{#id type}`. The type is `text` (the default, not
  written), `number`, `date` (`YYYY-MM-DD`), `checkbox` (`[x]` / `[ ]`), `select` (with
  `options="a,b,c"`, or without — then its options are the values it holds) or `link` (`[words](https://…)`,
  `[Title](dag:<id>)` for a reference to a board, a note or another table, or a bare URL). `w=160`
  is a width somebody dragged.
- **A row's first cell ends `{#id}`**, and `h=` when somebody dragged it taller. A cell is one line:
  `\|` for a pipe, `<br>` for a break. No formulas — a cell holds a value.
- **Sort** is column ids, each `:asc` or `:desc`: `amount:desc, name`. **Filter** is rules joined by
  `;`, all of which must hold — a column id, `=` `!=` `~` (contains) `!~` `>` `>=` `<` `<=`, a value:
  `stage!=Lost; amount>=1000`. `col=` alone is *is empty*, `col!=` *is not empty*.
- **Ids are what everything addresses.** Leave them off and they are written in the first time
  anything writes the table — a tab's and a column's are its name's slug, a row's `r` and five
  characters — but keep them when you rewrite one, because a sort, a filter, a card on a board and a
  reference name them. Don't pad the columns to line up: a person's edit rewrites one row, and a
  padded table only looks aligned until then.

To change a few cells, don't rewrite the file: `table_edit` sends ops by id and is re-applied to whatever a person wrote meanwhile. `anydag table check
<name>`, `table_check`, or `table write` print what is wrong. Branch on the code:

| Code | Means |
|---|---|
| `ET_DUPLICATE_ID` | two tabs, or two columns or rows of one tab, with one `{#id}` |
| `WT_NO_ID` | a tab, column or row with no id yet — fine, one is written in later |
| `WT_UNKNOWN_ATTR` | a word in a `{…}` that means nothing there — often a type that is not one of the six |
| `WT_CELL` | a value its column cannot read, like a word in a number column; kept and drawn as written |
| `WT_ROW_WIDTH` | a row with more cells than the header; the extra ones are ignored |
| `WT_STRAY` | something under a tab that is not its table |
| `WT_BAD_SORT` | a sort naming a column the tab does not have |
| `WT_BAD_FILTER` | a filter rule that does not read, or names a column the tab does not have |
| `WT_OPEN_FENCE` | a code block never closed, so everything after it is code |
| `WT_LOOSE_TABLE` | a table above the first `##`, which is description and no tab |
| `WT_EMPTY` | no tabs yet |

A table goes on a board as `![Title](dag:<id>)` alone in an `md` card — a live view of its first
tab's first ten rows as that tab shows them, or `![Title](dag:<id>#<tab>)` for another tab — placed
`w=560`, wider for more columns; a person double-clicks it to open the table. Through
the API: `POST /__board/create {name, text, kind: "table"}`, `GET /__board/table?name=…` for the
data, `POST /__board/table {name, ops}` for an edit.

## The grammar

`references/dsl/common.md` first — the statements every type shares (nodes, groups, lanes, edges,
flags, the legend). Then the one file for your type in `references/dsl/`. Each cheat sheet's example
is the matching board in `references/examples/`, which renders.

Both of those are symlinks into the AnyDag repo — the sheets live beside the parsers that
implement them (`docs/dsl/`) and the examples are the boards the test suite renders, so neither can
drift from the code. A running dev server serves the same sheets at `GET /__board/dsl` (all types)
and `GET /__board/dsl?type=arch` (one).

## The rules

`references/rules.md`. They are what make the output look considered rather than generated. Several
are enforced in code (hue inheritance, edge hue, danger styling, the unknown-icon warning); the
rest are on you.

## Redrawing a screenshot

Read the image, then in order: name the diagram type out loud, list the nodes with their kinds, list
the groups, list the edges and their markers, and only then write the DSL. Snapshot, and compare
side by side. Do not try to match pixel positions — layout is automatic and matching structure is
the goal.

## What it will not do

- Hand-placed coordinates inside an ordinary diagram. Positions of *items on the board* are yours
  (`x=`, `y=`); positions of nodes inside a diagram are the layout's — unless the fence says
  otherwise with `layout=fixed`, or the type is `sketch`, where they are the author's and yours to
  leave alone.
- Freehand drawing, or diagram types not in the table.
- Rerouting anything. The quality report says an edge runs through a card; nothing moves it for you.
- **Seeing the drawing, over MCP.** There is no `board_snapshot` and no `board_tidy`: both measure a
  laid-out page in the real webfonts, and the MCP server has no browser. Hand over the `url`, or run `anydag snapshot` from a shell.
