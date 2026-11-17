# The graph view

> The vault drawn as a graph (#262): the route that describes it, its fields, the view model (#457),
> and the page that draws it (#459). The simulation is [`graph-simulation.md`](graph-simulation.md) (#458).

## The graph route

`GET /__board/graph` answers the vault as a graph: every document, every link between two of them,
and the **fields** a person colours, filters and groups by. It is built by `server/graph.ts` from the
references index the server already keeps (`indexDocs`, *References, ids and the read-only view* in
[`references.md`](references.md)), so no document is read and nothing is parsed again. The one file it
reads is the tag list (`.anydag/tags.json`, a few hundred bytes), for the tags' colours.

It exists because `/__board/index` carries every reference's text. Measured on the bench's 5,000-file
vault (`scripts/bench.mjs`, about one link a note) the index is 1.21 MB and this is 0.40 MB; on the same
vault with thirty wikilinks a note the index is 11.4 MB and this is 1.63 MB (0.47 MB gzipped). What is
left is mostly the links, two numbers each.

Three things are load-bearing:

- **The JSON is kept per index answer.** `graphText` in `server/routes/docs.ts` keys it on the
  index's document list (the same array while the listing and the parse did not move, as
  `indexJson` keeps the index's) and on the tag list's bytes. A second ask while nothing moved costs
  the index's own check and nothing more.
- **Every loop is paced** (`server/pace.ts`), the JSON is written a slice of each long array at a
  time, and the answer is streamed in slices (`jsonText`), so a large vault does not hold the
  server's only thread (#287).
- **A field is known by name only in the builder.** Each is a `FieldBuilder` in `server/graph.ts`:
  a key, a label, the word for "none", and what one document's value or values are. A new field is a
  builder added to `FIELDS`, and nothing in `src/graph/` or on the page changes.

Parity: the route is a line under `files.refs` in `docs/parity.json`. The MCP `refs` tool already
serves references, and an agent wanting the vault's links reads those; the graph is the page's
compact copy of the same thing, so it adds no tool.

## The wire format

`src/graph/wire.ts`, types only, imported by the server and the page.

```ts
interface GraphWire {
  v: 1;
  ids: string[];                    // one entry per document, in name order: a folder's files are neighbours
  names: string[];
  titles: (string | null)[];        // null: the last part of the name
  links: number[];                  // [from, to, from, to, …]
  fields: GraphField[];
}
interface GraphField {
  key: string;                      // "kind", "folder", "tag", "project", "status", …
  label: string;                    // "Kind": what a person picks
  none: string;                     // "No tag": what a document with no value has
  type: "one" | "many";
  tree?: true;                      // values are "/" paths
  values: { key: string; label: string; hue?: Hue | null; plain?: true }[];
  of?: number[];                    // "one": an index into values per document, -1 for none
  start?: number[]; items?: number[]; // "many": CSR, start has n + 1 entries
}
```

- **A link is an unordered pair, once.** Never a document to itself, and only to a document in
  `ids`: a wikilink and a `dag:` reference to the same target are one link, and a link to nothing
  (a dangling `[[wikilink]]`) is none.
- **Documents are texts and attachments**, as the index holds them: everything with an id, which is
  every listed file once the vault has been indexed.
- **A value is named by its key**, never by its index, wherever something is remembered: a view kept
  from yesterday names `tag: draft`, not value 3.
- `label` and `none` are on the field, beyond what the issue sketched, so the page can name a field
  it has never heard of.

The fields today:

| Field | Type | Value key | Label | Hue |
|---|---|---|---|---|
| `kind` | one | `note` `task` `project` `event` `board` `quiz` `table` `attachment`, a note's as the sidebar marks it (`shownKind`: project, then task, then event) | *Notes*, *Tasks*, … | one per kind, set in the builder; a note is `plain` (slate), the ground the rest stand on |
| `folder` | one, tree | the parent folder's path; none at the top | the path | none |
| `tag` | many | `tagKey` | the tag list's spelling, else the one most documents use | the tag list's hue, else `defaultHue` |
| `project` | one | the project note's id; membership is a path (`projectFor`) | its title | its `hue:` |
| `status` | one | a task's status | *To do*, *In progress*, *Done* | none |

A template has no task, project, event or tags here, as everywhere (`indexAnswer`). Values are only
those some document has; a rule naming one that is gone passes over it.

## The view

`src/graph/view.ts`: plain data, kept as JSON by the page.

```ts
interface GraphView {
  colourBy: string;                 // a field key
  groupBy: string | null;           // a field key, "links", or null
  rules: { field: string; hide?: string[]; only?: string[] }[];
  orphans: boolean;                 // show documents with no link at all
  forces: { repel: number; link: number; pull: number; centre: number; tight: number; gap: number };
}
```

**One rule semantics for every field.** A document is shown when, for every rule, at least one of
its values is allowed. `hide` takes values out, so a value the vault gains later is shown; `only`
keeps the values named, so a later one is not. A document with no value has the value `""`. On a
`tree` field a key covers itself and everything under it — `Projects` covers `Projects/Alpha` but not
`Projectsish`, and never the top level, which is `""`. A rule on a field the graph does not have is
passed over, so a view outlives a field.

The default view colours by `kind`, groups by nothing, hides attachments and shows orphans. Those
defaults are the only field keys spelled on the page's side; `viewOf` reads a remembered view,
taking the default for whatever is missing or malformed. `"links"` is reserved: no field is keyed so.

## The model

`src/graph/model.ts` and `src/graph/palette.ts`. Pure: no DOM, no React, and **no object per
document** — every per-document answer is a typed array. Unit-tested in Node
(`test/graph-model.test.ts`), including a made-up field that it filters, colours and groups by, and a
check that neither file spells a field key.

- `read(wire)`: the wire as typed arrays — links as `src`/`dst`, each field's `of` or `start`/`items`,
  a value index by key, and each document's degree in the whole vault. A pair out of range is dropped;
  a newer `v` throws `GraphVersion`.
- `shown(graph, view)`: the visible subgraph, in name order. `from` and `index` map both ways, the
  links among what is shown, degree, CSR adjacency (`start`/`near`), and `byDegree`, most links first.
  *Orphans* is a document with no link in the whole vault, not one whose neighbours are hidden.
- `standingValue(field, rules, i)`: the value that stands for a document. For a `many` field it is the first
  of its values every rule on that field lets through, so a note tagged `#draft` and `#idea`, with
  `#draft` hidden, is coloured and grouped as `#idea`.
- `paletteOf(graph, key, own?)`: each value's **slot**, an index into `SLOT_TOKENS` (`slate`, `muted`,
  then `hues-<hue>` in `HUE_ORDER`) — a token name the renderer resolves as `--dag-color-<token>`,
  never a colour. A value's own hue (or one handed in `own`); slate for a `plain` value; else the ten
  hues no value owns, handed out from the commonest value down; the rest slate; "none" muted. Counted
  over the whole vault, so filtering does not re-colour what stays. **Kinds get their hues from the
  server's builder** (#459), not from the page: a note is `plain`, so the three quarters of a vault
  that are notes are the slate ground the other kinds stand out on, as in the design session's
  picture, and the page names no field to get there.
- `groupsOf(graph, shown, view)`: each shown document's group by a field's value, `-1` for none,
  numbered from the biggest group down, with the groups' keys, names and sizes. `null` for
  `"links"`, whose clusters come from the links (#458).

**Out, and why:** a local graph (`?around=<id>&depth=`), which comes with the local graph after the
page; fields that are not categorical (dates, numbers), for which `type` leaves room; an MCP tool or
a CLI command, since `refs` already answers what the graph is made of.

## The Graph page

`?graph=1`, from the sidebar's **Graph** row (after Calendar) and a document tab of its own
(`graph`, *The document tabs* in [`sidebar.md`](sidebar.md)). `src/ui/graph/`, fetched as a chunk of
its own through `chunks.tsx`: **the entry and `App.tsx` reach nothing of `src/graph/` or
`src/ui/graph/` through a static import**, and `test/graph-page.test.ts` walks the import graph to
hold it. The page is 49 kB, the simulation 10 kB and its worker 11 kB, minified.

| File | Owns |
|---|---|
| `GraphPage.tsx` | the data, the view, the memoised subgraph, slots and groups; makes one scene per mount and ends it on unmount; the keys |
| `scene.ts` | `GraphScene`: the camera, the frame loop, the pointer, the worker's messages; kept out of React |
| `gl.ts` | `Renderer`: WebGL 2, two programs, positions in a texture, `dispose` gives the context back |
| `labels.ts` | names and group names on a 2D canvas over the GL one, through an occupancy grid |
| `look.ts` | the theme read into the renderer's numbers: the palette from `SLOT_TOKENS`, the paper, the metrics |
| `Panel.tsx`, `Find.tsx` | the panel (colour, filter, layout) and *Find a file*; they name no field |
| `data.ts`, `saved.ts` | `/__board/graph` refreshed by the change feed; the view kept through `/api/graph-view` |
| `simLink.ts`, `sim.worker.ts`, `schedule.ts` | the simulation's host (#458) in a worker imported with `?worker`, on the page if a worker cannot start |
| `src/graph/legend.ts`, `src/graph/camera.ts` | the legend that is the filter, and the camera: pure, tested in Node |

### Drawing

**WebGL 2, two draw calls.** Positions are an `RG32F` texture 1,024 texels wide, uploaded once a
frame while the graph moves and never otherwise; a link is an instanced quad that reads both ends
from it and draws its own anti-aliased edge; a file is a point sprite drawn as a disc with a ring
of the paper's colour, so overlapping files stay apart. The camera is two uniforms: a pan or a zoom
uploads nothing. Hover is one byte per file in an `R8` texture and a fade uniform, so lighting a
file and its neighbours costs a 5,000-byte upload, not a redraw of the data. A file's size grows
with the square root of its links (`metric.graph.dot`, `dotGrow`, `dotMax`), and a dot grows less
than the zoom (`dotZoom`), so far out a file is still a dot.

**Every colour is the theme's.** The palette is a `vec3[16]` uniform resolved from `SLOT_TOKENS`
(slate, muted, the ten hues) through the theme; the paper, the accent and the links' colour and
opacity are theme tokens; every size that decides the look is `metric.graph.*`, the same in the
three themes. A file carries a slot, never a colour; a legend's dot is `var(--dag-color-<token>)`.
`neutral`'s ten hues are greys by that theme's design, so in it the kinds are told apart by size
and by the legend, not by colour.

**Names** are drawn on a 2D canvas above, by `labels.ts`: the hovered or found file and its
neighbours first, then the most linked, each only where a coarse grid says nothing is drawn yet
(at most 220), and only once a dot is big enough on screen (`metric.graph.labelFrom`). Zoomed out,
group names are drawn instead, at the group's middle, at most 40.

### At rest, nothing runs

The scene asks for a frame only while something moves: the simulation (asking the worker for
positions once a frame, as many as it draws), the camera easing, or the hover fading. When all
three are still it draws the last frame, marks the stage `data-dag-graph="rest"` and stops. There
is no timer, no drift and no idle animation. The worker stops itself at rest and says so; a hidden
window pauses it. Under reduced motion the graph is laid out without being shown moving: a frame
is drawn as it comes to rest, and while a file is held.

**Closed, nothing is left.** The scene makes its own GL canvas and takes it away in `end()`, which
ends the worker and calls `WEBGL_lose_context.loseContext()`: a context once lost stays lost on its
canvas, and React's strict mode mounts a page twice on the same element, so a canvas the page owned
came back dead on the second mount and drew nothing. The other pages unmount when their tab goes
behind, so a graph behind another tab holds no worker and no context. What is worth keeping —
each file's place and the camera — is kept with the tab (`useTabKeep`) and handed to the next scene,
so coming back costs no simulation. `e2e/graph.spec.ts` counts the workers and contexts.

### The pointer and the keys

A press on a file and a drag pins it under the pointer (the simulation pulls the rest after it);
let go, it is free again. A drag on the paper pans. A press without a drag opens the file, the way
a link does (`follow(hrefFor(id))`), so Back returns to the graph. **The wheel zooms** about the
pointer, unlike a board, whose wheel pans (*Getting around*): the graph has no up and down to
scroll through, and a trackpad's pinch is a wheel with Ctrl held, which zooms faster.

`F` fits the graph, `+`/`-` zoom, `0` is 100 %, `/` goes to *Find a file*, and Escape lets the
found file go. The zoom bar is the board's.

### The panel

**It names no field.** *Colour by* and *Group by* list whatever fields the route sent, by their
labels, so a field the server adds later appears with no change here (a made-up `mood` field is
offered in `test/graph-page.test.ts`).

- **The legend is the filter.** The values of the field the graph is coloured by, commonest first,
  with counts over the whole vault. A press hides a value or shows it again; *Only* keeps just that
  value, and *Only* on the value already alone shows them all. An *Only* stays an `only` rule when
  edited, so a value the vault gains later stays out; anything else is a `hide` list, so one gained
  later is shown. A rule that would hide every value, or none, is dropped (`legend.ts`).
- **A chip** stands for a rule on a field the legend is not showing, says how many values it lets
  through, and takes it off when pressed. A rule that leaves out no value this vault has — the
  default's hidden attachments, in a vault with none — has no chip.
- *Files with no links* shows or hides the orphans.
- **Layout:** four sliders — *Space between files*, *Link length*, *Link pull*, *Pull to the centre* —
  each a position either side of the design (0); `simForces` maps them to `4^v`, `3^v`, `4^v`, `6^v`.
  *Group by* is Nothing, *Linked clusters* or any field; *Group tightness* and *Space between
  groups* are on only while something is grouped. *Reset the layout* puts the sliders back and
  warms the graph enough to move.

A change of colour uploads one buffer and runs nothing. A filter hands the scene a new subgraph in
which every file that was drawn keeps its place (by id, so a file added to the vault does not shift
the rest) and a new one starts beside its neighbours, gently warmed. New forces or groups warm the
same files in the same places.

### Kept between visits

The view is kept per vault in the app's home through `GET`/`PUT /api/graph-view`
(`graph-view:<vault>`, as `tabs:<vault>` is, moved with the vault when it takes another id; 32 kB at
most), or in `localStorage` when the build carries no server-backed settings. It is read leniently
(`viewOf`), so a view an older page kept still opens. Positions are not kept between launches:
that is a later issue.

### The data

`useGraphData` asks `/__board/graph` once and again after the change feed says a document, a file,
the listing or the tags changed, waiting 800 ms after the first change so a burst is one request.
An answer identical to the last changes nothing; a newer wire `v` shows *This page is older than the
server*. With no WebGL 2 the page says so, and so it does for an empty vault and a filter that leaves
nothing (with *Show every file*).
