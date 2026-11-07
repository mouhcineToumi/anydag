# icons

Technology icons for the diagram surface: databases, cloud services, AI providers, DevOps tooling.

Everything here is **generated**. `manifest.json` is the input a person edits; `data/*.json` is the
output the app imports. Rebuild with `npm run icons:build`.

## Why this lives outside `src/`

`check-literals.mjs` fails the build on any hex or `rgb()` under `src/`, because a colour a theme
cannot reach is a colour the design system does not own. A brand logo is nothing *but* colours it
does not own — Postgres' blue belongs to Postgres. So the artwork lives here, in a folder the rule
does not scan, and `src/render/Icon.tsx` imports it as data rather than as style. The rule is intact
and the exception is legible, which is the point.

## The three modes

| mode | source | colour | tile | when |
|---|---|---|---|---|
| `concept` | Lucide | `currentColor` | hue-tinted | a *kind* — a server, a queue, a person |
| `mono` | Simple Icons | `currentColor` | hue-tinted | a brand, tinted to match the group |
| `brand` | logos / vendor packs | its own | neutral | a brand, recognisable at a glance |

A board picks one by how it writes the name:

```
icon=server            concept — a Lucide glyph, tinted by the node's hue
icon=mono:postgresql   mono    — Postgres' elephant wearing the group's hue
icon=postgresql        brand   — Postgres' elephant in Postgres' blue
icon=aws:lambda        brand   — a namespaced cloud service
```

