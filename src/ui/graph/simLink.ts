/**
 * The page's end of the simulation (#459): a worker (`sim.worker.ts`) made when the Graph page mounts
 * and ended when it goes, or — where a worker cannot be made — the same host on the page, paced by
 * the same clock. `e2e/graph.spec.ts` counts the workers made and ended: with the page closed, none.
 */
import type { HostIn, HostOut } from "@/graph/host";

import SimWorker from "./sim.worker?worker";
import { scheduler, type Scheduler } from "./schedule";

export interface SimLink {
  post(msg: HostIn, transfer?: Transferable[]): void;
  /** Ends the worker, or stops the host on the page: nothing of it runs after this. */
  end(): void;
  /** Where it runs. */
  readonly where: "worker" | "page";
}

/** The host on the page, for a browser that will not make the worker. Its module is loaded only then. */
function onPage(hear: (msg: HostOut) => void): SimLink {
  let clock: Scheduler | null = scheduler();
  let handle: ((msg: HostIn) => void) | null = null;
  const waiting: HostIn[] = [];
  void Promise.all([import("@/graph/host"), import("@/graph/sim")]).then(([h, s]) => {
    if (!clock) return;
    const c = clock;
    handle = h.createHost({
      createSim: s.createSim,
      now: () => performance.now(),
      schedule: c.schedule,
      post: (msg) => c.schedule(() => hear(msg), 0),
    });
    for (const msg of waiting.splice(0)) handle(msg);
  });
  return {
    where: "page",
    post(msg) {
      if (!clock) return;
      if (handle) handle(msg);
      else waiting.push(msg);
    },
    end() {
      clock?.stop();
      clock = null;
      handle = null;
    },
  };
}

export function startSim(hear: (msg: HostOut) => void): SimLink {
  let worker: Worker;
  try {
    worker = new SimWorker();
  } catch {
    return onPage(hear);
  }
  let ended = false;
  let heard = false;
  /* The last `init`, kept until the worker first answers, so a worker that fails to start can be
     replaced by the host on the page without the graph being asked for again. */
  let first: HostIn | null = null;
  let fallback: SimLink | null = null;
  worker.onmessage = (e: MessageEvent<HostOut>) => {
    heard = true;
    first = null;
    if (!ended) hear(e.data);
  };
  worker.onerror = () => {
    if (heard || ended || fallback) return;
    worker.terminate();
    fallback = onPage(hear);
    if (first) fallback.post(first);
  };
  return {
    get where() {
      return fallback ? "page" : "worker";
    },
    post(msg, transfer = []) {
      if (ended) return;
      if (fallback) return fallback.post(msg);
      if (msg.t === "init" && !heard)
        first = { ...msg, src: msg.src.slice(), dst: msg.dst.slice(), pos: msg.pos?.slice() ?? null };
      worker.postMessage(msg, transfer);
    },
    end() {
      if (ended) return;
      ended = true;
      if (fallback) fallback.end();
      else worker.terminate();
    },
  } satisfies SimLink;
}
