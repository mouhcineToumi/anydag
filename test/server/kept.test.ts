/**
 * The kept listing (#280): while a vault is watched, a listing answers from the last one and what
 * moved since rather than walking the vault — and must answer exactly what a walk would. Each case
 * changes the vault and compares the watched vault's tree with a walk's, over the same index.
 */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { Parsed } from "../../server/grammar";
import type { Entry } from "../../server/parsing";
import { type Tree, Vault } from "../../server/vault";
import { BOARD, NOTE, PDF, makeEnv, sleep, sweepTemps, until, write, type Env, watchedFromTheStart } from "./helpers";

let env: Env;
beforeEach(async () => {
  env = makeEnv();
  write(env.root, "plan.board.md", BOARD);
  write(env.root, "work/Onboarding.md", NOTE);
  write(env.root, "work/twice.md", "---\ntitle: The md one\n---\n");
  write(env.root, "work/twice.note.md", "---\ntitle: The note.md one\n---\n");
  write(env.root, "work/deep/task.md", "---\ntitle: Ship\nstatus: todo\ndue: 2026-01-02\n---\n# Ship\n");
  write(env.root, "attachments/spec.pdf", PDF);
  write(env.root, "untitled.md", "no frontmatter at all\n");
  /* Watched from the start (`ANYDAG_TEST_WATCH`), the vault began subscribing before these were
     written, and a folder made while the watcher subscribes may never be watched: `work/` went unheard
     on CI. Open the vault again over the files as they now are — once the first has let go of the
     folder, since the watcher is one per folder and an unsubscribe still in flight takes it away. */
  if (watchedFromTheStart) {
    await env.vault.close();
    env = env.reopen();
  }
  await env.vault.watch();
  await env.vault.tree();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

/** What a walk says the vault holds now, over the same index: a second, unwatched vault on the folder. */
async function walked(): Promise<Tree> {
  const v = new Vault(env.root, env.home);
  try {
    return await v.tree();
  } finally {
    await v.close();
  }
}

/** The watched vault's answer, which must be the walk's — and, unless `walks`, made without one. */
async function same(walks = false): Promise<Tree> {
  const had = env.vault.walks;
  const kept = await env.vault.tree();
  if (walks) expect(env.vault.walks).toBeGreaterThan(had);
  else expect(env.vault.walks).toBe(had);
  expect(kept).toEqual(await walked());
  return kept;
}

const at = (rel: string): string => path.join(env.root, ...rel.split("/"));

describe("the kept listing", () => {
  it("answers the same tree while nothing moved", async () => {
    const a = await env.vault.tree();
    expect(await env.vault.tree()).toBe(a);
    await same();
  });

  it("a document made, renamed or deleted outside the app is in the very next answer", async () => {
    write(env.root, "work/made.md", "---\ntitle: Made\n---\n");
    fs.renameSync(at("work/Onboarding.md"), at("work/Welcome.md"));
    fs.rmSync(at("untitled.md"));
    const t = await same();
    expect(t.notes).toContain("work/made");
    expect(t.titles["work/made"]).toBe("Made");
    expect(t.notes).toContain("work/Welcome");
    expect(t.notes).not.toContain("work/Onboarding");
    expect(t.notes).not.toContain("untitled");
  });

  it("folders made, moved and removed outside the app", async () => {
    write(env.root, "new/inner/a.board.md", BOARD);
    fs.renameSync(at("work/deep"), at("moved"));
    fs.mkdirSync(at("empty"));
    let t = await same();
    expect(t.folders).toEqual(expect.arrayContaining(["new", "new/inner", "moved", "empty"]));
    expect(t.notes).toContain("moved/task");
    expect(t.tasks["moved/task"]).toEqual({ status: "todo", due: "2026-01-02", body: true, changed: expect.any(Number) });
    fs.rmSync(at("work"), { recursive: true });
    t = await same();
    expect(t.folders).not.toContain("work");
    expect(t.notes.some((n) => n.startsWith("work/"))).toBe(false);
  });

  it("a folder swapped for a link is gone, and nothing is read through it", async () => {
    const outside = path.join(env.homeDir, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.md"), "---\ntitle: Secret\n---\n");
    fs.rmSync(at("work/deep"), { recursive: true });
    fs.symlinkSync(outside, at("work/deep"));
    const t = await same();
    expect(t.notes.some((n) => n.startsWith("work/deep/"))).toBe(false);
    expect(t.folders).not.toContain("work/deep");
  });

  it("a text written in place is in the answer once the watcher has said so", async () => {
    fs.writeFileSync(at("work/Onboarding.md"), "---\ntitle: Renamed in place\n---\n");
    await until(async () => (await env.vault.tree()).titles["work/Onboarding"] === "Renamed in place", 5000, "the new title");
    await same();
  });

  it("the twin a deleted `plan.md` was hiding is listed in its place", async () => {
    fs.rmSync(at("work/twice.md"));
    const t = await same();
    expect(t.titles["work/twice"]).toBe("The note.md one");
  });

  it("a document moved outside the app keeps its id and its created", async () => {
    const name = await env.vault.create("keeper", "note", NOTE, { created: "2020-01-02T03:04:05Z" });
    const before = await env.vault.tree();
    const id = before.ids[name]!;
    fs.mkdirSync(at("archive"));
    fs.renameSync(at(`${name}.md`), at(`archive/${name}.md`));
    const t = await same();
    expect(t.ids[`archive/${name}`]).toBe(id);
    expect(t.created[`archive/${name}`]).toBe("2020-01-02T03:04:05Z");
  });

  it("a copy made in a file manager is given an id of its own, as the walk gives it", async () => {
    const name = await env.vault.create("original", "note", NOTE);
    const id = (await env.vault.tree()).ids[name]!;
    await sleep(20);
    fs.copyFileSync(at(`${name}.md`), at("copy.md"));
    const t = await same(true);
    expect(t.ids[name]).toBe(id);
    expect(t.ids.copy).toBeTruthy();
    expect(t.ids.copy).not.toBe(id);
  });

  it("what the app makes, renames, writes and deletes is in the next answer", async () => {
    const name = await env.vault.create("app made", "note", "---\ntitle: App made\n---\n");
    expect((await same()).titles[name]).toBe("App made");
    const v = (await env.vault.read(name, "note"))!;
    await env.vault.write(name, "note", "---\ntitle: Written\n---\n", v.base);
    expect((await same()).titles[name]).toBe("Written");
    const to = await env.vault.rename(name, "note", "work/app moved");
    expect((await same()).notes).toContain(to);
    await env.vault.delete(to, "note");
    expect((await same()).notes).not.toContain(to);
  });

  it("an attachment added, called something and removed", async () => {
    const name = await env.vault.putFile("attachments/scan.pdf", PDF, null);
    let t = await same();
    expect(t.files).toContain(name);
    await env.vault.titleFile(name, "The scan");
    t = await same();
    expect(t.titles[name]).toBe("The scan");
    // One with no row, which may be a moved one whose record names where it was: the walk says.
    write(env.root, "attachments/dropped.pdf", PDF);
    expect((await same(true)).files).toContain("attachments/dropped.pdf");
    await env.vault.delete(name, "file");
    expect((await same()).files).not.toContain(name);
  });

  it("an attachment record another program writes is read, as the walk reads it", async () => {
    write(env.root, "scan.pdf", "%PDF");
    expect((await env.vault.tree()).ids["scan.pdf"]).not.toBe("abcdefghjk");
    // Written in place, as a sync tool might: no folder moves, so the watcher is what says so.
    fs.mkdirSync(at(".anydag/files"), { recursive: true });
    fs.writeFileSync(at(".anydag/files/abcdefghjk.json"), JSON.stringify({ path: "scan.pdf", title: "Scan" }));
    await until(async () => (await env.vault.tree()).ids["scan.pdf"] === "abcdefghjk", 5000, "the record's id");
    expect((await env.vault.tree()).titles["scan.pdf"]).toBe("Scan");
    expect(await env.vault.tree()).toEqual(await walked());
  });

  it("a tree handed out never changes afterwards", async () => {
    const t = await env.vault.tree();
    const was = JSON.stringify(t);
    const lists = { notes: t.notes, titles: t.titles };
    write(env.root, "fresh.md", "---\ntitle: Fresh\n---\n");
    fs.rmSync(at("untitled.md"));
    const next = await env.vault.tree();
    expect(next).not.toBe(t);
    expect(JSON.stringify(t)).toBe(was);
    expect(t.notes).toBe(lists.notes);
    expect(t.titles).toBe(lists.titles);
    // A field nothing touched is shared, not copied.
    expect(next.tasks).toBe(t.tasks);
  });

  it("a walk takes over when more moved than is worth reading here, and answers the same", async () => {
    for (let i = 0; i < 2100; i++) write(env.root, `bulk/${i}.md`, `---\ntitle: B${i}\n---\n`);
    const t = await same(true);
    expect(t.notes.filter((n) => n.startsWith("bulk/"))).toHaveLength(2100);
  });

  it("opening, watching and listing write nothing into the vault", async () => {
    const fingerprint = (): string[] => {
      const out: string[] = [];
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else out.push(`${path.relative(env.root, p)}:${fs.statSync(p).mtimeMs}`);
        }
      };
      walk(env.root);
      return out.sort();
    };
    const before = fingerprint();
    const again = env.reopen();
    await again.vault.watch();
    await again.vault.tree();
    write(again.root, "outside.md", "x\n");
    const after = fingerprint();
    await again.vault.tree();
    expect(fingerprint()).toEqual(after);
    expect(after.filter((f) => !f.startsWith("outside.md"))).toEqual(before);
    env = again;
  });

  /* A note in the templates folder is a note to copy (#263): called by its file's name and no task,
     project or event — in the kept listing as in the walk, and again when the folder itself moves. */
  it("a template is no task in the kept listing, and a templates folder made by hand is a walk", async () => {
    fs.mkdirSync(at("Templates"));
    write(env.root, "Templates/daily.md", "---\ntitle: {{date}}\nstatus: todo\n---\n");
    const t = await same(true);
    expect(t.notes).toContain("Templates/daily");
    expect(t.titles["Templates/daily"]).toBe("daily");
    expect(t.tasks["Templates/daily"]).toBeUndefined();
    let heard!: () => void;
    const said = new Promise<void>((ok) => {
      heard = ok;
    });
    await env.vault.subscribeRaw((rels) => {
      if (rels.includes("Templates/daily.md")) heard();
    });
    fs.writeFileSync(at("Templates/daily.md"), "---\ntitle: Day {{date}}\nproject: planning\nstatus: doing\n---\n");
    await said;
    const after = await same();
    expect(after.tasks["Templates/daily"]).toBeUndefined();
    expect(after.projects["Templates/daily"]).toBeUndefined();
  });

  it("a templates folder renamed in Settings is a walk, and its notes stop being tasks", async () => {
    expect((await same()).tasks["work/deep/task"]).toBeTruthy();
    env.vault.templates = "work";
    const t = await env.vault.tree();
    expect(t.tasks["work/deep/task"]).toBeUndefined();
    expect(t.titles["work/Onboarding"]).toBe("Onboarding");
    env.vault.templates = "";
    expect((await env.vault.tree()).tasks["work/deep/task"]).toBeTruthy();
  });
});

describe("the references index over a kept listing", () => {
  const get = async (app: ReturnType<typeof createApp>, route: string) => {
    const res = await app.request(`http://127.0.0.1${route}`, { headers: { "x-anydag-token": "t", host: "127.0.0.1" } });
    return { status: res.status, text: await res.text() };
  };

  it("answers the same index while nothing moved, and a link written outside the app once the watcher says so", async () => {
    const session = new Session(env.home, env.vault, "test");
    session.watchVaults();
    const app = createApp({ session, token: "t", page: null });
    const target = await env.vault.ident("work/Onboarding", "note");
    const first = await get(app, "/__board/index");
    expect(first.status).toBe(200);
    expect((await get(app, "/__board/index")).text).toBe(first.text);
    fs.writeFileSync(at("untitled.md"), `See [Onboarding](dag:${target}).\n`);
    await until(
      async () => {
        const docs = JSON.parse((await get(app, "/__board/index")).text).docs as { name: string; refs: { id: string }[] }[];
        return docs.find((d) => d.name === "untitled")?.refs.some((r) => r.id === target);
      },
      5000,
      "the new link",
    );
  });
});

describe("Parsed over stamps", () => {
  it("reads only the texts whose stamp moved, and parses only those whose bytes did", async () => {
    const parsed: string[][] = [];
    const cache = new Parsed("index", env.root, {
      parse: (texts) => {
        parsed.push(Object.keys(texts).sort());
        return Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, { t }]));
      },
    });
    write(env.root, "a.board.md", "one");
    write(env.root, "b.board.md", "two");
    const stamps: Record<string, string> = { a: "1", b: "1" };
    const ask = () => cache.of(["a", "b"].map((k): Entry => [k, k, "board", stamps[k]!]));
    const first = await ask();
    expect(await ask()).toBe(first);
    expect(parsed).toEqual([["a", "b"]]);
    // A stamp that did not move is not looked at: a change on disk it does not name is not read.
    write(env.root, "a.board.md", "eins");
    expect(await ask()).toBe(first);
    const g = cache.generation;
    stamps.b = "2"; // touched, same bytes: read, not parsed, and the same answer
    expect(await ask()).toBe(first);
    expect(cache.generation).toBe(g);
    stamps.a = "2";
    const third = await ask();
    expect(third).not.toBe(first);
    expect(third.get("a")).toEqual({ t: "eins" });
    expect(cache.generation).toBe(g + 1);
    expect(parsed).toEqual([["a", "b"], ["a"]]);
  });
});