Resolution order is **brand first**: a bare name takes the colour mark, then the mono silhouette,
then the Lucide glyph. The ordering was written the other way round first — the worry being that
`icon=server`, a Lucide server since M1a, must never silently change what existing boards draw —
and the code outgrew it: the names both vocabularies claim turned out to be brands every one, and
on each of them Lucide's approximation was shadowing the real logo. `snowflake` is the one genuine
concept/company overlap (Lucide's ❄ is a weather glyph) and the brand still wins there, which is
accepted; `icon=mono:<brand>` and `icon=lucide:<name>` settle it explicitly either way.
`npm run check:icons` prints the overlap on every run so the next one cannot arrive unnoticed.

An unknown name is **not** silent. `finalize()` reports `W_UNKNOWN_ICON` and the node falls back to
its kind's default, because the vocabulary is thousands of names deep and dense with near-misses —
`groq`/`grok`, `together`/`tether`, `zookeeper`/`keeper` are each two different companies. A typo
that quietly drew a box would be survivable; one that quietly draws a *different real logo* is not.
`npm run check:icons` fails on any `icon=` in `boards/` that does not resolve.

## The emoji: pictures rather than technologies

Every set above names a *technology*. What somebody illustrating a process reaches for is a person,
a house, a book, a truck — so the bundle carries a fourth vocabulary: Microsoft's
**Fluent Emoji**, MIT, 1,593 subjects under Unicode's own short names, in two cuts with one set of
names.

```
icon=emoji:house         the Flat cut, in its own colours — drawn like a brand, never tinted
icon=mono:emoji:house    the High Contrast cut, in currentColor — takes the node's hue like mono
```

The namespace is deliberate: a bare `house` has been Lucide's house since M11, and letting a colour
emoji answer to the same word would redraw every board that wrote it. Skin-tone variants are left
out — five of every person and hand is a choice about a real person that a diagram's generic
"customer" is not making — so the default Unicode figure is what ships.

They are **not** in `data/icons.json`. Each cut is `data/emoji-color.json` / `data/emoji-mono.json`,
about a megabyte gzipped apiece — the whole brand bundle's weight again — and `src/render/art.ts`
imports one only when a board first names an emoji from it, so a board without one never downloads
either. Their names go into `src/dsl/icon-names.ts` like every other name, and their categories into
`src/dsl/emoji-names.ts`, which is what the library's *Objects* shelves are built from.

A `sketch` `figure` is what they are for — a picture with a caption under it — but any node's
`icon=` may name one.

## Sources, and what each costs

**A CC0 source always wins.** Where two sets have the same icon, the build takes the unencumbered
one, so the vendor packs are consulted only for what nothing else covers. That is why only a
fraction of the AWS icons in the bundle carry an attribution obligation.

| source | icons used | licence | obligation |
|---|---|---|---|
| [Simple Icons](https://github.com/simple-icons/simple-icons) | 156 mono silhouettes | CC0-1.0 | none |
| [gilbarbara/logos](https://github.com/gilbarbara/logos) | 207 colour marks, incl. 59 AWS services | CC0-1.0 | none |
| [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) | 261 (the long tail past CC0) | see `NOTICE` | attribution; **no derivatives** |
| [Azure Architecture Icons](https://learn.microsoft.com/en-us/azure/architecture/icons/) | 639 | see `NOTICE` | permitted use only; **shape must not change** |
| [Google Cloud icons](https://cloud.google.com/icons) | 45 (19 core + 26 category) | see `NOTICE` | reference use |
| [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) | 1,593 × 2 cuts, loaded on demand | MIT | the notice in `NOTICE` |

1308 icons ship: 1152 colour and 156 mono. Of the 1004 icons in the vendor packs, 59 are dropped in
favour of the CC0 version of the same service.

### Refreshing the vendor packs

The zips are **not committed** — they are large, and their terms are about using the icons in
diagrams rather than redistributing the packs. `icons/data/vendor.json` is the committed output, so
a fresh clone needs nothing. To refresh (AWS ships quarterly), drop these four into `icons/.packs/`
(gitignored) and run `npm run icons:build`:

| file | from |
|---|---|
| `aws.zip` | the "AWS Architecture Icons" asset package linked at <https://aws.amazon.com/architecture/icons/> |
| `azure.zip` | `https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V24.zip` |
| `gcp-core.zip` | `https://services.google.com/fh/files/misc/core-products-icons.zip` |
| `gcp-cat.zip` | `https://services.google.com/fh/files/misc/category-icons.zip` |

With no packs present the step reports what it skipped and keeps the committed output, so adding a
CC0 brand never requires downloading 15 MB of zips.

CC0 waives copyright but **not trademark** — every one of these marks still belongs to the company
that owns it. Using them to label "this system talks to Postgres" is nominative use and is what the
sets exist for; using one to suggest Postgres endorses something is not.

### The constraint that shapes the code

The vendor packs may not be modified. Azure's terms say it outright — *"Don't crop, flip, or rotate
icons. Don't distort or change icon shape in any way"* — and AWS's own redistribution is CC-BY-**ND**,
where ND means no derivative works.

This is exactly why `brand` is a separate mode rather than a recolour. Feeding a vendor icon through
`hueVars()` to tint it would be a derivative work; drawing it unmodified on a neutral tile is not.
The design decision and the licence agree, which is the only reason both are affordable.

**Never** add a step that recolours, desaturates or reshapes anything in `data/vendor.json`. The
`mono:` mode is CC0-only for the same reason — Simple Icons can be tinted freely, a vendor pack
cannot.

### Google Cloud, specifically

Google replaced its icon set in 2025, cutting ~250 product icons down to 19 core products plus 26
generic categories. **Firestore, Pub/Sub, Artifact Registry and Cloud DNS no longer have distinct
official icons** — under the current set they are all "Databases", "Integration Services",
"Developer Tools" and "Networking". The legacy per-product icons still exist and Google says not to
use them. That is a coverage fact, not a licensing one, and no icon set can fix it: draw those with
a concept glyph.

Note also that Iconify's `gcp` set advertises Apache-2.0. Its metadata names no upstream repository
and its licence URL points at Apache's boilerplate rather than at any grant from Google — and it
contains the deprecated icons. It is not used here.

## Files

```
manifest.json        canonical name -> upstream slug. Hand-edited; the reviewable artifact.
vendor-slugs.json    filename -> slug map for the vendor packs. Hand corrections survive a rebuild.
data/icons.json      generated — what the app draws from, loaded the first time a glyph needs it.
../src/render/icon-index.ts  generated — which names each set holds, without the art.
data/vendor.json     generated — the vendor packs, normalized.
data/emoji-*.json    generated — Fluent Emoji, colour and mono, each loaded only when a board names one.
NOTICE               the attributions the licences above actually require.
```

`src/dsl/icon-names.ts` is generated from here too: the DSL needs the valid-name list to report
`W_UNKNOWN_ICON`, and it is the one layer that must stay loadable by plain Node.

## Adding an icon

Add a line to `manifest.json` naming the upstream slug, run `npm run icons:build`, and commit the
regenerated files. The build prefers a `-icon` sibling over a wordmark automatically — `logos` ships
`docker` as the whale *beside the word*, and at 8.8:1 `anthropic` printed straight across the card
it belonged to before that rule existed.
