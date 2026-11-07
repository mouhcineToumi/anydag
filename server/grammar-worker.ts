/**
 * The grammar's heavy half on a thread of its own: `/index`, `/corpus` and `/search` over a whole
 * vault are seconds of parsing on a cold one — 12 s for 5,000 notes — and on the server's only thread
 * that was every other request waiting, a save and `/api/auth/me` included. `server/grammar.ts`
 * sends them here and keeps everything else, which is quick, where it was.
 *
 * Built beside each bundle that serves (`server/build.mjs`, `cli/build.mjs`); where there is no
 * built worker — the unit suite, which runs the TypeScript — the calls are made inline instead.
 */

import { parentPort } from "node:worker_threads";

import { handle } from "./handle";

interface Ask {
  id: number;
  method: "GET" | "POST";
  route: string;
  query: [string, string][];
  body: unknown;
}

/* The body is one try/catch whose handler only posts a string, so this listener cannot reject. */
// eslint-disable-next-line @typescript-eslint/no-misused-promises
parentPort?.on("message", async ({ id, method, route, query, body }: Ask) => {
  try {
    const answer = await handle({ method, route, query: new URLSearchParams(query), body });
    parentPort!.postMessage({ id, answer });
  } catch (e) {
    parentPort!.postMessage({ id, error: (e as Error)?.stack ?? String(e) });
  }
});
