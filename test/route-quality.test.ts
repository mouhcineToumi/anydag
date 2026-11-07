import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { isDiagramType } from "@/board/types";
import type { Graph } from "@/dsl/ir";
import { parseDiagram } from "@/dsl/parse";
import { layoutGraph } from "@/layout/elk";
import { setMeasurer, TableMeasurer } from "@/layout/measure";
import { sizeGraph, sizeLabels } from "@/layout/size";
import theme from "../themes/paper/theme.json";
import type { Theme } from "@/theme/contract";

import { distanceTo, flatten } from "@/quality/geometry";
import { addTotals, emptyTotals, scoreGraph, type QualityTotals } from "@/quality/score";

/**
 * The reference boards' route quality, frozen.
 *
 * The measuring is `src/quality/score.ts`, which is a module rather than a closure in this file
 * because the page runs it too — on the board someone just wrote, which is the only board nobody
 * will ever write an expectation for. What lives here is the other half: a table of what the
 * router achieves today, and a failure when it moves. Until this existed the only signal was a
 * screenshot, and a screenshot tells you *that* something moved, never that the result reads badly.
 *
 * A number going *down* is a win that has to be committed deliberately; the totals are a record of
 * what the router currently achieves, not a target it is aiming at.
 *
 * These are `TableMeasurer` numbers. That measurer is pure arithmetic (`text.length * size * per`)
 * rather than real font metrics, which is what makes them identical on every machine and every run
 * — and also means they are a couple of percent away from what Chrome lays out, and that changing
 * the three per-character constants in `layout/measure.ts` will move every number here at once. The
 * page scores against the real font and will not always agree in the last digit: this is a
 * regression gate, that is a report on one drawing.
 */

const T = theme as unknown as Theme;
const DIR = path.resolve(__dirname, "../boards/local/reference");

beforeAll(() => setMeasurer(new TableMeasurer()));

function graphsOf(file: string): { id: string; graph: Graph }[] {
  const board = parseBoard(file, fs.readFileSync(path.join(DIR, file), "utf8"));
  return board.items
    .filter((it) => isDiagramType(it.type) && it.type !== "sequence")
    .map((it) => ({ id: it.id, graph: parseDiagram(it.type, it.body, it.dir)! }))
    .filter((x) => x.graph !== null);
}

/**
 * What the router achieves today, board by board.
 *
 * The non-zero entries are not targets and not noise — they are real, and visible in the committed
 * screenshots once you know to look. `usecase` is still the worst board in the set, because a
 * use-case diagram is a dense bipartite graph and every actor leaves from the side that faces the
 * system whether or not another oval is sitting there.
 *
 * `throughNode` fell from 20 to 8 and `bends` from 20 to 12 when the layout stopped lying to
 * itself. Ports were declared on the *diagram's* direction, so a card inside a group running the
 * other way advertised an exit on a side no edge would ever leave from — and ELK dutifully routed
 * out of it and back around, which `route.ts` then spliced its own row anchors onto. `colGap` and
 * `rowGap` arrived transposed in those same groups, so cards sat 32px apart with an edge to fit
 * between them. And a hoisted edge handed the router the bends ELK had computed for the two
 * *groups*, which are not the two entities being drawn.
 *
 * Two passes clean up what is left, and both are cheap arithmetic over what the layout returned:
 * `bowClear` bows a curve that would cross a card it has nothing to do with, and `labelFor` slides
 * a label along its own line rather than leaving it on a border.
 *
 * What survives needs a different side to leave from, not a better curve — a candidates-and-cost
 * model of placement, deliberately deferred.
 *
 * Edit these deliberately. A number that has gone down is an improvement worth saying so in the
 * commit message; one that has gone up wants explaining before it is written in.
 */
