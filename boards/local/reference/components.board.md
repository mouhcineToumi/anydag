---
title: Components and links
theme: paper
---

```usecase {#recruiter x=0 y=0}
actor recruiter "Recruiter"
```

```arch {#cv x=0 y=200}
service cv "CV parser" "mistral ocr" icon=server
```

```arch {#bucket x=0 y=400}
store bucket "Dossiers" "minio" icon=database
```

```arch {#stack x=560 y=0 title="What runs where"}
client web "Browser" "react · vite" icon=monitor

group cloud "Cloud" hue=indigo {
  service api "API" "fastapi · uvicorn" icon=server {
    auth    "verify the token"
    content "read and write"
  }
  store db "Database" "postgres" icon=database
}

web --> api "https"
api.content --> db
```

```edges {#links}
recruiter --> stack.web "signs in"
recruiter --> cv "uploads a CV"
cv --> bucket "anonymises"
cv -.-> stack.api "notifies" quiet
bucket --> stack.db hue=teal
cv --> stack
```

```md {#about x=560 y=560 w=520 note}
**Three components and a diagram.**

The actor, the parser and the store are single nodes standing on the paper: no header, no type
chip, nothing above them naming what the card already says. Each is still a node of its own
family — the actor is a use case actor and draws like one.

The links are board-level, in the `edges` fence. Three of them end *inside* the diagram, on
`stack.web`, `stack.api` and `stack.db`. A link with business inside a frame is let through it and
lands on the card itself, threading between the diagram's other cards rather than over them.
```
