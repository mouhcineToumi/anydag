import { beforeAll, describe, expect, it } from "vitest";

import type { Graph } from "@/dsl/ir";
import { parseDiagram } from "@/dsl/parse";
import { layoutGraph } from "@/layout/elk";
import { setMeasurer, TableMeasurer } from "@/layout/measure";
import { labelReach, routeReach } from "@/layout/route";
import { sizeGraph, sizeLabels } from "@/layout/size";
import type { Placed } from "@/layout/types";
import { QUALITY_CODES } from "@/quality/codes";
import { scoreGraph } from "@/quality/score";
import theme from "../themes/paper/theme.json";
import type { Theme } from "@/theme/contract";

/**
 * A lane layout's lines and labels are drawn inside its bands (#407).
 *
 * The bands were sized from the cards and the lines routed after, so a loop back from the last
 * column to the first bowed over the top band, and a self-loop stood above its card: past the
 * item's box, where the page clips. "around" came out cut in half at the border, and the scorer's
 * `Q_EDGE_OUTSIDE` — which says a graph layout never earns it — fired on both `flow` and `activity`.
 */

const T = theme as unknown as Theme;

beforeAll(() => setMeasurer(new TableMeasurer()));

async function lay(type: "flow" | "activity", body: string) {
  const graph = parseDiagram(type, body, undefined) as Graph;
  const labels = sizeLabels(graph, T);
  const placed = (await layoutGraph(graph, sizeGraph(graph, T), labels, T.metric)) as Placed;
  return { graph, placed, labels };
}

/** Every line and every label is inside the bands, which are inside the item — strictly, no slack. */
function expectInsideBands(placed: Placed, labels: Record<string, { w: number; h: number }>) {
  expect(placed.lanes.length).toBeGreaterThan(0);
  const bands = {
    left: Math.min(...placed.lanes.map((l) => l.x)),
    top: Math.min(...placed.lanes.map((l) => l.y)),
    right: Math.max(...placed.lanes.map((l) => l.x + l.w)),
    bottom: Math.max(...placed.lanes.map((l) => l.y + l.h)),
  };
  /* Grown from the bands' own box, a reach comes back that box when nothing is past it. */
  expect(routeReach(placed.edges, bands), "a line is past the bands").toEqual(bands);
  expect(labelReach(placed.edges, labels, bands), "a label is past the bands").toEqual(bands);
  expect(bands.right).toBeLessThanOrEqual(placed.size.w);
  expect(bands.bottom).toBeLessThanOrEqual(placed.size.h);
  expect(bands.top).toBeGreaterThanOrEqual(0);
}

const outside = (r: Awaited<ReturnType<typeof lay>>) =>
  scoreGraph(r.graph, r.placed, r.labels, T).findings.filter((f) => f.code === QUALITY_CODES.Q_EDGE_OUTSIDE);

describe("a loop back across the diagram", () => {
  for (const type of ["flow", "activity"] as const) {
    const word = type === "flow" ? "step" : "action";
    const body = `${word} a "A"\n${word} b "B"\n${word} c "C"\na --> b --> c\nc --> a "around"`;

    it(`${type}: is drawn inside the item, with its label`, async () => {
      const r = await lay(type, body);
      expect(outside(r)).toEqual([]);
      expectInsideBands(r.placed, r.labels);
    });
  }

  it("keeps the order and the spacing of the cards", async () => {
    const { placed } = await lay("flow", `step a "A"\nstep b "B"\nstep c "C"\na --> b --> c\nc --> a "around"`);
    const plain = (await lay("flow", `step a "A"\nstep b "B"\nstep c "C"\na --> b --> c`)).placed;
    /* The room is above, so every card moves down by the same amount and nothing else changes. */
    const dy = placed.nodes.a!.y - plain.nodes.a!.y;
    expect(dy).toBeGreaterThan(0);
    expect(dy % T.metric.grid).toBe(0);
    for (const id of ["a", "b", "c"]) {
      expect(placed.nodes[id]!.x).toBe(plain.nodes[id]!.x);
      expect(placed.nodes[id]!.y - plain.nodes[id]!.y).toBe(dy);
    }
    expect(placed.size.h).toBe(plain.size.h + dy);
  });
});

describe("a self-loop", () => {
  it("is drawn inside the item, with its label", async () => {
    const r = await lay("flow", `step a "A"\nstep b "B"\na --> b\nb --> b "again"`);
    expect(outside(r)).toEqual([]);
    expectInsideBands(r.placed, r.labels);
  });

  it("grows the top band only, in a diagram of two lanes", async () => {
    const body = `lane x "X" {\n  step a "A"\n  step b "B"\n}\nlane y "Y" {\n  step c "C"\n}\na --> b --> c\nc --> a "around"\nb --> b "self"`;
    const r = await lay("flow", body);
    expect(outside(r)).toEqual([]);
    expectInsideBands(r.placed, r.labels);
    const [x, y] = r.placed.lanes;
    expect(x!.h).toBeGreaterThan(y!.h);
    expect(y!.y).toBe(x!.y + x!.h + T.metric.lane.bandGap);
  });
});

describe("a loop that already fits", () => {
  it("moves nothing", async () => {
    const body = `step a "Start"\ndecision check "OK?"\nstep fix "Fix"\na --> check\ncheck --> fix "no"`;
    const plain = (await lay("flow", body)).placed;
    const { placed } = await lay("flow", `${body}\nfix --> check "retry"`);
    expect(placed.nodes).toEqual(plain.nodes);
    expect(placed.lanes).toEqual(plain.lanes);
    expect(placed.size).toEqual(plain.size);
  });
});
