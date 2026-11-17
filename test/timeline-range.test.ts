import { beforeAll, describe, expect, it } from "vitest";

import { CODES } from "@/dsl/codes";
import { parseTimeline } from "@/dsl/graph/timeline";
import { layoutGraph } from "@/layout/elk";
import { setMeasurer, TableMeasurer } from "@/layout/measure";
import { sizeGraph, sizeLabels } from "@/layout/size";
import type { Theme } from "@/theme/contract";
import theme from "../themes/paper/theme.json";

/**
 * A timeline range is a span, and a span that ends before it starts has no place on the axis.
 *
 * The parser used to read the dates without asking which came first, and the layout took its
 * domain from `end ?? start`, so the entry's *start* was not in the scale: its card landed past
 * the right edge of a diagram nobody could scroll, and nothing was reported (#410).
 */

const T = theme as unknown as Theme;
const BODY = ['2026-01-01 "A"', '2026-02-01 "B"', '2026-03-01 .. 2026-01-01 "backwards"'].join("\n");

beforeAll(() => setMeasurer(new TableMeasurer()));

describe("a timeline range that ends before it starts", () => {
  it("is E_BAD_DATE on the end date, and the entry is not drawn", () => {
    const g = parseTimeline(BODY);

    expect(g.diagnostics).toEqual([
      {
        line: 3,
        col: 15,
        code: CODES.E_BAD_DATE,
        message: "the end `2026-01-01` is before the start `2026-03-01`",
        severity: "error",
      },
    ]);
    /* The statement is skipped, not drawn backwards. */
    expect(g.nodes.map((n) => n.title)).toEqual(["A", "B"]);
  });

  it("counts the column from the file's edge, indentation included", () => {
    const g = parseTimeline('  2026-03-01 .. 2026-01-01 "backwards"');
    expect(g.diagnostics[0]).toMatchObject({ line: 1, col: 17, code: CODES.E_BAD_DATE });
  });

  it("keeps every card it does draw inside the diagram", async () => {
    const g = parseTimeline(BODY);
    const placed = await layoutGraph(g, sizeGraph(g, T), sizeLabels(g, T), T.metric);

    /* Without the order check this held `t2` too, at x 1328 in a 900px frame. */
    expect(Object.keys(placed.nodes)).toEqual(["t0", "t1"]);
    for (const [id, box] of Object.entries(placed.nodes)) {
      expect(box.x, id).toBeGreaterThanOrEqual(0);
      expect(box.y, id).toBeGreaterThanOrEqual(0);
      /* A snapped x can sit a grid step past the arithmetic edge; a card off the diagram is 400px out. */
      expect(box.x + box.w, id).toBeLessThanOrEqual(placed.size.w + T.metric.grid);
      expect(box.y + box.h, id).toBeLessThanOrEqual(placed.size.h);
    }
  });
});
