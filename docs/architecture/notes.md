# Notes and equations

> The `.note.md` format, the block editor that never writes a byte, the two writers and the merge; TeX between dollars.

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

**A frontmatter is a block that is one** (`src/note/front.ts`, #397). Two `---` lines are also two
Markdown rules, so the pair at the start of a file is a frontmatter only when YAML reads what is
between them as a mapping, or there is nothing but blank lines between them, or — a frontmatter
somebody broke, still carried byte for byte — YAML cannot read it but its first line is a `key:`
line. A body that opens with a rule, a sentence, and another rule is all body: drawn, searched and
linked as such. Every reader and writer of a note's frontmatter asks `frontBlock` — `splitNote`, the
task, project, event, tag, title and id readers and their writers, `fillTemplate`, the index and a
rename's relink — so a writer never puts a `status:` line into text the page draws as the body; it
grows a frontmatter above the rule instead.

Nine things are load-bearing:

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
  **A block that was typed into keeps the bytes on either side of it**: the gap before it and after
  it are the loaded ones while both neighbours stand where they did, so a CRLF note keeps its CRLF
  around an edit (#416), with a blank line added only where a rewritten block needs one. **A
  byte-order mark is kept and never read**: `splitNote` carries it in `front` (with the frontmatter
  behind it, or alone), `frontBlock` finds a frontmatter behind it, the writers work behind the
  mark (`src/note/bom.ts`), and `load` parses past it, because remark counts from past it (#394;
  *Things that will bite*).
- **The schema is the Markdown's.** Thirteen blocks and four marks, `NOTE_BLOCKS`/`NOTE_STYLES`, and
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
  theirs*, and writes nothing until it is answered. **The read that opens a note is never left
  blank**: a 5xx or no answer at all is not "there is no such note", so the page draws `FileProblem`
  with the unreadable or unreachable reason and reads again on the save's own backoff (#123, #201).
  A 404 is the one answer that says the note is missing, and that card offers to search for it,
  look in the trash or go home.
- **One namespace, a `kind` beside the name.** A vault is a folder, so a name is one file:
  `server/names.ts` classifies a path by its suffix (`.board.md`, `.quiz.md`, `.table.md`, `.md` or
  `.note.md` for a note) and refuses a second file that would give a name two kinds. The
  routes take `kind=note` under `/__board`, and the four that are grammar never ask for a note, so
  they 404 one without a line of their own. `POST /__board/upload` stores an image and writes
  nothing. The feed says `dag:note`, so no board listener learned to ignore anything. `texts` keys a
  note by its file name, so the unused-image sweep sees what a note names and nothing mistakes one
  for a component, and a note may not live under `components/`.
- **The editor is a chunk of its own, and the text never waits for it.** BlockNote, TipTap,
  ProseMirror and Mantine are imported dynamically (`src/blocks/index.ts`), so a board never loads
  them, and `?snapshot=1` of a note draws it through `react-markdown` read-only — a
  picture of a note is a fact about the file. The 45 visual baselines are therefore untouched by
  construction. On the note's page that same read-only drawing (`data-dag-note-first`) stands in
  for the editor until it is ready, with the editor mounting hidden under it and the two changing
  places in one render; the first editor a page builds is mounted only after the text has been
  painted, because BlockNote's first build costs several times any later one. `useBlockEditor`
  hands the component over synchronously once it has loaded — **not `React.lazy`**, whose first
  render suspends even for a loaded module and is then held back by React's 300 ms reveal throttle,
  which was the whole of a slow first open (#120; *Things that will bite*). `data-dag-ready` still
  means the editor is up. The contenteditable carries the note's title as its `aria-label`, set on
  ProseMirror's own element rather than on a wrapper that would name the wrapper and leave the
  field unnamed. Mantine is **8**, not 9: 9 wants React 19.
  Beside it is `FieldEditor`, the one-field editor a quiz's form mounts (see *Quizzes*): the note's
  bridge, paste (`src/blocks/paste.ts`), references and equations, on a schema cut to
  `FIELD_BLOCKS`. A quiz's field is still a `React.lazy`, so the throttle above applies to it; a
  board card's text uses `CardFieldEditor`, which keeps the module and hands it over in the render
  that asks for it once it has come (#120, #557).
- **The colours are the theme's.** `className="dag-blocks"` lands on the editor and on every menu
  BlockNote portals out of it, and `src/styles/blocks.css` sets each `--bn-*` from a `--dag-*` there,
  two classes and an attribute deep so it wins whichever stylesheet loads last. It is chrome in
  `chrome.css`'s sense — off the length list, on the colour rule — and invents no `--dag-*`.
- **The line after the last block is the editor's, not the file's.** A note that ends in a picture, a
  table or a code block has no text under it to put a caret in. The writing page is therefore tall
  enough to fill the window (`dag-note-view__page--write`) and the strip under the text
  (`dag-note-view__tail`, `data-dag-note-tail`) writes the next line: a press there, or ArrowDown at
  the very end of the document — taken in the capture phase, because BlockNote's own trailing block
  takes that key and stops it without doing anything — puts the caret in an empty paragraph after the
  last block (`afterLast` in `BlockEditor.tsx`). **An empty paragraph at either end of the note is
  the editor's and writes no bytes** — this one, the one Enter in the title opens above the first
  block, the one an empty note opens as — so a press below the end and a leave is the file it was,
  which `e2e/notes.spec.ts` checks by bytes. A board's `md` card is not this page — `FieldEditor`
  draws in the card's own box, and a press outside that box closes the card (`editing.md`).
- **An empty line between two blocks is `&nbsp;` on a line of its own** (#318). Markdown has no empty
  paragraph — any number of blank lines is one break — so an Enter pressed twice between two
  paragraphs used to write nothing and was gone the next time the note opened. Now `toMdast` writes
  an empty paragraph that is not at either end as a paragraph holding only
  `&nbsp;` (`BLANK`), and `nodeBlocks` reads a paragraph whose source is exactly that entity back as an
  empty paragraph; three empty lines are three `&nbsp;` paragraphs. The edges are cut twice: `inner`
  drops the empty paragraphs at either end of what `blocksToMd` is given (only at the end of a block's
  nested children, which follow its own text), and `saved` drops the groups at either end of the
  document that are empty paragraphs **and no loaded unit** — so a `&nbsp;` the file already held,
  last line included, is written back as it was, while the editor's own empty lines never reach it.
  An empty paragraph that is a group of its own is serialised with `groupMd`, never `blocksToMd`,
  which would take it for an edge.
  **Why `&nbsp;`:** a no-break space is a character, so the line is a real paragraph to every
  Markdown reader — GitHub, Obsidian, `react-markdown` in the read-only view, the PDF and a board's
  `md` card all draw it as an empty line of the same height the editor shows — and it is the form
  people already type by hand for exactly this. It is ASCII, visible in a diff, and reads as itself
  in a plain-text editor. **Turned down:**
  - *Counting blank lines* — three blank lines in the file opening as two empty paragraphs. It would
    keep the file free of markup, but it gives the editor a meaning nothing else agrees with: every
    other renderer draws three blank lines as one break, so the note would look different in the
    editor than in `?view=1`, on GitHub and in a snapshot, and every file an agent or another tool
    wrote with a stray double blank line would open with empty paragraphs it never meant. Those
    files must open as what they draw as, and keep their bytes, which they do: the blank lines are a
    unit's `gap`, written back untouched.
  - *`<br>` on its own line* — an HTML block. `react-markdown` drops raw HTML unless it is trusted
    (we do not trust it), so the read-only view, the PDF and a board card would draw nothing where
    the editor draws a line; and the bridge already keeps any other HTML block as the text it was,
    so `<br>` would have to be the one tag that is not.
  - *A lone `\`* — CommonMark's hard break needs text after it on the next line; alone it is a
    literal backslash, drawn as one.
  - *An HTML comment or a zero-width character* — invisible in every renderer, so the line would be
    there in the editor and nowhere else, and a zero-width character is invisible in a diff too.
  **The cost:** a literal `&nbsp;` typed as the whole of a paragraph is read as an empty line, not
  as the entity, and a paragraph holding only U+00A0 typed as the character is still that character.
  `test/note-markdown.test.ts`'s *empty lines* holds the round trip, the edges and the untouched
  file; `e2e/notes.spec.ts` holds the issue's steps.

**A note exports from the top bar** — a PDF through the browser's print, or its own
`.note.md` — and a PDF is the file drawn read-only, never the editor's DOM; see *Import and export*.

**A note's title is the first thing on its page**: a field above the text holding the
frontmatter's `title:`, or — when the file has no line — the leaf of its name, which is what the note
is called everywhere. Committing it, on Enter or on leaving the field, is `/retitle` with `follow`,
and the file's name follows. A task's page is a note's page, so a task has one too, above its bar.
Four things about it:

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
  *Untitled* again. **A note with no `title:` line is called by the leaf of its name** (`pageTitle`),
  because `/create` keeps a title once, in the file's name, and drops the line when the two agree:
  an event made from the calendar, a task typed into the Tasks page and a note made from the sidebar
  with a title all show that name on their own page. A file still in the `Untitled` family — the
  word, or the number `unique()` gave it — has no name to show yet and keeps the placeholder.
- **A new note is named here, not in its sidebar row.** `nameWhenOpened` marks the name before the
  page opens and the page focuses its title once, when it does. A board and a quiz have no page
  title and are still named in their rows.

The read-only note — `?view=1`, `?snapshot=1` — draws the title as the page's `<h1>`
(`NoteTitleRead`), at the field's size and place; the PDF has its own, `dag-print__title`.

**A note's tags are a row under its title**, with a task's and an event's other properties, and a
plain note has the row too (*Tags* in [`tasks-projects-calendar.md`](tasks-projects-calendar.md)).
They are the frontmatter's `tags:`, read by `tagsOf` and written by `withTags` (`src/note/tags.ts`),
and the row writes **through the note's own save**, as the task bar does: the page rewrites the
frontmatter `NoteView` holds and `put`s it, so a tag added while somebody types is one write, not an
outside writer the page then has to merge with itself. A tag in the text — `#meeting` in a paragraph
— is prose and is not a tag. The read-only note draws the chips, read only, on the line above the
text.

Names claimed, grepped first: `dag-note-view*` (`dag-note-view__first`, `dag-note-view__editor`), `dag-app--note`, `dag-blocks`, `dag-board__kind`, `data-dag-note`
(a list row), `data-dag-note-view`, `data-dag-note-editor`, `data-dag-note-conflict`,
`data-dag-note-keep`, `data-dag-note-theirs`, `data-dag-note-deleted`, `data-dag-note-failed`,
`data-dag-new-note`, `data-dag-new-note-here`, `data-dag-welcome-note`, `dag-note-title`,
`data-dag-note-title`, `data-dag-note-title-read`, `data-dag-note-first`,
`dag-note-view__page--write`, `dag-note-view__tail`, `data-dag-note-tail`, and the SSE event
`dag:note`. `data-dag-note` is one letter from `data-dag-dock`; they are different attributes, and
a spec that wants one says which.

**Out, and why:** real-time co-editing (BlockNote can, the store is an optimistic sha1 — the same
refusal the boards make); a diagram inside a note (a fenced
` ```arch ` block survives the bridge as a code block, so nothing forecloses it); the GPL `xl-*`
packages; a note's saved version history (undo is the editor's, for the session). A board's own `md` cards
are edited in the same block editor, on the card, under the same rule — see *An md card's text, in
place* in `editing.md`.

## Note templates

A **template** is an ordinary note in the vault's **templates folder**; *New note from template* makes
a new note from one, with a few variables filled in, and the new note is a plain note from then on.
The template's frontmatter is carried over as it is, so a template with a `status:` makes a task and
one with a `start:` an event — those are notes with a line — and nothing else about it is special.

    ---
    title: "Meeting {{date}}"          Choosing it with the title "Q4 planning" makes
    tags: [meeting]                    <folder>/Q4 planning.md:
    ---                                  # Q4 planning
    # {{title}}                          On 2026-11-14 at 09:30.
    On {{date}} at {{time}}.

| Where | What it does |
|---|---|
| Settings → This vault → Files and images → *Templates folder* | the vault's `dag:templates`, relative to its root; empty is `Templates`, **used only when that folder exists** |
| the sidebar | **New note from template…** in the New menu and in a folder's menu, which makes in that folder |
| the search card | a miss offers *New note “…” from template…*, the words typed being the title |
| the leader key | `space m`, on a board and on every other page — refused while the app is locked, as every chord that makes something is |
| the dialog (`src/ui/TemplatePicker.tsx`) | a **title** field first, with the caret in it, then the templates; Enter in the field makes the note when there is one template, and focuses the list when there are several; with none it says where templates live and offers **Add starter templates** |
| `GET /__board/templates` · `POST /__board/from-template` · `POST /__board/templates/starters` | the list, the note made, and the three starters — over MCP `template_list`, `note_from_template`, `template_starters` |

Eight things are load-bearing:

- **The folder is a vault setting, and the server reads it.** `Vault.templatesFolder()` is the setting,
  else `Templates` *if the folder exists on disk*, else none — asked of the disk each time, so a folder
  made in a file manager is the templates folder at once and **nothing here ever creates it**: opening a
  vault writes nothing, the dialog writes nothing, and a setting that names a folder that is not there
  holds no templates. It is a vault preference like `dag:attachments` (`VAULT_PREF_KEYS`, in the vault's
  bundle, `Session.reconfigure` re-reading it when the bundle is written, and a `tree` event when the
  folder it names changes so every page reads the list again), because the server must know it to leave
  templates out of what it answers.
- **Variables are filled once, by one pure module.** `src/note/template.ts` — no browser, no `@/` — reads
  `{{title}}`, `{{date}}` (`YYYY-MM-DD`), `{{time}}` (`HH:mm`) and `{{date:FORMAT}}`, with blanks allowed
  inside the braces. **Anything else between braces is left exactly as written** (`{{note}}`, `{{date:}}`,
  a Handlebars snippet), and a single pass fills the text, so a title that itself says `{{date}}` is not
  filled again. `FORMAT` is Moment's tokens — `YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm m ss s A
  a`, `[text]` copied as it is, any other character itself — in **English, fixed**, so one template makes
  one text on every machine. There is no escape for a literal `{{date}}`, and no logic: Templater-style
  scripting and applying a template to a note that exists are out.
- **"Today" is the reader's zone.** The moment is read with `wallOf(at, zone)` in the zone Settings →
  Calendar names (`zoneOf` in `server/routes/docs.ts`, the vault's, then the app's, then the machine's),
  never `Date`'s local getters: a note made at 23:30 UTC is the 15th in Tokyo.
  `test/template.test.ts` holds it, a zone's clock change included.
- **A value in the frontmatter stays YAML.** Inside the block each line is filled by its quoting: a
  `"…"` value has `\` and `"` escaped, a `'…'` value has `'` doubled, and a plain one is quoted (JSON) when
  what was put in no longer reads back as the string it is — `title: {{title}}` with "Plan: Q4 #1" — a
  title always a string even when it is `2026`, while `due: {{date}}` and `year: {{date:YYYY}}` stay a
  date and a number. The body is text and takes a value as it is.
- **The note is filed the way `/create` files any text**: a typed title is the name (verbatim, numbered if
  taken, in the folder asked for) and wins over a `title:` the template fills in; with none, the template's
  own title names it, else it starts *Untitled* — `{{title}}` reading *Untitled* — and its page asks for the
  title first, as New note's does. **The template's `id:` is taken off**: a note made from one is its own
  document, and a copy of the id would be two documents answering to one.
- **A template is no task, project or event — and is still a note.** `Vault.tree()`, the change feed and
  `/__board/index` leave a template out of `tasks`, `projects` and `events` (so the Tasks page, the
  sidebar's count and glyphs, Due soon, `task_list` and `event_list` all agree without a line of their
  own), and out of the sidebar's title: **a template is called by its file's name**, because its
  `title:` is the new note's and may say `{{date}}`. `/__board/list` carries `templates`, the folder, so
  the calendar — which draws a *note* on the day it was made — leaves the folder out (`itemsOf`).
  A template stays in the file list, in search and in backlinks like any note, and its own page shows
  its real frontmatter. What a template *makes* (`makes` in the list, and the mark on its row) is read
  off the text **as it would be filled**, since `start: {{date}}` is no date until it is.
  **The kept listing (#280) holds the same rule** (`KeptListing.wanted`, given the folder it was made
  with), and a templates folder that moves — renamed in Settings, or a `Templates` folder made or
  removed by hand — drops it, so the next listing walks: which notes are tasks changed for every note in
  the folder at once. The index's per-document answers and the list's JSON are cached with the folder
  too (`routes/docs.ts`). `test/server/kept.test.ts` holds both.
- **The starters are written only when asked.** `src/note/starters.ts` is *Meeting*, *Daily* and *ADR*,
  written by `POST /__board/templates/starters` into the templates folder (`Templates` when none is named),
  making the folder, and **never over a name that is taken**, in any kind. None carries a `status:` or a
  `start:` (an ADR's status is a word in its text: `status: accepted` would be no task's), and the person
  edits, renames and deletes them like any note.
- **A template's braces are not YAML, and the parsers do not complain about it.** `due: {{date}}` is a flow
  map holding a flow map, which `yaml` warns about on every parse — to the server's stderr and the page's
  console, where a warning fails a browser spec. `src/note/quiet.ts`'s `QUIET` (`logLevel: "error"`) is
  passed by every parser that reads a note's frontmatter: errors still throw, warnings are not printed.

Names claimed, grepped first: `dag-templates`, `dag-templates__where`, `dag-templates__none`,
`dag-templates__problem`, `data-dag-templates`, `data-dag-templates-title`, `data-dag-templates-close`,
`data-dag-templates-empty`, `data-dag-templates-starters`, `data-dag-templates-problem`,
`data-dag-templates-failed`, `data-dag-template`, `data-dag-template-makes`,
`data-dag-sidebar-new-template`, `data-dag-hits-new-from-template`, `data-dag-setting-templates`,
`data-dag-setting-templates-problem`, the preference `dag:templates`, and the leader chord `space m`.

**Out, and why:** templates for boards, quizzes and tables (a board already has `src/board/templates.ts`
for items — a later issue); logic or scripting; applying a template to a note that exists; and a
templates folder the app makes unasked.

## Callouts

A quote whose first line names a kind is a **callout**, as GitHub and Obsidian write one, and it is
drawn as one everywhere Markdown is drawn — the note editor, `?view=1`, a snapshot, the PDF, an
embedded note, a board's text card, a quiz, the Assistant's words.

    > [!warning] Breaking change
    > The `/api/boards` route is gone in 0.6.

| Written | Is |
|---|---|
| `> [!tip]` on the quote's first line | a callout of that kind, headed with its word (`Tip`) |
| `> [!tip] Title` | the same, headed with the title |
| `> [!tip]- Title`, `> [!tip]+ Title` | one that folds: drawn shut, or open |
| GitHub's `note` `tip` `important` `warning` `caution`; Obsidian's `abstract` `info` `todo` `success` `question` `failure` `danger` `bug` `example` `quote` | each drawn in its own hue and icon |
| Obsidian's aliases — `summary` `tldr` `hint` `check` `done` `help` `faq` `attention` `fail` `missing` `error` `cite` | drawn as the kind they name, kept as written |
| any other word, `> [!aside]` | drawn as a `note`, headed with its own word, kept as written |
| `> [!two words]`, `> **[!note]**`, `> [!note]text`, a first line ending in a hard break | a plain quote, as before |

| Where | It |
|---|---|
| `src/note/callout.ts` | the grammar: the kinds and aliases, `splitCallout`, the house form's first line, and `remarkCallouts` for every read-only renderer |
| `src/note/markdown.ts` | `calloutBlock` (a quote → a `callout` block) and `calloutMd` (back) |
| `src/note/schema.ts` | `CALLOUT_CONFIG`, its keyboard, and the HTML a paste goes through |
| `src/render/Callout.tsx` | each kind's hue and icon, and `CalloutAside`, the `aside` `remarkCallouts` makes |
| `src/blocks/callout.tsx` | the editor's frame and head, `/Callout`, and `[!tip]` typed in a quote |

Six things are load-bearing:

- **One decision, on the tree.** `splitCallout` decides what a callout is from the parsed quote, and
  the bridge and `remarkCallouts` both ask it, so the editor and every page agree on which quotes
  are callouts — `test/note-callout.test.ts` holds them to each other on the cases where Markdown
  is close: a first line is everything before the first soft break, and a first line that does not
  end inside text — a hard break, a link or code span running onto the next line — is not a
  callout.
- **The file keeps its words.** `kind` is the word as written (`NOTE` stays upper case, `hint` stays
  `hint`, an unknown word stays itself) and `title` is the rest of the first line *as bytes*, so a
  title with Markdown in it is written back exactly; the editor shows it as the text it is, and the
  pages draw its Markdown. Changing the kind in the editor keeps the file's case: `[!NOTE]` becomes
  `[!WARNING]`.
- **The house form is GitHub's.** An edited callout is written `> [!kind]fold title`, then its text
  and blocks as a quote under that line. Where the body would run into the first line — a title
  ending in a backslash makes its line end a hard break — a blank `>` line goes between them, which
  is the same callout; which of the two is decided by reading both back, not by guessing at
  Markdown's rules. Its text is the body's first paragraph, and the body's other blocks are its
  children; a first line standing alone with the body after a blank line reads as the same block, so
  it is written the short way once somebody edits it. The callout is a raw node in the writer's tree,
  so it is indented in a list or a quote like anything else, and its equations are found by parsing
  it, for the dollar check.
- **The box is the block's frame.** The editor's callout draws its box in `renderFrame`, and
  BlockNote puts the block's text and its child blocks in the frame's slot, so a callout of three
  paragraphs is one tinted box, as on a page. The head — the icon with the kind's `<select>` laid
  over it, the title's `<input>`, the chevron — is chrome outside the slot, whose events and DOM
  BlockNote leaves alone; the kind and title are props written with `updateBlock`, the title on Enter
  or blur. Enter in its text starts its body, Enter on an empty last line of the body leaves it, and
  Backspace at its start makes it a quote again (`CALLOUT_KEYBOARD`).
- **The colours are the theme's ten hues.** Each kind maps onto one (`CALLOUT_LOOK`), and `quote`
  onto none — the theme's quiet greys. They are bound on the box as `--callout-h` and `--callout-t`,
  never `--dag-h`, which a callout in a hued card would otherwise inherit. In `neutral`, whose hues
  are greys on purpose, the icon tells the kinds apart. The box takes a code block's padding and the
  quote's bar; nothing in `markdown.css` names a length.
- **Folding writes nothing.** A page draws a folding callout as `<details>`, so opening one is the
  browser's; the editor's chevron is the frame's own state. `-` and `+` only say how it is drawn when
  the note opens.

Names claimed, grepped first: `dag-callout*` (`dag-callout__head`, `__icon`, `__title`, `__body`,
`__chevron`, `__slot`, `__text`, `__pick`, `__kind`, `__fold`, `dag-callout--editor`),
`data-dag-callout`, `data-dag-callout-word`, `data-dag-callout-title`, `data-dag-callout-fold`,
`data-dag-callout-open`, `data-dag-callout-kind`, `data-dag-callout-title-field`,
`data-dag-callout-fold-button`, `data-dag-callout-text`, `data-dag-callout-children`, and the custom
properties `--callout-h` and `--callout-t`.

**Out, and why:** a person's own kinds (Obsidian's CSS snippets — a colour the theme does not own);
a callout inside a callout beyond what a quote already holds; and a search result naming a callout
rather than a quote, which is what it still is to the index.

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
