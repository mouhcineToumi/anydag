import { beforeAll, describe, expect, it } from "vitest";

import { CODES } from "@/dsl/codes";
import { boundsOf, formatPoints, normalise, parsePoints, simplifyPoints, type InkPoint } from "@/dsl/ink";
import { parseDiagram } from "@/dsl/parse";
import { inkPath } from "@/layout/ink";
import { setMeasurer, TableMeasurer } from "@/layout/measure";
import { sizeGraph } from "@/layout/size";
import theme from "../themes/paper/theme.json";
import type { Theme } from "@/theme/contract";
import { inkStatement } from "@/edit/ink";

/**
 * The pen's model layer: points in the file, arithmetic over them, and the drawing that scales
 * from the points' bounds into the laid-out box.
 *
 * What has to hold here is mostly the boundary. `pts=` is a coordinate in every way that matters —
 * read onto the node inside a `sketch` or `layout=fixed` fence, warned about outside one, and an
 * error rather than a silence when the list is malformed, because a stroke that did not parse
 * renders as nothing and explains itself to nobody. And `inkPath` may never put a NaN in a `d`:
 * the browser draws nothing and logs an error naming no edge, so a flat stroke — the commonest
 * thing a pen draws — is guarded in the layout, not hoped away in the data.
 */

const T = theme as unknown as Theme;
beforeAll(() => setMeasurer(new TableMeasurer()));

const pts = (s: string) => parsePoints(s)!;

const errors = (src: string, type = "sketch", layout?: "fixed") => {
  const g = parseDiagram(type, src, undefined, undefined, layout)!;
  return g.diagnostics.filter((d) => d.severity === "error");
};
const warnings = (src: string, type = "sketch", layout?: "fixed") => {
  const g = parseDiagram(type, src, undefined, undefined, layout)!;
  return g.diagnostics.filter((d) => d.severity === "warn");
};

describe("parsePoints / formatPoints", () => {
  it("round trips through the file's own spelling", () => {
    const s = "0,0 14,9 31,5 48,22 60,40";
    expect(formatPoints(pts(s))).toBe(s);
  });

  it("reads a malformed list as undefined, not as a shorter stroke", () => {
    expect(parsePoints("0,0 10")).toBeUndefined();
    expect(parsePoints("0,0 ,5 10,10")).toBeUndefined();
    expect(parsePoints("0,0 10,10.5")).toBeUndefined();
    expect(parsePoints("0,0 10;5")).toBeUndefined();
    expect(parsePoints("")).toBeUndefined();
  });

  it("takes negatives — a stroke captured above the origin, before it is normalised", () => {
    expect(parsePoints("-40,-20 0,0")!.map((p) => [p.x, p.y])).toEqual([
      [-40, -20],
      [0, 0],
    ]);
  });

  it("writes whole numbers, because the grammar holds them and nothing else does", () => {
    expect(formatPoints([{ x: 10.4, y: -3.6 }])).toBe("10,-4");
  });
});

describe("simplifyPoints", () => {
  it("collapses a straight run to its ends", () => {
    const run: InkPoint[] = [];
    for (let i = 0; i <= 30; i++) run.push({ x: i * 5, y: i % 3 });
    expect(simplifyPoints(run, 4)).toEqual([run[0], run[run.length - 1]]);
  });

  it("reduces a dense stroke and always keeps its endpoints", () => {
    const dense: InkPoint[] = [];
    for (let i = 0; i <= 40; i++) dense.push({ x: i, y: Math.round(3 * Math.sin(i / 3)) });
    const out = simplifyPoints(dense, 2);
    expect(out.length).toBeLessThan(dense.length);
    expect(out[0]).toEqual(dense[0]);
    expect(out[out.length - 1]).toEqual(dense[dense.length - 1]);
  });

  it("keeps a corner the epsilon cannot explain away", () => {
    const L = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 40 },
    ];
    /* The corner is ~9.6px from the chord joining its neighbours — far past a 2px epsilon. */
    expect(simplifyPoints(L, 2)).toEqual(L);
  });

  it("leaves a short stroke alone", () => {
    const two = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(simplifyPoints(two, 4)).toEqual(two);
  });
});

