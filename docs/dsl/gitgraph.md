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

On the canvas, none of it needs typing: with the graph selected, a `+` past a branch's tip commits
on it (writing the `checkout`), **+ New branch** starts one off the picked commit or the current
tip, a click on a branch's name renames it everywhere, and a branch's tip dragged onto another lane
merges it there. A picked commit's panel sets its message and tag and swaps it with a neighbour
where the history allows.
