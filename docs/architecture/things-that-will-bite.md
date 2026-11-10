# Things that will bite

> The long list of traps found the hard way, each with the defect that found it. Read before touching the area it names.

## Things that will bite

- **`elk.bundled.js` is the wrong import.** On the main thread its "fake worker" runs the algorithm
  synchronously and blocks the canvas; inside a worker of ours it throws, because
  `elk-worker.min.js` stops exporting the fake `Worker` class once it detects it *is* the worker.
  Use `elk-api.js` + `elkjs/lib/elk-worker.min.js?worker`, which is what `src/layout/elk.ts` does.
- **ELK's port coordinates are deliberately thrown away.** Ports are declared `FIXED_ORDER` so
  crossing minimisation orders a node's targets the way its rows are ordered; the actual anchor is
  computed by `route.ts` from the row's y. ELK spaces ports evenly, and a row is where the text is
  (rule 9).
- **Ports are declared only where a row can be honoured — a horizontal exit.** A row is a horizontal
  band, so its y means something on the left and right of a card and nothing on the bottom;
  `route.ts` drops the row anchor on a vertical exit. Declaring them anyway, on the *diagram's*
  direction rather than the group's, is what made edges twist: a card inside a group running `DOWN`
  advertised an exit on a side no edge would leave from, ELK routed out of it and back around, and
  `route.ts` spliced its own anchors onto that detour. Ports also pull ELK's node placement — it
  aligns a chain on port positions, which staircases a group that should stack.
- **`colGap` is horizontal and `rowGap` is vertical**, whichever way the pass that produced them
  ran. ELK's two spacings are named for the algorithm — between layers, and within one — and which
  is horizontal depends on the direction, so a group running `DOWN` inside a diagram running `RIGHT`
  got them transposed and its cards sat 32px apart with an edge to fit between them.
- **A hoisted edge's bends belong to the groups, not the entities.** `hoist()` rewrites an edge for
  ELK's benefit; its bend points then describe a route between two group boxes. Splicing those onto
  anchors on two entities draws a tenancy line as a rectangle around the whole diagram, so
  `elk.ts` drops the bends for every edge it hoisted.
- **A dogleg is what gets past the card next door.** A row anchor is fixed on its card's side and
  the next card starts one `colGap` away, so the chord to anything not in that card runs through
  it and no bow leaving a fixed point can rise fast enough. `detour()` in `route.ts` leaves the
  row, turns in the gap, runs along a clearance row and comes in on the target's own side — on
  either axis, by solving the transposed plane — and `sideArc()` handles two cards in one column
  with a third between them. Both drop coincident points: a zero-length leg divides by itself and
  writes `NaN` into the path, and the browser then draws nothing and logs an error naming no edge.
- **`elk.separateConnectedComponents` has to be set on every group.** Root-only it was, and
  ELK's default is the opposite: inside a group, children with no edge between them were packed
  as separate components by size, and no model-order option could reach them.
- **Two facing control arms compete for one gap.** `edge.reach` has a 56px floor and an ERD stacks
  cards `rowGap` — 32px — apart, so a short hop got 112px of control arm in a 32px gap, each arm
  reaching past the other, and a straight little connector came out as a wiggle. When the two sides
  face each other (`na · nb < 0`) both arms are scaled back to meet at most in the middle. Scaled,
  not clamped: the ratio between them is the shape.
- **Two edges between one pair of cards tie on the fan, and a stable sort crosses them.** `a --> b`
  and `b --> a` point at the same centre from both ends, so the fan's angle cannot order them and
  each card kept them in written order — which, on two facing sides traversed in opposite
  directions, puts each edge's ends on opposite halves: an X in the gap with a label at the middle
  of each stroke. `fanOrder` in `route.ts` mirrors the tie between the two ends, and
  `bundleOutward` puts each label on its stroke's outer side. The scorer had excused it too — any
  two edges sharing a node were skipped — and a symmetric pair crosses exactly at a joint of both
  flattenings, which `crosses` does not count; a same-pair check flattens at an odd step count.
- **A label's `x` is where it is anchored, and it is centred only for `middle`.** Beside a vertical
  run a label starts or ends at `x`. `separateLabels`, `labelFor`'s obstacle test and the scorer
  all read `x` as the centre, which pushed two labels either side of a loop apart for a collision
  that was not there; and the graph layout's size was taken from the cards alone, so a long label
  beside the last column ran through the frame. `labelReach` is what the size adds — on all four
  sides, because `bundleOutward` hangs a loop's other label *left* of its stroke, and past the
  origin it is drawn outside the item where `content-visibility` clips it: "report the status back"
  came out ":he status back". `layoutGraph` moves every box and bend clear by a whole grid step and
  routes again, which is exact because routing is translation-invariant.
- **ELK places on fractional pixels.** Everything is snapped to `metric.grid` (8).
- **The frame's body offset is derived, never a key.** The theme carried `frame.bodyTop: 152` from
  the artboards while `nodes.css` drew the body at `pad + head + ruleGapTop + hair + ruleGapBottom`
  = 129, and the 23px between them put every board link into a framed card, and then every pick
  handle, 23px low — invisible for as long as the scratch boards were bare. `DiagramItem`
  now adds up the same parts the CSS does; `bodyTop` and `ruleY` are gone from the contract. A
  metric nothing draws from is a claim, and a claim drifts.
- **Sizing must never read the DOM.** `layout/size.ts` is arithmetic over theme metrics plus canvas
  `measureText`; the renderer is obliged to produce exactly those boxes. Measure-then-lay-out would
  mean two passes and a visible twitch.
- **Fonts change every measured width.** Layout keys include `measurer.generation`, which bumps once
  when the webfonts land, and everything re-lays out. A snapshot taken before `document.fonts.ready`
  is a different diagram — hence `data-dag-ready`.
- **`document.fonts.ready` waits only for faces something has asked for.** A card is measured on
  a canvas before it is drawn, and `measureText` does not reliably start a webfont loading, so a face
  nothing on the page had drawn yet was measured as the fallback — and `generation` never bumped,
  because `ready` had nothing to wait for. Editor pages got Fira Code by accident, from the chrome's
  mono labels; the read-only pages (`?view=1`, `?snapshot=1`) never did, and four reference
  baselines were taken with every meta line sized in the fallback. `main.tsx` now loads
  each face by name (`FACES`) before the first render, on every page; a face added to the imports
  there wants a line in that list.
- **`src/board/` and `src/dsl/` are bundled into the server and the CLI**, plain Node outside Vite
  entirely, as are `src/note/`, `src/quiz/` and `src/table/`. Keep them free of browser APIs **and
  of `@/` aliases**: that property is the whole reason the grammar is a function call in the
  server rather than a second implementation, and nothing checks it but this sentence. The *Vite
  plugin* is what first required it — `vite.config.ts` is loaded by Node before Vite's aliases
  exist — and the constraint outlived it for a better reason.
- **A wheel with `ctrlKey` set is not necessarily a ctrl key.** A trackpad pinch arrives as exactly
  that, whatever is or is not held down. One branch therefore serves both, and the wheel handler
  tests the modifier rather than trying to tell a gesture from a keypress — which is also why
  scroll-to-zoom cannot be reinstated without breaking pinch.
- **`data-zoom` on `.dag-viewport` is painted, never rendered.** `paint()` writes it in the same
  statement as the transform it describes. As a React attribute it was one frame stale by
  construction, and the dev size assertion fired on a random board every other run because a
  measurement taken during the initial fit divided a scaled rect by 1.
- **There is no server inside Vite.** The api is the local server (`server/`, Hono):
  `vite.config.ts` proxies `/__board` and `/api` to it with the token, and `npm run dev`
  (`scripts/dev.sh`) starts it on `boards/local/` before Vite. That proxy is a credential boundary
  too: it refuses a non-loopback `Host`, a foreign `Origin` and a `cross-site`/`same-site`
  `Sec-Fetch-Site` before it adds the token, and the dev server binds loopback unless
  `ANYDAG_DEV_HOST` opts into the LAN. The live channel is SSE —
  `src/board/events.ts`, one `EventSource`
  for the page, fanned out to its hooks — and not `import.meta.hot`, which is `undefined` in a build
  and made a built app go quietly stale rather than fail.
