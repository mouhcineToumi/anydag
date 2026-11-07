import { describe, expect, it } from "vitest";

import { dateLike, redate } from "../src/dsl/graph/timeline";
import { parseChart } from "../src/dsl/chart";
import { parseDiagram } from "../src/dsl/parse";
import { moveTopic, topicSpan } from "../src/dsl/restate";
import type { LaidOut } from "../src/edit/build";
import { axisOf, columnOf, dragMode, dropBody, dropEdit, layered, type Drop, type Over } from "../src/edit/drag";

/**
 * F4's pure half: what a drop *means*, with no pointer anywhere in it.
 *
 * The gesture is in `useEditor` and is checked by `e2e/drag.spec.ts`, which reads the bytes on
 * disk. What is here is the arithmetic underneath — which statement moves and where to — checked
 * the way `build.test.ts` checks a `+`: read the text back, and insist the result still parses.
 * A drag that writes a body the parser rejects is damage to a document somebody owns.
 */

const clean = (type: string, body: string, dir?: "LR" | "TB", layout?: "fixed") => {
  const g = parseDiagram(type, body, dir, undefined, layout);
  expect(g).not.toBeNull();
  expect(g!.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return g!;
};

const box = (x: number, y: number, w = 100, h = 40) => ({ x, y, w, h });

/** The fields every fixed drop below leaves alone. */
const base = { dir: undefined, over: { what: "frame", id: "x" } as Over, half: { x: 0.5, y: 0.5 }, grid: 8 };

/** A drop with everything a case does not care about already answered. */
function drop(over: Over, more: Partial<Drop> & Pick<Drop, "type" | "body" | "node">): string | null {
  return dropBody({
    dir: undefined,
    laid: { nodes: {}, groups: {} },
    half: { x: 0.9, y: 0.9 },
    by: { x: 0, y: 0 },
    grid: 8,
    over,
    ...more,
  });
}

/* ------------------------------------------------------------------------------- the modes */

describe("dragMode", () => {
  it("reads a coordinate fence as coordinates, whichever way it said so", () => {
    expect(dragMode("sketch")).toBe("fixed");
    expect(dragMode("arch", "fixed")).toBe("fixed");
  });

  it("gives the four own-layout dialects their own reading", () => {
    expect(dragMode("timeline")).toBe("date");
    expect(dragMode("sequence")).toBe("order");
    expect(dragMode("gitgraph")).toBe("none");
    expect(dragMode("flow")).toBe("structure");
  });

  it("reads a chart as an order, because a chart's one axis is its declaration order", () => {
    expect(dragMode("chart")).toBe("order");
  });

  it("is structural everywhere else", () => {
    for (const t of ["arch", "erd", "state", "class", "usecase", "c4", "mindmap"]) {
      expect(dragMode(t)).toBe("structure");
    }
  });
});

describe("layered", () => {
  it("is the ELK diagrams and nothing else — `col=` says nothing anywhere else", () => {
    expect(layered("arch")).toBe(true);
    expect(layered("erd")).toBe(true);
    expect(layered("arch", "fixed")).toBe(false);
    expect(layered("flow")).toBe(false);
    expect(layered("activity")).toBe(false);
    expect(layered("mindmap")).toBe(false);
    expect(layered("timeline")).toBe(false);
    expect(layered("gitgraph")).toBe(false);
    expect(layered("chart")).toBe(false);
  });
});

describe("axisOf", () => {
  it("reads the axis off the drawing, not off the diagram's direction", () => {
    /* A group running DOWN inside a diagram running RIGHT: `dir` says LR and the drawing says y. */
    expect(axisOf(box(0, 80), [box(0, 0), box(0, 160)], "LR")).toBe("y");
    expect(axisOf(box(160, 0), [box(0, 0), box(320, 0)], "TB")).toBe("x");
  });

  it("asks the nearest neighbour, not the whole spread", () => {
    /* Two branches stacked down, off one decision to the left: the pair being chosen between is
       the two branches, and a third card in the previous layer must not swing the axis. */
    expect(axisOf(box(200, 80), [box(0, 40), box(200, 0)], "LR")).toBe("y");
  });

  it("falls back to the direction when there is nothing to read", () => {
    expect(axisOf(box(0, 0), [], "TB")).toBe("y");
    expect(axisOf(box(0, 0), [box(0, 0)], undefined)).toBe("x");
  });
});

describe("columnOf", () => {
  const laid: LaidOut = {
    nodes: { a: box(0, 0), b: box(200, 0), c: box(200, 80), d: box(400, 0) },
    groups: {},
  };

  it("counts the distinct leading edges across the flow", () => {
    expect(columnOf(laid, "a", "LR")).toBe(0);
    expect(columnOf(laid, "b", "LR")).toBe(1);
    expect(columnOf(laid, "c", "LR")).toBe(1);
    expect(columnOf(laid, "d", "LR")).toBe(2);
  });

  it("counts down the page for a TB diagram", () => {
    expect(columnOf(laid, "c", "TB")).toBe(1);
  });

  it("has no answer for a card the layout has not placed", () => {
    expect(columnOf(laid, "nope", "LR")).toBeNull();
  });
});

/* ------------------------------------------------------------------------ moving a statement */

const ARCH = `service api "The API"
store db "Database"

group gcp "Google Cloud" {
  service jobs "Jobs"
  service queue "Queue"
}

api --> db`;

describe("a structural drop", () => {
  it("moves a card into the group whose box it was dropped on, at the end", () => {
    const next = drop({ what: "group", id: "gcp" }, { type: "arch", body: ARCH, node: "db" })!;
    expect(next).toContain('  service queue "Queue"\n  store db "Database"\n}');
    clean("arch", next);
  });

  it("lands beside the card it was dropped on, which is how it gets inside a group", () => {
    const next = drop({ what: "node", id: "jobs" }, { type: "arch", body: ARCH, node: "db" })!;
    /* Dropped on the trailing half, so after — and re-indented to the block it landed in. */
    expect(next).toContain('  service jobs "Jobs"\n  store db "Database"');
    clean("arch", next);
  });

  it("lands before it when the pointer is in the leading half", () => {
    const next = drop({ what: "node", id: "queue" }, { type: "arch", body: ARCH, node: "db", half: { x: 0.1, y: 0.1 } })!;
    expect(next).toContain('  service jobs "Jobs"\n  store db "Database"\n  service queue "Queue"');
    clean("arch", next);
  });

  it("puts it at the head of the block when there is nothing before the target", () => {
    const next = drop({ what: "node", id: "jobs" }, { type: "arch", body: ARCH, node: "db", half: { x: 0.1, y: 0.1 } })!;
    expect(next).toContain('group gcp "Google Cloud" {\n  store db "Database"\n  service jobs "Jobs"');
    clean("arch", next);
  });

  it("takes a card out of its group when it lands on the frame's own padding", () => {
    const inside = drop({ what: "group", id: "gcp" }, { type: "arch", body: ARCH, node: "db" })!;
    const out = drop({ what: "frame", id: "x" }, { type: "arch", body: inside, node: "db" })!;
    /* Back at the top, after the last thing declared there — the group — and not above the file. */
    expect(out).toMatch(/\}\n+store db "Database"/);
    clean("arch", out);
  });

  it("moves a card to the end of the group it is already in, which is a reorder", () => {
    const next = drop({ what: "group", id: "gcp" }, { type: "arch", body: ARCH, node: "jobs" })!;
    expect(next).toContain('  service queue "Queue"\n  service jobs "Jobs"\n}');
    clean("arch", next);
  });

  it("refuses to put a container inside itself", () => {
    const nested = `group outer "Outer" {\n  group inner "Inner" {\n    service a "A"\n  }\n}`;
    expect(drop({ what: "group", id: "inner" }, { type: "arch", body: nested, node: "outer" })).toBeNull();
    expect(drop({ what: "node", id: "a" }, { type: "arch", body: nested, node: "outer" })).toBeNull();
  });

  it("writes nothing when the drop would not move anything", () => {
    /* `queue` after `jobs` is where `queue` already is. */
    expect(drop({ what: "node", id: "jobs" }, { type: "arch", body: ARCH, node: "queue" })).toBeNull();
  });

  it("writes nothing when the pointer left the diagram", () => {
    expect(drop(null, { type: "arch", body: ARCH, node: "db" })).toBeNull();
  });

  it("reorders two siblings in a state machine, which under aspect=0 is the layout", () => {
    const body = `state draft "Draft"\nstate review "Review"\nstate live "Live"\n\ndraft --> review\nreview --> live`;
    const next = drop({ what: "node", id: "live" }, { type: "state", body, node: "draft" })!;
    expect(next.split("\n").slice(0, 3)).toEqual(['state review "Review"', 'state live "Live"', 'state draft "Draft"']);
    clean("state", next);
  });
});

