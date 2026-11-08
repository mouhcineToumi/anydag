# `sketch` — shapes, where you put them

    group phone "Sign in" x=0 y=0 w=320 h=456 {
      text welcome "Welcome back" x=24 y=56 w=272
      input email "you@example.com" x=24 y=112 w=272
      input pw "Password" x=24 y=168 w=272
      button go "Continue" x=24 y=232 w=272
    }
    sticky todo "Ask what the button does before you draw it." x=384 y=0
    go --- todo

The twelve types that are laid out for you are grammars for a *kind of system*, and their whole
value is that you never say where anything goes (`chart`, the fourteenth, draws data and has no
placement to compute at all). This one is the opposite claim: **the coordinates are the drawing.** A
wireframe whose button ends up beside the field instead of under it is not a spacing defect, it is a
different picture — so nothing here is laid out, only snapped to the 8px grid.

Reach for it for a screen, a wireframe, a sticky wall, a whiteboard scribble — a **shape**: a
circle, a diamond, a cloud, a speech bubble, standing on the board with words in it and linked to
whatever it points at — or a **picture**: a person, a house, a book, a truck, with a caption under
it, for an illustration of how something happens rather than a diagram of what runs. Anything whose
shape is what somebody drew rather than what a system is. For a real diagram, use the type that
names the question it answers — a sketch of five boxes and four arrows is an `arch` with the
automatic layout switched off, and it will read worse than the `arch`.

## Wireframe parts

    box    <id> "<title>" ["<meta>"]     a rectangle
    text   <id> "<title>"                a line of text, no chrome
    button <id> "<title>"                a filled pill
    input  <id> "<placeholder>"          an outlined field
    img    <id> "<title>" ["<caption>"]  a placeholder with a diagonal cross
    sticky <id> "<title>" ["<meta>"]     a square of coloured paper
    ink    <id> pts="0,0 14,9 …"         a freehand stroke — see The pen, below

Every one takes `x=` `y=` `w=` `h=`, and everything else the shared grammar allows: `hue=`, the
status flags, a `group`. `w=` and `h=` *are* the box; leave them off and the shape takes the
theme's default size with a text-measured floor under it — a stroke excepted, whose box is its
points' bounds and whose `w=`/`h=` arrive only from a resize. A `box`, `text`, `button` or `input`
draws its title and meta on one line each, so a `w=` narrower than the words cuts them off at the
edge; the snapshot says so as `Q_TEXT_CLIPPED` naming the node. Widen `w=`, or leave it off.

A **sticky is ochre** unless you give it a `hue=`. Everything else is drawn in the theme's greys,
and a hue on a `box` colours its border — a colour here is something you asked for, not something
that fell out of which container a thing is in.

`img`'s caption is its `meta`, falling back to its title.

## The pen

    ink <id> pts="0,0 14,9 31,5 48,22 60,40" x=240 y=120

A stroke is what somebody drew with a pen, and it says nothing about a system. It has **no title** —
the shared grammar would let one be written and the renderer draws nothing for it — and its only
content is its line: a mark, not a card. The mark is `pts=`, a quoted, space-separated list of
whole-number `x,y` pairs **in the stroke's own space, normalised so its minimum is `0,0`**, with
`x=` and `y=` carrying where it sits. That split is the point of the whole shape: moving a stroke
rewrites two numbers and never the path. `w=` and `h=` are absent normally — the box is the points'
bounds — and when a resize writes them the path scales into the new box. A `hue=` colours the line,
the way it colours a shape's border.

An arrow into a stroke stops at its **bounding box** rather than tracing the line. That is
deliberate: `ink` is deliberately not one of the geometric kinds, whose outline a line meets,
because a hull that followed a squiggle would be the layout reading a drawing as geometry. And a
stroke joins nothing, which is why it is a kind and not a line: `a --- b` says two things are
joined, and no arrow grammar can say "somebody waved a pen here".

**You will almost never write one of these by hand, and should not try.** The pen is a pointer
gesture — the toolbar's pen, or `space` then `b`, then drag and let go — and each release writes one
of these statements itself, the pointer's samples already simplified, normalised and made whole.
The pen stays armed until Escape takes it off, so several strokes come out of one pickup.
Hand-authoring point lists is not the use: reach for a `text`, a shape or a `---` line, and let
the pen produce the strokes. A stroke standing alone in a fence is the item, exactly as a lone
shape is — its resize handles write its `w=`/`h=` and the path scales into them, and a link to the
item by its fence id lands on the stroke.

