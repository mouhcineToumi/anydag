# Diagnostics and problems

> Diagnostic codes and how they are earned; where a person reads what is wrong with a board.

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
