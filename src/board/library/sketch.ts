import type { Blueprint } from "./types";

/**
 * The Shapes section: the `sketch` vocabulary, as things to drop.
 *
 * Every other family in the library is a *statement about a system* — a service, an entity, a lane
 * — and the panel's sections are named for what those statements are made of. These are shapes, and
 * a person reaching for a rectangle is not thinking about layers, which is why they come first and
 * why `categoryOf` sends the whole dialect to one section rather than spreading it across four.
 *
 * **The coordinates live in the composition, not in the atoms.** A shape dropped from the panel gets
 * no `x=`, so `layout/sketch.ts` puts it in the reading-order grid clear of everything already
 * placed — dropping a button on top of the button you dropped a second ago is the one outcome
 * nobody wants. The `Wireframe` starter says where each of its parts goes, because there the
 * arrangement *is* the thing being handed over.
 *
 * `${?at}` is one prop carrying a whole coordinate — `x=24 y=104 w=272` — rather than four holes
 * whose empty spellings would each have to be swallowed separately. It follows the `${?meta}` rule
 * the rest of the library uses: nothing when empty, a leading space when not.
 */

const shape = (
  id: string,
  name: string,
  description: string,
  icon: string,
  source: string,
  props: Record<string, string>,
  slot: string,
): Blueprint => ({ id, layer: 0, type: "sketch", name, description, icon, source, props, slot });

/**
 * The geometric shapes, right after Box — a person opening Shapes to draw a circle should
 * not scroll past a text input to find it. Each is one bare shape with a word in it, dropped where
 * nothing else is, and its handles resize the shape itself (`loneShape` in `src/edit/build.ts`).
 *
 * `[kind, name, what it is, Lucide glyph, the words it arrives with]`. Lucide has no parallelogram
 * or trapezoid, so those two are drawn in `src/edit/glyphs.tsx` on its grid.
 */
const GEOMETRY: [string, string, string, string, string][] = [
  ["circle", "Circle", "a circle. Given one side, it stays round.", "Circle", "Circle"],
  ["ellipse", "Ellipse", "an oval, wider than it is tall.", "Egg", "Ellipse"],
  ["triangle", "Triangle", "a triangle, point up; its words sit in the wide part.", "Triangle", "Triangle"],
  ["diamond", "Diamond", "a decision, in a flowchart's own shape.", "Diamond", "Decide?"],
  ["hexagon", "Hexagon", "pointed left and right, a preparation step.", "Hexagon", "Prepare"],
  ["pentagon", "Pentagon", "a pentagon, point up.", "Pentagon", "Pentagon"],
  ["octagon", "Octagon", "an octagon, usually a stop sign.", "Octagon", "Stop"],
  ["star", "Star", "a five-pointed star.", "Star", "Star"],
  ["parallelogram", "Parallelogram", "input or output, in a flowchart.", "Parallelogram", "Input"],
  ["trapezoid", "Trapezoid", "a manual operation, in a flowchart.", "Trapezoid", "Manual step"],
  ["cylinder", "Cylinder", "a store, a database drawn as a drum.", "Cylinder", "Database"],
  ["document", "Document", "a page with a wavy foot.", "FileText", "Report"],
  ["stadium", "Stadium", "an outlined pill, a start or an end.", "Pill", "Start"],
  ["cloud", "Cloud", "the internet, or anything somebody else runs.", "Cloud", "Internet"],
  ["callout", "Speech bubble", "something somebody says.", "MessageCircle", "Something to say"],
  ["arrow", "Block arrow", "a fat arrow pointing right.", "ArrowBigRight", "Next"],
];

export const SKETCH_ATOMS: Blueprint[] = [
  shape("part-sketch-box", "Box", "sketch · a plain rectangle.", "Square", 'box ${self} "${title}"${?meta}${?at}', {
    title: "Box",
    meta: "",
    at: "",
  }, "box"),
  ...GEOMETRY.map(([kind, name, description, icon, title]) =>
    shape(`part-sketch-${kind}`, name, `sketch · ${description}`, icon, `${kind} \${self} "\${title}"\${?at}`, { title, at: "" }, kind),
  ),
  shape("part-sketch-text", "Text", "sketch · a line of text, no chrome.", "Type", 'text ${self} "${title}"${?at}', {
    title: "A line of text",
    at: "",
  }, "txt"),
  shape("part-sketch-button", "Button", "sketch · a filled pill.", "RectangleHorizontal", 'button ${self} "${title}"${?at}', {
    title: "Continue",
    at: "",
  }, "btn"),
  shape("part-sketch-input", "Input", "sketch · a field, its title the placeholder.", "TextCursorInput", 'input ${self} "${title}"${?at}', {
    title: "you@example.com",
    at: "",
  }, "field"),
  shape("part-sketch-img", "Image", "sketch · a picture that is not there yet.", "Image", 'img ${self} "${title}" "${caption}"${?at}', {
    title: "Image",
    caption: "a picture goes here",
    at: "",
  }, "img"),
  shape("part-sketch-sticky", "Sticky", "sketch · a square of paper. Ochre unless you say otherwise.", "StickyNote", 'sticky ${self} "${title}"${?at}', {
    title: "Something to remember",
    at: "",
  }, "note"),
];

export const SKETCH_MOLECULES: Blueprint[] = [
  {
    id: "part-sketch-frame",
    layer: 1,
    type: "sketch",
    name: "Frame",
    description: "sketch · a phone or a window, with its own box.",
    icon: "Smartphone",
    slot: "screen",
    source: 'group ${self} "${title}"${?at} {\n  ${children}\n}',
    props: { title: "Screen", at: "w=320 h=480" },
    parts: [{ use: "part-sketch-text", props: { id: "${parent}_t", title: "Title", at: "x=24 y=48 w=272" } }],
  },
];

export const SKETCH_DIAGRAMS: Blueprint[] = [
  {
    id: "diagram-sketch",
    layer: 3,
    type: "sketch",
    name: "Wireframe",
    description: "A phone frame with a heading, two fields and a button.",
    icon: "LayoutTemplate",
    parts: [
      {
        use: "part-sketch-frame",
        props: { id: "phone", title: "Sign in", at: "x=0 y=0 w=320 h=440" },
        parts: [
          { use: "part-sketch-text", props: { id: "welcome", title: "Welcome back", at: "x=24 y=56 w=272" } },
          { use: "part-sketch-input", props: { id: "email", title: "you@example.com", at: "x=24 y=112 w=272" } },
          { use: "part-sketch-input", props: { id: "pw", title: "Password", at: "x=24 y=168 w=272" } },
          { use: "part-sketch-button", props: { id: "go", title: "Continue", at: "x=24 y=240 w=272" } },
        ],
      },
    ],
  },
];

/** The starter a new `sketch` fence begins as. `TEMPLATE_BY_TYPE` in `index.ts` reads this. */
export const SKETCH_TEMPLATE_IDS = ["diagram-sketch"];
