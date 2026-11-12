# References, ids and the read-only view

> Document ids, `dag:` references, embeds, backlinks, the references index, `?view=1`, and wikilinks following a rename.

## References, ids and the read-only view

Four ids decide how things are pointed at: a document's is `id:` in its frontmatter, an item's is
its `#id` with loose prose fenced to carry one, a note block's is a lazy `^id`
anchor, and a reference is a Markdown link to `dag:<id>`.

| What | Its id | Minted by | Survives |
|---|---|---|---|
| board, note | ten characters of Crockford base32 (`server/ids.ts`), `id:` in its frontmatter | the server, on create, or the first time something links it by id | rename, move, edit, a copy to another machine — not a duplicate, which is a new document |
| canvas item | its `#id` | whoever makes it, else the stamp | move, edit, retitle, cut and paste, export and import; `renameItemId` is the one deliberate change |
| note block | ` ^name` at the end of its last line | whatever first points at it | edits to the block, moving it |

Ten things are load-bearing:

- **A document's id is in its frontmatter, and opening never writes.** `id:` is the truth and
  travels with the file through a copy, a sync and a `git mv`; the SQLite index in the app's home
  maps it to a path and is rebuilt from the vault. An existing `.md` with no id is given one the
  first time something links or embeds it by id (in the write that links it), or when the app
  creates it — not on its first edit, which would change bytes the page sent. `npm run stamp` is the
  one script, for items: an empty patch per board *is* a stamp.
- **A file moved outside the app keeps its id**, because the id is in it; the index learns the new
  path from the watcher or the next scan. Two files with one id — a copy made in a file manager —
  leave it with the older by created date, and the copy is given a new one.
- **An export no longer needs an envelope.** The id used to live in the store, so an export wrote
  `id:` into a frontmatter and the import took it out again (`src/board/envelope.ts`); it is in the
  file now, and the module is what is left of that.
- **The stamp is a fixed point that keeps every id**, held over every board in the repository, and
  is `applyPatch`'s own pinning rather than a second writer. `/put` is never stamped: it is the undo
  path, and a restore that changed the bytes it restored would be the history lying.
- **A reference holds an id and never a name**, and is followed through `?ref=<id>`, which the page
  resolves (`/__board/resolve`) and replaces with the name it stands for now. So a rename or a move
  changes nothing in any file, and every surface draws the target's *live* title — the words in the
  brackets are only a fallback, refreshed when the block holding them is next edited. **It is followed
  without loading the page**: `App` catches a plain click on a link to `?ref=` in its own
  workspace, and `follow()` (`src/refs/follow.ts`, the `dag:follow` event) is how the two links that
  navigate by hand ask — the editor's chip and a table's card. The id is resolved off the list when a
  list fetched on this page load knows it, and through `?ref=` otherwise, as a **pushed** history
  entry, so Back is the document it was followed from. A page nobody listens on — `?view=1` — and
  a click with a modifier still load.
- **`react-markdown` empties any URL protocol it does not know**, which is what makes it safe with
  `javascript:` and what turned every reference into a link to nowhere and every embed into a broken
  image. `urlTransform` in `src/refs/Ref.tsx` lets `dag:` through and nothing else, and every
  `ReactMarkdown` that can hold a reference has to be handed it.
- **An embed is a block, and a paragraph cannot hold one.** A `dag:` image alone on its line draws
  the target; anywhere else it is a one-line card, because a `<div>` in a `<p>` is a console error
  and the e2e suite fails on those. **An embed that throws is that embed's failure alone**:
  `EmbedBoundary` draws a card saying it could not be drawn (`data-dag-embed-failed`), and the note
  around it, the sidebar and the open chat stay — the app's one boundary is a reload screen. A board embedded in a board is a card too — a viewport inside a
  viewport pans two things — and a note embedded in a note stops at one level.
