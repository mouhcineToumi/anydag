/**
 * The sync client's core (`server/sync/`), against an in-memory server (`sync-fake.ts`) and temp
 * folders (`sync-tmpfs.ts`): the conflict table as pure decisions, the state, the bases and the keys
 * at rest, and then two or three devices on one remote vault — each scenario run until every device
 * is quiet, then every vault compared byte for byte.
 */

import "./sqlite-shim";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Bases, sha1Of } from "../../server/sync/bases";
import { HttpSyncApi, SyncError } from "../../server/sync/client";
import { SyncEngine } from "../../server/sync/engine";
import { homeSecret, loadVaultKey, saveVaultKey, SecretElsewhere } from "../../server/sync/keys";
import { conflictName, freshCopy, isJson, isText, mergeContent } from "../../server/sync/merge";
import { syncs } from "../../server/sync/scope";
import { SyncState } from "../../server/sync/state";
import { frontId } from "../../server/ids";
import { randomKey } from "../../sync/protocol/crypto";
import { FakeServer } from "./sync-fake";
import { tmpFs, TYPES, type TmpFs } from "./sync-tmpfs";

const bytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "utf8"));
const text = (b: Uint8Array): string => Buffer.from(b).toString("utf8");

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-sync-state-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 2026-11-06 14:30, local: what a conflict copy is dated with. */
const AT = new Date(2026, 10, 6, 14, 30);

interface Device {
  name: string;
  fs: TmpFs;
  state: SyncState;
  engine: SyncEngine;
  sync(): Promise<void>;
}

function device(server: FakeServer, vk: Uint8Array, name: string, wrap?: (fs: TmpFs) => TmpFs): Device {
  const raw = tmpFs();
  const vfs = wrap ? wrap(raw) : raw;
  const dir = tmpDir();
  const state = new SyncState(dir);
  cleanups.push(() => {
    state.close();
    raw.dispose();
  });
  const engine = new SyncEngine({
    fs: vfs,
    api: server.as(`dev-${name}`),
    state,
    bases: new Bases(path.join(dir, "bases")),
    vk,
    remote: server.vault,
    device: { id: `dev-${name}`, name },
    types: TYPES,
    now: () => AT,
  });
  return {
    name,
    fs: raw,
    state,
    engine,
    async sync() {
      await engine.scan();
      await engine.syncOnce();
    },
  };
}

function world(n = 2): { server: FakeServer; devs: Device[] } {
  const server = new FakeServer();
  const vk = randomKey();
  const devs = ["A", "B", "C"].slice(0, n).map((name) => device(server, vk, name));
  return { server, devs };
}

/** Every device syncs, in order, until a whole round commits nothing. */
async function settle(server: FakeServer, devs: Device[]): Promise<void> {
  for (let round = 0; round < 6; round++) {
    const before = server.seq;
    for (const d of devs) await d.sync();
    if (server.seq === before) return;
  }
  throw new Error("the devices never settled");
}

async function same(devs: Device[]): Promise<Record<string, string>> {
  const first = await devs[0]!.fs.snapshot();
  for (const d of devs.slice(1)) expect(await d.fs.snapshot(), `device ${d.name}`).toEqual(first);
  for (const d of devs) expect(d.engine.pending(), `pending on ${d.name}`).toBe(0);
  return first;
}

const CHAT = "c000000000aaaa0001";
const TURN = "t000000000aaaa0001";
const UNDO = "u000000000aaaa0001";

const note = (id: string, lines: string[]): string => `---\nid: ${id}\ntitle: Plan\n---\n${lines.join("\n")}\n`;
const LINES = ["one", "two", "three", "four", "five", "six"];

// -- pure decisions ------------------------------------------------------------------------------

