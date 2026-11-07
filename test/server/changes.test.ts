/** Ported from the hosted api's `test_changes.py`: the change feed, over a real @parcel/watcher on a temp folder. */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Change } from "../../server/vault";
import { BOARD, NOTE, PDF, QUIZ, TABLE, listen, makeEnv, sleep, sweepTemps, until, write, type Env } from "./helpers";

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

  it("a rename says the old name went and the new one came", async () => {
    await env.vault.create("old", "board", BOARD);
    const f = await feed();
    await sleep(100);
    await env.vault.rename("old", "board", "New name");
    await doc(f, "old", (d) => d.sha1 === null);
    await doc(f, "New name", (d) => d.sha1 !== null);
  });

  it("the state at subscription is not replayed as changes", async () => {
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
    expect(got.task).toEqual({ status: "done" });
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