- **The index is one copy per page, and nothing on the canvas subscribes to it.** It reads every text
  the vault has, so it refreshes at most one wait after the first change rather than after the
  last — a debounce that restarts on every change never fires while another tab is writing — and a
  change arriving while a fetch is out asks again once it lands. The note editor reads it when a
  picker opens and never re-renders on it: handing BlockNote's suggestion menus a new `getItems`
  closes an open menu under the person typing, and only the suite running four notes at once showed
  it. `BoardApp` does not subscribe either; the open library and the backlinks count do. **A refresh
  that got no answer is asked again on its own**, after a wait that doubles to thirty seconds, and so
  is the file list (`src/board/refresher.ts`): both used to wait for the feed's next change, which
  after the Assistant's last write never came (#123). And **an id a reader meets that the loaded
  index does not know is asked about once** (`seek`): an embed or a link of a board made a moment
  ago draws it rather than staying a card until somebody else writes. An id is minted before
  anything can name it, so one fresh answer knows it — unless the target is gone, and then asking
  once is enough.
- **A `[[wikilink]]` is resolved through a lookup, never a scan.** `wikiIndex` in
  `src/refs/wikilinks.ts` maps every folded name, every path tail and every title to its documents
  once per list, and `resolveWiki` memoises it on the array (a `WeakMap`, so a list must not be
  mutated after its first use). Three passes over the list per link was O(links × documents):
  `/__board/index` on 5,000 notes with thirty links each ran for over four minutes and held the
  server's only thread. `test/wikilinks.test.ts` holds the lookup to the three passes on vaults made
  to collide.
- **One document's references are `GET /__board/refs?name=&kind=`**: its references out, each with
  the document it names (`target`, or `null`), and its backlinks with their type. It is the index read
  for one name, so a client asking about one document is not sent every document's (4.6 KB where
  `/index` is 10.9 MB on 5,000 notes). The MCP `refs` tool with a `name`, `anydag <kind> refs`, and
  `file rm` and `file_delete` read it.
- **The vault reads a disk somebody else is deleting from.** A folder listed a moment ago can
  be gone when it is opened, and a board read a moment ago gone when it is written. Both always
  could; the index route lists the vault far more often than anything did, and turned a rare race
  into a 500 under the e2e suite. The walk skips a vanished folder, `read` and `texts` a vanished
  file, and `write`'s `NotFound` reaches `/patch`, `/put` and the MCP tools as the 404 `must_read`
  already gives.
- **A `#part` is looked for by whichever page opens, and let go once shown** (`src/refs/target.ts`).
  The board page frames the item and selects it once it is drawn — switching page first if it is on
  another — and the note page puts the caret on the block. It lives in the hash, where `?ref=`
  already carried it, and is cleared once used, or opening another board from the sidebar would look
  for the same item id there: `md-1` is on most boards. `replaceState` fires no `hashchange`, so
  setting one announces `dag:target`, which is how a result on the board already open moves the view.
- **`App` is a lazy chunk.** `Gate` mounts `ViewApp` for `?view=1` and otherwise loads the canvas on
  demand, so "without the editor" is a fact about the network rather than about the tree.
  `test/view-graph.test.ts` walks the static import graph from `main.tsx`, and `view.spec.ts` checks
  the requests a view page actually makes.

`@` and `[[` insert a reference and `![` (Markdown's own start of an image) an embed; the slash
menu's *Board* opens the `![` picker. Two documents with one title are told apart by their folders in
the picker — or, in one folder, by a number, with the file name under the row as the one thing left
that tells them apart — which is also what keeps BlockNote's rows, keyed by title, from
colliding. A board
carries a note as an `md` card whose whole body is the embed, placed from the library's *Your notes*.

**On a board an embed is never drawn, only named**: `refComponents({ placed: true })`,
which `MarkdownItem` asks for, turns every `![…](dag:…)` on its own line into `PlacedCard` — one
height for a note, a task and a board, the title on one line, what it is under it, and a button that
opens it. The title is not a link, because a press on the card is how the item is selected and moved,
and a linked title would leave the board on every press that did not move; the button stops the
press first. A target the index has not named yet, or has lost, is the same card (`PlacedMissing`),
so the board does not change height when the index answers. A quiz keeps `QuizCard`, which carries
Practice. In a note an embed still draws its target.

Names claimed, grepped first: `dag-ref*`, `dag-embed*`, `dag-backlinks*`, `dag-view-bar*`,
`dag-view-missing`, `data-dag-ref*`, `data-dag-embed*`, `data-dag-backlink*`, `data-dag-view*` —
and `dag-embed--placed`, `dag-embed__mark`, `dag-embed__text`, `dag-embed__name`,
`dag-embed__what`, `dag-embed__open`, `data-dag-embed-placed`, `data-dag-embed-open`,
`data-dag-embed-missing`, `data-dag-embed-failed`.

**Out, and why:** a references table stored beside the texts (a second copy of what the files say;
the scan is right for tens of documents and is the thing to replace, with an index kept on write,
once a vault holds thousands); hiding a block's `^id` inside the editor (it wants a schema prop
on every block type, and nothing yet points at a block from the UI); a board embedded in a board; and
mobile viewing, which the view is built for. Sharing a vault stays the folder's: it is shared the
way any folder is.

