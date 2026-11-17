# The graph view's simulation

> The force-directed layout under the graph view (#458): the forces a person turns, groups and the rule about a group's disc, the tree, the host that paces it, the linked clusters, and what it costs.

## The graph view's simulation

Part 2 of the graph view (#262). Three modules in `src/graph/`, none of them imported by the app until
the page exists (#459); the tests and `scripts/bench-graph.mjs` are their only readers so far.

| File | What it is |
|---|---|
| `sim.ts` | the simulation: typed arrays in, positions out, one step at a time |
| `clusters.ts` | the clusters the links make, for "group by linked clusters"; the numbering every grouping uses |
| `host.ts` | what holds a simulation in a worker: paced by the clock, stopped at rest, two buffers back and forth |

Its inputs are plain typed arrays — `n` files, links as `src[k]`–`dst[k]`, optional start positions
and an optional group per file — so it needs none of the wire format's types (#457). The layer rule is
the dsl's: **no DOM, no clock, no randomness, no dependency.** `d3-force` was refused in the design
session: it allocates per tick, cannot be handed typed arrays, and is not deterministic without care.

### What it promises

- **The same input gives the same picture**, byte for byte: nothing random, no clock, and every order
  it walks in follows from the positions and the order before. `test/graph-sim.test.ts` holds it with
  groups and without. (Two engines may differ in the last bit of `Math.cos`, which the start spiral
  uses; one engine is one picture.)
- **It comes to rest**: the heat (`alpha`) cools from 1 to `ALPHA_MIN` (0.001) in 220 ticks, and a
  step at rest does nothing and returns 0. A held file keeps it warm (`alpha` aims at 0.3) until it is
  dropped.
- **Nothing is allocated per tick.** Every array a tick touches is made with the simulation, or by
  `set` when the groups change; the tree's arrays double if a tick ever needs more cells (in practice
  only in its first ticks).
- **Forces and groups change in place**: `set({ forces?, group?, heat? })` keeps every position and
  warms the graph to at least `heat`, so the files move to the new layout instead of starting again.

Start positions, when none are given, are a phyllotaxis spiral in index order — `r = 9·√(i + 0.5)`,
the angle `i` golden angles — so files that are neighbours in the vault start as neighbours.

### A tick

In this order, each a pass over typed arrays:

1. **Cool**: `alpha += (target − alpha) · (1 − 0.001^(1/220))`.
2. **Links** (`links`): each link pulls its ends towards its resting length, looking one step ahead
   (`x + v`), with strength `min(1, pull / min(degree of either end))` split between the ends by
   degree, as `d3-force` does. The cap at 1 is load-bearing: above it a link overshoots and oscillates.
3. **Groups** (`gather`), when there are any: below.
4. **The tree** (`build`), then **repulsion and the pull to the centre** (`repel`): each file pushes
   every other with `26 + 9·√degree`, falling off as 1/distance, softened inside 1 and ignored beyond
   900; everything is pulled to (0, 0) by `0.075 · centre · alpha`. Barnes–Hut θ² is 1.69 while
   `alpha > 0.06` and 0.81 after: coarse while everything still moves far, exact once it settles.
5. **Move**: velocity kept 0.6 a tick, then added to the position; a held file is put back where it is
   held.

### The forces a person turns

Each is a multiple of the built-in force, so 1 is the picture as designed (`FORCES`). `set` merges a
partial change; a value that is not a finite number keeps the one before. The page's sliders (#459)
map their range onto these; the prototype's were `4^s`, `3^s`, `4^s` and `6^s` for `s` in −1…1.

| Force | What it changes | Kept to | Measured, 1,000 files, settled again after the change |
|---|---|---|---|
| `repel` | space between files: the repulsion, and each group's disc | 0–64 | ×4 → layout 50% wider |
| `link` | the length a link rests at (34 at 1) | 0–64 | ×3 → links 55% longer, the layout 3% wider: links are weak beside the repulsion, by design |
| `pull` | how hard a link pulls (the effective strength is capped at 1) | 0–64 | — |
| `centre` | how hard everything is pulled to the middle | 0–64 | ×⅙ → layout 52% wider |
| `tight` | how hard a file leans to its group's middle: `(0.1·tight + 0.5·tight²)·alpha` | 0–1 | — |
| `gap` | how far apart groups sit | 0–1 | 0 → 1: groups 13% further apart, the layout 7% wider |

`tight` stops at 1 because a link between two groups pulls `(1 − 0.85·tight) / (1 + 2.5·gap)` as
hard as one inside a group, which goes negative above 1/0.85; such a link also rests `1 + 1.6·gap`
times longer. `tight` and `gap` do nothing without groups.

### Groups, and the rule about a group's disc

`group` is an `Int32Array`, one group per file, `-1` for none, **numbered from the biggest down**
(`numbered` in `clusters.ts` does it for any grouping). Each tick a group's middle is the mean of its
files; each file leans towards it; and two groups whose discs overlap are pushed apart as wholes —
the same nudge to every file of each, `0.3·alpha` times the overlap, shared in inverse proportion to
their sizes. They overlap when their middles are closer than `(ra + rb)·(1 + 0.9·gap) + 2.2·34·gap`.
Only the 400 biggest groups are pushed apart: the push is a loop over pairs.

**A group's disc is the room its files need packed together — `10.5·√(count · repel) + 8` — never the
spread they have now.** The prototype first measured the spread. A grouping that cuts across the links
(a tag) is spread wide by them, so its groups were pushed, so they spread wider, without end. The disc
is set in `tune`, from the count and the forces only, and nothing a tick measures feeds it.
`test/graph-sim.test.ts` groups a linked graph at random — the worst case of a tag — with `tight` and
`gap` at 1 and holds the layout to a bound across four settles: it stays at the 680 or so it has
ungrouped. (A scratch copy that sized discs by the measured spread did not run away in that test
either, with this tick's alpha-scaled push and centre pull; so the test holds the bound, and the rule
holds the reason.)

### The tree

Barnes–Hut on a quadtree held in typed arrays, rebuilt every tick, in three steps:

- **Sort along a curve.** Each file's position is quantised to 15 bits an axis and interleaved into a
  30-bit Morton key; a stable radix sort (three passes of ten bits) sorts the files by it, starting
  from last tick's order, which is nearly sorted already. The files are copied in that order into
  packed arrays (`sx`, `sy`, `sw`) with prefix sums of mass and moment.
- **Cut the run into cells.** In the sorted run every quadrant at every depth is a contiguous range,
  so a cell is a range, cut depth first with an explicit stack and a binary search for each
  quadrant's start. Its centre of mass is a difference of prefix sums, O(1) whatever it holds. A leaf
  holds up to 16 files, or every file left when all share one key (a pile in one place). Cells are
  numbered in the order of the walk, each with the number of the cell after its subtree (`cskip`), so
  the tree has no child pointers at all.
- **Walk once per leaf.** For each leaf the tree is walked as a loop over cell numbers with no stack:
  a cell far enough from the leaf's nearest edge is one body for every file of the leaf (append it to
  the far list, jump to its skip); a cell whose box is beyond the 900 cut-off from the leaf's box is
  dropped with its subtree (exact: every file in it would be dropped one by one); a leaf otherwise
  near is kept; anything else is opened (step to the next number). Then each file of the leaf takes
  the far list, and each near leaf either as one body — when it is far enough from that file — or
  file by file.

**A cell's size in the opening test is the box tight around its files**, not its quadrant, built
bottom-up in the same pass that sums the subtree sizes. In the sparse edge of a layout a quadrant is
mostly empty, and its files are as good as one body sooner; this was the largest single gain. Because
a tight box can have no size (one file, or a pile), a cell is taken as one body only beyond distance 1,
inside which the softened sum file by file applies.

**The prototype's leaf encoding is gone with its child pointers.** It stored a leaf in the child slot
as `~i - 1`, never `-(i + 2)`: the second form decodes file 0 through `-0`, which sent V8 into a
deoptimisation loop. There is no such slot now; if child pointers ever come back, that rule comes with
them.

**Two files in the same place** are parted along a direction of their own taken from the pair (its
golden-angle turn), one each way. The prototype parted every pair along one diagonal, so in a pile
every file was pushed by every other the same way: 1,000 files in one place flew 29,000 apart. With a
direction per pair the pushes mostly cancel and the pile opens to about the size it would have on the
spiral (`does not blow up` in the test).

The layout is the prototype's: on its own made-up vault at 2,000 and 5,000 files, ungrouped, grouped
by clusters and grouped by tag, the spread, the extent, the mean link length, the nearest neighbour
and how tight a folder sits all came out within 2% of it, and the drawn pictures side by side were the
same picture.

### The host

`createHost(env)` returns a function to hand every message to. `env` is the clock, a scheduler, a
`post` and the simulation's constructor, so `test/graph-host.test.ts` drives it on a fake clock with
no worker. The worker entry that wires it to `self` belongs to the page (#459).

- **It ticks by the clock, not by the frame**: 240 ticks a second, 120 while a file is held, in
  chunks of at most 8 ms with a yield between them, so messages are heard while it settles. A slow
  frame on the page does not slow the settling. When it falls more than 64 ticks behind (a big graph
  on a slow machine) it drops the debt rather than chase it. At 240 a second, 220 ticks are 0.92 s:
  that is the floor of "hot to rest".
- **It stops itself** at rest and on `pause` (the window hidden), and says `rest` if no frame was
  waiting: at rest there is no timer and no message until it is told something.
- **Two buffers go back and forth.** `frame` hands over a buffer; the host fills it at the end of its
  next chunk (at once if it is stopped) and hands it back, transferred, with the heat, the ticks and
  the tick's cost. One frame waits at a time. A frame for another graph's `gen`, or too short for this
  one, comes back with `filled: false`, so the page never loses a buffer.

| In | Does |
|---|---|
| `init` `{gen, n, src, dst, pos?, alpha?, forces?, group?}` | a new simulation, hot unless told otherwise |
| `set` `{forces?, group?, heat?}` | changes it in place and runs |
| `pin` `{i, x, y}` · `drop` | holds a file where the pointer is · lets it go |
| `pause` · `resume` | stops · goes on |
| `frame` `{gen, buf}` | asks for positions in `buf` |

| Out | Says |
|---|---|
| `frame` `{gen, buf, filled, alpha, ticks, live, held, tickMs}` | the buffer back |
| `rest` `{gen}` | it stopped with no frame waiting |

### Linked clusters

`clusters(adjacency(n, src, dst))`: label propagation in a fixed order — every file starts with its
own label and takes the one most of its neighbours hold, the least linked first and the most linked
last, ties to the label it holds, at most 12 passes, the first weighting a neighbour's vote by its
degree. No randomness, so the same links give the same clusters. A file with no links is in none.
Two cliques joined by one link are two clusters. If it clusters real vaults badly, one level of
Louvain may replace it behind the same function.

### What it costs

`node scripts/bench.mjs --only graph` (`graph.*`, see [`limits.md`](limits.md)); it needs no build.
The prototype's simulation timed under Node on the same machine, on the same generated vault:

an Intel i5-8300H laptop (4 cores, 8 threads), load average 1.3, 2026-11-17, mean over the 220 ticks
from hot to rest, median of three runs, the two simulations run in turn in one process.

| Files | Links | Prototype, one tick | This, one tick | Hot to rest through the host |
|---|---|---|---|---|
| 500 | 640 | 0.64 ms | 0.25 ms | 0.92 s |
| 2,000 | 2,632 | 2.85 ms | 1.21 ms | 0.92 s |
| 5,000 | 6,695 | 8.16 ms | 3.12 ms | 0.92 s |
| 20,000 | 27,049 | 40.9 ms | 14.5 ms | 2.7 s |
| 5,000, dense | 150,000 | 12.4 ms | 6.1 ms | 1.2 s |

Up to about 5,000 files the time to rest is the pacing's floor, 220 ticks at 240 a second; past it,
the tick. The issue's baseline (1.2, 6.4, 18.9 and 100 ms) is the prototype in headless Chromium on
another laptop, which is why the prototype's own numbers here are smaller: the comparison is the two
columns above, not that one. The simulation holds about 200 bytes of typed arrays per file
(`graph.<n>.memory`: 1 MB at 5,000 files, 4 MB at 20,000). Grouping costs about a quarter more a tick
(`graph.5000.grouped.tick`, 3.9 ms), and finding the linked clusters of 5,000 files 12 ms.

### Tried and left out

Measured on the quiet machine above, against what is in `sim.ts`:

- **Walking the tree once per file, with quadrant-sized cells** (the prototype's walk on the sorted
  tree, the first cut): 4.30 ms at 5,000 against 2.83, 19.7 ms at 20,000 against 12.6. Per file it
  visited about 69 cells; walked per leaf it is about 10.
- **Float32 for the sorted run**, to halve what the walk reads: no faster (2.94 ms at 5,000, 13.1 at
  20,000).
- **Leaves of 8, 12, 24 or 32 files**: 24 ties with 16; 8 is 15% slower.
- **x, y, vx and vy in four arrays** rather than side by side: the same at 2,000 to 20,000, 10% slower
  on the dense vault, whose 150,000 links each read two files.
