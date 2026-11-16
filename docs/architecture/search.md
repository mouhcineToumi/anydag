# Search

> The corpus in the grammar's worker, it and its words index (SQLite FTS5) kept in the app's home, one query per request from the page, ranking and snippets.

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

The design is **the server matches, the page draws**. Parsing a search in the browser would mean
parsing every board and every note on every keystroke, which is the slowest thing the page does
(remark runs at about 0.3 MB/s), and an index built in the page from the vault's text cost, measured
on 50,000 files, 20 s to the first answer and 821 MB of the page's heap — in every window, kept for as
long as the page lived (#282). So the work stays where the parsers are: `GET /__board/corpus` reads
every text and cuts it into **units** in the grammar's worker (`server/searching.ts`),
`GET /__board/search?q=` looks a query up in an SQLite FTS5 index of their words, kept on disk beside
them (`server/words.ts`, #267), and answers with the hits **and their snippets** (`Found`,
`src/search/wire.ts`), and the page (`useSearch`, `ask.ts`) sends each query and draws the answer. The
page never holds a document's text and does not import the matching, so nothing about the vault's
size is in its heap but the file names the card lists. The CLI and an agent over MCP ask the same
route, so all three rank one query the same way.

**One request per paused query, and a newer one cancels it** (`src/search/ask.ts`, held by
`test/search-ask.test.ts`). A query goes out 120 ms after typing pauses; asking again, clearing the
box or closing the card aborts the request in flight, and an answer that arrives anyway is dropped, so
a slow answer to `pay` never lands over the one to `payments`. What is drawn stays until the next
answer replaces it, so the list does not blink between keys; `settled` says the answer is to the query
now in the box, and *nothing matches*, the miss's offers and Enter on a hit wait for it. While the
card is open the same query is asked again after the change feed says something moved (the debounce
of `useIndex`: at most one wait after the *first* change), and since every query reads the vault, a
word an agent wrote a moment ago is found on the next one.

| Unit | Its `part` | Holds |
|---|---|---|
| a document's title | none — the result opens the document | the frontmatter `title:` |
| a board item | its `#id` | an `md` or `note` as the words a person reads, code included; a caption; a prompt; a diagram's every title, meta, description, row, label, legend entry and category |
| a note block | `^anchor` if it has one, else `L<line>` | a heading, a paragraph, a quote, code, a table a cell at a time — and each list item on its own |

Fifteen things are load-bearing:

- **A result is a link, so a unit is only ever something with a name.** On a board that is an item:
  its `#id` is in the file, and the item is what the canvas can frame and select. A
  card inside a diagram has an id only its dialect knows, so a diagram is one unit holding
  everything its parse draws. Hidden items and `edges` fences draw nothing a result could show, and
  are left out.
- **A block nothing has anchored is named by its line**, never by an anchor minted for the
  occasion. A search is a read, and writing ` ^name` into a note to link to it would turn it into a
  write into a file somebody may be typing in. A line is not a permanent name and does not need to
  be: the answer is read from the vault as it is at the query, and the link is followed the moment it is made. Lines are
  the **file's**, frontmatter counted, which is what a person or an agent would count; the editor
  takes the frontmatter off and `blockAt` in `src/note/markdown.ts` finds the block — a list item by
  its own line, off the span map rather than a second parse.
- **Its own route, not more fields on `/index`.** The references index is read by every page that
  shows a backlink and is subscribed for as long as the page is up; this is the heavier of the two
  and is read only while somebody is searching. The card subscribes to the change feed when it opens
  and lets go when it shuts, and keeps nothing in between: the next open asks again. Both routes read
  the vault through one listing, so they cannot disagree about what it holds.
- **Only a text that changed is parsed again, and only a file whose stat moved is read again.** A
  `Reader` (`server/parsing.ts`) keeps what each text was made into against the sha1 of the text it
  came from, one per question — `/index`'s and `/corpus`'s — and parses the rest. `/patch` runs in
  the server's own process too, so an uncached whole-vault parse after every change is a pause every
  drag then queues behind (measured: a 5 ms `/diagnostics` took 390 ms while four of them ran, and
  5 ms again with the cache). The texts are read where they are parsed: a `Reader` stats each file
  and reads one only when its modified time, change time, size or inode moved. **While the vault is
  watched it does not even stat** (#280): the kept listing has each text's stamp (mtime, size, inode),
  each name goes to the `Reader` with it, and a text the `Reader` read at that stamp is answered from
  what it kept. On 50,000 notes, reading and hashing every text was most of a warm `/index`'s 2.9 s;
  the same answer and its JSON are kept while neither the listing nor the parse moved.
- **What it parsed is kept in the app's home, not in memory** (#279): `<home>/parse.sqlite`
  (`server/parse-store.ts`), a row per text per question holding its stat, its stamp, its sha1 and
  the doc, deflated, under the build that cut it. In memory a `Reader` keeps only the stamps, a few
  dozen bytes a text, and reads a doc back when an answer needs one. A `Reader` started again takes
  its stamps from there, and the name of the last answer it gave (`turns`), so the server that holds
  that answer is told *nothing changed* and nothing is read or parsed; a server started again gets
  the whole answer from the rows. **It is a cache**: a row another build cut is dropped, a row that is
  missing is parsed again, and a home without the file parses the vault once. Rows are written as a
  read goes, the name last — a read cut short is never taken for an answer.
- **A whole-vault parse is in a process of its own, which ends when it has been idle**
  (`server/grammar-worker.ts`, `WorkerProcess` in `server/grammar.ts`). `/index`, `/corpus` and
  `/search` go to it; everything else stays inline, being quick. Measured on 5,000 notes, a cold
  `/index` is 14 s of parsing, and on the server's one thread it was every request waiting,
  `/api/auth/me` included; now `/api/auth/me` answers in 2 ms while it runs. **It ends 30 s after
  its last answer** (`ANYDAG_GRAMMAR_IDLE_MS`), because ending it is the only way its memory comes
  back — see *Things that will bite*; the next question starts another, which reads what the last one
  kept. A search holds nothing it would have to build again, so it keeps the worker up no longer than
  any other question (until #267 it kept it 5 min, for an engine that took seconds to build). It is
  run by the server's own binary, is given none of the server's tokens, secrets or keys, and exits
  when its channel closes. A question it has not answered in 60 s ends it (#9), and a long read says it is
  alive between chunks of 500 texts (`Reader.steps`), so that is 60 s for a chunk, not for the vault.
  The worker is built beside each bundle (`server/build.mjs`, `cli/build.mjs`), and where there is
  none (the unit suite, or `ANYDAG_GRAMMAR_INLINE=1`) the calls run inline. `Parsed.of` runs one call
  at a time, so two cold asks parse once, and its `generation` moves only when its answer does.
- **No text crosses to the server's thread, and nothing on it takes long** (#287). The server
  reading every text with `readFileSync` and posting the map to the worker held every request for
  about 2 s on 50,000 files; now the server's thread sends the worker the names (in parts of 2,000), the
  worker reads, parses and keeps what it made of each, and sends back only what changed, in parts
  each asked for once the last was read. The route's own loops — the wiki index (`wikiIndexer`), the
  answer — run in 8 ms slices (`server/pace.ts`), and the answer is streamed rather than
  `JSON.stringify`d whole.
- **Nor do the units** (#279). `/corpus` and `/search` send the worker each text's name with its id
  and listed title (`Over`), and the worker answers whole (`server/searching.ts`): `/corpus` as the
  JSON of its docs, in parts the route hands on as the answer is read — the corpus of 50,000 notes is
  140 MB of JSON, none of it held on the server's thread — and `/search` as the hits. The server held
  the corpus of 10,000 files twice over (37 MB of units), for as long as it ran.
- **A search is a lookup in an index kept on disk, not an engine built in memory** (#267). Beside the
  corpus's rows in `parse.sqlite`, each vault has an FTS5 table of its units' words (`words_<set>`,
  `server/words.ts`), written **in the transaction that writes the rows it is made from**, so the two
  never disagree: a text parsed again has its old units taken out and its new ones put in, a text
  gone takes its units with it. The table is contentless — a unit's rowid says where it is (unit `i`
  of the text whose row is `r` is `r · 2^20 + i`, an attachment's names below zero), and a hit's
  snippet is cut from its document's row, read when the hit is answered, forty rows at most. So a
  worker started again — after an idle, or after the app was restarted — answers its first search
  from the file, with nothing to build: MiniSearch, which this replaces, held every unit's words in
  the worker (146 MB at 10,000 files, five times that at 50,000) and built them again after every
  idle, 4 s at 10,000 files and 20 s at 50,000. **A set whose table is missing is emptied**, so it is
  made again from the vault rather than answered from rows it does not cover; with `parse.sqlite`
  deleted, the vault is parsed and indexed once, and nothing is lost but the time.
- **It is kept up to date as the vault changes, not only when somebody searches** (`server/upkeep.ts`).
  Every search starts with the read that brings the rows and the index up to date, reading and parsing
  only the texts whose stamp moved, so a file an agent wrote a moment ago is in the very next answer.
  While a vault is watched (`anydag serve`, and so the desktop app), the same read also runs on its
  own: 3 s after the vault opens, and 1.5 s after the last change the watcher or a write reports
  (`ANYDAG_SEARCH_FIRST_MS`, `ANYDAG_SEARCH_QUIET_MS`). On a home that holds the index that first read
  only compares stamps; on a new home it makes the index, on the grammar's worker, before anybody
  asks. The CLI's one-off session does not watch, and keeps the read a search starts with.
- **That read in the background never makes the page wait.** It shares the grammar's worker with
  `/index`, which the page is waiting on, and three rules keep it out of the way (`drive` in
  `server/grammar-worker.ts`). It starts only once the references index has been answered and
  `QUIET_MS` has gone by with no new ask of it, because the page asks again as an answer lands. It
  parses 8 texts at a time and, before each 8, gives way while a question runs on another reader or
  any read's entries are still arriving. A worker reads its channel only between two chunks, and at
  50 texts a chunk the 400 kB of a warm `/index`'s entries took 740 ms to cross at 5,000 notes. And it
  stops when a question waits for its own reader, a search or `/corpus`: the rows its chunks kept are
  on the shelf, so the question goes on from there at a question's pace rather than waiting behind it.
- **Every word must match, and every word is a prefix**, so the list narrows as it is typed, the way
  the names above it do, and `pay sett` finds "payments settle". Each word asks the index for
  `("w" OR "w" OR "w"* …)`, the words joined by `AND`: the whole word is named twice and the prefix
  once, so a whole-word match ranks about three times a prefix one under `bm25`, the weight MiniSearch
  gave the two. **Words are cut and folded in JavaScript, not by SQLite** (`wordsOf` in
  `src/search/engine.ts`): a unit goes into the index as its folded words joined by spaces, under the
  `ascii` tokenizer, which splits on nothing those words hold — so the index, the query and the
  snippet split and fold one way. A word of five letters or more forgives one typo in five (two from
  eight letters on) and a shorter one none: the vault's terms within that many edits of it join its
  alternatives. They come from `terms_<set>`, every word the index was ever given, read into the
  worker's memory once and added to as it writes; it is only ever added to, because a term no unit
  holds any more is an alternative that matches nothing. Accents and case are folded both ways. At
  most three hits come from one document and forty in all.
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

**A search can be filtered to one tag** (#327): `GET /__board/search?q=…&tag=<name>` keeps only
the hits in documents carrying the tag, and `q` may be empty when a tag is given, which lists every
document carrying it, by title. The filter is applied on the server from the listing's `tags`, so
the page still holds no text; it is not a unit, so searching the word *meeting* does not turn up
every document tagged `meeting`. The card shows the filter as a chip beside the box, and MCP's
`search` takes the same `tag`. See *Tags* in [`tasks-projects-calendar.md`](tasks-projects-calendar.md).

**Out, and why:** keeping MiniSearch and saving its index in the app's home, the alternative #267
named — the engine would still be read into memory whole before its first answer, which is what made
the first search after an idle take seconds, and FTS5 is in the SQLite the server already has; an
index in the vault (`.anydag/`), because a sync tool copies a database while it is written and opening
a vault writes nothing to it; SQLite's `spellfix1` or `trigram` for typos, which Node's SQLite does not
build in or which would triple the index, where a typo is a few edits against the vault's terms; a
match inside a diagram opening on its card rather than on the diagram (a card's
id is the dialect's, and framing one needs the layout's box, which `App` has but a result cannot
name without a grammar for it); an agent's search tool over MCP (`/__board/corpus` is there, and a
tool is a decision about what an agent should read, not a mechanism); the read-only view framing an
item (it reads a block's anchor already and has no search to open it from); and ranking by recency
or by what is open, which would make the same query answer differently from one board to the next.
