/**
 * The listing off the server's thread (#283): the worker answers what the inline listing does, a
 * listing hands the thread back while it reconciles, and a move made while one runs is not lost.
 */
import "./sqlite-shim";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate as yieldNow } from "node:timers/promises";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useListWorker } from "../../server/listing";
import { BOARD, NOTE, PDF, QUIZ, TABLE, makeEnv, sweepTemps, write, type Env } from "./helpers";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

/** One of everything the listing reads: every kind, frontmatter of every sort, folders, a link out. */
function fill(root: string, elsewhere: string): void {
  write(root, "plan.board.md", BOARD);
  write(root, "work/Onboarding.md", NOTE);
  write(root, "work/twice.md", "---\ntitle: The md one\n---\n");
  write(root, "work/twice.note.md", "---\ntitle: The note.md one\n---\n");
  write(root, "work/deep/task.md", "---\ntitle: Ship\nstatus: todo\ndue: 2026-01-02\n---\n# Ship\n");
  write(root, "work/deep/project.md", "---\nproject: active\nhue: coral\n---\n# P\n");
  write(root, "work/deep/event.md", "---\nstart: 2026-10-12\nend: 2026-10-14\n---\n# E\n");
  write(root, "drill.quiz.md", QUIZ);
  write(root, "deals.table.md", TABLE);
  write(root, "attachments/spec.pdf", PDF);
  write(root, "untitled.md", "no frontmatter at all\n");
  write(root, ".hidden/ignored.md", NOTE);
  fs.mkdirSync(path.join(root, "empty"));
  const outside = path.join(elsewhere, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.md"), "---\ntitle: Secret\n---\n");
  fs.symlinkSync(path.join(outside, "secret.md"), path.join(root, "link.md"));
  fs.symlinkSync(outside, path.join(root, "linked-folder"));
}

describe("the listing's worker", () => {
  let dir: string;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-list-worker-"));
    const { build } = await import("esbuild");
    await build({
      entryPoints: { "list-worker": path.resolve(__dirname, "../../server/list-worker.ts") },
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outdir: dir,
      outExtension: { ".js": ".mjs" },
      // `server/build.mjs`'s banner: a bundled CommonJS dependency's `require` needs one.
      banner: { js: "import{createRequire as __acr}from'node:module';const require=__acr(import.meta.url);" },
      logLevel: "warning",
    });
  });
  /* A worker that fails lists inline and says so: here that is a failure, not a fallback. */
  let warned: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warned = vi.spyOn(console, "warn");
  });
  afterEach(() => {
    expect(warned).not.toHaveBeenCalled();
    warned.mockRestore();
  });
  afterAll(() => {
    useListWorker(undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("answers what the inline listing does, every kind and field", async () => {
    fill(env.root, env.homeDir);
    useListWorker(null);
    const inline = await env.vault.tree();
    useListWorker(path.join(dir, "list-worker.mjs"));
    const threaded = await env.vault.tree();
    expect(threaded).toEqual(inline);
    expect(inline.notes).toEqual([
      "untitled",
      "work/Onboarding",
      "work/deep/event",
      "work/deep/project",
      "work/deep/task",
      "work/twice",
    ]);
    expect(inline.titles["work/twice"]).toBe("The md one");
    expect(inline.tasks["work/deep/task"]).toEqual({ status: "todo", due: "2026-01-02" });
    expect(inline.sizes["attachments/spec.pdf"]).toBe(PDF.length);
    expect(inline.folders).not.toContain("linked-folder");
    expect(inline.notes).not.toContain("link");
  });

  it("a second listing on the worker reads again only what changed", async () => {
    useListWorker(path.join(dir, "list-worker.mjs"));
    write(env.root, "a.md", "---\ntitle: First\n---\n");
    expect((await env.vault.tree()).titles.a).toBe("First");
    write(env.root, "a.md", "---\ntitle: Second, and longer\n---\n");
    expect((await env.vault.tree()).titles.a).toBe("Second, and longer");
  });
});

describe("a listing beside other work", () => {
  it("hands the thread back while it reconciles", async () => {
    for (let i = 0; i < 3000; i++) write(env.root, `n/${i}.md`, `---\ntitle: N${i}\n---\n`);
    let ran = false;
    const listing = env.vault.tree().then((t) => ({ t, ran }));
    void yieldNow().then(() => {
      ran = true;
    });
    const got = await listing;
    expect(got.t.notes).toHaveLength(3000);
    expect(got.ran).toBe(true);
  });

  it("a document made while one runs keeps its row and its created", async () => {
    for (let i = 0; i < 2000; i++) write(env.root, `n/${i}.md`, "x\n");
    const listing = env.vault.tree();
    const name = await env.vault.create("made meanwhile", "note", NOTE, { created: "2020-01-02T03:04:05Z" });
    await listing;
    expect(await env.vault.created(name, "note")).toBe("2020-01-02T03:04:05Z");
    expect((await env.vault.tree()).notes).toContain(name);
  });

  it("a document deleted while one runs does not come back", async () => {
    for (let i = 0; i < 2000; i++) write(env.root, `n/${i}.md`, "x\n");
    const name = await env.vault.create("going", "note", NOTE);
    const id = await env.vault.peekId(name, "note");
    const listing = env.vault.tree();
    await env.vault.delete(name, "note");
    expect((await listing).notes).not.toContain(name);
    expect(env.home.docById(env.vault.id, id!)).toBeUndefined();
  });

  it("one asked for while another runs is never older than its question", async () => {
    for (let i = 0; i < 2000; i++) write(env.root, `n/${i}.md`, "x\n");
    const first = env.vault.tree();
    write(env.root, "late.md", "---\ntitle: Late\n---\n");
    const second = env.vault.tree();
    const third = env.vault.tree();
    expect((await first).notes).not.toContain("late");
    expect((await second).notes).toContain("late");
    expect(await third).toBe(await second);
  });
});
