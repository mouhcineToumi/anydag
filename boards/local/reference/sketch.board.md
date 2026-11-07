---
title: AnyDag — the free canvas
---

```sketch {#login x=0 y=0 frame=none}
group phone "Sign in" x=0 y=0 w=320 h=456 {
  text welcome "Welcome back" x=24 y=56 w=272
  input email "you@example.com" x=24 y=112 w=272
  input pw "Password" x=24 y=168 w=272
  button go "Continue" x=24 y=232 w=272
  text forgot "Forgotten it?" x=24 y=296 w=272
}
group empty "Nothing yet" x=384 y=0 w=320 h=456 {
  img art "Art" "an illustration goes here" x=24 y=56 w=272 h=176
  text sorry "No sessions yet" x=24 y=256 w=272
  button start "Start one" x=24 y=304 w=272
}
go --> empty "signs in"
```

```sketch {#wall x=800 y=0 frame=none}
sticky one "Ask what the button does before you draw it." x=0 y=0
sticky two "The greys are the theme's, so this sits beside a diagram." x=200 y=0
sticky three "A hue is something you ask for." x=400 y=0 hue=teal
box legend "Everything on a sketch is where it was put." w=576 h=64
one --- legend
```

```arch {#detached x=0 y=568 layout=fixed title="Placed by hand" subtitle="An arch fence whose coordinates are the author's"}
client web "Browser" icon=monitor x=0 y=0
service api "API" "fastapi" icon=server x=280 y=80
store db "Database" icon=database x=560 y=0
web --> api
api --> db
```

```sketch {#shapes x=0 y=976 frame=none}
stadium begin "Start" x=0 y=0
parallelogram read "Read the file" x=192 y=0
diamond ok "Parses?" x=384 y=0
cylinder store "Board" "boards/*.md" x=576 y=0 hue=indigo
document report "Report" x=768 y=0
trapezoid manual "Manual step" x=960 y=0
arrow next "Next" x=1152 y=0 hue=moss
circle circ "Circle" x=0 y=160
ellipse oval "Ellipse" x=152 y=172
callout warn "Said in the dock, not on the board" x=384 y=160 hue=ochre
triangle tri "Triangle" x=576 y=160
hexagon hex "Prepare" x=728 y=172
pentagon pent "Pentagon" x=920 y=160
octagon stop "Stop" x=1072 y=160 hue=crimson
star star "Star" x=1224 y=160 hue=ochre
begin --> read
read --> ok
ok --> store "yes"
ok --> warn "no"
store --> read "read it again"
circ --- oval
tri --> hex
```

```sketch {#pen x=0 y=1448 frame=none}
ink tick pts="0,6 2,8 4,12 6,17 8,22 10,26 13,21 18,13 25,6 33,1 40,0" x=0 y=0
ink under pts="0,0 8,0 16,0 24,0 32,0 40,0 48,0 56,0 64,0 72,0 80,0 88,0" x=72 y=40
ink circ pts="14,0 21,2 26,6 28,12 27,18 23,24 17,27 10,27 4,23 1,17 0,10 2,4 7,1 12,1" x=176 y=0 hue=ochre
```

```sketch {#net x=960 y=568}
cloud web "The internet" hue=teal
```

```sketch {#mark x=304 y=1448}
ink squiggle pts="0,8 4,2 9,0 14,4 18,10 23,14 28,12 33,6 38,2 43,4 48,9 52,13"
```

```edges {#links}
net --> shapes.store "writes"
pen.circ --> mark.squiggle "annotates"
```

```md {#why x=800 y=360 w=576}
**A `sketch` is the geometry you wrote.** `layout=fixed` says the same thing about any of the other
twelve, which is what the `arch` below is: three ordinary cards, with hues, icons and edges that
mean exactly what they always meant, that nothing re-places.

Outside a fixed fence an `x=` is a `W_UNKNOWN_ATTR`. The layout owns the coordinates there, and a
value that is read, kept and then ignored is worse than one that is refused.
```
