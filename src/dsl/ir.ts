import type { Code } from "./codes";
import type { InkPoint } from "./ink";

/**
 * The intermediate representation every parser emits and every layout consumes.
 *
 * One IR for twelve dialects is the point: an ER entity and a C4 container differ in which fields
 * they fill, not in shape, so sizing, ELK, routing and the edge renderer are written once. The
 * dialects are grammar; this is the model.
 *
 * Nothing here is a colour or a pixel. A node carries a *hue name* the theme resolves and a *kind*
 * the theme maps to an icon; if a parser ever wanted to say `#3B5BC0` there would be no field for it.
 */

export type DiagramType =
  | "erd"
  | "flow"
  | "arch"
  | "state"
  | "activity"
  | "class"
  | "usecase"
  | "c4"
  | "mindmap"
  | "timeline"
  | "gitgraph"
  /**
   * The free canvas. Not a grammar for a *kind* of system — a vocabulary of shapes whose
   * positions are the author's, which is why it is the one dialect with no automatic layout.
   */
  | "sketch";

/**
 * The fence types whose model is **not** a `Graph`, and which are therefore absent from
 * `DiagramType` above.
 *
 * `sequence` has been one since M2 — two messages between the same pair are two moments, not one
 * relationship drawn twice — and `chart` is the second: a bar is not a node and a series is not a
 * group, and forcing either into `Graph` would put chart cases into `size.ts`, `NodeView`, ELK's
 * config, `scoreGraph` and `finalize()` for nothing they need.
 *
 * It exists as a list because `sequence` was special-cased **by name in fifteen places**, and a
 * second literal beside each one is exactly how the sixteenth gets missed. Every guard that means
 * "this is not a `Graph`" asks `hasGraph()` in `parse.ts`, which reads this; `check-theme.mjs` and
 * `check-skill.mjs` read it out of this file by regex rather than appending a name by hand, the way
 * they already read `DiagramType` and `HUE_ORDER`.
 */
export const OWN_MODEL_TYPES = ["sequence", "chart"] as const;

/** A fence type with a model of its own: `sequence`'s moments, `chart`'s data. */
export type OwnModelType = (typeof OWN_MODEL_TYPES)[number];

/** A key of `theme.color.hues`. */
export type Hue = string;

/**
 * What a node's treatment means. At most one per node.
 *
 * There is no `focus` here any more. It marked "the subject of this diagram" with an accent ring,
 * and it was the one status that described the *author's* emphasis rather than a property of the
 * thing drawn — every other value is readable off the system itself. Emphasis now follows the
 * reader's mouse instead of being frozen into the file; see `.dag-node:hover` in `styles/nodes.css`.
 */
export const STATUSES = ["done", "wait", "stop", "muted"] as const;
export type Status = (typeof STATUSES)[number];

/**
 * The geometric shapes `sketch` draws.
 *
 * Kind words like every other, one-to-one with the kind, so the kind menu, `E_UNKNOWN_KIND` and the
 * renderer all read the same list. How each one is drawn and where an edge meets it is
 * `src/layout/shapes.ts`, which is the one file that knows what a triangle looks like.
 */
export const SHAPE_KINDS = [
  "circle",
  "ellipse",
  "triangle",
  "diamond",
  "hexagon",
  "pentagon",
  "octagon",
  "star",
  "parallelogram",
  "trapezoid",
  "cylinder",
  "document",
  "stadium",
  "cloud",
  "callout",
  "arrow",
] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

