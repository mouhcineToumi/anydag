/**
 * The vault's trust boundary: a folder inside it that links out, a trash manifest that names paths
 * the app did not write, and a folder that claims another vault's id.
 *
 * Each of these is a file somebody else can put in a vault — a synced peer, a shared or cloned
 * folder, a downloaded vault — so none of it is the owner's word.
 */
import "./sqlite-shim";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { SyncLinks } from "../../server/sync/link";
import { Refused } from "../../server/vault";
import { BOARD, PDF, makeEnv, readText, sweepTemps, write, type Env } from "./helpers";

let env: Env;
const made: string[] = [];

function outside(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-outside-"));
  made.push(dir);
  return dir;
}

function copyOf(id: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-copy-"));
  made.push(dir);
  write(dir, ".anydag/vault.json", JSON.stringify({ id }));
  return dir;
}

beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("a folder that links out of the vault", () => {
  it("refuses a create, a file, a restore and a folder move through it", async () => {
    const out = outside();
    fs.symlinkSync(out, path.join(env.root, "bin"), "dir");

    await expect(env.vault.create("bin/note", "board", BOARD)).rejects.toBeInstanceOf(Refused);
    await expect(env.vault.putFile("bin/a.pdf", PDF, null)).rejects.toBeInstanceOf(Refused);
    expect(fs.readdirSync(out)).toEqual([]);

    /* A document deleted before the folder became a link: restore must not follow it now. */
    await env.vault.mkdir("work");
    await env.vault.create("work/plan", "board", BOARD);
    const gone = await env.vault.trash("work/plan", "board");
    fs.rmdirSync(path.join(env.root, "work"));
    fs.symlinkSync(out, path.join(env.root, "work"), "dir");
    await expect(env.vault.restore(gone.id)).rejects.toBeInstanceOf(Refused);
    expect(fs.readdirSync(out)).toEqual([]);

    await env.vault.mkdir("source");
    await expect(env.vault.moveFolder("source", "bin/moved")).rejects.toBeInstanceOf(Refused);
    expect(fs.existsSync(path.join(out, "moved"))).toBe(false);
    expect(fs.readdirSync(out)).toEqual([]);
  });
});

