/** The trash on the local server: what a delete moves aside, and what a restore puts back. */
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
import { trashDays } from "../../server/trash";
import { makeEnv, readText, sweepTemps, write, type Env } from "./helpers";

let env: Env;
let session: Session;
let clients: Client[] = [];
const PLAIN = "```md {#one}\nhi\n```\n";

async function connect(): Promise<Client> {
  const backend = inProcess(createApp({ session, token: "t", page: null }), "t");
  const server = await buildMcp(backend, { readOnly: false });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  clients.push(client);
  return client;
}

async function call(c: Client, name: string, args: Record<string, unknown> = {}): Promise<{ data?: any; error?: string }> {
  const res: any = await c.callTool({ name, arguments: args });
  const text = res.content[0].text as string;
  if (res.isError) return { error: text };
  return { data: JSON.parse(text) };
}

beforeEach(() => {
  env = makeEnv();
  session = new Session(env.home, env.vault, "test");
});
afterEach(async () => {
  for (const c of clients) await c.close();
  clients = [];
  await env.cleanup();
  sweepTemps();
});

describe("the trash", () => {
  it("takes a board out of every listing and puts it back with its id", async () => {
    const c = await connect();
    const made = (await call(c, "board_create", { name: "plan", text: PLAIN })).data;
    const gone = (await call(c, "board_delete", { name: "plan" })).data;
    expect(gone.trash).toMatchObject({ name: "plan", kind: "board", doc: made.id });
    expect((await call(c, "board_list")).data.boards).toEqual([]);
    expect(fs.existsSync(path.join(env.root, "plan.board.md"))).toBe(false);
    expect((await call(c, "resolve", { id: made.id })).error).toBeTruthy();

    const held = (await call(c, "trash_list")).data;
    expect(held.days).toBe(30);
    expect(held.entries.map((e: any) => e.name)).toEqual(["plan"]);

    const back = (await call(c, "trash_restore", { id: gone.trash.id })).data;
    expect(back.name).toBe("plan");
    expect((await call(c, "board_read", { name: "plan" })).data.id).toBe(made.id);
    expect((await call(c, "resolve", { id: made.id })).data.name).toBe("plan");
    expect((await call(c, "trash_list")).data.entries).toEqual([]);
  });

  it("numbers a name taken since, and gives a fresh id when its own was taken", async () => {
    const c = await connect();
    const first = (await call(c, "board_create", { name: "plan", text: PLAIN })).data;
    const gone = (await call(c, "board_delete", { name: "plan" })).data;
    /* A second file claiming the trashed one's id, as a copy made on disk would. */
    write(env.root, "plan.board.md", `---\nid: ${first.id}\n---\n\n${PLAIN}`);
    expect((await call(c, "board_list")).data.boards).toEqual(["plan"]);
    const back = (await call(c, "trash_restore", { id: gone.trash.id })).data;
    expect(back.name).toBe("plan 2");
    const restored = (await call(c, "board_read", { name: "plan 2" })).data;
    expect(restored.id).not.toBe(first.id);
    expect(readText(env.root, "plan 2.board.md")).toContain(`id: ${restored.id}`);
  });

  it("takes a folder whole and brings it back whole", async () => {
    const c = await connect();
    await call(c, "board_create", { name: "work/a", text: PLAIN });
    await call(c, "note_create", { name: "work/deep/b", text: "# B\n" });
    expect((await call(c, "board_rmdir", { name: "work", recursive: true })).error).toMatch(/confirm/);
    const gone = (await call(c, "board_rmdir", { name: "work", recursive: true, confirm: "work" })).data;
    expect(gone.trash).toMatchObject({ name: "work", kind: "folder" });
    expect(gone.trash.holds.boards).toEqual(["work/a"]);
    expect(fs.existsSync(path.join(env.root, "work"))).toBe(false);

    await call(c, "trash_restore", { id: gone.trash.id });
    expect((await call(c, "board_list")).data.boards).toEqual(["work/a"]);
    expect((await call(c, "note_list")).data.notes).toEqual(["work/deep/b"]);
  });

  it("deletes for good only with the person's answer", async () => {
    const c = await connect();
    await call(c, "board_create", { name: "plan", text: PLAIN });
    await call(c, "board_create", { name: "other", text: PLAIN });
    const a = (await call(c, "board_delete", { name: "plan" })).data.trash;
    await call(c, "board_delete", { name: "other" });

    expect((await call(c, "trash_delete", { id: a.id, confirm: "nope" })).error).toMatch(/cannot be undone/);
    expect((await call(c, "trash_delete", { id: a.id, confirm: "plan" })).data).toEqual({ id: a.id });
    expect((await call(c, "trash_list")).data.entries.map((e: any) => e.name)).toEqual(["other"]);

    expect((await call(c, "trash_empty", { confirm: "yes" })).error).toMatch(/empty the trash/);
    expect((await call(c, "trash_empty", { confirm: "empty the trash" })).data.ids).toHaveLength(1);
    expect((await call(c, "trash_list")).data.entries).toEqual([]);
    expect(fs.readdirSync(path.join(env.root, ".anydag", "trash"))).toEqual([]);
  });

  it("reads the days off the environment, and anything but a whole number above zero as thirty", () => {
    expect(trashDays("7")).toBe(7);
    for (const bad of ["0", "-3", "1.5", "lots", "", undefined]) expect(trashDays(bad)).toBe(30);
  });
});
