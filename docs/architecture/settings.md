# Settings

> Preferences, the Settings modal, and why a snapshot reads none of them.

## Settings

What the *app* does, as opposed to what a board says. A board file is the document Claude reads and
every gesture on the canvas is a write to it; these are the other thing — preferences about this
window that no board should carry. `src/settings/store.ts` owns the keys, `Settings.tsx` the modal,
`tabs.ts` its tabs and `panes/` one file per tab. The gear at the
sidebar's foot or `ctrl+,` opens it on the last tab this browser had open, and the vault switcher's
*Vault settings…* on Vault.

| Group | Tab | Holds |
|---|---|---|
| Account | Calendar | the time zone times are shown and written in, where a week starts, and which kinds the calendar shows — the Calendar page's own switches, through one hook |
| | Shortcuts | the shortcut sheet's list (`ShortcutList`, one component in both places) |
| | Privacy | whether this install sends anonymous logs, where to, and what they hold — the server's answer, see *Logs*. Exists only when the build's `cloud` switch is on ([`server.md`](server.md)) — logs are all it holds, so a build without them has no tab |
| | About | the build's `VERSION` and the server's |
| *the vault's name* | Preferences | the theme, problems, pasted images, and the quiz threshold (the person's, and says so) |
| | Vault | where it is, where its attachments go, whether a rename updates the `[[wikilinks]]` to it, the open board's unused images, and Close vault — never deleting the folder |
| | Sync | the vault's link to a sync server — only when the build's `cloud` switch is on, like Privacy |
| | AI and agents | the prompt card's provider, model and thinking; how to reach this vault from the CLI and MCP |
| | Import and export | the export's PNG detail, paper and margin, where importing is, and the largest attachment and its types this server takes (read-only) |

The *Account* group keeps its name for what it now means: the person's, in every vault, kept in the
app's home. There is no account to sign into.

Four things about the modal are load-bearing:

- **It is over everything, in a portal on `<body>`** at z-index 50, the sidebar dimmed under it. The
  card it replaced sat inside the page and left the sidebar live beside it. A delete question asked
  from inside it sits above it, at 60 — which is where `.dag-purge__scrim` had
  always claimed to be and never was (see *Things that will bite*).
- **It owns every key aimed at it.** It handles Escape and `ctrl+,` itself, walks its tabs on the
  arrows (`stepTab`), keeps Tab inside, and stops every other key at its edge; and `useEditor`, whose
  window handler runs first in the capture phase, returns on any key whose target is inside
  `[data-dag-settings]`. Without the second half, a click on a blank part of a tab left the focus on
  the modal rather than on a control, and a Delete pressed there deleted the board's selection behind
  it — which the old card could do too.
- **Every control saves as it changes, on every tab**, and each tab's Reset resets what that tab
  shows and nothing else (`resetSettings(only)`). The attachments folder, the one text field, saves on
  Enter or when it is left; Escape with a change in it takes the change back, and the next closes.
- **The tab is this browser's** (`dag:settings-tab`, written with `writeLocal`, never synced) and a
  request that names one wins. `dag:chrome` carries `{ what, tab? }` (`src/ui/chrome.ts`). Under
  720px the modal is the window: the tab list, then one tab with a back arrow.

Everything below is from the card's first version, and still holds of the tabs that carry it.

**It exists because of a defect with no setting behind it.** A pasted screenshot looked soft, and the
obvious explanation — compression — was not the cause and never had been: `onPaste` reads the
clipboard with `FileReader`, `/asset` decodes the base64 and writes those bytes, and no
decoder, no `sharp`, no `toDataURL` quality argument and no max dimension exists anywhere between the
two. What did exist was **a literal `w: 520` in both `onPaste` and `importFiles`**, and
`.dag-image img` is `width: 100%` — so a 1002-pixel capture was drawn into a 520-pixel box, 52% of its
pixels, and then resampled again by whatever the board's zoom was. A "quality" slider would have been
a control that changed nothing, which is the thing this codebase refuses most often. `src/edit/image.ts`
is the arithmetic that replaced the literal.

Six things are load-bearing:

