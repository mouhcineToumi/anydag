---
title: AnyDag — first light
theme: paper
---

```md {#intro x=-152 y=-152 w=560}
# AnyDag

An infinite canvas Claude draws on. This board is a **file** — `boards/demo.board.md` — and the
page you are looking at is watching it. Edit the file, the board moves.

Markdown, images and diagrams share one plane; diagrams lay themselves out.
```

```note {#rules x=176 y=168 w=560}
**The rules the diagrams follow**

1. Colour belongs to the theme, never to the file.
2. A hue belongs to a group, and its outgoing edges carry it.
3. Status colour only ever means something — green done, amber a person, red stopped.
4. Boilerplate is drawn quieter than the model.
5. Dashed means the weaker half of a pair: a different clock, a return, an «include».
```

```md {#table x=640 y=-216 w=560}
## What draws what

| fence | draws |
|---|---|
| `md` | markdown, tables and images |
| `arch` | a system, and seven other graph dialects |
| `sequence` | messages in order; `timeline`, `gitgraph` |
| `chart` | bars, lines, pies and donuts |
```

```arch {#infra x=-152 y=848 title="What runs where" subtitle="Larkspur · a slice of it"}
group gcp "Google Cloud" "larkspur-prod · europe-west1" hue=indigo {
  group run "Cloud Run" hue=teal {
    service api "larkspur-api" "fastapi · uvicorn" icon=server {
      identity "verify the id token"
      content  "tracks · branches · nodes"
    }
  }
  group fb "Firebase" hue=spruce {
    store auth "Authentication" "google · email link" icon=key-round
    store fs   "Firestore" "larkspur-dev" icon=database
  }
}
client browser "Learner's browser" "react 19 · vite" icon=monitor

browser --> api "/api"
api.identity --> auth
api.content  --> fs
```

```md {#md-dsqh x=840 y=888}
New note
```

```edges {#edges-vb1v}
rules --> table
intro --> rules
```
