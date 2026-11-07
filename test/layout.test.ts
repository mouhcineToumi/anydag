import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { isDiagramType } from "@/board/types";
import type { Graph } from "@/dsl/ir";
import { hasGraph, parseDiagram } from "@/dsl/parse";
import { layoutGraph } from "@/layout/elk";
import { setMeasurer, TableMeasurer } from "@/layout/measure";
import { sizeGraph, sizeLabels } from "@/layout/size";
import type { Box, Placed } from "@/layout/types";
import theme from "../themes/paper/theme.json";
import type { Theme } from "@/theme/contract";

const T = theme as unknown as Theme;
const DIR = path.resolve(__dirname, "../boards/local/reference");

beforeAll(() => setMeasurer(new TableMeasurer()));

function graphsOf(file: string): { id: string; graph: Graph }[] {
  const board = parseBoard(file, fs.readFileSync(path.join(DIR, file), "utf8"));
  return board.items
    /* The two models that are not a `Graph` have their own invariants — `sequence.test.ts` and
       `chart.test.ts` — and `hasGraph()` is the closed set rather than a literal per type. */
    .filter((it) => isDiagramType(it.type) && hasGraph(it.type))
    .map((it) => ({ id: it.id, graph: parseDiagram(it.type, it.body, it.dir)! }))
    .filter((x) => x.graph !== null);
}

const run = (g: Graph): Promise<Placed> => layoutGraph(g, sizeGraph(g, T), sizeLabels(g, T), T.metric);

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, b: Box) =>
  a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;

/* A board with no graph items (the sequence one) would make an empty suite, which vitest fails. */
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".board.md") && graphsOf(f).length > 0);

describe.each(files)("%s", (file) => {
  for (const { id, graph } of graphsOf(file)) {
    it(`${id}: places every node, and none of them touch`, async () => {
      const placed = await run(graph);
      /* A pseudostate can share a point with nothing; every declared node must have a box. */
      for (const n of graph.nodes) expect(placed.nodes[n.id], `${n.id} was not placed`).toBeDefined();

      const boxes = Object.entries(placed.nodes);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const [aId, a] = boxes[i]!;
          const [bId, b] = boxes[j]!;
          expect(overlaps(a, b), `${aId} overlaps ${bId}`).toBe(false);
        }
      }
    });

    it(`${id}: keeps every node inside its group`, async () => {
      const placed = await run(graph);
      const groupBox = new Map(placed.groups.map((g) => [g.id, g]));
      for (const n of graph.nodes) {
        if (!n.group) continue;
        const box = placed.nodes[n.id];
        const parent = groupBox.get(n.group);
        if (!box || !parent) continue;
        /* A strip marks a span rather than containing anything — a timeline section sits above its
           entries on purpose, so containment is not the invariant there. */
        if (parent.strip) continue;
        expect(inside(box, parent), `${n.id} escapes ${n.group}`).toBe(true);
      }
    });

    it(`${id}: anchors every edge on a boundary, and is deterministic`, async () => {
      const a = await run(graph);
      const b = await run(graph);
      expect(JSON.stringify(b.nodes), "the same input laid out twice").toBe(JSON.stringify(a.nodes));

      for (const e of a.edges) {
        expect(e.d.startsWith("M"), `${e.id} has no path`).toBe(true);
        expect(e.d).not.toContain("NaN");
      }
    });

    it(`${id}: snaps to the grid`, async () => {
      const placed = await run(graph);
      /* Lane layouts do their own arithmetic and are exact by construction; ELK's output is what
         needs snapping, and it is the only thing checked here. */
      if (placed.lanes.length > 0) return;
      for (const [nid, box] of Object.entries(placed.nodes)) {
        expect(box.x % T.metric.grid, `${nid}.x is off-grid`).toBe(0);
        expect(box.y % T.metric.grid, `${nid}.y is off-grid`).toBe(0);
      }
    });
  }
});