### Wikilinks follow a rename

A `dag:<id>` reference survives any rename by construction; a `[[wikilink]]` holds a name, and a
name is the title the file carries. So every route that changes a document's name —
`/__board/retitle`
with `follow`, `/__board/rename` (not a copy), `/__board/mvdir` — runs inside `relinking()`
(`server/relink.ts`): the vault's list before, the change, the list after, and every text whose links
the change broke rewritten through the store under its sha1 base, recomputed on a conflict. The
arithmetic is `src/refs/relink.ts`, pure and browser-free; the answer carries
`relinked: {links, files, missed}`, or `null` when the vault has it off (`dag:update-links` = `"0"` in
`<vault>/.anydag/settings.json`; Settings → This vault → Files and images, on by default). The CLI and MCP have it for nothing,
calling those routes. Seven things are load-bearing:

- **The invariant is "names what it named".** A link that resolved to a document before and does not
  resolve to it after is rewritten so it does; a link that resolves to it either way is left (`[[Plan]]`
  still names `Projects/Plan` moved to `Archive/Plan`); a link that named nothing is never touched — a
  document taking the name a dangling link asks for is the link coming alive. And when the moved
  document wins a tie it used to lose, the link that named the other one is rewritten to keep naming it.
- **Resolution is `resolveWiki`'s and no one else's**, called against the two lists, so the page, the
  index and this cannot disagree about what a link names. Both lists are built once per rename and
  never changed, which is what lets `resolveWiki` keep one index per list; and `changeOf` collects the
  folded leaves and titles of every document whose name or title differs, so a link none of whose keys
  is there is not even resolved, and a text with none of them is not even parsed.
- **Only the target is rewritten, in its own form.** The alias, the `#heading` or `#^block`, the spaces,
  a table's `\|`, the `!`, a `.md` or `.board` after the name — all kept. A full path is written as the
  new full path; a leaf or a partial path as the shortest tail of the new name that names it alone,
  never shorter than what was written; a title as the new title. A name a wikilink cannot hold (a `#`,
  a `|`) leaves the link alone rather than writing a broken one.
- **The places are `extract.ts`'s**: a note's, a quiz's and a table's Markdown outside code, maths, an
  ordinary link's text and the frontmatter, and a board's `md` and `note` items. A `[[x]]` in a code
  span or a diagram's DSL is text and stays as written.
- **It runs inside the request**, so when the Assistant renames something the chat's recorder holds the
  rewrites in the same op as the rename, and undoing the block undoes both (`test/server/relink.test.ts`).
  A page holding one of those notes open adopts the rewrite through the change feed like any outside write.
- **What it does not follow, and why.** A transfer to another vault: a link resolves within its vault,
  and the one left behind cannot name a document that is no longer in it. A restore from the trash that
  was numbered, and anything moved on disk outside the app: the app was not the one that moved it.
- **No notice and no undo of its own**, which is Obsidian's behaviour: a person who renames a file wants
  the links to keep working and nothing to ask. Undo is the Assistant's block undo; a rename made by
  hand is undone by renaming it back, which rewrites the links back.
