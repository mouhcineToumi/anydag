# `gitgraph` — branches and what landed

    commit "scaffold"
    branch dialects
    commit "tokenizer and IR"
    checkout main
    commit "aspect-ratio fix"
    merge dialects "v0.2"
    tag "shipped"

Mermaid's verbs: `commit` `branch` `checkout` (or `switch`) `merge` `tag`. A merge lands on the
branch you are on and keeps both parents, which is the whole point of the diagram. A branch is a
lane, named in the margin, and its hue colours its commits.
