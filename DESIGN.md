# DESIGN.md

The design system of AnyDag's **app chrome**: the sidebar, the top bar, the dock, menus, dialogs,
notices and Settings. It is written from the code as it ships, not from intentions. Where the code
does not yet follow a rule, this file says so rather than pretending.

**Out of scope: the diagram surface.** How a diagram is sized, laid out, coloured and drawn is in
[`docs/architecture/design-and-layout.md`](docs/architecture/design-and-layout.md). The two share
the theme files and nothing else on purpose: the diagram reads `type` and `metric`, the chrome reads
`ui`, and both read `color`.

`npm run check:design` (`scripts/check-design.mjs`, part of `npm run checks`) holds this file to the
code. Every `--dag-*` variable, theme token (`ui.layer.toast`), class (`dag-toast`), data attribute
and repository path named here in backticks has to exist, or the check fails.

## Where the values live

- **`themes/<name>/theme.json`** holds every value. `applyTheme()` (`src/theme/applyTheme.ts`) writes
  each leaf onto `<html>` as `--dag-<path>`: `color.ink` becomes `--dag-color-ink`, and `ui.text.md`
  becomes `--dag-ui-text-md`. The contract, with a comment on every key, is
  `src/theme/contract.ts`.
- **There are three themes**: Paper (`paper`, labelled *Light* in Settings), Paper Dark
  (`paper-dark`, *Dark*) and Neutral (`neutral`). They differ in `color` and `fonts`. The `ui` block
  is identical in all three.
- **The chrome's CSS is `src/styles/chrome.css`**, the one file exempt from the no-literal rule. It
  may type a length. It may not type a colour: every colour is `var(--dag-color-…)`.
