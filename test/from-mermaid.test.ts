import { describe, expect, it } from "vitest";

import { detectMermaid } from "../src/dsl/mermaid";
import { fromMermaid } from "../src/dsl/from-mermaid";
import { parseChart, type ChartModel } from "../src/dsl/chart";
import { parseDiagram } from "../src/dsl/parse";
import { parseSequence, type SequenceModel } from "../src/dsl/sequence";
import type { Graph } from "../src/dsl/ir";

/**
 * The property that matters is not "the text looks right" but **what comes out parses clean**.
 *
 * A converter that emits something plausible and broken is worse than none: the author pastes,
 * presses the button, and is handed a fresh crop of diagnostics about a language they did not
 * write. So every case here runs the result back through the real parser and insists on zero
 * errors, and `detectMermaid` insists the output is no longer Mermaid.
 */
function clean(type: string, body: string, dir?: "LR" | "TB"): Graph {
  const model = type === "sequence" ? parseSequence(body) : type === "chart" ? parseChart(body) : parseDiagram(type, body, dir);
  expect(model, `${type} did not parse at all`).not.toBe(null);
  const errors = model!.diagnostics.filter((d) => d.severity === "error");
  expect(errors, `errors in:\n${body}`).toEqual([]);
  expect(detectMermaid(body).fatal, "output still reads as Mermaid").toBe(false);
  return model as Graph;
}

/** The sequence flavour, for the two checks that read participants rather than nodes. */
function cleanSeq(body: string): SequenceModel {
  clean("sequence", body);
  return parseSequence(body);
}

/** And the chart flavour, whose model is not a `Graph` either. */
function cleanChart(body: string): ChartModel {
  clean("chart", body);
  return parseChart(body);
}

describe("flowchart", () => {
  const SRC = `graph LR
  A[Start] --> B{Is it ok?}
  B -->|yes| C[Ship it]
  B -->|no| D[Fix it]
  D --> B
  C --> E((Done))`;

  it("converts shapes, chains and edge labels", () => {
    const out = fromMermaid(SRC)!;
    expect(out.type).toBe("flow");
    expect(out.dir).toBe("LR");
    expect(out.left).toBe(0);
    const graph = clean("flow", out.body, out.dir);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(graph.nodes.find((n) => n.id === "b")!.kind).toBe("decision");
    expect(graph.nodes.find((n) => n.id === "a")!.title).toBe("Start");
    expect(graph.edges).toHaveLength(5);
    expect(graph.edges.find((e) => e.label === "yes")).toBeTruthy();
  });

  it("turns a subgraph into a group", () => {
    const out = fromMermaid(`flowchart TD
  subgraph api [The API]
    H[Handler] --> S[Store]
  end
  C[Client] --> H`)!;
    const graph = clean("flow", out.body, out.dir);
    expect(graph.groups.map((g) => g.id)).toEqual(["api"]);
    expect(graph.groups[0]!.label).toBe("The API");
    expect(graph.nodes.find((n) => n.id === "h")!.group).toBe("api");
    expect(graph.nodes.find((n) => n.id === "c")!.group).toBeUndefined();
  });

  it("splits a chain so each hop can carry its own label", () => {
    const out = fromMermaid("graph LR\n  A --> B --> C")!;
    expect(out.body.trim().split("\n")).toContain("a --> b");
    expect(out.body.trim().split("\n")).toContain("b --> c");
    clean("flow", out.body, out.dir);
  });

  it("keeps what it cannot translate as a comment, and counts it", () => {
    const out = fromMermaid("graph LR\n  A --> B\n  style A fill:#f9f\n  click A callback")!;
    expect(out.left).toBe(2);
    expect(out.body).toContain("%%");
    expect(out.body).toContain("style A fill:#f9f");
    clean("flow", out.body, out.dir);
  });

  it("maps the shapes it has no distinct answer for onto a step", () => {
    const out = fromMermaid("graph TD\n  A([round]) --> B[[sub]] --> C[(db)] --> D>flag]")!;
    const graph = clean("flow", out.body, out.dir);
    expect(graph.nodes.every((n) => n.kind === "step")).toBe(true);
    expect(graph.nodes.map((n) => n.title)).toEqual(["round", "sub", "db", "flag"]);
  });
});

