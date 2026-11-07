---
title: Larkspur — clearing a node
---

```sequence {#attempt title="Clearing a node" subtitle="Larkspur · one attempt, from the tap to the written progress"}
participant learner "Learner" "signed in" kind=person hue=violet
participant web "larkspur-web" "react 19" icon=layout hue=teal
participant api "larkspur-api" "fastapi" icon=server hue=teal
participant auth "Firebase Auth" "admin sdk" icon=key-round hue=spruce
participant store "Firestore" "larkspur-dev" icon=database hue=spruce

learner ->> web : "submit an answer"
activate web
web ->> api : `POST /attempt · id token`
activate api
api ->> auth : "verify the token"
auth -->> api : `uid`

alt "the answer is correct"
  api ->> store : `write progress · cleared`
  store -->> api : `ok`
  api -->> web : `201 · node cleared`
else "it is wrong"
  api -->> web : `200 · not yet`
end

deactivate api
web -->> learner : "render the result"
deactivate web

legend solid "a call, and what comes back"
```