- **`content-visibility: auto` clips.** It brings paint containment, so anything an item draws
  outside its own box — the selection chip above it, the handle at its corner — is cut off. A
  selected item turns it off; it is on screen anyway.
- **…and it skips before it decides.** A brand-new item's contents are *skipped* until the browser
  first works out whether it is on screen, and a skipped subtree measures 0×0. The dev size
  assertion checks on `document.fonts.ready`, which has almost always resolved — so it ran a
  microtask after mount, and a diagram small enough to be laid out that fast (a prompt card's
  three-card answer) reported every card as 0×0, one run in twenty. It now skips while
  `checkVisibility({ contentVisibilityAuto: true })` is false and checks again on
  `contentvisibilityautostatechange`.
- **`h=` is a minimum, and the measure is what the flow trusts.** Every body draws `h=` as
  `min-height`, so the measured height already includes it; `flow.ts` takes the measure first
  and `h` only before there is one. The earlier rule — skip the measurement when `h` is set —
  meant an item with `h=` never reported a size, and `data-dag-ready` waited for it forever. A
  *node* carries the same attribute with the same meaning, in `size.ts` and for every kind.
- **`pointer-events: none` belongs on what the drag *moves*, not on what was pressed.** A tab
  being dragged is translated by its `.dag-tab-wrap`, and the rule was written against the
  `.dag-tab` inside it — so the button stopped answering `elementFromPoint` and the span around it
  went on answering for every pixel of it. The drop target was therefore always the thing in your
  hand: the indicator never painted, the drop was refused as a non-move, and nothing anywhere said
  why. The `pointerup` target is what named it — the wrap, not the tab under the pointer.
- **A drag ends on a different element, so the `click` it would suppress never arrives.** Both new
  gestures set a flag on the drop and read it in `onClick`, and clearing it *there* leaks: a
  reorder or a drop into another folder dispatches no `click` at all — a `click` needs the press
  and the release on one element — so the flag stays set and swallows the **next** real click,
  which is a tab that will not open or a board that will not. It is cleared when a press starts.
- **A control that only exists on `:hover` cannot be waited for with `expect().toBeVisible()`
  alone.** The row actions are `display: none` until hovered, and the list re-renders under the
  pointer after every write — so a check that polls the *file*, sees the rename land and clicks
  immediately finds a button that had a box a moment ago and does not now. Waiting on the DOM
  state the test is actually about — the folder's "empty" line — is what settles it, which is the
  one-round-trip-stale rule below wearing a different hat.
- **The board is one round trip stale after a write.** `useBoard` adopts the server's text the
  moment the response lands, but between a commit and that response `board` still describes the
  file as it was. An op built in that window can name an item the previous op deleted, and the
  whole patch is refused. A person cannot type that fast; a test can, so the e2e specs wait on
  the DOM, not only on the file.
- **A gesture that repeats is a gesture that must paint and write separately, and the nudge was
  the one that did not.** `nudge` called `move`, which paints *and* commits — so a held arrow key
  was one `POST /patch` per OS key repeat, about thirty a second — roughly thirty times the
  sustained write rate a single document expects, and invisible only because each write is a few
  hundred bytes. `move` is
  `paintMove` + `writeMove` now, and the nudge paints on every repeat and writes on the keyup —
  exactly what a drag does on release, and why `onKeyUp` was already where the undo run is sealed.
  Two consequences worth keeping. **The pending targets accumulate in a ref rather than being
  recomputed from `places`**: two repeats inside one frame both read the same un-rendered position,
  and the second then writes the first one's answer — ten repeats moved an item 8px instead of 80.
  And **the seal happens after the write resolves**, because `history.push` runs once `patch` does
  and a seal landing first ends the run that push is meant to join. `NUDGE_SETTLE` is the safety
  net for a run that never gets its keyup, which is a window blurred with the key held.
- **A middle click is a paste on Linux.** Chromium fires `paste` with the X11 primary selection
  on a middle press, and a middle drag is how the board is panned over an item — so a pan dropped
  whatever text was last selected anywhere onto the board as a note. `useEditor` ignores a paste
  within half a second of a middle press. The e2e suite found it: one test's copy was the next
  test's paste.
- **The chrome and the diagram share one class namespace, and the diagram wins.** `chrome.css`
  loads first, so a name it shares with `nodes.css` is overridden wherever they disagree. The
  properties strip was `.dag-strip` for about ten minutes; `nodes.css` already owned that name
  for a timeline's section bar, and the panel's new block came out `position: absolute` on top of
  its own header. Chrome names are `dag-props`, `dag-offer`, `dag-board-row` — check `src/styles/`
  before adding one, because nothing fails and the symptom is a layout that looks deranged.
  **`data-dag-*` is the same namespace and the same hazard**, and it does not even need CSS to bite:
  the strip's icon field was `data-dag-icon`, which every card on the surface already carries, so a
  selector that should have found one input found three cards as well. Chrome hooks are
  `data-dag-prop-*`. It has now bitten three times: `data-dag-rename` was the board list's button
  before it was the inline input's box, and **`data-dag-group` is on `.dag-item`** — the board-level
  group — as well as on a boundary inside a diagram, so a `closest("[data-dag-group]")` that escapes
  its diagram reports the item as something to drop a card into. Check `src/styles/` *and* `grep`
  the attribute before adding either. The page strip and the folders added `dag-pagebar`,
  `dag-folder-row`, `dag-folder__act`, `dag-board__move` and `data-dag-pagebar`, `data-dag-tab-drop`,
  `data-dag-folder`, `data-dag-folder-drop`, `data-dag-folder-over`, `data-dag-new-folder`,
  `data-dag-folder-name`, `data-dag-folder-delete`, `data-dag-move`, `data-dag-move-to` — every one
  grepped first, and `dag-strip` rejected again on the way past, `nodes.css` already owning it.
- **A hardcoded number in a gesture is a setting nobody can reach.** `onPaste` and `importFiles`
  posted a literal `w: 520` for every image, and `.dag-image img` is `width: 100%` — so a
  1002-pixel screenshot was drawn at 52% and the obvious diagnosis, compression, was wrong: nothing
  between the clipboard and the disk has ever touched a pixel. It took reading the whole path to
  find that the defect was one literal, and the fix was arithmetic (`src/edit/image.ts`) rather than
  a quality slider — which would have been a control that changed nothing.
- **`page-1` is two different answers, and only one of them is a mistake.** It is the id of the
  implicit single page *and* what an item with no `page=` fell back to — so on a board declaring
  named pages, a fence appended with no page of its own reported `EB_UNKNOWN_PAGE` naming a page
  nobody had written, while drawing in plain view. `parseBoard` now tracks which items never named
  a page: those belong to the first page, whatever it is called, and only an item that *names* a
  page the board does not have is reported. The `/asset` route was the other half — it appended an
  image fence with no page at all, so a screenshot pasted on page four landed on page one.
- **A `:hover`-only control needs the pointer move and the click retried as *one* thing.** The
  board list's row actions are `display: none` until hovered, and the list re-renders whenever any
  board file appears or disappears — which, with the suite eight workers wide over one `boards/`
  directory, is constantly. `locator.hover()` is not enough (Chromium recomputes `:hover` against a
  new node only on a real move), and that half was understood; what was missing is that the
  re-render can land *between* the move and the click, leaving a pointer that was correct when it
  was made aimed at a node that no longer exists. Retrying the click alone cannot help.
  `e2e/hover.ts` is the pair under one `toPass`.
- **A poll whose condition the *starting* file already satisfies is not a wait.** The timeline drag
  check waited for its date to be `.not.toBe("")` and the board had been written with a date, so it
  returned immediately and the assertion under it raced the write. What it meant was "the date
  changed". Worth grepping for whenever a check reads bytes it seeded itself.