## Geometric shapes

    circle        <id> "<text>" ["<meta>"]    square by default; one side given, it stays round
    ellipse       <id> "<text>"               an oval
    triangle      <id> "<text>"               point up; the words sit in the wide part
    diamond       <id> "<text>"               a decision
    hexagon       <id> "<text>"               pointed left and right — a preparation step
    pentagon      <id> "<text>"
    octagon       <id> "<text>"               a stop sign
    star          <id> "<text>"
    parallelogram <id> "<text>"               input or output
    trapezoid     <id> "<text>"               a manual operation
    cylinder      <id> "<text>" ["<meta>"]    a store, drawn as a drum
    document      <id> "<text>"               a page with a wavy foot
    stadium       <id> "<text>"               an outlined pill — a start or an end
    cloud         <id> "<text>"               the internet, or anything somebody else runs
    callout       <id> "<text>"               a speech bubble
    arrow         <id> "<text>"               a block arrow, pointing right

The words are the title (and the meta, under it), **centred and wrapped inside the shape** — in the
part of it that can hold them, so a triangle's text sits in its base and a speech bubble's is clear
of its tail. They never size the shape: `w=` and `h=` are the box, and a sentence too long for it is
clipped, exactly as on a sticky. With neither given a circle, a triangle, a star, a pentagon and an
octagon are square and everything else is wider than tall; a circle given only `w=` is a circle,
and one given both is an ellipse.

Unhued, a shape is white with a grey outline, like a `box`. **With a `hue=` it fills with the hue's
tint** and outlines in the hue — the sticky's rule, because a coloured circle on a whiteboard is a
coloured circle.

**A line meets a shape at its outline**, not at the box around it: an arrow into a triangle's side
stops on the slanted side, one into a circle stops on the circle. That holds for `a --> b` inside the
sketch and for a board link in an `edges` fence (`shapes.db --> api.svc`).

A shape standing alone — a `sketch` fence holding that one shape and nothing else, which is what
the library drops — **is** the item on the board. Its handles size the shape (they write its `w=`/`h=`,
not the fence's), a double-click types its words in place, and a link to the item by its fence id
lands on the shape:

    ```sketch {#db x=0 y=0}
    cylinder store "Postgres" hue=indigo
    ```

    ```edges
    api.svc --> db
    ```

A drawing tool's word points at this one's: `rectangle` → `box`, `oval` → `ellipse`, `rhombus` →
`diamond`, `pill` → `stadium`, `bubble` → `callout`.

## Pictures

    figure <id> ["<caption>"] ["<meta>"] [icon=<picture>]

    figure buyer "Customer" icon=emoji:person x=0 y=0
    figure app "Orders on the app" icon=emoji:mobile-phone x=200 y=0
    figure parcel "Parcel" icon=emoji:package x=400 y=0
    figure van "Delivery" icon=emoji:delivery-truck x=600 y=0
    figure home "Home" icon=emoji:house x=800 y=0
    buyer --> app
    app --> parcel
    parcel --> van
    van --> home

A `figure` is a picture with its caption under it — the thing to reach for when you are
illustrating how something happens rather than diagramming what runs. **The caption is its title
and is optional**: with none the figure is the picture alone. A meta is a second, smaller line.

**The picture is `icon=`**, and any name the icon vocabulary has works:

| `icon=` | draws |
|---|---|
| *(none)* | a stick figure |
| `emoji:<name>` | an emoji in its own colours — `emoji:house`, `emoji:office-building`, `emoji:closed-book`, `emoji:delivery-truck`, `emoji:man-technologist` |
| `mono:emoji:<name>` | the same emoji drawn in one colour, the figure's `hue=` (or the ink) |
| `<lucide name>` | a line drawing in the ink or the hue — `house`, `user`, `users`, `laptop`, `truck` |
| a brand | the logo — `postgresql`, `aws:lambda` |

The emoji are all of Unicode's, by their short name with hyphens (`emoji:money-bag`,
`emoji:light-bulb`, `emoji:globe-with-meridians`) — about 1,600, from people and places to food,
animals, tools and symbols. `/__board/icons?q=emoji:truck` (the `icons` tool)
lists the names; the library's *Objects* section has every one as a picture to drop. A name that
does not exist warns `W_UNKNOWN_ICON` with the near one, and draws the stick figure.

