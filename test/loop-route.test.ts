import { beforeAll, describe, expect, it } from "vitest";

import type { Graph } from "@/dsl/ir";
import { parseDiagram } from "@/dsl/parse";
import { layoutGraph } from "@/layout/elk";
import { setMeasurer, TableMeasurer } from "@/layout/measure";
import { sizeGraph, sizeLabels } from "@/layout/size";
import type { Placed, RoutedEdge } from "@/layout/types";
import { scoreGraph } from "@/quality/score";
import theme from "../themes/paper/theme.json";
import type { Theme } from "@/theme/contract";

/**
 * A loop between two cards — `a --> b` and `b --> a` — drawn as two strokes side by side.
 *
 * A reported board, verbatim. Both edges tied on the fan's angle at both cards and a
 * stable sort kept the order they were written in at each end, which on two facing sides is
 * opposite halves — so the pair crossed in the gap with a label at the middle of each stroke, one
 * on top of the other. The scorer counted nothing, because two edges sharing a card were excused
 * outright. And the longest label hung past the frame, which was sized from the cards alone.
 */

const T = theme as unknown as Theme;

const BODY = `state raw        "Raw Concept"     "concept = input"
state distilling "Simplifying"     "generate explanation"
state optimal    "Optimal Essence" "irreducible clarity" done

[*] --> raw
raw --> distilling "initial pass"
distilling --> evaluating "draft explanation"
evaluating --> distilling "can reduce further"
evaluating --> optimal "further reduction loses meaning"
optimal --> [*]
state evaluating "Evaluating"      "check clarity & essence"`;

beforeAll(() => setMeasurer(new TableMeasurer()));

async function lay(dir: "TB" | "LR"): Promise<{ graph: Graph; placed: Placed; labels: Record<string, { w: number; h: number }> }> {
  const graph = parseDiagram("state", BODY, dir) as Graph;
  const labels = sizeLabels(graph, T);
  const placed = (await layoutGraph(graph, sizeGraph(graph, T), labels, T.metric)) as Placed;
  return { graph, placed, labels };
}

/** The two ends of a path, read off its `M` and its last pair of numbers. */
function ends(e: RoutedEdge): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const n = e.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  return { from: { x: n[0]!, y: n[1]! }, to: { x: n[n.length - 2]!, y: n[n.length - 1]! } };
}

const byLabel = (placed: Placed, text: string) => placed.edges.find((e) => e.label?.text === text)!;

describe("a loop between two stacked cards", () => {
  it("draws two strokes that do not cross", async () => {
    const { graph, placed, labels } = await lay("TB");
    const down = ends(byLabel(placed, "draft explanation"));
    const up = ends(byLabel(placed, "can reduce further"));
    /* Each stroke keeps its column from one card to the other, and the two columns differ. */
    expect(down.from.x).toBeCloseTo(down.to.x, 0);
    expect(up.from.x).toBeCloseTo(up.to.x, 0);
    expect(Math.abs(down.from.x - up.from.x)).toBeGreaterThan(T.metric.edge.labelOffset);
    expect(scoreGraph(graph, placed, labels, T).totals).toMatchObject({ crossings: 0, labelOverlaps: 0 });
  });

  it("puts each label outside its own stroke", async () => {
    const { placed } = await lay("TB");
    const down = byLabel(placed, "draft explanation");
    const up = byLabel(placed, "can reduce further");
    const [left, right] = ends(down).from.x < ends(up).from.x ? [down, up] : [up, down];
    expect(left.label!.anchor).toBe("end");
    expect(left.label!.x).toBeLessThan(ends(left).from.x);
    expect(right.label!.anchor).toBe("start");
    expect(right.label!.x).toBeGreaterThan(ends(right).from.x);
  });

  it("sizes the drawing to hold its labels, not only its cards", async () => {
    const { placed, labels } = await lay("TB");
    for (const e of placed.edges) {
      if (!e.label || e.label.anchor !== "start") continue;
      expect(e.label.x + labels[e.id]!.w, e.label.text).toBeLessThanOrEqual(placed.size.w);
    }
  });

  it("keeps a label hung left of its stroke inside the drawing, not cut off at the frame", async () => {
    /* The bundle's outer label hangs left, and on a card at the diagram's left edge it ran past the
       origin: drawn outside the item, where `content-visibility` clips it ("…he status back"). */
    const graph = parseDiagram(
      "arch",
      'service a "API"\nservice b "Worker"\na --> b "enqueue a long job name"\nb --> a "report the status back to caller"',
      "TB",
    ) as Graph;
    const labels = sizeLabels(graph, T);
    const placed = (await layoutGraph(graph, sizeGraph(graph, T), labels, T.metric)) as Placed;
    const left = byLabel(placed, "report the status back to caller");
    expect(left.label!.anchor).toBe("end");
    for (const e of placed.edges) {
      if (!e.label) continue;
      const w = labels[e.id]!.w;
      const x0 = e.label.anchor === "start" ? e.label.x : e.label.anchor === "end" ? e.label.x - w : e.label.x - w / 2;
      expect(x0, e.label.text).toBeGreaterThanOrEqual(0);
      expect(x0 + w, e.label.text).toBeLessThanOrEqual(placed.size.w);
    }
  });

  it("does the same across the page: one label above, one below", async () => {
    const { graph, placed, labels } = await lay("LR");
    const out = ends(byLabel(placed, "draft explanation"));
    const back = ends(byLabel(placed, "can reduce further"));
    expect(out.from.y).toBeCloseTo(out.to.y, 0);
    expect(back.from.y).toBeCloseTo(back.to.y, 0);
    const [top, bottom] =
      out.from.y < back.from.y ? [byLabel(placed, "draft explanation"), byLabel(placed, "can reduce further")] : [byLabel(placed, "can reduce further"), byLabel(placed, "draft explanation")];
    expect(top.label!.y).toBeLessThan(ends(top).from.y);
    expect(bottom.label!.y).toBeGreaterThan(ends(bottom).from.y);
    expect(scoreGraph(graph, placed, labels, T).totals).toMatchObject({ crossings: 0, labelOverlaps: 0 });
  });
});
