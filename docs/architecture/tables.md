# Tables

> The `.table.md` format: tabs, typed cells, the smallest-span writers, sort and filter, CSV.

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
| its page, `?table=` | the grid of one tab; the tab's bar — Sort, Filter, how many rows show of how many, how many problems the file has, undo and redo; the tabs along the bottom; Import CSV and Export in the top bar. **No Source**: the file's problems are said where they apply (below) |
| a board, or a note, embedding one | a card: its mark, title, tab and row count, then the tab's first rows as the tab shows them — ten on a board, twenty in a note; `#<tab>` picks the tab; Open, or a double-click, opens the table on it |
| `?view=1` | the grid read-only, the tabs in the strip |
| a snapshot | every tab, one after another, each under its name |
| the search | a row is a result, `part` `<tab>/<row>`; it opens the table on that tab with the row marked |

Ten things are load-bearing:

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
- **A problem is said in words on what it concerns, with the button that mends it — the page has no
  Source.** `src/ui/table/problems.ts` (and `ProblemList.tsx`, which draws them) is a `switch` over `TableCode` ending in `assertNever`, so a
  code added to `codes.ts` fails the typecheck until it is said there. It turns each diagnostic into
  a `Problem`: a sentence with no Markdown in it, a `Where` (the file, a tab, a column, a row, a cell —
  indexes into the parse, because a shared id names neither of two things) and its `Fix`es. The page
  draws them where they are: a **tab's** (a sort or filter that does not read, text under it, an
  unknown heading word, a shared tab id, an open code block) and the **file's** (a table above the first
  tab) in a list above the grid; a **column's** (a shared id, a word that is not a type) on a mark in
  its header; a **row's** (a shared id, too many cells) and its **cells'** (`WT_CELL`, also the cell's
  `title`) on a mark in its gutter. The bar's status says how many in the whole file and its button goes
  to the first, switching tab. `WT_NO_ID` and `WT_EMPTY` are not shown: an id is the file's business
  and the empty state has its own button. A row has no `WT_UNKNOWN_ATTR` — its braces are attributes
  only when they hold nothing but an id and a height. Each fix is one `repair` in `problems.ts` over
  one writer in `write.ts`, addressed **by position** and written like any change, so it is one undo:
  `reidTab` / `reidColumn` / `reidRow`, `dropUnknownAttrs`, `setCell` / `setColumn` (clear the cell, make
  the column text, add the value to a select's choices), `trimRow` or `widenToRow` for a row with too
  many cells, `removeStray` (the list shows the text first), `setTab` with only the sort keys and filter
  rules that read, `closeFence`, `wrapLooseTable`. Each looks again at what it was asked to mend and
  returns the text it was given when that is no longer wrong. A write that goes by id while two things
  share one is refused with a word that says so (`only` in `TablePage.tsx`).
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
