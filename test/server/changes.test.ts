/** Ported from the hosted api's `test_changes.py`: the change feed, over a real @parcel/watcher on a temp folder. */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type Change, Vault } from "../../server/vault";
import {
  BOARD,
  NOTE,
  PDF,
  QUIZ,
  TABLE,
  listen,
  makeEnv,
  sleep,
  sweepTemps,
  until,
  write,
  type Env,
  watchedFromTheStart,
} from "./helpers";

let env: Env;
let stops: (() => void)[] = [];
beforeEach(() => {
  env = makeEnv();
  stops = [];
});
afterEach(async () => {
  for (const s of stops) s();
  await env.cleanup();
  sweepTemps();
});

type Doc = Extract<Change, { type: "doc" }>;

async function feed() {
  const f = await listen(env.vault);
  stops.push(f.stop);
  return f;
}
/** The next doc event for `name` that satisfies `ok`. */
const doc = async (f: Awaited<ReturnType<typeof feed>>, name: string, ok: (d: Doc) => boolean = () => true): Promise<Doc> =>
  until(() => f.docs(name).find(ok), 5000, `a change to ${name}`);
const tree = (f: Awaited<ReturnType<typeof feed>>) => until(() => f.events.find((e) => e.type === "tree"), 5000, "a tree change");

