import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { forward } from "../desktop/forward";

/**
 * The shell's forwarder (#123). Under Electron's `net.fetch` the page's requests shared Chromium's
 * six connections to one host, and a stream the page closed was never let go — so after a few
 * reloads or switches of chat every request waited for ever, and a note being rewritten by the
 * Assistant went blank while the sidebar stopped hearing of new files. These hold the two halves:
 * no cap, and a request the page lets go of closes its connection.
 */

interface Server {
  port: number;
  /** Streams the server has open right now. */
  open(): number;
  /** Every request it saw: method, path, the token header, the body. */
  seen: { method?: string; url?: string; token?: string | string[]; body: string }[];
  close(): Promise<void>;
}

const servers: Server[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

async function server(): Promise<Server> {
  let open = 0;
  const seen: Server["seen"] = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, token: req.headers["x-anydag-token"], body });
      if (req.url?.startsWith("/__board/events")) {
        open++;
        res.on("close", () => open--);
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": open\n\n");
        return;
      }
      if (req.url?.startsWith("/__board/none")) {
        res.writeHead(204);
        return res.end();
      }
      res.writeHead(201, { "content-type": "application/json", "set-cookie": ["a=1", "b=2"] });
      res.end(JSON.stringify({ said: body || "nothing" }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const s: Server = {
    port: (srv.address() as AddressInfo).port,
    open: () => open,
    seen,
    close: () =>
      new Promise((r) => {
        srv.closeAllConnections();
        srv.close(() => r());
      }),
  };
  servers.push(s);
  return s;
}

const headers = () => new Headers({ "x-anydag-token": "t0ken" });
const page = (path: string, init?: RequestInit) => new Request(`anydag://app${path}`, init);

/** Wait for `ok` to hold, for at most two seconds. */
async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
}

describe("the desktop's forwarder", () => {
  it("sends the path, the query, the method, the headers and the body, and hands the answer back", async () => {
    const s = await server();
    const res = await forward(
      page("/__board/put?name=a%20b&kind=note", { method: "POST", body: "hello", duplex: "half" } as RequestInit),
      s.port,
      headers(),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ said: "hello" });
    expect(s.seen).toEqual([{ method: "POST", url: "/__board/put?name=a%20b&kind=note", token: "t0ken", body: "hello" }]);
  });

  it("answers a status that has no body with none", async () => {
    const s = await server();
    const res = await forward(page("/__board/none"), s.port, headers());
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it("holds no cap of six: with eight streams open, another request is still answered", async () => {
    const s = await server();
    const held = new AbortController();
    const streams = await Promise.all(
      Array.from({ length: 8 }, (_, i) => forward(page(`/__board/events?i=${i}`, { signal: held.signal }), s.port, headers())),
    );
    expect(streams.every((r) => r.status === 200)).toBe(true);
    await until(() => s.open() === 8);
    expect(s.open()).toBe(8);
    const plain = await Promise.race([
      forward(page("/__board/list"), s.port, headers()).then((r) => r.status),
      new Promise((r) => setTimeout(() => r("waited"), 2000)),
    ]);
    expect(plain).toBe(201);
    held.abort();
    await until(() => s.open() === 0);
  });

  it("lets go of a stream the page closed, so a reload does not keep the old page's connection", async () => {
    const s = await server();
    const gone = new AbortController();
    const res = await forward(page("/__board/events", { signal: gone.signal }), s.port, headers());
    expect(res.status).toBe(200);
    await until(() => s.open() === 1);
    expect(s.open()).toBe(1);
    gone.abort();
    await until(() => s.open() === 0);
    expect(s.open()).toBe(0);
  });

  it("lets go of a stream whose answer is cancelled", async () => {
    const s = await server();
    const res = await forward(page("/__board/events"), s.port, headers());
    await until(() => s.open() === 1);
    await res.body!.cancel();
    await until(() => s.open() === 0);
    expect(s.open()).toBe(0);
  });

  it("rejects when nothing is listening, which the handler answers as a 502", async () => {
    const s = await server();
    const port = s.port;
    await s.close();
    servers.splice(0);
    await expect(forward(page("/__board/list"), port, headers())).rejects.toThrow();
  });
});