export type NodeKind =
  // structural
  | "entity"
  | "class"
  | "interface"
  | "abstract"
  | "enum"
  // runtime things
  | "service"
  | "store"
  | "db"
  | "client"
  | "queue"
  | "external"
  | "extsystem"
  | "container"
  | "person"
  | "actor"
  | "participant"
  // flow things
  | "step"
  | "action"
  | "decision"
  | "state"
  | "usecase"
  | "topic"
  | "commit"
  // pseudostates and bars
  | "start"
  | "end"
  | "fork"
  | "join"
  /* sketch: a vocabulary of shapes rather than of things. `line` is not here — a line with no
     head is an edge, and the shared arrow table already spells it `---`. */
  | "box"
  | "text"
  | "button"
  | "input"
  | "img"
  | "sticky"
  /**
   * The pen: a freehand stroke, `pts=` carrying the path and `x=`/`y=` the position.
   *
   * Deliberately **not** in `SHAPE_KINDS`: a shape's outline is the hull an edge casts its anchors
   * at, and an arrow into a spiral should stop at its box — one tracing the squiggle is a router
   * reading a scribble as geometry. `isShape("ink")` staying false is what makes the router fall
   * back to the rectangle, which is the honest hull for nothing in particular.
   */
  | "ink"
  /**
   * A picture with a caption under it: a person, a house, a book, a truck — whatever
   * `icon=` names, from the emoji (`emoji:house`, or `mono:emoji:house` in the hue), Lucide's line
   * glyphs, or the brand logos. With no `icon=` it is a stick figure, which is what the word means
   * when nobody says more. The caption is its title and is optional; its box is the picture plus
   * that caption (`layout/figure.ts`), and a line into one stops at that box like an `img`'s.
   */
  | "figure"
  | ShapeKind;

type RowKind = "field" | "port" | "attr" | "method" | "more";

export interface Row {
  id: string;
  name: string;
  /** The right-hand half: a type, a port's job, a method's return. */
  detail?: string;
  tags: ("pk" | "fk")[];
  /** Hue of the group this fk points at — the ERD colours the pill by its target's domain. */
  fkHue?: Hue;
  vis?: "+" | "-" | "#" | "~";
  kind: RowKind;
}

export interface Node {
  id: string;
  kind: NodeKind;
  title: string;
  meta?: string;
  /** C4's third string; the only kind that wraps to several lines. */
  desc?: string;
  stereotype?: string;
  rows: Row[];
  /** Class boxes split their rows into attribute and method compartments. */
  compartments?: Row[][];
  status?: Status;
  /** The mindmap's root topic, which is drawn a shade stronger. Structural, not emphasis. */
  root?: boolean;
  async?: boolean;
  external?: boolean;
  /** Emphasis on the node's own title, written as the bare flags `bold` / `italic`. */
  bold?: boolean;
  italic?: boolean;
  icon?: string;
  hue?: Hue;
  group?: string;
  lane?: string;
  /** Author override, `w=` in the DSL. */
  w?: number;
  /** Author override, `h=` in the DSL — a minimum height for every kind, the box for a sketch. */
  h?: number;
  /**
   * Where the author put it, `x=`/`y=` in the DSL, relative to its group.
   *
   * Only `sketch` and a `layout=fixed` fence honour these; everywhere else the layout owns the
   * coordinates and `modifiers()` warns `W_UNKNOWN_ATTR` rather than dropping them silently.
   */
  x?: number;
  y?: number;
  /**
   * A stroke's own path, `pts=` in the DSL — only an `ink` node carries one.
   *
   * Normalised so the minimum is `0,0`: the node's `x=`/`y=` carry the position, which is what
   * makes moving a stroke a two-number edit instead of a rewrite of every point. Like the
   * coordinates above it is the author's geometry — `modifiers()` warns `W_UNKNOWN_ATTR` outside a
   * `sketch` or `layout=fixed` fence, and a malformed list is an error, not a silent drop.
   */
  pts?: InkPoint[];
  /**
   * How far along the flow to keep this node, `col=` in the DSL.
   *
   * The one thing a person can say about an ELK layout that a coordinate cannot: not *where* the
   * card goes, but *how far along* it is. ELK's layered algorithm has no fixed node — the
   * `INTERACTIVE` strategies take a coordinate as a hint and hand back a card near it — and its
   * partitioning is the one placement constraint it honours exactly. Everything else stays ELK's,
   * which is what makes this an offer rather than a detachment.
   *
   * **A rank, not an index.** ELK constrains the partitions against each other and then compacts,
   * so a lone `col=4` on a three-card chain moves nothing: there is no other partition for it to
   * come after. It says "this card is not before that one" and does not say "this card is fourth
   * along". `test/layout.test.ts` holds both halves of that.
   */
  col?: number;
  line: number;
}

export type Marker = "none" | "chevron" | "open" | "crow" | "one" | "triangle" | "diamond" | "diamond-hollow";

export interface Ref {
  /** A node id, or a group id — an edge may land on a whole group (rule 4). */
  node: string;
  /** A row id, when the edge leaves or enters a specific port (rule 9). */
  row?: string;
}