- **Waiting for a *file* is not waiting for the page.** The board is one round trip stale after a
  write, and the boxes a tidy runs over are measured a render after that — so pressing `T` twice,
  with only a poll on the file between, tidies stale boxes the second time, moves things again, and
  `moved` is never 0. Wait for something the page renders.
- **`typing()` counts a focused `BUTTON` and `SELECT`, so a dialog full of controls cannot use the
  window's Escape.** The chain in `useEditor` is skipped the moment focus lands on anything a person
  could be typing into, which is right and which means the settings card had to take focus and
  handle its own Escape — stopping it, so the chain's order is still one order. The shortcut sheet
  has the same shape and has always been closed by its scrim or its button.
- **A `--dag-*` custom property is a *theme token*, and `check-theme.mjs` reads the prefix
  literally.** The panel's remembered width is `--inspector-w` for exactly that reason: no theme has
  an opinion about how wide somebody dragged their editor, and naming it `--dag-inspector-w` demanded
  a key in all three themes. Same argument as `chrome.css` itself. `--canvas-x` and `--canvas-w`
  are the second pair to be named this way, for the same reason.
- **`.dag-body` is not the canvas, and five floating things were positioned as though it were.**
  The dock, the selection bar, the problems dock, the which-key strip and the zoom cluster are
  `position: absolute` inside `.dag-body` — right, because it keeps them out of the flex tree and
  leaves `.dag-viewport`'s `flex: 1; min-width: 0` contract alone — but `.dag-body` spans the board
  list and the panels too. So `left: 50%` was the middle of the *window*: with the list open on a
  1600px screen the dock sat 116px left of the board's middle, and `right: 12px` put the zoom
  cluster **on top of the library** whenever it was open, over the caption that says what a click
  does. The selection bar was the visible one — it grew a rewrite field, never shrinks, reaches
  944px, and on a narrower window it ran off both ends and covered the board list's search
  box. `App` publishes the viewport's box as `--canvas-x`/`--canvas-w` from a ResizeObserver and
  the five rules read `--canvas-mid` and `--canvas-right`; the bar is capped at the canvas and its
  row wraps. Painted rather than rendered, the way `data-zoom` and `data-pan` are, and for the same
  reason: state here would re-render every child of `App` on every drag of the inspector's edge.
- **A hue is bound, never defaulted in a component.** `hueVars()` sets `--dag-h`/`--dag-t` only when
  an element has a hue, and CSS falls back to `--dag-h-default`. Setting the property to an empty
  string would *not* trigger the `var()` fallback, which is why "bind nothing" is the mechanism.
- **A `--dag-metric-*` that is a ratio or a count needs `UNITLESS` in two files.** `donutInner`,
  `minLabelPct`, `maxTicks` and `markerMax` reach the browser as `0.62px` and `6px` otherwise, and
  nothing fails — `applyTheme.ts` holds the list and `check-theme.mjs` mirrors it, and the mirror is
  a copy that can drift.
- **A `<svg>` is `inline` by default, and an inline box sits on a text baseline.** The chart's
  wrapper came out four pixels taller than the layout said, on every chart, with nothing in the DOM
  to explain it — the descender room under the line the `<svg>` was sitting on. `.dag-chart` is
  `display: block` for exactly that, and the size assertion in `DiagramItem` is what said so.
- **A `clipPath` id belongs to the item, not to the module.** The legend column clips its labels
  through `url(#…)`, and a fragment id is resolved page-wide: two charts on one board sharing one id
  means the second one's labels are clipped to the first one's rectangle, silently and only when
  there are two. `ChartView` builds the id out of the *item's* id rather than from `useId()`, which
  also keeps it stable across a re-render, an export and a screenshot. Same defect `replaceIDs()`
  exists to stop for icons, one layer up.
- **`outline` draws nothing on an SVG `<g>`, and neither does `z-index`.** The pick ring is
  one line of `chrome.css`, and it resolves against a chart's series to an element the
  browser paints no box for — a picked series looked exactly like an unpicked one, with the
  attribute correctly on it. The marks carry it instead: a stroke on a bar, a wedge or a marker sits
  outside its own fill and changes no geometry, which is the property the outline was chosen for in
  the first place. A line is the one mark that already wears a stroke — its hue — so a picked line
  takes the accent for as long as it is picked.
- **A baseline is only valid in the image it was made in, and a theme that names no font is the proof.**
  `neutral` is `ui-sans-serif, system-ui, …`, so the same board is a different size on a laptop, a GitHub
  runner and a contributor's machine (24 of the 46 baselines changed when they were first regenerated in
  the image: all 15 `neutral` ones, 7 of them in *size* — the layout, not the pixels — and 4 `paper`, 4
  `paper-dark` and the export item by antialiasing only). Playwright's default update mode rewrites only a
  baseline that *fails*, so a change inside the 1% tolerance quietly spends it; regenerate with
  `npm run e2e:docker -- --update-snapshots=all`, which rewrites every baseline it runs, read the diff of a
  sample, and commit the images on their own.
- **A path that looks like documentation is a fixture.** `boards/local/**/*.board.md` and `boards/local/*.md`
  are what the browser suite draws, so "markdown only → skip the browser" is wrong for them; `kindOf` in
  `scripts/e2e-plan.mjs` tests `boards/` before `.md`, and `test/e2e-plan.test.ts` holds it.
- **A required check must report when its jobs are skipped.** A workflow with `paths-ignore` never starts,
  and a reusable workflow's jobs never exist when the job calling them is skipped — either leaves a
  required check "expected" for ever. `ci.yml`'s `CI passed` and `e2e.yml`'s `e2e` always run and decide
  what was owed.
- **A check that asserts something is absent must be able to find it.** `[data-dag-error]` was
  asserted absent seventeen times while no element carried it, and `reference.spec.ts` asked for
  `.dag-error`, which a broken diagram stopped drawing the moment the problems dock landed. Both
  passed on anything. Search `src/` for a selector before trusting a `toHaveCount(0)` built on it.
- **OpenCode Go's HTTP endpoint is not ours to call.** `https://opencode.ai/zen/go/v1` answers the
  OpenAI shape and then refuses it: *"Request is missing x-opencode-session"*, and its docs say the
  plan is for coding agents that identify themselves and carry a session, with traffic monitored for
  abuse. AnyDag spoofing that header would be exactly the traffic singled out. GLM through Go
  goes through `opencode run` — the client it was built for — and Z.ai's own API is the HTTP route.
- **`opencode run` headless needs five things, and OpenCode 2 changed all of them.** 1.x took
  `--pure`, `--dir` and `--variant`; 2.2 prints its help for any of them and exits 0. What a run wants
  now: **`--standalone`**, or it goes through the person's background OpenCode service, whose config —
  MCP servers, plugins — is not the one handed to it; **`XDG_CONFIG_HOME` pointed into a throwaway
  working directory**, so the global config is not loaded either (on 1.x its MCP servers held every
  call for a minute and cost 66k input tokens of tool schemas), with the login left alone under
  `XDG_DATA_HOME`; **the agent in `OPENCODE_CONFIG_CONTENT`**, its prompt as `{file:/abs/path}`
  because an environment string has a ceiling of its own; **`permission: {"*": "deny"}`**, which 2.x
  reads and which leaves the tools out of the request — a one-word answer is about 500 input tokens,
  13,700 with the default agent's tools (1.x took `tools` by name and hung on `"*": false`); and
  **the session deleted after**, by the id its events carry, because a standalone run still writes
  one into the person's history — 1.x runs left a dozen behind. The thinking level is `model#variant`
  now. `opencodeComplete` in `plugins/generate/llm.ts` is all of it, `test/llm.test.ts` holds each,
  and `opencodeReady` refuses a 1.x with "upgrade" rather than half-working.
- **A stub is a claim about another module, and a wrong one passes every test.** The MCP tests
  stubbed the grammar once with a `{sheets: [...]}` shape `GET /dsl` had never returned, and a
  resource raised on every call while nineteen tests agreed it was fine. The rule is not "do
  not stub": it is that a stub written from what the caller *expects* tests the caller against
  itself. `test/fixtures/dsl-answers.json` is the grammar's own recorded answers, held to the live
  handler by `test/dsl-service.test.ts`, and a stub is copied from a route, never invented.
