/**
 * The Assistant end to end but for the model: a real server on a real port, a chat whose harness is
 * the scripted fake (`server/chat/fake.ts`), which reaches the vault over HTTP with the chat's header
 * exactly as a chat's MCP server does — so the guard, the approvals, the recorder and undo are all
 * the real ones.
 */
import "./sqlite-shim";
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
import type { ChatEvent, ChatMeta, Step, Turn } from "../../server/chat/types";
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

async function api(method: string, route: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
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
  const r = await api("POST", `/__board/chat${q(o.vault ?? env.vault.id)}`, { provider: o.provider ?? "claude", model: "m", mode: o.mode ?? "edit" });
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
  assistant = new Assistant({ session, token: TOKEN, harnesses: { claude: watched("claude"), opencode: watched("opencode") }, scratch: os.tmpdir() });
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
      if (s.kind === "approval" && s.answer === null) void api("POST", "/__board/chat/approve", { id: chat.id, step: s.id, yes: false });
    });
    expect(said(no)).toMatch(/Did not delete log: the person said no/);
    expect(exists(env.root, "log.md")).toBe(true);
    const approval = no.steps.find((s) => s.kind === "approval") as Extract<Step, { kind: "approval" }>;
    expect(approval.answer).toBe("no");
    expect(approval.detail).toContain("log");

    const yes = await say(chat.id, "delete log", {}, (s) => {
      if (s.kind === "approval" && s.answer === null) void api("POST", "/__board/chat/approve", { id: chat.id, step: s.id, yes: true });
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
      if (s.kind === "access" && s.answer === null) void api("POST", "/__board/chat/approve", { id: chat.id, step: s.id, yes: true });
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
    const kit = { readOnly: true, via: "test", needWrite() {}, async url() { return "anydag://x"; }, async bytes() { throw new Error("no"); },
      async api(method: string, route: string, o?: unknown) { calls.push([method, route, o]); return { text: "# hi", base: "b" }; } };
    await expect(read.run({ kind: "note" }, kit as never)).rejects.toThrow(/doc_read for a note: name/);
    expect(calls).toEqual([]);
    await read.run({ kind: "note", name: "plan" }, kit as never);
    expect(JSON.stringify(calls[0])).toContain("plan");
  });
});

describe("the chat's MCP server", () => {
  it("reaches the app with the chat's header, so the guard holds it to the turn", async () => {
    const chat = await newChat({ mode: "ask" });
    const server = buildMcp(remote(port, TOKEN, { "x-anydag-chat": chat.id }), { readOnly: true, chat: { id: chat.id, mode: "ask", home: env.vault.id } });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(chatTools("ask").map((t) => t.name).sort());
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