- **`?snapshot=1` reads no preference at all** — not `dag:settings`, and not
  `dag:theme` either. `scripts/snapshot.mjs`, `scripts/tidy.mjs` and every Playwright check open a
  board that way, and a picture of a board must be a fact about the board rather than about whoever
  last opened it on this machine. The guarantee held **by accident** at first, because a fresh
  browser context has empty storage; a person pointing the snapshot script at a persistent profile
  got their own theme in the picture and nothing said so. `readSettings()` and `useTheme`'s second
  argument are the mechanism. A snapshot is therefore drawn in the app's default theme unless the
  URL names one with `?theme=`, which is the explicit instruction the snapshot tools pass. The board
  contributes nothing: a `theme:` in its frontmatter is not read (issue #162). The query is read
  *per call*, never cached at module load: `App` rewrites it with `replaceState` as boards and pages
  are opened.
- **A setting is read at the moment of the gesture, never threaded through `Item`.** `readSettings()`
  is a plain function called inside `onPaste`, `importFiles`, `exportAs` and the toolbar's per-item PNG.
  `useSettings()` — a `useSyncExternalStore` over a `dag:settings` window event — exists for the two
  places that *show* a value: the dialog, and the Export menu's caption, which has to say
  `Board as PNG (3×)` the moment the scale is three. `Item` is memoised, and a preference reaching it
  as a prop would re-render every item on the board when somebody changed the export scale. The hook
  caches its snapshot because `readSettings()` parses a string into a fresh object every call, and
  `useSyncExternalStore` compares by identity — uncached, it re-renders forever.
- **The placement rule is the setting; there is no compression to reduce.** `screen` (the default) is
  `naturalWidth / devicePixelRatio` — the size it was on the screen it came from; `pixels` is its own
  pixels, for someone who wants a 2× capture sharp at 50% zoom; `width` is one fixed number, which is
  what the app did before. The floor is one grid step, so a 1×1 tracking pixel does not become an item
  too small to select. The fence still carries an explicit `w=`, so the *file* says what the image is
  and `flow.ts` never learns a preference exists.
- **`paste.maxWidth` is the only thing here that can lose a pixel, and it is off.** Over it, the image
  is resampled once through `createImageBitmap(file, { resizeWidth, resizeQuality: "high" })` and
  re-encoded — **as PNG, always**, because what lands on this board is a screenshot with text in it.
  **An SVG and a GIF are never resampled**: a vector has no pixels to lose and a canvas would drop
  every frame but the first. **And only a paste is**: an image imported or dropped from the computer
  is an attachment, kept exactly as it was uploaded, and the placement rule decides only its `w=`.
- **The theme `<select>` became the gear** — net zero in a row that was thinned deliberately. The
  theme keeps its own `dag:theme` key and its two sources in the same order (`?theme=` beats the stored
  choice, then the default): it is the one preference with an explicit URL source and its own test,
  and folding it into the object would be a migration for a key that is not wrong. **A board is not a
  third source.** Its `theme:` was one until issue #162, which made a document able to override the
  person reading it and the same vault look different board to board; the line is still parsed as
  ordinary frontmatter and left in the file untouched, and nothing reads it or writes it.
  Choosing a theme while a `?theme=` is present clears the query key, because choosing now is choosing.
- **The modal takes focus and owns its own Escape.** `typing()` in `useEditor` counts a focused
  `BUTTON`, `SELECT` or `INPUT` as somebody typing and leaves the keys alone — correctly — so the
  moment a person touches a control in the dialog the window's Escape chain can no longer see the
  key. The modal handles it and stops it, which keeps the chain's order intact: the innermost thing
  held is the first thing let go. It opens with the focus on its open tab, so its handler hears the
  key from the start; the window handler's `[data-dag-settings]` branch is what closes it when the
  focus has somehow left.

**Storage — on the Vault tab — is the one thing in Settings that is not a preference, and it is scoped to a board.**
Deleting an image item removed its fence and left `paste-<sha1>.png` on disk; nothing swept, and only
deleting a whole board took its `.assets/` with it. `unused` in `server/routes/files.ts` is the rule —
`GET /__board/assets/unused?name=` counts, `POST /__board/assets/sweep?name=` removes — over the
board's legacy `<name>.assets/` folder (new pictures live in `attachments/`, which a sweep never
touches), and three things about it are load-bearing:

- **Never on delete, and never automatic.** Undo here is a *version of the file*, so a deleted image
  is one ctrl+Z from being drawn again and a cut one is one paste from it. Freeing the bytes when the
  fence goes would break both. A sweep somebody asks for, twice, is the only safe shape.
- **Scoped to the open board, never the vault** — the same refusal `/rmdir` makes by not being
  recursive. A vault-wide button is one click that reaches into thirty boards, and the first
  version of the e2e check for it caught exactly that: run from a preferences dialog it would have
  deleted files out of every board in `boards/`, this repository's own included.
- **A file is kept if its *basename* appears in any board's text**, which is deliberately blunter
  than reading `src=` off a fence. A `src` is relative to the board's *directory*, so one board may
  legitimately name another's asset; a markdown item can embed one as `![](x.assets/y.png)`, which no
  fence attribute shows; and a saved component is a board too. A pasted name is `paste-<sha1:8>.png`
  and effectively unique, so the blunt test costs nothing and cannot delete something in use — which
  is the only error here worth being careful about. An empty `.assets/` directory is left where it
  is: a directory is not something anybody lost.

Names claimed, grepped first as this file has learned to: `dag-settings`, `dag-settings__*`,
`data-dag-settings`, `data-dag-settings-toggle`, `data-dag-setting-*`, and the storage key `dag:settings`
— and for the modal `dag-settings-modal*`, `data-dag-settings-tab`, `data-dag-settings-tab-button`,
`data-dag-settings-pane`, `data-dag-settings-group`, `data-dag-settings-view`, `data-dag-settings-back`,
`data-dag-settings-close`, `data-dag-vault-settings`, and the
storage key `dag:settings-tab`. `dag-settings__*` is also the vocabulary of other cards (the rewrite
dialog, the delete questions), so a change to one of its rules is a change to all of them.
The CSS is chrome and lives in `chrome.css`; it asks the theme for one thing only — `--dag-color-shadow`,
the translucent elevation colour every dialog and floating card draws with — because a shadow is a
colour the theme owns while how wide a dialog is is not. In `paper-dark` it is black, so the card sits
on a dark edge rather than glowing; in `paper` and `neutral` it is a soft tint of ink. The shared
`--elevation` rule is where the geometry lives, and the Settings modal, the board browser, the rewrite
dialog and the welcome card all read it.

**Deliberately out**: a lossy quality slider (there is nothing to compress, and the content is text);
a config file the server reads (it would put a person's preference into every visual baseline, and
`src/board/` could not read one anyway); per-board settings (the file already says what it can, in
frontmatter and in `w=`, and a theme is not one of them — it is the reader's, see *Settings* above);
un-embedding the fonts from an export (the layout was measured against the
theme's face, so a file without it is a different diagram); and the window keys — the library and
the inspector's mode and width — which each have a control where they act. (There were five; the
board list's went with the column.)
