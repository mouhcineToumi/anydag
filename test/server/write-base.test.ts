/**
 * An empty `base` is a stale base, not a missing one (#400).
 *
 * `Vault.write` read `if (base && base !== now.base)`, so `""` skipped the sha1 check and overwrote
 * whatever the other writer had put there — through `/__board/put` and so every `<kind>_write` tool,
 * where an agent passing an unset variable sends exactly that. The routes also turned a `base` of any
 * other type into "none". Only an absent or `null` base is the "I have not seen it" write (the CLI's
 * `--force`); a string is compared as it is, and anything else is a 400. Every route and MCP tool that
 * takes a `base` is sent `""` and `{}` here, against a file another writer has just moved.
 */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { inProcess } from "../../server/mcp/backend";
import { buildMcp } from "../../server/mcp/server";
import { Conflict, sha1 } from "../../server/vault";
import { BOARD, NOTE, QUIZ, TABLE, makeEnv, sweepTemps, write, type Env } from "./helpers";

let env: Env;
let clients: Client[] = [];
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  for (const c of clients) await c.close();
  clients = [];
  await env.cleanup();
  sweepTemps();
});

const KINDS = [
  { kind: "board", file: "plan.board.md", text: BOARD },
  { kind: "note", file: "plan.md", text: NOTE },
  { kind: "quiz", file: "plan.quiz.md", text: QUIZ },
  { kind: "table", file: "plan.table.md", text: TABLE },
] as const;

const OTHER = (text: string) => `${text}\nOTHER WRITER\n`;
const disk = (file: string) => fs.readFileSync(path.join(env.root, file), "utf8");

const app = () => createApp({ session: new Session(env.home, env.vault, "test"), token: "t", page: null });

async function post(route: string, body: unknown) {
  const res = await app().request(`http://127.0.0.1${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { base?: string; text?: string; error?: string } };
}

/** The issue's steps 1–2: the file as read, then another writer's edit landing under that read's base. */
async function movedUnderneath(file: string, kind: (typeof KINDS)[number]["kind"], text: string) {
  write(env.root, file, text);
  const read = (await env.vault.read("plan", kind))!;
  const after = await env.vault.write("plan", kind, OTHER(read.text), read.base);
  return { read, after };
}

describe("Vault.write", () => {
  it("refuses an empty base with the text that replaced it", async () => {
    const { after } = await movedUnderneath("plan.board.md", "board", BOARD);
    const thrown = await env.vault.write("plan", "board", "MINE\n", "").catch((e) => e);
    expect(thrown).toBeInstanceOf(Conflict);
    expect((thrown as Conflict).base).toBe(after.base);
    expect((thrown as Conflict).text).toBe(after.text);
    expect(disk("plan.board.md")).toBe(after.text);
  });

  it("still writes over whatever is there with no base, and with the current one", async () => {
    /* The control: a refusal from every write would pass the test above. */
    const { after } = await movedUnderneath("plan.board.md", "board", BOARD);
    await env.vault.write("plan", "board", "FORCED\n", null);
    expect(disk("plan.board.md")).toBe("FORCED\n");
    await env.vault.write("plan", "board", "AGAIN\n", undefined);
    expect(disk("plan.board.md")).toBe("AGAIN\n");
    await env.vault.write("plan", "board", "MINE\n", sha1("AGAIN\n"));
    expect(disk("plan.board.md")).toBe("MINE\n");
    expect(after.base).not.toBe(sha1("MINE\n"));
  });
});

describe("POST /__board/put", () => {
  for (const { kind, file, text } of KINDS) {
    it(`a ${kind}: an empty base is a 409 carrying the other writer's text, and the file keeps it`, async () => {
      const { after } = await movedUnderneath(file, kind, text);
      const res = await post(`/__board/put?name=plan&kind=${kind}`, { text: "MINE, EMPTY BASE\n", base: "" });
      expect(res.status).toBe(409);
      expect(res.body.base).toBe(after.base);
      expect(res.body.text).toBe(after.text);
      expect(disk(file)).toBe(after.text);
    });

    it(`a ${kind}: a base that is not a string is a 400, and the file keeps the other writer's text`, async () => {
      const { after } = await movedUnderneath(file, kind, text);
      for (const base of [{}, 0, false, []]) {
        const res = await post(`/__board/put?name=plan&kind=${kind}`, { text: "MINE, WRONG TYPE\n", base });
        expect(res.status, JSON.stringify(base)).toBe(400);
      }
      expect(disk(file)).toBe(after.text);
    });

    it(`a ${kind}: no base, or a null one, still writes over what is there; the current one writes`, async () => {
      const { after } = await movedUnderneath(file, kind, text);
      const forced = await post(`/__board/put?name=plan&kind=${kind}`, { text: "FORCED\n" });
      expect(forced.status).toBe(200);
      expect(disk(file)).toBe("FORCED\n");
      const nulled = await post(`/__board/put?name=plan&kind=${kind}`, { text: "NULLED\n", base: null });
      expect(nulled.status).toBe(200);
      const fresh = await post(`/__board/put?name=plan&kind=${kind}`, { text: "MINE\n", base: nulled.body.base });
      expect(fresh.status).toBe(200);
      expect(disk(file)).toBe("MINE\n");
      expect(after.base).not.toBe(fresh.body.base);
    });
  }
});

