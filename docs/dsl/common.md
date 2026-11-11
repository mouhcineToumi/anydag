# Shared grammar

Every type but `mindmap`, `timeline`, `gitgraph`, `sequence` and `chart` uses these statements —
those five have a grammar of their own. The quoting rule below, the comments, `hue=` and `icon=`
are shared everywhere.

```
%% or // starts a comment
```

**Free text is always `"quoted"`; a bare word is always an id, keyword or `key=value`.**
Backticks mark real data inside a label: `` `POST /attempt` `` renders mono.

## Strings

A backslash takes the next character as it is, so a quote inside a string is `\"` and a backslash
is `\\`:

    text a "s = \"aa\""          draws  s = "aa"
    box p "C:\\boards"           draws  C:\boards

A bare `"` ends the string, and a string ended right against a word is `E_UNESCAPED_QUOTE` naming
the fix. `\n` is a newline in the string but not a line break in the drawing: every title, meta and
label is drawn on one line, so it reads as a space, and a sticky or a shape wraps its words to its
width whatever they hold. For two lines, use two statements, or a `meta`. This holds wherever the
shared grammar reads a string, `sequence` and `chart` included; `timeline` and `gitgraph` read a
label up to the next `"` and take no escapes at all.

## Node

    <kind> <id> "<title>" ["<meta>" ["<desc>"]] [flags] [{ rows }]

Flags: `done` · `wait` · `stop` · `muted` · `async` · `external` · `bold` · `italic`

`bold` and `italic` emphasise the node's own title, and nothing else — a group label, a lane band,
a sequence participant, a chart series and an edge label keep the theme's weight. They are
independent and can be combined: `service api "API" bold italic`.
Attrs: `icon=server` · `hue=teal` · `w=320` · `col=2`

## Column

`col=` is how far along the flow to keep a card, and the only thing you can say about an automatic
layout's placement. Everything else stays the layout's: which row inside the column, the spacing,
and every other card's column.

**It is a rank, not an index.** The cards that carry one are ordered against each other and the
layers nobody claimed are compacted away, so a single `col=4` on its own changes nothing and two
numbers hold two cards apart. Use it in pairs or not at all.

It means something only where ELK places — `arch`, `erd`, `state`, `class`, `usecase`, `c4`. In a
fence opened `layout=fixed`, in a `sketch`, in a `chart`, and in `flow`/`activity` (whose columns
are the lane layout's) it warns `W_UNKNOWN_ATTR` and does nothing. The editor offers it as **Keep in column N**
on a picked card, with N the column that card is drawn in.

## Hue

`hue=` is a closed set of ten — `indigo` `teal` `coral` `spruce` `ochre` `violet` `magenta` `moss`
`crimson` `bronze` — on a node, a group, a lane, an edge, or a chart's `series`/`slice` (`fk=` on an
ERD row takes a group id instead, and reads that group's hue). A name outside the ten warns
(`W_UNKNOWN_HUE`) and is
dropped, not kept and ignored: the card falls back to whatever it would have had with no `hue=` at
all — inherited from its group or lane, or a group's own automatic assignment — rather than binding
a colour nobody set.

On a diagram's **fence line** (`{#infra hue=teal}`) it tints the diagram's own frame — a hairline round
it and the band behind its header — and nothing inside it: a card with no hue of its own does not take
the frame's. The panel's *Frame colour* row writes it.

## Icons

Three vocabularies, picked by how the name is written.

    icon=server            a Lucide glyph — a kind. Tinted by the node's hue.
    icon=postgresql        a brand, in its own colours, on a neutral tile.
    icon=mono:postgresql   the same brand as a silhouette, wearing the hue instead.
    icon=aws:lambda        a cloud service. Also `azure:` and `gcp:`.
    icon=lucide:github     the concept glyph, where a brand owns the name too.

A brand icon moves the hue to the card's border, because a logo already fills the tile with colours
the theme does not own. `done`, `wait`, `stop`, `external` and the hover ring still win over it —
what a node is *doing* outranks which group it is in.

A brand beats a Lucide glyph where both claim a name — `figma` `github` `gitlab` `slack` `vault`
`snowflake`. The first five are brands through and through; `snowflake` is also Lucide's ❄ weather
glyph, and the company still wins — `lucide:` asks for the glyph back.

A bare name takes the first of the three that has it — the colour mark, then the mono one, then
the Lucide glyph — so `icon=keycloak` (mono only) needs no prefix.
An unrecognised name warns (`W_UNKNOWN_ICON`) and falls back to the kind's default — worth checking,
because the vocabulary is full of near-misses: `groq` and `grok`, `together` and `tether`,
`zookeeper` and `keeper` are each two different companies.

Covered: the major databases, the modern data stack — dbt, Snowflake, Databricks, Spark, Flink —
and the analytics products around it (Tableau, Looker, Power BI), message brokers, CI and
observability tooling, languages and frameworks, AI providers, and cloud services.

**Ask the server which names exist rather than guessing: `GET /__board/icons`**, `?q=` to narrow
and `?mode=brand|mono|concept` to ask for one way of drawing. It answers `{ name, mode }` per icon,
so it says how a name draws as well as that it exists — which the spelling never tells you. The
vocabulary behind it is `src/dsl/icon-names.ts`, generated from `icons/manifest.json` (the CC0
brand curation) plus the ~1004-icon AWS/Azure/Google tail in `icons/data/vendor.json` (`gcp:bigquery`
and friends); both are paths on disk, which is why the route is the one to reach for.
Google's 2025 icon redesign means Firestore, Pub/Sub, Artifact Registry and Cloud DNS have no
distinct official mark any more — use a concept glyph for those.

## Group and lane

    group <id> "<label>" ["<sublabel>"] [hue=teal] [dir=TB] { ... }    -- nests
    lane  <id> "<label>" [hue=ochre] { ... }                           -- flow / activity only

`system` also opens a group in `usecase` and `c4`. A file uses groups or lanes, not both.

## Edges

    <ref> <arrow> <ref> ["label"] ["second label"] [quiet]
    a --> b --> c                  chained
    a & b & c --> d "reject"       one trunk, several sources
    f1 --> a & b & c               a fan out of a fork
    api.content --> store          from a row (rule 9)
    workspace --> intake           to a whole group (rule 4)

| Arrow | Draws |
|---|---|
| `-->` | solid, chevron |
| `-.->` | dashed, chevron |
| `---` `-.-` | a line, no marker |
| `--\|>` `..\|>` | hollow triangle (extends / implements) |
| `*--` `o--` | filled / hollow diamond at the source |
| `..>` | dashed, open arrow (depends on) |
| `\|\|--o{` etc. | ER cardinalities: `\|` one, `o{` many, `..` dashed |

`[*]` is the start pseudostate as a source and the end as a target.

## Legend

    legend solid "a call at runtime"
    legend dashed "happens at deploy time"

One glyph per `legend` line.

Glyphs: `solid` `dashed` `quiet` `external` `done` `wait` `stop` `port`
