/**
 * `/__board/index` and `/__board/corpus` read their texts where the grammar parses them (#287): on
 * the grammar's worker, they answer exactly what reading every text on the server's thread and
 * parsing it there answered, and they keep answering it as the vault changes and the worker restarts.
 */
import "./sqlite-shim";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { corpusTexts } from "../../src/search/corpus";
import { indexTexts, resolveWikiRefs, type Ref } from "../../src/refs/extract";
import { leafOf } from "../../server/names";
import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { useGrammarWorker, WorkerProcess } from "../../server/grammar";
import type { Entry, Meta } from "../../server/parsing";
import { byKind, textKey } from "../../server/vault";
import { BOARD, NOTE, PDF, QUIZ, TABLE, makeEnv, sweepTemps, write, type Env } from "./helpers";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

/** Every kind, references of every sort, both note suffixes, an attachment, and a link out. */
async function fill(): Promise<void> {
  await env.vault.create("Projects/Plan", "note", "# Plan\n\nBack to [[Plan]] itself.\n");
  const plan = await env.vault.peekId("Projects/Plan", "note");
  await env.vault.create("Meeting notes", "note", `See [[Plan|the plan]], ![[Plan]], [it](dag:${plan}) and [[Nowhere]].\n`);
  await env.vault.create("Ship", "note", "---\ntitle: Ship\nstatus: todo\ndue: 2026-01-02\n---\n# Ship\n");
  await env.vault.create("Launch", "note", "---\nstart: 2026-10-12\nend: 2026-10-14\n---\n# Launch\n");
  await env.vault.create("work/plan", "board", BOARD.replace("hi", `hi [[Meeting notes]] and [x](dag:${plan})`));
  await env.vault.create("drill", "quiz", QUIZ);
  await env.vault.create("deals", "table", TABLE);
  write(env.root, "work/Onboarding.note.md", NOTE);
  write(env.root, "attachments/spec.pdf", PDF);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-outside-"));
  fs.writeFileSync(path.join(outside, "secret.md"), "---\ntitle: Secret\n---\n[[Plan]]\n");
  fs.symlinkSync(path.join(outside, "secret.md"), path.join(env.root, "link.md"));
}

async function ask(app: ReturnType<typeof createApp>, route: string): Promise<{ docs: Record<string, unknown>[] }> {
  const res = await app.request(`http://127.0.0.1${route}`, { headers: { "x-anydag-token": "t", host: "127.0.0.1" } });
  expect(res.status).toBe(200);
  return (await res.json()) as { docs: Record<string, unknown>[] };
}

const appOf = () => createApp({ session: new Session(env.home, env.vault, "test"), token: "t", page: null });

/**
 * What the two routes answered before #287, computed the way they computed it: every text read on
 * this thread (`Vault.texts`) and parsed here.
 */
