---
title: AnyDag — how it was built
---

```gitgraph {#history title="How AnyDag got built" subtitle="Branches, and what landed on each"}
commit "scaffold"
commit "canvas + board file"
branch dialects
commit "tokenizer and IR"
commit "arch, erd, state"
commit "flow lanes"
checkout main
commit "aspect-ratio fix"
merge dialects "v0.2"
branch sequence
commit "lifelines"
commit "fragments"
checkout main
merge sequence "v0.3"
commit "the neutral theme"
```
