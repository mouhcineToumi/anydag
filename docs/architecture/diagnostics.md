# Diagnostics and problems

> Diagnostic codes and how they are earned; where a person reads what is wrong with a board.

## Diagnostics

Every diagnostic carries a stable `code` from `src/dsl/codes.ts` as well as a message. **Branch on
the code**; the message is written for a person and may be reworded. `E_`/`W_` is the diagram DSL,
`EB_`/`ANYDAG_` the board file around it — which is what distinguishes the two grammars that can both
report "unterminated string" — and `EG_` what the generator says about a model's answer to a prompt
card, which may parse clean and still be wrong (`EG_WRONG_TYPE`), or to a request for flashcards
(`EG_NOT_A_CARD`: a question the quiz parser reads clean that is not a card). None of them is drawn on the
canvas — see *Problems* for where a person reads them. `GET /__board/diagnostics?name=` is the same
parse, server-side, through the same `diagnoseBoard` the page's dock calls, and `anydag snapshot`
prints it. The
three `EB_LINK_*` codes ride in `board.errors` and reach that endpoint with no change to it — an
unresolved end with a `target` naming the link it left hanging (#173) — and the
six `*_CHART_*` codes are the only family named for a dialect — everything else `parseChart` raises
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

## Problems

Where a person reads what is wrong with a board — and **only what they can act on** (#145). The DSL
and the board file are the app's own format and a person never sees them, so a missing quote, a word
the grammar does not know or a stray line in an `edges` fence is not something they could find, let
alone fix. Those statements are **skipped**: the rest of the diagram is drawn and nothing is said.
Every diagnostic is still there for an agent — `board_diagnose`, `/__board/diagnostics`,
`anydag snapshot` — which reads the text. `src/ui/problemList.ts` is the meaning with no DOM in it
and decides which diagnostics a person sees; `src/ui/Problems.tsx` is the dock, and the editor panel
and the frame mark are the other two readers.

**A file that cannot be opened at all is not a diagnostic.** `src/ui/FileProblem.tsx` is one card,
drawn by a board, a note, a quiz and a table, and chosen by a `switch` on the load's reason: a 404 is
`missing` (search for it, look in the trash, go home), a `fetch` that rejected is `unreachable` (the
server is not answering, and *Try again* asks once), and every other answer or failure is
`unreadable` (*Open as text* when the bytes arrived, and go home). `LoadProblem` (`src/board/useBoard.ts`)
carries the server's message and a code for the closed *Details for a bug report*; nothing outside
it names `EB_UNREADABLE`, because a code is for an issue rather than for the person in front of the
screen. A mistake *inside* a board the app could read stays a diagnostic with its line:col. Names
claimed, grepped first: `dag-file-problem*`, `data-dag-file-problem*`.

| Where | Shows |
|---|---|
| a diagram's frame | an outline in the problem colour and a count by its title, while it has any |
| the count, bottom centre | how many errors and warnings there are; a click opens the list |
| the notification, in the app's toast stack (#208) | the first *new* error, in words, with Show and ×, for six seconds |
| the list | every problem, in words, with the kind of item and its page; a row opens it |
| the panel's Problems block, at the top | the open item's own problems, each with Show and the fix a row can carry out |

What counts as one a person can act on (`shown()` in `problemList.ts`):

- **About one thing that was drawn**, with a control in its panel that answers it:
  `W_UNKNOWN_ICON` (the icon picker), `W_UNKNOWN_HUE` (the swatches), `W_RETIRED_FLAG` (Update it),
  `E_UNKNOWN_ID` (a link to a card that is not there — Delete link, in the row), `W_MISSING_ROW`
  (the link's ends), `W_CHART_LENGTH` (the values), and `EB_LINK_UNKNOWN_ITEM` and
  `EB_LINK_UNKNOWN_NODE` (a board link to nothing, hanging — Delete link, in the row). "Show" picks it. The same code about a
  statement that was *not* drawn — an edge out of a card that could not be read — has nothing to
  pick, and is left out.
- **About the whole diagram:** a Mermaid paste (`E_MERMAID_SYNTAX` when the header says the block is
  another language — the panel's Convert) and an empty chart (`W_CHART_EMPTY` — Add a series). A
  Mermaid habit on one line of a good body is a statement that could not be read, and is skipped.
- **A board setting the dock can repair:** `EB_FRONTMATTER`, `EB_UNKNOWN_TYPE`, `EB_BAD_LAYOUT`,
  `EB_BAD_ASPECT` — `planRepair` in `src/edit/repair.ts`, the same box in the dock and the panel.

Six things are load-bearing:

- **A diagnostic's target is the parse's answer.** `diagnoseBoard` sets `target` — the card, group,
  lane or edge the diagnostic's line declares — through `declaredOn`, once per line. No parser sets
  it: a parser names the line it was reading, and which thing ended up living there is the whole
  parse's question. It is on the wire too, so an agent sees what the page would pick.
- **One question, three askers.** `diagnoseBoard` in `src/dsl/diagnose.ts` is what the dock, the
  panel and `/__board/diagnostics` all call, and `parseItem` is the per-type dispatch `DiagramItem`
  used to spell out by itself. There were two copies of it, and the route's forgot `aspect` and
  `layout` once already. `test/diagnose.test.ts` holds it to the route's output on every board in
  `boards/`. It takes the item's fields structurally rather than a `BoardItem`, so `src/dsl/` still
  does not know the board format; plain relative imports, because the plugin loads it.
- **Whatever could be read is drawn.** `DiagramItem` lays out the latest parse, errors and all; the
  parsers already skip what they could not read. It used to keep the last good drawing behind a red
  dot, and open a broken body as a grey stand-in — both told a person something was wrong and gave
  them nothing to do. The stand-in is left only for a layout that itself refused.
- **`[data-dag-error]` is for tools.** A diagram whose text has an error carries a hidden
  `data-dag-error` with `data-dag-diagnostics` (the errors, rebased onto the board file). Seventeen
  e2e assertions check it is absent after a control writes, and nothing in `src/` set it for years,
  so every one passed by matching nothing; now each one would catch a control that wrote something
  unreadable.
- **The notification waits and does not repeat.** A second of stillness before it speaks. A
  problem's `key` is `code|item|target|message` with **no line**, so a write above it does not make
  it new; `seen` is the keys at the last settled reading, so × holds until something genuinely new
  arrives. It never speaks about the item open in the panel or about a warning.
- **"Show" waits for the page, then picks.** A problem on another page switches the page first and
  opens the panel after, because selecting an item that is not on the drawn page is undone by the
  effect that keeps `selected` naming things on the paper. `editor.openOn(id, target)` then opens
  the panel on the Properties half with the target picked — a node, group or lane through
  `pickNode`, an edge through the edge pick — so the control that fixes it is what shows.

**A link whose other end is missing hangs from a loose end.** When one end of an edge names nothing
and the other end is a real card, `finalize` in `src/dsl/common.ts` adds a `loose` node in place of
the missing one (`__loose-N`, one per line and name, so a chain through the same missing name makes
one) and points the edge at it. The edge is drawn, leaving the card, and ends on a small dashed
circle (`LooseEnd` in `src/render/nodes/`, `data-dag-loose` = the name it stood for). Dragging the
circle onto a card of the same diagram rewrites that one ref in that one statement (`reattachLoose`
in `src/edit/pick.ts`, through `retargetRef`), which clears the `E_UNKNOWN_ID`; clicking it picks
the edge, whose panel has Delete. The diagnostic is unchanged — it still names the line and the edge
— so the dock and the panel still count it until it is answered. A stub is not a card: it is left
out of `edgeTargets`, `nodeIdsOf` and `declaredOn`, so no menu offers it and no problem targets it.
An edge with both ends missing, or out of a card that could not be read (`ctx.broken`), gets none;
there is nothing on the paper to hang it from. Names claimed: `dag-loose`, `data-dag-loose`.

**A board link to nothing hangs the same way** (#173). `resolveLinks` keeps a link with one end
that resolves, marks the missing end (`loose`), and sets the diagnostic's `target` to
`{ what: "link", id }` — a board diagnostic's first target, and the reason `DiagnosticTarget.what`
has a fifth value. The problem's item is the `edges` fence its line is in (`itemAt`), so "Show"
calls `openOn(fence, target)`, which opens the fence and picks the link, and the panel's row Delete
goes to `editor.removeLink`. The stub is drawn by `Edges` in the link overlay rather than by a node,
dragged by `ctl.looseLink`, and written by `reattachLink`; the paragraph on it in
`links.md` has the rest. `data-dag-loose-link` is claimed beside the two names above.

The frame mark is painted, not rendered (`data-dag-problem-count`, set by `App` the way
`data-dag-proposed` is): `Item` is memoised and a per-item prop would re-render every diagram
whenever a count changed. It is an outline and a `::before` badge, so the box `size.ts` measured is
the box drawn.

Nothing here is computed under `?snapshot=1`: there is no chrome to show it in, and the agent reads
the same answer from the endpoint. `problems.show` in `src/settings/` is `notify` (the default),
`badge` (the count only) or `off` (nothing outside the panel). Names claimed, grepped first:
`dag-problems*`, `data-dag-problems*`, `dag-broken*`, `data-dag-problem-count`,
`data-dag-problem-show`, `data-dag-problem-delete`, `dag-inspector__problem*`,
`data-dag-inspector-problem*`, `data-dag-setting-problems`.

**Out, and why:** the stray `y` that started this almost certainly came in through the panel — K
and Enter open a fence with the source focused and its caret at offset zero, so the next letter
typed as a shortcut lands on the body's first line. That was a separate defect; the box is gone
for a diagram and a link fence now (#145), so there is no source for a letter to land in.