describe("merge.ts", () => {
  it("says what is text and what is JSON", () => {
    expect(isText("a/plan.md")).toBe(true);
    expect(isText("x.board.md")).toBe(true);
    expect(isText(".anydag/settings.json")).toBe(true);
    expect(isText(".anydag/files/7q2m9xk4tb.json")).toBe(true);
    expect(isText("pic.png")).toBe(false);
    expect(isJson(".anydag/settings.json")).toBe(true);
    expect(isJson(".anydag/files/7q2m9xk4tb.json")).toBe(true);
    expect(isJson(".anydag/components/x.board.md")).toBe(false);
    expect(isJson("notes/data.json")).toBe(false);
    expect(isJson(`.anydag/chats/${CHAT}/chat.json`)).toBe(true);
    expect(isJson(`.anydag/chats/${CHAT}/${TURN}.json`)).toBe(false);
  });

  it("syncs an Assistant chat's files and nothing else in its folder", () => {
    const at = (rel: string) => syncs(`.anydag/chats/${rel}`, TYPES);
    expect(at(`${CHAT}/chat.json`)).toBe(true);
    expect(at(`${CHAT}/${TURN}.json`)).toBe(true);
    expect(at(`${CHAT}/undo/${UNDO}.json`)).toBe(true);
    expect(at(`${CHAT}/notes.txt`)).toBe(false);
    expect(at(`${CHAT}/.${TURN}.json.123.tmp`)).toBe(false);
    expect(at(`${CHAT}/undo/${TURN}.json`)).toBe(false);
    expect(at(`not-a-chat/chat.json`)).toBe(false);
    expect(at(`${CHAT}/sub/chat.json`)).toBe(false);
  });

  it("merges different lines and refuses the same line", () => {
    const base = bytes(LINES.join("\n"));
    const ours = bytes(["ONE", ...LINES.slice(1)].join("\n"));
    const theirs = bytes([...LINES.slice(0, 5), "SIX"].join("\n"));
    const r = mergeContent("n.md", base, ours, theirs);
    expect("merged" in r && text(r.merged)).toBe(["ONE", ...LINES.slice(1, 5), "SIX"].join("\n"));
    expect(mergeContent("n.md", base, ours, bytes(["Uno", ...LINES.slice(1)].join("\n")))).toEqual({ conflict: true });
  });

  it("takes identical bytes, and never merges a binary", () => {
    const pic = new Uint8Array([1, 2, 3]);
    expect(mergeContent("p.png", null, pic, new Uint8Array([1, 2, 3]))).toEqual({ merged: pic });
    expect(mergeContent("p.png", new Uint8Array([0]), pic, new Uint8Array([4]))).toEqual({ conflict: true });
  });

  it("merges settings by key, favourites as a set, and refuses JSON that does not parse", () => {
    const base = bytes(JSON.stringify({ "dag:favourites": ["a"], theme: "x" }));
    const ours = bytes(JSON.stringify({ "dag:favourites": ["a", "b"], theme: "x" }));
    const theirs = bytes(JSON.stringify({ "dag:favourites": ["a", "c"], theme: "y" }));
    const r = mergeContent(".anydag/settings.json", base, ours, theirs);
    expect("merged" in r).toBe(true);
    const out = JSON.parse(text((r as { merged: Uint8Array }).merged)) as Record<string, unknown>;
    expect(new Set(out["dag:favourites"] as string[])).toEqual(new Set(["a", "b", "c"]));
    expect(out.theme).toBe("y");
    expect(mergeContent(".anydag/settings.json", base, bytes("{nope"), theirs)).toEqual({ conflict: true });
  });

  it("calls a merged board that breaks the grammar a conflict", () => {
    const fence = (id: string, body: string) => "```md {#" + id + "}\n" + body + "\n```\n";
    const base = fence("intro", "Hello") + "\n" + fence("outro", "Bye");
    const ours = fence("x", "mine") + "\n" + base;
    const theirs = base + "\n" + fence("x", "theirs");
    // Each side alone parses; the line merge holds two items called `x`.
    const r = mergeContent("plan.board.md", bytes(base), bytes(ours), bytes(theirs));
    expect(r).toEqual({ conflict: true });
    // The same shape with two different ids merges.
    const ok = mergeContent("plan.board.md", bytes(base), bytes(ours), bytes(base + "\n" + fence("y", "theirs")));
    expect("merged" in ok).toBe(true);
  });

  it("names a conflict copy after the device and the minute, numbered when taken", () => {
    const taken = new Set<string>();
    expect(conflictName("work/Plan.md", "Mou's laptop", AT, (r) => taken.has(r))).toBe(
      "work/Plan (conflict Mou's laptop 2026-11-06 14.30).md",
    );
    expect(conflictName("b.board.md", "A/B:C", AT, () => false)).toBe("b (conflict ABC 2026-11-06 14.30).board.md");
    expect(conflictName("pic.png", "A", AT, () => false)).toBe("pic (conflict A 2026-11-06 14.30).png");
    taken.add("x (conflict A 2026-11-06 14.30).quiz.md");
    expect(conflictName("x.quiz.md", "A", AT, (r) => taken.has(r))).toBe("x (conflict A 2026-11-06 14.30) 2.quiz.md");
    expect(conflictName("n.md", "A", AT, () => false)).not.toContain(".sync-conflict-");
  });

  it("gives a conflict copy a fresh id", () => {
    const original = bytes(note("7q2m9xk4tb", ["hello"]));
    const copy = freshCopy("Plan (conflict A 2026-11-06 14.30).md", original);
    const id = frontId(text(copy));
    expect(typeof id).toBe("string");
    expect(id).not.toBe("7q2m9xk4tb");
    expect(text(copy).replace(/^id: .*$/m, "")).toBe(text(original).replace(/^id: .*$/m, ""));
    expect(freshCopy("pic.png", new Uint8Array([1]))).toEqual(new Uint8Array([1]));
  });
});

