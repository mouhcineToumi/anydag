# Overview

> What AnyDag is, the three ways to run it, and the mark.

## AnyDag

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
Settings → Privacy changes the answer. They go to an api server's `POST /v1/logs`. See *Logs*.

**Three ways to run it.** The desktop app (`desktop/`, Electron) spawns the server and loads the page
through its own `anydag://` scheme, adding the token from the main process. `anydag serve <folder>`
(`node server/dist/anydag-server.mjs <folder>`) serves the page to a browser on this machine. And
`npm run dev` → <http://localhost:3500/?board=demo> is Vite in front of that server on `boards/local/`,
with `.dev-home/` as the app's home. See *The local server* and *The desktop app*.

**The mark is drawn once, by `scripts/brand/mark.mjs`, and written everywhere it appears:**
`src/ui/markPaths.ts` (which `src/ui/Logo.tsx` fills with `currentColor` and
`var(--dag-color-accent)`, because no colour may appear in `src/`), the favicons in `public/` and
`site/assets/`, the logos and wordmarks in `docs/assets/` and `site/assets/`, and, through
`rsvg-convert`, `desktop/icon.png` and the two `apple-touch-icon.png`. Change the script and re-run
it; never hand-edit one copy. The mark is a brush-pen drawing, so every line in it is a filled
outline rather than a stroke: the line lands light, swells through the loop and lifts off to a point
short of the dot, and the frame tapers where it starts and ends at the opening. It thins toward the
dot rather than swelling, which is what keeps it reading as drawn rather than thrown. There are two
cuts: the full mark, and the favicon cut (a heavier pen with less contrast, one turn of the coil, a
wider opening), because below about 20px the full mark's thin ends disappear and its gap fills in.
**The frame is open, never a `<rect>`** with the line drawn over it: the two open ends are the mark,
and anything that "tidies" them closed has destroyed it. `site/assets/og.png`, the social card,
carries the wordmark too and is not generated; recapture it with the site's screenshots.
`index.html` points at a real icon file because the Playwright run fails on any console output and a
full Chromium asks for one; an icon that 404s would fail the gate.