/*
 * A loop in a swimlane lands after the decision it returns to.
 *
 * Longest-path layering has no answer for a cycle, and the first answer — cut it wherever the
 * recursion happened to meet itself — memoised whatever depth the loop's body had reached by
 * then. Ask for the decision's column before the body's and the body came out at columns one
 * and two, on the far side of the diagram from the decision it retries, with an edge across
 * every lane to say so. An agent drawing an onboarding flow unrolled its retry loop to make that
 * go away, which is the wrong fix on the wrong side. The back edges are found first now.
 */
describe("a lane loop", () => {
  const src = `
lane a "A" {
  step start "Start"
  step done "Done"
}
lane b "B" {
  step ship "Ship"
  decision check "OK?"
  step fix "Fix"
  step retry "Retry"
}
start --> ship --> check
check --> done "yes"
check --> fix "no"
fix --> retry --> check
`;

  it("puts the loop body after the decision, whichever node is asked first", async () => {
    const g = parseDiagram("flow", src, undefined)!;
    const placed = await run(g);
    const x = (id: string) => placed.nodes[id]!.x;
    expect(x("fix")).toBeGreaterThan(x("check"));
    expect(x("retry")).toBeGreaterThan(x("fix"));
    expect(x("done")).toBeGreaterThan(x("check"));
  });
});

/*
 * `col=` pins a card's layer, and pins nothing else.
 *
 * The one knob F4 gave ELK, and the one thing about a layered layout a person can say that a
 * coordinate cannot — see `Node.col`. What it must *not* do is take over: ELK still chooses the
 * order within the layer, the spacing, and every other card's layer. And on a board where nobody
 * wrote one the option must be *absent* rather than merely inert, which is what the frozen
 * `route-quality` totals over the reference boards are the evidence for.
 */
describe("col=", () => {
  const chain = (extra = "") =>
    ['service a "A"', 'service b "B"', `service c "C"${extra}`, "", "a --> b --> c"].join("\n");

  /*
   * **The number is a rank, not an index**, and this is where that was found out.
   *
   * ELK's partitioning constrains the *relative* order of the partitions and then compacts: a lone
   * `col=4` on the last card of a three-card chain moves nothing at all, because there is no other
   * partition for it to come after. So `col=` says "this card is not before that one", which is
   * the useful half, and does not say "this card is fourth along". The panel offers the layer a
   * card is drawn in, which is a good number to start from and not a promise about the answer.
   */
  it("is a rank among the cards that carry one, so a lone number compacts away", async () => {
    const placed = await run(parseDiagram("arch", chain(" col=4"), "LR", 0)!);
    const free = await run(parseDiagram("arch", chain(), "LR", 0)!);
    expect(placed.nodes["c"]!.x).toBe(free.nodes["c"]!.x);
  });

  it("orders two pinned cards against each other, whatever the edge between them says", async () => {
    const src2 = ['service a "A" col=2', 'service b "B" col=0', "", "a --> b"].join("\n");
    const placed = await run(parseDiagram("arch", src2, "LR", 0)!);
    expect(placed.nodes["b"]!.x).toBeLessThan(placed.nodes["a"]!.x);
  });

  it("leaves the cards that carry none to ELK", async () => {
    const src2 = ['service a "A"', 'service b "B" col=3', 'service c "C"', "", "a --> b --> c"].join("\n");
    const placed = await run(parseDiagram("arch", src2, "LR", 0)!);
    expect(placed.nodes["a"]!.x).toBeLessThan(placed.nodes["b"]!.x);
    expect(placed.nodes["c"]!.x).toBeGreaterThan(placed.nodes["b"]!.x);
  });

  it("reaches a card inside a group under `separate`, where the group runs its own pass", async () => {
    const src2 = [
      'group d "Domain" {',
      '  entity a "A"',
      '  entity b "B"',
      '  entity c "C" col=0',
      "}",
      "a --> b",
    ].join("\n");
    const placed = await run(parseDiagram("erd", src2, undefined)!);
    /* An ERD's groups run DOWN, so a layer is a row: `col=0` puts `c` level with or above `a`. */
    expect(placed.nodes["c"]!.y).toBeLessThanOrEqual(placed.nodes["a"]!.y);
  });
});