describe("state, bases and keys", () => {
  it("keeps entries, the cursor and conflicts, and finds a path whatever its case", () => {
    const s = new SyncState(tmpDir());
    cleanups.push(() => s.close());
    s.put({ key: "k1", rel: "Work/Plan.md", kind: "file", seq: 3, blob: "b", sha1: "s", size: 4, mtime: 0 });
    expect(s.entry("k1")?.seq).toBe(3);
    expect(s.entryAt("work/plan.md")?.key).toBe("k1");
    s.setCursor(42);
    expect(s.cursor()).toBe(42);
    s.addConflict("x.md", "now");
    expect(s.conflicts()).toEqual([{ rel: "x.md", at: "now" }]);
    s.drop("k1");
    expect(s.entries()).toEqual([]);
  });

  it("keeps bases by sha1 and trims what is not kept", () => {
    const b = new Bases(tmpDir());
    const one = b.put(bytes("one"));
    const two = b.put(bytes("two"));
    expect(text(b.get(one)!)).toBe("one");
    b.trim(new Set([two]));
    expect(b.get(one)).toBeNull();
    expect(b.get(two)).not.toBeNull();
    expect(two).toBe(sha1Of(bytes("two")));
  });

  it("seals the vault key under the home secret", () => {
    const home = tmpDir();
    const secret = homeSecret(home, {});
    expect(homeSecret(home, {})).toEqual(secret);
    expect(fs.statSync(path.join(home, "home.secret")).mode & 0o777).toBe(0o600);
    const given = randomKey();
    expect(homeSecret(home, { ANYDAG_HOME_SECRET: Buffer.from(given).toString("base64url") })).toEqual(given);
    const dir = tmpDir();
    expect(loadVaultKey(dir, secret)).toBeNull();
    const vk = randomKey();
    saveVaultKey(dir, secret, vk);
    expect(loadVaultKey(dir, secret)).toEqual(vk);
    expect(() => loadVaultKey(dir, randomKey())).toThrow();
  });

  it("makes no second secret once the desktop app keeps one, and reads one it adopted", () => {
    const home = tmpDir();
    fs.writeFileSync(
      path.join(home, "keys.json"),
      JSON.stringify({ keys: { ANYDAG_HOME_SECRET: { scheme: "safeStorage", value: "AAAA" } } }),
    );
    expect(() => homeSecret(home, {})).toThrow(SecretElsewhere);
    expect(fs.existsSync(path.join(home, "home.secret"))).toBe(false);
    // Handed over by the app, it is that one.
    const given = randomKey();
    expect(homeSecret(home, { ANYDAG_HOME_SECRET: Buffer.from(given).toString("base64url") })).toEqual(given);
    // A home.secret the CLI made before the app ran (and the app adopted) is still read.
    fs.writeFileSync(path.join(home, "home.secret"), Buffer.from(given).toString("base64url") + "\n");
    expect(homeSecret(home, {})).toEqual(given);
    // Another key in keys.json is not the secret.
    const other = tmpDir();
    fs.writeFileSync(
      path.join(other, "keys.json"),
      JSON.stringify({ keys: { GEMINI_API_KEY: { scheme: "base64", value: "eA" } } }),
    );
    expect(homeSecret(other, {})).toHaveLength(32);
  });
});

