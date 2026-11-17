/**
 * How a request reaches the MCP server over stdio: one JSON-RPC frame per line, under a ceiling.
 *
 * **The SDK's read buffer is a wall with the process behind it.** `StdioServerTransport` collects
 * stdin until it finds a newline, and past its `maxBufferSize` — 10 MB when nothing says — it throws
 * the frame away, closes the transport, and takes every later call of the session with it: the
 * client saw an `EPIPE`, and a server that had answered its last request (#399). A `file_upload`
 * carries a file's bytes as base64 `data`, four thirds their size, so the default cut every file
 * over 7.5 MB out of a vault that takes 512 MB. The buffer also concatenates what it holds with
 * every chunk, so one frame of n bytes is copied about n/chunk times: 133 MB arriving in 64 KB
 * reads is some 135 GB of memcpy, whatever the ceiling says.
 *
 * So the transport is handed one assembled line at a time — linear in the bytes — and a frame over
 * the ceiling is answered instead of fatal: **a request too large is a refusal, never a dead
 * connection.**
 */

import { Readable } from "node:stream";

import { megabytes } from "../uploads";

/**
 * The most one request frame may be.
 *
 * A frame is held three times over on the way in — its bytes, the string `JSON.parse` builds from
 * them, and the values it makes — and V8 cannot hold a string past about 512 MB at all, so this is
 * a memory budget as much as a wire one. 64 MB carries a file of about 48 MB as base64 `data`,
 * which is a screenshot, a report or a short recording; a bigger file goes as `url`, which the
 * server fetches itself (`file_upload`), so the vault's own `ANYDAG_UPLOAD_MAX_MB` still applies to
 * the store rather than to the wire.
 */
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

/** The largest file one frame carries as base64 `data`: four thirds the bytes, less the envelope
 *  the rest of the frame needs (the id, the method, the tool's other arguments). */
export const MAX_DATA_BYTES = Math.floor(((MAX_FRAME_BYTES - 64 * 1024) * 3) / 4);

/** How much of each end of a dropped frame is kept: enough for the one thing an answer needs, its
 *  `id`, wherever the client put it. */
const HEAD = 8 * 1024;
const NEWLINE = 0x0a;
const ID = /^"id"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+|null)/;
const ANY_ID = /"id"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+|null)/g;

/**
 * The answer to a frame too large to read: a JSON-RPC error for the request's own `id`, which is
 * what lets the client fail the call it is waiting on instead of losing the session.
 *
 * `id` is a member of the outermost object and the arguments are the bulk of the frame, so a client
 * writes it either before them or after them. The first is read exactly — walking `head` outside
 * strings, where the top-level member is the one at depth 1 — and the second is the last `"id"` in
 * `tail`, the end of the frame, because the object closes after it. A frame with neither is
 * answered with `null`, JSON-RPC's own answer for a request that could not be read. The message is
 * what the model acts on: what happened, that nothing was done, and the way through.
 */
export function frameTooLarge(head: Buffer, tail: Buffer, bytes: number, limit: number): string {
  const raw = idIn(head) ?? [...tail.toString("utf8").matchAll(ANY_ID)].pop()?.[1];
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id: raw === undefined ? null : JSON.parse(raw),
    error: { code: -32600, message: tooLarge(bytes, limit) },
  })}\n`;
}

/** The outermost object's `id`, read from the first bytes of a request — `undefined` when the head
 *  does not hold it. */
function idIn(head: Buffer): string | undefined {
  const text = head.toString("utf8");
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === "\\") i++;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      if (depth === 1) {
        const found = ID.exec(text.slice(i, i + 512));
        if (found) return found[1];
      }
      quoted = true;
    } else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
  }
  return undefined;
}

function tooLarge(bytes: number, limit: number): string {
  const file = Math.floor(((limit - 64 * 1024) * 3) / 4);
  const carry =
    file > 0
      ? ` A file's bytes travel as base64 \`data\`, four thirds their size: one of up to about ${megabytes(file)} fits, and a bigger one goes as \`url\`, which the server fetches itself.`
      : "";
  return (
    `${megabytes(bytes)} is over the ${megabytes(limit)} one MCP request may be, so it was not read: nothing was done, and the server is still up.` +
    carry +
    " A document is written a piece at a time with `board_patch`."
  );
}

