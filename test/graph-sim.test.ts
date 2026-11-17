import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import * as benchGraph from "../scripts/bench-graph.mjs";
import { adjacency, clusters, numbered } from "../src/graph/clusters";
import { ALPHA_MIN, createSim, FORCES, type Forces, type Sim, type SimGraph } from "../src/graph/sim";

interface Vault {
  n: number;
  src: Int32Array;
  dst: Int32Array;
  folder: Int32Array;
  tag: Int32Array;
}
const graphVault = benchGraph.graphVault as (n: number, seed?: number) => Vault;
const mulberry32 = benchGraph.mulberry32 as (seed: number) => () => number;

const positions = (sim: Sim): Float32Array => {
  const out = new Float32Array(sim.n * 2);
  sim.read(out);
  return out;
};

const settle = (sim: Sim): number => sim.step(10_000);

/** The radius of gyration: how spread the layout is, about its own middle. */
function spread(pos: Float32Array): number {
  const n = pos.length / 2;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += pos[2 * i];
    cy += pos[2 * i + 1];
  }
  cx /= n;
  cy /= n;
  let s = 0;
  for (let i = 0; i < n; i++) s += (pos[2 * i] - cx) ** 2 + (pos[2 * i + 1] - cy) ** 2;
  return Math.sqrt(s / n);
}

/** The farthest any file is from the origin, where the centre pulls. */
function extent(pos: Float32Array): number {
  let e = 0;
  for (let i = 0; i < pos.length; i += 2) e = Math.max(e, Math.hypot(pos[i], pos[i + 1]));
  return e;
}

const finite = (pos: Float32Array) => pos.every((v) => Number.isFinite(v));

const graphOf = (v: Vault, more: Partial<SimGraph> = {}): SimGraph => ({ n: v.n, src: v.src, dst: v.dst, ...more });

const links = (pairs: [number, number][]) => ({
  src: Int32Array.from(pairs.map((p) => p[0])),
  dst: Int32Array.from(pairs.map((p) => p[1])),
});

