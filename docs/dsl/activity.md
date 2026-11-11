# `activity` — what happens at the same time

    lane recruiter "Recruiter" hue=ochre { action publish "Publish this dossier" "POST /dossiers" }
    lane hunteros "HunterOS" hue=teal {
      decision enough "Enough credits?"
      fork f1
      action html "Render the HTML" "jinja"
      action pdf  "Render the PDF" "weasyprint"
      join j1
      action ready "Mark it ready" "status = \"ready\""
    }

    [*] --> publish --> enough
    enough --> f1 "yes"
    f1 --> html & pdf
    html & pdf --> j1
    j1 --> ready --> [*]

`start <id>` and `end <id>` declare the filled dot and the ringed one with an id, the way `fork f1`
declares a bar — `[*]` inside an edge still draws the same two, one per mention. They take no text.

`fork` and `join` are solid ink bars that stretch to span their branches — the one place ink is a
fill rather than a text colour.

A loop back — `retry --> check` after `check --> fix "no"` — lands the loop's body after the
decision it returns to; write it, do not unroll it.