async function before(): Promise<{ index: Record<string, unknown>[]; corpus: Record<string, unknown>[] }> {
  const tree = await env.vault.tree();
  const texts = await env.vault.texts(tree);
  const docs = (["board", "note", "quiz", "table"] as const)
    .flatMap((kind) => byKind(tree)[kind].map((name) => ({ kind, name, key: textKey(name, kind), id: tree.ids[name] })))
    .filter((d) => d.id && texts[d.key] !== undefined)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const own = (ts: Record<string, string>) => Object.fromEntries(docs.map((d) => [d.key, ts[d.key]!]));
  const idx = indexTexts(own(texts)) as unknown as Record<string, Record<string, unknown>>;
  const cor = corpusTexts(own(texts)) as unknown as Record<string, Record<string, unknown>>;
  const files = tree.files.filter((n) => tree.ids[n]);
  const named = [
    ...docs.map((d) => ({
      id: d.id!,
      name: d.name,
      kind: d.kind,
      title: (idx[d.key]?.title as string) ?? tree.titles[d.name] ?? null,
    })),
    ...files.map((n) => ({ id: tree.ids[n]!, name: n, kind: "file", title: tree.titles[n] ?? null })),
  ];
  return {
    index: [
      ...docs.map((d) => {
        const f = idx[d.key]!;
        return {
          id: d.id,
          name: d.name,
          kind: d.kind,
          title: f.title ?? tree.titles[d.name] ?? leafOf(d.name),
          task: f.task ?? null,
          project: f.project ?? null,
          event: f.event ?? null,
          tags: f.tags ?? null,
          questions: f.questions ?? null,
          refs: resolveWikiRefs((f.refs as Ref[]) ?? [], named),
        };
      }),
      ...files.map((n) => ({
        id: tree.ids[n],
        name: n,
        kind: "file",
        title: tree.titles[n] ?? null,
        bytes: tree.sizes[n] ?? 0,
        refs: [],
      })),
    ],
    corpus: [
      ...docs.map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        title: (cor[d.key]?.title as string) ?? tree.titles[d.name] ?? leafOf(d.name),
        units: cor[d.key]?.units ?? [],
      })),
      ...files.map((n) => {
        const title = tree.titles[n] ?? null;
        return {
          id: tree.ids[n],
          name: n,
          kind: "file",
          title,
          units: [...(title ? [{ what: "title", text: title }] : []), { what: "file", text: leafOf(n) }],
        };
      }),
    ],
  };
}

/** A change from outside the app, one of each sort: a text edited, one removed, one added. */
async function change(): Promise<void> {
  write(env.root, "Meeting notes.md", "Only [[Ship]] now.\n");
  fs.rmSync(path.join(env.root, "drill.quiz.md"));
  write(env.root, "work/new.board.md", "```md {#n}\nnew [[Launch]]\n```\n");
  await env.vault.tree();
}

describe("the index and the corpus inline", () => {
  beforeAll(() => useGrammarWorker(null));
  afterAll(() => useGrammarWorker(undefined));

  it("answer what reading every text on the server's thread answered, before and after a change", async () => {
    await fill();
    const app = appOf();
    let want = await before();
    expect((await ask(app, "/__board/index")).docs).toEqual(want.index);
    expect((await ask(app, "/__board/corpus")).docs).toEqual(want.corpus);
    expect(want.index.map((d) => d.name)).not.toContain("link");
    await change();
    want = await before();
    expect(want.index.map((d) => d.name)).toContain("work/new");
    expect((await ask(app, "/__board/index")).docs).toEqual(want.index);
    expect((await ask(app, "/__board/corpus")).docs).toEqual(want.corpus);
  });
});

describe("the answer, streamed a doc at a time", () => {
  it("is the JSON `c.json` wrote, an empty vault included", async () => {
    const app = appOf();
    for (const route of ["/__board/index", "/__board/corpus"]) {
      const res = await app.request(`http://127.0.0.1${route}`, { headers: { "x-anydag-token": "t", host: "127.0.0.1" } });
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(await res.text()).toBe('{"docs":[]}');
    }
    await fill();
    const res = await app.request("http://127.0.0.1/__board/index", { headers: { "x-anydag-token": "t", host: "127.0.0.1" } });
    expect(await res.text()).toBe(JSON.stringify({ docs: (await before()).index }));
  });
});

