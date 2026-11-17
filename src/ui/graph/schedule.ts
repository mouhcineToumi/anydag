/**
 * The scheduler the graph's simulation host is handed (`createHost`'s `schedule`), in the worker and
 * on the page alike: a wait of 0 is a message through a channel — heard after the messages already
 * waiting, without the 4 ms a nested `setTimeout(0)` is held to — and anything longer is a timer.
 * `stop` forgets every wait, so a host on the page leaves nothing behind when the page goes.
 */
export interface Scheduler {
  schedule(fn: () => void, ms: number): void;
  stop(): void;
}

export function scheduler(): Scheduler {
  const channel = new MessageChannel();
  const soon: (() => void)[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;
  channel.port1.onmessage = () => {
    const fn = soon.shift();
    if (fn && !stopped) fn();
  };
  return {
    schedule(fn, ms) {
      if (stopped) return;
      if (ms <= 0) {
        soon.push(fn);
        channel.port2.postMessage(0);
        return;
      }
      const t = setTimeout(() => {
        timers.delete(t);
        if (!stopped) fn();
      }, ms);
      timers.add(t);
    },
    stop() {
      stopped = true;
      soon.length = 0;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
    },
  };
}
