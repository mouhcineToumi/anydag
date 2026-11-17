# `timeline` — what happens when

    section "Foundations"
    2026-09-01 .. 2026-09-06 "Canvas and the board file" done
    2026-09-06 .. 2026-09-13 "The arch pipeline" done
    section "Every dialect"
    2026-09-13 .. 2026-10-04 "Eight graph dialects"
    2026-10-18 "A one-day thing"

`YYYY`, `YYYY-MM` or `YYYY-MM-DD`; `..` makes it a range. **x is linear in real days**, so three
things in one week and one a year later do not look evenly spaced. Entries pack into rows to avoid
overlapping. A section is drawn as a labelled rule over the stretch it covers.
A range's end must not come before its start: that entry is `E_BAD_DATE` at the end's line:col and
is not drawn, because a bar that runs backwards has no place on the axis.
Flags: `done` `wait`.

A date must exist on the calendar: `2026-02-30`, `2026-04-31` and month `00` or `13` are
`E_BAD_DATE` at the date's line:col, and the entry is not drawn. February has 29 days in a leap
year — `2024-02-29` is a day, `2023-02-29` is not.
