/**
 * The page's request, sent on to the server the shell spawned, and its answer handed back.
 *
 * **Over `node:http`, never Electron's `net.fetch`.** `net.fetch` is Chromium's network stack, and
 * that stack holds at most six HTTP/1.1 connections to one host and queues every request after
 * them, for as long as the six stay open. A page holds three that never close by themselves — the
 * change feed, the Assistant's history and the chat it shows — and each window holds its own, so
 * two windows were the whole budget. And a stream the page closed was never let go: the handler
 * passed the upstream body on and nothing cancelled it, so every reload and every switch of chat
 * kept one more connection for the rest of the launch (#123). Once six were held, every request the
 * page made waited for ever: the note being rewritten never arrived, the file list and the
 * reference index stayed as they were, and the page had nothing to say about it, because nothing
 * failed. Node's agent has no such cap, and no timeout: a prompt card's run can take minutes to
 * answer.
 *
 * **A request the page lets go of is let go of here.** Chromium aborts the handler's
 * `request.signal` when the page cancels — an `EventSource` closed, a reload, a window shut — and
 * that destroys the upstream request, which closes its socket and ends the server's stream.
 * Cancelling the answer's body does the same.
 */

import http from "node:http";
import { Readable } from "node:stream";

/** Connections are reused between requests: the page's reads come in bursts. Uncapped, which is Node's default. */
const agent = new http.Agent({ keepAlive: true });

/** Headers that describe one hop, not the answer: Electron's `Response` is its own hop. */
const HOP = ["connection", "keep-alive", "transfer-encoding", "proxy-connection", "upgrade"];

/** Statuses whose answer has no body, which `Response` refuses to be handed one for. */
const NO_BODY = new Set([101, 204, 205, 304]);

/**
 * Send `request` to `http://127.0.0.1:<port>`, at its own path and query, with `headers` — the
 * caller's, already stripped of what must not travel and carrying the token. Rejects when the
 * server cannot be reached or the page let go before it answered; resolves with its answer, body
 * streamed, otherwise.
 */
export function forward(request: Request, port: number, headers: Headers): Promise<Response> {
  const url = new URL(request.url);
  const signal = request.signal;
  return new Promise<Response>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("the page let go of the request"));
    const out: Record<string, string> = {};
    headers.forEach((value, name) => {
      out[name] = value;
    });
    const upstream = http.request(
      { host: "127.0.0.1", port, method: request.method, path: `${url.pathname}${url.search}`, headers: out, agent },
      (res) => {
        const answer = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined || HOP.includes(name)) continue;
          for (const v of Array.isArray(value) ? value : [value]) answer.append(name, v);
        }
        const status = res.statusCode ?? 502;
        const init = { status, statusText: res.statusMessage, headers: answer };
        if (NO_BODY.has(status) || request.method === "HEAD") {
          res.resume();
          return resolve(new Response(null, init));
        }
        /* `toWeb` cancels by destroying `res`, and destroying `res` closes the socket under it. */
        resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, init));
      },
    );
    const abort = () => upstream.destroy(new Error("the page let go of the request"));
    signal.addEventListener("abort", abort, { once: true });
    upstream.on("close", () => signal.removeEventListener("abort", abort));
    upstream.on("error", reject);
    if (request.body)
      Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0])
        .on("error", abort)
        .pipe(upstream);
    else upstream.end();
  });
}
