# `sequence` — one conversation, in order

    participant learner "Learner" "signed in" kind=person hue=violet
    participant api "larkspur-api" "fastapi" icon=server hue=teal

    learner ->> web : "submit an answer"
    activate web
    web ->> api : `POST /attempt · id token`

    alt "the answer is correct"
      api -->> web : `201 · node cleared`
    else "it is wrong"
      api -->> web : `200 · not yet`
    end
    deactivate web

A participant takes `icon=` and `hue=` like any node, `aws:sqs` included.
Arrows: `->>` a call · `-->>` a return (dashed) · `->` no head · `-)` async.
Fragments: `alt` / `else`, `opt`, `loop`, `par` / `and`, each closed by `end`. They nest.
`activate` / `deactivate` draw the busy bar; Mermaid's `+` / `-` suffix works too.
A participant used but never declared gets a column where it was first mentioned.