describe("a lane", () => {
  const FLOW = `lane user "Person" {
  step ask "Ask"
}

lane system "HunterOS" {
  step parse "Parse"
  step store "Store"
}

ask --> parse`;

  it("moves a step into the band it was dropped on", () => {
    const next = drop({ what: "lane", id: "system" }, { type: "flow", body: FLOW, node: "ask" })!;
    expect(next).toContain('  step store "Store"\n  step ask "Ask"\n}');
    expect(next).toContain('lane user "Person" {\n}');
    clean("flow", next);
  });

  it("reorders within a band when it lands on a step in it", () => {
    const next = drop({ what: "node", id: "store" }, { type: "flow", body: FLOW, node: "parse" })!;
    expect(next).toContain('  step store "Store"\n  step parse "Parse"');
    clean("flow", next);
  });
});

/* ------------------------------------------------------------------------------- the mindmap */

const MAP = `root AnyDag
  Dialects
    Arch
    Erd
  Editing
    Drag`;

describe("topicSpan", () => {
  it("is the topic and everything indented under it", () => {
    expect(topicSpan(MAP, 2)).toEqual({ from: 2, to: 4 });
    expect(topicSpan(MAP, 3)).toEqual({ from: 3, to: 3 });
    expect(topicSpan(MAP, 1)).toEqual({ from: 1, to: 6 });
  });
});

