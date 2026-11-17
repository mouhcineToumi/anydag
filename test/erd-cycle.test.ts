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
 * A cycle of tables is drawn inside its item, every relationship on it (#408).
 *
 * ELK wraps an ERD's chain into rows to hit the theme's `aspect`, and the edge that closes the
 * cycle came back as a zigzag laid out for the sides of the wrap. `route.ts` spliced its own top
 * and bottom anchors onto it: the first leg ran through the table between the two ends and the
 * runs stopped in mid-air past the right of the item. Where no polyline was kept, the curve bowed
 * round that table past every box, and the item's size, taken from the boxes and the labels only,
 * cut it off. A self-loop on the first table stood above the item the same way.
 */

const T = theme as unknown as Theme;

beforeAll(() => setMeasurer(new TableMeasurer()));

async function lay(type: "erd" | "class", body: string) {
  const graph = parseDiagram(type, body, undefined) as Graph;
  const labels = sizeLabels(graph, T);
  const placed = (await layoutGraph(graph, sizeGraph(graph, T), labels, T.metric)) as Placed;
  return { graph, placed, labels };
}

/** The findings that say a line is somewhere it cannot be read. */
const misdrawn = (r: Awaited<ReturnType<typeof lay>>) =>
  scoreGraph(r.graph, r.placed, r.labels, T)
    .findings.filter((f) => f.code === QUALITY_CODES.Q_EDGE_OUTSIDE || f.code === QUALITY_CODES.Q_EDGE_OVER_NODE)
    .map((f) => `${f.code} ${f.ids.join(",")}`);

/** Every line and every label is inside the item's box — strictly, without the frame's padding. */
function expectInside({ placed, labels }: Awaited<ReturnType<typeof lay>>) {
  const box = { left: 0, top: 0, right: placed.size.w, bottom: placed.size.h };
  const lines = routeReach(placed.edges);
  const words = labelReach(placed.edges, labels);
  expect(Math.min(lines.left, words.left), "past the left").toBeGreaterThanOrEqual(box.left);
  expect(Math.min(lines.top, words.top), "past the top").toBeGreaterThanOrEqual(box.top);
  expect(Math.max(lines.right, words.right), "past the right").toBeLessThanOrEqual(box.right);
  expect(Math.max(lines.bottom, words.bottom), "past the bottom").toBeLessThanOrEqual(box.bottom);
}

const tables = (rows: boolean) =>
  ["a", "b", "c"].map((id) => (rows ? `entity ${id} "${id.toUpperCase()}" {\n  id uuid pk\n}` : `entity ${id}`)).join("\n");
const cycle = "a ||--o{ b\nb ||--o{ c\nc ||--o{ a";

describe("a three-table cycle", () => {
  for (const rows of [true, false]) {
    it(`draws all three relationships inside the item (${rows ? "with" : "without"} rows)`, async () => {
      const r = await lay("erd", `${tables(rows)}\n${cycle}`);
      expect(r.placed.edges.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
      expect(misdrawn(r)).toEqual([]);
      expectInside(r);
    });
  }

  it("draws the closing relationship as a line that misses the table between its ends", async () => {
    /* The polyline ELK laid out for the wrap, spliced onto our anchors, ran through `b` and then
       back and forth past the item's right side: an `L` straight across, and two runs outside. */
    const r = await lay("erd", `${tables(true)}\n${cycle}`);
    const closing = r.placed.edges.find((e) => e.id === "e3")!;
    expect(closing.d).not.toMatch(/L/);
    expect(misdrawn(r).filter((f) => f.includes("e3"))).toEqual([]);
  });

  it("keeps a self-loop on the first table inside the item", async () => {
    const r = await lay("erd", `${tables(false)}\n${cycle}\na ||--o{ a`);
    expect(misdrawn(r)).toEqual([]);
    expectInside(r);
  });

  it("labels its relationships inside the item", async () => {
    const r = await lay("erd", `${tables(true)}\na ||--o{ b "owns"\nb ||--o{ c "holds"\nc ||--o{ a "belongs to"`);
    expect(misdrawn(r)).toEqual([]);
    expectInside(r);
  });
});

describe("a longer cycle, and another type ELK wraps", () => {
  for (const len of [4, 5]) {
    it(`erd: ${len} tables`, async () => {
      const ids = Array.from({ length: len }, (_, i) => String.fromCharCode(97 + i));
      const body = [
        ...ids.map((id) => `entity ${id} {\n  id uuid pk\n  next_id fk\n}`),
        ...ids.map((id, i) => `${id} ||--o{ ${ids[(i + 1) % len]}`),
      ].join("\n");
      const r = await lay("erd", body);
      expect(misdrawn(r)).toEqual([]);
      expectInside(r);
    });
  }

  it("class: a three-class cycle", async () => {
    const r = await lay("class", "class a\nclass b\nclass c\na --> b\nb --> c\nc --> a");
    expect(misdrawn(r)).toEqual([]);
    expectInside(r);
  });
});

describe("a diagram whose lines already fit", () => {
  it("moves nothing", async () => {
    /* Two tables, two relationships: no line reaches past the boxes, so the size is the boxes'. */
    const { placed } = await lay("erd", "entity a\nentity b\na ||--o{ b\nb ||--o{ a");
    let w = 0;
    let h = 0;
    for (const b of Object.values(placed.nodes)) {
      w = Math.max(w, b.x + b.w);
      h = Math.max(h, b.y + b.h);
    }
    expect(placed.size).toEqual({ w: Math.ceil(w), h: Math.ceil(h) });
  });
});
