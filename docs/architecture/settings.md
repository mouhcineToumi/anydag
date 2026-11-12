# Settings

> Preferences, the Settings modal, and why a snapshot reads none of them.

## Settings

What the *app* does, as opposed to what a board says. A board file is the document Claude reads and
every gesture on the canvas is a write to it; these are the other thing — preferences about this
window that no board should carry. `src/settings/store.ts` owns the keys, `Settings.tsx` the modal,
`tabs.ts` its tabs and `panes/` one file per tab. `saved.ts` is the one announcement a write makes and
`feedback.tsx` turns it into the tick beside a row, the modal's single polite live region, and the
toast a reset raises. The gear at the
sidebar's foot or `ctrl+,` opens it on the last tab this browser had open, and the vault switcher's
*Vault settings…* on *This vault → General*.

**The tabs are grouped by where each setting is kept**, which is the line the group headings draw.
*You* is the person's, the same in every vault, kept in the app's home. *This computer* is this
machine's alone. *This vault* is stored with the vault and switches when it does. *This board* is
the open board's own file, stored in its frontmatter, and its group is drawn **only while a board is
open and editable** — not under `?snapshot=1`, and not when the vault is locked. The three
reference pages are tabs too — so the arrow keys walk them — but they are drawn as quieter links at
the foot, outside the groups. The grouping itself moved nothing; #191 then moved two things to *You*,
below.

| Group | Tab | Holds |
|---|---|---|
| You | Appearance | the theme — the person's, in every vault (#191) |
| | AI | one searchable model picker and one effort scale, shared by the prompt cards, Rewrite, Generate flashcards, and what a new Assistant chat starts on — the person's, in every vault (#191) |
| | Calendar | the time zone times are shown and written in, where a week starts, and which kinds the calendar shows — the Calendar page's own switches, through one hook |
| | Quizzes | the quiz practice threshold, kept with the practice records in the app's home and written through `/api/practice` |
| This computer | AI providers | every provider in its own row, with its logo, a status pill (Ready, Needs a key, Not signed in, Not installed, Needs an address…) and what it takes to set it up: in the desktop app a key field, and for OpenAI-compatible its address and model too; in a browser, the variable the server reads. *Save and test* stores, waits for the server, then makes one short call. *Check again* asks afresh. The tab carries a dot when a provider in use cannot answer |
| This vault | General | the vault's name, location and facts, "When a board has an error", the trash's retention, and Close vault — never deleting the folder |
| | Files and images | the attachments folder, whether a rename updates the `[[wikilinks]]` to it, how a pasted image lands, and the open board's unused images |
| | Export | the export's PNG detail, paper and margin, where importing is, and the largest attachment and its types this server takes (read-only) |
| | Sync | the vault's link to a sync server — only when the build's `cloud` switch is on |
| | Agent access | the command that connects Claude Code, Claude Desktop or another MCP client to this vault, with a **Read only** switch that adds the server's own `--read-only` |
| This board | Layout | the open board's row width and spacing, written to its frontmatter's `flow:` — drawn only while a board is open and editable |
| *the foot* | Privacy | whether this install sends anonymous logs, where to, and what they hold — the server's answer, see *Logs*. Exists only when the build's `cloud` switch is on ([`server.md`](server.md)) |
| | Keyboard shortcuts | the shortcut sheet's list (`ShortcutList`, one component in both places) |
| | About | the build's `VERSION` and the server's |

**The theme and the AI choices are the person's (#191).** Both used to be the vault's, so opening a
second vault changed how the app looked, and the Assistant could start on another provider. Now:

- **The theme** is `dag:theme` in the person's half of `PREF_KEYS`, not in `VAULT_PREF_KEYS`. It is
  stored bare, never as `dag:theme@<vault>`, and a new vault no longer copies one (`SEEDED`).
- **The AI choices** are the settings object's `llm` and `assistant`, kept under `dag:ai` (one JSON
  string in the person's bundle). `store.ts` still hands every reader one `Settings` and takes every
  write through `writeSettings`; only where a section is stored moved. `PERSON_SECTIONS` are read
  from and written to `dag:ai`, and the rest go to the vault's `dag:settings`. A write to one never
  rewrites the other. The vault's bundle carries `vaultPart` only.