describe("normalise", () => {
  it("puts the minimum at 0,0 and reports how far it moved", () => {
    const { pts: out, dx, dy } = normalise(pts("240,120 300,140 240,140"));
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 20 },
      { x: 0, y: 20 },
    ]);
    expect([dx, dy]).toEqual([240, 120]);
  });

  it("answers for a stroke the pen started at the origin", () => {
    const { pts: out, dx, dy } = normalise(pts("0,0 10,10"));
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect([dx, dy]).toEqual([0, 0]);
  });

  it("answers for an empty list", () => {
    expect(normalise([])).toEqual({ pts: [], dx: 0, dy: 0 });
  });
});

describe("boundsOf", () => {
  it("measures the stroke", () => {
    expect(boundsOf(pts("10,20 50,20 30,60"))).toEqual({ x: 10, y: 20, w: 40, h: 40 });
  });

  it("says a flat stroke has no height, so the layout can guard its divide", () => {
    expect(boundsOf(pts("0,40 100,40"))).toEqual({ x: 0, y: 40, w: 100, h: 0 });
  });

  it("answers for an empty list", () => {
    expect(boundsOf([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("inkPath", () => {
  it("is empty for a stroke with no points", () => {
    expect(inkPath([], 80, 40)).toBe("");
  });

  it("draws a dot for a single point, inside its box", () => {
    const d = inkPath([{ x: 0, y: 0 }], 80, 40);
    expect(d.startsWith("M")).toBe(true);
    expect(d).not.toContain("NaN");
  });

  it("draws a straight line for two points, not a spline improving on it", () => {
    const d = inkPath(pts("0,0 100,50"), 100, 50);
    expect(d).toBe("M0 0 L100 50");
  });

  it("runs one curve segment between each pair of a real stroke", () => {
    const d = inkPath(pts("0,0 14,9 31,5 48,22 60,40"), 60, 40);
    expect(d.startsWith("M0 0")).toBe(true);
    expect((d.match(/C/g) ?? []).length).toBe(4);
  });

  it("scales from the points' bounds into the box it is given", () => {
    /* A flat stroke twice drawn: the same two points, the far one landing on the box's edge. */
    expect(inkPath(pts("0,0 20,0"), 200, 40)).toBe("M0 20 L200 20");
    expect(inkPath(pts("0,0 20,0"), 100, 40)).toBe("M0 20 L100 20");
  });

  it("survives every degenerate box without a NaN", () => {
    /* A flat stroke, a vertical one, and a zero box — the divide-by-zero cases, of which the flat
       stroke is the commonest thing a pen draws. */
    const flat = inkPath(pts("0,40 100,40"), 200, 80);
    const tall = inkPath(pts("50,0 50,60"), 200, 80);
    const zero = inkPath(pts("0,0 10,10"), 0, 0);
    for (const d of [flat, tall, zero]) {
      expect(d).not.toContain("NaN");
      expect(d.length).toBeGreaterThan(0);
    }
    expect(flat).not.toBe(tall);
  });
});

describe("the `ink` statement", () => {
  it("reaches the Node as real points inside a sketch", () => {
    const g = parseDiagram("sketch", 'ink s1 pts="0,0 14,9 31,5" x=240 y=120')!;
    expect(g.diagnostics).toEqual([]);
    const n = g.nodes[0]!;
    expect(n.kind).toBe("ink");
    expect(n.pts).toEqual([
      { x: 0, y: 0 },
      { x: 14, y: 9 },
      { x: 31, y: 5 },
    ]);
    expect([n.x, n.y]).toEqual([240, 120]);
  });

  it("warns W_UNKNOWN_ATTR in a diagram that is laid out, and still reads the points", () => {
    /* On a kind `arch` has: `ink` itself is not one there, so the kind check fires first and the
       attribute is never reached — this line is what isolates the `pts=` warning. */
    const w = warnings('service api "API" pts="0,0 10,10"', "arch");
    expect(w.map((d) => d.code)).toEqual([CODES.W_UNKNOWN_ATTR]);
    expect(w[0]!.message).toContain("layout=fixed");
    const g = parseDiagram("arch", 'service api "API" pts="0,0 10,10"')!;
    expect(g.nodes[0]!.pts).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it("is silent inside a fixed fence", () => {
    expect(parseDiagram("arch", 'service api "API" pts="0,0 10,10"', undefined, undefined, "fixed")!.diagnostics).toEqual([]);
  });

  it("reports a malformed list as an error naming the key", () => {
    const e = errors('ink s1 pts="0,0 10"');
    expect(e.map((d) => d.code)).toEqual([CODES.E_EXPECTED_VALUE]);
    expect(e[0]!.message).toContain("pts");
  });

  it("sizes a stroke from its points' bounds, with a floor for one that has none", () => {
    const drawn = parseDiagram("sketch", 'ink s1 pts="0,0 60,40"')!;
    expect(sizeGraph(drawn, T).s1).toEqual({ w: 60, h: 40, rowY: [] });
    const empty = parseDiagram("sketch", "ink s1")!;
    expect(sizeGraph(empty, T).s1!.w).toBeGreaterThanOrEqual(T.metric.grid);
    expect(sizeGraph(empty, T).s1!.h).toBeGreaterThanOrEqual(T.metric.grid);
  });
});

describe("inkStatement — the pen's release", () => {
  /**
   * The gesture's meaning, without the gesture: samples in, the statement one commit writes out.
   * What has to hold is the split the data shape exists for — `x=`/`y=` carry the position and are
   * snapped to the grid, the path carries the shape and is never snapped — and the two refusals:
   * a release that is a click, and one that degenerates once whole numbers are written.
   */

  const stroke = (pairs: [number, number][]): InkPoint[] => pairs.map(([x, y]) => ({ x, y }));

  it("simplifies before writing, and keeps the ends", () => {
    const raw = stroke([
      [0, 0],
      [5, 0],
      [10, 0],
      [15, 0],
      [20, 0],
    ]);
    const s = inkStatement(raw, 1, 8, "ink-a1")!;
    expect(s.body).toBe('ink ink-a1 pts="0,0 20,0"');
  });

  it("normalises the path to its own 0,0 and snaps the position instead", () => {
    const s = inkStatement(
      stroke([
        [243, 117],
        [301, 149],
      ]),
      1,
      8,
      "ink-b2",
    )!;
    /* The bounds start at 243,117; the item takes the snapped corner, the path starts at 0,0. */
    expect(s.attrs).toEqual({ x: 240, y: 120 });
    expect(s.body).toBe('ink ink-b2 pts="0,0 58,32"');
  });

  it("scales the epsilon by the zoom, so a stroke drawn zoomed out is not drowned in its own jitter", () => {
    /* The same straight drag with a pointer's worth of jitter, drawn while zoomed out. On the
       glass the wobble is a screen pixel or two; in board units it is ten times that, and a fixed
       epsilon would have stored every sample of it. Divided by the zoom, the noise drops and the
       line stays a line. */
    const jitter = stroke([
      [0, 0],
      [300, 10],
      [600, -10],
      [900, 10],
      [1200, 0],
    ]);
    const s = inkStatement(jitter, 0.1, 8, "ink-c3")!;
    expect(s.body).toBe('ink ink-c3 pts="0,0 1200,0"');
  });

  it("refuses a stray click", () => {
    expect(inkStatement(stroke([[240, 120]]), 1, 8, "ink-d4")).toBeNull();
    expect(inkStatement([], 1, 8, "ink-d4")).toBeNull();
    /* Two samples at one place: a click that was counted twice, still a click. */
    expect(
      inkStatement(
        stroke([
          [240, 120],
          [240, 120],
        ]),
        1,
        8,
        "ink-d4",
      ),
    ).toBeNull();
  });

  it("refuses a stroke that degenerates once whole numbers are written", () => {
    /* Half a pixel apart: distinct samples, one point after rounding. */
    expect(
      inkStatement(
        stroke([
          [240, 120],
          [240.4, 120.4],
        ]),
        1,
        8,
        "ink-e5",
      ),
    ).toBeNull();
  });

  it("keeps a flat stroke — a line is a stroke, not a defect", () => {
    const s = inkStatement(
      stroke([
        [240, 120],
        [340, 120],
      ]),
      1,
      8,
      "ink-f6",
    )!;
    expect(s.body).toBe('ink ink-f6 pts="0,0 100,0"');
    expect(s.attrs).toEqual({ x: 240, y: 120 });
  });
});