describe("erDiagram", () => {
  const SRC = `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    CUSTOMER {
        string name
        int id PK
        string email
    }
    ORDER {
        int id PK
        int customer_id FK
    }`;

  it("converts relationships and attribute blocks", () => {
    const out = fromMermaid(SRC)!;
    expect(out.type).toBe("erd");
    expect(out.left).toBe(0);
    const graph = clean("erd", out.body);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["customer", "line_item", "order"]);
    const customer = graph.nodes.find((n) => n.id === "customer")!;
    /* Mermaid writes `<type> <name>`; this grammar writes `<name> <type>`. */
    expect(customer.rows.map((r) => r.name)).toEqual(["name", "id", "email"]);
    expect(customer.rows.find((r) => r.name === "id")!.tags).toContain("pk");
    expect(customer.rows.find((r) => r.name === "name")!.detail).toBe("string");
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]!.label).toBe("places");
  });

  it("does not lose a table whose block was never closed", () => {
    const out = fromMermaid("erDiagram\n    A {\n        int id PK")!;
    const graph = clean("erd", out.body);
    expect(graph.nodes.map((n) => n.id)).toEqual(["a"]);
  });
});

describe("sequenceDiagram", () => {
  const SRC = `sequenceDiagram
    actor U as User
    participant W as Web
    participant A as API
    U->>W: click submit
    W->>+A: POST /attempt
    alt correct
        A-->>W: 201 created
    else wrong
        A-->>W: 200 not yet
    end
    deactivate A
    Note over U,W: they wait`;

  it("converts participants, arrows and fragments", () => {
    const out = fromMermaid(SRC)!;
    expect(out.type).toBe("sequence");
    const model = cleanSeq(out.body);
    expect(model.participants.map((p) => p.id)).toEqual(["u", "w", "a"]);
    expect(model.participants[0]!.title).toBe("User");
    expect(model.participants[0]!.kind).toBe("person");
  });

  it("keeps a note as a comment rather than dropping it", () => {
    const out = fromMermaid(SRC)!;
    expect(out.left).toBe(1);
    expect(out.body).toContain("Note over U,W: they wait");
  });
});

describe("pie", () => {
  const SRC = `pie showData
    title Pets adopted by volunteers
    "Dogs" : 386
    "Cats" : 85
    "Rats" : 15`;

  it("converts the rows into slices and `showData` into `values`", () => {
    const out = fromMermaid(SRC)!;
    expect(out.type).toBe("chart");
    const model = cleanChart(out.body);
    expect(model.form).toBe("pie");
    expect(model.slices.map((s) => s.id)).toEqual(["dogs", "cats", "rats"]);
    expect(model.slices.map((s) => s.title)).toEqual(["Dogs", "Cats", "Rats"]);
    expect(model.slices.map((s) => s.value)).toEqual([386, 85, 15]);
    expect(model.values).toBe(true);
    /* The title is the fence's here, so it comes through as a comment and is counted rather than
       being dropped where nobody would see it go. */
    expect(out.left).toBe(1);
    expect(out.body).toContain("title Pets adopted by volunteers");
  });

  it("reads a title off the header line too", () => {
    const out = fromMermaid('pie title Key elements\n  "Calcium" : 42.96\n  "Iron" :  5')!;
    const model = cleanChart(out.body);
    expect(model.form).toBe("pie");
    expect(model.values).toBe(false);
    expect(model.slices.map((s) => s.value)).toEqual([42.96, 5]);
    expect(out.left).toBe(1);
  });

  it("keeps two labels that slug to one id apart", () => {
    const out = fromMermaid('pie\n  "Q1 2024" : 1\n  "Q1-2024" : 2\n  "2025" : 3')!;
    const model = cleanChart(out.body);
    /* An id has to start with a letter — `WORD` allows a digit and `parseChart` would then be
       handed an id that reads as a value everywhere else. */
    expect(model.slices.map((s) => s.id)).toEqual(["q1-2024", "q1-2024-2", "s2025"]);
    expect(model.slices.map((s) => s.title)).toEqual(["Q1 2024", "Q1-2024", "2025"]);
    expect(out.left).toBe(0);
  });

  it("keeps a row it cannot read as a comment", () => {
    const out = fromMermaid('pie\n  "Dogs" : 386\n  Cats : 85')!;
    const model = cleanChart(out.body);
    expect(model.slices).toHaveLength(1);
    expect(out.left).toBe(1);
    expect(out.body).toContain("Cats : 85");
  });
});

