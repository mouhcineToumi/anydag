/**
 * Attachments are streamed (#278): an upload goes to a temp file beside its target and is renamed into
 * place, hashed as it passes; a read is a file stream, and a `Range` reads only its range. What that
 * must keep: the bytes and the `sha256` the answer gives, a 206 that is exactly its slice, and **no
 * partial file** when an upload stops half-way — in process and over a real socket.
 */
import "./sqlite-shim";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { serve, type ServerType } from "@hono/node-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { makeEnv, sweepTemps, until, type Env } from "./helpers";

const HEADERS = { "x-anydag-token": "t", host: "127.0.0.1" };
/** Three megabytes and a bit: many chunks on the way in and out, and a size no chunk divides. */
const BYTES = randomBytes(3 * 1024 * 1024 + 4321);

let env: Env;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  env = makeEnv();
  app = createApp({ session: new Session(env.home, env.vault, "test", { ANYDAG_UPLOAD_MAX_MB: "4" }), token: "t", page: null });
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

/** A request body that sends `data` 64 KB at a time, then fails if `fail` says so. */
function chunked(data: Uint8Array, fail?: { after: number }): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    pull(ctl) {
      if (fail && at >= fail.after) return ctl.error(new Error("the connection dropped"));
      if (at >= data.byteLength) return ctl.close();
      ctl.enqueue(data.subarray(at, at + 65536));
      at += 65536;
    },
  });
}

const upload = (body: BodyInit, headers: Record<string, string> = {}, name = "talk.mp4") =>
  app.request(`http://127.0.0.1/__board/file?folder=attachments&name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { ...HEADERS, ...headers },
    body,
    duplex: "half",
  } as RequestInit);

/** Every file under the vault but its own `.anydag/`: an attachment left behind, or a temp file. */
const left = () =>
  fs
    .readdirSync(env.root, { recursive: true })
    .map(String)
    .filter((f) => !f.startsWith(".anydag") && fs.statSync(path.join(env.root, f)).isFile());

describe("an upload, streamed", () => {
  it("keeps the bytes as sent, and the sha256 it answers is the file's", async () => {
    const res = await upload(chunked(BYTES));
    expect(res.status).toBe(200);
    const got = (await res.json()) as { name: string; sha256: string; bytes: number };
    expect(got.name).toBe("attachments/talk.mp4");
    expect(got.bytes).toBe(BYTES.byteLength);
    const kept = fs.readFileSync(path.join(env.root, "attachments", "talk.mp4"));
    expect(kept.equals(BYTES)).toBe(true);
    expect(got.sha256).toBe(createHash("sha256").update(kept).digest("hex"));
    expect(left()).toEqual(["attachments/talk.mp4"]);
  });

  it("that fails half-way leaves no file and no temp file", async () => {
    const res = await upload(chunked(BYTES, { after: 1024 * 1024 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("`talk.mp4` did not arrive whole");
    expect(left()).toEqual([]);
    expect((await env.vault.tree()).files).toEqual([]);
  });

  it("that ends short of its Content-Length is refused, and leaves nothing", async () => {
    const res = await upload(chunked(BYTES.subarray(0, 100_000)), { "content-length": String(BYTES.byteLength) });
    expect(res.status).toBe(400);
    expect(left()).toEqual([]);
  });

  it("over the limit with no length declared is refused part-way, and leaves nothing", async () => {
    const res = await upload(chunked(randomBytes(5 * 1024 * 1024)));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe("`talk.mp4` is over the limit of 4 MB");
    expect(left()).toEqual([]);
  });

  it("two of one name at once are two files, each whole", async () => {
    const other = randomBytes(BYTES.byteLength);
    const [a, b] = await Promise.all([upload(chunked(BYTES)), upload(chunked(other))]);
    const names = [((await a.json()) as { name: string }).name, ((await b.json()) as { name: string }).name];
    expect(names.sort()).toEqual(["attachments/talk 2.mp4", "attachments/talk.mp4"]);
    const kept = names.map((n) => fs.readFileSync(path.join(env.root, n)));
    expect(kept.some((k) => k.equals(BYTES)) && kept.some((k) => k.equals(other))).toBe(true);
    expect(left().sort()).toEqual(names);
  });

  it("dropped by the client over a real socket leaves no file and no temp file", async () => {
    const server: ServerType = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((r) => server.once("listening", () => r()));
    try {
      const port = (server.address() as AddressInfo).port;
      const req = http.request({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/__board/file?folder=attachments&name=talk.mp4",
        headers: { ...HEADERS, "content-length": String(BYTES.byteLength) },
      });
      req.on("error", () => undefined);
      req.write(BYTES.subarray(0, 1024 * 1024));
      /* The server has the first megabyte in its temp file before the connection goes. */
      await until(() => left().some((f) => f.endsWith(".tmp")), 5000, "a temp file");
      req.destroy();
      await until(() => left().length === 0, 5000, "the temp file removed");
      expect((await env.vault.tree()).files).toEqual([]);
    } finally {
      (server as http.Server).closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});

describe("a read, streamed", () => {
  let id: string;
  beforeEach(async () => {
    const res = await upload(chunked(BYTES));
    id = ((await res.json()) as { id: string }).id;
  });
  const read = (range?: string) =>
    app.request(`http://127.0.0.1/__board/file?id=${id}`, { headers: { ...HEADERS, ...(range ? { range } : {}) } });

  it("whole: every byte, with its length", async () => {
    const res = await read();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(BYTES.byteLength));
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES)).toBe(true);
  });

  it("a range is a 206 of exactly that slice", async () => {
    const first = 2 * 1024 * 1024 + 7;
    const res = await read(`bytes=${first}-${first + 1023}`);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes ${first}-${first + 1023}/${BYTES.byteLength}`);
    expect(res.headers.get("content-length")).toBe("1024");
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES.subarray(first, first + 1024))).toBe(true);
  });

  it("an open range runs to the end, and a suffix is the last n bytes", async () => {
    const tail = await read(`bytes=${BYTES.byteLength - 10}-`);
    expect(tail.status).toBe(206);
    expect(Buffer.from(await tail.arrayBuffer()).equals(BYTES.subarray(-10))).toBe(true);
    const suffix = await read("bytes=-500");
    expect(suffix.headers.get("content-range")).toBe(
      `bytes ${BYTES.byteLength - 500}-${BYTES.byteLength - 1}/${BYTES.byteLength}`,
    );
    expect(Buffer.from(await suffix.arrayBuffer()).equals(BYTES.subarray(-500))).toBe(true);
  });

  it("a range past the end is a 416 naming the size", async () => {
    const res = await read(`bytes=${BYTES.byteLength}-`);
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${BYTES.byteLength}`);
  });

  it("an empty file is an empty 200", async () => {
    const res = await upload(new Uint8Array(0), {}, "empty.txt");
    const empty = ((await res.json()) as { id: string }).id;
    const got = await app.request(`http://127.0.0.1/__board/file?id=${empty}`, { headers: HEADERS });
    expect(got.status).toBe(200);
    expect((await got.arrayBuffer()).byteLength).toBe(0);
  });
});