describe("the change feed", () => {
  it("a write reaches a listener that did not make it, carrying the sha1 and not the text", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const f = await feed();
    await sleep(100);
    const cur = (await env.vault.read(name))!;
    const after = await env.vault.write(name, "board", cur.text + "\nmore\n", cur.base);
    const got = await doc(f, name, (d) => d.sha1 === after.base);
    expect(got).toMatchObject({ kind: "board", name, sha1: after.base, title: "t" });
    expect(got).not.toHaveProperty("text");
  });

  it("a write made by another program reaches it just the same", async () => {
    const f = await feed();
    write(env.root, "Hand made.board.md", BOARD);
    const got = await doc(f, "Hand made");
    expect(got.kind).toBe("board");
    expect(got.sha1).not.toBeNull();
    expect(got.name).toBe("Hand made");
  });

  it("a deleted document arrives with no sha1", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const f = await feed();
    await sleep(100);
    await env.vault.delete(name);
    const got = await doc(f, name, (d) => d.sha1 === null);
    expect(got).toMatchObject({ kind: "board", sha1: null, title: null });
  });

  it("a new document also moves the tree", async () => {
    const f = await feed();
    await env.vault.create("fresh", "board", BOARD);
    await doc(f, "fresh");
    await tree(f);
  });

  it("an edit to an existing document is not a tree change", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const f = await feed();
    await sleep(150);
    await env.vault.write(name, "board", "---\ntitle: other\n---\n", null);
    await doc(f, name, (d) => d.title === "other");
    await sleep(200);
    expect(f.events.filter((e) => e.type === "tree")).toEqual([]);
  });

  it("an empty folder made elsewhere reaches the feed", async () => {
    const f = await feed();
    await env.vault.mkdir("later");
    await tree(f);
  });

  it("a folder removed reaches the feed", async () => {
    await env.vault.mkdir("later");
    const f = await feed();
    await sleep(100);
    await env.vault.rmdir("later");
    await tree(f);
  });

  it("a folder move reaches the feed", async () => {
    await env.vault.create("work/plan", "board", BOARD);
    const f = await feed();
    await sleep(100);
    await env.vault.moveFolder("work", "done");
    await tree(f);
  });

  /* #403: a folder moved by another program is one event at the folder's own path, and a page holding
     a document inside it heard nothing — its edits went to a path that was no longer there, as 404s. */
  it("a folder moved by another program says each document in it went", async () => {
    await env.vault.create("work/plan", "board", BOARD);
    await env.vault.create("work/deep/notes", "note", NOTE);
    await env.vault.create("work-other/keep", "board", BOARD);
    const f = await feed();
    await sleep(100);
    fs.renameSync(path.join(env.root, "work"), path.join(env.root, "moved"));
    expect(await doc(f, "work/plan", (d) => d.sha1 === null)).toMatchObject({ kind: "board", sha1: null });
    expect(await doc(f, "work/deep/notes", (d) => d.sha1 === null)).toMatchObject({ kind: "note", sha1: null });
    await tree(f);
    await sleep(200);
    // A sibling whose name only starts the same is not inside it. (Watched from the start, its
    // making is a change too, so only its going is asked about.)
    expect(f.docs("work-other/keep").filter((d) => d.sha1 === null)).toEqual([]);
  });

  it("a folder removed by another program says each document in it went", async () => {
    await env.vault.create("gone/plan", "board", BOARD);
    const f = await feed();
    await sleep(100);
    fs.rmSync(path.join(env.root, "gone"), { recursive: true });
    await doc(f, "gone/plan", (d) => d.sha1 === null);
  });

  it("a rename says the old name went and the new one came", async () => {
    await env.vault.create("old", "board", BOARD);
    const f = await feed();
    await sleep(100);
    await env.vault.rename("old", "board", "New name");
    await doc(f, "old", (d) => d.sha1 === null);
    await doc(f, "New name", (d) => d.sha1 !== null);
  });

  // Watched from the start (`ANYDAG_TEST_WATCH`), the files written before subscribing are changes.
  it.skipIf(watchedFromTheStart)("the state at subscription is not replayed as changes", async () => {
    for (let n = 0; n < 3; n++) await env.vault.create(`existing-${n}`, "board", BOARD);
    const f = await feed();
    await sleep(600);
    expect(f.events).toEqual([]);
  });

  it("what the vault keeps for itself is not a change", async () => {
    const f = await feed();
    write(env.root, ".obsidian/workspace.json", "{}");
    write(env.root, ".git/HEAD", "x");
    write(env.root, "node_modules/x/readme.md", "# x\n");
    write(env.root, ".anydag/files/abcdefghjk.json", "{}");
    write(env.root, ".anydag/settings.json", "{}");
    write(env.root, "plan.assets/paste.png", "x");
    write(env.root, "a.sync-conflict-20240101.md", "x");
    write(env.root, "unlisted.html", "x");
    write(env.root, "sentinel.board.md", BOARD);
    await doc(f, "sentinel");
    await sleep(300);
    expect(f.events.filter((e) => e.type === "doc").map((e) => (e as Doc).name)).toEqual(["sentinel"]);
  });

  it("many listeners share the one watcher, and the last to leave stops it", async () => {
    const a: Change[] = [];
    const b: Change[] = [];
    const offA = await env.vault.subscribe((c) => a.push(c));
    const offB = await env.vault.subscribe((c) => b.push(c));
    write(env.root, "x.board.md", BOARD);
    await until(() => a.some((c) => c.type === "doc") && b.some((c) => c.type === "doc"));
    offA();
    const before = a.length;
    write(env.root, "y.board.md", BOARD);
    await until(() => b.some((c) => c.type === "doc" && c.name === "y"));
    expect(a.length).toBe(before);
    offB();
    const n = b.length;
    write(env.root, "z.board.md", BOARD);
    await sleep(300);
    expect(b.length).toBe(n);
  });

  it("a vault that is closed says gone to every listener", async () => {
    const events: Change[] = [];
    await env.vault.subscribe((c) => events.push(c));
    await env.vault.close();
    expect(events).toEqual([{ type: "gone" }]);
  });

  it("a listener that throws does not stop the others", async () => {
    const heard: Change[] = [];
    await env.vault.subscribe(() => {
      throw new Error("boom");
    });
    await env.vault.subscribe((c) => heard.push(c));
    write(env.root, "x.board.md", BOARD);
    await until(() => heard.some((c) => c.type === "doc"));
  });
});

