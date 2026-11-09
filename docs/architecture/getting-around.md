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
