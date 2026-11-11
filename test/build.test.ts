import { describe, expect, it } from "vitest";

import {
  appendEdge,
  clearSpot,
  cornerOf,
  detach,
  detachable,
  fileAt,
  fixedGraph,
  freshNodeId,
  grow,
  growable,
  pinUnplaced,
  scaleFixed,
  soleCard,
  type LaidOut,
} from "../src/edit/build";
import { parseDiagram } from "../src/dsl/parse";
import { rowLines, stripCoords } from "../src/dsl/restate";

/**
 * F3's two pure pieces: what a `+` appends, and what Detach rewrites.
 *
 * Everything here is text in, text out, so it is checked the way `restate.test.ts` checks a span
 * writer — by reading the bytes. The one thing every case also asserts is that the result still
 * **parses**: a control that writes a statement the parser rejects is worse than a control that
 * does nothing, because the damage is in a document somebody owns.
 */

const clean = (type: string, body: string) => {
  const g = parseDiagram(type, body);
  expect(g).not.toBeNull();
  expect(g!.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return g!;
};

const ARCH = `service api "The API" icon=server
store db "Database"

api --> db "reads"`;

describe("freshNodeId", () => {
  it("takes the next free number on the stem", () => {
    expect(freshNodeId(ARCH, "service")).toBe("service2");
  });

  it("avoids every word in the body, not only the declared ids", () => {
    expect(freshNodeId(`${ARCH}\nservice service2 "Taken"`, "service")).toBe("service3");
  });

  it("strips a trailing number off the stem rather than stacking one on", () => {
    expect(freshNodeId(ARCH, "api9")).toBe("api2");
  });
});

describe("grow", () => {
  it("puts the card straight after the one it grew from, and the edge at the end", () => {
    const made = grow("arch", ARCH, undefined, "api", { side: "e", edge: true })!;
    expect(made.id).toBe("service2");
    expect(made.body).toBe(`service api "The API" icon=server
service service2 "New service"
store db "Database"

api --> db "reads"
api --> service2`);
    clean("arch", made.body);
  });

  it("keeps the kind word the author wrote, not the renderer's kind", () => {
    const made = grow("arch", ARCH, undefined, "db", { side: "e", edge: true })!;
    expect(made.body).toContain('store store2 "New store"');
  });

  it("points the edge back when the handle was on the west or north side", () => {
    for (const side of ["w", "n"] as const) {
      const made = grow("arch", ARCH, undefined, "api", { side, edge: true })!;
      expect(made.body.trimEnd().endsWith(`${made.id} --> api`)).toBe(true);
    }
  });

  it("stays inside the group the picked card is in", () => {
    const body = `group gcp "Google Cloud" {
  service api "The API"
}

client browser "Browser"
browser --> api`;
    const made = grow("arch", body, undefined, "api", { side: "e", edge: true })!;
    expect(made.body).toContain('  service api "The API"\n  service service2 "New service"\n}');
    clean("arch", made.body);
  });

  it("writes the coordinate and no edge for a fixed fence", () => {
    const body = `box a "One" x=0 y=0 w=120 h=48
box b "Two" x=200 y=0 w=120 h=48`;
    const made = grow("sketch", body, undefined, "a", { side: "e", edge: false, at: { x: 152, y: 0 } })!;
    expect(made.body).toContain('box box2 "New box" x=152 y=0');
    expect(made.body).not.toContain("-->");
    clean("sketch", made.body);
  });

  it("refuses a line with no kind word — a mindmap topic has none to copy", () => {
    expect(grow("mindmap", "Root\n  Child", undefined, "root", { side: "e", edge: true })).toBeNull();
  });

  it("refuses an id the body does not declare", () => {
    expect(grow("arch", ARCH, undefined, "nope", { side: "e", edge: true })).toBeNull();
  });
});

describe("appendEdge", () => {
  it("joins a run of edges with no blank line between them", () => {
    expect(appendEdge("a --> b", "b --> c")).toBe("a --> b\nb --> c");
  });

  it("puts a line of air after a declaration", () => {
    expect(appendEdge('service a "A"', "a --> b")).toBe('service a "A"\n\na --> b');
  });

  it("is the whole body when the body is empty", () => {
    expect(appendEdge("", "a --> b")).toBe("a --> b");
    expect(appendEdge("\n\n", "a --> b")).toBe("a --> b");
  });
});

describe("detach", () => {
  const laid = (nodes: LaidOut["nodes"], groups: LaidOut["groups"] = {}): LaidOut => ({ nodes, groups });

  it("writes every card's coordinate as the layout placed it", () => {
    const g = clean("arch", ARCH);
    const out = detach(g, laid({ api: { x: 0, y: 0, w: 160, h: 64 }, db: { x: 240, y: 0, w: 160, h: 64 } }), ARCH);
    expect(out).toContain('service api "The API" icon=server x=0 y=0');
    expect(out).toContain('store db "Database" x=240 y=0');
    /* The edge is untouched: only declarations carry geometry. */
    expect(out).toContain('api --> db "reads"');
    clean("arch", out);
  });

  it("writes a child against its group's origin, and the group its own box", () => {
    const body = `group gcp "Google Cloud" {
  service api "The API"
}`;
    const g = clean("arch", body);
    const out = detach(g, laid({ api: { x: 116, y: 148, w: 160, h: 64 } }, { gcp: { x: 100, y: 100, w: 200, h: 160 } }), body);
    expect(out).toContain('group gcp "Google Cloud" x=100 y=100 w=200 h=160 {');
    expect(out).toContain('  service api "The API" x=16 y=48');
    clean("arch", out);
  });

  it("rounds, because a board file is a document somebody reads", () => {
    const g = clean("arch", ARCH);
    const out = detach(g, laid({ api: { x: 241.6000000002, y: 0.4, w: 160, h: 64 } }), ARCH);
    expect(out).toContain("x=242 y=0");
  });

  it("round-trips through stripCoords", () => {
    const g = clean("arch", ARCH);
    const out = detach(g, laid({ api: { x: 0, y: 0, w: 160, h: 64 }, db: { x: 240, y: 0, w: 160, h: 64 } }), ARCH);
    expect(stripCoords(out)).toBe(ARCH);
  });

  it("leaves w= and h= alone on the way back — the author sized those, not the layout", () => {
    expect(stripCoords('box a "One" x=8 y=16 w=120 h=48')).toBe('box a "One" w=120 h=48');
  });
});

describe("detachable", () => {
  it("is true of the ELK dialects whose statements can carry a coordinate", () => {
    for (const t of ["arch", "erd", "state", "class", "usecase", "c4"] as const) expect(detachable(t)).toBe(true);
  });

  it("is false where a coordinate would be text nothing reads", () => {
    /* Own-layout dialects ignore it; the four with their own parsers never run `modifiers()`;
       `sketch` and `chart` size by their own box already; and `md`/`image`/`edges` are not diagrams
       at all. */
    for (const t of [
      "flow",
      "activity",
      "sequence",
      "timeline",
      "gitgraph",
      "mindmap",
      "sketch",
      "chart",
      "md",
      "image",
      "edges",
    ] as const) {
      expect(detachable(t)).toBe(false);
    }
  });
});

describe("growable", () => {
  it("is every dialect whose grammar has an edge to write", () => {
    for (const t of ["arch", "erd", "state", "flow", "activity", "class", "usecase", "c4", "mindmap", "sketch"]) {
      expect(growable(t)).toBe(true);
    }
  });

  it("is false for the two models that are not graphs", () => {
    /* A chart has no arrow at all — `web --> mob` in a chart body is `E_UNKNOWN_KIND`, so a `+`
       there would break the chart it was pressed on. A sequence has arrows, but one is a *message*,
       and a plus that quietly said two people talk is a different claim from "a card beside this". */
    expect(growable("chart")).toBe(false);
    expect(growable("sequence")).toBe(false);
  });
});

describe("fixedGraph", () => {
  it("is the sketch and any fence opened layout=fixed", () => {
    expect(fixedGraph({ type: "sketch", body: 'box a "One"', layout: undefined })).not.toBeNull();
    expect(fixedGraph({ type: "arch", body: ARCH, layout: "fixed" })).not.toBeNull();
  });

  it("is null for content the layout owns, whatever its fence says", () => {
    /* A plain arch is ELK's to place, and `md` is prose: neither has a drawing to scale. */
    expect(fixedGraph({ type: "arch", body: ARCH, layout: undefined })).toBeNull();
    expect(fixedGraph({ type: "md", body: "Some words", layout: undefined })).toBeNull();
    /* `layout=fixed` is read and then ignored on a chart — its model is data, not a graph, so
       there is nothing in it that coordinates describe. */
    expect(fixedGraph({ type: "chart", body: `bar\nx Q1\nseries a "A" 1`, layout: "fixed" })).toBeNull();
  });

  it("is null for a body with an error in it — a writer here must never produce one", () => {
    expect(fixedGraph({ type: "sketch", body: 'rectangle a "No such kind"', layout: undefined })).toBeNull();
  });
});

describe("scaleFixed", () => {
  const laid = (nodes: LaidOut["nodes"], groups: LaidOut["groups"] = {}): LaidOut => ({ nodes, groups });

  const SKETCH = `box a "One" x=0 y=0 w=120 h=48
box b "Two" x=200 y=100 w=120 h=48`;
  const sketchLaid = laid({ a: { x: 0, y: 0, w: 120, h: 48 }, b: { x: 200, y: 100, w: 120, h: 48 } });

  it("doubles every shape's geometry when both axes scale by two", () => {
    const g = clean("sketch", SKETCH);
    const out = scaleFixed(g, sketchLaid, SKETCH, 2, 2, 8);
    expect(out).toBe(`box a "One" x=0 y=0 w=240 h=96
box b "Two" x=400 y=200 w=240 h=96`);
    clean("sketch", out);
  });

  it("a side pull writes nothing on the axis that did not move, and leaves what the author wrote", () => {
    const body = `box a "One" x=0 y=0 w=120 h=48
box b "Two" x=200 w=120`;
    const g = clean("sketch", body);
    const out = scaleFixed(g, laid({ a: { x: 0, y: 0, w: 120, h: 48 }, b: { x: 200, y: 32, w: 120, h: 48 } }), body, 2, 1, 8);
    /* `setGeometry` re-appends a rewritten modifier at the end of the run, so the rewritten keys
       travel — which is the writer's own contract, the same one `detach()` answers to. What the
       assertion is about: `b` grows no `y=` and no `h=`, and `a`'s are exactly what they were. */
    expect(out).toBe(`box a "One" y=0 h=48 x=0 w=240
box b "Two" x=400 w=240`);
    clean("sketch", out);
  });

  it("scales nothing when both factors are one", () => {
    const g = clean("sketch", SKETCH);
    expect(scaleFixed(g, sketchLaid, SKETCH, 1, 1, 8)).toBe(SKETCH);
  });

  it("is the body back when there is nothing drawn in it", () => {
    const g = clean("sketch", SKETCH);
    expect(scaleFixed(g, laid({}), SKETCH, 2, 2, 8)).toBe(SKETCH);
  });

  it("scales a child relative to its group, so it keeps its place within the group", () => {
    const body = `group phone "Frame" x=0 y=0 w=320 h=200 {
  button go "Continue" x=24 y=24 w=120
}`;
    const g = clean("sketch", body);
    const out = scaleFixed(
      g,
      laid({ go: { x: 24, y: 24, w: 120, h: 48 } }, { phone: { x: 0, y: 0, w: 320, h: 200 } }),
      body,
      2,
      2,
      8,
    );
    expect(out).toContain('group phone "Frame" x=0 y=0 w=640 h=400 {');
    expect(out).toContain('button go "Continue" x=48 y=48 w=240 h=96');
    clean("sketch", out);
  });

  it("offsets a nested container by its parent's origin before scaling", () => {
    const body = `group outer "Outer" x=100 y=100 w=400 h=300 {
  group inner "Inner" x=40 y=40 w=200 h=120 {
    box a "One" x=16 y=16 w=80 h=32
  }
}`;
    const g = clean("sketch", body);
    const out = scaleFixed(
      g,
      laid(
        { a: { x: 156, y: 156, w: 80, h: 32 } },
        { outer: { x: 100, y: 100, w: 400, h: 300 }, inner: { x: 140, y: 140, w: 200, h: 120 } },
      ),
      body,
      2,
      2,
      8,
    );
    expect(out).toContain('group outer "Outer" x=200 y=200 w=800 h=600 {');
    expect(out).toContain('group inner "Inner" x=80 y=80 w=400 h=240 {');
    expect(out).toContain('box a "One" x=32 y=32 w=160 h=64');
    clean("sketch", out);
  });

  it("clamps the whole drawing to the grid, never one box", () => {
    const body = `box a "Small" x=0 y=0 w=16 h=16
box b "Wide" x=100 y=0 w=200 h=48`;
    const g = clean("sketch", body);
    /* 0.25 would take the smallest shape to 4px, under one grid step: the factor rises to what
       keeps it at 8, and both boxes come down by that same factor — an even drawing stays even. */
    const out = scaleFixed(g, laid({ a: { x: 0, y: 0, w: 16, h: 16 }, b: { x: 100, y: 0, w: 200, h: 48 } }), body, 0.25, 0.25, 8);
    expect(out).toBe(`box a "Small" x=0 y=0 w=8 h=8
box b "Wide" x=50 y=0 w=100 h=24`);
    clean("sketch", out);
  });

  it("scales an arch opened layout=fixed, and the result is geometry in that fence", () => {
    const body = `service api "API" x=0 y=0 w=160 h=64
store db "DB" x=240 y=0 w=160 h=64`;
    const g = parseDiagram("arch", body, undefined, undefined, "fixed")!;
    const out = scaleFixed(g, laid({ api: { x: 0, y: 0, w: 160, h: 64 }, db: { x: 240, y: 0, w: 160, h: 64 } }), body, 2, 1, 8);
    /* `y=`/`h=` are not written on this pull — the author's survive untouched, the rewritten pair
       moves to the end of the run as `setGeometry` writes them. */
    expect(out).toBe(`service api "API" y=0 h=64 x=0 w=320
store db "DB" y=0 h=64 x=480 w=320`);
    /* Parsed again as the fixed fence it lives in, the written coordinates are geometry and not
       something to warn about — which is what makes the result legal in its own document. */
    const again = parseDiagram("arch", out, undefined, undefined, "fixed")!;
    expect(again.diagnostics).toEqual([]);
  });
});

describe("soleCard", () => {
  const item = (type: string, body: string) => ({ type: type as never, body });

  /* A drag on the one card of a one-card item once wrote that card's own coordinate, and the
     frame grew around the gap. One card is the item, in every dialect. */
  it("is true for a diagram that is one card and nothing else", () => {
    expect(soleCard(item("sketch", 'cylinder c "Database" w=200 h=184'))).toBe(true);
    expect(soleCard(item("arch", 'service svc1 "Service" "what runs it" icon=server'))).toBe(true);
    expect(soleCard(item("sequence", "participant a"))).toBe(true);
    expect(soleCard(item("chart", 'bar\nx Q1 Q2\nseries web "Web" 1 2'))).toBe(true);
  });

  it("is false for anything a drop could say something about", () => {
    expect(soleCard(item("sketch", 'box a "A"\nbox b "B"'))).toBe(false);
    expect(soleCard(item("arch", 'group g "G" {\n  service a "A"\n}'))).toBe(false);
    expect(soleCard(item("sequence", "participant a\nparticipant b"))).toBe(false);
  });
});

describe("cornerOf and fileAt", () => {
  const laid: LaidOut = {
    nodes: { a: { x: 24, y: 56, w: 80, h: 40 }, b: { x: 200, y: 0, w: 80, h: 40 } },
    groups: { g: { x: 0, y: 16, w: 160, h: 120 } },
    origin: { x: 480, y: -184 },
  };

  it("finds the drawing's top-left across nodes and groups", () => {
    expect(cornerOf(laid)).toEqual({ x: 0, y: 0 });
    expect(cornerOf({ nodes: { a: { x: 104, y: 16, w: 10, h: 10 } }, groups: {} })).toEqual({ x: 104, y: 16 });
    expect(cornerOf({ nodes: {}, groups: {} })).toEqual({ x: 0, y: 0 });
  });

  it("adds the layout's origin at the top level, and a container's own origin inside one", () => {
    expect(fileAt(laid, laid.nodes.b!, undefined)).toEqual({ x: 680, y: -184 });
    expect(fileAt(laid, laid.nodes.a!, "g")).toEqual({ x: 24, y: 40 });
  });
});

describe("clearSpot", () => {
  /* A still-standing card is how this arrived broken: "Right" stood 200px along, and the new card
     was written at 192 and drawn over it. */
  const row: LaidOut = { nodes: { a: { x: 0, y: 0, w: 176, h: 104 }, b: { x: 200, y: 0, w: 176, h: 104 } }, groups: {} };

  it("is one gap off the picked card when nothing is in the way", () => {
    expect(clearSpot(row, "b", "e", 32)).toEqual({ x: 408, y: 0, w: 176, h: 104 });
    expect(clearSpot(row, "a", "s", 32)).toEqual({ x: 0, y: 136, w: 176, h: 104 });
  });

  it("goes one gap past a card standing where it would land, keeping the direction pulled", () => {
    expect(clearSpot(row, "a", "e", 32)).toEqual({ x: 408, y: 0, w: 176, h: 104 });
    expect(clearSpot(row, "b", "w", 32)).toEqual({ x: -208, y: 0, w: 176, h: 104 });
  });

  it("keeps going past a run of cards, and lets a card off to the side be", () => {
    const run: LaidOut = {
      nodes: {
        a: { x: 0, y: 0, w: 80, h: 40 },
        b: { x: 0, y: 64, w: 80, h: 40 },
        c: { x: 0, y: 136, w: 80, h: 40 },
        side: { x: 200, y: 200, w: 80, h: 40 },
      },
      groups: {},
    };
    expect(clearSpot(run, "a", "s", 32)).toEqual({ x: 0, y: 208, w: 80, h: 40 });
  });

  it("goes into the container it grew in, and around any other one", () => {
    const boxes: LaidOut = {
      nodes: { a: { x: 16, y: 16, w: 80, h: 40 }, z: { x: 316, y: 16, w: 80, h: 40 } },
      groups: { home: { x: 0, y: 0, w: 300, h: 72 }, other: { x: 300, y: 0, w: 120, h: 72 } },
    };
    /* 128 is inside `home` and clear; nudged to 180 it would land on `other`, and goes past it. */
    expect(clearSpot(boxes, "a", "e", 32)!.x).toBe(128);
    const tight: LaidOut = { nodes: { a: boxes.nodes.a! }, groups: { ...boxes.groups, other: { x: 200, y: 0, w: 120, h: 72 } } };
    expect(clearSpot(tight, "a", "e", 32)!.x).toBe(352);
  });

  it("answers nothing for a card the layout has no box for", () => {
    expect(clearSpot(row, "nope", "e", 32)).toBeNull();
  });
});

describe("pinUnplaced", () => {
  /* A lone shape grown east used to jump *below* the card it grew: it had no coordinate, and
     `layoutSketch` places those under everything that has one. */
  it("writes the drawn coordinate on every line that has none, and touches nothing else", () => {
    const body = 'cylinder c "Database" w=200 h=184\nbox b "B" x=400 y=0';
    const graph = parseDiagram("sketch", body)!;
    const laid: LaidOut = {
      nodes: { c: { x: 0, y: 72, w: 200, h: 184 }, b: { x: 400, y: 0, w: 80, h: 40 } },
      groups: {},
      origin: { x: 0, y: 0 },
    };
    const next = pinUnplaced(graph, laid, body);
    expect(next.split("\n")[0]).toBe('cylinder c "Database" w=200 h=184 x=0 y=72');
    expect(next.split("\n")[1]).toBe(body.split("\n")[1]);
    expect(parseDiagram("sketch", next)!.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("is the identity on a drawing where everything is placed", () => {
    const body = 'box a "A" x=0 y=0\nbox b "B" x=200 y=0';
    const laid: LaidOut = { nodes: { a: { x: 0, y: 0, w: 80, h: 40 }, b: { x: 200, y: 0, w: 80, h: 40 } }, groups: {} };
    expect(pinUnplaced(parseDiagram("sketch", body)!, laid, body)).toBe(body);
  });
});

describe("rowLines", () => {
  const ERD = `entity order "Order" {
  id uuid pk
  total numeric   %% money
}`;

  it("lists each row with the line it is written on", () => {
    expect(rowLines(ERD, 1)).toEqual([
      { line: 2, text: "id uuid pk" },
      { line: 3, text: "total numeric" },
    ]);
  });

  it("is empty for a node with no block", () => {
    expect(rowLines('entity order "Order"', 1)).toEqual([]);
  });

  it("lists the rows of a one-line block by their place on the line", () => {
    expect(rowLines('entity order "Order" { id uuid pk; slug text }', 1)).toEqual([
      { line: 1, text: "id uuid pk", nth: 0 },
      { line: 1, text: "slug text", nth: 1 },
    ]);
  });
});
