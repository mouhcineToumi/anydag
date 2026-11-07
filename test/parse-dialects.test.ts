import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { parseBoard } from "@/board/parseBoard";
import { isDiagramType } from "@/board/types";
import { parseChart } from "@/dsl/chart";
import { hasGraph, parseDiagram } from "@/dsl/parse";
import { parseSequence } from "@/dsl/sequence";

const DIR = path.resolve(__dirname, "../boards/local/reference");
const boards = fs.readdirSync(DIR).filter((f) => f.endsWith(".board.md"));

describe("every reference board parses clean", () => {
  for (const file of boards) {
    it(file, () => {
      const board = parseBoard(file.replace(".board.md", ""), fs.readFileSync(path.join(DIR, file), "utf8"));
      expect(board.errors).toEqual([]);

      for (const item of board.items) {
        if (!isDiagramType(item.type)) continue;

        /* `hasGraph()` rather than a second `=== "sequence"`: the models that are not a `Graph` are
           the closed set `OWN_MODEL_TYPES` names, and the way a new one announces itself here is
           this test failing with "has no dialect" — which is exactly what the first chart on a
           reference board did. */
        if (!hasGraph(item.type)) {
          if (item.type === "chart") {
            const chart = parseChart(item.body);
            expect(
              chart.diagnostics.filter((d) => d.severity === "error"),
              `${file} · ${item.id}`,
            ).toEqual([]);
            expect(chart.series.length + chart.slices.length).toBeGreaterThan(0);
            continue;
          }
          const seq = parseSequence(item.body);
          expect(
            seq.diagnostics.filter((d) => d.severity === "error"),
            `${file} · ${item.id}`,
          ).toEqual([]);
          expect(seq.participants.length).toBeGreaterThan(0);
          expect(seq.events.length).toBeGreaterThan(0);
          continue;
        }

        const g = parseDiagram(item.type, item.body, item.dir);
        expect(g, `${item.type} has no dialect`).not.toBeNull();
        const errors = g!.diagnostics.filter((d) => d.severity === "error");
        expect(errors, `${file} · ${item.id}`).toEqual([]);
        expect(g!.nodes.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("erd", () => {
  const g = parseDiagram(
    "erd",
    `
group t "Tenancy" hue=indigo { entity workspace { id uuid pk; slug text; +4 } }
group i "Intake" hue=coral { entity candidate { id uuid pk; workspace_id fk=t; anon_ref int } }
workspace ||--o{ i "workspace_id" quiet
`,
  )!;

  it("reads pk, typed columns and the elision row", () => {
    const rows = g.nodes.find((n) => n.id === "workspace")!.rows;
    expect(rows.map((r) => [r.name, r.detail, r.tags, r.kind])).toEqual([
      ["id", "uuid", ["pk"], "field"],
      ["slug", "text", [], "field"],
      ["4 more columns", undefined, [], "more"],
    ]);
  });

  it("resolves `fk=<group>` to that group's hue", () => {
    const fk = g.nodes.find((n) => n.id === "candidate")!.rows.find((r) => r.tags.includes("fk"))!;
    expect(fk.fkHue).toBe("indigo");
  });

  it("lets an edge target a group, quietly", () => {
    const e = g.edges[0]!;
    expect(e.to.node).toBe("i");
    expect(e.quiet).toBe(true);
    expect([e.tail, e.head]).toEqual(["one", "crow"]);
  });
});

describe("state", () => {
  const g = parseDiagram(
    "state",
    `
state new "New" "stage = \\"new\\""
state hired "Hired" "stage = \\"hired\\"" done
[*] --> new
new --> new "retry"
new & hired --> gone "leave" quiet
state gone "Gone" muted
gone --> [*]
`,
  )!;

  it("makes a pseudostate per occurrence, not per diagram", () => {
    expect(g.nodes.filter((n) => n.kind === "start")).toHaveLength(1);
    expect(g.nodes.filter((n) => n.kind === "end")).toHaveLength(1);
  });

  it("keeps a self-loop", () => {
    expect(g.edges.some((e) => e.from.node === "new" && e.to.node === "new")).toBe(true);
  });

  it("gives converging edges one bus id", () => {
    const bus = g.edges.filter((e) => e.to.node === "gone");
    expect(bus).toHaveLength(2);
    expect(new Set(bus.map((e) => e.bus)).size).toBe(1);
  });
});

describe("class", () => {
  const g = parseDiagram(
    "class",
    `
class A { -store: DocumentStore; +ingest(upload) Candidate }
interface B { +extract(doc) list[Page] }
A ..|> B
`,
  )!;

  it("splits attributes from methods", () => {
    const a = g.nodes.find((n) => n.id === "A")!;
    expect(a.compartments!.map((c) => c.map((r) => r.name))).toEqual([["store"], ["ingest(upload)"]]);
    expect(a.rows.find((r) => r.kind === "attr")!.vis).toBe("-");
    expect(a.rows.find((r) => r.kind === "method")!.detail).toBe("Candidate");
  });

  it("stereotypes an interface and keeps the realisation marker", () => {
    expect(g.nodes.find((n) => n.id === "B")!.stereotype).toBe("«interface»");
    expect(g.edges[0]!.head).toBe("triangle");
    expect(g.edges[0]!.dash).toBe(true);
  });
});

describe("c4", () => {
  const g = parseDiagram(
    "c4",
    `
person p "Learner" "Studies for a certification."
system s "Larkspur" "software system" { container api "API" "FastAPI" "Serves everything." }
p --> api "Uses" "HTTPS"
`,
  )!;

  it("moves a person's second string to the description", () => {
    const p = g.nodes.find((n) => n.id === "p")!;
    expect(p.meta).toBeUndefined();
    expect(p.desc).toBe("Studies for a certification.");
  });

  it("keeps a container's three strings apart", () => {
    const api = g.nodes.find((n) => n.id === "api")!;
    expect([api.title, api.meta, api.desc]).toEqual(["API", "FastAPI", "Serves everything."]);
  });

  it("carries the technology on a second label", () => {
    expect([g.edges[0]!.label, g.edges[0]!.label2]).toEqual(["Uses", "HTTPS"]);
  });
});

describe("usecase", () => {
  const g = parseDiagram(
    "usecase",
    `
actor r "Recruiter"
system s "HunterOS" { usecase UC-01 "Upload a CV" }
r --- UC-01
`,
  )!;
  it("draws an association with no arrowhead at either end", () => {
    expect([g.edges[0]!.head, g.edges[0]!.tail]).toEqual(["none", "none"]);
  });
});

describe("mindmap", () => {
  const g = parseDiagram(
    "mindmap",
    `
root AnyDag
  Structure
    Data model
  Behaviour
`,
  )!;
  it("builds a tree from indentation", () => {
    expect(g.nodes.map((n) => n.title)).toEqual(["AnyDag", "Structure", "Data model", "Behaviour"]);
    expect(g.edges).toHaveLength(3);
  });
  it("gives each branch its own hue and passes it down", () => {
    const [, structure, dataModel, behaviour] = g.nodes;
    expect(structure!.hue).toBe(dataModel!.hue);
    expect(structure!.hue).not.toBe(behaviour!.hue);
  });
});
