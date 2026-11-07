# The rules

Nine rules the diagrams follow. They came out of hand-drawing ten boards and noticing what made
some of them read and others not. Several are enforced in code; the rest are yours to keep.

### 1. Emphasis belongs to the reader, not the author
There is no way to mark "the subject", and that is deliberate. The accent now rings whichever card
the pointer is over, so emphasis follows whoever is reading instead of whoever wrote the board.
`focus` and `current` still parse — they warn `W_RETIRED_FLAG`, do nothing, and the diagram draws —
so an older board is not broken, but do not write them. The old rule asked one mark to mean "the
subject" in eight dialects and "where this record sits" in `state`, and one mark cannot carry two
meanings.

### 2. A hue belongs to a group, and its edges carry it
Never put a hue on a node to make it stand out. Put it on the group; every node and every outgoing
edge inherits it. **Enforced.** A group with no `hue=` gets the next one in the theme's order, so a
diagram is legible without naming a single colour.

### 3. Status colour only ever means something
`done` green · `wait` amber, meaning a person has to act · `stop` red, meaning the run ends here ·
`muted` grey, meaning it ended without the outcome. Never for emphasis. An edge into a `stop` node
is recoloured danger automatically — **the colour only**. It is not dashed, and should not be: dash
already means something else on these diagrams (deploy-time, async, a reference rather than a call),
and one mark cannot carry two meanings. Write `-.->` yourself if you want both.

### 4. Boilerplate is drawn quieter than the model
Multi-tenancy touches every table; drawn as one edge per table it buries the model. Mark it `quiet`
and point it at the **group**: `workspace ||--o{ intake "workspace_id" quiet`.

### 5. Dashed means the weaker half of a pair
A different clock (deploy time, index time), a return message, an `«include»`. Not "less important".

### 6. A dependency two paths share becomes a node; one caller keeps it in the card
Two services calling one model — that model is a node. One service calling a model — that is the
service's mono meta line. This is what stops an architecture diagram becoming a hairball.

### 7. Architecture draws nouns; workflow draws verbs
"Ingest worker", "Vector index", "Ask API" — not "Extract", "Chunk", "Embed". The steps become the
component's rows.

### 8. In an architecture diagram the icon carries the kind
`service` `store` `db` `client` `person` `queue` `external` `container` each get their own glyph;
a client or a person gets a round tile. Uniform boxes are what makes an architecture diagram read
as a data model.

Name a **technology** — `icon=postgresql`, `icon=aws:lambda`, `icon=docker` — where which technology
it is, is the point: a reader recognises a logo they already know faster than they read a label.
Keep the kind's glyph where the technology is incidental or unchosen ("Ingest worker", "Vector
index"). A brand icon draws in its own colours on a neutral tile and moves the hue to the card
border, so don't reach for one on every node — a board where every card is a logo has lost the
grouping the hue was carrying. `icon=mono:postgresql` is the middle setting: the brand, still
wearing the group's hue.

### 9. A row is a port — its edge leaves from it
`api.content --> firestore` leaves from the `content` row, not from the middle of the card. Declare
what a component depends on as rows and address them.

## And two habits

- **Elide.** `+18` renders "18 more columns". Show the five columns that matter.
- **The legend explains encodings, never content.** `legend dashed "runs on a different clock"` —
  a crow's foot needs no legend entry.