describe("a folder made with its parent in one go (#405)", () => {
  /* inotify watches a new folder only once it hears it made, and never looks inside, so what
     `mkdir -p` made beneath it in the same breath was never watched. */
  it("a document written later in a folder made with its parent reaches the feed", async () => {
    const f = await feed();
    fs.mkdirSync(path.join(env.root, "a", "b", "c"), { recursive: true });
    await tree(f);
    await sleep(300);
    write(env.root, "a/b/later.board.md", BOARD);
    write(env.root, "a/b/c/deeper.board.md", BOARD);
    expect((await doc(f, "a/b/later")).sha1).not.toBeNull();
    expect((await doc(f, "a/b/c/deeper")).sha1).not.toBeNull();
  });

  it("a document written with the folders it is in, in one go, reaches the feed", async () => {
    const f = await feed();
    write(env.root, "a/b/c/now.board.md", BOARD);
    write(env.root, "a/b/beside.md", NOTE);
    write(env.root, "a/top.board.md", BOARD);
    for (const name of ["a/b/c/now", "a/b/beside", "a/top"]) expect((await doc(f, name)).sha1).not.toBeNull();
  });

  it("a folder made with its parent, removed and made again, is watched again", async () => {
    const f = await feed();
    fs.mkdirSync(path.join(env.root, "a", "b"), { recursive: true });
    await tree(f);
    await sleep(200);
    fs.rmSync(path.join(env.root, "a"), { recursive: true });
    await sleep(200);
    fs.mkdirSync(path.join(env.root, "a", "b"), { recursive: true });
    await sleep(300);
    write(env.root, "a/b/again.board.md", BOARD);
    expect((await doc(f, "a/b/again")).sha1).not.toBeNull();
  });
});

