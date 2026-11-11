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
  theirs*, and writes nothing until it is answered. **The read that opens a note is never left
  blank**: a 5xx or no answer at all is not "there is no such note", so the page says it could not
  read it (`data-dag-note-unread`) and reads again on the save's own backoff (#123).
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
  means the editor is up. Mantine is **8**, not 9: 9 wants React 19.
  Beside it is `FieldEditor`, the one-field editor a quiz's form mounts (see *Quizzes*): the note's
  bridge, paste (`src/blocks/paste.ts`), references and equations, on a schema cut to
  `FIELD_BLOCKS`. It is still a `React.lazy`, so the throttle above applies to it.
- **The colours are the theme's.** `className="dag-blocks"` lands on the editor and on every menu
  BlockNote portals out of it, and `src/styles/blocks.css` sets each `--bn-*` from a `--dag-*` there,
  two classes and an attribute deep so it wins whichever stylesheet loads last. It is chrome in
  `chrome.css`'s sense — off the length list, on the colour rule — and invents no `--dag-*`.

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

Names claimed, grepped first: `dag-note-view*` (`dag-note-view__first`, `dag-note-view__editor`), `dag-app--note`, `dag-blocks`, `dag-board__kind`, `data-dag-note`
(a list row), `data-dag-note-view`, `data-dag-note-editor`, `data-dag-note-conflict`,
`data-dag-note-keep`, `data-dag-note-theirs`, `data-dag-note-deleted`, `data-dag-note-failed`, `data-dag-note-unread`,
`data-dag-new-note`, `data-dag-new-note-here`, `data-dag-welcome-note`, `dag-note-title`,
`data-dag-note-title`, `data-dag-note-title-read`, `data-dag-note-first`, and the SSE event
`dag:note`. `data-dag-note` is one letter from `data-dag-dock`; they are different attributes, and
a spec that wants one says which.

**Out, and why:** real-time co-editing (BlockNote can, the store is an optimistic sha1 — the same
refusal the boards make); a diagram inside a note (a fenced
` ```arch ` block survives the bridge as a code block, so nothing forecloses it); the GPL `xl-*`
packages; a note's saved version history (undo is the editor's, for the session). A board's own `md` cards
are edited in the same block editor, on the card, under the same rule — see *An md card's text, in
place* in `editing.md`.

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
