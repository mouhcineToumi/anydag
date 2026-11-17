import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import * as benchGraph from "../scripts/bench-graph.mjs";
import { adjacency, clusters, numbered } from "../src/graph/clusters";

const graphVault = benchGraph.graphVault as (n: number) => { n: number; src: Int32Array; dst: Int32Array };

const links = (n: number, pairs: [number, number][]) =>
  adjacency(n, Int32Array.from(pairs.map((p) => p[0])), Int32Array.from(pairs.map((p) => p[1])));

/** Every link between files `from` up to `from + size`. */
const clique = (from: number, size: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let a = from; a < from + size; a++) for (let b = a + 1; b < from + size; b++) out.push([a, b]);
  return out;
};

describe("linked clusters", () => {
  it("are the same on two runs", () => {
    const v = graphVault(2000);
    const a = clusters(adjacency(v.n, v.src, v.dst));
    const b = clusters(adjacency(v.n, v.src, v.dst));
    expect(Array.from(a)).toEqual(Array.from(b));
    /* The made-up vault has folders that link inside themselves: there is more than one cluster. */
    expect(Math.max(...a)).toBeGreaterThan(4);
  });

  it("put two cliques joined by one link in two clusters, the bigger first", () => {
    const g = clusters(links(12, [...clique(0, 5), ...clique(5, 7), [4, 5]]));
    expect(Array.from(g.slice(0, 5))).toEqual([1, 1, 1, 1, 1]);
    expect(Array.from(g.slice(5))).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("leave a file with no links in none", () => {
    const g = clusters(links(8, [...clique(0, 4), [5, 6]]));
    expect(g[4]).toBe(-1);
    expect(g[7]).toBe(-1);
    expect(g[5]).toBe(g[6]);
    expect(g[5]).not.toBe(g[0]);
    expect(g[0]).toBe(0);
  });

  it("are none for no files", () => {
    expect(clusters(links(0, []))).toEqual(new Int32Array(0));
  });
});

describe("numbering groups", () => {
  it("goes from the biggest down, ties by the lower number, and keeps none as none", () => {
    expect(Array.from(numbered(Int32Array.from([7, 3, 3, -1, 7, 9, 9, 9])))).toEqual([2, 1, 1, -1, 2, 0, 0, 0]);
  });
});

describe("adjacency", () => {
  it("lists each link both ways, in link order", () => {
    const { start, near } = links(4, [
      [0, 1],
      [2, 0],
    ]);
    expect(Array.from(start)).toEqual([0, 2, 3, 4, 4]);
    expect(Array.from(near)).toEqual([1, 2, 0, 0]);
  });
});