describe("moveTopic", () => {
  it("re-parents a topic and its subtree, re-indenting the whole of it", () => {
    const next = moveTopic(MAP, 2, 5);
    expect(next).toBe(`root AnyDag
  Editing
    Drag
    Dialects
      Arch
      Erd`);
  });

  it("refuses to put a topic under something in its own subtree", () => {
    expect(moveTopic(MAP, 2, 3)).toBe(MAP);
  });
});

describe("a mindmap drop", () => {
  /* The ids are the parser's, and its counter is shared with the edges it invents: `m1` is
     Dialects and Editing is `m7`, not `m4`. */
  it("re-parents the topic under the one it landed on", () => {
    const next = drop({ what: "node", id: "m1" }, { type: "mindmap", body: MAP, node: "m7" })!;
    expect(next).toContain("  Dialects\n    Arch\n    Erd\n    Editing\n      Drag");
    clean("mindmap", next);
  });

  it("refuses a drop on the frame — depth 0 is the root, and there is one", () => {
    expect(drop({ what: "frame", id: "x" }, { type: "mindmap", body: MAP, node: "m7" })).toBeNull();
  });
});

/* ------------------------------------------------------------------------------ the timeline */

describe("dateLike", () => {
  const AT = Date.UTC(2027, 2, 20);
  it("writes a day at day precision", () => expect(dateLike("2026-01-01", AT)).toBe("2027-03-20"));
  it("rounds to the nearest month at month precision", () => expect(dateLike("2026-01", AT)).toBe("2027-04"));
  it("rounds to the nearest year at year precision", () => expect(dateLike("2026", AT)).toBe("2027"));
  it("rounds a January day back to the same year", () => expect(dateLike("2026", Date.UTC(2027, 0, 4))).toBe("2027"));
});

describe("redate", () => {
  it("keeps the label, the flags and the indent", () => {
    expect(redate('  2026-09 "Design system" done', Date.UTC(2027, 0, 1))).toBe('  2027-01 "Design system" done');
  });

  it("moves a range rather than stretching it", () => {
    expect(redate('2026-01 .. 2026-03 "Build"', Date.UTC(2026, 5, 1))).toBe('2026-06 .. 2026-08 "Build"');
  });

  it("hands back nothing for a line that is not an entry", () => {
    expect(redate('section "2026 H2"', Date.UTC(2026, 0, 1))).toBeNull();
  });
});

describe("a timeline drop", () => {
  const TL = `section "Year one"\n  2026-01-01 "Kickoff"\n  2026-04-01 "Beta"`;
  /* 900px across a 90-day span: ten pixels a day, which makes the arithmetic readable. */
  const laid: LaidOut = {
    nodes: { t1: box(0, 0), t2: box(900, 0) },
    groups: {},
    scale: { min: Date.UTC(2026, 0, 1), span: 90 * 86_400_000, px: 900 },
  };

  it("turns a sideways drag into a date, snapped to a day", () => {
    const next = drop({ what: "node", id: "t2" }, { type: "timeline", body: TL, node: "t1", laid, by: { x: 100, y: 0 } })!;
    expect(next).toContain('2026-01-11 "Kickoff"');
    clean("timeline", next);
  });

  it("has nothing to say without the scale the layout publishes", () => {
    expect(drop({ what: "node", id: "t2" }, { type: "timeline", body: TL, node: "t1", by: { x: 100, y: 0 } })).toBeNull();
  });
});

