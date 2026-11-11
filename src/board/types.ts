import type { Code } from "../dsl/codes";
import type { Marker } from "../dsl/ir";
import type { Attrs } from "./attrs";

export const DIAGRAM_TYPES = [
  "erd",
  "flow",
  "arch",
  "state",
  "activity",
  "class",
  "usecase",
  "c4",
  "mindmap",
  "sequence",
  "timeline",
  "gitgraph",
  "sketch",
  /**
   * The fourteenth, and the first one that draws data rather than a system. Its model is a
   * `ChartModel`, not a `Graph` — see `OWN_MODEL_TYPES` in `src/dsl/ir.ts`.
   */
  "chart",
] as const;

export type DiagramType = (typeof DIAGRAM_TYPES)[number];

const PROSE_TYPES = ["md", "note", "image"] as const;
type ProseType = (typeof PROSE_TYPES)[number];

/**
 * The board-level families: fences that are items in the file but draw nothing of their own.
 *
 * `edges` holds the links between items. It is a fence rather than frontmatter because a fence is
 * an item — the editor panel edits it, `applyPatch` writes it, undo covers it, the clipboard
 * carries it — and none of that would be true of a key in the YAML at the top.
 */
const LINK_TYPES = ["edges"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

/**
 * A request waiting to be drawn: a description a person typed, which a model on the dev server turns
 * into one diagram that takes the card's place (`plugins/generate/`).
 *
 * Its own family rather than a flag on `md`, because nothing about it is prose to render and nothing
 * is DSL to parse: the body is an instruction, and the one thing that happens to it is that it goes
 * away. A fence all the same, so it is saved, undone, copied and seen by Claude like any other item —
 * a prompt somebody typed and did not run yet survives a reload.
 */
const PROMPT_TYPES = ["prompt"] as const;
export type PromptType = (typeof PROMPT_TYPES)[number];

export type ItemType = DiagramType | ProseType | LinkType | PromptType;

export const isDiagramType = (t: string): t is DiagramType => (DIAGRAM_TYPES as readonly string[]).includes(t);
export const isLinkType = (t: string): t is LinkType => (LINK_TYPES as readonly string[]).includes(t);
const isPromptType = (t: string): t is PromptType => (PROMPT_TYPES as readonly string[]).includes(t);
export const isItemType = (t: string): t is ItemType =>
  isDiagramType(t) || isLinkType(t) || isPromptType(t) || (PROSE_TYPES as readonly string[]).includes(t);

/**
 * What a person calls each kind of item: the words the inspector, the search and the library show.
 * The fence's own word (`arch`, `md`) stays the file's and the Source view's.
 */
const ITEM_NAME: Record<ItemType, string> = {
  erd: "Data model",
  flow: "Flowchart",
  arch: "Architecture",
  state: "State machine",
  activity: "Activity",
  class: "Class diagram",
  usecase: "Use cases",
  c4: "C4",
  mindmap: "Mind map",
  sequence: "Sequence",
  timeline: "Timeline",
  gitgraph: "Git graph",
  sketch: "Sketch",
  chart: "Chart",
  md: "Text",
  note: "Sticky note",
  image: "Image",
  edges: "Links",
  prompt: "Prompt",
};

/** {@link ITEM_NAME}, for a word that may not be an item type at all — it is then shown as it is. */
export const itemName = (t: string): string => (isItemType(t) ? ITEM_NAME[t] : t);

export interface BoardItem {
  id: string;
  type: ItemType;
  /** The DSL, markdown or caption between the fences. */
  body: string;
  /** Author-pinned position. Absent → auto-flowed. */
  x?: number;
  y?: number;
  /** Author-pinned width; diagrams size themselves, `md`/`image` default to 520. */
  w?: number;
  h?: number;
  title?: string;
  subtitle?: string;
  /**
   * The item's own hue — a `md`/`note`/`image` wears it directly (`hueVars()` in `MarkdownItem` and
   * `ImageItem`); a diagram item draws it as the tint of its frame (`frameHueVars()` in `Frame`). One of
   * `HUE_ORDER`; an unknown name is `WB_BAD_HUE` and dropped. Not in `hash` — it is colour only, no
   * layout, so a hue change must not miss the layout cache the way `dir`/`aspect` deliberately do.
   */
  hue?: string;
  /** Items that share a group select and move together. Any name; the editor makes `group-xxxx`. */
  group?: string;
  dir?: "LR" | "TB";
  /**
   * Whether the diagram wears its header.
   *
   * Absent, the header is off unless `title` or `subtitle` is set: a diagram wears one only when
   * its author asked for one, whatever it holds — an atom dropped from the library stays frameless
   * however many cards it grows, until somebody names it. `none` and `full` force it either way,
   * `full` even with neither `title` nor `subtitle` set.
   */
  frame?: "none" | "full";
  /** Wrap target for the diagram, overriding the theme's per-type default. `0` turns wrapping off. */
  aspect?: number;
  /**
   * `layout=fixed` — the node coordinates in this fence are the author's, and nothing re-places
   * them.
   *
   * It is a fence attribute rather than a dialect because the claim is about *this drawing*, not
   * about a grammar: an `arch` of three boxes somebody arranged by hand is still an `arch`, and
   * every card, hue, icon and edge it can write goes on meaning what it meant. `sketch` is the
   * dialect that is fixed by nature; this is how any of the other twelve says the same thing once.
   */
  layout?: "fixed";
  /**
   * `as=` on a `prompt` card: the diagram type the person asked for. Absent, the model chooses from
   * the fourteen. An unknown name is `WB_BAD_AS` and dropped, so the card still generates.
   */
  as?: DiagramType;
  src?: string;
  page: string;
  note: boolean;
  hidden: boolean;
  /** Everything as written, so a rewrite round-trips unknown keys. */
  attrs: Attrs;
  /** 1-based line of the opening fence — the base for every diagnostic in this item. */
  line: number;
  /** Identity for the layout cache: changes only when the DSL changes. */
  hash: string;
}

/**
 * Whether a diagram draws its header: a title, a rule, and the type chip.
 *
 * A header is something the author asked for, not a fact `place()` derives from what a component
 * holds. `frame=full` always draws one, `frame=none` never does, and absent either, a `title=` or
 * a `subtitle=` is the ask. There is no third path that counts nodes: an atom dropped from the
 * library stays frameless however many cards it grows, until somebody names it — a title is its
 * own `Heading` atom, placed where the author wants it, not a thing the parser infers.
 */
export function framed(item: Pick<BoardItem, "frame" | "title" | "subtitle">): boolean {
  return item.frame === "full" || (item.frame !== "none" && !!(item.title || item.subtitle));
}

export interface BoardPage {
  id: string;
  name: string;
}

/**
 * One end of a link: an item, or a node inside a diagram item.
 *
 * `item` alone means the item's own box — which for a bare node *is* the card. `item.node` lands on
 * the card itself: `routeLinks` (`src/layout/boardRoute.ts`) puts the node's box into the route and
 * declares its diagram scenery rather than an obstacle, so the line threads between the diagram's
 * other cards to reach the one it names. It used to stop on the frame, level with the node, and on
 * screen a frame is `paper` on `paper` — the arrow ended forty pixels short of anything visible.
 */
export interface LinkEnd {
  /**
   * The name of the thing this end is anchored to: an item's id, or — when `group` is set — a
   * board-level group's name.
   *
   * One field for both, because both are keys into the same box map: `routeLinks` is handed a
   * group's union box under its own name and needs no case for it. The alternative was a second
   * field that half the readers would forget, which is the shape `OWN_MODEL_TYPES` exists to stop
   * one layer down.
   */
  item: string;
  node?: string;
  /**
   * `item` names a group rather than an item, and the link is anchored on the union of its
   * members' boxes. Never set together with `node`: a group has no cards of its own, and a
   * member's card is reached by naming that member.
   */
  group?: boolean;
}

/**
 * An edge between two items on the board, written in an `edges` fence.
 *
 * The same arrow vocabulary as a diagram's edges, and the same `Marker`s, so `route.ts` and
 * `Edges.tsx` need to learn nothing. What it is *not* is part of any dialect: no parser owns two
 * families at once, and an actor linked to a service belongs to neither.
 */
export interface BoardLink {
  id: string;
  /** The `edges` item this was read from — the thing to rewrite when the link is deleted. */
  fence: string;
  from: LinkEnd;
  to: LinkEnd;
  dash: boolean;
  head: Marker;
  tail: Marker;
  label?: string;
  /** The second string — C4's technology chip, drawn under the label as it is on a diagram's edge. */
  label2?: string;
  /** Its own `hue=`, never either endpoint's: an item has no hue to inherit. */
  hue?: string;
  quiet?: boolean;
  /**
   * One point the line is bent through, in board coordinates — `via="320,180"`.
   *
   * Absolute, like every other coordinate a board file holds, and not an offset from the chord:
   * `x=`/`y=` on a fence line is the spelling a reader already knows, and a point somebody put
   * somewhere is a point, not a fraction of a distance between two things that move. The cost is
   * stated rather than hidden — move one of the two items a long way and the bend is still where
   * it was put, which is the same bargain a hand-placed anything makes on this board.
   */
  via?: { x: number; y: number };
  /** 1-based line in the board file, so a diagnostic can point at it. */
  line: number;
}

/**
 * A problem with the board file: its frontmatter, a fence line, an attribute list.
 *
 * Same shape as the DSL's `Diagnostic` so one renderer can show both, and codes from the same
 * table — `EB_*` rather than `E_*`, because "unterminated string" means a different grammar here.
 */
export interface BoardDiagnostic {
  line: number;
  col?: number;
  code: Code;
  message: string;
  severity: "error" | "warn";
}

export interface Board {
  name: string;
  title?: string;
  theme?: string;
  pages: BoardPage[];
  items: BoardItem[];
  /** Every link on the board, from every `edges` fence, in file order. */
  links: BoardLink[];
  flow: { width: number; gap: number };
  /** Frontmatter or structural problems, not per-item DSL errors. */
  /** Problems with the file itself, as opposed to with a diagram inside it. */
  errors: BoardDiagnostic[];
}

/**
 * What a resize handle can mean for an item.
 *
 * - `box` — `w=`/`h=` *are* the box and the body fills it: `md` and `image`.
 * - `aspect` — the box belongs to the layout, so the handle sets the shape to aim for (`aspect=`)
 *   and ELK folds the diagram to suit. Writing `w=` here widened the *frame* and left the content
 *   at its natural size, stranded against the left edge — a bigger empty box, which is not what
 *   anyone pulling an edge is asking for. `aspect` is the knob that actually moves the cards, and
 *   until now it could only be typed onto the fence line.
 * - `none` — the diagram has an axis no rectangle describes: a swimlane's bands, a sequence's
 *   clock, real time, a commit order. There is nothing for a handle to say, so it does not appear.
 */
export type Resize = "box" | "aspect" | "none";

/**
 * The five dialects laid out by a pass of our own rather than by ELK (see `src/layout/`).
 *
 * They ignore `aspect` by construction — it is an ELK option — so a handle that wrote one would be
 * the same lie in a different attribute.
 */
const OWN_LAYOUT: ReadonlySet<string> = new Set(["flow", "activity", "sequence", "timeline", "gitgraph"]);

export function resizeOf(type: ItemType): Resize {
  /* A prompt card is a text box like a note: its width is the author's, its height the text's. */
  if (type === "md" || type === "image" || type === "prompt") return "box";
  /* A sketch's box is the author's too. `aspect` would be a lie — nothing folds — and `none` would
     leave the one type whose whole premise is hand-placed geometry with no handle at all. */
  if (type === "sketch") return "box";
  /* And a chart's. It has no natural size the way an ELK diagram does: the same six bars are right
     at 320px in a margin and at 900px as a hero, so the box is purely a choice and `w=`/`h=` are
     what a person pulling a handle is asking about. `aspect` would fold nothing. */
  if (type === "chart") return "box";
  if (!isDiagramType(type)) return "none";
  return OWN_LAYOUT.has(type) ? "none" : "aspect";
}

/**
 * The same question asked of an **item** rather than of a type, which is the honest form of it
 * anywhere an item is in hand.
 *
 * `layout=fixed` says the coordinates in this fence are the author's, and `layoutSketch` — a
 * passthrough that never reads the fence's box — is what draws it. So an `arch` opened
 * `layout=fixed` has stopped being an ELK diagram: `aspect=` is an ELK option it ignores
 * completely, and a side handle writing one is a control that changes nothing at all. Its box is
 * the author's exactly as a `sketch`'s is, and so are all eight handles. The five own-layout
 * dialects go the same way: `layout=fixed` on a `flow` fence means the bands stop placing things,
 * so `none` — which is a statement about swimlanes — stops being true of it too.
 *
 * `Props.tsx` has carried this predicate since F3 and used it to suppress the "ELK folds this"
 * hint; what it never did was reach the gesture, so a detached diagram kept two side handles that
 * wrote an attribute nothing read.
 *
 * `resizeOf` stays type-only, and `detachable()` is why: it asks which *dialect* ELK lays out, and
 * that does not change because one fence was detached — a fence already fixed is what Re-layout is
 * for, not Detach.
 */
export function resizeOfItem(item: Pick<BoardItem, "type" | "layout">): Resize {
  if (item.layout === "fixed" && isDiagramType(item.type)) return "box";
  return resizeOf(item.type);
}