describe("the routes that edit part of a file", () => {
  const PARTS = [
    {
      route: "/__board/patch?name=plan",
      file: "plan.board.md",
      kind: "board",
      text: BOARD,
      body: { ops: [{ id: "one", attrs: { x: 8 } }] },
    },
    {
      route: "/__board/table",
      file: "plan.table.md",
      kind: "table",
      text: TABLE,
      body: { name: "plan", ops: [{ op: "cell", tab: "deals", row: "racme", column: "name", value: "Mine" }] },
    },
    {
      route: "/__board/quiz",
      file: "plan.quiz.md",
      kind: "quiz",
      text: QUIZ,
      body: { name: "plan", ops: [{ op: "remove", id: "q1" }] },
    },
  ] as const;

  for (const { route, file, kind, text, body } of PARTS) {
    const at = route.split("?")[0];
    it(`${at}: an empty base is a 409, and a base that is not a string a 400 — neither writes`, async () => {
      const { after } = await movedUnderneath(file, kind, text);
      const empty = await post(route, { ...body, base: "" });
      expect(empty.status).toBe(409);
      expect(empty.body.text).toBe(after.text);
      const wrong = await post(route, { ...body, base: {} });
      expect(wrong.status).toBe(400);
      expect(disk(file)).toBe(after.text);
    });

    it(`${at}: the current base writes`, async () => {
      const { after } = await movedUnderneath(file, kind, text);
      const res = await post(route, { ...body, base: after.base });
      expect(res.status).toBe(200);
      expect(disk(file)).not.toBe(after.text);
    });
  }
});

describe("the MCP tools", () => {
  async function connect(): Promise<Client> {
    const server = await buildMcp(inProcess(app(), "t"), { readOnly: false });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    clients.push(client);
    return client;
  }

  async function call(c: Client, name: string, args: Record<string, unknown>) {
    const res: any = await c.callTool({ name, arguments: args });
    return { error: res.isError ? (res.content[0].text as string) : undefined };
  }

  for (const { kind, file, text } of KINDS) {
    it(`${kind}_write with base "" is refused naming the base it lost to, and writes nothing`, async () => {
      const { after } = await movedUnderneath(file, kind, text);
      const c = await connect();
      const got = await call(c, `${kind}_write`, { name: "plan", text: "MINE, EMPTY BASE\n", base: "" });
      expect(got.error).toContain(after.base);
      expect(disk(file)).toBe(after.text);
    });
  }

  it('board_patch, table_edit and quiz_question_remove with base "" are refused too', async () => {
    const c = await connect();
    const board = await movedUnderneath("plan.board.md", "board", BOARD);
    expect((await call(c, "board_patch", { name: "plan", ops: [{ id: "one", attrs: { x: 8 } }], base: "" })).error).toContain(
      board.after.base,
    );
    expect(disk("plan.board.md")).toBe(board.after.text);

    write(env.root, "plan.table.md", TABLE);
    const table = await env.vault.write("plan", "table", OTHER(TABLE), null);
    const ops = [{ op: "cell", tab: "deals", row: "racme", column: "name", value: "Mine" }];
    expect((await call(c, "table_edit", { name: "plan", ops, base: "" })).error).toContain(table.base);
    expect(disk("plan.table.md")).toBe(table.text);

    write(env.root, "plan.quiz.md", QUIZ);
    const quiz = await env.vault.write("plan", "quiz", OTHER(QUIZ), null);
    expect((await call(c, "quiz_question_remove", { name: "plan", id: "q1", base: "" })).error).toContain(quiz.base);
    expect(disk("plan.quiz.md")).toBe(quiz.text);
  });
});