/**
 * A byte stream split into newline-terminated frames, one frame per `data` event, dropping any one
 * that passes `limit` and saying how big it was.
 *
 * The transport gets a whole line in a single chunk, so its own buffer has nothing to concatenate
 * and the message it parses is the one this assembled. The source is paused while a completed frame
 * is still queued, so a slow reader holds one frame rather than the whole stream.
 */
export class Frames extends Readable {
  private parts: Buffer[] = [];
  private held = 0;
  private dropping = false;
  private dropped = 0;
  private head: Buffer[] = [];
  private tail: Buffer = Buffer.alloc(0);

  constructor(
    private readonly source: Readable,
    private readonly limit: number,
    private readonly oversized: (head: Buffer, tail: Buffer, bytes: number) => void,
  ) {
    super();
    source.on("data", (chunk: Buffer) => this.feed(chunk));
    source.on("end", () => this.push(null));
    source.on("error", (e) => this.destroy(e));
  }

  override _read(): void {
    this.source.resume();
  }

  private feed(chunk: Buffer): void {
    for (let at = 0; at < chunk.length; ) {
      const nl = chunk.indexOf(NEWLINE, at);
      const part = chunk.subarray(at, nl < 0 ? chunk.length : nl);
      /* The newline is part of the frame: the transport counts it, so this counts it too. */
      const newline = nl < 0 ? 0 : 1;
      if (this.dropping) {
        this.dropped += part.length;
        this.keepTail(part);
        if (nl < 0) return;
        this.report();
      } else if (this.held + part.length + newline > this.limit) {
        this.beginDrop(part, newline);
      } else {
        if (part.length) {
          this.parts.push(part);
          this.held += part.length;
        }
        if (nl < 0) return;
        const line = Buffer.concat([...this.parts, chunk.subarray(nl, nl + 1)]);
        this.parts = [];
        this.held = 0;
        if (!this.push(line)) {
          this.source.pause();
          return;
        }
      }
      at = nl + 1;
    }
  }

  /** This frame is over the ceiling: keep both ends of it, then drop it until its newline. */
  private beginDrop(part: Buffer, newline: number): void {
    this.dropped = this.held + part.length + newline;
    let room = HEAD;
    for (const piece of [...this.parts, part]) {
      if (room <= 0) break;
      const keep = piece.subarray(0, room);
      if (keep.length) {
        this.head.push(keep);
        room -= keep.length;
      }
    }
    this.tail = Buffer.alloc(0);
    this.seedTail(part);
    this.parts = [];
    this.held = 0;
    this.dropping = true;
    if (newline) this.report();
  }

  /** The last bytes read into the frame so far, up to `HEAD` of them. */
  private seedTail(part: Buffer): void {
    const pieces = [part.length > HEAD ? part.subarray(part.length - HEAD) : part];
    let need = HEAD - pieces[0]!.length;
    for (let i = this.parts.length - 1; i >= 0 && need > 0; i--) {
      const piece = this.parts[i]!;
      const keep = piece.length > need ? piece.subarray(piece.length - need) : piece;
      pieces.unshift(keep);
      need -= keep.length;
    }
    this.tail = Buffer.concat(pieces);
  }

  private keepTail(part: Buffer): void {
    if (!part.length) return;
    if (part.length >= HEAD) {
      this.tail = part.subarray(part.length - HEAD);
      return;
    }
    const both = Buffer.concat([this.tail, part]);
    this.tail = both.length > HEAD ? both.subarray(both.length - HEAD) : both;
  }

  private report(): void {
    const head = Buffer.concat(this.head);
    const tail = this.tail;
    const bytes = this.dropped;
    this.dropping = false;
    this.dropped = 0;
    this.head = [];
    this.tail = Buffer.alloc(0);
    this.oversized(head, tail, bytes);
  }
}
