/**
 * The Assistant end to end but for the model: a real server on a real port, a chat whose harness is
 * the scripted fake (`server/chat/fake.ts`), which reaches the vault over HTTP with the chat's header
 * exactly as a chat's MCP server does — so the guard, the approvals, the recorder and undo are all
 * the real ones.
 */
import "./sqlite-shim";
import { createHash } from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { serve, type ServerType } from "@hono/node-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { fakeHarness } from "../../server/chat/fake";
import type { Harness, RunOptions } from "../../server/chat/harness";
import { Assistant } from "../../server/chat/live";
import { newId } from "../../server/chat/store";
import type { ChatEvent, ChatMeta, Op, Step, Turn, UndoRecord } from "../../server/chat/types";
import { Session } from "../../server/context";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { remote } from "../../server/mcp/backend";
import { NEVER_IN_CHAT, chatTools } from "../../server/mcp/chat";
import { buildMcp } from "../../server/mcp/server";
import { makeEnv, sweepTemps, type Env } from "./helpers";

const TOKEN = "t";
let env: Env;
let session: Session;
let assistant: Assistant;
let server: ServerType;
let port: number;
let runs: RunOptions[];
const temps: string[] = [];

/** The fake, with every run's options kept so a test can read what the harness was asked. */
function watched(provider: "claude" | "opencode"): Harness {
  const fake = fakeHarness(provider);
  return { ...fake, run: (o, on) => (runs.push(o), fake.run(o, on)) };
}

