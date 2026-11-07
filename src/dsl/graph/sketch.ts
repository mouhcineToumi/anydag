import type { Dialect } from "../common";
import { SHAPE_KINDS, type ShapeKind } from "../ir";

/**
 * `sketch` — the free canvas: shapes, where you put them.
 *
 *     group phone "Sign in" x=0 y=0 w=320 h=520 {
 *       text  title "Welcome back"  x=24 y=32 w=272
 *       input email "you@example.com" x=24 y=88 w=272
 *       input pw "Password"           x=24 y=144 w=272
 *       button go "Continue"          x=24 y=208 w=272
 *     }
 *     sticky note "Password reset is out of scope" x=368 y=32
 *     go --- note
 *
 * Every other dialect is a grammar for a *kind of system* — what runs, what stores, what a record
 * can become — and its whole value is that the author never says where anything goes. This one is
 * the opposite claim, and it is the third composition algebra `library/types.ts` leaves room for:
 * **coordinates carry the meaning.** A wireframe is not a graph of five services in a costume; the
 * fact that the button is under the second field, and not beside it, is the whole drawing.
 *
 * Three things follow from that, and each is somewhere else in the tree:
 *
 * - `layout/sketch.ts` is a passthrough — snap, resolve a group's children against its origin,
 *   size the frame to the content, and hand the rectangles to `routeEdges`. Nothing places
 *   anything.
 * - `modifiers()` promotes `x=`, `y=` and `h=` to real `Node` fields here and in any fence opened
 *   `layout=fixed`, and warns `W_UNKNOWN_ATTR` for them everywhere else.
 * - `autoHue: false`, because a container here is a phone frame or a browser window rather than a
 *   domain. Greys are the drawing; a hue is something the author asks for.
 *
 * **A `line` is an edge, not a kind.** The shared arrow table already spells a line with no head
 * `---`, so `a --- b` is the whole of it and there is no vocabulary to invent. `-->` still draws an
 * arrow, which is what a flow annotation on a wireframe wants.
 *
 * **`ink` is not the `line` that was refused.** A line with no head is a *relationship* — `a --- b`
 * says two things are joined, and the arrow table owns every way to say that. A stroke joins
 * nothing: it is a mark somebody drew, and no arrow grammar can express a squiggle. So it is a
 * kind, whose `pts=` carries the path in the node's own coordinates (normalised to a minimum of
 * `0,0`; `src/dsl/ink.ts` holds that arithmetic) — and an edge may still leave the stroke like it
 * leaves any card, stopping at its box, which is the honest hull for a scribble.
 */
export const sketch: Dialect = {
  type: "sketch",
  /* Nothing lays this out, so the direction decides nothing. `LR` is what the router reads for a
     tie, and it is what every other brace dialect defaults to. */
  dir: "LR",
  /* The wireframe's six, then the geometry: a circle, a diamond, a cylinder, a speech
     bubble — the shapes a whiteboard diagram is drawn with when no dialect names the thing. Each is
     its own kind so the kind menu offers it and `E_UNKNOWN_KIND` lists it. Then the pen:
     not a shape kind, on purpose — see `ir.ts` for why the router must keep its rectangle hull.
     Then the picture: one kind, not one per subject — a house and a truck differ in their
     `icon=`, which is a vocabulary of fifteen hundred names with a picker and a route of its own,
     and a kind word per subject would have made the kind menu that vocabulary. */
  kinds: {
    box: "box",
    text: "text",
    button: "button",
    input: "input",
    img: "img",
    sticky: "sticky",
    ink: "ink",
    figure: "figure",
    ...(Object.fromEntries(SHAPE_KINDS.map((k) => [k, k])) as Record<ShapeKind, ShapeKind>),
  },
  groupWords: ["group", "frame"],
  autoHue: false,
  /**
   * A sticky is ochre unless the author says otherwise.
   *
   * Bound in the parser, never defaulted in the component: `hueVars()` sets `--dag-h` only when an
   * element *has* a hue, and a component that reached for a colour when it had none would be the
   * thirteen-copies-of-a-default problem this codebase already paid for once. This runs after
   * `finalize`, so a sticky inside a group the author hued keeps that hue and only a genuinely
   * unhued one turns yellow.
   */
  finish(graph) {
    for (const n of graph.nodes) if (n.kind === "sticky" && !n.hue) n.hue = "ochre";
  },
};
