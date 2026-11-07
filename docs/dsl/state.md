# `state` — the values a field can hold

    state new       "New"       "stage = \"new\""
    state screening "Screening" "stage = \"screening\""
    state hired     "Hired"     "stage = \"hired\"" done
    state rejected  "Rejected"  "stage = \"rejected\"" muted

    [*] --> new
    new --> screening "shortlist"
    screening --> screening "re-screen"
    new & screening --> rejected "reject" quiet
    rejected --> [*]

The second string is the stored value, in mono — this is a diagram about data. Self-loops arc above
the card. Several states leaving to one place (`a & b --> c "reject"`) are drawn as one family:
one line each, converging, with the label written once. Each `[*]` is its own pseudostate, so
three ways to end draw three.