const EXPECTED: Record<string, QualityTotals> = {
  "activity.board.md": { crossings: 0, bends: 0, throughNode: 0, labelOverlaps: 0, labelOverNode: 0, nodeOverlaps: 0 },
  "architecture.board.md": { crossings: 0, bends: 4, throughNode: 0, labelOverlaps: 0, labelOverNode: 0, nodeOverlaps: 0 },
  "c4.board.md": { crossings: 3, bends: 0, throughNode: 0, labelOverlaps: 0, labelOverNode: 0, nodeOverlaps: 0 },
  /* Four items, three of them one node each: the components score nothing because there is nothing
     inside them to route. What the links between them do is measured in board space by
     `board-route.test.ts`, which is a different plane and a different router input. */
  "components.board.md": { crossings: 0, bends: 0, throughNode: 0, labelOverlaps: 0, labelOverNode: 0, nodeOverlaps: 0 },
  "class.board.md": { crossings: 0, bends: 8, throughNode: 0, labelOverlaps: 0, labelOverNode: 0, nodeOverlaps: 0 },
  "erd.board.md": { crossings: 2, bends: 4, throughNode: 0, labelOverlaps: 0, labelOverNode: 0, nodeOverlaps: 0 },
  "gitgraph.board.md": { crossings: 0, bends: 0, throughNode: 0, labelOverlaps: 0, labelOverNode: 0, nodeOverlaps: 0 },
  "mindmap.board.md": { crossings: 0, bends: 0, throughNode: 0, labelOverlaps: 0, labelOverNode: 0, nodeOverlaps: 0 },
  /* Nothing was placed by a layout, so nothing routed round a placement: the shapes are where the
     author put them and the two lines have clear air. Zero here is the frozen claim that a fixed
     board stays that way — a router change that started bowing these would be a change to a
     drawing somebody drew. */
  "sketch.board.md": { crossings: 0, bends: 0, throughNode: 0, labelOverlaps: 0, labelOverNode: 0, nodeOverlaps: 0 },
  "state.board.md": { crossings: 0, bends: 12, throughNode: 0, labelOverlaps: 0, labelOverNode: 0, nodeOverlaps: 0 },
  "timeline.board.md": { crossings: 0, bends: 0, throughNode: 0, labelOverlaps: 0, labelOverNode: 0, nodeOverlaps: 0 },
  "usecase.board.md": { crossings: 3, bends: 0, throughNode: 0, labelOverlaps: 0, labelOverNode: 0, nodeOverlaps: 0 },
  "workflow.board.md": { crossings: 0, bends: 0, throughNode: 0, labelOverlaps: 0, labelOverNode: 0, nodeOverlaps: 0 },
};

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".board.md") && graphsOf(f).length > 0);

describe.each(files)("%s", (file) => {
  it("routes to the quality it did last time", async () => {
    const totals: QualityTotals = emptyTotals();
    for (const { graph } of graphsOf(file)) {
      const labels = sizeLabels(graph, T);
      const placed = await layoutGraph(graph, sizeGraph(graph, T), labels, T.metric);
      addTotals(totals, scoreGraph(graph, placed, labels, T).totals);
    }
    /* `ANYDAG_SCORE=dump npx vitest run test/route-quality.test.ts` prints the table below in the form
       it is written in, for when a router change is meant to move these. */
    if (process.env.ANYDAG_SCORE === "dump") {
      const { crossings, bends, throughNode, labelOverlaps, labelOverNode, nodeOverlaps } = totals;
      console.log(
        `  "${file}": { crossings: ${crossings}, bends: ${bends}, throughNode: ${throughNode}, labelOverlaps: ${labelOverlaps}, labelOverNode: ${labelOverNode}, nodeOverlaps: ${nodeOverlaps} },`,
      );
      return;
    }
    expect(totals).toEqual(EXPECTED[file]);
  });

  /*
   * Not a frozen number but a rule, because there is no defensible value above zero.
   *
   * A label belongs to a line. Until this pass it could belong to a line that was never drawn:
   * `labelFor` always computed the midpoint of the S-curve, including for edges ELK had rerouted as
   * a polyline around an obstacle, so those labels floated wherever the notional curve would have
   * gone. The router now places a label on the spine it actually drew, and this is what keeps that
   * true.
   */
  it("puts every label next to its own line", async () => {
    for (const { graph } of graphsOf(file)) {
      const placed = await layoutGraph(graph, sizeGraph(graph, T), sizeLabels(graph, T), T.metric);
      for (const e of placed.edges) {
        if (!e.label) continue;
        const drift = distanceTo({ x: e.label.x, y: e.label.y }, flatten(e.d));
        expect(drift, `${e.id} label is ${drift.toFixed(1)}px from its path`).toBeLessThanOrEqual(
          T.metric.edge.labelOffset * 2,
        );
      }
    }
  });
});
