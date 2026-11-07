import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { isDiagramType, resizeOf, resizeOfItem } from "@/board/types";
import { CODES } from "@/dsl/codes";
import { SHAPE_KINDS, type Graph } from "@/dsl/ir";
import { parseDiagram } from "@/dsl/parse";
import { layoutGraph } from "@/layout/elk";
import { setMeasurer, TableMeasurer } from "@/layout/measure";
import { sizeGraph, sizeLabels } from "@/layout/size";
import { labelReach, routeReach } from "@/layout/route";
import type { Box, Placed } from "@/layout/types";
import theme from "../themes/paper/theme.json";
import type { Theme } from "@/theme/contract";

/**
 * `sketch`, and `layout=fixed`: the one place the coordinates in the file are the drawing.
 *
 * Two things are being held here, and they pull in opposite directions. The parse tests hold that
 * `x=`, `y=`, `w=` and `h=` reach the `Node` as real fields rather than being swallowed into
 * `extra` — which is what they did for the whole of the project until now, silently. The layout
 * tests hold that nothing *moves* them: a passthrough is easy to write and easy to grow an
 * accidental opinion in, and the way that shows up is a wireframe whose button drifts eight pixels
 * when somebody edits the router.
 *
 * `test/layout.test.ts` already runs the reference board's sketches through the shared invariants
 * (every node placed, nothing overlapping, everything on the grid, every node inside its group).
 * What is here is what those cannot say: that the answer is the *author's* answer.
 */

const T = theme as unknown as Theme;
beforeAll(() => setMeasurer(new TableMeasurer()));

const parse = (src: string, layout?: "fixed", type = "sketch") =>
  parseDiagram(type, src, undefined, undefined, layout)!;

const run = (g: Graph): Promise<Placed> => layoutGraph(g, sizeGraph(g, T), sizeLabels(g, T), T.metric);