async function api(
  method: string,
  route: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { "x-anydag-token": TOKEN, ...(body ? { "content-type": "application/json" } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json };
}

const q = (vault: string) => `?vault=${encodeURIComponent(vault)}`;

async function newChat(o: { mode?: "ask" | "edit"; provider?: "claude" | "opencode"; vault?: string } = {}): Promise<ChatMeta> {
  const r = await api("POST", `/__board/chat${q(o.vault ?? env.vault.id)}`, {
    provider: o.provider ?? "claude",
    model: "m",
    mode: o.mode ?? "edit",
  });
  expect(r.status).toBe(200);
  return r.json.chat;
}

/** Say something and wait for the turn to end; `onStep` sees each step as it lands. */
async function say(chat: string, text: string, extra: Record<string, unknown> = {}, onStep?: (s: Step) => void): Promise<Turn> {
  const ended = new Promise<Turn>((resolve) => {
    const off = assistant.listen(chat, (e: ChatEvent) => {
      if (e.type === "step") onStep?.(e.step);
      if (e.type === "end") {
        off();
        resolve(e.turn);
      }
    });
  });
  const r = await api("POST", "/__board/chat/turn", { id: chat, text, ...extra });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return ended;
}

const said = (t: Turn): string =>
  t.steps
    .filter((s): s is Extract<Step, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text)
    .join("\n");

const exists = (root: string, rel: string) => fs.existsSync(path.join(root, rel));

beforeEach(async () => {
  env = makeEnv();
  runs = [];
  session = new Session(env.home, env.vault, "test");
  assistant = new Assistant({
    session,
    token: TOKEN,
    harnesses: { claude: watched("claude"), opencode: watched("opencode") },
    scratch: os.tmpdir(),
  });
  const app = createApp({ session, token: TOKEN, page: null, assistant });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  assistant.listening(port);
});

afterEach(async () => {
  await assistant.close();
  await new Promise<void>((r) => server.close(() => r()));
  await env.cleanup();
  for (const t of temps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
  sweepTemps();
});

describe("a turn", () => {
  it("makes a note through the guard, cites it, and keeps the turn", async () => {
    const chat = await newChat();
    const turn = await say(chat.id, "block Start a log\nnote log First line");
    expect(turn.status).toBe("done");
    expect(exists(env.root, "log.md")).toBe(true);
    expect(said(turn)).toMatch(/\[log\]\(dag:\w+\)/);
    expect(turn.blocks.map((b) => b.title)).toEqual(["Start a log"]);
    expect(turn.blocks[0]!.ops.length).toBeGreaterThan(0);

    const read = await api("GET", `/__board/chat?id=${chat.id}`);
    expect(read.json.turns).toHaveLength(1);
    expect(read.json.chat.title).toBe("block Start a log note log First line");
    expect(read.json.live).toBeNull();
  });

  it("lists the chat, and every vault's with ?all", async () => {
    const chat = await newChat();
    const rows = (await api("GET", `/__board/chats${q(env.vault.id)}`)).json.chats;
    expect(rows.map((r: { id: string }) => r.id)).toEqual([chat.id]);
    expect((await api("GET", "/__board/chats?all=1")).json.chats).toHaveLength(1);
  });

  it("refuses a second turn while one is running, and stops one", async () => {
    const chat = await newChat();
    const ended = new Promise<Turn>((resolve) => assistant.listen(chat.id, (e) => e.type === "end" && resolve(e.turn)));
    expect((await api("POST", "/__board/chat/turn", { id: chat.id, text: "wait" })).status).toBe(200);
    const again = await api("POST", "/__board/chat/turn", { id: chat.id, text: "hello" });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("running");
    await api("POST", "/__board/chat/stop", { id: chat.id });
    expect((await ended).status).toBe("stopped");
  });

  it("keeps a failure as a failed turn", async () => {
    const chat = await newChat();
    const turn = await say(chat.id, "fail it broke");
    expect(turn.status).toBe("failed");
    expect(turn.steps.some((s) => s.kind === "error" && s.text === "it broke")).toBe(true);
  });
});

describe("the guard", () => {
  it("refuses a write in Ask mode, and nothing changes", async () => {
    const chat = await newChat({ mode: "ask" });
    const turn = await say(chat.id, "note log hi");
    expect(said(turn)).toMatch(/Could not make log: .*Ask mode/);
    expect(exists(env.root, "log.md")).toBe(false);
    expect(turn.blocks).toEqual([]);
  });

  it("lets a turn switch the mode", async () => {
    const chat = await newChat({ mode: "ask" });
    await say(chat.id, "note log hi", { mode: "edit" });
    expect(exists(env.root, "log.md")).toBe(true);
  });

  it("answers a request for a chat with no turn running with 409", async () => {
    const chat = await newChat();
    const r = await api("GET", "/__board/list", undefined, { "x-anydag-chat": chat.id });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("no-turn");
  });

  it("refuses the chat-only routes to anybody else", async () => {
    expect((await api("POST", "/__board/chat/block", { title: "x" })).json.code).toBe("chat-only");
  });

  it("waits for approval before a delete, and honours a no", async () => {
    const chat = await newChat();
    await say(chat.id, "note log hi");
    const no = await say(chat.id, "delete log", {}, (s) => {
      if (s.kind === "approval" && s.answer === null)
        void api("POST", "/__board/chat/approve", { id: chat.id, step: s.id, yes: false });
    });
    expect(said(no)).toMatch(/Did not delete log: the person said no/);
    expect(exists(env.root, "log.md")).toBe(true);
    const approval = no.steps.find((s) => s.kind === "approval") as Extract<Step, { kind: "approval" }>;
    expect(approval.answer).toBe("no");
    expect(approval.detail).toContain("log");

    const yes = await say(chat.id, "delete log", {}, (s) => {
      if (s.kind === "approval" && s.answer === null)
        void api("POST", "/__board/chat/approve", { id: chat.id, step: s.id, yes: true });
    });
    expect(said(yes)).toMatch(/Deleted log/);
    expect(exists(env.root, "log.md")).toBe(false);
  });

  it("reaches another vault only once it is granted", async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-other-"));
    temps.push(other);
    const v2 = session.openFolder(other).id;
    const chat = await newChat();

    const refused = await say(chat.id, `note@${v2} far hi`);
    expect(said(refused)).toMatch(/does not reach vault/);
    expect(exists(other, "far.md")).toBe(false);

    const granted = await say(chat.id, `vault ${v2} edit\nnote@${v2} far hi`, {}, (s) => {
      if (s.kind === "access" && s.answer === null)
        void api("POST", "/__board/chat/approve", { id: chat.id, step: s.id, yes: true });
    });
    expect(said(granted)).toMatch(/Granted/);
    expect(exists(other, "far.md")).toBe(true);
    expect((await api("GET", `/__board/chat?id=${chat.id}`)).json.chat[`grant:${v2}`].mode).toBe("edit");

    // An Ask turn reads a vault granted for edit, and writes nothing there.
    const asked = await say(chat.id, `note@${v2} near hi`, { mode: "ask" });
    expect(said(asked)).toMatch(/Could not make near/);

    // Taken back, it is out of reach again.
    await api("POST", "/__board/chat/grant", { id: chat.id, vault: v2, mode: null });
    const gone = await say(chat.id, `note@${v2} gone hi`, { mode: "edit" });
    expect(said(gone)).toMatch(/does not reach vault/);
  });
});

describe("undo", () => {
  it("undoes a block and redoes it", async () => {
    const chat = await newChat();
    const turn = await say(chat.id, "block Make two\nnote a one\nnote b two");
    const block = turn.blocks[0]!;
    expect(exists(env.root, "a.md") && exists(env.root, "b.md")).toBe(true);

    const undone = await api("POST", "/__board/chat/undo", { id: chat.id, turn: turn.id, block: block.id });
    expect(undone.status, JSON.stringify(undone.json)).toBe(200);
    expect(undone.json.record.conflicts).toEqual([]);
    expect(exists(env.root, "a.md") || exists(env.root, "b.md")).toBe(false);

    expect((await api("POST", "/__board/chat/undo", { id: chat.id, turn: turn.id, block: block.id })).json.code).toBe("state");

    const redone = await api("POST", "/__board/chat/redo", { id: chat.id, turn: turn.id, block: block.id });
    expect(redone.status).toBe(200);
    expect(fs.readFileSync(path.join(env.root, "a.md"), "utf8")).toContain("one");
    expect((await api("GET", `/__board/chat?id=${chat.id}`)).json.undos).toHaveLength(2);
  });

  it("splits a turn into the blocks the agent named", async () => {
    const chat = await newChat();
    const turn = await say(chat.id, "block First\nnote a one\nblock Second\nedit a two");
    expect(turn.blocks.map((b) => b.title)).toEqual(["First", "Second"]);
    await api("POST", "/__board/chat/undo", { id: chat.id, turn: turn.id, block: turn.blocks[1]!.id });
    expect(fs.readFileSync(path.join(env.root, "a.md"), "utf8")).toContain("one");
  });

  it("names a conflict rather than overwrite a later change", async () => {
    const chat = await newChat();
    const turn = await say(chat.id, "note a one");
    fs.writeFileSync(path.join(env.root, "a.md"), "the person changed it\n");
    const undone = await api("POST", "/__board/chat/undo", { id: chat.id, turn: turn.id, block: turn.blocks[0]!.id });
    expect(undone.json.record.conflicts.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(env.root, "a.md"), "utf8")).toBe("the person changed it\n");
  });
});

