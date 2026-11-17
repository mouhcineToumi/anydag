# Resource use and limits

> What the app costs to run, where it slows down and where it stops, measured; the bench that measures it and the nightly guards.

## Resource use and limits

Measured on 2026-11-14 by `node scripts/bench.mjs` (#261), on one laptop:

| | |
|---|---|
| CPU | 11th Gen Intel Core i5-11400H, 6 cores / 12 threads, 2.7–4.5 GHz |
| Memory | 23 GB |
| OS | Linux 7.2 (Omarchy, Arch based), x64, Wayland |
| Runtimes | Node 26.12, Chromium 158 (Playwright 1.65), Electron 45.2 |
| Disk | the vaults on `/tmp`, a **tmpfs** — so these numbers are CPU and memory, not disk; a cold read off an SSD adds to every *cold* figure |

The whole output of that run is at the foot of this file. Each figure below is in it, under the
metric named in brackets.

### The limits

"Works well" is under about a second for what a person waits on and a resting cost nobody notices;
"degrades" is seconds, or memory a person would see in a task manager; "breaks" is a step that takes
long enough to read as hung, or that is refused.

| Dimension | Works well up to | Degrades at | Breaks at |
|---|---|---|---|
| **Vault size** (files, 90% notes) | **1,000** — every route under 1.5 s cold and 60 ms warm; the app starts to a drawn board in 1.1 s; first search 0.8 s; server 174 MB at rest, 342 MB while a search engine is held | **10,000** — startup to a drawn board 1.2 s (2.2 s before #283); first search 4.2 s in the page (`page.10000.search.first`) and 23 s cold on the server; a warm `/index` 14 ms and 0.33 s after a burst of 200 writes (0.5 s and 2.3 s before #280); a 1,000-file folder is on the screen 47 ms after the listing arrives (936 DOM elements, it was 18k); server 389 MB at rest, 807 MB while a search engine is held (#279) | **50,000** — first search 20 s and a 2.5 GB renderer (`page.50000.rss.renderer.search`); server 431 MB at rest, 1.8 GB while a search engine is held, a 575 MB peak in the server itself (3.2 GB before #279); cold `/index` 53 s; a 5,000-file folder is on the screen 180 ms after the listing arrives, in 936 DOM elements (it was 90k and 1.4 s), but the first listing itself is a 5.2 s walk; a cold `/index` holds every other request for 1.7 s |
| **Board size** (items, one in ten a 6-node diagram) | **500** — 0.95 s to `data-dag-ready`, its renderer 285 MB | **2,000** — 5.7 s, its renderer 643 MB, 30k DOM elements | not reached at 2,000 |
| **Diagram size** (`arch` nodes, ELK) | **200** — 0.9 s | **500** — 2.9 s | **1,000** — 8.3 s with nothing drawn until it is done |
| **Attachment size** | **512 MB**, the limit — streamed both ways (#278): a 500 MB upload 1.1 s, read 0.8 s, a 1 KB range of it 5 ms; the server peaks about 80 MB over its resting size, the same at 100 MB as at 500 | not reached at the limit | **512 MB** — the default limit, `ANYDAG_UPLOAD_MAX_MB`; above it a `413` in 6 ms |
| **Note size** (words) | **1,000** — 0.5 s | **100,000** (≈ 600 KB) — 2.0 s | not reached at 100,000 |

The vault limit is set by three things that scale with the vault rather than with what changed —
search (#282, and #267's index), the listing and references index (cold only since #280: warm, each
costs what changed), and the server's memory (#279). None of them is the disk. The sidebar's tree was
a fourth until #281: it draws the rows in view and a margin now, so a folder of 5,000 files costs what
one of 100 does. Startup no longer is one: since #283 the listing runs off the server's thread and a
board is drawn in about the same time at every vault size (*Startup*).

### Memory, per process

The desktop app with a 1k-file vault and a board of 20 items open, at rest (`desktop.rss.*`;
`app.getAppMetrics()` for Electron's processes, `/proc` for the server child):

| Process | Resident |
|---|---|
| Electron main (`Browser`) | 220 MB |
| GPU | 174 MB |
| Utility (Chromium's services) | 91 MB |
| The page (`Tab`) | 179 MB |
| The server child | 229 MB |
| **All of it** | **894 MB** |

The server starts at 100 MB whatever the vault (Node and the bundle). Before #279 it grew with the
vault from the first whole-vault request and never let go: 312 MB at 1k, 829 MB at 10k, 1.8 GB at 50k
after list, index and search, a 3.2 GB peak at 50k — V8 keeps the pages its heap grew into, a worker
thread's included. Since #279 the grammar's worker is a process that exits when idle (30 s, or 5 min
after a search), and what it parsed is kept in the home's `parse.sqlite` rather than in its memory, so
the next one starts from there. Measured on the same machine (`vault.*.server.rss.*`; 1k from an
earlier run):

| | 1k | 10k | 50k |
|---|---|---|---|
| server and worker, after list, index and search (`used`) | 342 MB | 807 MB | 1.8 GB |
| the server alone, its peak (`peak`) | 174 MB | 389 MB | 575 MB |
| at rest, the worker ended (`rest`) | 174 MB | 389 MB | 431 MB |

What `used` held until #267 was the search engine (MiniSearch over every unit, in the worker while it
was up); the on-disk index that replaced it took `used` to 610 MB at 10k and 882 MB at 50k (*The
search index* below). Most of what `rest` holds over the 100 MB start is the listing's
worker thread (#288): 258 MB after the first `/list` on 10k files. A worker started again after it
ended answers a warm `/index` in 0.16–0.33 s, parsing nothing whose stamp or sha1 did not move
(`vault.*.index.after-idle`). Before #267 the first search after it rebuilt the engine from the rows:
1.3 s at 1k, 4 s at 10k, 20 s at 50k (`vault.*.search.after-idle`); since, it is a lookup in the file,
19 ms at 1k and 0.5 s at 50k. It is not a leak — 30 more rounds of list, index and search
on 10k files hold it flat, and 100 change feeds opened and dropped add 4 MB. The page's own heap is
13 MB on a note and 22–100 MB on a board; the search card's index is the page's biggest cost (#282).

### CPU

**Idle is zero.** With a vault open and the change feed held, the server used 0.00–0.07% of one core
over 15 s at every vault size; the page 0.00–0.07% with a note open and 0.0–0.3% on a board of up to
2,000 items; the desktop app 0.13% in its main process and nothing elsewhere, with 6 idle wakeups a
second, all in the main process (`*.idle.*`). The watcher, the change feed's 20 s ping and the
telemetry timer (off without consent) are all that runs, and none of them shows.

**A measurement trap, found here:** the same board loaded three times in one tab used 2–4% of a core
for tens of seconds afterwards. That is V8's major GC collecting the previous loads' documents in the
renderer Chromium keeps for the site, not the board — a fresh tab with the board loaded once idles at
0%. The bench measures idle on a fresh tab for that reason.

**A burst of 200 external writes** (an agent or a sync tool landing files) is heard in full by the
change feed in 62–68 ms and costs the server 0.03–0.4 s of CPU at any vault size
(`vault.*.burst.*`). What follows it is the cost: the page's next `/index` is 0.3 s at 1k files and
3.1 s at 50k before #280, and 0.33 s at 10k and 0.5–0.6 s at 50k since: only the 200 texts that moved
are read, parsed and their links resolved again (`search.md`, `server.md`).

### Time

| Step | 1k files | 10k files | 50k files |
|---|---|---|---|
| server spawn to listening, vault opened | 164 ms | 168 ms | 167 ms |
| `/__board/list` cold · warm | 168 · 25 ms | 1.1 s · 232 ms | 5.2 s · 1.1 s |
| … warm since #280 | 3–4 ms | 12–37 ms | 24–63 ms |
| `/__board/index` cold · warm | 1.4 s · 57 ms | 11.0 s · 540 ms | 53.0 s · 2.9 s |
| … warm since #280 · after 200 external writes | 2–3 ms · 0.3–0.8 s | 14–16 ms · 0.33–0.35 s | 36–82 ms · 0.48–0.59 s |
| `/__board/search` cold · warm | 2.3 s · 53 ms | 22.6 s · 513 ms | 113 s · 2.8 s |
| a note opened in the page, to `data-dag-ready` | 0.7 s | 1.1 s | 3.4 s |
| the search card's first match · next query | 0.8 s · 18 ms | 4.2 s · 111 ms | 20.0 s · 221 ms |

### The search index (#267)

A search is a lookup in an FTS5 index kept in the home's `parse.sqlite` beside the corpus's rows,
kept up to date as a watched vault changes (`search.md`). Measured with `node scripts/bench.mjs
--only vault`, develop (`301f71b`) and the change on the same machine, one after the other:

| `vault.*` | 1k | 5k | 10k | 50k |
|---|---|---|---|---|
| `search.warm` (median of 4) | 10.7 → 7.3 ms | 30.8 → 25.5 ms | 57 → 38.2 ms | 285 → 180 ms |
| `search.warm.short` (`h`) | 15.2 → 9.3 ms | 51.7 → 31.1 ms | 110 → 60 ms | 561 → 289 ms |
| `search.after-idle` (a worker started again) | 392 → 19.3 ms | 2.0 s → 53 ms | 3.9 s → 114 ms | 20.3 s → 543 ms |
| `search.after-restart` (the app started again) | 561 → 154 ms | 2.1 s → 171 ms | 4.0 s → 218 ms | 19.6 s → 627 ms |
| `search.after-burst` (200 writes, then `/index`, then a search) | 874 → 596 ms | 2.1 s → 641 ms | 4.1 s → 607 ms | 18.4 s → 725 ms |
| `search.after-burst.quiet` (200 writes, 5 s quiet, a search) | 950 → 8.5 ms | 2.4 s → 17 ms | 4.3 s → 31 ms | 18.5 s → 164 ms |
| `search.cold` (a new home: the vault parsed and indexed) | 2.5 → 2.3 s | 12.5 → 11.9 s | 28.2 → 24.3 s | 125 → 113 s |
| `index.warm` · `index.after-burst` | 4.4 → 4 ms · 365 → 427 ms | 11.3 → 14.6 ms · 352 → 355 ms | 20 → 19 ms · 360 → 418 ms | 92 → 149 ms · 526 → 591 ms |
| `server.rss.used` (server and worker) | 336 → 366 MB | 600 → 516 MB | 750 → 610 MB | 1.85 GB → 882 MB |
| `home.size` after the burst | 2.8 → 8.9 MB | 14 → 23 MB | 23 → 41 MB | 100 → 167 MB |

What it costs is disk: the words table and its terms are 1.7× the rows at 50k. What it does not cost
is the references index: the background read that keeps the search index up to date waits for
`/index` to go quiet, parses 8 texts at a time and gives way between them (`search.md`). With 50
texts a time and no wait, a warm `/index` at 5k took 759 ms and one after a burst 605 ms, because
`/index`'s own entries crossed to the worker a chunk at a time. `search.after-burst` stays at ~0.6 s
because the bench asks `/index` and the search right after the burst. The background read waits
for `/index` to go quiet, so the search reads the 200 texts itself; `.quiet` is the same burst
with the background read let finish.

**Two lists that drew every row** (#267), measured with `node scripts/bench.mjs --only vault,page`,
develop (`301f71b`) and the change on the same machine, one after the other:

| `page.*` | 1k | 10k | 50k |
|---|---|---|---|
| `search.open`: the search card opened, nothing typed, to its first row | 108 → 85 ms | 917 → 70 ms | 3.4 s → 144 ms |
| `search.open.dom`: elements in the card | 7,976 → 374 | 79,772 → 358 | 399,238 → 358 |
| `tasks.ready`: `?tasks=1` to its first row (4% of the vault is tasks) | 146 → 140 ms | 435 → 206 ms | 932 → 342 ms |
| `tasks.dom`: elements in the page | 2,285 → 2,285 | 15,511 → 2,119 | 72,615 → 2,127 |
| `rss.renderer.search` | 235 → 217 MB | 486 → 244 MB | 306 → 267 MB |

With nothing typed the search card lists every name in the vault, and the Tasks page every open
task; both draw the rows in view and a margin now (`sidebar.md`, `tasks-projects-calendar.md`). The
Tasks page draws every row of a list of up to 100, so at 1k it is unchanged.

### Startup

The desktop app (Electron on `desktop/dist/main.cjs`), from launch to its first window and to a
20-item board drawn, on a fresh app home and then a second launch on the same one
(`desktop.startup.*`), before #283 and after it:

| Vault | First window | Board drawn, first launch | Board drawn, second launch |
|---|---|---|---|
| 100 files | 0.37 s | 0.97 s → 1.19 s † | 0.96 s → 1.08 s † |
| 1,000 files | 0.36 s | 1.13 s → 1.02 s | 1.12 s → 1.27 s † |
| 10,000 files | 0.36 s | 2.15 s → 1.25 s † | 2.00 s → 1.31 s † |
| 50,000 files | 0.36 s | **6.42 s → 1.22 s** | **5.59 s → 1.08 s** |

† measured with other benches running on the machine (a load average of 3 to 6): the first window,
which nothing in #283 touches, took 0.41–0.62 s in those launches against 0.36 s, so these are up to
0.25 s slow. The 1k and 50k first launches were run back to back with the commit before #283, which
measured 1.16 s and 6.62 s in the same conditions.

The window is the same at every size, and since #283 so is the board. Each launch starts a new
server, and its first `/__board/list` walks the whole vault — 5.2 s on 50k files. **Before #283 it did
so on the server's one thread**: every request waited, `/api/health` and the board's own `/__board/get`
4–5.7 s against 3 ms and 1 ms alone, and the second launch was barely faster because nothing of the
walk survives the process. Now the walk and the frontmatter reads are on a worker and the index is
reconciled in 8 ms slices (`server.md`), and while the cold listing runs the slowest `/api/health` is
17 ms and the slowest `/__board/get` 37 ms on 50k files (`desktop.startup.*.list.*`, asked back to
back for as long as it runs — over 10,000 of each). The listing itself takes as long as it did; the
sidebar fills in when it arrives. In a browser on `anydag serve` the first page load, chunks and fonts
included, is 0.54 s (`board.empty.first`), and the server is listening 165 ms after it is spawned at
every vault size.

A document with no `id:` opened by name on an app home that has never listed the vault — a first
launch, a deep link into an imported vault — had its id found by a walk on the server's thread: on
50k files `/__board/get` of such a note took 5.3 s and `/api/health` waited as long. Since #286 it is
given its provisional id alone, and both answer in 15 ms at 1k and at 50k files
(`desktop.startup.*.open.*`, which also checks that the listing after it gives the note the same id).

What still held the thread at launch, measured on 50k files: a cold `/__board/index` 1.8 s, and a
warm one 2.0 s, reading every text on the server's thread to send to the grammar's worker. Since #287
the worker reads them, and the slowest `/api/health` while either runs is 31 and 21 ms
(`vault.*.index.*.health`).

On 50k files that worker then ran into its own deadline: one read of the whole vault took longer than
the 60 s the server gives the worker, so a cold `/index` fell back to running inline and held
`/api/health` for 54–83 s, and every warm `/index`, `/corpus` and search after it waited the full
60 s first (a warm `/index` took 60 s, a search 76 s). Since #279 the deadline is per step: the
worker reads and parses 500 texts (or 2 MB) at a time, saves them, and tells the server it is still
going, and the engine is built a thousand documents at a time. A cold `/index` on 50k files holds `/api/health` for 81 ms at most (54 s before), a warm one
answers in 0.1 s and a warm search in 0.27 s (`vault.50000.*`).

### Disk

The app home holds the SQLite index and, since #279, `parse.sqlite` — what the grammar's worker
parsed, deflated — and nothing that grows on its own: 2.1 MB for 1k files, 24 MB for 10k, 97 MB for
50k (`vault.*.home.size`; 0.34, 3.6 and 13 MB before #279), unchanged by a burst of writes. It is a
cache: deleting `parse.sqlite` costs one parse of the vault, and rows written by another build are
not trusted.
**Opening a vault wrote nothing to it** at any size, `.anydag/` included (`vault.*.open.writes`). The
trash is the vault's (`<vault>/.anydag/trash/`) and is bounded by time, thirty days, not by size.

The Linux installer, measured with `npm run desktop:dist` (no bench group; `du --apparent-size`):

| | Before #302 | After #302 | Change |
|---|---|---|---|
| AppImage | 132.21 MiB | 130.11 MiB | −2.10 MiB (−1.6%) |
| Unpacked (`linux-unpacked/`) | 314.02 MiB | 306.72 MiB | −7.31 MiB (−2.3%) |
| `locales/` | 7.64 MiB, 55 packs | 0.37 MiB, 3 packs | −7.27 MiB |
| `resources/` (the asar and what is unpacked from it) | 40.20 MiB | 40.16 MiB | −37 KB |

The Electron binary is 224 MiB of the unpacked tree and the rest of Chromium (`resources.pak`,
`icudtl.dat`, the licences, SwiftShader) another 42 MiB; none of it is the app's to cut. The
`resources/` that is the app's holds no source maps, tests or docs: the page's bundle is 21 MiB of the
asar (the emoji sets, the icon set, ELK and pdf.js the largest), and the unpacked server and CLI 18 MiB
— each with its own grammar and listing workers, because the CLI serves in-process. #302 kept only
the English, French and Arabic locale packs (`electronLanguages`) and dropped what the watcher's
package carries for a build from source, and the CLI's `meta.json`.

### What bears on #267

- **`desktop/forward.ts` costs nothing measurable.** A request from the page through `anydag://` and
  the forward is 0.70 ms (`desktop.request.health`); from a browser straight to `anydag serve` it is
  0.95 ms, and from Node 0.35 ms. `/__board/list` on 1k files is 16.6 ms through the forward and 21.3 ms
  straight. Removing the hop would save under half a millisecond a request.
- **`utilityProcess` would gain nothing measurable.** The main process idles at 0.13% of a core and
  220 MB, most of which is Electron's own; the server child is already out of it, and its memory is the
  vault's (#279), which no change of process type moves.
- **Search at 5k notes:** measured since, in *The search index*: a warm search is 25 ms, the first
  one after the app starts again 171 ms, and none of them reads the vault again. A cold server search
  on a new home is still 12 s, the vault parsed once into the index.
- **Lists at 10k files:** a 1,000-row folder was 18k DOM elements and 1.6 s to draw, a 5,000-row one
  90k and 6.7 s. The sidebar draws the rows in view and a margin since #281 (`sidebar.md`): 936 elements
  whatever the folder holds, and the rows are on the screen 47 ms (1,000 rows) and 180 ms (5,000) after
  the listing reaches the page, from 270 ms and 1,400 ms. `sidebar.drawn` at 50k files was still 2.3 s
  after `note.ready` in that run, which was before #283: the page's `/__board/list` was the last of
  three requests the server's one thread answered in turn. Since #283 nothing waits behind the listing,
  but the listing still takes as long as its walk (*Startup*); `sidebar.after-list` is the part that is
  the sidebar's.
- **Time to first paint:** 0.36 s to a window at every vault size, and about 1.1 s to a drawn board
  at every size since #283 (6.4 s on 50k before it; *Startup*). The update check runs after the
  window in a packaged build and is off in a dev run, so it is not in the number; deferring work past
  the first paint (#267 item 6) is not where the time went — the first listing was (#283).
- **The first load** (#267 item 5): the entry was 1.07 MB and every page waited out React's 300 ms
  lazy throttle. That wait was the time, not the bytes (*The first load*, #303).

### The first load

What a page downloads before it draws, and how long it takes, before and after #303 split the
read-only view, the canvas and the pages a board never draws into chunks of their own
(`references.md`; `src/ui/chunk.ts`). Bytes are from `npm run build`: the entry chunk and every chunk
it imports statically, then with the chunks each page draws through. Gzip is level 9.

| What is fetched | Before | After |
|---|---|---|
| the entry and its static imports | 1,066 kB · 335 kB gzip | **415 kB · 135 kB gzip** |
| a board page (the entry and `App`) | 1,902 kB · 592 kB gzip | **1,626 kB · 512 kB gzip** |
| a note page (and the block editor) | 2,977 kB · 925 kB gzip | **2,701 kB · 845 kB gzip** |
| a `?view=1` page (the entry and `ViewApp`) | 1,066 kB · 335 kB gzip | 1,069 kB · 339 kB gzip |

The entry held the whole read-only view, because `Gate` imported `ViewApp` statically, and `App`
held every page: the Calendar, Tasks, quizzes, tables, the Trash, the Assistant and its panel,
Settings, the search card, the feedback card and the export zip (`fflate`). Each of these is now a
chunk that is fetched once the first page reports `data-dag-ready`.

**The time came from somewhere else.** `App` was behind `React.lazy`, and React held every page back
until 300 ms after the empty fallback went up (*`React.lazy` costs 300 ms the first time it renders*).
A drawn board, three builds served by one server and loaded cold in turn, 15 rounds, medians:

| Page, to `data-dag-ready` | Before | Smaller chunks, `App` still lazy | After |
|---|---|---|---|
| a one-card board | 515 ms | 502 ms | **215 ms** |
| a 20-node `arch` | 569 ms | 557 ms | **270 ms** |
| a note | 614 ms | 605 ms | **323 ms** |
| `?view=1` of the `arch` | 236 ms | 206 ms | 208 ms |
| the Calendar, to its grid | 920 ms | 874 ms | **174 ms** |

So the fewer bytes are worth about 10 ms on a local server, and the throttle was worth about 300.
The Calendar gained more than one throttle; where the rest went was not isolated.
`node scripts/bench.mjs --only board --quick`, run twice on each build: `board.empty.first` 494 → 257–301 ms,
`board.empty.ready` 395 → 155–166 ms, `board.100.ready` 577 → 337–358 ms, `note.1k.ready` 481–537 →
185–226 ms. `--only desktop --quick`: launch to a drawn 20-item board 1.01–1.21 s → 0.75–0.95 s,
and the board's own window 682 → 410 ms from navigation to `data-dag-ready`. The first window is
unchanged, because it comes before any of the page's script runs.

### The graph view's simulation (#458)

`node scripts/bench.mjs --only graph` (`graph.*`), on another machine than the rest of this file: an
Intel i5-8300H laptop, 4 cores and 8 threads, 12 GB, Node 26.12, load average 1, 2026-11-17. It runs
the simulation's source in the bench's own process and needs no build. The vault is the design
session's made-up one (`scripts/bench-graph.mjs`), about 1.3 links per file.

| Files | Links | One tick | Hot to rest, through the host | Typed arrays held |
|---|---|---|---|---|
| 500 | 640 | 0.26 ms | 0.92 s | 0.1 MB |
| 2,000 | 2,632 | 1.0 ms | 0.92 s | 0.4 MB |
| 5,000 | 6,695 | 3.1 ms | 0.92 s | 1 MB |
| 20,000 | 27,049 | 14.3 ms | 2.7 s | 4 MB |
| 5,000, dense | 150,000 | 5.4 ms | 1.2 s | |

A settle is 220 ticks and the host paces them at 240 a second, so 0.92 s is the floor: up to about
5,000 files a settle waits on the clock, not the tick; at 20,000 the tick is the limit. Works well up
to **5,000** files, degrades at **20,000** (2.7 s to rest, a core busy for it); the prototype it
replaced took 8.2 ms and 41 ms a tick on the same machine. The account, and the prototype beside it
at every size, is in [`graph-simulation.md`](graph-simulation.md).

### Not measured

- **The packaged app on macOS and Windows**, and the packaged app at all for memory and time — the
  `desktop` group runs Electron on `desktop/dist/main.cjs`. The script runs on macOS (memory and CPU
  through `ps`) but was not run there; on Windows the per-process lines say `n/a`.
- **A real disk.** Every vault was on tmpfs; cold reads of a 50k-file vault off an SSD, or a spinning
  disk, or a synced folder, will be slower.
- **Hours of use.** The leak checks are 30 rounds and 100 feeds, not a working day; a slow leak over
  hours would not show.
- **Other diagram layouts** — only `arch` (ELK). `flow` and `activity` lay out with `lanes.ts`, and the
  sequence, timeline and gitgraph layouts are linear passes.
- **The Assistant, prompt cards and sync**, which spend their time in other processes or on the
  network; the calendar at 10k tasks. (The Tasks page is `page.*.tasks.*`, 2,000 tasks at 50k.)

## The bench

`scripts/bench.mjs` makes every measurement above in one run (about 25 minutes, most of it the 50k
vault); `--quick` is a minute or two. Its header is the reference: the flags, the output format
(`<metric>  <value> <unit>  # note`, plus `--json`), and what each group measures and how. Four
rules it keeps:

- **The vaults are generated in a temp folder of its own** (`mkdtemp` in the system's temp folder,
  `anydag-bench-*`), from a seeded generator so two runs write the same files, and **removed by that
  exact path only**: the cleanup refuses any path that is not a folder it made directly in the temp
  folder (see *A cleanup that matches by prefix must refuse an empty one*). Every server has its own
  temp `ANYDAG_HOME`, and the Electron run its own `HOME`, so the shim it writes lands in the temp
  folder too.
- **A vault is generated with its `.anydag/vault.json`**, as one opened before has, so that
  "opening wrote nothing" can be checked to the byte: every file's size and mtime before the server
  starts and after list, index and search.
- **Every page time waits on `data-dag-ready`**, never a timeout; it already waits for the fonts and
  the re-layout they cause. A board is loaded three times and the median kept, after one load of an
  empty board that pays for the page's own chunks.
- **CPU and memory are per process** — `/proc/<pid>/stat` and `status` on Linux, the Chromium tree
  walked from the browser's pid, Electron's from `app.getAppMetrics()` — never a whole-machine figure.

**The release table** (`node scripts/bench.mjs --release`) is the one table a release carries (#328):
ten fixed rows — startup to a drawn board, the page's first search, the server's memory at rest, the
1,000-file vault's `/list`, `/index` and `/search` cold and warm, and a 500-item board to
`data-dag-ready` — with the release before it beside each, read from `docs/bench/<version>.json` so
the comparison works offline and a number that moved is a diff in a pull request. The run names the
machine it ran on in one line. `--save` writes the current run's file for the next release; the step
is in [`RELEASING.md`](../RELEASING.md). It is not run in CI, because a runner's numbers are not the
release machine's, and it is not a guard: nothing is held back. The first release to carry it has no
earlier file, so its table has no previous numbers.

**The guards.** `--guard` runs two numbers against `scripts/bench-guard.json`, in the nightly's
`bench` job, in the Playwright image the e2e suite uses (`test/e2e-image.test.ts` holds its pin):
the server's idle CPU with the change feed open on a 1k-file vault (ceiling 1% of a core; it measures
0), and a 200-node `arch` diagram's time to `data-dag-ready`, median of three (ceiling 4,000 ms; it
measures 0.97 s here and 1.8 s on two cores, which is about a runner). A ceiling is about twice what a
runner measures, so the job goes red on a 2x regression and not on a slow night; it holds nothing
back. Raise a ceiling only with a run that says why.

**Out, and why:** a guard on every number — the nightly holds the two that are cheap and stable, and
the rest moved by up to 2x between runs on this laptop (a board timed straight after the 50k vault,
with the browser still giving back gigabytes, was twice as slow, which is why boards now run first), and
a guard that fails on noise is one nobody reads; and fixing what was found, which is one issue each:
#278 (attachments held whole in memory; fixed, streamed now), #279 (the server's memory grows with the vault), #280 (the
listing and the references index re-read the vault per call), #281 (the sidebar was not virtualised; it is now),
#282 (the search card loads the vault's text into the page), #283 (the first listing holds the
server's thread, so startup grows with the vault).

## The run

`node scripts/bench.mjs --json bench.json`, 2026-11-14, the machine above. The `desktop.startup.*`
lines at the end are from `node scripts/bench.mjs --only desktop` the same day, run after startup was
added to the script. The `page.100`, `page.1000`, `page.10000` and `page.50000` lines `note.ready`
through `rss.browser` are from `node scripts/bench.mjs --only page` after the sidebar was virtualised
(#281), on a quiet machine, the same day: `sidebar.drawn` is now the first 10 rows of `inbox/` (it
waited for all of them while the tree drew them all), and `sidebar.after-list` is new. Before it, at
10k and 50k files, `sidebar.drawn` was 1.6 s and 6.7 s, `sidebar.rows` 1,006 and 5,042,
`dom.nodes` 18,092 and 89,894, and `sidebar.after-list` 0.27 s and 1.4 s.
The `attach.*` lines are from `node scripts/bench.mjs --only attach` the same day,
after attachments were streamed (#278); before it, the server peaked at 1,130 MB on the 500 MB upload
and 1,630 MB on its read, and a 1 KB range of it took 180–190 ms.

```text
# AnyDag bench · 2026-11-14T08:27:37.344Z
# 11th Gen Intel(R) Core(TM) i5-11400H @ 2.70GHz · 12 cores · 23 GB · Linux 7.2.15-1-omarchy (Omarchy) · x64 · Node v26.12.0
# Chromium 158.0.8127.18
board.empty.first                        542 ms            # first page load: chunks, fonts
board.empty.ready                        411 ms            # one card: the floor every board below includes
board.10.ready                           494 ms            # 10 items, one in ten a diagram; median of 3, max 507
board.10.heap                            22.7 MB
board.10.rss.renderer                    258 MB
board.10.dom.nodes                       578 count
board.100.ready                          594 ms            # 100 items, one in ten a diagram; median of 3, max 627
board.100.heap                           28.5 MB
board.100.rss.renderer                   312 MB
board.100.dom.nodes                      1927 count
board.100.idle.cpu                       0.3 %             # Chromium (browser, GPU, this page's renderer), the board loaded once in a fresh page, 10 s
board.100.idle.cpu.renderer              0.1 %
board.100.idle.main-thread               0 %               # the page's main thread busy
board.100.rss.renderer.fresh             215 MB            # this page's renderer, loaded once
board.500.ready                          952 ms            # 500 items, one in ten a diagram; median of 3, max 1023
board.500.heap                           57.5 MB
board.500.rss.renderer                   517 MB
board.500.dom.nodes                      7917 count
board.500.idle.cpu                       0 %               # Chromium (browser, GPU, this page's renderer), the board loaded once in a fresh page, 10 s
board.500.idle.cpu.renderer              0 %
board.500.idle.main-thread               0 %               # the page's main thread busy
board.500.rss.renderer.fresh             285 MB            # this page's renderer, loaded once
board.2000.ready                         5729 ms           # 2000 items, one in ten a diagram; median of 3, max 6014
board.2000.heap                          101 MB
board.2000.rss.renderer                  1108 MB
board.2000.dom.nodes                     30457 count
board.2000.idle.cpu                      0.1 %             # Chromium (browser, GPU, this page's renderer), the board loaded once in a fresh page, 10 s
board.2000.idle.cpu.renderer             0 %
board.2000.idle.main-thread              0 %               # the page's main thread busy
board.2000.rss.renderer.fresh            643 MB            # this page's renderer, loaded once
diagram.50.ready                         601 ms            # one arch diagram of 50 nodes; median of 3, max 952
diagram.200.ready                        902 ms            # one arch diagram of 200 nodes; median of 3, max 928
diagram.500.ready                        2879 ms           # one arch diagram of 500 nodes; median of 3, max 2880
diagram.1000.ready                       8311 ms           # one arch diagram of 1000 nodes; median of 3, max 8739
diagram.1000.heap                        28.1 MB
diagram.1000.rss.renderer                585 MB
note.1k.ready                            488 ms            # a note of 1,000 words; median of 3, max 565
note.100k.ready                          2041 ms           # a note of 100,000 words; median of 3, max 2573
note.100k.heap                           58.4 MB
diagram.1000.parse                       58.7 ms           # server: GET /__board/diagnostics
attach.server.rss.start                  100 MB
attach.1.upload                          39.2 ms
attach.1.rss.peak.upload                 102 MB            # server peak RSS so far
attach.1.read                            7 ms              # GET the whole file
attach.1.rss.peak.read                   102 MB            # server peak RSS so far; RSS now 102 MB
attach.1.range                           2.8 ms            # the first KB, as a PDF viewer asks
attach.10.upload                         37.3 ms
attach.10.rss.peak.upload                115 MB            # server peak RSS so far
attach.10.read                           23.5 ms           # GET the whole file
attach.10.rss.peak.read                  135 MB            # server peak RSS so far; RSS now 135 MB
attach.10.range                          3.8 ms            # the first KB, as a PDF viewer asks
attach.100.upload                        220 ms
attach.100.rss.peak.upload               169 MB            # server peak RSS so far
attach.100.read                          144 ms            # GET the whole file
attach.100.rss.peak.read                 168 MB            # server peak RSS so far; RSS now 162 MB
attach.100.range                         5.1 ms            # the first KB, as a PDF viewer asks
attach.500.upload                        1061 ms
attach.500.rss.peak.upload               177 MB            # server peak RSS so far
attach.500.read                          763 ms            # GET the whole file
attach.500.rss.peak.read                 182 MB            # server peak RSS so far; RSS now 160 MB
attach.500.range                         4.9 ms            # the first KB, as a PDF viewer asks
attach.over-limit.ms                     6 ms              # answered 413 to 600 MB declared, against the 512 MB default
attach.vault.size                        611 MB
vault.100.generate                       6.4 ms            # 0.2 MB on disk
vault.100.server.start                   193 ms            # spawn to listening, the vault opened
vault.100.server.rss.start               99.4 MB
vault.100.list.cold                      52.3 ms           # 0.0 MB answer; walks the vault and fills the index
vault.100.list.warm                      4.2 ms
vault.100.index.cold                     243 ms            # every text parsed in the grammar worker
vault.100.index.warm                     9.2 ms
vault.100.search.cold                    260 ms            # corpus parsed, engine built
vault.100.search.warm                    7.9 ms            # median of 4 queries
vault.100.server.rss.used                200 MB            # after list, index and search
vault.100.server.rss.peak                200 MB
vault.100.home.size                      0.13 MB           # the app home: SQLite index and its WAL
vault.100.idle.cpu                       0.07 %            # server, change feed open, 15 s
vault.100.open.writes                    0 count           # opening wrote nothing
vault.100.burst.events                   93 count          # 93 files written in 1 ms
vault.100.burst.settle                   62.7 ms           # first write to the last event the feed said
vault.100.burst.cpu                      0.03 s            # server CPU for the burst
vault.100.index.after-burst              413 ms            # only what changed is parsed again
vault.100.home.size.after-burst          0.13 MB
page.100.note.ready                      578 ms            # a note in inbox/ opened cold to data-dag-ready
page.100.sidebar.drawn                   580 ms            # from navigation to 10 rows of inbox/ in the sidebar
page.100.sidebar.after-list              138 ms            # from the listing arriving in the page to those rows drawn
page.100.sidebar.rows                    13 count          # rows in the DOM: a window of the list since #281
page.100.dom.nodes                       448 count
page.100.heap                            12.4 MB           # the page's JS heap
page.100.rss.renderer                    190 MB            # every renderer of the browser (one page open)
page.100.rss.browser                     533 MB            # every Chromium process
page.100.idle.cpu                        0.07 %            # all Chromium processes, a note open, 15 s
page.100.idle.main-thread                0 %               # the page's main thread busy, 15 s
page.100.search.first                    376 ms            # card opened to the first match in the text (corpus fetched, index built)
page.100.search.next                     12.2 ms           # a second query on the built index
page.100.heap.search                     14.3 MB           # the page's JS heap with the search index
page.100.rss.renderer.search             206 MB
vault.1000.generate                      31.6 ms           # 2.1 MB on disk
vault.1000.server.start                  164 ms            # spawn to listening, the vault opened
vault.1000.server.rss.start              100 MB
vault.1000.list.cold                     168 ms            # 0.2 MB answer; walks the vault and fills the index
vault.1000.list.warm                     25.1 ms
vault.1000.index.cold                    1396 ms           # every text parsed in the grammar worker
vault.1000.index.warm                    56.5 ms
vault.1000.search.cold                   2340 ms           # corpus parsed, engine built
vault.1000.search.warm                   52.9 ms           # median of 4 queries
vault.1000.server.rss.used               309 MB            # after list, index and search
vault.1000.server.rss.peak               309 MB
vault.1000.home.size                     0.29 MB           # the app home: SQLite index and its WAL
vault.1000.idle.cpu                      0 %               # server, change feed open, 15 s
vault.1000.open.writes                   0 count           # opening wrote nothing
vault.1000.burst.events                  200 count         # 200 files written in 1 ms
vault.1000.burst.settle                  68.3 ms           # first write to the last event the feed said
vault.1000.burst.cpu                     0.05 s            # server CPU for the burst
vault.1000.index.after-burst             329 ms            # only what changed is parsed again
vault.1000.home.size.after-burst         0.29 MB
page.1000.note.ready                     637 ms            # a note in inbox/ opened cold to data-dag-ready
page.1000.sidebar.drawn                  639 ms            # from navigation to 10 rows of inbox/ in the sidebar
page.1000.sidebar.after-list             122 ms            # from the listing arriving in the page to those rows drawn
page.1000.sidebar.rows                   30 count
page.1000.dom.nodes                      746 count
page.1000.heap                           11.5 MB           # the page's JS heap
page.1000.rss.renderer                   198 MB            # every renderer of the browser (one page open)
page.1000.rss.browser                    548 MB            # every Chromium process
page.1000.idle.cpu                       0.07 %            # all Chromium processes, a note open, 15 s
page.1000.idle.main-thread               0 %               # the page's main thread busy, 15 s
page.1000.search.first                   833 ms            # card opened to the first match in the text (corpus fetched, index built)
page.1000.search.next                    17.6 ms           # a second query on the built index
page.1000.heap.search                    34.7 MB           # the page's JS heap with the search index
page.1000.rss.renderer.search            270 MB
page.request.health                      0.95 ms           # browser → server, mean of 200
page.request.list                        21.3 ms           # browser → server, /__board/list on 1k files, mean of 20
node.request.health                      0.35 ms           # Node fetch → server, mean of 200
node.request.list                        21.3 ms           # Node fetch → server, mean of 20
vault.10000.generate                     278 ms            # 21.5 MB on disk
vault.10000.server.start                 168 ms            # spawn to listening, the vault opened
vault.10000.server.rss.start             99.8 MB
vault.10000.list.cold                    1118 ms           # 1.7 MB answer; walks the vault and fills the index
vault.10000.list.warm                    232 ms
vault.10000.index.cold                   11044 ms          # every text parsed in the grammar worker
vault.10000.index.warm                   540 ms
vault.10000.search.cold                  22636 ms          # corpus parsed, engine built
vault.10000.search.warm                  513 ms            # median of 4 queries
vault.10000.server.rss.used              719 MB            # after list, index and search
vault.10000.server.rss.peak              726 MB
vault.10000.home.size                    1.8 MB            # the app home: SQLite index and its WAL
vault.10000.idle.cpu                     0 %               # server, change feed open, 15 s
vault.10000.open.writes                  0 count           # opening wrote nothing
vault.10000.burst.events                 200 count         # 200 files written in 1 ms
vault.10000.burst.settle                 64.5 ms           # first write to the last event the feed said
vault.10000.burst.cpu                    0.03 s            # server CPU for the burst
vault.10000.index.after-burst            831 ms            # only what changed is parsed again
vault.10000.home.size.after-burst        1.8 MB
page.10000.note.ready                    1122 ms           # a note in inbox/ opened cold to data-dag-ready
page.10000.sidebar.drawn                 1424 ms           # from navigation to 10 rows of inbox/ in the sidebar
page.10000.sidebar.after-list            47.2 ms           # from the listing arriving in the page to those rows drawn
page.10000.sidebar.rows                  43 count
page.10000.dom.nodes                     936 count
page.10000.heap                          18.5 MB           # the page's JS heap
page.10000.rss.renderer                  210 MB            # every renderer of the browser (one page open)
page.10000.rss.browser                   553 MB            # every Chromium process
page.10000.idle.cpu                      0.07 %            # all Chromium processes, a note open, 15 s
page.10000.idle.main-thread              0 %               # the page's main thread busy, 15 s
page.10000.search.first                  4170 ms           # card opened to the first match in the text (corpus fetched, index built)
page.10000.search.next                   111 ms            # a second query on the built index
page.10000.heap.search                   137 MB            # the page's JS heap with the search index
page.10000.rss.renderer.search           668 MB
vault.50000.generate                     1273 ms           # 107.6 MB on disk
vault.50000.server.start                 167 ms            # spawn to listening, the vault opened
vault.50000.server.rss.start             100 MB
vault.50000.list.cold                    5240 ms           # 8.5 MB answer; walks the vault and fills the index
vault.50000.list.warm                    1100 ms
vault.50000.index.cold                   52960 ms          # every text parsed in the grammar worker
vault.50000.index.warm                   2892 ms
vault.50000.search.cold                  113343 ms         # corpus parsed, engine built
vault.50000.search.warm                  2760 ms           # median of 4 queries
vault.50000.server.rss.used              2633 MB           # after list, index and search
vault.50000.server.rss.peak              2633 MB
vault.50000.home.size                    17.6 MB           # the app home: SQLite index and its WAL
vault.50000.idle.cpu                     0 %               # server, change feed open, 15 s
vault.50000.open.writes                  0 count           # opening wrote nothing
vault.50000.burst.events                 200 count         # 200 files written in 1 ms
vault.50000.burst.settle                 65.4 ms           # first write to the last event the feed said
vault.50000.burst.cpu                    0.41 s            # server CPU for the burst
vault.50000.index.after-burst            3092 ms           # only what changed is parsed again
vault.50000.home.size.after-burst        17.6 MB
page.50000.note.ready                    3433 ms           # a note in inbox/ opened cold to data-dag-ready
page.50000.sidebar.drawn                 5770 ms           # from navigation to 10 rows of inbox/ in the sidebar
page.50000.sidebar.after-list            180 ms            # from the listing arriving in the page to those rows drawn
page.50000.sidebar.rows                  43 count
page.50000.dom.nodes                     936 count
page.50000.heap                          43.4 MB           # the page's JS heap
page.50000.rss.renderer                  306 MB            # every renderer of the browser (one page open)
page.50000.rss.browser                   650 MB            # every Chromium process
page.50000.idle.cpu                      0 %               # all Chromium processes, a note open, 15 s
page.50000.idle.main-thread              0 %               # the page's main thread busy, 15 s
page.50000.search.first                  19975 ms          # card opened to the first match in the text (corpus fetched, index built)
page.50000.search.next                   221 ms            # a second query on the built index
page.50000.heap.search                   821 MB            # the page's JS heap with the search index
page.50000.rss.renderer.search           2529 MB
leak.10000.rounds.rss                    822 MB            # RSS after rounds 10/20/30: 895 / 876 / 822
leak.feeds.rss                           826 MB            # 100 feeds opened and dropped; before 822 MB
leak.feeds.cpu-after                     0 %               # server, after the feeds were dropped, 5 s
desktop.first-window                     555 ms            # launch to the first window
desktop.ready                            1337 ms           # launch to data-dag-ready on a board of 20 items, 1k-file vault
desktop.ready.in-page                    814 ms            # the board's window: its navigation to data-dag-ready (±50 ms)
desktop.rss.browser                      220 MB            # app.getAppMetrics() working set
desktop.rss.gpu                          174 MB            # app.getAppMetrics() working set
desktop.rss.utility                      91 MB             # app.getAppMetrics() working set
desktop.rss.tab                          179 MB            # app.getAppMetrics() working set
desktop.rss.server                       229 MB            # the server child (/proc)
desktop.rss.total                        894 MB            # every process the app runs
desktop.idle.cpu.browser                 0.13 %            # 15 s, the board open
desktop.idle.cpu.gpu                     0 %               # 15 s, the board open
desktop.idle.cpu.utility                 0 %               # 15 s, the board open
desktop.idle.cpu.tab                     0 %               # 15 s, the board open
desktop.idle.cpu.server                  0.07 %            # 15 s, the board open
desktop.idle.wakeups.browser             6 /s              # app.getAppMetrics()
desktop.idle.wakeups.gpu                 0 /s              # app.getAppMetrics()
desktop.idle.wakeups.utility             0 /s              # app.getAppMetrics()
desktop.idle.wakeups.tab                 0 /s              # app.getAppMetrics()
desktop.request.health                   0.7 ms            # page → anydag:// → forward.ts → server, mean of 200
desktop.request.list                     16.6 ms           # the same for /__board/list on 1k files, mean of 20
desktop.home.size                        0.29 MB           # the app home after the launch
desktop.startup.100.cold.first-window    366 ms            # first launch, fresh app home
desktop.startup.100.cold.ready           967 ms            # launch to a 20-item board drawn, 100-file vault
desktop.startup.100.warm.first-window    359 ms            # second launch, same app home
desktop.startup.100.warm.ready           961 ms            # launch to a 20-item board drawn, 100-file vault
desktop.startup.1000.cold.first-window   360 ms            # first launch, fresh app home
desktop.startup.1000.cold.ready          1128 ms           # launch to a 20-item board drawn, 1000-file vault
desktop.startup.1000.warm.first-window   365 ms            # second launch, same app home
desktop.startup.1000.warm.ready          1124 ms           # launch to a 20-item board drawn, 1000-file vault
desktop.startup.10000.cold.first-window  359 ms            # first launch, fresh app home
desktop.startup.10000.cold.ready         2150 ms           # launch to a 20-item board drawn, 10000-file vault
desktop.startup.10000.warm.first-window  365 ms            # second launch, same app home
desktop.startup.10000.warm.ready         2002 ms           # launch to a 20-item board drawn, 10000-file vault
desktop.startup.50000.cold.first-window  358 ms            # first launch, fresh app home
desktop.startup.50000.cold.ready         6417 ms           # launch to a 20-item board drawn, 50000-file vault
desktop.startup.50000.warm.first-window  354 ms            # second launch, same app home
desktop.startup.50000.warm.ready         5587 ms           # launch to a 20-item board drawn, 50000-file vault
```

After #283, `node scripts/bench.mjs --only desktop --sizes 1000,50000` and then `--sizes 100,10000`,
2026-11-14, the machine above with other benches running on it (see *Startup*); the startup lines and
the listing probe:

```text
desktop.startup.100.list.cold            139 ms            # anydag serve, fresh app home: the first /__board/list
desktop.startup.100.list.health          38.1 ms           # the slowest /api/health of 35 asked while it ran
desktop.startup.100.list.get             15.6 ms           # the slowest /__board/get of the board, of 35
desktop.startup.100.cold.first-window    487 ms            # first launch, fresh app home
desktop.startup.100.cold.ready           1194 ms           # launch to a 20-item board drawn, 100-file vault
desktop.startup.100.warm.first-window    405 ms            # second launch, same app home
desktop.startup.100.warm.ready           1078 ms           # launch to a 20-item board drawn, 100-file vault
desktop.startup.1000.list.cold           254 ms            # anydag serve, fresh app home: the first /__board/list
desktop.startup.1000.list.health         23.1 ms           # the slowest /api/health of 140 asked while it ran
desktop.startup.1000.list.get            16 ms             # the slowest /__board/get of the board, of 140
desktop.startup.1000.cold.first-window   376 ms            # first launch, fresh app home
desktop.startup.1000.cold.ready          1019 ms           # launch to a 20-item board drawn, 1000-file vault
desktop.startup.1000.warm.first-window   563 ms            # second launch, same app home
desktop.startup.1000.warm.ready          1272 ms           # launch to a 20-item board drawn, 1000-file vault
desktop.startup.10000.list.cold          1205 ms           # anydag serve, fresh app home: the first /__board/list
desktop.startup.10000.list.health        11.4 ms           # the slowest /api/health of 1800 asked while it ran
desktop.startup.10000.list.get           27.5 ms           # the slowest /__board/get of the board, of 1800
desktop.startup.10000.cold.first-window  568 ms            # first launch, fresh app home
desktop.startup.10000.cold.ready         1248 ms           # launch to a 20-item board drawn, 10000-file vault
desktop.startup.10000.warm.first-window  621 ms            # second launch, same app home
desktop.startup.10000.warm.ready         1310 ms           # launch to a 20-item board drawn, 10000-file vault
desktop.startup.50000.list.cold          5555 ms           # anydag serve, fresh app home: the first /__board/list
desktop.startup.50000.list.health        17.1 ms           # the slowest /api/health of 10215 asked while it ran
desktop.startup.50000.list.get           37.1 ms           # the slowest /__board/get of the board, of 10215
desktop.startup.50000.cold.first-window  539 ms            # first launch, fresh app home
desktop.startup.50000.cold.ready         1217 ms           # launch to a 20-item board drawn, 50000-file vault
desktop.startup.50000.warm.first-window  412 ms            # second launch, same app home
desktop.startup.50000.warm.ready         1080 ms           # launch to a 20-item board drawn, 50000-file vault
```