**It sizes itself** — a 64px picture, and a caption that runs as wide as it needs up to 160px and
then wraps, never breaking a word. Given `w=` alone the picture grows to that width; given `h=`
alone, to that height; given both, the picture is the largest square the box holds over its
caption. `hue=` colours a line drawing or a `mono:` emoji and leaves a colour emoji alone.

**A line meets the picture**, not the box around the caption: an arrow from the left stops at the
phone even when "Orders on the app" is twice as wide as it.

A word that is a picture written where the kind goes — `house home "Home"` — is `E_UNKNOWN_KIND`
naming the figure that draws it: `figure home "…" icon=emoji:house`.

## Containers

    group phone "Sign in" x=0 y=0 w=320 h=480 { ... }
    frame win "Browser" x=0 y=0 w=800 h=600 { ... }

`group` and `frame` are the same statement — a phone frame, a browser window, a card. It carries its
own `x= y= w= h=` and **its children are written relative to it**, so moving the screen is one edit
rather than twelve. Declared too small for what is inside it, it grows: a container that clips its
own contents is never what anyone meant.

A container here takes **no automatic hue**, unlike every other dialect's groups. It is scenery
somebody drew, not a domain.

## Lines

    a --- b            a line, no head
    a --> b "signs in"  an arrow with a label

The shared arrow table, unchanged. `---` is the one you usually want: a line between two shapes on a
wireframe is a connection, not a direction.

## Positions

    x= y=    where, relative to the container (0,0 is its top-left)
    w= h=    how big

Snapped to 8. **The frame hugs the drawing**: whatever is top-left-most is drawn at the frame's
corner, whether its coordinates are negative, zero or `480`. So the numbers say the drawing's
*shape* — how far things are from each other — and the fence's own `x=`/`y=` says where it stands
on the board. Start a drawing at `0,0` and nothing about that distinction ever shows. Anything with
no `x=` or `y=` is put in a reading-order grid *below* everything that has one, so a shape dropped
from the library never lands on top of the last one.

## `layout=fixed` — the other half

Any fence of the twelve laid-out types may say that its coordinates are the author's:

    ```arch {#detached layout=fixed}
    client web "Browser" icon=monitor x=0 y=0
    service api "API" "fastapi" icon=server x=280 y=80
    store db "Database" icon=database x=560 y=0
    web --> api
    api --> db
    ```

That is still an `arch`: the cards, the hues, the icons and the edges mean exactly what they always
meant, and only the placement changes hands. The five own-layout types (`flow`, `activity`,
`sequence`, `timeline`, `gitgraph`) accept it too, and it takes their axis away — a fixed `flow` has
no bands. A `chart` is the one type it says nothing to: there is no node in a chart to place, and
writing it there is read and then ignored.

**Outside a fixed fence, `x=` `y=` `h=` warn** (`W_UNKNOWN_ATTR`) and are read onto the node anyway,
so switching a fence over is a one-word edit rather than retyping every coordinate.

## What it will say when it is wrong

| code | means |
|---|---|
| `E_UNKNOWN_KIND` | the first word is not one of the shapes — the message lists them, or names the `figure` that draws the picture you wrote |
| `W_UNKNOWN_ICON` | a figure's `icon=` names no picture — the message has the near one |
| `E_EXPECTED_ID` | a shape with no id |
| `E_EXPECTED_VALUE` | `x=` with nothing after it, or a `pts=` that does not parse — pairs need a comma, whole numbers only |
| `E_EXPECTED_BRACE` | a `group` that never opened `{` |
| `E_DUPLICATE_ID` | two shapes with one id |
| `E_UNKNOWN_ID` | a line into something nothing declares |
| `W_UNKNOWN_ATTR` | a `key=` this dialect has no meaning for |
| `EB_BAD_LAYOUT` | `layout=` was not `fixed`, the only value there is |

## Drawing it

A `sketch` item resizes by its own box (`w=`/`h=` on the fence), not by `aspect` — there is nothing
for a shape to fold into — except when it holds one shape alone, where the handles size the shape
(and a lone stroke is the same case: the handles scale its path; a lone figure's scale its picture).
The Shapes section of the library (`L`) holds one of each, the sixteen geometric ones right after
Box, and a `Wireframe` starter made of them. The library holds no stroke: the pen is how ink is made.
The *Objects* section after it holds the pictures, on shelves — *Drawn* (line drawings, the stick
figure first), *Essentials*, then every emoji by what it is — and a double-click on a figure types
its caption where it is drawn; an empty one takes the caption off.