const errors = (g: Graph) => g.diagnostics.filter((d) => d.severity === "error");
const warnings = (g: Graph) => g.diagnostics.filter((d) => d.severity === "warn");

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("the sketch dialect", () => {
  const g = parse(`
box hero "Hero" "a rectangle" x=0 y=0 w=320 h=120
text caption "Under it" x=0 y=136
button go "Continue" x=0 y=176
input email "you@example.com" x=0 y=232
img shot "Shot" "a picture goes here" x=0 y=288
sticky note "Remember this" x=360 y=0
hero --- caption
`);

  it("parses clean", () => {
    expect(errors(g).map((d) => `${d.line}: ${d.code}`)).toEqual([]);
    expect(warnings(g).map((d) => `${d.line}: ${d.code}`)).toEqual([]);
  });

  it("reads the whole vocabulary", () => {
    expect(g.nodes.map((n) => n.kind)).toEqual(["box", "text", "button", "input", "img", "sticky"]);
  });

  it("promotes x, y, w and h to real node fields", () => {
    const hero = g.nodes.find((n) => n.id === "hero")!;
    expect([hero.x, hero.y, hero.w, hero.h]).toEqual([0, 0, 320, 120]);
    /* `0` is a coordinate. `Number(v) || undefined` would have made both of these `undefined`,
       which is the whole reason `modifiers()` does not spell it that way. */
    expect(g.nodes.find((n) => n.id === "note")!.y).toBe(0);
  });

  it("draws a line with no head from the shared arrow table", () => {
    expect(g.edges.map((e) => [e.from.node, e.to.node, e.head, e.tail])).toEqual([
      ["hero", "caption", "none", "none"],
    ]);
  });

  it("parses a stroke the pen left behind", () => {
    const s = parse('ink s1 pts="0,0 14,9 31,5" x=240 y=120');
    expect(errors(s)).toEqual([]);
    const n = s.nodes[0]!;
    expect(n.kind).toBe("ink");
    expect(n.pts).toEqual([
      { x: 0, y: 0 },
      { x: 14, y: 9 },
      { x: 31, y: 5 },
    ]);
    expect([n.x, n.y]).toEqual([240, 120]);
  });

  it("points the pen's other names at `ink`", () => {
    const bad = parse('pencil a "A"');
    const e = errors(bad);
    expect(e.map((d) => d.code)).toEqual([CODES.E_UNKNOWN_KIND]);
    expect(e[0]!.message).toContain("Did you mean `ink`");
  });

  it("binds a sticky's hue in the parser, so no component has to default one", () => {
    expect(g.nodes.find((n) => n.id === "note")!.hue).toBe("ochre");
    expect(g.nodes.find((n) => n.id === "hero")!.hue).toBeUndefined();
  });

  it("lets an author overrule the sticky's hue", () => {
    const teal = parse('sticky n "Note" hue=teal');
    expect(teal.nodes[0]!.hue).toBe("teal");
  });

  it("gives a container no automatic hue, and inherits an explicit one", () => {
    const plain = parse('group phone "Phone" {\n  box a "A"\n}');
    expect(plain.groups[0]!.hue).toBeUndefined();
    expect(plain.nodes[0]!.hue).toBeUndefined();

    const hued = parse('group phone "Phone" hue=teal {\n  box a "A"\n}');
    expect(hued.groups[0]!.hue).toBe("teal");
    expect(hued.nodes[0]!.hue).toBe("teal");
  });

  it("takes `frame` as a second word for a container, because that is what one is", () => {
    const win = parse('frame win "Browser" x=0 y=0 w=800 h=600 {\n  box a "A"\n}');
    expect(errors(win)).toEqual([]);
    expect(win.groups.map((g) => g.id)).toEqual(["win"]);
    expect(win.nodes[0]!.group).toBe("win");
  });

  it("gives a container its own box", () => {
    const grouped = parse('group phone "Phone" x=8 y=16 w=320 h=480 {\n  box a "A"\n}');
    const box = grouped.groups[0]!;
    expect([box.x, box.y, box.w, box.h]).toEqual([8, 16, 320, 480]);
  });

  it("names its kinds when a word is not one of them", () => {
    const bad = parse('rectangle a "A"');
    const e = errors(bad);
    expect(e.map((d) => [d.line, d.code])).toEqual([[1, CODES.E_UNKNOWN_KIND]]);
    expect(e[0]!.message).toContain("box");
  });

  it("points at the line a value is missing from", () => {
    const bad = parse('box a "A"\nbox b "B" x=\ntext c "C"');
    expect(errors(bad).map((d) => [d.line, d.code])).toEqual([[2, CODES.E_EXPECTED_VALUE]]);
  });

  it("points at the line a string was left open on", () => {
    const bad = parse('box a "A"\ntext b "B"\nbutton c "C');
    expect(errors(bad).map((d) => [d.line, d.code])).toEqual([[3, CODES.E_UNTERMINATED_STRING]]);
  });

  it("reports a container that never opened its brace", () => {
    const bad = parse('group phone "Phone" x=0 y=0');
    expect(errors(bad).map((d) => d.code)).toEqual([CODES.E_EXPECTED_BRACE]);
  });

  it("reports a second shape with the first one's id", () => {
    const bad = parse('box a "A"\nbox a "B"');
    expect(errors(bad).map((d) => [d.line, d.code])).toEqual([[2, CODES.E_DUPLICATE_ID]]);
  });

  it("reports an edge into nothing, once, on its own line", () => {
    const bad = parse('box a "A"\na --- nope');
    expect(errors(bad).map((d) => [d.line, d.code])).toEqual([[2, CODES.E_UNKNOWN_ID]]);
  });

  it("resizes by its box, not by an aspect nothing folds to", () => {
    expect(resizeOf("sketch")).toBe("box");
  });
});

/**
 * What a handle means once a fence says its coordinates are the author's.
 *
 * `resizeOf` answers about a *type*, and for a detached diagram that answer is stale the moment
 * `layout=fixed` is written: `layoutSketch` draws it and never reads the fence's box, so `aspect=`
 * is an ELK option nothing consults and a side handle writing one changed nothing at all. The item
 * is what carries `layout`, so `resizeOfItem` is the form of the question that can see it.
 */
