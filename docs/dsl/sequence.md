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
    note over web, api : "the attempt is stored either way"
    deactivate web

A participant takes `icon=` and `hue=` like any node, `aws:sqs` included.
Arrows: `->>` a call · `-->>` a return (dashed) · `->` no head · `-)` async.
Fragments: `alt` / `else`, `opt`, `loop`, `par` / `and`, each closed by `end`. They nest.
`activate` / `deactivate` draw the busy bar; Mermaid's `+` / `-` works too, written on the target:
`a ->> +b` starts `b`'s bar, `b -->> -a` ends the sender's (`b`'s). Mermaid cannot put both on one
message, so one that starts the receiver's bar and ends the sender's is two lines:

    web ->> +api : "hand off"
    deactivate web

The canvas panel shows them as one message with both boxes ticked. The old one-line `a ->> +b - : "x"` still reads.
`note over a : "text"` or `note over a, b : "text"` draws a note across those columns.
A participant is `participant` or `actor`; `kind=store`, `db`, `client` or `external` changes its card.
A participant used but never declared gets a column where it was first mentioned.