- **An `EventSource` cannot send a header, and that decided how the token travels.** The live
  channel is one `EventSource` per page, and an `<img src>` pointing at an attachment is another
  request no script dresses. In the desktop app the main process adds the header to every request
  on its scheme, so neither notices; in a browser it is the `anydag_token` cookie, which rides on
  both with no client change. A token in the query string would be a credential in every log there
  is, which is why `/?token=` is accepted once and then taken out of the address.
- **A `server.json` names a port, it does not prove who holds it.** The app home is shared with
  `anydag serve`, and a file an earlier one left behind — a closed terminal, before `SIGHUP` was
  handled, or a crash — names a port that another local user may be listening on now. The desktop
  shell sends its per-launch token only to the child it spawned this time: the port from that
  child's stdout, or a `server.json` whose `pid` and `token` both match (`desktop/launch.ts`). The
  server removes the file on `SIGINT`, `SIGTERM` and `SIGHUP`, and on its IPC channel closing.
- **`?snapshot=1` strips the chrome, never the token.** Every Playwright check and both scripts
  open a board that way, and an exemption would be a query string any page on the machine could
  load. `scripts/session.mjs`, `e2e/global-setup.ts` and the CLI's `snapshot` find the token
  (`ANYDAG_TOKEN`, else `server.json` in `ANYDAG_HOME`, `.dev-home/` or `~/.anydag`) and hand the
  browser the `anydag_token` cookie.
- **A context made through Playwright's `browser` fixture inherits everything in `use`.** Not just
  `baseURL` — `storageState` too. So `browser.newContext()` in a test that wanted a browser which
  had never been here before arrived with the suite's stored state, the very mechanism it was
  testing switched on already. `storageState: undefined` is how to ask for a clean one.
- **A preference sync without a clock is a switch that flips back on its own.** The server's copy
  is written on a debounce; toggle the library and reload inside it and the older copy is what
  gets adopted, which reads as a click that did not register rather than as a sync. The bundle
  carries `at` and the browser keeps its own, and the newer one wins — `settings/sync.ts`.
- **Every span writer moves the key it rewrites to the end of the statement.** `writeModifier` cuts
  the old span and splices the new one at `insertAt`, so `x=0 y=0 w=120 h=48` rewritten on the x
  axis comes back `y=0 h=48 x=0 w=240`. It is uniform, it is stable after the first write, and it is
  what `setModifier`, `setGeometry`, `detach()` and every card drag have always done — so
  it is not a defect to fix inside one feature, but it is why a byte-exact test of a writer asserts
  an order nobody typed, and why a resize shows up in a diff as more churn than it is.
- **A fixed layout's numbers are not the file's.** `layoutSketch` draws the drawing's top-left at
  `0,0` so the frame hugs it, and says in `LaidOut.origin` where the file put that corner. A writer
  that turns a laid-out box back into `x=`/`y=` adds the origin at the top level (a child is
  relative to its container and needs nothing) — `fileAt()` in `src/edit/build.ts`. Writing the
  layout's number back as the file's is what made an 8px drag move a card 104px in any sketch with
  a negative coordinate in it. And a writer that moves the corner — the leftmost box dragged right,
  a `+` grown out past the top, Detach dropping ELK's padding — writes the fence's `x=`/`y=` by the
  same amount in the same op (`writeShifted` in `useEditor`), or everything else in the drawing
  slides the other way under the pointer.
- **A floating control keeps out of the handles, not out of the item.** A handle is absolutely
  positioned outside its owner's box, so neither the item's rectangle nor anything computed from
  it contains one. The selection bar kept 12 screen pixels clear of the item and sat on the south
  connect dot — 30 *board* pixels out — at every zoom from about 40% to 230%, and when it
  flipped above it sat on the north one. `SelectionBar`'s `place()` widens the box it keeps out of
  by every `.dag-handle`, `.dag-connect-handle`, group box and picked-card tool it can find, measured
  one by one; `selbar.spec.ts` asks `elementFromPoint` at every handle's centre at three zooms.

- **A request's `close` is not the client leaving.** Node emits it on the `IncomingMessage` once
  the body has been read — before a single token of a model's answer — so cancelling a generation
  on it cancelled every generation. `res.on("close")` with a `writableEnded` check is the client
  going away.
- **`ViewportHandle.reset()` is a *fit*, whatever the name says.** It is `() => fit()`, while the
  `0` key is `commit(1, applied.current.off)` — two different answers, and only the second is
  100%. A zoom readout wired to `reset()` would have framed the content instead, which is a
  control lying about its own label — hence `actual()` beside it, rather than reusing a
  name that was already taken by something else. The live percentage goes out on a `dag:zoom`
  document event for the reason `data-zoom` is painted rather than rendered: holding the zoom in
  `App` state re-renders every child of `App` on every wheel step.
- **A helper that normalises a font changes every box that never asked it to.** `titleFontFor` in
  `size.ts` was written to carry the emphasis flags to every place a title decides a box, and it
  defaulted the weight to 600 — right for ten of the eleven, and wrong for a sketch input, whose
  placeholder had always been measured in the meta's regular 400. Nothing failed: `TableMeasurer`
  short-circuits on mono before it looks at the weight, so every unit test agreed, and only a
  browser would have drawn the difference — a wider box around text that had not changed, on every
  board with an input on it. The weight is a parameter now, defaulting to what each site already
  passed, and the rule is that **the flag changes the font and the helper never does**. The 45
  reference baselines coming back byte-identical is what says it holds; they were the only
  instrument that could have said it.
- **A rotated `ChevronDown` points where the rotation puts it, not where you meant.** The Advanced
  disclosure turned its chevron 90° clockwise when it *opened*, which aims a down-arrow at the
  left margin. Shut is `-90deg` and open is `0`, so it points at what opening it would reveal.
- **BlockNote's own Markdown is not the file's, and must never be let near one.** Measured over
  every `md` body in `boards/local/`, its converter changes how 107 of 149 draw and 22 change again
  on a second save: every wrapped line becomes a hard break, bold around inline code becomes literal
  asterisks, list continuation lines break out. `src/note/markdown.ts` converts through remark both
  ways, and BlockNote only ever sees blocks — including on paste, where its default handler would
  otherwise parse `text/plain` with that same converter. See *Notes*.
- **ProseMirror redraws any attribute it did not set, on any node it owns.** A block a search
  result opened onto was marked by setting `data-dag-found` on its element, and the mark never once
  showed: the editor's `MutationObserver` saw a change to its own DOM and put the node back before
  the next frame, silently. The mark is a CSS highlight now — a `Range` registered in
  `CSS.highlights` and painted by `::highlight(dag-found)` — which touches no element at all. The
  same will be true of a class, a style or a child: inside the editor, the DOM is ProseMirror's.
- **TipTap's `code` mark excludes every other mark.** So BlockNote cannot hold `**`x`**` — handed
  the pair it throws `Invalid collection of marks for node text: bold,code`, and parsing HTML it
  silently splits the bold. `src/note/schema.ts` is `Code.extend({ excludes: "" })` through
  `createStyleSpecFromTipTapMark`, which keeps the backtick input rule and `Mod-E`.
- **A lazily imported dependency is discovered by Vite at the moment it is first imported.** The
  first note opened in a fresh dev server made Vite re-bundle and reload the page — twice, once per
  layer of the editor — under whoever was looking. `optimizeDeps.include` names the BlockNote and
  Mantine entry points so they are bundled before the first page is served.
- **A span map has to be re-based on every save that lands.** The first version kept the map from
  when the note was opened, so a paragraph a person had edited *and saved* still counted as edited;
  the next outside write replaced it rather than keeping it, and the caret in it went with it — to
  the start of the next block. `saved()` returns the map for the body it wrote.
- **A marker cleared by `.finally()` has to compare against the promise it was set to.**
  `writing.current = next.finally(() => { if (writing.current === next) … })` never clears — the
  stored promise is the `finally` one — so every outside write after the first save looked like a
  save was in flight and was ignored, for ever, with nothing logged.
