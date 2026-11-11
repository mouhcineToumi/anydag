# `mindmap` — a tree, written as indentation

    root AnyDag
      Structure
        Data model
        Class
      Behaviour
        Workflow
        State

No quotes, no ids — the indentation is the grammar. Mermaid's `((root))` and `(branch)` wrappers are
accepted and stripped. Each first-level branch takes its own hue and passes it to everything under
it, so a subtree reads as a family.

On the canvas you never need to type the indentation: pick a topic, then `Tab` adds a child, `Enter`
a sibling, `Shift`+`Tab` moves it out a level and `Alt`+`↑`/`↓` moves it past a sibling; the panel has
Indent, Outdent and Make root (which re-hangs the whole tree from that topic).