describe("HttpSyncApi", () => {
  it("speaks the wire's paths and turns an answer into a code", async () => {
    const seen: string[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      seen.push(
        `${init?.method} ${u.replace("https://s.example", "")} ${(init?.headers as Record<string, string> | undefined)?.authorization ?? ""}`,
      );
      if (u.endsWith("/commit"))
        return new Response(JSON.stringify({ code: "ES_STALE", message: "stale", conflicts: [] }), { status: 409 });
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      if (u.includes("/changes")) return new Response(JSON.stringify({ changes: [], next: 7, more: false, head: 7, horizon: 1 }));
      if (u.includes("/key")) return new Response(JSON.stringify({ code: "ES_NOT_FOUND", message: "no key" }), { status: 404 });
      throw new TypeError("connection refused");
    }) as typeof fetch;
    const api = new HttpSyncApi({ url: "https://s.example/", token: "tok", fetch: fetcher, retries: 1, backoff: 1 });
    expect((await api.changes("v1", 7)).next).toBe(7);
    expect(await api.hasBlob("v1", "b".repeat(43))).toBeNull();
    expect(await api.getKey("v1")).toBeNull();
    const stale = await api.commit("v1", []).catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(SyncError);
    expect((stale as SyncError).code).toBe("ES_STALE");
    expect((stale as SyncError).status).toBe(409);
    const down = await api.health().catch((e: unknown) => e);
    expect((down as SyncError).code).toBe("ES_NETWORK");
    expect(seen).toContain("GET /v1/vaults/v1/changes?since=7&limit=1000 Bearer tok");
    expect(seen).toContain(`HEAD /v1/vaults/v1/blobs/${"b".repeat(43)} Bearer tok`);
    expect(seen.filter((l) => l.startsWith("GET /v1/health"))).toHaveLength(2);
  });
});

// -- devices ------------------------------------------------------------------------------------