- **Chromium logs any 4xx as a console error.** A note's 409 is the answer the merge tests are
  about, so those two filter exactly that line; every other check still fails on it.
- **A `keepalive` fetch over 64 KB is refused before it is sent.** Every note save carried
  `keepalive: true`, so a save fired from `pagehide` would outlive the page — and so every note
  larger than that silently stopped saving, with the notice scrolled out of sight above where the
  person was typing. Found by asking how the editor performs, not by any test. `keepalive` is now
  set only for a save fired as the page goes away, and only while the body fits.
- **A save that fails for no reason of its own goes again on its own.** It used to wait for the
  next keystroke, so text typed just before an api restart stayed unsaved for as long as the
  person had stopped typing — found by clicking "Start writing" while the container was being
  rebuilt. A network error or a 5xx retries on a backoff (1 s doubling to 15 s) on the same
  `timer` a keystroke sets, so typing brings it forward and the outside-write listener holds off
  for it; a 4xx other than a 409 is an answer about the request and still waits for a change.

- **A board write the server cannot receive is a refusal, not an exception.** `useBoard`'s `write`
  called `fetch` with no `catch`, and every caller fires and forgets (`void commit(…)`, a nudge, a
  drag's release), so with the server down the rejection was unhandled and `commit` never reached
  `setOverrides(new Map())`: the item stayed drawn where it was dropped while the file said
  otherwise. Only the `fetch` is guarded, so a bug in `adopt` is not worded as a dead server; the
  write resolves `null` and `dag:upload-problem` tells the person. Unlike a note's save, a board
  write is not retried: the file is the document and the person can see what it says.
  `e2e/offline-write.spec.ts` fails `/__board/patch` with `page.route` and reads `pageerror`.

- **A peek that slides over the control that summoned it swallows the click meant for it.** The
  sidebar's hover peek first ran the full height of the window, so it arrived on top of the toolbar
  toggle under the pointer, and the click that should have docked it landed on the sidebar's own
  logo — Playwright reported "subtree intercepts pointer events" one run in four, and a mouse would
  have done the same every time. It floats below the toolbar now. Anything that appears on hover
  must not cover what is hovered.
- **Swapping a button's icon under a still pointer is a `pointerenter` in React.** The sidebar's one
  toggle first drew `PanelLeftClose` docked and `PanelLeftOpen` away, and a click that put
  the column away peeked it straight back: the new `<svg>` replaced the node under the pointer,
  Chromium fired `pointerover` on it with no related target still in the tree, and React's
  enter/leave emulation read that as the pointer arriving at the button from outside. A real mouse
  does the same. The toggle wears one glyph in both states, as Claude.ai's does, and says which way
  it goes in its label — anything with a hover handler keeps its children's nodes still under a press.
- **A drag in a list the suite shares can be aimed at a row that moves mid-air.** Eight workers make
  and delete their own folders at the top of one `boards/`, and one appearing above a test's rows
  shifts every row down while the pointer is between press and release, so the drop lands on
  whatever slid into the target's place. `folders.spec.ts`'s `drag` re-aims until the target itself
  is marked: the hover-control rule above, met by a drag.
- **A press aimed from a box read a moment ago can land on nothing.** The same hazard as the drop
  target above, met by the *source* of a drag. `folders.spec.ts`'s glide check scrolled a row to the
  middle, read its box, and pressed there; with other workers adding folders above and the page
  slow to lay them out, the row was off the page by the time the button went down (a box at
  `y: -268` was seen), no drag began, and the wait for the tree to scroll could only time out. Put
  the pointer over the row, ask `elementFromPoint` what is under it, press only when it is the row,
  and let go of a press that did not lift it before making another — a release over a folder row is
  a click, which collapses it. Read a scroll position to compare against only once the thing that
  was moving it has stopped: a number taken mid-glide is out of date when it is used.
- **A page that names no vault lands in the server's default, and the default moves.** Opening a
  vault makes it the default; `vaults.spec.ts` and `sync.spec.ts` open others as the point of their
  checks and put the suite's own back a request later — a window of milliseconds when the machine is
  quiet and more when it is not. A page that starts inside it pins the wrong vault for good
  (`settleVault`), so the file its test wrote is in another one: every document request answers 404,
  the page says *Nothing open*, and Chromium prints each 404 on the console, which the suite counts as
  a failure (two `Failed to load resource` lines, from a `tables.spec.ts` run, are what it looks like).
  A spec that loads a page and cannot afford that uses `vaulted(page, url)` from `e2e/vault.ts`, which
  names the suite's vault in the address as a settled tab does; `tables.spec.ts`, `folders.spec.ts`,
  `export.spec.ts` and `tidy.spec.ts` do, and the rest of the suite is exposed to it still.
  **Such a page never reports `data-dag-ready`**: the board it asked for is in another vault, the
  fetch answers 404, `board` stays `null` and no item reports a size — so a check that waits on ready
  times out at its own line, with no 404 in its own output (which is how `tidy.spec.ts` failed once,
  #40). The trace is what says which vault the page pinned.
- **Parking the canvas by writing its transform is not moving the view.** `export.spec.ts` set
  `.dag-layer`'s style and `data-zoom` by hand to get the item at 1:1. That paints the glass and not
  the `Viewport`'s record of it: `touched` stays false, so a later `fit()` — any change of the
  content's bounds or of the canvas's box, neither of which `data-dag-ready` rules out, since it stays
  `1` while a board re-lays out — puts the fit view back. On `reference/architecture` that is
  `0.606011`, and 2429 × 0.606 is the 1472 a failed run measured. Take the view over with the zoom
  bar's `[data-dag-zoom-actual]` or the `0` key, which both call `actual()` (paint, `data-zoom` in
  the same statement, `touched = true`). The `0` key used to commit alone and leave `touched` false,
  so the next sidebar toggle refitted over it and the two controls disagreed about whose view it
  was (`#41` made them one handler).
- **A script that hands its browser the token has not handed it to its own `fetch`.** `snapshot.mjs`
  put the session into Playwright's context and then asked `/__board/diagnostics` with a bare
  `fetch` — a 401, whose body has no `board` and no `items`, so it printed no diagnostic and exited 0
  on a board full of errors, the exit code the skill's loop branches on. Nothing failed, because a
  missing list reads as an empty one. `authed()` in `scripts/session.mjs` is the `fetch` with it.
- **A pasted image's id is the digest of its bytes, so the same picture twice was one id twice.**
  `/__board/asset` wrote `#image-<sha8>` without asking whether it was taken, and the second paste of
  one screenshot put `EB_DUPLICATE_ID` — an error — on the board. `free_item_id` numbers it; the file
  is one file either way, and the item is a second item.
- **Text measured to fill its box exactly is clipped at any zoom but 100%.** The canvas measures
  the advance the page lays out, and the two agree; where antialiasing paints the last glyph at a
  scaled transform they do not, and `overflow: hidden` takes it — a figure's caption came out
  "Orders on the apr" at 74% and "tick figure" at the other end. A box sized *to* its text wants
  slack inside the clip: `layout/figure.ts` wraps at `textPad` in from each side and the CSS draws
  that inset as padding, which `overflow: hidden` keeps.
- **Stdin is read when it is named, never because it is not a terminal.** The usual shortcut hangs
  for ever under a parent that starts a command with a pipe it never closes — `execFile` is one, and
  an agent's shell tool can be another. Every command that takes text takes `--file`, and `--file -`
  is stdin.
- **A rename and a write are two versions, and the feed reports whichever one it finds.** Setting a
  title and letting the name follow was first a rename then a write, then a write then a rename, and
  both orders left a moment when one name or the other held a version nobody wrote: the watcher
  reads the file when it gets round to the event, the page holding it open fetched it, and the file
  had gone — a 404 on the console, which fails the suite. `Store.rename` takes an `edit` now, and
  the renamed file *arrives* holding the edited text. Anything that both moves and changes
  a file wants the same shape.
- **A title in the text makes every write a change to the list.** A note being typed in is four
  writes a second, in every tab, and the page used to refetch `/__board/list` for each — requests
  that queue behind a note's own fetches in the browser's six connections, which is how those
  fetches come to reach the server late. A change event carries the file's `title` now and
  the list redraws that row in place; it asks for the whole list only for a name it has not got, a
  file that went, or a server too old to say, and never has two requests out. The files store's
  listing joins paths off its own walk rather than asking `_file`, which resolves the root once per
  name: nine milliseconds of fifty-five boards, on the busiest route there is.
- **A note opens with three fetches of itself in dev, and under load one can land after a rename.**
  StrictMode runs the mount effect twice and the change handler fetches while the first answer is
  out, so a note renamed a moment after it was made can answer one of those with a 404. It is not
  the rename machinery's: six copies of *New note makes one* at once, on a four-core machine
  running six workers, fail it about one run in twenty-five on the base commit and on this one
  alike. Not fixed — the
  honest fix is the change handler waiting for the first answer and comparing sha1s, and it is its
  own change. **And measure a flake at no more workers than the machine has cores**: oversubscribed,
  every spec that polls a file for five seconds fails somewhere, and two runs of it differ by more
  than any change being measured.
- **A cleanup that matches by prefix must refuse an empty one.** A spec removed every file in the
  vault whose name started with its per-test stem, which `beforeEach` set — and a browser that fails
  to launch fails the `page` fixture, so `beforeEach` never runs, the stem is `""`, and every name
  starts with that. One run against a missing Chromium emptied `boards/local/`, this repository's own
  boards with it, and git put them back. A cleanup takes the stem and clears it, does nothing without
  one, and matches only up to the stem's end. `afterEach` runs whether or not `beforeEach` did.
- **A print stylesheet that takes the app off the paper has to be scoped to the moment it means it.**
  `body > :not(.dag-print) { display: none }` on its own is a blank sheet for ctrl+P anywhere in the
  app, so every print rule reads `html[data-dag-printing]`, which `NotePrint` sets for as long as it
  is mounted. The same run found the other half: under a dark theme the root carries `color-scheme:
  dark` — inline, from `applyTheme` — and the canvas behind the sheet printed black whatever the
  sheet's own theme was. The print rule sets it back to `light`, with an `!important` only because
  the other is inline.
- **A table with rounded corners loses the bottom of its last row on paper.** `.dag-md table` rounds
  its corners with `overflow: hidden`, and Chromium's paginated layout clips the table's box short
  of its content — on screen it is exact, and `break-inside` makes no difference. In print a note's
  tables are square and unclipped. Found by reading the first PDF; no screenshot would have shown it.
- **A choice between two kinds is a third kind taken for a board.** `kind === "note" ? … : board`
  was written about forty times across the page, the api and the CLI while there were two kinds,
  and a quiz sent through any of them was a board — opened as one, listed as one, made as one by
  `anydag quiz new` (whose `kindQuery` sent no kind for anything but a note), and left out of the
  files store's `texts()`, so **Unused images** would have deleted a picture only a quiz named.
  `FileKind` is three now, and a site that picks between kinds is a `switch` ending in
  `assertNever` or a `Record<FileKind, …>`, so a fourth is a type error wherever it is not handled;
  the files store walks `KINDS` rather than naming kinds. Grep for `=== "note"` before trusting that
  a kind is handled.
- **A key listener put back after every render is a gap, and so is a reset that runs on mount.** The
  quiz runner's `1`–`9` and Enter were a `useEffect` keyed on its state: taken off and put back after
  each render, *after the paint*, so a key pressed as a question appeared — or between a pick and the
  redraw — landed while nothing listened. And its "new list, new round" effect also ran on mount,
  after the first paint, wiping a pick made in that moment. Both passed alone and failed one run in
  four beside another spec. One listener for the component's life, registered in a
  `useLayoutEffect` and reading a ref, and a reset that skips the list it started with.
- **An embed is a card until the index says what its id is, and a snapshot page has not asked yet.**
  On the editor's page the index is up long before anybody presses Export; under `?snapshot=1`,
  which is how `anydag note export` opens a note, it was not — so the first PDF from a terminal had
  a board's name where its drawing should have been, and nothing waited, because a card has nothing
  to wait on. `NotePrint` asks `readIndex()` before it looks for embeds.
- **A CSS animation that holds still is still running, and one of `box-shadow` restyles the page
  every frame.** One ten-second glow animation whose keyframes held the resting value for 84% of
  it made an idle page with the sidebar docked do 600 style recalculations every ten seconds, for
  as long as the tab was open — the browser cannot tell a keyframe that holds from one that moves.
  A `transform` or an `opacity` runs on the compositor and costs the main thread nothing; anything
  else does not. An animation that mostly holds still should run only while a state on the element
  asks for it. The same keyframes had a second surprise: a property named in only some of them —
  `border-color`, at the two flares — is interpolated from its own value across every keyframe in
  between, so the "still" border had been creeping toward the flares' colour for eight seconds of
  every ten.

- **Spreading a `react-markdown` `Components` costs the type checker seconds.** `{ ...components,
  img }` makes `tsc` build an object type of a hundred and seventy optional keys, each a union of up
  to a hundred and seventy element names, and compare it with `Components` key by key: that one
  expression in `NoteRead.tsx` was 7.4 of the 13.8 s `tsc` spent checking the whole project, and a
  JSX element over `Components["img"]` is checked against every tag the same way. `withComponents`
  (`Object.assign`, the same object) and the `MarkdownImg` cast are the fix, and
  `tsc --generateTrace` is how to find the next one: sort `checkSourceFile` by duration.

- **A `react-markdown` `Components` made during render is a new component type every render.**
  `refComponents()` built a fresh `p` and `img` on each call and `NoteMarkdown` wrapped the `img` in
  a fresh closure, so any re-render of a note drawn read-only unmounted every embed in it and mounted
  it again — an embedded board back to loading, `data-dag-embed-ready` gone. The PDF's sheet waits
  for every embed to say it is drawn and then prints, and a re-render in between printed the board as
  an empty frame, one run in eight of `export-menu.spec.ts`. `refComponents` keeps one object per set
  of options and `NoteMarkdown` memoises its own; anything that hands `react-markdown` components
  wants the same.

- **The e2e suite is CPU-bound on a laptop, so a worker more buys almost nothing.** One spec file
  run alone took 1.9 s a test and 4.8 s inside the full run at four workers: the run is as long as
  the CPU it needs, not as long as its slowest worker. So the question is CPU per test, per process,
  and not long ago the busiest process of the run was not a browser but the grammar worker — 538 s
  of CPU over thirteen minutes — because `/__board/index` handed it every text in the vault after
  every write in every open tab. Measure per process (`/proc/<pid>/stat`, and not `pstree -p`, which
  lists threads and counts the process once per thread) before adding workers or blaming Chromium.

- **The unit suite shares modules between the files a worker runs** (`isolate: false` in
  `vitest.config.ts`). A test that stubs a global or pins module state puts it back in
  `afterEach`, as every one in `test/` does today and five shuffled file orders confirmed; one that
  does not will fail a stranger's test in another file, depending on the order. That is the price of
  the unit suite costing a quarter of the CPU it did.

- **A modifier class declared above its base class loses every tie to it.** `.dag-purge__scrim`
  said `position: fixed; z-index: 60` and was worn beside `.dag-settings__scrim`, which is declared
  two thousand lines further down with one class and its own `position` and `z-index` — so the card
  wearing both was `absolute` at 20 from the day it was written, with the rule above it saying
  otherwise, and nothing noticed until the Settings modal (50) asked one from inside itself and
  Playwright could not click it. A rule meant to override a shared class says so with both classes.

- **Vite's `json: { stringify: true }` is slower on the dev server, measured.** It turns a JSON
  import into `JSON.parse("…")`, which is the textbook advice for a 2.5 MB file — and on the dev
  server it made a board 700 ms slower to be ready and doubled the page's heap. Measure a
  build before believing it there.

- **A note save that lands must keep the frontmatter the page holds *now*.** `flush` captures
  `held` when it starts; writing it back whole when the `put` answered meant a bar pressed while a
  save was out (a task's status, its date, an event's start) rewrote `held.front`, queued its own
  save, and then had it put back by the one landing: the queued save found nothing to write, and
  the second of two quick changes was dropped with nothing on the screen to say so. A
  person clicks too slowly to see it; Playwright filling a date and then a time did it every run.
  The landing keeps `held.current.front`.

- **A day is a string, and a day is not twenty-four hours.** The calendar reads every time in the
  viewer's zone and does its arithmetic on `YYYY-MM-DD` through `setDate`, because a day with a clock
  change in it is twenty-three or twenty-five hours and `+ 86_400_000` lands an hour off on one of
  them. And `new Date("2026-10-03")` is UTC midnight while `new Date("2026-10-03T09:00")` is local —
  ECMAScript's rule — so `momentOf` takes a date apart by hand. `test/calendar.test.ts` runs in any
  `TZ`; run it in two or three before believing a change to `src/calendar/`.

- **pdf.js's modern build calls a JavaScript built-in only this year's browsers have.** It reads
  `Map.prototype.getOrInsertComputed`, and the Chromium the suite and `snapshot.mjs` drive does not
  have it: the worker threw `getOrInsertComputed is not a function` and the PDF drew nothing, while
  a current desktop browser drew it fine. `PdfViewer` imports `pdfjs-dist/legacy/build/pdf.mjs`,
  which carries its polyfills, and `optimizeDeps` names that entry. The lesson is the snapshot
  rule's: a browser the gate does not run is not the one the page has to work in.

- **A board fence's unquoted attribute ends at the `}` that closes the braces.** `src=plan.assets/x.png}`
  is how a regex over the text reads the last attribute of an image fence if `}` is allowed in a
  path, and the zip export went looking for a file called `x.png}`. `namedAssets` in
  `src/export/bundle.ts` excludes both braces from a path; anything else that lifts a value off a
  fence line by pattern rather than through `parseAttrs` wants the same.

- **An id a file claims twice is a key React sees twice, and a write that lands on the wrong
  thing.** A table is a file an agent writes by hand, so two rows can say `{#rglob}` — which is
  `ET_DUPLICATE_ID`, reported, and also two `<tr>` with one React
  key (a console warning, so a failed suite) and a cell typed into the *second* row that a writer
  addressing `rglob` put into the *first*. `keysOf` in `src/view/TableRead.tsx` keys a row, a column
  or a tab by its id only the first time the id is seen and by its place after that; and the page
  refuses a write to an id that names two things (`only` in `TablePage.tsx`), saying so, rather than
  guessing. Anything that draws a list out of a file somebody else writes wants both halves.

- **A `|` inside a cell's `{…}` ends the cell.** A select's options are written on its header cell,
  and the grid adds whatever is typed into a select to them — so `In|Out` put a bare pipe in the
  header, the header gained a cell the delimiter row did not have, and the tab parsed as no table at
  all: 0 columns, 0 rows, and the next structural write laid a fresh grid over the broken lines. The
  cell's words had always been escaped; its attributes were not. `braces()` in `src/table/write.ts`
  escapes a pipe in a cell's `{…}` and `trailingAttrs` reads `\|` back, and a heading, which is not a
  row, is written as it was.

- **A key a widget takes has to stop there, or the window hears it too.** The pages without a canvas
  listen for `space O` on the window, and the table's grid is a focused `div` that `typing()` does not
  count — so a space that ticked a checkbox armed the chord, and the `o` typed into the next cell
  opened the search. The grid stops every key it handles (React's `stopPropagation` stops the native
  event at the root, which is before `window`).
- **The server is a bundle, and a bundle is as old as its last build.** `npm run dev` runs
  `server/dist/anydag-server.mjs`, which `node server/build.mjs` makes from `server/`, `src/board/`,
  `src/dsl/`, `src/note/`, `src/quiz/` and `src/table/` — so a change to any of those is not served
  until the bundle is rebuilt and the server restarted. `scripts/dev.sh` builds only when nothing
  answers on its port: a server left running from an earlier `npm run dev` goes on answering with
  last hour's grammar, and the e2e suite then fails on behaviour the source no longer has. Kill it
  by port. The CLI's launcher checks its own bundle's inputs on every run (`cli/dist/meta.json`);
  the server's does not.
- **The token is a header from a shell and a cookie for a browser, and never a value in page
  script.** Every request carries the per-launch token (`x-anydag-token`, or the `anydag_token`
  cookie), and the `Host` must be `127.0.0.1`, `localhost` or `[::1]` — anything else is a `421`,
  because a page on `evil.example` resolved to `127.0.0.1` still says its own name. Both checks are
  needed: a "simple" `POST` from any website the person has open needs no preflight, so without the
  token any site could write into a vault. The desktop shell adds the header in the main process;
  `anydag serve` prints `/?token=…` once and swaps it for an `httpOnly`, `SameSite=Strict` cookie and
  a redirect; Vite's proxy adds the header in development, after refusing anything that is not this
  page. `scripts/dev.sh` mints that token per run, so there is no well-known one. A test or a script
  that `fetch`es the server directly needs `authed()` from `scripts/session.mjs`, or it reads a `401`
  as an empty list.
- **Opening a vault never writes a byte of it.** An existing `.md` with no `id:` is given one only
  when something links or embeds it by id, or when the app made it — never on its first edit: an id
  added during a `put` changes bytes the page sent, and the sha1 the page then holds is of a text
  the disk does not have, so its next save is a `409` against itself. `test/server/` holds both
  halves. A synced vault depends on it as well: a write on open is a conflict on every machine.
- **A name is any portable file name, and portable means three file systems.** `Meeting notes.md`
  and `Écoles.md` are names, so the store refuses what Windows or macOS would:
  `: * ? " < > | \`, a trailing dot or space, `CON` and its kin, and a name or a folder differing
  from one beside it only by case — the contract tests found `moveFolder` happily making `Work/`
  beside `work/` on Linux, a vault that would not open on a Mac.
- **The watcher outlives nothing it was not told about.** One `@parcel/watcher` per open vault,
  living as long as the vault: stopping one while another started on the same folder made the
  native unsubscribe reject unhandled, which took the whole server down under the e2e suite. A
  save arrives as a rename onto the file, and the feed says `tree` only for a path it had not seen
  — or every keystroke in a note was a listing refetch.

- **BlockNote builds a block's ProseMirror node when the schema is made, and calls its `render` for
  more than the editor.** `noteSchema.blockSpecs` are the processed specs, each carrying the node
  built from the `render` it was given — so a `render` swapped into one afterwards is never called,
  silently. The editor's code block wraps a *fresh* spec, `codeBlockSpec()`. And the same
  `render` serialises a block to HTML, BlockNote's own clipboard flavour among them, with
  `renderType: "dom"`: anything a wrapper adds for the editor is added there only for `"nodeView"`,
  or the label is text a paste reads back into the block. A node view that puts DOM of its own
  beside a `contentDOM` names it in `ignoreMutation`, or ProseMirror reads the block back off the DOM
  every time that DOM changes — a tick replacing a copy icon redrew the block, button and all.

- **BlockNote registers the extensions a *block* spec carries, and drops an inline spec's without a
  word.** `createReactInlineContentSpec` takes an extensions argument and documents it as "mirroring
  block specs"; 0.55's `ExtensionManager` walks `blockSpecs` alone, so the `$x$` input rule and
  ctrl+shift+E did nothing at all until they were handed to the editor's own `extensions`.
  Anything an inline spec needs from the editor goes there.

- **A Markdown paste reaches the editor as BlockNote's *lossy* HTML, which keeps a custom block's
  drawing and loses its type.** `BlockEditor`'s paste handler turns text into blocks through remark
  and inserts them with `pasteHTML(blocksToHTMLLossy(…))`; an inline spec's wrapper keeps its
  `data-inline-content-type` and props, and a block's is stripped. A pasted equation block came in as
  the text KaTeX had drawn, `x2+y2x^2 + y^2`, until the block's `parse` read its TeX back off its own
  element (`data-dag-equation-tex`). A custom block that can arrive by paste wants the same.

- **ProseMirror reads a selection the browser changed on `selectionchange`, which comes after a key
  pressed in the same moment.** A shortcut that acts on the selection — ctrl+shift+E straight after a
  shift+arrow — saw an empty one and made an empty equation; a person is never that fast, the suite
  always is. `makeInlineEquation` flushes the view's DOM observer first.

- **The SVG export read the `border` shorthand, which is empty whenever the four sides differ.** So
  a border on one side was never exported — a blockquote's bar, an equation fraction's, which
  KaTeX draws as a bottom border and nothing else: every exported equation lost its fraction lines
  and its radicals' bars, in a file that otherwise looked right. `inlineStyles` writes the sides that
  are drawn when the shorthand is empty, rather than four long values on every element of every file.

- **`querySelectorAll` on an element never finds the element.** The tree is the drop target for the
  top level (`data-dag-sidebar-drop=""`), and every clearing of the drop marks searched it for marked
  elements — its descendants — so once a drag had passed over its empty space the whole tree stayed
  outlined after the drag ended. Rare while the tree held still; usual once it scrolled under the
  pointer. `overMarks` in `Sidebar.tsx` is the one query.
- **BlockNote's `document` inside a `transact` still answers with the blocks as they were.** An open
  note whose only block changed elsewhere had `apply` remove that block and then insert before
  `editor.document[0]` — the block it had just removed — so BlockNote threw *Block with ID … not
  found*, the editor kept the old text, and leaving the page saved it over the outside write.
  `applySteps` in `src/note/markdown.ts`
  decides every anchor from the blocks before the transaction: before the first block the plan
  keeps, or one `replaceBlocks` when it keeps none. Anything else that edits several blocks in one
  transaction wants the same.
- **A read-only BlockNote takes no caret, so a key aimed at it goes to the page.** With `editable`
  false the editor is `contenteditable="false"` and cannot hold focus; a person who clicks in a locked
  note and types sends every letter to `<body>`. The lock's notice there is a window
  listener in `NoteView` that looks at a key only after every other listener has had it — a timeout
  and `defaultPrevented` — so the page's own `space O`, which takes both of its keys, is not mistaken
  for typing.

- **A quiz's snapshot had never said it was ready.** A quiz page under `?snapshot=1` drew
  the sheet with `data-dag-ready=""` on a `<div>`, while everything that waits — `snapshot.mjs`, the
  CLI's pictures, the suite — waits on `document.documentElement.dataset.dagReady === "1"`, so a
  picture of a quiz could only time out. Nothing failed because nothing had taken one; the first
  picture taken of a quiz holding embeds found it. `usePublishDrawn` in `src/view/drawn.ts` is the
  one wait now —
  fonts, the index, every embed's `data-dag-embed-ready`, equations, pictures — for the quiz sheet,
  the read-only quiz and, through `drawn`, a note's PDF.

- **In the skill's *Through MCP* section, any backticked word with an underscore is a tool name.**
  `check-skill.mjs` reads them all as the closed set, so `next_cursor` written there as a field name
  failed the commit hook as "a tool the server has not". Say a field in words in that section, or
  out of backticks.

- **Chromium lays SVG text out again at every zoom, and inside the zoomed layer it often never
  paints the result.** Text in an `<svg>` is hinted to the screen, so a change of the scale above it
  — `.dag-layer`'s transform, which every zoom and fit writes — re-lays it out, and after a fit the
  edge label kept its box and drew no ink while its line drew. A production build lost most labels
  that way after any refit, which `anydag snapshot` makes once it has sized its window; the dev
  server lost few, so the report came in as "an edge into a shape drops its label", the
  shape being the board it was seen on. `text-rendering: geometricPrecision` on every `<text>` on the
  surface (`nodes.css`) lays it out once, unhinted, which is also the width `measureText` gave the
  layout. Any new SVG text there wants the same rule, and a paint defect is chased with pixels, not
  the DOM: the label was present, visible, sized and on top the whole time.

- **A sketch's frame now moves with a bowed line, and a drag can move it.** The frame grows past
  the boxes to hold a back edge's bow and its label, so the drawing's top-left sits that
  far into the frame. A drag that changes how high the bow goes changes that margin, and the
  drawing moves by the difference — `fixedDrop`'s `shift` is worked out from the boxes, and cannot
  know where the next routing puts the line. It is what `layoutGraph` already does when a label
  hangs past the top, and the alternative is a line cut off at the frame. **What it can know, it
  must:** the frame's corner is the line's while the boxes sit in from it, so a writer that moves
  the boxes' corner moves the fence by `frameShift` (only as far as a box goes past the line), a
  resize scales `boxesOf` (the boxes' own extent, never from `0,0`), and a group resize reads the
  padding off `data-dag-layout`'s `size`. All three took the boxes for the frame, and a drag in
  such a sketch slid everything it did not touch by the bow's margin.

- **Lezer's TypeScript grammar refuses TypeScript.** `x is T`, and a few other forms, come back as
  error nodes on valid code — 16% of this repository's `.ts` files — so TypeScript is coloured and
  never checked. The Python grammar misses a bare `yield` and a float written `20.`, and
  `prepare` in `src/render/syntax-engine.ts` rewrites both at the same length before parsing; it also
  misses parenthesised `with (…)`, t-strings and a class pattern in a `case`, which are left. Measure a
  grammar against real code before checking a language with it: `test/syntax.test.ts` holds every
  tracked fenced block in a checked language to reading clean.
- **A language one unit test loads, every later test file in that worker sees** (`isolate: false`).
  `test/code-block.test.ts` pinned a Python block's exact HTML and failed whenever `syntax.test.ts` had
  run first in its worker, because Python had landed and the block came out coloured. Pin exact HTML
  in a language nothing colours.

- **A bundle path under the dev proxy's prefix is served to the backend.** The protocol lived under
  `sync/protocol/` and the page imported it for free; the #99 rename moved it to `api/` — and Vite's
  dev server derives every module's URL from its path, so `src/telemetry`'s import of
  `api/protocol/logs.ts` became the *request* `/api/protocol/logs.ts`, which the dev proxy hands to
  the real server, which has no such route: a 404 in the console and a page that never reports
  ready, 49 of 50 specs failing on a run the unit suite called green. The proxy is a regex key now —
  `"^/api(?!/protocol/)"` — and the rule it leaves behind: **a directory the page bundles from may
  not share a URL prefix Vite proxies**, or name it and be pinned. `test/e2e-plan.mjs` and the smoke
  tier in Docker are the instruments that see it; a host `npm run dev` does not (`vite.config.ts`
  exempts the IDE's own file: your dev server already had the module).
- **A sync test that reads the machine's clock passes on an idle machine and fails on a busy one.**
  The convergence harness dated every file by its disk birth, a second-resolution instant that picks
  the winner of a duplicate id, so a seed whose births all fell in one second held and the same seed
  spread over two failed — seed 2, two runs in three on a loaded machine, none on an idle one, and
  the defect behind it (a renamed copy's index row dated by the rename, not its id's created) was the
  engine's. #14 was the same mistake in the collector (the database's `now()`). Give the test
  the clock. **And the other half: a status is a moment.** The sync loop's watcher reports a pull's
  own writes late, and each batch used to run once more and find nothing to push, so `GET /api/sync`
  right after a link answered `syncing` in six runs of fifteen on two starved cores. Those echoes
  wake nothing now (#36, `server/sync/echo.ts`), but a test's own write is still heard late. Wait for
  the loop to be quiet (`settled()` in `test/server/sync-loop.test.ts`) before asserting a state,
  prove a push where it lands, on the server, and before asserting that nothing ran, wait for the
  watcher to catch up (`heardAll()`) and then past the debounce. Reproduce both with `taskset -c 2,3` plus five busy loops per core,
  which starves a run far harder than the same loops spread over every core.