describe("resizeOfItem", () => {
  it("leaves an ordinary diagram folding to an aspect", () => {
    expect(resizeOfItem({ type: "arch" })).toBe("aspect");
  });

  it("hands a detached one its whole box, because nothing folds any more", () => {
    expect(resizeOfItem({ type: "arch", layout: "fixed" })).toBe("box");
  });

  it("gives an own-layout dialect handles once it is fixed, having had none before", () => {
    /* `none` is a statement about swimlanes, and a fixed `flow` has stopped having them. */
    expect(resizeOfItem({ type: "flow" })).toBe("none");
    expect(resizeOfItem({ type: "flow", layout: "fixed" })).toBe("box");
  });

  it("agrees with `resizeOf` about everything that is not fixed", () => {
    for (const type of ["sketch", "chart", "md", "image", "prompt", "erd", "sequence"] as const) {
      expect(resizeOfItem({ type })).toBe(resizeOf(type));
    }
  });

  it("says nothing new about a type whose box was already the author's", () => {
    expect(resizeOfItem({ type: "sketch", layout: "fixed" })).toBe("box");
    /* A chart has no node to place, so `layout=fixed` on one is read and ignored — and `box` was
       already the answer, which is why this is a no-op rather than an exception. */
    expect(resizeOfItem({ type: "chart", layout: "fixed" })).toBe("box");
  });
});

describe("a coordinate outside a fixed fence", () => {
  it("is read onto the node and warned about", () => {
    const g = parse('service api "API" x=40 y=80', undefined, "arch");
    expect(errors(g)).toEqual([]);
    const w = warnings(g);
    expect(w.map((d) => [d.line, d.code])).toEqual([
      [1, CODES.W_UNKNOWN_ATTR],
      [1, CODES.W_UNKNOWN_ATTR],
    ]);
    expect(w[0]!.message).toContain("layout=fixed");
    /* Read, not dropped: the value is on the node, so switching the fence to `layout=fixed` is a
       one-word edit rather than retyping every coordinate. */
    expect([g.nodes[0]!.x, g.nodes[0]!.y]).toEqual([40, 80]);
  });

  it("is silent inside one", () => {
    const g = parse('service api "API" x=40 y=80', "fixed", "arch");
    expect(g.diagnostics).toEqual([]);
    expect(g.layout).toBe("fixed");
  });

  it("names the keys the dialect knows for anything else", () => {
    const g = parse('service api "API" colour=red', undefined, "arch");
    const w = warnings(g);
    expect(w.map((d) => d.code)).toEqual([CODES.W_UNKNOWN_ATTR]);
    expect(w[0]!.message).toContain("hue");
  });

  it("stays quiet for the two overrides that are read", () => {
    expect(parse('service api "API" kind=store', undefined, "arch").diagnostics).toEqual([]);
    expect(parse('group g "G" dir=TB {\n  service api "API"\n}', undefined, "arch").diagnostics).toEqual([]);
  });
});

