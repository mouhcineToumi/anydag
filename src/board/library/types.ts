import type { AttrValue } from "../attrs";
import type { ItemType } from "../types";

/**
 * What a ready-made thing is, and what it is made of.
 *
 * The library used to be a flat list of hand-written strings: the same "service card" idea typed
 * out in the `arch` template, again in two starters, and again as a droppable part. Nothing was
 * built from anything, so the ready-mades could not be taken apart and nothing a person built could
 * go back in. A blueprint is the same data with one thing added — it may be **composed of other
 * blueprints** — and that is the whole of the mechanism.
 *
 * Five layers, and the layer is a claim about what the thing is, not a folder:
 *
 * | Layer | Is | Example |
 * |---|---|---|
 * | 0 | one statement, introducing at most one id | `service ${self} "…"` |
 * | 1 | a container with something in it, or a node with rows | `group … { service … }` |
 * | 2 | several of those, wired together | a client calling an API calling a store |
 * | 3 | one whole board item | the `arch` template, a note |
 * | 4 | several board items | what "save as a component" makes |
 *
 * **Three composition algebras, because there are three kinds of grammar.** In `arch`, `erd`, `state`,
 * `flow`, `activity`, `class`, `usecase` and `c4`, a container is a brace and composition is
 * nesting. In `sequence`, `timeline`, `gitgraph` and `mindmap` position carries the meaning — a
 * sequence's messages *are* its wiring and `activate` sits between two of them, a timeline
 * `section` owns everything until the next one, `branch` mutates an ambient HEAD — so composition
 * is ordered concatenation of fragments that close after themselves. `parts` is an **ordered** list
 * for exactly that reason: a children-slot plus a wiring block fits the first eight dialects and
 * cannot express the next four. `sketch` is the third: coordinates carry the meaning, so a part is
 * placed rather than nested or sequenced, and its children are relative to the `group` that holds
 * them (see `CLAUDE.md` → *The free canvas*).
 *
 * **Browser-free and alias-free**, like everything else in `src/board/`: the Vite plugin can reach
 * this folder, and it loads in plain Node before Vite's `@/` aliases exist.
 */

export type Layer = 0 | 1 | 2 | 3 | 4;

/** A literal line of the dialect, or an instance of another blueprint. */
export type Part = string | Use;

interface Use {
  /** The blueprint's id. */
  use: string;
  /** A name for it, so a literal part elsewhere can write `${name}` and get its id. */
  as?: string;
  props?: Record<string, string>;
  /** Replaces the blueprint's own parts — how one lane gets two steps instead of one. */
  parts?: Part[];
}

export interface Blueprint {
  id: string;
  name: string;
  description: string;
  /** A key of the explicit `ICONS` map in `src/edit/Library.tsx`; `check:library` proves it. */
  icon: string;
  layer: Layer;
  /** The dialect it speaks — for a fragment, the diagram type it can join. */
  type: ItemType;
  /**
   * The id this introduces, and the base an allocated one is numbered from.
   *
   * **Only a declaration gets one.** A row, a field and a class member are text inside their node's
   * `source`, never a slot: three entities each carrying `id uuid pk` are three columns called
   * `id`, and an allocator that saw them as declarations would rename two of them.
   */
  slot?: string;
  /**
   * Grammatical only inside another blueprint's braces — a port row, a class member.
   *
   * It is still an atom, and still the thing the layer above is made of; it just cannot be dropped
   * on a diagram by itself, because a row outside a node is not a statement. The panel shows it
   * when its parent is expanded and nowhere else.
   */
  inner?: boolean;
  /** A leaf: the dialect's own text, with `${self}`, `${children}`, `${prop}` and `${?prop}` holes. */
  source?: string;
  /** A composition, in order. With a `source`, they land in its `${children}`; without, they are it. */
  parts?: Part[];
  props?: Record<string, string>;
  /** Fence attributes for a whole item: `note`, `w`, `title`, `aspect`. */
  attrs?: Record<string, AttrValue>;
  /**
   * For a leaf that is authored prose rather than a composition: what it is made of anyway.
   *
   * A few things read better written out than assembled — a starter whose value *is* its specific
   * column lists and branch labels. The panel still shows their ladder, and can still hand you the
   * parts, without the source turning into four times the punctuation to say the same thing.
   */
  madeOf?: string[];
  /**
   * Set when a person saved this off a board rather than it being written here.
   *
   * Its `source` is the literal text they selected, so it is dropped by renaming what collides
   * rather than by filling holes, and `text` is the whole component board — which is what a stack
   * of several items is stamped from.
   */
  saved?: { board: string; text: string; items: number };
  /**
   * A ready-made node that already wears a brand mark — a store whose default is postgres.
   *
   * Structurally it is nothing new: one statement of its dialect, a `Use` of an atom above it with
   * different props. What makes it a different kind of entry is what a person reaches for — the
   * technology, not a kind of system — so `categoryOf` sends these to a section of their own ahead
   * of the composition ladder, the way it sends `sketch` and `chart` to theirs.
   */
  brand?: boolean;
  /**
   * The shelf an *Objects* entry sits on — "Drawn", "Essentials", "People", ….
   *
   * An object is one `figure` statement with a picture, which structurally is exactly a `sketch`
   * atom; what makes it a different kind of entry is the same thing that makes a brand node one —
   * a person reaches for *a house*, not for a layer — and there are fifteen hundred of them, which is
   * a section that needs shelves of its own. `categoryOf` sends anything with a shelf to *Objects*.
   */
  shelf?: string;
  /**
   * The `icon=` value the figure wears, `""` for the stick figure — what the panel draws on the tile.
   * Read off the blueprint rather than out of its rendered text so a grid of fifteen hundred tiles
   * never renders fifteen hundred blueprints to find out what to draw.
   */
  picture?: string;
}
