/**
 * The graph view's simulation in a worker of its own (#459): `src/graph/host.ts` wired to the
 * worker's messages. The page makes one when the Graph page mounts and ends it when the page goes,
 * so with the page closed there is none (`simLink.ts`).
 */
import { createHost, type HostIn, type HostOut } from "@/graph/host";
import { createSim } from "@/graph/sim";

import { scheduler } from "./schedule";

/** The worker's own global, named for what this file uses of it (the app's types are the window's). */
interface WorkerScope {
  postMessage(msg: HostOut, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<HostIn>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const clock = scheduler();
const handle = createHost({
  createSim,
  now: () => performance.now(),
  schedule: clock.schedule,
  post: (msg, transfer) => scope.postMessage(msg, transfer),
});
scope.onmessage = (e) => handle(e.data);