describe("layoutSketch", () => {
  /* The frame hugs the drawing, so every box comes back relative to the drawing's top-left and
     `origin` says where that corner is in the file. What was written is the *shape*: the gaps
     between boxes, exactly, and nothing about empty space in front of the first one. */
  it("puts every shape exactly where it was written, relative to the drawing's corner", async () => {
    const g = parse('box a "A" x=40 y=80 w=160 h=96\nbox b "B" x=240 y=80 w=160 h=96');
    const placed = await run(g);
    expect(placed.nodes.a).toEqual({ x: 0, y: 0, w: 160, h: 96 });
    expect(placed.nodes.b).toEqual({ x: 200, y: 0, w: 160, h: 96 });
    expect(placed.origin).toEqual({ x: 40, y: 80 });
    expect(placed.size).toEqual({ w: 360, h: 96 });
  });

  it("places a stroke where its x= and y= say, sized from its points' bounds", async () => {
    const placed = await run(parse('ink s1 pts="0,0 60,40" x=80 y=40'));
    expect(placed.nodes.s1).toEqual({ x: 0, y: 0, w: 60, h: 40 });
    expect(placed.origin).toEqual({ x: 80, y: 40 });
  });

  /* A lone shape dragged right used to sit at the far end of a frame that still started
     at the file's 0 — 480px of nothing in front of a 192px cylinder, which no resize could reach. */
  it("hugs a drawing that starts right of or below the origin, as it does one that starts before it", async () => {
    const placed = await run(parse('cylinder c "Database" x=480 y=-184 w=192 h=232'));
    expect(placed.nodes.c).toEqual({ x: 0, y: 0, w: 192, h: 232 });
    expect(placed.origin).toEqual({ x: 480, y: -184 });
    expect(placed.size).toEqual({ w: 192, h: 232 });
  });

  it("snaps to the grid, because a shape a nudge cannot reach is worse than one that moved 4px", async () => {
    const placed = await run(parse('box a "A" x=13 y=29'));
    expect(placed.nodes.a!.x % T.metric.grid).toBe(0);
    expect(placed.nodes.a!.y % T.metric.grid).toBe(0);
  });

  it("resolves a container's children against its own origin", async () => {
    const g = parse('group phone "Phone" x=80 y=40 w=320 h=200 {\n  box a "A" x=24 y=56 w=160 h=96\n}');
    const placed = await run(g);
    expect(placed.nodes.a).toEqual({ x: 24, y: 56, w: 160, h: 96 });
    expect(placed.groups[0]).toMatchObject({ id: "phone", x: 0, y: 0, w: 320, h: 200 });
    expect(placed.origin).toEqual({ x: 80, y: 40 });
  });

  it("grows a container that was drawn too small for what is in it", async () => {
    const g = parse('group phone "Phone" x=0 y=0 w=80 h=80 {\n  box a "A" x=0 y=0 w=240 h=160\n}');
    const placed = await run(g);
    const box = placed.groups[0]!;
    expect(box.w).toBeGreaterThanOrEqual(240 + T.metric.sketch.groupPad);
    expect(box.h).toBeGreaterThanOrEqual(160 + T.metric.sketch.groupPad);
  });

  it("places what has no coordinate in reading order, clear of what has one", async () => {
    const g = parse('box a "A" x=0 y=0 w=160 h=96\nbox b "B"\nbox c "C"\nbox d "D"');
    const placed = await run(g);
    const boxes = Object.entries(placed.nodes);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i]![1], boxes[j]![1]), `${boxes[i]![0]} overlaps ${boxes[j]![0]}`).toBe(false);
      }
    }
    /* Below the one that was placed, never on top of it. */
    for (const id of ["b", "c", "d"]) expect(placed.nodes[id]!.y).toBeGreaterThanOrEqual(96);
  });

  it("moves a drawing that starts above the origin into the frame instead of clipping it", async () => {
    const placed = await run(parse('box a "A" x=-80 y=-40 w=160 h=96\nbox b "B" x=0 y=0 w=160 h=96'));
    expect(placed.nodes.a).toEqual({ x: 0, y: 0, w: 160, h: 96 });
    expect(placed.nodes.b).toEqual({ x: 80, y: 40, w: 160, h: 96 });
    expect(placed.origin).toEqual({ x: -80, y: -40 });
  });

  it("sizes the frame to the content's extent", async () => {
    const placed = await run(parse('box a "A" x=0 y=0 w=160 h=96\nbox b "B" x=320 y=200 w=160 h=96'));
    expect(placed.size).toEqual({ w: 480, h: 296 });
  });

  /* A back edge along a row bows above it, and the frame used to be the boxes alone — the
     top of the bow and the label on it were outside the item, where the page clips. */
  it("holds a back edge's bow and its label inside the frame, and keeps the file's numbers", async () => {
    const g = parse(
      'box a "1" x=0 y=0 w=80 h=56\nbox b "2" x=120 y=0 w=80 h=56\nbox c "3" x=240 y=0 w=80 h=56\n' +
        'box d "4" x=360 y=0 w=80 h=56\na --> b\nb --> c\nc --> d\nd --> b "back to 2"',
    );
    const labels = sizeLabels(g, T);
    const placed = await layoutGraph(g, sizeGraph(g, T), labels, T.metric);
    const lines = routeReach(placed.edges);
    const words = labelReach(placed.edges, labels);
    expect(placed.edges.find((e) => e.id === g.edges[3]!.id)?.label?.text).toBe("back to 2");
    for (const r of [lines, words]) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(placed.size.w);
      expect(r.bottom).toBeLessThanOrEqual(placed.size.h);
    }
    /* The bow is above the row, so the row moved down to make room — and a box plus `origin` is
       still the file's own number, which is what every writer turns a laid-out box back into. */
    expect(placed.nodes.a!.y).toBeGreaterThan(0);
    for (const [id, x] of [["a", 0], ["b", 120], ["c", 240], ["d", 360]] as const) {
      expect(placed.nodes[id]!.x + placed.origin!.x).toBe(x);
      expect(placed.nodes[id]!.y + placed.origin!.y).toBe(0);
    }
  });

  /* A box's words wider than its `w=` are cut off at its edge, and nothing said so. */
  it("names the boxes whose words are wider than the w= they were given, and none that fit", async () => {
    const placed = await run(
      parse(
        'box c "7" "i = 1 · now" w=80\nbox ok "7" "i = 1" w=120 x=160 y=0\nbox free "7" "i = 1 · now" x=320 y=0\n' +
          'text t "a long line of words" w=60 x=0 y=120\nbutton b "Submit the form" w=64 x=160 y=120\n' +
          'button fine "Go" w=96 x=320 y=120\ninput i "search everything" w=80 x=0 y=200',
      ),
    );
    expect(placed.clipped).toEqual(["c", "t", "b", "i"]);
  });

  it("reports a box for an empty fence, so the page can still become ready", async () => {
    const placed = await run(parse(""));
    expect(placed.size).toEqual({ w: 1, h: 1 });
  });

  it("routes an edge from the rectangles alone", async () => {
    const placed = await run(parse('box a "A" x=0 y=0 w=160 h=96\nbox b "B" x=320 y=0 w=160 h=96\na --> b "goes"'));
    expect(placed.edges).toHaveLength(1);
    expect(placed.edges[0]!.d.startsWith("M")).toBe(true);
    expect(placed.edges[0]!.d).not.toContain("NaN");
  });

  it("takes a fixed arch out of ELK's hands without changing what an arch means", async () => {
    const g = parse('client web "Browser" x=0 y=0\nservice api "API" x=400 y=0\nweb --> api', "fixed", "arch");
    const placed = await run(g);
    expect(placed.nodes.web!.x).toBe(0);
    expect(placed.nodes.api!.x).toBe(400);
    expect(placed.edges).toHaveLength(1);
  });

  it("honours `h=` as a minimum on a card that is not a sketch shape at all", () => {
    const tall = parse('service api "API" h=200', "fixed", "arch");
    expect(sizeGraph(tall, T).api!.h).toBe(200);
    const short = parse('service api "API" h=1', "fixed", "arch");
    expect(sizeGraph(short, T).api!.h).toBe(T.metric.node.plainH);
  });
});