describe("the index and the corpus on the grammar's worker", () => {
  let dir: string;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-grammar-worker-"));
    const { build } = await import("esbuild");
    await build({
      entryPoints: { "grammar-worker": path.resolve(__dirname, "../../server/grammar-worker.ts") },
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
  }, 60_000);
  /* A worker that fails answers inline and says so: here that is a failure, not a fallback. */
  let warned: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    useGrammarWorker(path.join(dir, "grammar-worker.mjs"));
    warned = vi.spyOn(console, "warn");
  });
  afterEach(() => {
    expect(warned).not.toHaveBeenCalled();
    warned.mockRestore();
  });
  afterAll(() => {
    useGrammarWorker(undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("answer what reading every text on the server's thread answered, before and after a change", async () => {
    await fill();
    const app = appOf();
    let want = await before();
    expect((await ask(app, "/__board/index")).docs).toEqual(want.index);
    expect((await ask(app, "/__board/corpus")).docs).toEqual(want.corpus);
    // Warm: nothing read again, the same answer.
    expect((await ask(app, "/__board/index")).docs).toEqual(want.index);
    await change();
    want = await before();
    expect((await ask(app, "/__board/index")).docs).toEqual(want.index);
    expect((await ask(app, "/__board/corpus")).docs).toEqual(want.corpus);
  }, 30_000);

  it("answer whole after the worker restarts, from what it kept on disk", async () => {
    await fill();
    const app = appOf();
    await ask(app, "/__board/index");
    await ask(app, "/__board/corpus");
    // A new worker: the same session's caches ask a reader that has never answered them.
    useGrammarWorker(path.join(dir, "grammar-worker.mjs"));
    await change();
    const want = await before();
    expect((await ask(app, "/__board/index")).docs).toEqual(want.index);
    expect((await ask(app, "/__board/corpus")).docs).toEqual(want.corpus);
  }, 30_000);

  /** Every listed text with an id, as the routes name them to the worker. */
  async function entriesOf(): Promise<{ entries: Entry[]; meta: Meta[] }> {
    const tree = await env.vault.tree();
    const entries: Entry[] = [];
    const meta: Meta[] = [];
    for (const kind of ["board", "note", "quiz", "table"] as const)
      for (const name of byKind(tree)[kind]) {
        if (!tree.ids[name]) continue;
        entries.push([textKey(name, kind), name, kind]);
        meta.push([tree.ids[name], tree.titles[name] ?? null]);
      }
    return { entries, meta };
  }

  it("started again after it ended, answers a warm /index parsing nothing, from what it kept in the home (#279)", async () => {
    await fill();
    const { entries } = await entriesOf();
    const first = new WorkerProcess(path.join(dir, "grammar-worker.mjs"));
    const cold = await first.read(1, env.homeDir, env.root, "index", null, entries);
    expect(cold.parsed).toBe(true);
    await first.close();
    const second = new WorkerProcess(path.join(dir, "grammar-worker.mjs"));
    try {
      const warm = await second.read(1, env.homeDir, env.root, "index", cold.turn, entries);
      expect(warm).toMatchObject({ parsed: false, whole: false, fresh: [], turn: cold.turn });
    } finally {
      await second.close();
    }
  }, 30_000);

  it("asks to be replaced after parsing many texts, and a fresh worker answers the search from the rows", async () => {
    for (let i = 0; i < 520; i++)
      write(
        env.root,
        `many/n${i}.md`,
        `---\nid: ${(1000000000 + i).toString(36).padStart(10, "0").slice(-10)}\n---\n# N${i}\n\nharbour ${i}\n`,
      );
    const { entries, meta } = await entriesOf();
    const t = new WorkerProcess(path.join(dir, "grammar-worker.mjs"));
    try {
      const first = await t.search(1, env.homeDir, env.root, entries, meta, [], "harbour", undefined, true);
      expect(first.body).toEqual({ again: true });
      const pid = t.pid;
      t.retire();
      const second = await t.search(1, env.homeDir, env.root, entries, meta, [], "harbour 7", undefined, true);
      expect(t.pid).not.toBe(pid);
      expect((second.body as { hits: { name: string }[] }).hits.map((h) => h.name)).toContain("many/n7");
    } finally {
      await t.close();
    }
  }, 60_000);

  it("send an answer bigger than one part in parts, and all of it arrives", async () => {
    for (let i = 0; i < 1500; i++)
      write(
        env.root,
        `many/n${i}.md`,
        `---\nid: ${(1000000000 + i).toString(36).padStart(10, "0").slice(-10)}\n---\n# N${i}\n\n[[n${i + 1}]]\n`,
      );
    const app = appOf();
    const want = await before();
    expect(want.index.length).toBe(1500);
    expect((await ask(app, "/__board/index")).docs).toEqual(want.index);
    expect((await ask(app, "/__board/corpus")).docs).toEqual(want.corpus);
  }, 60_000);
});
