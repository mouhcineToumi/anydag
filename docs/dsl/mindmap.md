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