- **The `ui` family is new (#205) and the chrome is moving onto it one screen at a time.**
  `scripts/check-literals.mjs` counts the rules in `chrome.css` that still type their own
  `font-size`, `border-radius`, `box-shadow`, `z-index` or `transition`, checks the count against
  `scripts/chrome-literals.json`, and fails if any count goes up. When this file was written (#218)
  the counts were 431, 223, 52, 22 and 20; the JSON has the current ones. **A new rule reads a
  token.** An old rule that is touched should move onto one, and the commit that moves it lowers
  the count.

## Colour roles

Every colour is a role, never a hue. Pick the role for the job, then check the pair below if the
text sits somewhere new.

| Job | Token | Notes |
|---|---|---|
| The page behind everything | `--dag-color-paper` | The board's ground, and the chrome's ground too. |
| A raised surface: a card, a menu, a dialog, a toast, an input | `--dag-color-card` | White in the light themes. |
| A recessed strip: the sidebar, a settings nav, a hover fill | `--dag-color-paper100` | The surface container: the sidebar's rows sit on it. |
| A pressed or selected fill one step deeper; hover on `paper100` | `--dag-color-paper200` | `dag-icon--on` and a sidebar row's hover. |
| Text you must read | `--dag-color-ink` | Titles, values, a selected row. |
| Secondary text, and every icon at rest | `--dag-color-slate` | Hints, descriptions, a button's glyph, quiet buttons. |
| Never text: a disabled control, a separator, a decorative glyph | `--dag-color-muted` | **Below 4.5:1 everywhere**, see below. `check:literals` refuses it as text in `chrome.css`; what keeps it is listed with its reason in `scripts/chrome-muted-allowlist.json` (#202). |
| Borders of controls and surfaces | `--dag-color-outline` | A secondary button, a field, a card. |
| Dividers inside a surface | `--dag-color-outlineSoft` | Between rows and sections. |
| A border on hover | `--dag-color-mutedBorder` | A field or secondary button under the pointer. |
| The one accent: primary action, focus, current item, a link | `--dag-color-accent` | Text, a fill, a focus ring, a selected border. |
| The accent's tint: the current row, a drop target | `--dag-color-accentSoft` | **Never put `accent` text on it.** Put `ink` on it. |
| Danger: a destructive action, a failure | `--dag-color-dangerText` (words), `--dag-color-danger` (fill), `--dag-color-dangerSoft` (ground), `--dag-color-dangerBorder` | `dag-button--danger`, a toast with `tone="danger"`. |
| Warning | `--dag-color-warningText`, `--dag-color-warning`, `--dag-color-warningSoft` | |
| Success | `--dag-color-successText`, `--dag-color-success`, `--dag-color-successSoft`, `--dag-color-successBorder` | |
| Elevation, and the dialog scrim | `--dag-color-shadow` | Translucent: 18% in Paper and Neutral, 50% black in Paper Dark. |

Rules that follow from these roles:

- **Words in a role colour use its `…Text` token**, not the bare one: `dangerText`, not `danger`.
  The bare token is for fills, borders and glyphs.
- **`accent` on `accentSoft` is forbidden.** It measured 4.0:1 in Paper before #204, and is still the
  weakest accent pair (4.6:1). The current sidebar row is
  `ink` on `accentSoft` for this reason (`.dag-sidebar__row--on`).
- **`muted` is never used for text in the chrome** (#202). Counts, timestamps, hints and
  placeholders are `slate`; Settings paints its placeholders and units in `slate` too (`[data-dag-settings] .dag-textfield`), and
  `e2e/settings-contrast.spec.ts` measures every text node in every Settings tab in every theme
  against 4.5:1.
- **A fill in the accent or danger colour carries `card` text.** `dag-button--primary` moved from
  `paper` to `card` with #204, like `dag-purge__go` and the other filled controls.

### Contrast, measured

WCAG 2 contrast ratios, computed from the `theme.json` values. A translucent colour is composited
over the background first. 4.5:1 is the floor for text under 18.66px bold or 24px; 3:1 is the floor
for large text and for the parts of a control that identify it. **Bold** marks a pair under 4.5:1.

| Text on background | Paper | Paper Dark | Neutral |
|---|---|---|---|
| `ink` on `paper` | 14.7 | 12.9 | 18.6 |
| `ink` on `card` | 15.6 | 11.2 | 18.6 |
| `ink` on `paper100` | 13.7 | 13.8 | 17.0 |
| `ink` on `paper200` | 12.5 | 14.5 | 15.6 |
| `ink` on `accentSoft` | 13.4 | 11.5 | 15.6 |
| `slate` on `paper` | 5.6 | 7.1 | 6.3 |
| `slate` on `card` | 6.0 | 6.1 | 6.3 |
| `slate` on `paper100` | 5.3 | 7.6 | 5.8 |
| `slate` on `paper200` | 4.8 | 8.0 | 5.3 |
| `slate` on `accentSoft` | 5.1 | 6.3 | 5.3 |
| `muted` on `paper` | **2.5** | **3.5** | **2.6** |
| `muted` on `card` | **2.6** | **3.0** | **2.6** |
| `muted` on `paper100` | **2.3** | **3.7** | **2.4** |
| `muted` on `paper200` | **2.1** | **3.9** | **2.2** |
| `accent` on `card` | 5.3 | 5.1 | 5.4 |
| `accent` on `paper` | 5.0 | 5.9 | 5.4 |
| `accent` on `paper100` | 4.7 | 6.3 | 5.0 |
| `accent` on `paper200` | **4.3** | 6.6 | 4.5 |
| `accent` on `accentSoft` (forbidden) | 4.6 | 5.3 | 4.5 |
| `card` on `accent` (primary button) | 5.3 | 5.1 | 5.4 |
| `card` on `danger` | 4.6 | 5.0 | 5.1 |
| `dangerText` on `card` | 6.1 | 7.3 | 7.8 |
| `dangerText` on `paper` | 5.7 | 8.4 | 7.8 |
| `dangerText` on `dangerSoft` | 5.1 | 7.9 | 6.7 |
| `warningText` on `card` | 5.1 | 9.6 | 6.2 |
| `warningText` on `warningSoft` | 4.5 | 9.6 | 5.5 |
| `successText` on `card` | 6.5 | 9.1 | 6.9 |
| `successText` on `successSoft` | 5.7 | 9.1 | 6.1 |

| Non-text on `card` | Paper | Paper Dark | Neutral |
|---|---|---|---|
| `accent` (focus ring, selected border) | 5.3 | 5.1 | 5.4 |
| `danger` (a destructive glyph) | 4.6 | 5.0 | 5.1 |
| `dangerBorder` | 1.8 | 1.8 | 1.8 |
| `outline` (a control's border) | 1.4 | 1.4 | 1.4 |
| `mutedBorder` | 1.4 | 1.3 | 1.3 |
| `accentSoft` (the current row's tint) | 1.2 | 1.0 | 1.2 |
| `paper100` (a recessed strip) | 1.1 | 1.2 | 1.1 |

What the numbers say:

- `ink` and `slate` pass everywhere. `slate` is the lowest colour to use for text a person must read.
- `muted` fails everywhere, which is why the chrome never uses it for text.
- In Paper, `accent` text passes on `card`, `paper` and `paper100` since #204. On `paper200` it is
  just under the floor (4.3).
- The `outline` border of a field or a secondary button is 1.4:1. That is acceptable only because
  the label and the fill identify the control. A control whose only edge is its border would need
  something more.
- `accentSoft` is invisible on `card` on its own, which is why it is a tint behind `ink` and never a
  focus ring (see *Focus*).

## Type

**Fonts.** `--dag-font-sans` is Inter in Paper and Paper Dark, and the system UI face in Neutral.
`--dag-font-mono` is Fira Code in Paper and Paper Dark, and the system monospace in Neutral.
`main.tsx` loads every face by name before the first layout. **Mono is for a string a person would
type**: an id, a path, a key, a chord in `kbd`, a code. **Sans is for words someone wrote**: a file's
title is sans even though it is also a file name.

**The scale.** These are `ui.text.*` with their `ui.leading.*`, in px:

| Step | Size | Line | For |
|---|---|---|---|
| `xs` | 11 | 16 | Captions, a badge, a count |
| `sm` | 12 | 16 | Hints, a toast's action, a `sm` button, a menu's secondary line |
| `md` | 13 | 20 | **The default**: a row, a menu item, a button, a toast's line |
| `lg` | 14 | 22 | A row on a sheet, a lead paragraph |
| `xl` | 16 | 24 | A pane's heading |
| `title` | 20 | 28 | A dialog's title |
| `display` | 26 | 32 | A note's title |

**Two weights**: `ui.weight.regular` (400) and `ui.weight.strong` (600). At #218 the chrome also
typed 500 in 33 rules (the button's label among them) and 700 in 7. Those are existing values to
move onto the two tokens, not further steps to copy.

**What ships.** The scale is newer than most of the CSS: at #218, 431 rules still typed a
`font-size`, mostly 12px (155), 13px (96) and 11px (41). In-between sizes (12.5px, 11.5px, 13.5px)
are legacy. A new rule reads `--dag-ui-text-*`. **Under 720px** rows, menu items and filter fields
go up to 15px, read at arm's length on a phone.

**No capitals**: nothing is set in all-caps except a badge. This is not fully true today. These
headings still use `text-transform: uppercase`: the model picker's group heads, the prompt card's
head, Settings' prompt section, the calendar's day names, and the Assistant's day, tool and change
labels.

## Space, corners and elevation

- **Space**: `ui.space.*` is 4, 8, 12, 16 and 24 px (`--dag-ui-space-1` to `--dag-ui-space-5`), on
  the grid the diagram snaps to (`metric.grid`).
- **Corners**: `--dag-ui-radius-control` (9) for a button or field, `--dag-ui-radius-surface` (12)
  for a card, a menu or a toast, `--dag-ui-radius-dialog` (16) for a dialog, and
  `--dag-ui-radius-pill` (999) for a pill. Most older rules still borrow the diagram's
  `--dag-metric-radius-chip`. That ties a button's corner to a diagram chip's, and #205 exists to
  undo it.
- **Elevation**: `--dag-ui-elevation-raised` for a bar on the page, `--dag-ui-elevation-overlay` for
  a menu, popover or toast, and `--dag-ui-elevation-modal` for a dialog. All three are drawn in
  `color.shadow`, so a dark theme gets depth instead of a halo.

## Controls

All of these are in `src/ui/controls.tsx`. They are the browser's own elements underneath (a
`<button>`, an `<input type=checkbox>`), so the keyboard, a screen reader and Playwright already know
them. **Every attribute passes through**: `data-dag-*`, `aria-*`, `title`, `disabled`. The e2e suite
finds controls by those attributes.

### Sizes

`ui.control.*`: `sm` 24, `md` 30 and `touch` 44 px.

- `md` is the default, and **under 720px `md` becomes `touch` by itself** (`dag-button--md` and
  `dag-icon--md` in the 719px media query). A screen does not have to remember to make its buttons
  finger-sized on a phone.
- `sm` is a choice and stays small: use it inside a row or a dense bar. A row's own tools are
  `IconButton size="sm"` (`.dag-sidebar__tool`).
- `touch` is for a control that is always under a finger.

### `Button`

A button with words, and an icon before them if it has one. It has four variants (`variant=`):

| Variant | Looks | Use for |
|---|---|---|
| `primary` | Solid `accent`, `paper` text | **The one action a card or dialog is asking for**: Send, Save. At most one per surface. |
| `secondary` (default) | `card` fill, `outline` border | An ordinary action: Undo, No, Keep mine, Show. |
| `quiet` | No box, `slate` text, fill on hover | A second action beside a louder one, or words in a row where a box would shout: View trash, What's sent. |
| `danger` | `dangerText` words, `dangerBorder` | An action that destroys. Confirm it in place, never with a browser `confirm()`. |

Classes: `dag-button`, `dag-button--<variant>` and `dag-button--<size>`. A bare `dag-button` is
still drawn as the secondary at `md`, for the screens that have not moved to the component yet.
`type` is `button` unless the caller says `submit`. When disabled, a button drops to half opacity,
except `primary`, which keeps its shape on an `accentSoft` tint so it reads as *not yet*.

### `IconButton`

A square button that is only a glyph. It is `quiet` (or `danger`) and **is named by its
`aria-label`**, which is also what its drawn `Tooltip` says. `tip=` replaces the tooltip's words where
the accessible name carries more, and `shortcut=` adds the chord. A `title=` replaces the drawn
tooltip with the native one: use that when a control has to say a sentence rather than a name.
**Without an `aria-label` it renders nothing in development** and says why on the console. Classes:
`dag-icon`, `dag-icon--<size>`, `dag-icon--danger`, and `dag-icon--on` for a pressed toggle.

### `Switch`, `Check`, `TextField`

- **`Switch`** (`dag-switch`): an on/off **setting** that takes effect at once. It is a checkbox with
  `role="switch"`, drawn as a track and a knob.
- **`Check`** (`dag-check`): a box ticked **in a list**, such as the calendar's kinds or a quiz's
  right answers, where a row of switches would be loud.
- **`TextField`** (`dag-textfield`): a text or number field. Its unit goes **inside** the box
  (`suffix=`, "32 px"), where it reads as part of the value. `wide` makes it 240px. `ScaledNumber`
  is a `TextField` that stores one unit and shows another.
- A choice from a list is a native `<select>` drawn as `dag-select`.

In Settings, under 720px, the switch and the tick box keep their drawn size inside a 44×44 hit area.

### What stays a plain `<button>`

These keep a plain `<button>`, and the code says why at each one:

- a row of a list or the sidebar (full width, an ellipsis, the column's hover);
- a menu item (`dag-more__item`, moved by the arrow keys, with its chord at the end);
- the vault switcher (a picker's trigger);
- the wordmark, and the folders and title in the top bar (words that go somewhere);
- the empty board's and the Home card's tiles, which have a key or a kind under each name;
- the selection bar's *Move*, *To vault* and *Trash*, which carry their word (#215);
- the dock's *Locked* chip.

The buttons inside the diagram belong to the diagram. Local families such as `dag-prompt__btn` and
`dag-run__button` fold into `Button` one screen at a time.

## Overlays and layers

Every layer above the page is a `ui.layer.*` token. A component's own stacking (1 to 9: a selected
item over its siblings, a grip over its column) stays local and literal.

| Layer | Token | Value | What is on it |
|---|---|---|---|
| Chrome | `--dag-ui-layer-chrome` | 10 | Bars and docks over the canvas |
| Popover | `--dag-ui-layer-popover` | 20 | Menus and popovers |
| Modal | `--dag-ui-layer-modal` | 30 | Every `Dialog` and its scrim; the sidebar sheet; the flashcards scrim |
| Toast | `--dag-ui-layer-toast` | 40 | The toast stack, **above a dialog** |
| Tooltip | `--dag-ui-layer-tooltip` | 50 | Tooltips, above everything |

**What ships.** Every menu and popover, the leader-key overlay, the floating sidebar and the
drag chip are on `popover`; every dialog, scrim and sheet on `modal`; the toast stack on `toast`; a
tooltip and the sidebar's drag ghost on `tooltip`; the dock, zoom cluster and selection bar on
`chrome`. `check-literals.mjs` counts `z-index` and `box-shadow` literals in `chrome.css` at zero.
Three spots are written as an offset on purpose: the model picker's popover is portalled to
`<body>` from inside Settings, so it is `modal + 1`; the welcome and file-problem layers cover the
dock and sit under the floating sidebar, so they are `chrome + 1`. A new overlay reads its layer
and never types a number.

### Toast

`Toast` in `src/ui/Toast.tsx` is the app's one notice. It shows an icon, **one line** of message,
its actions (`Button`s) and a × (`IconButton`, `data-dag-toast-dismiss`). The stack (`dag-toasts`,
`ToastHost` in `Shell`) sits at the bottom centre of the page, right of a docked sidebar and above a
board's dock. It draws at most three toasts; a fourth waits under them.

- `tone`: plain (`slate` mark), `accent` (a question), `danger` (a failure: `role="alert"`).
- The line never wraps. A name in it is a `ToastName`, which shortens in its **middle** so the
  extension stays visible, with the whole name as its title.
- With a `timeout`, a toast leaves on its own, but **never while the pointer or the focus is on
  it**. Without one it stays for as long as what it says is still true: a failure, a question.
- A toast is told, not asked: it never takes the focus. Settings' reset toast is drawn `inline`
  inside the modal, where the focus trap can reach it.
- Under 720px it spans the window, and its actions take their own row.

### Dialog

`Dialog` in `src/ui/Dialog.tsx` is the one modal frame. Settings, Feedback, Search and the logs
question's *What's sent* use it. It is a portal on `<body>` on `--dag-ui-layer-modal` with one
scrim. Tab and Shift+Tab stay inside it. Escape and a press on the scrim close it, unless the caller
is busy. Every key aimed at it stops at its edge. **Everything behind it is `inert`**, except the
toast stack. A dialog's corner is `--dag-ui-radius-dialog` and its shadow
`--dag-ui-elevation-modal`. Its head has an `IconButton` to close or go back, and its foot has
`Button`s with at most one `primary`. Feedback and the logs question are built this way. Settings
still draws its own head buttons with a bare `dag-icon` (#186).

The shortcuts sheet, the rewrite dialog and the purge confirmation predate the frame and still
have their own scrims.

### Popover and menu

A popover opens from a control, stays attached to it, and closes on a press outside or on Escape.
The dock's `⋯` takes Escape in the capture phase and stops it, so the innermost thing closes
first; a new popover does the same. Menus are
`role="menu"` and their rows are moved by the arrow keys. A popover is a `card` surface with an
`outline` border, `--dag-ui-radius-surface` corners and `--dag-ui-elevation-overlay`.

### Tooltip

`Tooltip` in `src/ui/Tooltip.tsx` is drawn rather than native, because the native `title` does not
appear reliably in the desktop app on macOS. It shows after 400ms on hover or focus
(`TOOLTIP_DELAY_MS`), hides on press, blur or Escape, and only one is shown at a time. It says the
control's name, then the chord in parentheses. It is a `card` bubble with `ink` text.

## Focus

- **Only `:focus-visible` draws a ring.** A mouse press does not show one.
- **There is one ring** (#199): a gap of `ui.focus.offset` (2px) in `card`, then
  `ui.focus.width` (2px) of `accent`, drawn as a `box-shadow` from `--focus-ring` so it never
  changes a control's size and is never clipped by an `overflow`. `--focus-ring-inset` is the same
  band inside the box, for a row, a tab or a menu item, whose neighbours would cover the outer half.
  Both are composed in `chrome.css` from the theme's `ui.focus` tokens.
- **A field's border also turns `accent`** under the ring (`dag-select`, `dag-textfield`,
  `dag-button`), so the box and the ring say the same thing.
- **A control added to the shell gets the ring without asking**: one `:where()` rule at no
  specificity gives every button, link and field in the toolbar, sidebar, page bar, dock and zoom
  bar the ring, so none arrives wearing the browser's own outline. `e2e/focus-ring.spec.ts` tabs
  through the shell and fails on a stop with no ring.
- **Shell toggles do not take the focus on a press** (`onMouseDown` is `preventDefault`), so the
  board keeps its keys. This applies to the sidebar toggle, Unlock and the dock. Tab and Enter
  still reach them.
- **A dialog traps the focus. A toast never takes it.** The frame does not put the focus back when
  a dialog closes; the caller does, where it matters.
- A control blocked by the read-only lock keeps its press and the same ring, over its dimmed face
  (`data-dag-readonly-blocked`).

## Motion

- **Durations**: `--dag-ui-motion-fast` (120ms) for a hover, a fade or a small move;
  `--dag-ui-motion-base` (160ms) for something arriving, such as a toast rising or a panel opening.
  There is one easing, `--dag-ui-motion-ease` (`cubic-bezier(0.2, 0, 0, 1)`).
- Motion says that something **arrived or answered**: a toast rises, the sidebar slides in, the
  *Read only* pill shakes once when a write is refused. Nothing loops except a spinner while work is
  in flight.
- **Reduced motion turns movement off.** One `prefers-reduced-motion` block, the last rule in
  `chrome.css`, zeroes both duration tokens and stops the three spinners (#206), so everything that
  reads the tokens stops with it; the toast's rise, the shake and the saved tick keep their own rule.
  `e2e/motion.spec.ts` reads the computed durations both ways.
- **What ships.** Every `transition` reads the tokens since #206's motion step. Five rules still
  type a time, each a period rather than a duration: the three spinners (0.9 to 1.2s), the saved
  tick's fade (1.5s) and the *Read only* pill's shake (0.32s).

## Icons

- **The chrome's glyphs are Lucide** (`lucide-react`), stroke width 2 with round caps and joins:
  - 14px inside a button, a row or a toast's action;
  - 16px in the dock, the top bar, and as a toast's or dialog's mark;
  - 12px inside a chip.
- A glyph is `aria-hidden`. Its name is on the control (`IconButton`'s `aria-label`), never on the
  `<svg>`.
- At rest a glyph is `slate`. It takes `ink` on hover, `accent` when it marks the current or
  promoted thing (`dag-icon--accent`), and `dangerText` in a danger control.
- **An icon-only control is an `IconButton`**, so it has a name and a tooltip. A control that has to
  be understood at first sight gets words (a `Button` with an icon before them).
- The diagram's technology icons (brands, Simple Icons, the concept glyphs on nodes) are a different
  system with their own rules: [`icons/README.md`](icons/README.md).

## Voice

There is no `VOICE.md` or `PRODUCT.md`. These rules are what the shipped copy does consistently.

- **Sentence case** for everything: "View trash", "Keep mine", "Send feedback", "Hide the sidebar".
- **A button says what happens** in a verb or two: Undo, Unlock, Send, Show, "Use theirs". Avoid
  "OK" and "Submit". Cancel is used only where a form is backed out of.
- **Full forms over contractions**: "did not", "could not", "cannot" (26 to 2 in the UI's strings).
- **Work in flight ends in an ellipsis character**, not three dots: "Sending…", "Putting it back…",
  "Asking the model for one word…".
- **A failure says what did not happen, then what to do**: "That did not save. Try again in a
  moment." "The model's answer held no flashcard. Nothing was added." There is no "Error:", no
  "Oops", no "Sorry", no "please" and no exclamation mark.
- **A refusal says why, in the words of the thing that refused**: "This vault refuses new boards."
  "Read only: unlock to change this."
- **Show only what a person can act on.** A problem nobody can fix from the UI is prevented or
  stays quiet, not shown (`shown()` in `src/ui/problemList.ts`, see
  [`diagnostics.md`](docs/architecture/diagnostics.md)).
- **A question says what it costs**: "Send anonymous logs to help fix crashes? Never your files or
  names."
- **A tooltip is a name, then what it does**: "Pen: draw a freehand stroke; it becomes an item",
  followed by the chord. Keys are written `Ctrl+Shift+L`, and a leader chord is written `space T`.
- **British spelling**: colour, favourites.
- **Plain words over product words**: "the trash", "read only", "a vault", "a board". The app calls
  itself AnyDag.

## Open decisions for the owner

- **The scrim is `color.shadow`**, because no theme has a `color.scrim`. It is the translucent
  elevation colour (18% ink-brown in Paper, 50% black in Paper Dark, 18% ink in Neutral), dark in
  every theme. The `ink` mixes it replaced lightened the page in Paper Dark. It is one rule
  (`.dag-dialog`), so a scrim token would be a one-line change. Whether a theme should have its own
  scrim colour is a theme decision, and this file does not make it. (`check:design` fails if
  `color.scrim` appears in a theme without this paragraph being updated.)
- **`accent` text on `paper200` is under 4.5:1 in Paper** (4.3), after #204 lifted it on `card`,
  `paper` and `paper100`. An active word drawn on the deepest strip is the case left.
- **The layers in use disagree with the layer tokens** (see *Overlays and layers*). The tooltip
  bubble at 60 is above `--dag-ui-layer-tooltip`, which is 50.
