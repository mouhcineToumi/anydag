# `edges` — the links between items

    ```edges {#links}
    recruiter --> stack.web "signs in"
    recruiter --> cv "uploads a CV"
    cv --> bucket "anonymises"
    cv -.-> stack.api "notifies" quiet
    bucket --> stack.db hue=teal
    ```

**A person draws these with the mouse**: select an item, drag from one of the four round handles on
its sides, and let go on another item or on a card inside a diagram. That writes one statement here.
Clicking a line picks it and Delete takes its statement out; a picked line also grows a handle at
its middle, which bends it. Everything below is the same thing in text, which is how Claude writes
them.

Not a diagram type. An `edges` fence holds the links between the *items* on a board, and it is the
one place a line can join two things that belong to different families — an actor from a use case
diagram to a service from an architecture one. No dialect owns both words, so no dialect can own
the line between them.

The fence draws nothing itself and takes no position. Several of them on one board are all read,
in file order.

## Endpoints

    a --> b            item to item
    a --> d.db         item to a node inside diagram `d`
    d.web --> d2.api   between two nodes in two diagrams

`a` alone means the item's whole box — which for a component *is* the node. `d.db` anchors on `d`'s
frame **level with `db`**, not on the card: a line from outside a diagram to a card inside it would
cross the diagram's own contents to get there. Coming in from above or below there is no height to
be level with, so the anchor falls back to the side's fan.

The split is on the last `.`, and an item whose id contains a dot wins over it.

## Statements

    a --> b --> c      a chain: two links
    a & b --> c        two sources, one target: two links
    a --> b "label"    a label
    a --> b "label" "HTTPS"   and a second string under it, as C4's technology chip is
    a --> b: "label"   Mermaid's spelling of the same
    a --> b hue=teal   its own hue, never an endpoint's — an item has none to inherit
    a --> b quiet      a lighter line
    a --> b via="320,180"   bend it through a point

Arrows are the shared vocabulary: `-->` `->` `-.->` `..>` `<->` `-.-` `---` `--` `..`, and the UML
and sequence heads besides. Each carries its own dash, head and tail.

The second string follows the label, so it is only drawn under one: with no label to hold its
place, write `""`. A person sets it in the panel on a picked link; both strings are the hop's own.

A label and the modifiers belong to the **hop** just written, not to the statement, so each arrow
of a chain takes its own: `a --> b via="10,20" --> c via="30,40"`.

## Bending a line

    a --> b via="320,180"

The line is drawn through that point, in board coordinates — the same coordinates `x=` and `y=` use
on a fence line. It is the author's answer rather than the router's, so a line that carries one
stops bowing around whatever was in its way: somebody has said where it goes.

**A person drags it**: click the line to pick it, and a round handle appears at its middle. Pull the
handle and the curve follows it; double-click the handle and the bend comes off.

One point, and only on a board link. Two points would be a polyline, and a polyline through points
placed by hand is a drawing rather than a line between two things — which is what `sketch` is for. A
diagram's own edges take none at all: those run between cards ELK placed, so a point pinned between
two of them is a claim the next relayout would make false.

`via=` is quoted, always. A comma is punctuation to the parser, so `via=320,180` reads as a value
that ends at the comma. Anything that is not exactly one `x,y` pair is dropped with a `WB_BAD_VIA`
warning and the line is drawn straight.

## What it will say when it is wrong

| code | means |
|---|---|
| `EB_LINK_SYNTAX` | the statement is not a link |
| `EB_LINK_UNKNOWN_ITEM` | nothing on this page has that id |
| `EB_LINK_UNKNOWN_NODE` | the item is a diagram, and it declares no such node |
| `WB_BAD_VIA` | `via=` was not one `x,y` pair; the bend is dropped and the line drawn straight |

A link with one end that does not resolve is drawn hanging: from the end it has to a small dashed
circle, which a person drags onto something to point the link there, or clicks to pick and delete.
The diagnostic still names the fence's line, and nothing is written until somebody acts. A link with
**both** ends unresolved has nothing to hang from and is not drawn; the diagnostic is the report.

Deleting an item takes every link that named it, or a card inside it, in the same write — from the
canvas, a `remove` op over MCP (`board_patch`) — so an `EB_LINK_UNKNOWN_ITEM` means a link was written to
something that was never there, not that something was deleted.

## Bare nodes

A link is most useful between **bare nodes**: a diagram with no header, no type chip and no rule. A
header is something the author asks for — a `title=`, a `subtitle=`, or `frame=full` — so anything
without either draws bare, whatever it holds and whatever type it is: an atom dropped from the
library, a whole diagram nobody has named yet, even a `mindmap` or a `sequence`.

    ```arch {#cv x=0 y=200}
    service cv "CV parser" "mistral ocr" icon=server
    ```

`frame=full` puts a header on anything, titled or not; `frame=none` takes it off anything, titled
or not.

## An item's own hue

`hue=` on a fence line is not a diagram concept — it is one of the ten `HUE_ORDER` names, worn by
the *item itself* rather than by anything drawn inside it:

    ```md {#risks hue=coral}
    Auth is still on the old token format.
    ```

    ```md {#tip hue=ochre note}
    Drag from the round handles to link two items.
    ```

    ```image {#before hue=teal src=demo.assets/before.png}
    Before the migration
    ```

A hued `note` wears its tint as its fill; a hued plain `md` gets a quiet rule down its left edge
instead, so the two don't double up on the same idea. A hued `image` wears it on its border and its
caption. A diagram item may carry a `hue=` too — nothing draws it yet, but it parses and round-trips
like any other attribute. An unrecognised name warns (`WB_BAD_HUE`) and is dropped; the item draws
exactly as if it had none.
