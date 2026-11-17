# The graph view

> The vault drawn as a graph (#262): the route that describes it, its fields, and the view model.
> The simulation and the page are added by #458 and #459.

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
