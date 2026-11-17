/**
 * What holds the graph view's simulation (#458): in a worker, or on the page where a worker cannot be
 * made. It is written against an environment it is handed — the clock, a scheduler, a way to post, and
 * the simulation's constructor — so it is tested with a fake clock and no worker. The worker entry
 * that wires it to `self` belongs to the page (#459).
 *
 * **It ticks by the clock, not by the frame**: 240 ticks a second, 120 while a file is held, in
 * chunks of at most `CHUNK_MS` with a yield between them, so messages are heard while it settles. A
 * slow frame on the page does not slow the settling, and a fast screen does not speed it up. When it
 * has fallen more than `BEHIND` ticks behind (a slow machine, a big graph) it drops the debt instead
 * of chasing it.
 *
 * **It stops itself**: at rest, and on `pause` (the window is hidden). At rest there is no timer and
 * no message: a stopped host costs nothing until it is told something.
 *
 * **Positions go back and forth in two buffers.** The page hands over a buffer with `frame`; the host
 * fills it after its next chunk (at once, if it is not running) and hands it back, transferred. The
 * page draws one while the other is away, so nothing is allocated per frame.
 */
import type { Sim, SimChange, SimGraph } from "./sim";

/** Ticks a second, settling and while a file is held. */
export const RATE = 240;
export const RATE_HELD = 120;
/** The longest a chunk of ticks runs before the host yields. */
const CHUNK_MS = 8;
/** Ticks behind the clock past which the debt is dropped. */
const BEHIND = 64;

/** What the page tells the host. `gen` numbers a graph: a frame of another one is not filled. */
export type HostIn =
  | ({ t: "init"; gen: number } & SimGraph)
  | ({ t: "set" } & SimChange)
  | { t: "pin"; i: number; x: number; y: number }
  | { t: "drop" }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "frame"; gen: number; buf: ArrayBuffer };

/** What the host tells the page. */
export type HostOut =
  | {
      t: "frame";
      gen: number;
      buf: ArrayBuffer;
      /** Whether `buf` holds positions: not for another graph's `gen`, nor a buffer too short for this one. */
      filled: boolean;
      alpha: number;
      ticks: number;
      live: boolean;
      held: boolean;
      /** The time one tick takes, averaged over the last few chunks, in ms. */
      tickMs: number;
    }
  /** It has stopped, at rest or paused, with no frame asked for: nothing more comes until it is told something. */
  | { t: "rest"; gen: number };

export interface HostEnv {
  createSim: (graph: SimGraph) => Sim;
  /** Milliseconds, from any origin. */
  now: () => number;
  /** Run `fn` once, after `ms` (0: as soon as the messages waiting have been heard). */
  schedule: (fn: () => void, ms: number) => void;
  post: (msg: HostOut, transfer: ArrayBuffer[]) => void;
}

/** A host: hand it every message the page sends. */
export function createHost(env: HostEnv): (msg: HostIn) => void {
  let sim: Sim | null = null;
  let gen = 0;
  let running = false;
  let paused = false;
  /** The frame asked for, waiting for the end of a chunk. */
  let want: ArrayBuffer | null = null;
  let wantGen = 0;
  /** The clock: `done` ticks since `since`, at `rate` a second. */
  let since = 0;
  let done = 0;
  let rate = RATE;
  let tickMs = 0;

  const state = (s: Sim) => ({ alpha: s.alpha, ticks: s.ticks, live: s.live, held: s.held, tickMs });

  /** Hand `buf` back, filled if it is for this graph and long enough. */
  const handBack = (buf: ArrayBuffer, of: number): void => {
    const filled = sim !== null && of === gen && buf.byteLength >= sim.n * 8;
    if (sim && filled) sim.read(new Float32Array(buf, 0, sim.n * 2));
    const st = sim ? state(sim) : { alpha: 0, ticks: 0, live: false, held: false, tickMs };
    env.post({ t: "frame", gen: of, buf, filled, ...st }, [buf]);
  };

  const answer = (): boolean => {
    if (!want) return false;
    const buf = want;
    want = null;
    handBack(buf, wantGen);
    return true;
  };

  const restart = (): void => {
    since = env.now();
    done = 0;
  };

  const run = (): void => {
    if (!sim || paused || !sim.live) {
      running = false;
      if (!answer()) env.post({ t: "rest", gen }, []);
      return;
    }
    const r = sim.held ? RATE_HELD : RATE;
    if (r !== rate) {
      rate = r;
      restart();
    }
    const due = Math.floor(((env.now() - since) * rate) / 1000) - done;
    if (due <= 0) {
      /* Early: wait for the next tick to fall due. */
      const at = ((done + 1) * 1000) / rate - (env.now() - since);
      env.schedule(run, Math.max(1, Math.ceil(at)));
      return;
    }
    const most = Math.min(due, BEHIND);
    const t0 = env.now();
    let did = 0;
    while (did < most && sim.live) {
      sim.step(1);
      did++;
      if (env.now() - t0 >= CHUNK_MS) break;
    }
    const ms = env.now() - t0;
    done += did;
    if (due > BEHIND) restart();
    if (did) tickMs = tickMs ? tickMs * 0.9 + (ms / did) * 0.1 : ms / did;
    answer();
    env.schedule(run, 0);
  };

  const kick = (): void => {
    if (running || paused || !sim || !sim.live) return;
    running = true;
    rate = sim.held ? RATE_HELD : RATE;
    restart();
    env.schedule(run, 0);
  };

  return (msg) => {
    switch (msg.t) {
      case "init": {
        /* A frame asked of the old graph goes back now, with the old graph's positions. */
        answer();
        gen = msg.gen;
        sim = env.createSim(msg);
        tickMs = 0;
        restart();
        kick();
        return;
      }
      case "set":
        sim?.set(msg);
        kick();
        return;
      case "pin":
        sim?.pin(msg.i, msg.x, msg.y);
        kick();
        return;
      case "drop":
        sim?.drop();
        kick();
        return;
      case "pause":
        paused = true;
        return;
      case "resume":
        paused = false;
        if (running) restart();
        else kick();
        return;
      case "frame":
        /* One frame waits at a time: an earlier one is answered now. */
        answer();
        want = msg.buf;
        wantGen = msg.gen;
        if (!running) answer();
        return;
      default:
        assertNever(msg);
    }
  };
}

function assertNever(x: never): never {
  throw new Error(`host: unknown message ${JSON.stringify(x)}`);
}
