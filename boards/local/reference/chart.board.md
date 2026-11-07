---
title: AnyDag — charts
---

```chart {#quarters x=0 y=0 w=560 h=420 title="Revenue by quarter" subtitle="Two channels, four quarters"}
bar
x Q1 Q2 Q3 Q4
series web "Web" 120 140 160 180
series mob "Mobile" 40 60 90 130
unit "k"
```

```chart {#hours x=640 y=0 w=560 h=420 title="Where the hours went" subtitle="Stacked, and turned on its side"}
bar stacked horizontal
x Backend Frontend Platform
series plan "Planning" 8 6 4
series build "Building" 24 18 10
series fix "Fixing" 6 9 12
values
```

```chart {#latency x=0 y=504 w=560 h=420 title="p95 latency" subtitle="A week, with Thursday's reading missing"}
line
x Mon Tue Wed Thu Fri Sat Sun
series api "API" 120 118 131 - 127 119 122
series web "Web" 92 95 88 91 89 90 87
series job "Jobs" 210 198 205 212 201 195 190
unit "ms"
min 60
```

```chart {#sources x=640 y=504 w=560 h=420 title="Signup sources" subtitle="Five of them, and the tail is its own slice"}
pie
slice organic "Organic" 42
slice referral "Referral" 23
slice paid "Paid" 18
slice social "Social" 11
slice other "Other" 6
```

```chart {#plans x=0 y=1008 w=560 h=420 title="Monthly active users" subtitle="A hero in the hole"}
donut "1.2M" "users"
slice free "Free" 62
slice pro "Pro" 28
slice team "Team" 10
```

```chart {#load x=640 y=1008 w=280 h=180}
bar
x Mon Wed Fri
series hits "Requests" 12 30 21
```

```md {#why x=1000 y=1008 w=280 note}
**A chart with no title is drawn bare**, like anything else on the paper: no header, no type chip,
no rule. One series draws no legend either — there is nothing to tell apart.
```
