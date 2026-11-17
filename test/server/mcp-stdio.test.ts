/**
 * `anydag mcp` over its **stdio** transport: one request is one line, and how large one may be.
 *
 * `mcp.test.ts` proves the tools over the in-memory pair, which has no bytes on a wire and so could
 * never have found #399: an SDK-default read buffer of 10 MB, a `file_upload` whose base64 `data`
 * makes a frame past it, and a server that answered its last request and exited. These are the
 * frames themselves — the framing, the ceiling, the answer to a frame over it, and the session
 * still there afterwards.
 */
import "./sqlite-shim";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PassThrough, Readable, type Writable } from "node:stream";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { inProcess } from "../../server/mcp/backend";
import { Frames, frameTooLarge } from "../../server/mcp/frame";
import { buildMcp, stdioTransport } from "../../server/mcp/server";
import { makeEnv, sweepTemps, until, type Env } from "./helpers";

let env: Env;
let session: Session;
const clients: Client[] = [];

beforeEach(() => {
  env = makeEnv();
  session = new Session(env.home, env.vault, "test");
});
afterEach(async () => {
  for (const c of clients) await c.close();
  clients.length = 0;
  await env.cleanup();
  sweepTemps();
});

/**
 * The client's end of a pipe, with the SDK's own line buffer: what the server writes is read the
 * way a client reads it, and nothing here stands in for the server's half.
 */
class Pipe implements Transport {
  private buffer = new ReadBuffer();
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  constructor(
    private readonly from: Readable,
    private readonly to: Writable,
  ) {}
  async start(): Promise<void> {
    this.from.on("data", (chunk: Buffer) => {
      this.buffer.append(chunk);
      for (let message = this.buffer.readMessage(); message; message = this.buffer.readMessage()) this.onmessage?.(message);
    });
  }
  async send(message: JSONRPCMessage): Promise<void> {
    this.to.write(serializeMessage(message));
  }
  async close(): Promise<void> {
    this.from.destroy();
  }
}

/** A client and a server talking over two pipes, over the server's real stdio transport. */
async function connect(limit?: number): Promise<Client> {
  const backend = inProcess(createApp({ session, token: "t", page: null }), "t");
  const server = await buildMcp(backend, { readOnly: false });
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  await server.connect(await stdioTransport(toServer, fromServer, limit));
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new Pipe(fromServer, toServer));
  clients.push(client);
  return client;
}

const text = (res: any): any => JSON.parse(res.content[0].text);

describe("a request frame", () => {
  it("carries a file past the SDK's 10 MB default, keeps the bytes, and answers the next call", async () => {
    const client = await connect();
    /* 8 MB is the QA case: 10.7 MB as base64, a hair over the 10 MB the SDK buffered before #399. */
    const bytes = Buffer.alloc(8 * 1024 * 1024, 7);
    const made = text(
      await client.callTool({ name: "file_upload", arguments: { filename: "qa-big-8.pdf", data: bytes.toString("base64") } }),
    );
    expect(made.bytes).toBe(bytes.length);
    expect(made.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(fs.statSync(path.join(env.root, made.name)).size).toBe(bytes.length);

    const after = text(await client.callTool({ name: "whoami", arguments: {} }));
    expect(after.vaults[0].id).toBe(env.vault.id);
  }, 30_000);

  it("is answered with a JSON-RPC error naming its own id when it is over the ceiling, and the session lives", async () => {
    /* A ceiling a test can pass a frame over without writing 64 MB; the wiring is the server's own. */
    const client = await connect(2 * 1024 * 1024);
    const data = Buffer.alloc(3 * 1024 * 1024, 1).toString("base64");
    /* The client matches the answer to the request it is waiting on by id: an unmatched id would
       leave this promise pending until the test's timeout, which is the other half of the check. */
    await expect(client.callTool({ name: "file_upload", arguments: { filename: "too-big.pdf", data } })).rejects.toThrow(
      /over the 2 MB one MCP request may be.*not read.*still up.*up to about 1\.5 MB.*`url`/s,
    );

    expect(fs.readdirSync(env.root)).not.toContain("too-big.pdf");
    const after = text(await client.callTool({ name: "whoami", arguments: {} }));
    expect(after.vaults[0].id).toBe(env.vault.id);
  }, 30_000);
});

describe("Frames", () => {
  it("assembles a frame that arrives in pieces, drops one over the limit, and carries on", async () => {
    const source = new PassThrough();
    const frames: string[] = [];
    const dropped: { head: string; tail: string; bytes: number }[] = [];
    const out = new Frames(source, 1024, (head, tail, bytes) =>
      dropped.push({ head: head.toString("utf8"), tail: tail.toString("utf8"), bytes }),
    );
    out.on("data", (line: Buffer) => frames.push(line.toString("utf8")));
    for (const piece of [
      '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      '\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"board_write","arguments":{"text":"',
      "x".repeat(4096),
      '"}}}\n{"jsonrpc":"2.0","id":3,"method":"ping"}\n',
    ]) {
      source.write(piece);
      await new Promise((r) => setTimeout(r, 5));
    }
    await until(() => frames.length === 2 && dropped.length === 1, 5000, "both frames and the drop");

    expect(frames).toEqual(['{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n', '{"jsonrpc":"2.0","id":3,"method":"ping"}\n']);
    expect(dropped[0]!.head).toContain('"id":2');
    expect(dropped[0]!.bytes).toBeGreaterThan(4096);
  });

  it("answers the id of a request whose own arguments are the bulk of the frame, either way its client writes them", () => {
    const limit = 64 * 1024 * 1024;
    const answer = (head: string, tail = "") =>
      JSON.parse(frameTooLarge(Buffer.from(head), Buffer.from(tail), 70 * 1024 * 1024, limit));
    /* The SDK's own client writes `{...request, jsonrpc, id}` — the id last, past the arguments. */
    expect(
      answer(
        '{"method":"tools/call","params":{"name":"board_patch","arguments":{"ops":[{"id":"card"}',
        '}]},"jsonrpc":"2.0","id":7}',
      ).id,
    ).toBe(7);
    /* A client that writes it first: read at depth 1, never the `id` of a card in the arguments. */
    expect(answer('{"jsonrpc":"2.0","id":"a1","method":"board_patch","params":{"ops":[{"id":"card"},', "]}").id).toBe("a1");
    /* A frame that never carries one is answered as JSON-RPC says for a request it could not read. */
    expect(answer('{"method":"tools/call","params":{"id":"card"}', "}}").id).toBeNull();
  });
});
