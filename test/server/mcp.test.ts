/** The MCP server over its in-memory transport, on a real vault: every tool is a route call. */
import "./sqlite-shim";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { inProcess } from "../../server/mcp/backend";
import { buildMcp } from "../../server/mcp/server";
import { TOOLS } from "../../server/mcp/tools";
import { BOARD, makeEnv, sweepTemps, type Env } from "./helpers";

let env: Env;
let session: Session;
let clients: Client[] = [];
const temps: string[] = [];
/** A board with no `title:`, so it is filed under the name asked for (decision 14). */
const PLAIN = "```md {#one}\nhi\n```\n";

async function connect(readOnly = false, fetchImpl?: typeof fetch): Promise<Client> {
  const backend = inProcess(createApp({ session, token: "t", page: null, ...(fetchImpl ? { fetch: fetchImpl } : {}) }), "t");
  const server = await buildMcp(backend, { readOnly });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  clients.push(client);
  return client;
}

/** Call a tool; the data it returned, or the error text if it refused. */
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
  for (const t of temps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
  sweepTemps();
});

describe("tools/list", () => {
  it("lists exactly the tool table, and none of the hosted-only ones", async () => {
    const c = await connect();
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(TOOLS.map((t) => t.name).sort());
    expect(names).toEqual(
      expect.arrayContaining([
        "board_read",
        "note_create",
        "vault_list",
        "vault_open",
        "vault_create",
        "vault_close",
        "board_transfer",
        "table_edit",
        "file_upload",
        "feedback",
        "trash_list",
        "trash_restore",
        "trash_delete",
        "trash_empty",
      ]),
    );
    for (const gone of [
      "board_share",
      "board_shares",
      "share_read",
      "share_file",
      "share_image",
      "workspace_list",
      "workspace_create",
      "workspace_rename",
      "workspace_delete",
    ]) {
      expect(names).not.toContain(gone);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("marks write tools as not read-only", async () => {
    const c = await connect();
    const tools = (await c.listTools()).tools;
    expect(tools.find((t) => t.name === "board_read")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "board_write")?.annotations?.readOnlyHint).toBe(false);
  });
});

describe("documents", () => {
  it("makes, reads, writes, renames and deletes a board", async () => {
    const c = await connect();
    const made = (await call(c, "board_create", { name: "plan", text: PLAIN })).data;
    expect(made.name).toBe("plan");
    const read = (await call(c, "board_read", { name: "plan" })).data;
    expect(read.text).toContain("```md");
    expect(read.id).toBe(made.id);

    const wrote = (await call(c, "board_write", { name: "plan", text: read.text + "\nmore\n", base: read.base })).data;
    expect(wrote.base).not.toBe(read.base);
    const stale = await call(c, "board_write", { name: "plan", text: "x", base: read.base });
    expect(stale.error).toMatch(/changed underneath/);
    expect(stale.error).toContain(wrote.base);

    const moved = (await call(c, "board_rename", { name: "plan", to: "work/plan" })).data;
    expect(moved.name).toBe("work/plan");
    expect(moved.id).toBe(made.id);
    expect((await call(c, "board_list")).data.boards).toContain("work/plan");
    await call(c, "board_delete", { name: "work/plan" });
    expect((await call(c, "board_list")).data.boards).toEqual([]);
  });

  it("makes, reads, patches and deletes a note, and links to it by deep link", async () => {
    const c = await connect();
    const vaultId = env.vault.id;
    const made = (await call(c, "note_create", { title: "Meeting notes", text: "# Hi\n" })).data;
    expect(made.url).toBe(`anydag://open?vault=${vaultId}&note=${encodeURIComponent(made.name)}`);
    const read = (await call(c, "note_read", { name: made.name })).data;
    expect(read.text).toContain("# Hi");
    expect(read.url).toBe(made.url);
    await call(c, "note_write", { name: made.name, text: "# Changed\n", base: read.base });
    expect((await call(c, "note_read", { name: made.name })).data.text).toContain("# Changed");
    await call(c, "note_delete", { name: made.name });
    expect((await call(c, "note_list")).data.notes).toEqual([]);
  });

  it("percent-encodes a name with spaces and slashes in its deep link", async () => {
    const c = await connect();
    const made = (await call(c, "note_create", { name: "a folder/with space", text: "x\n" })).data;
    expect(made.url).toContain("note=a%20folder%2Fwith%20space");
  });

  it("turns a route's 404 into a tool error carrying its message", async () => {
    const c = await connect();
    const gone = await call(c, "board_read", { name: "nope" });
    expect(gone.error).toContain("no board `nope`");
  });

  it("task_create makes a task, task_set changes it, task_list finds it", async () => {
    const c = await connect();
    const t = (await call(c, "task_create", { title: "Ship it", due: "2026-12-01" })).data;
    await call(c, "task_set", { name: t.name, status: "done" });
    const list = (await call(c, "task_list", { status: "done" })).data.tasks;
    expect(list).toEqual([expect.objectContaining({ name: t.name, status: "done", due: "2026-12-01" })]);
  });
});

describe("templates", () => {
  it("template_list, template_starters and note_from_template go through the routes", async () => {
    const c = await connect();
    expect((await call(c, "template_list")).data).toEqual({ folder: null, configured: false, templates: [] });
    expect(fs.existsSync(path.join(env.root, "Templates"))).toBe(false);

    const starters = (await call(c, "template_starters")).data;
    expect(starters.created).toHaveLength(3);
    const list = (await call(c, "template_list")).data;
    expect(list.templates.map((t: any) => t.name)).toEqual(["Templates/ADR", "Templates/Daily", "Templates/Meeting"]);

    const made = (await call(c, "note_from_template", { template: "Templates/ADR", title: "Use SQLite" })).data;
    expect(made.name).toBe("Use SQLite");
    const text = (await call(c, "note_read", { name: made.name })).data.text as string;
    expect(text).toContain("# Use SQLite");
    expect(text).not.toContain("{{");

    expect((await call(c, "note_from_template", { template: "Notes/none" })).error).toContain("no template");
  });

  it("makes nothing when the server is read only", async () => {
    const c = await connect(true);
    expect((await call(c, "template_starters")).error).toBeDefined();
    expect((await call(c, "note_from_template", { template: "Templates/ADR" })).error).toBeDefined();
    expect(fs.existsSync(path.join(env.root, "Templates"))).toBe(false);
  });
});

describe("feedback", () => {
  it("says so when this app has nowhere to send it", async () => {
    session = new Session(env.home, env.vault, "test", {});
    const c = await connect();
    expect((await call(c, "feedback", { kind: "bug", text: "x" })).error).toContain("feedback not available");
  });

  it("sends through the route: the text, the boards named, a file, and answers the issue", async () => {
    const recorded = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", "feedback.json"), "utf8"));
    fs.writeFileSync(path.join(env.root, "plan.board.md"), PLAIN);
    session = new Session(env.home, env.vault, "test", { ANYDAG_FEEDBACK_URL: "https://relay.test" });
    let form: FormData | null = null;
    const relay = (async (_: RequestInfo | URL, init?: RequestInit) => {
      form = init?.body as FormData;
      return Response.json(recorded.post, { status: 201 });
    }) as typeof fetch;
    const c = await connect(false, relay);
    const got = await call(c, "feedback", {
      kind: "idea",
      text: "Let me pin a board",
      boards: ["plan"],
      files: [{ filename: "notes.txt", data: Buffer.from("hello").toString("base64") }],
    });
    expect(got.data).toEqual(recorded.post);
    const sent = form as unknown as FormData;
    expect(sent.get("kind")).toBe("idea");
    expect(JSON.parse(String(sent.get("boards")))).toEqual([{ name: "plan.board.md", text: PLAIN }]);
    const file = sent.get("files") as File;
    expect([file.name, file.type, await file.text()]).toEqual(["notes.txt", "text/plain", "hello"]);
    expect((await call(await connect(true, relay), "feedback", { kind: "bug", text: "x" })).error).toContain("--read-only");
  });
});

describe("--read-only", () => {
  it("allows a read and refuses a write, naming the flag", async () => {
    await env.vault.create("plan", "board", BOARD);
    const c = await connect(true);
    expect((await call(c, "board_read", { name: "plan" })).data.name).toBe("plan");
    const refused = await call(c, "board_create", { name: "x", text: BOARD });
    expect(refused.error).toContain("--read-only");
    expect(await env.vault.read("x", "board")).toBeNull();
  });

  it("every tool marked write is refused", async () => {
    const c = await connect(true);
    for (const t of TOOLS.filter((t) => t.write)) {
      const res: any = await c.callTool({ name: t.name, arguments: {} });
      // Either the flag, or (for an empty argument list) the schema, speaks first — never a write.
      expect(res.isError, t.name).toBe(true);
    }
    const res: any = await c.callTool({ name: "board_mkdir", arguments: { name: "nope" } });
    expect(res.content[0].text).toContain("--read-only");
    expect((await env.vault.tree()).folders).toEqual([]);
  });
});

describe("vaults", () => {
  it("lists, creates, opens and closes vaults without ever deleting a folder", async () => {
    const c = await connect();
    const listed = (await call(c, "vault_list")).data;
    expect(listed.vaults.map((v: any) => v.id)).toContain(env.vault.id);

    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-mcp-"));
    temps.push(parent);
    const made = (await call(c, "vault_create", { parent, name: "second" })).data.vault;
    expect(fs.existsSync(path.join(parent, "second", ".anydag", "vault.json"))).toBe(true);
    expect((await call(c, "vault_list")).data.vaults.filter((v: any) => v.open)).toHaveLength(2);

    await call(c, "vault_close", { id: made.id });
    expect(fs.existsSync(path.join(parent, "second"))).toBe(true);
    expect((await call(c, "vault_list")).data.vaults.find((v: any) => v.id === made.id).open).toBe(false);

    const reopened = (await call(c, "vault_open", { path: path.join(parent, "second") })).data.vault;
    expect(reopened.id).toBe(made.id);
    expect((await call(c, "vault_open", { path: path.join(parent, "nonexistent") })).error).toMatch(/not a folder/);
  });

  it("moves a document between vaults with board_transfer, keeping its id", async () => {
    const c = await connect();
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-mcp-"));
    temps.push(parent);
    const other = (await call(c, "vault_create", { parent, name: "other" })).data.vault;
    // vault_create made `other` the default; the first vault is addressed by id.
    const made = (await call(c, "note_create", { name: "plan", text: "hi\n", vault: env.vault.id })).data;
    const moved = (await call(c, "board_transfer", { name: made.name, kind: "note", to: other.id, vault: env.vault.id })).data;
    expect(moved.id).toBe(made.id);
    expect(moved.url).toBe(`anydag://open?vault=${other.id}&note=${encodeURIComponent(moved.name)}`);
    expect((await call(c, "note_list", { vault: env.vault.id })).data.notes).toEqual([]);
    expect((await call(c, "note_list", { vault: other.id })).data.notes).toEqual([moved.name]);
    expect((await call(c, "note_list", { vault: "nosuch" })).error).toContain("not open");
  });
});

describe("the rest of the table", () => {
  it("edits a table by id, reads a dsl sheet, and answers whoami", async () => {
    const c = await connect();
    await call(c, "table_create", { title: "Deals" });
    const t = (await call(c, "table_list")).data.tables[0];
    const added = (await call(c, "table_edit", { name: t, ops: [{ op: "addTab", name: "Q3" }] })).data;
    expect(added.changed).toBe(true);
    expect((await call(c, "table_get", { name: t })).data.tabs).toHaveLength(1);

    expect((await call(c, "dsl_reference")).data).toBeTruthy();
    const me = (await call(c, "whoami")).data;
    expect(me.vaults[0].id).toBe(env.vault.id);
    expect(me.read_only).toBe(false);
  });
});