describe("undo, on a chat somebody else wrote into the vault", () => {
  // What a synced device, a shared folder or a downloaded vault can deliver: the chat's files, written
  // straight into `.anydag/chats/` without one call to the chat api.
  const b64 = (text: string) => Buffer.from(text).toString("base64");
  let outside: string;
  let chatId: string;
  const out = (from: string, name: string) => path.relative(path.join(env.root, from), path.join(outside, name));
  const dir = () => path.join(env.root, ".anydag/chats", chatId);
  const plant = (rel: string, v: unknown) => {
    fs.mkdirSync(path.dirname(path.join(dir(), rel)), { recursive: true });
    fs.writeFileSync(path.join(dir(), rel), JSON.stringify(v));
  };
  const turnOf = (id: string, blocks: Turn["blocks"]): Turn => ({
    v: 1,
    id,
    chat: chatId,
    device: "zzzz",
    at: "2026-11-07T00:00:00.000Z",
    text: "tidy my notes",
    provider: "claude",
    model: "m",
    mode: "edit",
    status: "done",
    steps: [],
    blocks,
  });
  /** Every way out a record could name: a path, a folder's file and subfolder, a folder moved in. */
  const escapes = (vault = env.vault.id): Op => ({
    what: "POST /__board/patch",
    vault,
    at: "2026-11-07T00:00:00.000Z",
    undoable: true,
    images: [
      { rel: out("", "planted.sh"), before: { t: "file", b64: b64("echo planted\n") }, after: "-" },
      { rel: path.join(outside, "absolute.sh"), before: { t: "file", b64: b64("echo planted\n") }, after: "-" },
      {
        rel: "notes-old",
        before: {
          t: "dir",
          dirs: [out("notes-old", "made")],
          files: { [out("notes-old", "autostart.desktop")]: b64("[Desktop Entry]\n") },
        },
        after: "-",
      },
      { rel: "attachments/notes.txt", before: { t: "moved", to: out("", "id_ed25519") }, after: "-" },
    ],
  });
  const listing = () => fs.readdirSync(outside).sort();

  beforeEach(() => {
    // Beside the vault, as a person's home folder would be.
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-victim-"));
    temps.push(outside);
    fs.writeFileSync(path.join(outside, "id_ed25519"), "PRIVATE-KEY-DUMMY\n");
    chatId = newId("c", "zzzz");
    plant("chat.json", {
      v: 1,
      id: chatId,
      title: "Tidy",
      created: "2026-11-07T00:00:00.000Z",
      home: env.vault.id,
      provider: "claude",
      model: "m",
      mode: "edit",
    });
  });

  it("refuses an undo whose turn names a path outside the vault, and touches nothing", async () => {
    const t = newId("t", "zzzz");
    plant(`${t}.json`, turnOf(t, [{ id: "bplanted01", title: "Tidy the notes", ops: [escapes()] }]));
    const r = await api("POST", "/__board/chat/undo", { id: chatId, turn: t, block: "bplanted01" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.record.conflicts.map((c: { why: string }) => c.why)).toEqual(["refused"]);
    expect(r.json.record.ops).toEqual([]);
    expect(listing()).toEqual(["id_ed25519"]);
    expect(exists(env.root, "notes-old") || exists(env.root, "attachments/notes.txt")).toBe(false);
  });

  it("refuses a redo whose undo record names a path outside the vault", async () => {
    const t = newId("t", "zzzz");
    plant(`${t}.json`, turnOf(t, [{ id: "bplanted02", title: "Tidy", ops: [] }]));
    const u = newId("u", "zzzz");
    const rec: UndoRecord = {
      v: 1,
      id: u,
      chat: chatId,
      turn: t,
      block: "bplanted02",
      redo: false,
      device: "zzzz",
      at: "2026-11-07T00:00:00.000Z",
      ops: [escapes()],
      conflicts: [],
    };
    plant(`undo/${u}.json`, rec);
    const r = await api("POST", "/__board/chat/redo", { id: chatId, turn: t, block: "bplanted02" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.record.conflicts.map((c: { why: string }) => c.why)).toEqual(["refused"]);
    expect(listing()).toEqual(["id_ed25519"]);
  });

  it("refuses an op in an open vault the chat was never granted", async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-other-"));
    temps.push(other);
    const v2 = session.openFolder(other).id;
    fs.writeFileSync(path.join(other, "theirs.md"), "keep\n");
    const t = newId("t", "zzzz");
    const op: Op = {
      what: "POST /__board/patch",
      vault: v2,
      at: "2026-11-07T00:00:00.000Z",
      undoable: true,
      images: [{ rel: "theirs.md", before: { t: "absent" }, after: `f:${createHash("sha1").update("keep\n").digest("hex")}` }],
    };
    plant(`${t}.json`, turnOf(t, [{ id: "bplanted03", title: "Tidy", ops: [op] }]));
    const r = await api("POST", "/__board/chat/undo", { id: chatId, turn: t, block: "bplanted03" });
    expect(r.json.record.conflicts.map((c: { why: string }) => c.why)).toEqual(["refused"]);
    expect(fs.readFileSync(path.join(other, "theirs.md"), "utf8")).toBe("keep\n");
  });

  it("does not read a turn file without a turn's shape", async () => {
    const t = newId("t", "zzzz");
    plant(`${t}.json`, {
      ...turnOf(t, []),
      blocks: [{ id: "b1", title: "x", ops: [{ what: "x", vault: env.vault.id, undoable: true, images: [{ rel: 1 }] }] }],
    });
    expect((await api("GET", `/__board/chat?id=${chatId}`)).json.turns).toEqual([]);
    expect((await api("POST", "/__board/chat/undo", { id: chatId, turn: t, block: "b1" })).json.code).toBe("block");
  });
});

describe("sessions", () => {
  it("resumes the provider's session, and seeds a fresh one after a switch", async () => {
    const chat = await newChat();
    await say(chat.id, "hello");
    expect(runs[0]!.fresh).toBeTruthy();
    expect(runs[0]!.prompt).toBe("hello");

    await say(chat.id, "again");
    expect(runs[1]!.resume).toBe(runs[0]!.fresh);
    expect(runs[1]!.prompt).toBe("again");

    await say(chat.id, "now you", { provider: "opencode", model: "x/y" });
    expect(runs[2]!.resume).toBeUndefined();
    expect(runs[2]!.prompt).toContain("<person>\nhello\n</person>");
    expect(runs[2]!.prompt).toContain("You said: again");
    expect(runs[2]!.prompt.endsWith("The person now says:\n\nnow you")).toBe(true);
    expect(runs[2]!.model).toBe("x/y");
  });

  it("tells the model its mode and its reach", async () => {
    const chat = await newChat({ mode: "ask" });
    await say(chat.id, "hello");
    expect(runs[0]!.system).toContain("**Ask.**");
    expect(runs[0]!.system).toContain(env.vault.id);
    expect(runs[0]!.mcp.args).toEqual(expect.arrayContaining(["mcp", "--chat", chat.id, "--mode", "ask"]));
    expect(runs[0]!.mcp.env.ANYDAG_CHAT_PORT).toBe(String(port));
  });
});

describe("the chat's MCP tools", () => {
  it("offers Ask no write tool and Edit the block tool, and neither a way to open a vault", () => {
    const ask = chatTools("ask").map((t) => t.name);
    const edit = chatTools("edit").map((t) => t.name);
    expect(chatTools("ask").filter((t) => t.write)).toEqual([]);
    expect(ask).toContain("vault_request");
    expect(ask).not.toContain("change_block");
    expect(edit).toEqual(expect.arrayContaining(["change_block", "vault_request", "doc_create", "board_patch"]));
    // The per-kind tools a `doc_*` stands for are not offered twice.
    expect(edit).not.toContain("note_create");
    expect(ask).toContain("doc_read");
    expect(ask).not.toContain("doc_write");
    for (const name of NEVER_IN_CHAT) {
      expect(ask).not.toContain(name);
      expect(edit).not.toContain(name);
    }
  });

  it("hands a doc_* call to the kind's own tool, held to that tool's arguments", async () => {
    const read = chatTools("ask").find((t) => t.name === "doc_read")!;
    const calls: unknown[] = [];
    const kit = {
      readOnly: true,
      via: "test",
      needWrite() {},
      async url() {
        return "anydag://x";
      },
      async bytes() {
        throw new Error("no");
      },
      async api(method: string, route: string, o?: unknown) {
        calls.push([method, route, o]);
        return { text: "# hi", base: "b" };
      },
    };
    await expect(read.run({ kind: "note" }, kit as never)).rejects.toThrow(/doc_read for a note: name/);
    expect(calls).toEqual([]);
    await read.run({ kind: "note", name: "plan" }, kit as never);
    expect(JSON.stringify(calls[0])).toContain("plan");
  });
});

describe("the chat's MCP server", () => {
  it("reaches the app with the chat's header, so the guard holds it to the turn", async () => {
    const chat = await newChat({ mode: "ask" });
    const server = buildMcp(remote(port, TOKEN, { "x-anydag-chat": chat.id }), {
      readOnly: true,
      chat: { id: chat.id, mode: "ask", home: env.vault.id },
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(
        chatTools("ask")
          .map((t) => t.name)
          .sort(),
      );
      // No turn is running: everything the tool reaches is refused.
      const res: any = await client.callTool({ name: "doc_list", arguments: { kind: "note" } });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/no turn running/);
    } finally {
      await client.close();
    }
  });
});

describe("the models route", () => {
  it("says the server is the fake, and offers both providers whatever is installed", async () => {
    const r = await api("GET", "/__board/chat/models");
    expect(r.json.fake).toBe(true);
    expect(r.json.providers.every((p: { available: boolean }) => p.available)).toBe(true);
  });
});
