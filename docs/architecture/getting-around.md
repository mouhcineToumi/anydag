# Getting around

> Pan, zoom and the pan modifier.

## Getting around

Navigation is draw.io's and Excalidraw's. **The wheel moves the paper; ctrl (or cmd) and the wheel
zoom about the pointer.** The earlier code had it the other way round — defensible
on a canvas holding one graph sized to fit, wrong on a plane you travel across.

| Gesture | Does |
|---|---|
| wheel, or a two-finger swipe | move |
| shift + wheel | move sideways, for a mouse whose wheel has one axis |
| ctrl/cmd + wheel, or a trackpad pinch | zoom about the pointer |
| drag the paper | select what the rectangle crosses (`space V`); move, under the hand tool (`space H`) |
| **hold space or ctrl/cmd** and drag anything | move — items included |
| middle-drag | move, over an item, without a modifier |
| arrows · `F` · `+` `-` · `0` | move · fit · zoom · 100% — arrows nudge the selection instead when there is one |

**The Graph page is the exception: its wheel zooms**, about the pointer, and a drag on the paper
moves it (*The Graph page* in [`graph.md`](graph.md)). A graph is one picture sized to fit, the
case the earlier code was right about: there is no up and down to travel through, and a person
looking at one reaches for the wheel to look closer. Its `F`, `+` `-` and `0` are the board's.

The pan modifier is load-bearing rather than a convenience: a press on an item *moves the item*, so
on a full board there is no paper left to grab and the view could only be reached with the wheel.
`Viewport` paints `data-pan` on `.dag-viewport` while one is held and `Item` reads it back off the
nearest one — the same channel as `data-zoom`, for the same reason. As React state it would
re-render every item on the board twice per gesture, and `Item` is memoised, so it would have had to
become a prop threaded through `App` to be seen at all.

`data-pan` is the *cursor's* copy of that answer, not the authority. A modifier already held when
the window takes focus delivers no keydown, so `Item` reads `ctrlKey`/`metaKey` off the press as
well, and the press is what decides. Space has no equivalent — a `PointerEvent` does not report it —
which is the whole reason both mechanisms exist rather than one.

**The view a board opens with never magnifies past 100%.** Fitting answers "show me everything on
the board", and on a small one that meant blowing it up until it filled the glass: a new board's
prompt card opened at 215%, which reads as too much zoom rather than as a fitted board. So the
automatic fit (`firstFit()` in `canvas/geometry.ts`, called from `Viewport`'s two effects) shrinks a
large board and leaves a small one at 100%, with the paper around it. The explicit Fit action — `F`,
Home, the button — still calls `fitTo()` at its full range, because a person asking to frame one
small card means to look at it closely; `0` and the zoom figure remain 100% rather than a fit.

### The dock's tooltip

Both bars float at the foot of the drawing: the dock centred on it, the zoom cluster in its
bottom-right corner. The dock is up to 327px wide and the cluster 156, so the pair needs about
690px of canvas to sit side by side — and a canvas can be narrower than that without the window
being narrow: the library takes 272px of it, the board list another 233. So the cluster is measured
against the dock's own box and lifted above it when the two would meet
(`src/ui/bottomBars.ts`, #395). The dock and the zoom cluster are icon-only, so a control's name and
chord live in a tooltip rather
than on its face. Both are `role="toolbar"` with a label, and both sit inside the board's `<main>`
beside `.dag-viewport`; the page's top bar is a `<header>` inside that main, so a board has one main
landmark and no second banner. The browser's `title` was that tooltip until macOS stopped showing it in the
desktop app — at least not within the time a person waits — so `src/ui/Tooltip.tsx` draws it instead,
and the `title` is gone from those controls. `src/ui/tooltipPlace.ts` holds the placement arithmetic:
400 ms after hover or keyboard focus, above the control (upward from the dock) unless there is no
room, and clamped inside the window on both axes.

It is a portal at the body, `position: fixed`, so no ancestor's overflow or stacking context can clip
it; it is `pointer-events: none`, so it cannot take the press it describes; and it goes on pointer
leave, blur, Escape and press. The wrapper adds no drawing of its own — it only measures the control
and carries the handlers. The control keeps its `aria-label`, because the bubble is a visual name
for a pointer or keyboard user, not the accessible name.

Since #207 every `IconButton` in the chrome wears it, saying its label (*Design rules*,
`design-and-layout.md`), so the dock and the zoom bar no longer wrap their buttons by hand.

## Back and forward

**The window keeps the browser's history, and the address is the entry.** Opening a file from a
sidebar row, the search or a reference is a `pushState` of the address the app already has
(`?board=`, `?note=`, `?quiz=`, `?table=`, `?file=`); Tasks, Calendar, Quizzes, Trash and the
Assistant are their own keys, and a board's own page is `?page=`. A theme, a table's tab, a quiz's
run, a calendar's view and a rename of the file already open are `replaceState`, because they are
the same place under another coat. So in `anydag serve` the browser's own Back, Forward, Alt+Left,
⌘[ and mouse buttons work with no help from the page, and a reload lands on the page the address
names.

| Gesture | Does |
|---|---|
| Alt+Left · Alt+Right | back · forward (Linux and Windows) |
| ⌘[ · ⌘] | back · forward (macOS, where Option+Left belongs to the text) |
| mouse button 3 · 4 | back · forward |
| the two arrows at the left of the top bar | back · forward, disabled at either end |

**The desktop app has no browser chrome, so it hears them itself** (`src/ui/history.ts`). Alt/⌘
are taken in the capture phase and stopped, so a selected item on a board does not also nudge and a
note does not read the pair as a word. A mouse button is a `mouseup` with button 3 or 4 on macOS,
and an `app-command` the shell forwards on Windows and Linux (`desktop/main.ts`,
`desktop/preload.ts`); the two reports of one gesture share a short cooldown. A browser already
answers all four, so the page listens for none of them there.

**The position is the page's, not `history.length`'s.** Every entry carries `{ at, top }` in
`history.state`; Back is disabled at `at === 0`, Forward at `at === top`, and `top` is kept on the
entry so a reload still knows what is ahead. The initial about:blank is not ours and cannot move
the arrows.

**An entry names a file, and carries its id.** The address has the name a person can read; the
state has the id the listing minted, so an entry whose file was renamed is followed to the name it
has now. A file that has gone to the trash is skipped — the pop handler checks before it adopts the
query, so the page never draws a 404 on the way. At the end of a history of dead entries, home is
what stands. Going back is a read: it writes no file. **The entry is its address, and only a place
the address names is written to its state**: a pop moves the address before the handler adopts it,
so an effect from the page being left that finishes in that window must not mark its own place on
the entry the pop made current — otherwise Back right after a rename reads the page it left (#500).
An editor with unsaved typing is left exactly as the sidebar leaves it — its unmount flushes the
save the debounce was holding.

**With document tabs, the history is still the window's** (*The document tabs*, `sidebar.md`).
Each entry also names the tab it was made in, and switching tabs is an entry of its own, so Back
walks across tabs in the order they were visited: popping to an entry brings its tab to the front
with that place, and an entry whose tab has since been closed goes to the tab in front. Back never
makes a tab, and closing the tab in front replaces its entry rather than leaving one behind.

Names claimed, grepped first: `dag-toolbar__history`, `data-dag-history-back` and
`data-dag-history-forward`; the diagram owns none of them. The state key is `dagHistory`, which is
not a `data-dag-*` attribute and belongs to the page alone.
