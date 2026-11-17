import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import * as benchGraph from "../scripts/bench-graph.mjs";
import { createHost, type HostIn, type HostOut, RATE, RATE_HELD } from "../src/graph/host";
import { createSim, type Sim, type SimGraph } from "../src/graph/sim";

const graphVault = benchGraph.graphVault as (n: number) => { n: number; src: Int32Array; dst: Int32Array };

/**
 * A host on a fake clock. Time moves only when the test moves it — or, with `tickCost`, when a tick
 * runs, to stand for a machine where a tick is slow. `advance` runs what falls due on the way, in
 * order, as an event loop would.
 */
function fake({ tickCost = 0 } = {}) {
  let now = 0;
  let seq = 0;
  const queue: { at: number; seq: number; fn: () => void }[] = [];
  const out: HostOut[] = [];
  /** What the simulation held when each message was posted. */
  const held: Float32Array[] = [];
  const sims: Sim[] = [];
  /** The ticks each chunk did, and how long it took on the fake clock. */
  const chunks: { ticks: number; ms: number }[] = [];
  const host = createHost({
    createSim: (g: SimGraph) => {
      const sim = createSim(g);
      const step = sim.step.bind(sim);
      sim.step = (most: number) => {
        const did = step(most);
        now += did * tickCost;
        return did;
      };
      sims.push(sim);
      return sim;
    },
    now: () => now,
    schedule: (fn, ms) => queue.push({ at: now + ms, seq: seq++, fn }),
    post: (msg) => {
      const sim = sims[sims.length - 1];
      const pos = new Float32Array(sim ? sim.n * 2 : 0);
      sim?.read(pos);
      held.push(pos);
      out.push(msg);
    },
  });
  /** Run every callback due by `now + ms`, then leave the clock there. */
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = queue[0];
      if (!next || next.at > until) break;
      queue.shift();
      if (next.at > now) now = next.at;
      const t0 = now;
      const before = sims.at(-1)?.ticks ?? 0;
      next.fn();
      const did = (sims.at(-1)?.ticks ?? 0) - before;
      if (did) chunks.push({ ticks: did, ms: now - t0 });
    }
    if (until > now) now = until;
  };
  return {
    host: (msg: HostIn) => host(msg),
    advance,
    out,
    held,
    chunks,
    queue,
    sim: () => sims[sims.length - 1],
  };
}

const v = graphVault(300);
const init = (gen = 1): HostIn => ({ t: "init", gen, n: v.n, src: v.src, dst: v.dst });

