/**
 * A rename through any route keeps the vault's `[[wikilinks]]` naming what they named
 * (`server/relink.ts`), unless the vault says not to — and a chat's rename records the rewrites with
 * it, so undoing the one undoes the other.
 */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { record, undo } from "../../server/chat/record";
import { Session } from "../../server/context";
import { makeEnv, readText, sweepTemps, write, type Env } from "./helpers";

let env: Env;
let app: ReturnType<typeof createApp>;

const post = async (route: string, body: unknown) => {
  const res = await app.request(`http://127.0.0.1${route}`, {
    method: "POST",
    headers: { "x-anydag-token": "t", host: "127.0.0.1", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

const LINKS = "See [[Plan]], [[Plan#Costs|the costs]] and ![[Plan]].\n\n`[[Plan]]` stays.\n";

beforeEach(async () => {
  env = makeEnv();
  app = createApp({ session: new Session(env.home, env.vault, "test"), token: "t", page: null });
  await env.vault.create("Projects/Plan", "note", "# Plan\n");
  write(env.root, "Meeting notes.md", LINKS);
  write(env.root, "Drill.quiz.md", "---\ntitle: Drill\n---\n\n## Where is [[Plan]]? {#q1}\n\n- [x] here\n- [ ] there\n");
  write(env.root, "Map.board.md", "---\ntitle: Map\n---\n\n```md {#a}\n[[Projects/Plan]]\n```\n");
  await env.vault.tree();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

const notes = () => readText(env.root, "Meeting notes.md");

describe("a rename keeps the links to it", () => {
  it("retitle with follow: every link in every kind of text, and the answer says how many", async () => {
    const got = await post("/__board/retitle", { name: "Projects/Plan", kind: "note", title: "Budget plan", follow: true });
    expect(got.status).toBe(200);
    expect(got.body.name).toBe("Projects/Budget plan");
    expect(notes()).toBe("See [[Budget plan]], [[Budget plan#Costs|the costs]] and ![[Budget plan]].\n\n`[[Plan]]` stays.\n");
    expect(readText(env.root, "Drill.quiz.md")).toContain("## Where is [[Budget plan]]? {#q1}");
    expect(readText(env.root, "Map.board.md")).toContain("```md {#a}\n[[Projects/Budget plan]]\n```");
    expect(got.body.relinked.links).toBe(5);
    expect(got.body.relinked.files.map((f: { name: string }) => f.name).sort()).toEqual(["Drill", "Map", "Meeting notes"]);
  });

  it("a move into another folder rewrites only what stopped resolving", async () => {
    const got = await post("/__board/rename", { name: "Projects/Plan", kind: "note", to: "Archive/Plan" });
    expect(got.body.name).toBe("Archive/Plan");
    // `[[Plan]]` still names it by its leaf; `[[Projects/Plan]]` does not.
    expect(notes()).toBe(LINKS);
    expect(readText(env.root, "Map.board.md")).toContain("[[Archive/Plan]]");
    expect(got.body.relinked.links).toBe(1);
  });

  it("a folder moved takes the links to everything under it", async () => {
    const got = await post("/__board/mvdir", { name: "Projects", to: "Done" });
    expect(got.status).toBe(200);
    expect(readText(env.root, "Map.board.md")).toContain("[[Done/Plan]]");
    expect(got.body.relinked.links).toBe(1);
  });

  it("an attachment renamed keeps its embeds", async () => {
    write(env.root, "attachments/q3.pdf", "%PDF-1.4\n");
    write(env.root, "Report.md", "![[q3.pdf]] and [[attachments/q3.pdf|the report]]\n");
    await env.vault.tree();
    await post("/__board/rename", { name: "attachments/q3.pdf", kind: "file", to: "attachments/q3 final" });
    expect(readText(env.root, "Report.md")).toBe("![[q3 final.pdf]] and [[attachments/q3 final.pdf|the report]]\n");
  });

  it("a copy rewrites nothing", async () => {
    const got = await post("/__board/duplicate", { name: "Projects/Plan", kind: "note", to: "Projects/Plan copy" });
    expect(got.status).toBe(200);
    expect(notes()).toBe(LINKS);
  });

  it("is off when the vault says so", async () => {
    write(env.root, ".anydag/settings.json", JSON.stringify({ "dag:update-links": "0" }));
    const got = await post("/__board/retitle", { name: "Projects/Plan", kind: "note", title: "Budget plan", follow: true });
    expect(got.body.relinked).toBeNull();
    expect(notes()).toBe(LINKS);
  });

  it("is recorded with the rename in a chat's op, so undoing it undoes both", async () => {
    const root = env.root;
    const { op } = await record({ id: "v", root }, "POST /__board/retitle", async () => {
      const got = await post("/__board/retitle", { name: "Projects/Plan", kind: "note", title: "Budget plan", follow: true });
      expect(got.status).toBe(200);
    });
    expect(op).not.toBeNull();
    const touched = op!.images.map((i) => i.rel);
    expect(touched).toEqual(expect.arrayContaining(["Meeting notes.md", "Drill.quiz.md", "Map.board.md"]));
    expect(notes()).not.toBe(LINKS);
    const done = await undo([op!], (v) => (v === "v" ? root : null));
    expect(done.conflicts).toEqual([]);
    expect(notes()).toBe(LINKS);
    expect(fs.existsSync(path.join(root, "Projects", "Plan.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "Projects", "Budget plan.md"))).toBe(false);
  });
});