/* ------------------------------------------------------------------------------ the sequence */

describe("a sequence drop", () => {
  const SEQ = `participant learner "Learner"
participant api "API"
participant db "Store"

learner ->> api "sign in"
api ->> db "read"`;

  it("moves a participant past the neighbour it was dropped on", () => {
    const next = drop({ what: "node", id: "db" }, { type: "sequence", body: SEQ, node: "learner" })!;
    expect(next.split("\n").slice(0, 3)).toEqual([
      'participant api "API"',
      'participant db "Store"',
      'participant learner "Learner"',
    ]);
  });

  it("lands before it on the leading half, past the messages in between", () => {
    const next = drop({ what: "node", id: "db" }, { type: "sequence", body: SEQ, node: "learner", half: { x: 0.2, y: 0.5 } })!;
    expect(next.split("\n").slice(0, 3)).toEqual([
      'participant api "API"',
      'participant learner "Learner"',
      'participant db "Store"',
    ]);
  });
});

/* -------------------------------------------------------------------------------- the chart */

describe("a chart drop", () => {
  const CHART = `bar
x Q1 Q2 Q3
series web "Web" 120 140 160
series mob "Mobile" 40 60 90
unit "k"`;

  /** A chart has no graph, so `clean` cannot ask `parseDiagram`; the dialect's own parser can. */
  const parses = (body: string) => {
    expect(parseChart(body).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    return body;
  };

  it("moves a series past the one it was dropped on", () => {
    const next = drop({ what: "node", id: "mob" }, { type: "chart", body: CHART, node: "web" })!;
    expect(parses(next).split("\n")).toEqual([
      "bar",
      "x Q1 Q2 Q3",
      'series mob "Mobile" 40 60 90',
      'series web "Web" 120 140 160',
      'unit "k"',
    ]);
  });

  it("lands before it on the leading half, after the last line that says something", () => {
    /* `web` is the first declaration, so there is no previous one to land after — and `toTop` would
       put a data line in front of the statement that says what shape the chart is. */
    const next = drop({ what: "node", id: "web" }, { type: "chart", body: CHART, node: "mob", half: { x: 0.2, y: 0.5 } })!;
    expect(parses(next).split("\n")).toEqual([
      "bar",
      "x Q1 Q2 Q3",
      'series mob "Mobile" 40 60 90',
      'series web "Web" 120 140 160',
      'unit "k"',
    ]);
  });

  it("puts a slice before the first one after the `x` line, never above the form", () => {
    const body = `pie\nslice a "A" 1\nslice b "B" 2`;
    const next = drop({ what: "node", id: "a" }, { type: "chart", body, node: "b", half: { x: 0.1, y: 0.5 } })!;
    expect(parses(next).split("\n")).toEqual(["pie", 'slice b "B" 2', 'slice a "A" 1']);
  });

  it("writes nothing when the pointer left the chart, or landed on the thing it is dragging", () => {
    expect(drop(null, { type: "chart", body: CHART, node: "web" })).toBeNull();
    expect(drop({ what: "node", id: "web" }, { type: "chart", body: CHART, node: "web" })).toBeNull();
  });
});

/* --------------------------------------------------------------------------- fixed and none */

describe("a fixed drop", () => {
  const WIRE = `box hero "Hero" x=0 y=0 w=160 h=64\nbox foot "Foot" x=0 y=200 w=160 h=64`;
  const laid: LaidOut = { nodes: { hero: box(0, 0, 160, 64), foot: box(0, 200, 160, 64) }, groups: {} };

  /* `setGeometry` takes each key off and puts it back at the end of the line, which is why the
     order changes and why only one card's line does. */
  it("writes the coordinate, snapped to the grid", () => {
    const next = drop({ what: "frame", id: "x" }, { type: "sketch", body: WIRE, node: "hero", laid, by: { x: 43, y: 11 } })!;
    expect(next.split("\n")[0]).toBe('box hero "Hero" w=160 h=64 x=40 y=8');
    expect(next.split("\n")[1]).toBe('box foot "Foot" x=0 y=200 w=160 h=64');
    clean("sketch", next);
  });

  it("writes it relative to the container, which is how `layoutSketch` reads one", () => {
    const body = `group card "Card" x=100 y=100 w=300 h=200 {\n  box hero "Hero" x=0 y=0 w=160 h=64\n}`;
    const inner: LaidOut = { nodes: { hero: box(100, 100, 160, 64) }, groups: { card: box(100, 100, 300, 200) } };
    const next = drop({ what: "frame", id: "x" }, { type: "sketch", body, node: "hero", laid: inner, by: { x: 80, y: 0 } })!;
    expect(next).toContain('  box hero "Hero" w=160 h=64 x=80 y=0');
    clean("sketch", next);
  });

  it("does the same in an ordinary fence opened `layout=fixed`", () => {
    const body = `service api "The API" x=0 y=0`;
    const one: LaidOut = { nodes: { api: box(0, 0) }, groups: {} };
    const next = drop(
      { what: "frame", id: "x" },
      { type: "arch", body, node: "api", layout: "fixed", laid: one, by: { x: 64, y: 64 } },
    )!;
    expect(next).toContain("x=64 y=64");
  });

  /* The layout draws the drawing's corner at 0,0 and says in `origin` where the file put it. A
     drop that wrote the layout's number back as the file's moved a card by the difference as well
     as by the drag: 104px for an 8px drag in the sketch below. */
  it("writes the file's number, not the layout's, when the drawing does not start at 0,0", () => {
    const body = `box a "A" x=-96 y=0 w=80 h=40\nbox b "B" x=200 y=0 w=80 h=40`;
    const laid: LaidOut = { nodes: { a: box(0, 0, 80, 40), b: box(296, 0, 80, 40) }, groups: {}, origin: { x: -96, y: 0 } };
    const next = dropEdit({ ...base, type: "sketch", body, node: "b", laid, by: { x: 8, y: 0 } })!;
    expect(next.body.split("\n")[1]).toBe('box b "B" w=80 h=40 x=208 y=0');
    expect(next.shift).toEqual({ x: 0, y: 0 });
  });

  /* The frame hugs the drawing, so moving its corner moves everything else the other way unless
     the item moves too: `shift` is how far, and the caller writes it on the fence in the same op. */
  it("says how far the drawing's corner moved, so the fence can move with it", () => {
    const body = `box a "A" x=0 y=0 w=80 h=40\nbox b "B" x=200 y=100 w=80 h=40`;
    const laid: LaidOut = { nodes: { a: box(0, 0, 80, 40), b: box(200, 100, 80, 40) }, groups: {}, origin: { x: 0, y: 0 } };
    /* The leftmost card, dragged right past nothing: the corner is now b's x and a's new y. */
    const right = dropEdit({ ...base, type: "sketch", body, node: "a", laid, by: { x: 120, y: 40 } })!;
    expect(right.shift).toEqual({ x: 120, y: 40 });
    /* Out past the top-left: the corner goes to where the card landed, snapped. */
    const out = dropEdit({ ...base, type: "sketch", body, node: "b", laid, by: { x: -240, y: -160 } })!;
    expect(out.shift).toEqual({ x: -40, y: -56 });
    /* Inside the drawing, the corner stays where it is. */
    const inside = dropEdit({ ...base, type: "sketch", body, node: "b", laid, by: { x: -40, y: 0 } })!;
    expect(inside.shift).toEqual({ x: 0, y: 0 });
  });

  it("moves a container's children with it when it works out where the corner went", () => {
    const body = `group card "Card" x=0 y=0 w=200 h=120 {\n  box hero "Hero" x=16 y=16 w=80 h=40\n}\nbox side "Side" x=240 y=0 w=80 h=40`;
    const laid: LaidOut = {
      nodes: { hero: box(16, 16, 80, 40), side: box(240, 0, 80, 40) },
      groups: { card: box(0, 0, 200, 120) },
      origin: { x: 0, y: 0 },
    };
    const next = dropEdit({ ...base, type: "sketch", body, node: "card", laid, by: { x: 400, y: 0 } })!;
    expect(next.body.split("\n")[0]).toContain("x=400 y=0");
    expect(next.shift).toEqual({ x: 240, y: 0 });
  });
});

describe("gitgraph", () => {
  it("refuses every drop — a column is a commit and a lane is a branch", () => {
    const body = `commit "one"\nbranch feature\ncommit "two"`;
    expect(drop({ what: "node", id: "c1" }, { type: "gitgraph", body, node: "c0" })).toBeNull();
    expect(drop({ what: "frame", id: "x" }, { type: "gitgraph", body, node: "c0" })).toBeNull();
  });
});