describe("the host", () => {
  it("ticks by the clock: 240 a second", () => {
    const f = fake();
    f.host(init());
    f.advance(100);
    expect(Math.abs(f.sim().ticks - RATE / 10)).toBeLessThanOrEqual(1);
    f.advance(400);
    expect(Math.abs(f.sim().ticks - RATE / 2)).toBeLessThanOrEqual(1);
  });

  it("ticks 120 a second while a file is held", () => {
    const f = fake();
    f.host(init());
    f.advance(100);
    f.host({ t: "pin", i: 3, x: 0, y: 0 });
    const at = f.sim().ticks;
    f.advance(500);
    expect(Math.abs(f.sim().ticks - at - RATE_HELD / 2)).toBeLessThanOrEqual(1);
  });

  it("runs in chunks of at most 8 ms, and does not slow the settling for a slow tick", () => {
    /* 3 ms a tick: 240 a second would be 720 ms of work a second, so it keeps up, in short chunks. */
    const f = fake({ tickCost: 3 });
    f.host(init());
    f.advance(500);
    expect(f.chunks.length).toBeGreaterThan(10);
    for (const c of f.chunks) expect(c.ms).toBeLessThanOrEqual(9);
    expect(Math.abs(f.sim().ticks - RATE / 2)).toBeLessThanOrEqual(3);
  });

  it("drops the debt when it cannot keep up, rather than chase it", () => {
    /* 10 ms a tick is 100 a second at most: it runs flat out, one tick a chunk, and never stalls. */
    const f = fake({ tickCost: 10 });
    f.host(init());
    f.advance(1000);
    expect(f.sim().ticks).toBeGreaterThan(90);
    for (const c of f.chunks) expect(c.ticks).toBe(1);
  });

  it("stops at rest, with nothing scheduled, and says so", () => {
    const f = fake();
    f.host(init(4));
    f.advance(2000);
    expect(f.sim().live).toBe(false);
    expect(f.queue.length).toBe(0);
    expect(f.out.at(-1)).toEqual({ t: "rest", gen: 4 });
    const ticks = f.sim().ticks;
    f.advance(1000);
    expect(f.sim().ticks).toBe(ticks);
  });

  it("stops on pause, and goes on from where it was on resume", () => {
    const f = fake();
    f.host(init());
    f.advance(100);
    f.host({ t: "pause" });
    f.advance(10);
    const ticks = f.sim().ticks;
    expect(f.queue.length).toBe(0);
    f.advance(1000);
    expect(f.sim().ticks).toBe(ticks);
    expect(f.sim().live).toBe(true);
    f.host({ t: "resume" });
    f.advance(100);
    expect(Math.abs(f.sim().ticks - ticks - RATE / 10)).toBeLessThanOrEqual(1);
  });

  it("answers a frame with the buffer it was handed, filled with the positions", () => {
    const f = fake();
    f.host(init(2));
    f.advance(50);
    const buf = new ArrayBuffer(v.n * 8);
    f.host({ t: "frame", gen: 2, buf });
    f.advance(10);
    const at = f.out.findIndex((m) => m.t === "frame");
    const frame = f.out[at];
    if (frame?.t !== "frame") throw new Error("no frame");
    expect(frame.buf).toBe(buf);
    expect(frame.gen).toBe(2);
    expect(frame.filled).toBe(true);
    expect(frame.live).toBe(true);
    expect(frame.ticks).toBeGreaterThan(0);
    /* Filled at the end of the chunk it waited for, with what the simulation held then. */
    expect(new Float32Array(frame.buf)).toEqual(f.held[at]);
    expect(f.sim().ticks).toBeGreaterThan(frame.ticks);
  });

  it("answers a frame at once when it is at rest", () => {
    const f = fake();
    f.host(init());
    f.advance(2000);
    const buf = new ArrayBuffer(v.n * 8);
    f.host({ t: "frame", gen: 1, buf });
    const frame = f.out.at(-1);
    expect(frame?.t === "frame" && frame.buf === buf && frame.filled && !frame.live).toBe(true);
    expect(f.queue.length).toBe(0);
  });

  it("hands back unfilled a frame of another graph, or one too short", () => {
    const f = fake();
    f.host(init(3));
    f.advance(2000);
    const old = new ArrayBuffer(v.n * 8);
    f.host({ t: "frame", gen: 2, buf: old });
    const short = new ArrayBuffer(8);
    f.host({ t: "frame", gen: 3, buf: short });
    const [a, b] = f.out.filter((m) => m.t === "frame");
    expect(a?.t === "frame" && a.buf === old && !a.filled && a.gen === 2).toBe(true);
    expect(b?.t === "frame" && b.buf === short && !b.filled).toBe(true);
  });

  it("warms up and runs again on set, pin and drop", () => {
    const f = fake();
    f.host(init());
    f.advance(2000);
    expect(f.queue.length).toBe(0);
    f.host({ t: "set", forces: { repel: 2 }, heat: 0.5 });
    expect(f.sim().live).toBe(true);
    f.advance(100);
    expect(f.sim().live).toBe(true);
    f.advance(3000);
    expect(f.sim().live).toBe(false);
    f.host({ t: "pin", i: 0, x: 50, y: 50 });
    f.advance(3000);
    expect(f.sim().live).toBe(true);
    f.host({ t: "drop" });
    f.advance(3000);
    expect(f.sim().live).toBe(false);
    expect(f.queue.length).toBe(0);
  });
});