describe("the engine", () => {
  it("propagates a create", async () => {
    const { server, devs } = world(3);
    const [a] = devs;
    a!.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    a!.fs.write("pic.png", new Uint8Array([9, 9, 9]));
    a!.fs.write(".anydag/settings.json", "{}\n");
    a!.fs.write("ignored.xyz", "not listed");
    await settle(server, devs);
    const snap = await same(devs);
    expect(Object.keys(snap).sort()).toEqual([".anydag/settings.json", "Plan.md", "pic.png"]);
  });

  it("propagates an edit, and a second sync commits nothing (no echo)", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    a.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    await settle(server, devs);
    b.fs.write("Plan.md", note("7q2m9xk4tb", ["ONE", ...LINES.slice(1)]));
    await settle(server, devs);
    await same(devs);
    expect(a.fs.readText("Plan.md")).toContain("ONE");
    const calls = server.commitCalls;
    for (const d of devs) await d.sync();
    expect(server.commitCalls).toBe(calls);
  });

  it("does not apply the device's own commits again", async () => {
    const { server, devs } = world(1);
    const [a] = devs as [Device];
    a.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    await a.sync();
    let writes = 0;
    const real = a.fs.writeIf;
    a.fs.writeIf = async (...args) => {
      writes++;
      return real(...args);
    };
    a.state.setCursor(0);
    await a.engine.pull();
    expect(writes).toBe(0);
    expect(server.seq).toBe(1);
  });

  it("propagates a delete", async () => {
    const { server, devs } = world(3);
    devs[0]!.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    devs[0]!.fs.write("Other.md", "keep\n");
    await settle(server, devs);
    devs[1]!.fs.remove("Plan.md");
    await settle(server, devs);
    const snap = await same(devs);
    expect(Object.keys(snap)).toEqual(["Other.md"]);
  });

  it("propagates a rename", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    a.fs.write("work/Plan.md", note("7q2m9xk4tb", LINES));
    await settle(server, devs);
    fs.renameSync(path.join(b.fs.root, "work/Plan.md"), path.join(b.fs.root, "work/Roadmap.md"));
    await settle(server, devs);
    const snap = await same(devs);
    expect(Object.keys(snap)).toEqual(["work/Roadmap.md"]);
  });

  it("carries an edit made here across a rename made there", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    a.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    await settle(server, devs);
    fs.renameSync(path.join(a.fs.root, "Plan.md"), path.join(a.fs.root, "Roadmap.md"));
    await a.sync();
    b.fs.write("Plan.md", note("7q2m9xk4tb", [...LINES.slice(0, 5), "edited on B"]));
    await settle(server, devs);
    const snap = await same(devs);
    expect(Object.keys(snap)).toEqual(["Roadmap.md"]);
    expect(a.fs.readText("Roadmap.md")).toContain("edited on B");
  });

  it("merges concurrent edits on different lines", async () => {
    const { server, devs } = world(3);
    const [a, b, c] = devs as [Device, Device, Device];
    a.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    await settle(server, devs);
    a.fs.write("Plan.md", note("7q2m9xk4tb", ["ONE", ...LINES.slice(1)]));
    b.fs.write("Plan.md", note("7q2m9xk4tb", [...LINES.slice(0, 5), "SIX"]));
    c.fs.write("Plan.md", note("7q2m9xk4tb", [...LINES.slice(0, 2), "THREE", ...LINES.slice(3)]));
    await settle(server, devs);
    await same(devs);
    const out = a.fs.readText("Plan.md")!;
    for (const w of ["ONE", "THREE", "SIX"]) expect(out).toContain(w);
    expect(server.reports.reduce((n, r) => n + r.merged, 0)).toBeGreaterThan(0);
  });

  it("writes a conflict copy for edits to the same line, with a fresh id", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    a.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    await settle(server, devs);
    a.fs.write("Plan.md", note("7q2m9xk4tb", ["from A", ...LINES.slice(1)]));
    b.fs.write("Plan.md", note("7q2m9xk4tb", ["from B", ...LINES.slice(1)]));
    await settle(server, devs);
    const snap = await same(devs);
    const copy = "Plan (conflict B 2026-11-06 14.30).md";
    expect(Object.keys(snap).sort()).toEqual([copy, "Plan.md"]);
    expect(a.fs.readText("Plan.md")).toContain("from B");
    expect(a.fs.readText(copy)).toContain("from A");
    expect(frontId(a.fs.readText("Plan.md")!)).toBe("7q2m9xk4tb");
    const copyId = frontId(a.fs.readText(copy)!);
    expect(typeof copyId).toBe("string");
    expect(copyId).not.toBe("7q2m9xk4tb");
    expect(b.engine.conflicts()).toEqual([copy]);
    expect(server.reports.reduce((n, r) => n + r.copied, 0)).toBe(1);
  });

  it("lets an edit win against a delete", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    a.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    await settle(server, devs);
    a.fs.remove("Plan.md");
    await a.sync();
    b.fs.write("Plan.md", note("7q2m9xk4tb", ["kept", ...LINES.slice(1)]));
    await settle(server, devs);
    await same(devs);
    expect(a.fs.readText("Plan.md")).toContain("kept");
  });

  it("lets an edit win against a delete, the other way round", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    a.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    await settle(server, devs);
    b.fs.write("Plan.md", note("7q2m9xk4tb", ["kept", ...LINES.slice(1)]));
    await b.sync();
    a.fs.remove("Plan.md");
    await settle(server, devs);
    await same(devs);
    expect(a.fs.readText("Plan.md")).toContain("kept");
  });

  it("keeps both versions of a binary edited on both sides", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    a.fs.write("pic.png", new Uint8Array([1]));
    await settle(server, devs);
    a.fs.write("pic.png", new Uint8Array([2]));
    b.fs.write("pic.png", new Uint8Array([3]));
    await settle(server, devs);
    const snap = await same(devs);
    expect(Object.keys(snap).sort()).toEqual(["pic (conflict B 2026-11-06 14.30).png", "pic.png"]);
    const kept = new Set(Object.values(snap));
    expect(kept).toEqual(new Set([Buffer.from([2]).toString("base64"), Buffer.from([3]).toString("base64")]));
  });

  it("merges favourites added on both sides", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    a.fs.write(".anydag/settings.json", JSON.stringify({ "dag:favourites": ["x"] }, null, 1) + "\n");
    await settle(server, devs);
    a.fs.write(".anydag/settings.json", JSON.stringify({ "dag:favourites": ["x", "from-a"] }, null, 1) + "\n");
    b.fs.write(".anydag/settings.json", JSON.stringify({ "dag:favourites": ["x", "from-b"] }, null, 1) + "\n");
    await settle(server, devs);
    await same(devs);
    const out = JSON.parse(a.fs.readText(".anydag/settings.json")!) as { "dag:favourites": string[] };
    expect(new Set(out["dag:favourites"])).toEqual(new Set(["x", "from-a", "from-b"]));
  });

  it("loses nothing to an outside write between the read and the write", async () => {
    const server = new FakeServer();
    const vk = randomKey();
    const a = device(server, vk, "A");
    let armed = false;
    const b = device(server, vk, "B", (raw) => ({
      ...raw,
      writeIf: async (rel, data, expect) => {
        if (armed && rel === "Plan.md") {
          armed = false;
          raw.write("Plan.md", note("7q2m9xk4tb", [...LINES.slice(0, 5), "outside"]));
        }
        return raw.writeIf(rel, data, expect);
      },
    }));
    const devs = [a, b];
    a.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    await settle(server, devs);
    a.fs.write("Plan.md", note("7q2m9xk4tb", ["from A", ...LINES.slice(1)]));
    await a.sync();
    armed = true;
    await b.sync();
    expect(armed).toBe(false);
    await settle(server, devs);
    await same(devs);
    const out = a.fs.readText("Plan.md")!;
    expect(out).toContain("from A");
    expect(out).toContain("outside");
  });

  it("pulls, merges and pushes again when a commit is stale", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    a.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    await settle(server, devs);
    a.fs.write("Plan.md", note("7q2m9xk4tb", ["from A", ...LINES.slice(1)]));
    await a.sync();
    b.fs.write("Plan.md", note("7q2m9xk4tb", [...LINES.slice(0, 5), "from B"]));
    await b.engine.scan();
    const refusedBefore = server.commitCalls - server.committed();
    await b.engine.push();
    expect(server.commitCalls - server.committed()).toBe(refusedBefore + 1);
    expect(b.engine.pending()).toBe(0);
    await settle(server, devs);
    await same(devs);
    const out = a.fs.readText("Plan.md")!;
    expect(out).toContain("from A");
    expect(out).toContain("from B");
  });

  it("resyncs from the heads when the cursor is past the horizon", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    a.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    a.fs.write("Gone.md", "soon gone\n");
    await settle(server, devs);
    a.fs.write("New.md", "new\n");
    a.fs.remove("Gone.md");
    a.fs.write("Plan.md", note("7q2m9xk4tb", ["ONE", ...LINES.slice(1)]));
    await a.sync();
    server.compact();
    await settle(server, devs);
    const snap = await same(devs);
    expect(Object.keys(snap).sort()).toEqual(["New.md", "Plan.md"]);
    expect(b.state.cursor()).toBe(server.seq);
  });

  it("downloads everything to a fresh device, by the log and by the heads", async () => {
    const server = new FakeServer();
    const vk = randomKey();
    const a = device(server, vk, "A");
    a.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    a.fs.write("work/pic.png", new Uint8Array([5, 6]));
    a.fs.write(".anydag/files/7q2m9xk4tc.json", '{"path":"work/pic.png"}\n');
    await a.sync();
    const b = device(server, vk, "B");
    await b.sync();
    const c = device(server, vk, "C");
    await c.engine.resync();
    await same([a, b, c]);
    expect(c.state.cursor()).toBe(server.seq);
  });

  it("carries a document's created instant", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    a.fs.write("Plan.md", note("7q2m9xk4tb", LINES), "2025-05-05T05:05:05.000Z");
    await settle(server, devs);
    expect(b.fs.createdOf("Plan.md")).toBe("2025-05-05T05:05:05.000Z");
  });

  it("carries a chat between machines: both turns land, and a rename and a grant both survive", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    const meta = {
      v: 1,
      id: CHAT,
      title: "Plan",
      created: "2026-11-06T00:00:00.000Z",
      home: "v",
      provider: "claude",
      model: "sonnet",
      mode: "ask",
    };
    const put = (d: Device, m: object) => d.fs.write(`.anydag/chats/${CHAT}/chat.json`, `${JSON.stringify(m, null, 1)}\n`);
    put(a, meta);
    await settle(server, devs);
    put(a, { ...meta, title: "Renamed on A" });
    put(b, { ...meta, "grant:w": { mode: "ask", at: "2026-11-06T01:00:00.000Z" } });
    a.fs.write(`.anydag/chats/${CHAT}/t000000001aaaa0001.json`, '{"from":"a"}\n');
    b.fs.write(`.anydag/chats/${CHAT}/t000000002bbbb0001.json`, '{"from":"b"}\n');
    await settle(server, devs);
    const snap = await same(devs);
    expect(
      Object.keys(snap)
        .filter((k) => k.endsWith(".json"))
        .sort(),
    ).toEqual([
      `.anydag/chats/${CHAT}/chat.json`,
      `.anydag/chats/${CHAT}/t000000001aaaa0001.json`,
      `.anydag/chats/${CHAT}/t000000002bbbb0001.json`,
    ]);
    const merged = JSON.parse(a.fs.readText(`.anydag/chats/${CHAT}/chat.json`)!) as Record<string, unknown>;
    expect(merged.title).toBe("Renamed on A");
    expect(merged["grant:w"]).toEqual({ mode: "ask", at: "2026-11-06T01:00:00.000Z" });
  });

  it("syncs an empty folder, and its deletion", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    a.fs.mkdirp("Empty/Inner");
    a.fs.write("Full/x.md", "x\n");
    await settle(server, devs);
    let snap = await same(devs);
    expect(snap).toEqual({ "Empty/Inner": "<dir>", "Full/x.md": expect.any(String) });
    expect(fs.statSync(path.join(b.fs.root, "Empty/Inner")).isDirectory()).toBe(true);
    a.fs.rmdir("Empty/Inner");
    await settle(server, devs);
    snap = await same(devs);
    expect(snap["Empty/Inner"]).toBeUndefined();
    expect(snap.Empty).toBe("<dir>");
    expect(fs.existsSync(path.join(b.fs.root, "Empty/Inner"))).toBe(false);
  });

  it("writes a conflict copy for a board whose line merge breaks the grammar", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    const fence = (id: string, body: string) => "```md {#" + id + "}\n" + body + "\n```\n";
    const base = fence("intro", "Hello") + "\n" + fence("outro", "Bye");
    a.fs.write("plan.board.md", base);
    await settle(server, devs);
    a.fs.write("plan.board.md", fence("x", "mine") + "\n" + base);
    b.fs.write("plan.board.md", base + "\n" + fence("x", "theirs"));
    await settle(server, devs);
    const snap = await same(devs);
    expect(Object.keys(snap).sort()).toEqual(["plan (conflict B 2026-11-06 14.30).board.md", "plan.board.md"]);
  });

  it("follows the watcher's paths without a scan", async () => {
    const { server, devs } = world(2);
    const [a, b] = devs as [Device, Device];
    a.fs.write("Plan.md", note("7q2m9xk4tb", LINES));
    a.engine.touch(["Plan.md", ".obsidian/workspace.json"]);
    await a.engine.syncOnce();
    expect(a.engine.pending()).toBe(0);
    await b.engine.syncOnce();
    expect(b.fs.readText("Plan.md")).toBe(a.fs.readText("Plan.md"));
    // The watcher reports sync's own write; it finds the base and pushes nothing.
    const calls = server.commitCalls;
    b.engine.touch(["Plan.md"]);
    await b.engine.syncOnce();
    expect(server.commitCalls).toBe(calls);
  });
});