export interface Edge {
  id: string;
  from: Ref;
  to: Ref;
  dash: boolean;
  quiet: boolean;
  head: Marker;
  tail: Marker;
  label?: string;
  /** C4's technology chip, on a second line under the verb. */
  label2?: string;
  /** Edges sharing a trunk id are drawn as one collector, not N lines. */
  bus?: string;
  /** Derived from the source's group; never written in the DSL. */
  hue?: Hue;
  /** Derived: an edge into a `stop` node. */
  danger?: boolean;
  line: number;
}

export interface Group {
  id: string;
  label: string;
  sublabel?: string;
  hue?: Hue;
  /** 0 for a top-level group; picks the fill out of `theme.color.groupFills`. */
  level: number;
  parent?: string;
  /** `system` is C4's and use case's boundary; it reads the same but means "the scope". */
  shape: "group" | "system";
  /** `dir=` on the group, when its members should run across the diagram's own direction. */
  dir?: "DOWN" | "RIGHT";
  /** A fixed container's own box — a phone frame, a window. Children are relative to `x`/`y`. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  line: number;
}

export interface Lane {
  id: string;
  label: string;
  hue?: Hue;
  line: number;
}

export interface LegendEntry {
  glyph: string;
  text: string;
}

/** The glyph words `Legend` draws, which is the whole of what `legend <glyph> "…"` can say. */
export const LEGEND_GLYPHS = ["solid", "dashed", "quiet", "external", "done", "wait", "stop", "port"] as const;

/**
 * Assignment order for anything that did not ask for a hue: groups, lanes, mindmap branches,
 * timeline sections, git branches.
 *
 * Names, never colours — a theme resolves each one, and `check-theme.mjs` fails if a theme is
 * missing any of them. It lives here rather than in the theme because *which* hue comes next is a
 * property of the diagram (a stable order, so two runs of the same board agree), while what that
 * hue looks like is a property of the theme. It was copied into four parsers before this; a fifth
 * copy is how one of them quietly starts assigning a different colour than the rest.
 */
export const HUE_ORDER: readonly Hue[] = [
  "indigo",
  "teal",
  "coral",
  "spruce",
  "ochre",
  "violet",
  "magenta",
  "moss",
  "crimson",
  "bronze",
];

export interface Diagnostic {
  line: number;
  col?: number;
  /** For a person. Reworded freely; never matched on. */
  message: string;
  /** For a program. See `dsl/codes.ts` — stable, and the thing a fix loop branches on. */
  code: Code;
  severity: "error" | "warn";
  /**
   * What the line declares, when it declares something that was drawn: the card, group, lane or
   * edge a person would pick to act on it. Set by `diagnoseBoard`, never by a parser — a parser
   * names a line, and which thing lives there is the parse's answer, asked once in `declaredOn`.
   * Absent for a statement that could not be read, which has no drawing to point at.
   */
  target?: DiagnosticTarget;
}

/** The thing a diagnostic concerns, as a pick names it. */
export interface DiagnosticTarget {
  what: "node" | "group" | "lane" | "edge";
  id: string;
}

export interface Graph {
  /** Discriminates `Graph` from `SequenceModel` wherever the two travel together. */
  kind: "graph";
  type: DiagramType;
  dir: "LR" | "TB" | "radial";
  /** Board-level override for the theme's wrap target. `0` turns wrapping off. */
  aspect?: number;
  /**
   * `layout=fixed` on the fence: the coordinates are the author's and nothing re-places them.
   *
   * It is a property of the *graph* rather than of the item because the parser needs it — the same
   * `x=` that is geometry inside a fixed fence is a mistake outside one, and `modifiers()` is where
   * that is decided.
   */
  layout?: "fixed";
  nodes: Node[];
  edges: Edge[];
  groups: Group[];
  lanes: Lane[];
  legend: LegendEntry[];
  diagnostics: Diagnostic[];
}

export const emptyGraph = (type: DiagramType, dir: Graph["dir"]): Graph => ({
  kind: "graph",
  type,
  dir,
  nodes: [],
  edges: [],
  groups: [],
  lanes: [],
  legend: [],
  diagnostics: [],
});

/** Which kinds carry an icon tile rather than plain text. */
export const ICON_KINDS = new Set<NodeKind>([
  "service",
  "store",
  "db",
  "client",
  "queue",
  "external",
  "extsystem",
  "container",
  "person",
  "actor",
  "participant",
]);