- **The carry-over** is `migrate.ts`, run by `pull()` before the app mounts, with sync on or off. When
  the person has no theme or no `dag:ai` yet, the open vault's old value is taken once: from its
  bundle as the server holds it, else from this browser's `key@<vault>` copy. A value the person
  already has is never written over. The vault's own copy is left in place for an older app version,
  so nothing is lost. The first vault opened after the change is the one whose choice carries over.
- **The MCP `generate` tool** reads `dag:ai` from the app's settings, and the vault's old `llm` only
  when that is absent. The `settings` tool lists `dag:theme` and `dag:ai` at the `app` level.
- The old tab id `vault-ai` opens *AI* (`LEGACY_TABS`).

The headings and the words on the tabs are the scopes: *You*, *This computer*, *This vault* and
*This board*. Each heading is ink, with one short line under it in slate saying what it means — under
the third, "Saved with <vault name>. Another vault has its own."; under the fourth, "Saved in this board's file. Another board has its own." Every pane repeats its scope in a small pill beside its title, so a tab read on its
own (a narrow window shows one at a time) still says where it belongs.

**Facts are not settings.** A row that only shows a value — the vault's name and location, a version,
the trash's "30 days", a path, a server's upload limit — is a quiet label and value list with no
control and no card around it (`Facts`/`Fact` in `panes/common.tsx`). An action about a fact, such as
*Show in folder*, stays a button.

**A model is chosen with one picker, and effort with one scale.** The *Diagrams and flashcards* row
and the Assistant's *Model* row both use `src/ui/ModelPicker.tsx`: a button opening a listbox with a
search field, models grouped under the provider's own name (`src/settings/providerNames.ts`) and
each group's readiness from the route its provider list already reads, the readable name over the
raw id, the five models last chosen in this browser (`dag:model-recent`, this browser's and not a
preference that travels), an *Automatic* entry for the provider's default, and a *Custom model id…*
entry for a list that has gone stale. Choosing a model of another provider writes that provider with
it. The *Thinking* row and the Assistant composer's effort control are the same `EffortPicker`,
whose scale is Automatic · Low · Medium · High · Max; `none` is still read from an older preference
but is no longer offered, and `src/settings/store.ts` is where the stored values and defaults live.
The provider's mark is its own logo; Z.ai, which has none in `icons/`, falls back to its name.

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
- **Every control saves as it changes, on every tab, and says so.** The row that changed shows a
  small slate `✓ Saved` for about a second and a half — a select at once, a text field after roughly
  600 ms of no typing or when it is left. The tick itself is silent; one polite live region in the
  modal announces each save once, so a screen reader hears one word rather than one per row. Each
  tab's Reset names its scope in its own text ("Reset Export to defaults") and resets what that tab
  shows and nothing else. A tab that now holds part of an old section splits the reset with it:
  General's covers the settings object's `problems`, Appearance's the person's `THEME`, Files and
  images' covers `paste`, `ATTACHMENTS` and `UPDATE_LINKS`, and Quizzes' writes the practice
  threshold back to its default through `setGraduate`. Before it resets it snapshots the values it
  will change, then raises the modal's toast, `✓ <scope> reset · Undo`, for six seconds; Undo writes
  the snapshot back through the same setters. The attachments folder, the one text field that saves
  on Enter rather than as it is typed, keeps doing that; Escape with a change in it takes the change
  back, and the next closes.
- **The tab is this browser's** (`dag:settings-tab`, written with `writeLocal`, never synced) and a
  request that names one wins. `dag:chrome` carries `{ what, tab? }` (`src/ui/chrome.ts`), and a
  request made while the modal is open moves it — the AI tab's *Add a key* opens AI providers, and
  the board's `⋯` opens *This board → Layout*. `lastTab` maps the ids a version before the scopes
  used: `preferences` and `vault` open General, `agents` opens AI, and anything else that is not a
  tab opens the first one. A remembered `board-layout` with no editable board open is not drawn and
  opens the first one too, like any id this page cannot show. Under 720px the modal is the window:
  the tab list, then one tab with a back arrow.

