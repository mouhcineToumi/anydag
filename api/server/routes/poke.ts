/**
 * `GET /v1/vaults/{v}/poke` — one SSE stream per open client that says *something changed* and
 * nothing else: `data: {"seq":N}` after each commit to that vault, a `: ping`
 * comment every 20 s so a proxy does not time the stream out, `204` when `ANYDAG_API_POKE=off`.
 *
 * Load-bearing:
 * - **The poke carries a number and no information.** Losing one costs the client a poll interval,
 *   never a change: the client reads `changes` either way. So the hub drops a slow listener's
 *   write rather than queueing for it.
 * - **The hub is in this process, one per server.** Two instances behind one name would each poke
 *   only their own listeners, fixed by a `LISTEN/NOTIFY` hub behind `PokeHub`'s two methods — an
 *   adapter, not yet built.
 * - **A stream ends when its client goes**: the readable's cancel (`onAbort`) — which is what
 *   `@hono/node-server` calls when the socket closes — takes the listener and the timer with it,
 *   and `close()` ends every stream when the server stops, so SIGTERM does not wait on them.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { Deps, Vars } from "./http";

type Listener = (seq: number) => void;

export class PokeHub {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly enders = new Set<() => void>();

  /** Hear every commit to `vault`; the answer takes the listener off. */
  on(vault: string, fn: Listener): () => void {
    let set = this.listeners.get(vault);
    if (!set) this.listeners.set(vault, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0 && this.listeners.get(vault) === set) this.listeners.delete(vault);
    };
  }

  notify(vault: string, seq: number): void {
    for (const fn of this.listeners.get(vault) ?? []) {
      try {
        fn(seq);
      } catch {
        /* one listener's failure is that listener's */
      }
    }
  }

  /** Called when the server stops: every open stream is ended. */
  onClose(end: () => void): () => void {
    this.enders.add(end);
    return () => this.enders.delete(end);
  }

  get open(): number {
    return this.enders.size;
  }

  close(): void {
    for (const end of [...this.enders]) end();
    this.enders.clear();
    this.listeners.clear();
  }
}

export function pokeRoutes(deps: Deps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();
  app.get("/v1/vaults/:v/poke", (c) => {
    if (!deps.config.poke) return c.body(null, 204);
    const vault = c.get("vault").id;
    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        let done = false;
        const say = (text: string) => void stream.write(text).catch(end);
        const off = deps.hub.on(vault, (seq) => say(`data: ${JSON.stringify({ seq })}\n\n`));
        const timer = setInterval(() => say(": ping\n\n"), deps.pingMs);
        const unclose = deps.hub.onClose(() => end());
        function end(): void {
          if (done) return;
          done = true;
          off();
          unclose();
          clearInterval(timer);
          resolve();
        }
        stream.onAbort(end);
        c.req.raw.signal?.addEventListener("abort", end);
        // The headers go now, so a client knows the stream is open before the first commit.
        say(": open\n\n");
      });
    });
  });
  return app;
}
