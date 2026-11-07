# The board file

One Markdown file per board: frontmatter, then fenced blocks. Prose between blocks becomes its own
markdown item, so a board reads as a document in an editor and lays out as a board in the browser.

````md
---
title: HunterOS — the shape of it
theme: paper          # optional; `neutral` is the other one
---

Any prose here becomes a markdown item.

```md {#intro x=0 y=0 w=560}
## Why this exists
Markdown, **including GFM tables**.
```

```note {#rules x=0 y=340 w=560}
A tinted note. Same as `md` with the note style.
```

```image {#shot x=640 y=0 w=520 src=hunteros.assets/paste-3f9a.png}
An optional caption.
```

```erd {#schema x=640 y=400 title="Candidates and jobs" subtitle="HunterOS · Postgres"}
entity workspace { id uuid pk; slug text }
```
````

## The fence line

`{#id key=value flag}` — values are bare words, numbers or `"quoted strings"`.

| Key | Means |
|---|---|
| `#id` | The item's id, and its permanent one: a link, a search hit and a share link name it. **Write one on every fence**; loose prose has none, so put prose in an `md` fence. Any write through the api fills in a missing one, and keeps the one you wrote. |
| `x` `y` | Position on the board. **Omit both and it auto-flows** — you rarely need them. |
| `w` `h` | Size. Diagrams size themselves; `md` and `image` default to 520 wide. |
| `title` `subtitle` | The diagram's heading. Diagrams only. |
| `dir` | `LR` or `TB`, overriding the type's default. |
| `aspect` | The shape the layout aims for, overriding the theme's default for the type. **`aspect=0` turns wrapping off.** |
| `src` | For `image`, relative to the board file. |
| `page` | Groups items into a page the toolbar switches between. |
| `as` | On a `prompt` card only: the diagram type the person asked for. |

**Write boards without coordinates.** Auto-flow packs items in reading order; pin something with
`x`/`y` only when its position carries meaning.

**Reach for `aspect=0` when the diagram really is one chain.** A type's default aspect folds a long
diagram into rows to keep it roughly rectangular, which is right for most architecture diagrams and
wrong for a pipeline: a chain that wraps stops reading as a chain, and the fold puts the last stage
above the first. If a diagram of yours comes out in bands running the wrong way, that is what you
are looking at.

## Prompt cards

````md
```prompt {#ask x=80 y=240 w=420 as=arch}
A browser talking to an API that stores orders in Postgres.
```
````

A description waiting to be drawn — the person presses Generate and a model on the dev server puts
one diagram in the card's place. It is not a diagram and never draws as one. Don't write these
yourself unless asked to leave a request for somebody, and don't rewrite one's body into DSL.

## Images

Put the file in `boards/<name>.assets/` and reference it as `<name>.assets/<file>`. A user pasting
into the browser writes both the file and the fence for you.


## Laying out a page of several items

You rarely need `x`/`y` for one diagram. You need them for a page — and a diagram's height is not
knowable until it has been laid out, so placing one is guess, render, look.

Write your best guess, then let the page settle it rather than guessing twice:

```bash
anydag tidy <board>        # stacks, rows and grids one gap apart, measured in the real fonts
anydag item ls <board>     # where every item now is
```

`tidy` reads the arrangement you meant off the rough positions and writes exact ones, so a column
of notes beside a diagram stays a column beside it, however tall the diagram came out.

Two items landing on top of each other reports `Q_ITEM_OVERLAP` and names both. Nothing else
catches it — a diagram's own `Q_NODE_OVERLAP` is about two cards inside one diagram, not two items
on one board.

## A standalone SVG

```bash
anydag board export <board> --item <id> -o answer-flow.svg
```

One item, at 1:1, with the fonts, the icons and every computed style inlined — it renders with no
stylesheet and no network, so it can be committed next to whatever it illustrates.

## Pages

```yaml
---
title: HunterOS — onboarding
pages:
  - id: what-it-is
    name: What it is
  - id: the-funnel
    name: The funnel
---
```

Then `page=what-it-is` on a fence. Ids are unique **board-wide**, not per page, and auto-flow packs
each page independently. Unfenced prose belongs to the first page, whatever it is called.

```bash
anydag snapshot <board> --page the-funnel
```

Without `--page` you get the first one. A page id that does not exist draws the first page and says
so rather than hanging.