describe("the simulation", () => {
  const v = graphVault(1000);
  const group = clusters(adjacency(v.n, v.src, v.dst));
  const grouped: Partial<Forces> = { tight: 0.5, gap: 0.3 };

  it("gives byte-identical positions on two runs, without groups", () => {
    const a = createSim(graphOf(v));
    const b = createSim(graphOf(v));
    settle(a);
    settle(b);
    expect(Buffer.from(positions(a).buffer).equals(Buffer.from(positions(b).buffer))).toBe(true);
  });

  it("gives byte-identical positions on two runs, with groups", () => {
    const a = createSim(graphOf(v, { group, forces: grouped }));
    const b = createSim(graphOf(v, { group, forces: grouped }));
    settle(a);
    settle(b);
    expect(Buffer.from(positions(a).buffer).equals(Buffer.from(positions(b).buffer))).toBe(true);
  });

  it("comes to rest from hot within 300 ticks, and a step after that does no work", () => {
    const sim = createSim(graphOf(v));
    expect(sim.live).toBe(true);
    const ticks = sim.step(300);
    expect(ticks).toBeLessThanOrEqual(300);
    expect(sim.live).toBe(false);
    expect(sim.alpha).toBeLessThan(ALPHA_MIN);
    const at = positions(sim);
    expect(sim.step(1)).toBe(0);
    expect(sim.ticks).toBe(ticks);
    expect(positions(sim)).toEqual(at);
  });

  it("takes the forces as designed when it is given none", () => {
    expect(FORCES).toEqual({ repel: 1, link: 1, pull: 1, centre: 1, tight: 0, gap: 0 });
    const a = createSim(graphOf(v));
    const b = createSim(graphOf(v, { forces: { ...FORCES } }));
    a.step(30);
    b.step(30);
    expect(positions(b)).toEqual(positions(a));
  });

  it("starts on a spiral in index order, so neighbours in the vault start as neighbours", () => {
    const sim = createSim({ n: 3, ...links([]) });
    const pos = positions(sim);
    const r = (i: number) => Math.hypot(pos[2 * i], pos[2 * i + 1]);
    expect(r(0)).toBeCloseTo(9 * Math.sqrt(0.5), 4);
    expect(r(2)).toBeCloseTo(9 * Math.sqrt(2.5), 4);
  });

  it("starts where it is told", () => {
    const pos = Float32Array.from([10, 20, -30, 40]);
    const sim = createSim({ n: 2, ...links([[0, 1]]), pos });
    expect(positions(sim)).toEqual(pos);
  });

  describe("does not blow up", () => {
    const cases: [string, SimGraph][] = [
      ["one file", { n: 1, ...links([]) }],
      ["no links", { n: 300, ...links([]) }],
      ["two files in the same place", { n: 2, ...links([[0, 1]]), pos: new Float32Array(4).fill(5) }],
      [
        "a file linked to every other",
        { n: 400, ...links(Array.from({ length: 399 }, (_, i) => [0, i + 1] as [number, number])) },
      ],
      ["1,000 files in one place", { n: 1000, ...links([]), pos: new Float32Array(2000) }],
      ["1,000 linked files in one place", { n: 1000, src: v.src, dst: v.dst, pos: new Float32Array(2000) }],
      ["no files", { n: 0, ...links([]) }],
    ];
    for (const [name, graph] of cases) {
      it(name, () => {
        const sim = createSim(graph);
        let worst = 0;
        for (let t = 0; t < 400 && sim.step(1); t++) {
          const pos = positions(sim);
          expect(finite(pos)).toBe(true);
          worst = Math.max(worst, extent(pos));
        }
        expect(sim.live).toBe(false);
        /* A thousand files spread from one point take about the room they would on the spiral. */
        expect(worst).toBeLessThan(3000);
      });
    }

    it("parts files that start in the same place", () => {
      const sim = createSim({ n: 1000, ...links([]), pos: new Float32Array(2000) });
      settle(sim);
      const pos = positions(sim);
      const seen = new Set<string>();
      for (let i = 0; i < 1000; i++) seen.add(`${pos[2 * i]},${pos[2 * i + 1]}`);
      expect(seen.size).toBe(1000);
      expect(spread(pos)).toBeGreaterThan(100);
    });
  });

  it("stays bounded when grouped by something that cuts across the links", () => {
    /* A random grouping is the worst case of "group by tag": every group is spread over the whole
       graph by its links, and every disc overlaps every other. Measured: the layout keeps the 680 or
       so it has ungrouped, settle after settle, with tightness and space between groups at their
       largest. The bound is half as much again. */
    const rnd = mulberry32(7);
    const raw = new Int32Array(v.n);
    for (let i = 0; i < v.n; i++) raw[i] = rnd() < 0.15 ? -1 : (rnd() * 14) | 0;
    const sim = createSim(graphOf(v, { group: numbered(raw), forces: { tight: 1, gap: 1 } }));
    settle(sim);
    const first = extent(positions(sim));
    expect(first).toBeLessThan(1000);
    for (let k = 0; k < 3; k++) {
      sim.set({ heat: 1 });
      settle(sim);
      expect(extent(positions(sim))).toBeLessThan(1000);
    }
    expect(finite(positions(sim))).toBe(true);
  });

  describe("set", () => {
    it("keeps positions", () => {
      const sim = createSim(graphOf(v));
      sim.step(50);
      const at = positions(sim);
      sim.set({ forces: { repel: 3, link: 2, pull: 0.5 }, heat: 0.6 });
      expect(positions(sim)).toEqual(at);
      sim.set({ group, forces: { tight: 1, gap: 1 } });
      expect(positions(sim)).toEqual(at);
      sim.set({ group: null });
      expect(positions(sim)).toEqual(at);
      expect(sim.alpha).toBeGreaterThanOrEqual(0.6);
    });

    it("warms the graph only up, never down", () => {
      const sim = createSim(graphOf(v));
      sim.set({ heat: 0.2 });
      expect(sim.alpha).toBe(1);
    });

    /** Settle, change the forces, settle again: how much `measure` grew. */
    const grows = (change: Partial<Forces>, measure: (pos: Float32Array) => number, base: Partial<SimGraph> = {}) => {
      const sim = createSim(graphOf(v, base));
      settle(sim);
      const before = measure(positions(sim));
      sim.set({ forces: change, heat: 1 });
      settle(sim);
      return measure(positions(sim)) / before;
    };

    /** The mean length of a link. */
    const linkLength = (pos: Float32Array) => {
      let s = 0;
      for (let k = 0; k < v.src.length; k++) {
        const a = v.src[k];
        const b = v.dst[k];
        s += Math.hypot(pos[2 * a] - pos[2 * b], pos[2 * a + 1] - pos[2 * b + 1]);
      }
      return s / v.src.length;
    };

    /** The mean distance between the middles of the eight biggest groups. */
    const groupsApart = (pos: Float32Array) => {
      const cx = new Float64Array(8);
      const cy = new Float64Array(8);
      const c = new Float64Array(8);
      for (let i = 0; i < v.n; i++) {
        const g = group[i];
        if (g < 0 || g >= 8) continue;
        cx[g] += pos[2 * i];
        cy[g] += pos[2 * i + 1];
        c[g]++;
      }
      let s = 0;
      let pairs = 0;
      for (let a = 0; a < 8; a++) {
        for (let b = a + 1; b < 8; b++) {
          s += Math.hypot(cx[a] / c[a] - cx[b] / c[b], cy[a] / c[a] - cy[b] / c[b]);
          pairs++;
        }
      }
      return s / pairs;
    };

    /* Measured on this vault, as the prototype had them: repel 4 widens the layout by half; link 3
       lengthens links by half and the layout by 3% (links are weak beside the repulsion, by design);
       gap 1 moves the groups 13% further apart and widens the layout 7%. */
    it("with a larger repel gives a wider layout", () => {
      expect(grows({ repel: 4 }, spread)).toBeGreaterThan(1.3);
    });

    it("with a larger link gives longer links and a wider layout", () => {
      expect(grows({ link: 3 }, linkLength)).toBeGreaterThan(1.3);
      expect(grows({ link: 3 }, spread)).toBeGreaterThan(1.015);
    });

    it("with a larger gap sets groups further apart and gives a wider layout", () => {
      const grouped = { group, forces: { tight: 0.5, gap: 0 } };
      expect(grows({ gap: 1 }, groupsApart, grouped)).toBeGreaterThan(1.08);
      expect(grows({ gap: 1 }, spread, grouped)).toBeGreaterThan(1.04);
    });

    it("with a smaller centre lets the layout spread", () => {
      expect(grows({ centre: 1 / 6 }, spread)).toBeGreaterThan(1.1);
    });

    it("ignores a force that is not a number", () => {
      const a = createSim(graphOf(v));
      const b = createSim(graphOf(v));
      b.set({ forces: { repel: Number.NaN, link: Number.POSITIVE_INFINITY } });
      settle(a);
      settle(b);
      expect(positions(b)).toEqual(positions(a));
    });
  });

  describe("a held file", () => {
    it("stays where it is held, and keeps the graph warm until dropped", () => {
      const sim = createSim(graphOf(v));
      settle(sim);
      sim.pin(5, 400, -300);
      expect(sim.held).toBe(true);
      expect(sim.step(400)).toBe(400);
      const pos = positions(sim);
      expect([pos[10], pos[11]]).toEqual([400, -300]);
      expect(finite(pos)).toBe(true);
      sim.drop();
      expect(sim.held).toBe(false);
      expect(sim.step(1000)).toBeLessThan(1000);
      expect(sim.live).toBe(false);
    });

    it("is not a file that does not exist", () => {
      const sim = createSim(graphOf(v));
      sim.pin(v.n, 0, 0);
      sim.pin(-1, 0, 0);
      sim.pin(3, Number.NaN, 0);
      expect(sim.held).toBe(false);
    });
  });

  it("refuses a link to a file that is not there", () => {
    expect(() => createSim({ n: 2, ...links([[0, 2]]) })).toThrow(RangeError);
    expect(() => createSim({ n: 2, src: new Int32Array(1), dst: new Int32Array(2) })).toThrow(RangeError);
    expect(() => createSim({ n: 3, ...links([]), pos: new Float32Array(4) })).toThrow(RangeError);
  });

  it("takes a link from a file to itself as no pull at all", () => {
    const sim = createSim({ n: 3, ...links([[1, 1]]) });
    settle(sim);
    expect(finite(positions(sim))).toBe(true);
  });
});