describe("a trash manifest the vault did not write", () => {
  const deleted = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  async function plant(
    id: string,
    entry: Record<string, unknown>,
    files: Record<string, string> = {},
  ): Promise<{ id: string; files: string }> {
    const filesRel = `.anydag/trash/${id}/files`;
    write(
      env.root,
      `.anydag/trash/${id}/entry.json`,
      JSON.stringify({ id, title: "planted", deleted: deleted(), doc: null, holds: null, ...entry }),
    );
    for (const [rel, text] of Object.entries(files)) write(env.root, `${filesRel}/${rel}`, text);
    return { id, files: path.join(env.root, ...filesRel.split("/")) };
  }

  const kept = (id: string, kind: string): Record<string, unknown> => ({
    id,
    kind,
    created: "2026-01-01T00:00:00Z",
    minted: 0,
    title: "planted",
  });

  async function restore(id: string): Promise<number> {
    const session = new Session(env.home, env.vault, "test");
    const app = createApp({ session, token: "t", page: null });
    const res = await app.request("/__board/trash/restore", {
      method: "POST",
      headers: { host: "127.0.0.1", "x-anydag-token": "t", "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return res.status;
  }

  it("refuses a docs key that climbs out of the entry, and moves nothing", async () => {
    const out = outside();
    const dummy = path.join(out, "id_dummy");
    fs.writeFileSync(dummy, "DUMMY-PRIVATE-KEY-CONTENT\n");
    const id = "0123456789";
    const files = path.join(env.root, ".anydag", "trash", id, "files");
    const key = path.relative(files, dummy).split(path.sep).join("/");
    await plant(
      id,
      {
        name: "attachments/Q3 plan.pdf",
        kind: "file",
        docs: { [key]: kept(id, "file") },
      },
      { "attachments/.keep": "" },
    );

    expect(await restore(id)).toBe(404);
    expect(fs.existsSync(dummy)).toBe(true);
    expect(fs.existsSync(path.join(env.root, "attachments", "Q3 plan.pdf"))).toBe(false);
    expect(fs.existsSync(path.join(env.root, ".anydag", "trash", id, "entry.json"))).toBe(true);
  });

  it("refuses an absolute docs key, and moves nothing", async () => {
    const out = outside();
    const absolute = path.join(out, "id_abs");
    const id = "abcdefghjk";
    /* The payload sits where the old join landed, so only the key's shape can refuse it. */
    await plant(
      id,
      {
        name: "attachments/absolute.pdf",
        kind: "file",
        docs: { [absolute]: kept(id, "file") },
      },
      { [absolute.split("/").filter(Boolean).join("/")]: "ABSOLUTE\n" },
    );

    expect(await restore(id)).toBe(404);
    expect(fs.existsSync(path.join(env.root, "attachments", "absolute.pdf"))).toBe(false);
    expect(fs.existsSync(path.join(env.root, ".anydag", "trash", id, "entry.json"))).toBe(true);
  });

  it("refuses a dot-folder name, and moves nothing", async () => {
    const id = "abcdefghjm";
    await plant(
      id,
      {
        name: ".git/hooks/pre-commit.pdf",
        kind: "file",
        docs: { ".git/hooks/pre-commit.pdf": kept(id, "file") },
      },
      { ".git/hooks/pre-commit.pdf": "#!/bin/sh\n" },
    );

    expect(await restore(id)).toBe(404);
    expect(fs.existsSync(path.join(env.root, ".git", "hooks", "pre-commit.pdf"))).toBe(false);
    expect(fs.existsSync(path.join(env.root, ".anydag", "trash", id, "entry.json"))).toBe(true);
  });
});

describe("a record or a manifest that breaks what lists it (#9)", () => {
  async function get(route: string): Promise<{ status: number; json: any }> {
    const session = new Session(env.home, env.vault, "test");
    const app = createApp({ session, token: "t", page: null });
    const res = await app.request(route, { headers: { host: "127.0.0.1", "x-anydag-token": "t" } });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  async function post(route: string, body: unknown): Promise<number> {
    const session = new Session(env.home, env.vault, "test");
    const app = createApp({ session, token: "t", page: null });
    const res = await app.request(route, {
      method: "POST",
      headers: { host: "127.0.0.1", "x-anydag-token": "t", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.status;
  }

  it("lists the vault past a files record whose path climbs out of it, and reads nothing there", async () => {
    await env.vault.putFile("attachments/report.pdf", PDF, null);
    expect((await get("/__board/list")).status).toBe(200);
    write(env.root, ".anydag/files/abcdefghjk.json", JSON.stringify({ path: "../../../x.pdf", title: "planted" }));
    write(env.root, ".anydag/files/abcdefghjm.json", JSON.stringify({ path: "/etc/x.pdf" }));
    write(env.root, ".anydag/files/abcdefghjn.json", "null");

    const list = await get("/__board/list");
    expect(list.status).toBe(200);
    expect(list.json.files).toEqual(["attachments/report.pdf"]);
    expect((await get("/__board/index")).status).toBe(200);
    // The records are not anybody's to delete on the vault's behalf.
    expect(fs.existsSync(path.join(env.root, ".anydag", "files", "abcdefghjk.json"))).toBe(true);
  });

  it("lists, restores and empties the trash past an entry.json holding null", async () => {
    await env.vault.create("plan", "board", BOARD);
    const gone = await env.vault.trash("plan", "board");
    write(env.root, ".anydag/trash/4ppjybn22v/entry.json", "null");
    write(env.root, ".anydag/trash/4ppjybn22w/entry.json", "[]");

    const listed = await get("/__board/trash");
    expect(listed.status).toBe(200);
    expect(listed.json.entries.map((e: { id: string }) => e.id)).toEqual([gone.id]);
    expect(await post("/__board/trash/restore", { id: gone.id })).toBe(200);
    expect(fs.existsSync(path.join(env.root, "plan.board.md"))).toBe(true);
    expect(await post("/__board/trash/empty", {})).toBe(200);
  });
});

describe("a folder that claims another vault's id", () => {
  it("gets a fresh id, and leaves the original's link and recent row alone", () => {
    const session = new Session(env.home, env.vault, "test");
    session.sync.auto = false;
    const id = env.vault.id;
    const link = path.join(env.homeDir, "sync", id);
    fs.mkdirSync(link, { recursive: true });
    fs.writeFileSync(
      path.join(link, "pair.json"),
      JSON.stringify({
        server: "https://sync.example",
        token: "device-token",
        account: { id: "account", name: "account" },
        device: { id: "device", name: "this one" },
        root: env.root,
      }),
    );
    fs.writeFileSync(path.join(link, "key"), "sealed-key\n");

    const copy = copyOf(id);
    write(copy, "foreign.md", "# Foreign\n");
    const opened = session.openFolder(copy);

    expect(opened.id).not.toBe(id);
    expect(JSON.parse(readText(copy, ".anydag/vault.json"))).toEqual({ id: opened.id });
    const recent = session.recent();
    expect(recent.find((r) => r.id === id)?.path).toBe(env.root);
    expect(recent.find((r) => r.id === opened.id)?.path).toBe(copy);
    expect(fs.existsSync(path.join(link, "pair.json"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(link, "pair.json"), "utf8")).root).toBe(env.root);
    expect(fs.existsSync(path.join(env.homeDir, "sync", opened.id))).toBe(false);
  });

  it("pauses a link made for another root instead of starting its loop", () => {
    const links = new SyncLinks(env.homeDir, {});
    links.auto = true;
    const id = env.vault.id;
    const dir = path.join(env.homeDir, "sync", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "pair.json"),
      JSON.stringify({
        server: "http://127.0.0.1:1",
        token: "device-token",
        account: { id: "account", name: "account" },
        device: { id: "device", name: "this one" },
        root: path.join(env.root, "another-folder"),
      }),
    );
    fs.writeFileSync(path.join(dir, "key"), "not a sealed key\n");

    links.opened(env.vault);
    const status = links.status(env.vault);
    expect(status).toMatchObject({ linked: true, state: "paused" });
    expect(status.reason).toMatch(/made for/);
    expect(links.get(id)).toBeUndefined();
  });
});