describe("xychart-beta", () => {
  const SRC = `xychart-beta
    title "Sales Revenue"
    x-axis [jan, feb, mar]
    y-axis "Revenue (in $)" 4000 --> 11000
    bar [5000, 6000, 7500]
    line [5000, 6000, 7500]`;

  it("converts axes and data lines, and says which series lost its form", () => {
    const out = fromMermaid(SRC)!;
    expect(out.type).toBe("chart");
    const model = cleanChart(out.body);
    expect(model.form).toBe("bar");
    expect(model.categories).toEqual(["jan", "feb", "mar"]);
    expect(model.series.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(model.series[1]!.values).toEqual([5000, 6000, 7500]);
    expect(model.min).toBe(4000);
    expect(model.max).toBe(11000);
    /* The title, the long axis title, and the `line` series drawn as a bar. */
    expect(out.left).toBe(3);
    expect(out.body).toContain("drawn as `bar`");
  });

  it("takes a bar chart on its own with nothing left over", () => {
    const out = fromMermaid("xychart-beta\n  x-axis [a, b, c]\n  bar [1, 2, 3]")!;
    const model = cleanChart(out.body);
    expect(model.form).toBe("bar");
    expect(model.series).toHaveLength(1);
    expect(model.series[0]!.values).toEqual([1, 2, 3]);
    expect(out.left).toBe(0);
  });

  it("carries `horizontal`, a numeric x range and a short axis title as the unit", () => {
    const out = fromMermaid('xychart-beta horizontal\n  x-axis 1 --> 4\n  y-axis "%" 0 --> 100\n  line [10, 20, 30, 40]')!;
    const model = cleanChart(out.body);
    expect(model.form).toBe("line");
    expect(model.horizontal).toBe(true);
    expect(model.categories).toEqual(["1", "2", "3", "4"]);
    expect(model.unit).toBe("%");
    expect(model.min).toBe(0);
    expect(model.max).toBe(100);
    expect(out.left).toBe(0);
  });

  it("keeps a line it does not understand", () => {
    const out = fromMermaid("xychart-beta\n  x-axis [a, b]\n  bar [1, 2]\n  accTitle: Q1 revenue")!;
    const model = cleanChart(out.body);
    expect(model.series).toHaveLength(1);
    expect(out.left).toBe(1);
    expect(out.body).toContain("accTitle: Q1 revenue");
  });
});

describe("the door", () => {
  it("declines anything without a header it knows", () => {
    expect(fromMermaid('service api "x"')).toBe(null);
    expect(fromMermaid("gantt\n  title A project\n  section One")).toBe(null);
    expect(fromMermaid("")).toBe(null);
  });

  /*
   * `pie` is a chart's own form word, and this is the pair of checks that says so: the detector
   * must not call a chart body Mermaid, and the converter must not take one. Both ask one
   * predicate — `mermaidPie` — which is the only way they can agree about the same paste.
   */
  it("does not read a chart body as Mermaid because it starts with `pie`", () => {
    for (const body of ['pie\nslice a "A" 3', 'pie\nslice a "A" 3\nslice b "B" 1\nlegend bottom', 'pie "62%" "share"']) {
      expect(detectMermaid(body).fatal, body).toBe(false);
      expect(fromMermaid(body), body).toBe(null);
      expect(
        parseChart(body).diagnostics.filter((d) => d.severity === "error"),
        body,
      ).toEqual([]);
    }
  });

  it("still knows Mermaid's own pie by its rows or its suffix", () => {
    expect(detectMermaid('pie\n  "Dogs" : 386').fatal).toBe(true);
    expect(detectMermaid("pie title Pets").fatal).toBe(true);
    expect(detectMermaid('pie showData\n  "Dogs" : 386').fatal).toBe(true);
  });

  it("agrees with the detector about what it can take", () => {
    /* Every source the detector calls fatal-Mermaid and this converts must come back clean; that
       pairing is the whole contract, since the button is offered exactly when `fatal` is true. */
    for (const src of [
      "graph LR\n A-->B",
      "erDiagram\n A ||--o{ B : has",
      "sequenceDiagram\n A->>B: hi",
      'pie\n "Dogs" : 386',
      "xychart-beta\n bar [1, 2]",
    ]) {
      expect(detectMermaid(src).fatal, src).toBe(true);
      const out = fromMermaid(src)!;
      expect(out, src).not.toBe(null);
      clean(out.type, out.body, out.dir);
    }
  });
});