describe("a folder that goes while the watcher starts (#389)", () => {
  /* The watcher walks the vault and then watches each folder it found; one moved in between failed
     the whole subscription, unhandled, and left the vault unwatched. */
  it("does not stop the vault being watched", async () => {
    /* With nothing else watched, as on CI, the watcher lets its failed walk go and a second walks
       afresh; another vault's watcher would keep the failed walk (`subscribeAt`). */
    await env.vault.close();
    const root = fs.mkdtempSync(path.join(path.dirname(env.root), "anydag-vault-"));
    try {
      for (let i = 0; i < 2000; i++) fs.mkdirSync(path.join(root, `d${i}`));
      for (let round = 0; round < 8; round++) {
        fs.mkdirSync(path.join(root, "work", "empty"), { recursive: true });
        const v = new Vault(root, env.home);
        try {
          const watching = v.watch();
          await sleep(round % 4);
          fs.renameSync(path.join(root, "work"), path.join(root, "moved"));
          await watching;
          const f = await listen(v);
          await sleep(100);
          write(root, `moved/r${round}.board.md`, BOARD);
          await until(() => f.docs(`moved/r${round}`).length, 5000, `a change in round ${round}`);
          f.stop();
        } finally {
          await v.close();
        }
        fs.rmSync(path.join(root, "moved"), { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("a folder a file takes the place of does not stop the vault being watched", async () => {
    /* The same gap, answered ENOTDIR: the watcher walked `work` as a folder and found a file there. */
    await env.vault.close();
    const root = fs.mkdtempSync(path.join(path.dirname(env.root), "anydag-vault-"));
    try {
      for (let i = 0; i < 2000; i++) fs.mkdirSync(path.join(root, `d${i}`));
      for (let round = 0; round < 8; round++) {
        fs.mkdirSync(path.join(root, "work"));
        const v = new Vault(root, env.home);
        try {
          const watching = v.watch();
          await sleep(round % 4);
          fs.rmdirSync(path.join(root, "work"));
          fs.writeFileSync(path.join(root, "work"), "a file now");
          await watching;
          const f = await listen(v);
          await sleep(100);
          write(root, `r${round}.board.md`, BOARD);
          await until(() => f.docs(`r${round}`).length, 5000, `a change in round ${round}`);
          f.stop();
        } finally {
          await v.close();
        }
        fs.rmSync(path.join(root, "work"), { force: true });
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("note changes", () => {
  it("a note's write says it is a note and carries its title", async () => {
    const name = await env.vault.create("n", "note", "---\ntitle: Before\n---\n# N\n");
    const f = await feed();
    await sleep(100);
    await env.vault.write(name, "note", "---\ntitle: After\n---\n# N\n", null);
    const got = await doc(f, "n", (d) => d.title === "After");
    expect(got.kind).toBe("note");
  });

  it("says whether the note is a task", async () => {
    const name = await env.vault.create("n", "note", "# N\n");
    const f = await feed();
    await sleep(100);
    await env.vault.write(name, "note", "---\nstatus: done\n---\n# N\n", null);
    const got = await doc(f, "n", (d) => !!d.task);
    /* The feed carries what the listing counts beside the frontmatter: a body, and when it changed. */
    expect(got.task).toEqual({ status: "done", body: true, changed: expect.any(Number) });
    expect(got.event).toBeNull();
    expect(got.project).toBeNull();
  });

  it("says whether the note is an event", async () => {
    const name = await env.vault.create("n", "note", "# N\n");
    const f = await feed();
    await sleep(100);
    await env.vault.write(name, "note", "---\nstart: 2026-10-12\nend: 2026-10-14\n---\n# N\n", null);
    const got = await doc(f, "n", (d) => !!d.event);
    expect(got.event).toEqual({ start: "2026-10-12", end: "2026-10-14" });
  });

  it("says whether the note is a project", async () => {
    const name = await env.vault.create("w/n", "note", "# N\n");
    const f = await feed();
    await sleep(100);
    await env.vault.write(name, "note", "---\nproject: active\nhue: coral\n---\n# N\n", null);
    const got = await doc(f, name, (d) => !!d.project);
    expect(got.project).toEqual({ status: "active", hue: "coral" });
  });

  it("a note stored as `.note.md` is the same note", async () => {
    write(env.root, "old.note.md", NOTE);
    const f = await feed();
    await sleep(100);
    write(env.root, "old.note.md", NOTE + "more\n");
    const got = await doc(f, "old", (d) => d.sha1 !== null);
    expect(got.kind).toBe("note");
  });
});

describe("table and quiz changes", () => {
  it("a table's write says it is a table, with its title, and no task or question count", async () => {
    const name = await env.vault.create("deals", "table", "## T {#t}\n");
    const f = await feed();
    await sleep(100);
    await env.vault.write(name, "table", TABLE, null);
    const got = await doc(f, "deals", (d) => d.title === "Deals");
    expect(got.kind).toBe("table");
    expect(got.task).toBeUndefined();
    expect(got.questions).toBeUndefined();
  });

  it("a quiz's write says it is a quiz and how many it asks", async () => {
    const name = await env.vault.create("drill", "quiz", "## One {#a}\n- [x] y\n- [ ] n\n");
    const f = await feed();
    await sleep(100);
    await env.vault.write(name, "quiz", QUIZ + "\n## Three {#q3}\n- [x] a\n- [ ] b\n", null);
    const got = await doc(f, "drill", (d) => d.questions === 3);
    expect(got.kind).toBe("quiz");
  });
});

describe("file changes", () => {
  it("an uploaded file says it is a file, carries its sha1 and title, and moves the tree", async () => {
    const f = await feed();
    await env.vault.putFile("report.pdf", PDF, "Report.pdf");
    const got = await doc(f, "report.pdf", (d) => d.sha1 !== null);
    expect(got).toMatchObject({ kind: "file", name: "report.pdf" });
    await tree(f);
  });

  it("a new title reaches the feed, though no watcher sees the index change", async () => {
    const name = await env.vault.putFile("report.pdf", PDF, null);
    const f = await feed();
    await sleep(100);
    await env.vault.titleFile(name, "Final.pdf");
    const got = await doc(f, "report.pdf", (d) => d.title === "Final.pdf");
    expect(got.kind).toBe("file");
  });

  it("a file deleted by hand says it went", async () => {
    const name = await env.vault.putFile("report.pdf", PDF, null);
    const f = await feed();
    await sleep(100);
    fs.unlinkSync(path.join(env.root, name));
    await doc(f, "report.pdf", (d) => d.sha1 === null);
  });
});

describe("saved components", () => {
  it("are announced under `components/<name>` and never as part of the tree", async () => {
    const f = await feed();
    await env.vault.create("components/card", "board", "one\n");
    await doc(f, "components/card");
    await env.vault.write("components/card", "board", "two\n", null);
    await until(() => f.docs("components/card").length >= 2);
    await env.vault.delete("components/card", "board");
    await doc(f, "components/card", (d) => d.sha1 === null);
    expect(f.events.filter((e) => e.type === "tree")).toEqual([]);
  });
});