**Under 720px every control is a finger's.** Each tab is one page with a back arrow to the list, and
every interactive element inside `[data-dag-settings]` is at least 44 × 44 CSS px: the back and
close buttons, the tab buttons, selects, switches, text fields, copy buttons, the model picker's
trigger, the providers' buttons and Reset. A switch and a check keep the 32 × 18 and 16 × 16 picture
they are drawn at, inside a 44 × 44 input, so the target is the element's own box rather than a hit
area borrowed from a pseudo-element. `e2e/settings-phone.spec.ts` measures every tab at 390 × 844 —
the AI tab's feature pages included — and holds every tab to no horizontal scroll, the providers'
key rows and Agent access's command among them.

**The AI tab is two rows on a phone.** *Diagrams and flashcards* and *Assistant* each read as one
summary row — the provider's mark, the feature's name, and `Claude Code · sonnet · Low` from
`modelChoiceText` plus the chosen effort — and a tap opens that feature's controls in the same pane,
with *All AI settings* as the way back. The modal's own back still leaves the tab for the list. Above
720px the tab is the two groups it was; the summary rows are not drawn.

**Settings look like AnyDag, not like any app (#186).** The AI tab's groups are `Group prompt`:
the heading is the prompt card's Sparkles in small accent capitals and the box its dashed accent
edge (`.dag-prompt`), so a person who has made a prompt card sees where its model comes from. Only
the edge and the heading change; the rows inside are every tab's rows. A status is a dot and a word,
never the word alone: the providers' pills, the model picker's *Ready* / *Not set up*, and Sync's
*State* (`data-dag-sync-tone`: the sidebar mark's `ok`, `busy`, `warn`, and `off` when nothing is
linked). `settings-ai-<theme>.png` holds the look in all three themes.

**The words name the control.** Every `Field` row gives its name and hint ids and puts them on the
control as `aria-labelledby`/`aria-describedby`, because a `plain` row is a `<div>` and the visible
words named nothing (#189). The modal's head is a `<div>`, not a second `<header>`: the page already
has a banner. The Agent access command wraps in full rather than scrolling sideways where a keyboard
cannot reach it, and is plain selectable text; the Read only switch is the server's `--read-only`,
never a flag invented for the page.

**This board → Layout is the one tab that writes a document rather than a preference.** It replaced
the floating board-settings card in issue #185. *Row width* and *Spacing* are the frontmatter's
`flow:`, with the same `px` suffix and the words a person knows them by; a live preview lays a few
token-coloured boxes at the two numbers' own scale in `chrome.css` (no DOM measurement), and the
foot says "Defaults: 4000 px and 80 px · Use defaults" from `FLOW_DEFAULT`, never literals. A value
is written when it settles — a pause, Enter, or the field left — through `Editor.setMeta`, so each
write is one `MetaOp` with the file's sha1 `base` and one undo entry. A number `FLOW_RANGE` will not
accept is not written; it stays in the box and its row says the range. The old card and its CSS are
gone; the menu row keeps its `data-dag-board-settings-open` hook because the e2e suite presses it.

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

**Storage — the unused-images row on Files and images — is the one thing in Settings that is not a preference, and it is scoped to a board.**
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
  version of the e2e check for it caught exactly that: run from a Settings tab it would have
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
storage key `dag:settings-tab`. The save tick added `dag-settings__saved` (`data-dag-setting-saved`),
the toast `dag-settings__toast*` (`data-dag-setting-reset-toast`, `data-dag-setting-reset-undo`), the
live region `dag-settings__said` (`data-dag-setting-said`), and the event `dag:settings-saved`.
The scopes added `dag-settings-modal__note` and `dag-settings-modal__scope`
(`data-dag-settings-scope`), the quiet facts `dag-settings__fact*` (`dag-settings__facts`), and Agent
access `dag-settings__client*` (`data-dag-agent-client`, `data-dag-agent-clients`,
`data-dag-setting-agent-readonly`). The Layout tab added `dag-settings__preview*`,
`dag-settings__defaults` and `data-dag-board-flow-*`; its two numbers are `--board-flow-width` and
`--board-flow-gap`, which are not theme tokens — no theme has an opinion about a board's flow — the
same argument `--inspector-w` makes.
The phone layout added `dag-settings__feature*` (`data-dag-setting-ai-feature`,
`data-dag-setting-ai-summary`, `data-dag-setting-ai-back`) and `dag-settings__featureBack`.
`dag-settings__*` is also the vocabulary of other cards (the rewrite
dialog, the delete questions), so a change to one of its rules is a change to all of them.
The CSS is chrome and lives in `chrome.css`; it asks the theme for one thing only — `--dag-color-shadow`,
the translucent elevation colour every dialog and floating card draws with — because a shadow is a
colour the theme owns while how wide a dialog is is not. In `paper-dark` it is black, so the card sits
on a dark edge rather than glowing; in `paper` and `neutral` it is a soft tint of ink. The shared
`--elevation` rule is where the geometry lives, and the Settings modal, the board browser, the rewrite
dialog and the welcome card all read it.

**Contrast is a token choice, not a theme edit.** `muted` is 2.6:1 on Neutral's white card and 2.4:1
on its panel, so text a person must read inside `[data-dag-settings]` — headings, hints,
descriptions, placeholders and unit suffixes — takes `slate`, which every theme carries. The group
headings are the exception in the other direction: they are `ink`, because they are the scopes the
list is built on, and the one line under each is `slate`. Hints there are at least 12.5px, and prose
is capped at 68ch with `text-wrap: pretty`. `muted` remains for disabled controls and dividers, and
the sidebar's keycaps and folder names are a separate audit. `e2e/settings-contrast.spec.ts`
measures every tab, the group headers and the Layout pane in all three themes against WCAG,
`::placeholder` included; no colour in `themes/*/theme.json` changed.

**Deliberately out**: a lossy quality slider (there is nothing to compress, and the content is text);
a config file the server reads (it would put a person's preference into every visual baseline, and
`src/board/` could not read one anyway); a per-board preferences store (the board's own settings are
the file's — `flow:` and `w=` — and a theme is not one of them, it is the reader's, see *Settings*
above); un-embedding the fonts from an export (the layout was measured against the
theme's face, so a file without it is a different diagram); and the window keys — the library and
the inspector's mode and width — which each have a control where they act. (There were five; the
board list's went with the column.)

### *The provider list*

`panes/Providers.tsx` draws `GET /__board/llm`, so a row says Ready because the server could reach
the provider, not because a field holds something. The pill is `providerStatus` in
`src/settings/providerStatus.ts`, one word per reason code; the sentence under a row that is not
ready is `explainLlmReason`'s, as on every other AI surface.

- **Check again is `GET /__board/llm?fresh=1`**, which forgets the server's remembered readiness
  (a yes is kept a minute, a no three seconds). Every mounted surface hears the new list through
  `useProviders`' listeners, and "Checked N seconds ago" is when the page last got one.
- **Save and test** stores what changed — the key through `desktop.keys`, OpenAI-compatible's
  address and model through `desktop.providerEnv` — each of which restarts the server, then calls
  `POST /__board/llm/test`: one short answer, one attempt, thirty seconds. The row shows the model
  and how long it took, or the reason it could not, in the same words a prompt card would use.
- **A key never comes back to the page**; the address and the model do, because neither is a
  secret and the field has to show what is set.
- **The dot** on the AI providers tab is `needsAttention`: the diagrams' provider (the server's
  default when none is chosen) and the Assistant's when one is chosen. A provider nobody uses is
  not a problem, however unready.
- **The logos** come from `icons/data/providers.json`, generated beside the brand bundle so opening
  Settings does not fetch 2.5 MB of diagram icons (`src/ui/ProviderMark.tsx`). Z.ai has no mark in
  either source yet and keeps an empty column. Anthropic's and OpenAI's marks come from the mono set
  and draw in `currentColor`: their colour art is black, and a dark theme hid it. Only Gemini's
  gradient is drawn in colour.

