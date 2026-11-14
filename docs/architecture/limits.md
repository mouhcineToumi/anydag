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
| **Vault size** (files, 90% notes) | **1,000** — every route under 1.5 s cold and 60 ms warm; the app starts to a drawn board in 1.1 s; first search 0.8 s; server 309 MB | **10,000** — startup to a drawn board 1.2 s (2.2 s before #283); first search 4.2 s in the page (`page.10000.search.first`) and 23 s cold on the server; a warm `/index` 0.5 s, re-run after every change; a 1,000-file folder takes 1.6 s to draw; server 719 MB | **50,000** — first search 20 s and a 2.5 GB renderer (`page.50000.rss.renderer.search`); server 2.6 GB; cold `/index` 53 s; a 5,000-file folder 6.7 s and 90k DOM elements; a cold `/index` holds every other request for 1.7 s |
| **Board size** (items, one in ten a 6-node diagram) | **500** — 0.95 s to `data-dag-ready`, its renderer 285 MB | **2,000** — 5.7 s, its renderer 643 MB, 30k DOM elements | not reached at 2,000 |
| **Diagram size** (`arch` nodes, ELK) | **200** — 0.9 s | **500** — 2.9 s | **1,000** — 8.3 s with nothing drawn until it is done |
| **Attachment size** | **100 MB** — upload 0.26 s, read 0.17 s; the server peaks at 540 MB | **500 MB** — the server peaks at 1.6 GB and keeps it (#278) | **512 MB** — the default limit, `ANYDAG_UPLOAD_MAX_MB`; above it a `413` in 5 ms |
| **Note size** (words) | **1,000** — 0.5 s | **100,000** (≈ 600 KB) — 2.0 s | not reached at 100,000 |

The vault limit is set by three things that scale with the vault rather than with what changed —
search (#282, and #267's index), the listing and references index (#280), and the server's memory
(#279) — and the sidebar's tree (#281). None of them is the disk. Startup no longer is one: since
#283 the listing runs off the server's thread and a board is drawn in about the same time at every
vault size (*Startup*).

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

The server starts at 100 MB whatever the vault (Node and the bundle), and grows with the vault from
the first whole-vault request: 200 MB at 100 files, 309 MB at 1k, 719 MB at 10k, 2.6 GB at 50k
(`vault.*.server.rss.used`). It is not a leak — 30 more rounds of list, index and search on 10k files
hold it flat, and 100 change feeds opened and dropped add 4 MB — but nothing it holds is ever let go
(#279). The page's own heap is 13 MB on a note and 22–100 MB on a board; the search card's index is
the page's biggest cost (#282).

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
3.1 s at 50k (#280).

### Time

| Step | 1k files | 10k files | 50k files |
|---|---|---|---|
| server spawn to listening, vault opened | 164 ms | 168 ms | 167 ms |
| `/__board/list` cold · warm | 168 · 25 ms | 1.1 s · 232 ms | 5.2 s · 1.1 s |
| `/__board/index` cold · warm | 1.4 s · 57 ms | 11.0 s · 540 ms | 53.0 s · 2.9 s |
| `/__board/search` cold · warm | 2.3 s · 53 ms | 22.6 s · 513 ms | 113 s · 2.8 s |
| a note opened in the page, to `data-dag-ready` | 0.7 s | 1.1 s | 3.4 s |
| the search card's first match · next query | 0.8 s · 18 ms | 4.2 s · 111 ms | 20.0 s · 221 ms |

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

What still holds the thread at launch, measured on 50k files: a cold `/__board/index` 1.7 s (it reads
every text on the server's thread to send to the grammar's worker; #280's ground), and a document with
no `id:` opened by name on an app home that has never listed the vault, 5.7 s (its id is found by a
walk on the thread). Neither is on the path the bench measures; each is its own issue.

### Disk

The app home holds the SQLite index and nothing that grows on its own: 0.13 MB for 100 files, 0.3 MB
for 1k, 1.8 MB for 10k, 17.6 MB for 50k (`vault.*.home.size`), unchanged by a burst of writes.
**Opening a vault wrote nothing to it** at any size, `.anydag/` included (`vault.*.open.writes`). The
trash is the vault's (`<vault>/.anydag/trash/`) and is bounded by time, thirty days, not by size.

The Linux installer: the AppImage is 132 MiB; unpacked it is 314 MB, of which the Electron binary is
225 MB, `resources/` (the asar and the unpacked server) 40 MB, and `locales/` 7.8 MB for 55 locales
(`en-US.pak` is 96 KB) — so `electronLanguages` (#267 item 7) saves about 7.7 MB unpacked, 2.5%.

### What bears on #267

- **`desktop/forward.ts` costs nothing measurable.** A request from the page through `anydag://` and
  the forward is 0.70 ms (`desktop.request.health`); from a browser straight to `anydag serve` it is
  0.95 ms, and from Node 0.35 ms. `/__board/list` on 1k files is 16.6 ms through the forward and 21.3 ms
  straight. Removing the hop would save under half a millisecond a request.
- **`utilityProcess` would gain nothing measurable.** The main process idles at 0.13% of a core and
  220 MB, most of which is Electron's own; the server child is already out of it, and its memory is the
  vault's (#279), which no change of process type moves.
- **Search at 5k notes:** between the 1k and 10k rows above, so by interpolation a cold server search
  of about 11 s, a first answer in the page of about 2 s and a warm query of about 0.25 s — the warm
  figure `search.md` already records. #282 and #267's index are the fix.
- **Lists at 10k files:** a 1,000-row folder is 18k DOM elements and 1.6 s to draw, a 5,000-row one
  90k and 6.7 s — #281.
- **Time to first paint:** 0.36 s to a window at every vault size, and about 1.1 s to a drawn board
  at every size since #283 (6.4 s on 50k before it; *Startup*). The update check runs after the
  window in a packaged build and is off in a dev run, so it is not in the number; deferring work past
  the first paint (#267 item 6) is not where the time went — the first listing was (#283).

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
  network; the Tasks page and the calendar at 10k tasks.

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
#278 (attachments held whole in memory), #279 (the server's memory grows with the vault), #280 (the
listing and the references index re-read the vault per call), #281 (the sidebar is not virtualised),
#282 (the search card loads the vault's text into the page), #283 (the first listing holds the
server's thread, so startup grows with the vault).

## The run

`node scripts/bench.mjs --json bench.json`, 2026-11-14, the machine above. The `desktop.startup.*`
lines at the end are from `node scripts/bench.mjs --only desktop` the same day, run after startup was
added to the script.

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
attach.server.rss.start                  99.9 MB
attach.1.upload                          23.6 ms
attach.1.rss.peak.upload                 101 MB            # server peak RSS so far
attach.1.read                            6.6 ms            # GET the whole file
attach.1.rss.peak.read                   103 MB            # server peak RSS so far; RSS now 103 MB
attach.1.range                           2.9 ms            # the first KB, as a PDF viewer asks
attach.10.upload                         40.4 ms
attach.10.rss.peak.upload                127 MB            # server peak RSS so far
attach.10.read                           22.8 ms           # GET the whole file
attach.10.rss.peak.read                  147 MB            # server peak RSS so far; RSS now 147 MB
attach.10.range                          9 ms              # the first KB, as a PDF viewer asks
attach.100.upload                        257 ms
attach.100.rss.peak.upload               341 MB            # server peak RSS so far
attach.100.read                          174 ms            # GET the whole file
attach.100.rss.peak.read                 540 MB            # server peak RSS so far; RSS now 386 MB
attach.100.range                         39.9 ms           # the first KB, as a PDF viewer asks
attach.500.upload                        1326 ms
attach.500.rss.peak.upload               1132 MB           # server peak RSS so far
attach.500.read                          1054 ms           # GET the whole file
attach.500.rss.peak.read                 1632 MB           # server peak RSS so far; RSS now 1632 MB
attach.500.range                         192 ms            # the first KB, as a PDF viewer asks
attach.over-limit.ms                     5.5 ms            # answered 413 to 600 MB declared, against the 512 MB default
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
page.100.note.ready                      1627 ms           # a note in inbox/ opened cold to data-dag-ready
page.100.sidebar.drawn                   1636 ms           # from navigation to 10 rows of inbox/ in the sidebar
page.100.sidebar.rows                    13 count
page.100.dom.nodes                       448 count
page.100.heap                            13 MB             # the page's JS heap
page.100.rss.renderer                    188 MB            # every renderer of the browser (one page open)
page.100.rss.browser                     538 MB            # every Chromium process
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
page.1000.note.ready                     687 ms            # a note in inbox/ opened cold to data-dag-ready
page.1000.sidebar.drawn                  689 ms            # from navigation to 100 rows of inbox/ in the sidebar
page.1000.sidebar.rows                   102 count
page.1000.dom.nodes                      2016 count
page.1000.heap                           13.5 MB           # the page's JS heap
page.1000.rss.renderer                   203 MB            # every renderer of the browser (one page open)
page.1000.rss.browser                    552 MB            # every Chromium process
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
page.10000.note.ready                    1125 ms           # a note in inbox/ opened cold to data-dag-ready
page.10000.sidebar.drawn                 1626 ms           # from navigation to 1000 rows of inbox/ in the sidebar
page.10000.sidebar.rows                  1006 count
page.10000.dom.nodes                     18092 count
page.10000.heap                          24.6 MB           # the page's JS heap
page.10000.rss.renderer                  248 MB            # every renderer of the browser (one page open)
page.10000.rss.browser                   603 MB            # every Chromium process
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
page.50000.note.ready                    3376 ms           # a note in inbox/ opened cold to data-dag-ready
page.50000.sidebar.drawn                 6746 ms           # from navigation to 5000 rows of inbox/ in the sidebar
page.50000.sidebar.rows                  5042 count
page.50000.dom.nodes                     89894 count
page.50000.heap                          77.3 MB           # the page's JS heap
page.50000.rss.renderer                  492 MB            # every renderer of the browser (one page open)
page.50000.rss.browser                   842 MB            # every Chromium process
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