describe("`layout=` on a fence", () => {
  const board = (attrs: string) => parseBoard("t", `\`\`\`sketch {${attrs}}\nbox a "A"\n\`\`\`\n`);

  it("reads `fixed`", () => {
    const b = board("#s layout=fixed");
    expect(b.errors).toEqual([]);
    expect(b.items[0]!.layout).toBe("fixed");
  });

  it("refuses anything else, by name", () => {
    const b = board("#s layout=auto");
    expect(b.errors.map((e) => e.code)).toEqual([CODES.EB_BAD_LAYOUT]);
  });

  it("is in the hash, because it changes the parse as well as the layout", () => {
    expect(board("#s layout=fixed").items[0]!.hash).not.toBe(board("#s").items[0]!.hash);
  });
});

describe("the reference board", () => {
  const file = path.resolve(__dirname, "../boards/local/reference/sketch.board.md");
  const board = parseBoard("sketch", fs.readFileSync(file, "utf8"));

  it("parses with nothing to say", () => {
    expect(board.errors).toEqual([]);
    for (const item of board.items) {
      /* Prose and the `edges` fence have no diagram parser to ask. */
      if (!isDiagramType(item.type)) continue;
      const g = parseDiagram(item.type, item.body, item.dir, item.aspect, item.layout)!;
      expect(g.diagnostics.map((d) => `${item.id}: ${d.code} ${d.message}`)).toEqual([]);
    }
  });

  it("carries a fence of each half — a sketch, and a fixed diagram of another type", () => {
    expect(board.items.filter((i) => i.type === "sketch").length).toBeGreaterThanOrEqual(2);
    expect(board.items.find((i) => i.layout === "fixed")!.type).toBe("arch");
  });

  it("draws every geometric shape, so each one is in the baselines", () => {
    const kinds = new Set(
      board.items
        .filter((i) => i.type === "sketch")
        .flatMap((i) => parseDiagram("sketch", i.body)!.nodes.map((n) => n.kind)),
    );
    for (const k of SHAPE_KINDS) expect(kinds.has(k), k).toBe(true);
  });
});
