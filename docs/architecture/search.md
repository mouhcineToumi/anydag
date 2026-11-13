# Search

> The corpus on the server, the index in the page, ranking and snippets.

## Search

`src/search/`. The search card (`space O`, the sidebar's Search, the board's own name)
matches file names as it always has, and under them lists every match **in the text** of every board
and note, in one ranked list. A result opens its document where the words are.

**A file is listed once.** A document whose name already matched is not repeated under the words:
the name is its best match, so its blocks stay out of the text list and its row says
*and in the text*. The text list therefore holds the matches in documents that have no row of their
own. `src/search/results.ts` is that rule, and `test/search-results.test.ts` holds it.

**The card is as tall as its results, up to its old ceiling** — 560px, or the window less 64px. One
row is a small card, not two empty thirds of a tall one.

**It is a dialog in the app's one frame** (`src/ui/Dialog.tsx`, #208): over the sidebar too, with the
scrim every dialog has, the page behind it `inert`, and Tab kept inside. It said `aria-modal="true"`
while sitting inside the page with no scrim, and Tab walked out of it into the sidebar behind;
`e2e/search.spec.ts` presses Tab thirty times and checks the focus after each.

**A miss offers to make what was typed**: *New board “…”* and *New note “…”*, in the open file's
folder, and Enter presses the board. Both go through the sidebar's own create
(`useSidebar().create`, `newFile` in `src/ui/Shell.tsx`), so a file begins one way whether it was
asked for here or from the `+`, and the file that is made opens. A name that matched something is
not a miss: the offers appear only when there is no name, no text and no folder.

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

Names claimed, grepped first: `dag-hit*`, `dag-hits*`, `data-dag-hit*`, `data-dag-hits*` (a miss's offers are `dag-hits__new`
and `data-dag-hits-new-board` / `-note`, inside them, because `data-dag-new-note` is the notes' claim), `dag-board__also`, the event `dag:target` (in `test/prefs.test.ts`'s list of events, which is what caught
it), and the highlight name `dag-found`.

**Out, and why:** a match inside a diagram opening on its card rather than on the diagram (a card's
id is the dialect's, and framing one needs the layout's box, which `App` has but a result cannot
name without a grammar for it); an agent's search tool over MCP (`/__board/corpus` is there, and a
tool is a decision about what an agent should read, not a mechanism); the read-only view framing an
item (it reads a block's anchor already and has no search to open it from); and ranking by recency
or by what is open, which would make the same query answer differently from one board to the next.
