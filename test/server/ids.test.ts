/** The id syntax cases, one per row, plus lazy minting. */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ALPHABET, frontId, mint, validId, withId } from "../../server/ids";
import {
  BOARD,
  NOTE,
  PDF,
  QUIZ,
  TABLE,
  makeEnv,
  readText,
  sleep,
  sweepTemps,
  until,
  write,
  type Env,
  watchedFromTheStart,
} from "./helpers";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

const snapshot = (root: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const f of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (f.isFile()) out[path.join(f.parentPath, f.name)] = fs.readFileSync(path.join(f.parentPath, f.name), "utf8");
  }
  return out;
};

describe("id syntax", () => {
  it("is ten characters of the Crockford alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const id = mint();
      expect(id).toHaveLength(10);
      expect([...id].every((c) => ALPHABET.includes(c))).toBe(true);
      expect(validId(id)).toBe(true);
    }
    expect(ALPHABET).not.toMatch(/[ilou]/);
    expect(validId("202301011200")).toBe(false);
    expect(validId("ABCDEFGHJK")).toBe(false);
  });

  it("mint skips a taken id", () => {
    const seen: string[] = [];
    mint((x) => {
      seen.push(x);
      return seen.length < 3;
    });
    expect(seen).toHaveLength(3);
  });

  it("reads `id:` from the frontmatter only, and says false for someone else's key", () => {
    expect(frontId("---\nid: abcdefghjk\n---\nx")).toBe("abcdefghjk");
    expect(frontId('---\nid: "abcdefghjk"\n---\nx')).toBe("abcdefghjk");
    expect(frontId("---\ntitle: t\n---\nid: abcdefghjk\n")).toBeNull();
    expect(frontId("no frontmatter\n")).toBeNull();
    expect(frontId("---\nid: 202301011200\n---\nx")).toBe(false);
  });

  it("withId changes one line and keeps every other byte", () => {
    const text = "---\ntitle: T\ntags: [a, b]\n---\nbody\n";
    const out = withId(text, "abcdefghjk");
    expect(out).toContain("title: T");
    expect(out).toContain("tags: [a, b]");
    expect(out.endsWith("---\nbody\n")).toBe(true);
    expect(frontId(out)).toBe("abcdefghjk");
    expect(withId("body\n", "abcdefghjk")).toMatch(/^---\nid: abcdefghjk\n---\n/);
  });
});

describe("a file the app makes", () => {
  it("is born with its id in its frontmatter and the index agrees", async () => {
    const name = await env.vault.create("Plan", "note", "# Plan\n");
    const id = frontId(readText(env.root, "Plan.md"));
    expect(validId(id)).toBe(true);
    expect(env.home.docByPath(env.vault.id, "Plan.md")).toMatchObject({ id, minted: 1, kind: "note" });
    expect((await env.vault.tree()).ids[name]).toBe(id);
  });
});

describe("an existing `.md` with no id", () => {
  it("opening writes nothing: tree, read, peekId and resolve leave every byte alone", async () => {
    write(env.root, "Plain note.md", "# Plain\n\nno frontmatter at all\n");
    write(env.root, "Titled.md", "---\ntitle: Titled\n---\nbody\n");
    const before = snapshot(env.root);
    const tree = await env.vault.tree();
    const id = tree.ids["Plain note"]!;
    expect(validId(id)).toBe(true);
    expect(await env.vault.peekId("Plain note", "note")).toBe(id);
    await env.vault.read("Plain note", "note");
    expect(await env.vault.resolve(id)).toEqual({ name: "Plain note", kind: "note" });
    await env.vault.tree();
    // No byte of the vault changed and no file appeared.
    expect(snapshot(env.root)).toEqual(before);
    expect(env.home.docById(env.vault.id, id)).toMatchObject({ minted: 0 });
  });

  it("keeps the same provisional id from one listing to the next", async () => {
    write(env.root, "a.md", "# a\n");
    const one = (await env.vault.tree()).ids.a;
    const two = (await env.vault.tree()).ids.a;
    expect(two).toBe(one);
  });

  it("is given its id in the file the first time something links to it by id", async () => {
    write(env.root, "target.md", "# Target\n");
    const id = (await env.vault.tree()).ids.target!;
    const src = await env.vault.create("source", "note", "# S\n");
    expect(readText(env.root, "target.md")).toBe("# Target\n");
    const cur = (await env.vault.read(src, "note"))!;
    await env.vault.write(src, "note", `${cur.text}[Target](dag:${id})\n`, cur.base);
    expect(frontId(readText(env.root, "target.md"))).toBe(id);
    expect(readText(env.root, "target.md")).toContain("# Target\n");
    expect(env.home.docById(env.vault.id, id)).toMatchObject({ minted: 1 });
  });

  it("an embed `![](dag:id)` mints the target as well, and a link already present does not rewrite it", async () => {
    write(env.root, "t.md", "# T\n");
    const id = (await env.vault.tree()).ids.t!;
    const name = await env.vault.create("s", "note", `# S\n\n![T](dag:${id})\n`);
    expect(frontId(readText(env.root, "t.md"))).toBe(id);
    const mtime = fs.statSync(path.join(env.root, "t.md")).mtimeMs;
    await sleep(15);
    const cur = (await env.vault.read(name, "note"))!;
    await env.vault.write(name, "note", cur.text + "more\n", cur.base);
    expect(fs.statSync(path.join(env.root, "t.md")).mtimeMs).toBe(mtime);
  });

  it("a link to an id nothing has is ignored", async () => {
    const before = snapshot(env.root);
    await env.vault.create("s", "note", "[x](dag:zzzzzzzzzz)\n");
    expect(Object.keys(snapshot(env.root)).length).toBe(Object.keys(before).length + 1); // s.md only
  });

  it("is given its id by ident(), explicitly", async () => {
    write(env.root, "a.md", "# a\n");
    const id = (await env.vault.tree()).ids.a;
    expect(await env.vault.ident("a", "note")).toBe(id);
    expect(frontId(readText(env.root, "a.md"))).toBe(id);
    expect(readText(env.root, "a.md")).toContain("# a\n");
  });

  it("ident of a document that is not there is null", async () => {
    expect(await env.vault.ident("nope", "note")).toBeNull();
    expect(await env.vault.peekId("nope", "note")).toBeNull();
  });

  // An id added during a `put` would change bytes the page sent, so an edit never writes one.
  it("is not given an id by an edit: what was typed is what is written", async () => {
    write(env.root, "a.md", "# a\n");
    const id = (await env.vault.tree()).ids.a;
    const cur = (await env.vault.read("a", "note"))!;
    expect(id).toBeTruthy();
    await env.vault.write("a", "note", cur.text + "edited\n", cur.base);
    expect(readText(env.root, "a.md")).toBe("# a\nedited\n");
    expect(frontId(readText(env.root, "a.md"))).toBeNull();
  });
});

/** Each text kind: its file's suffix, and a fresh whole body with no frontmatter at all. */
const KINDS = [
  { kind: "board", suffix: ".board.md", made: BOARD, fresh: "```md {#two}\nfresh\n```\n" },
  { kind: "note", suffix: ".md", made: NOTE, fresh: "# Fresh\n\nAnother paragraph.\n" },
  { kind: "quiz", suffix: ".quiz.md", made: QUIZ, fresh: "## Three? {#q3}\n- [x] y\n- [ ] n\n" },
  {
    kind: "table",
    suffix: ".table.md",
    made: TABLE,
    fresh: "## Deals {#deals}\n\n| Name {#name} |\n| --- |\n| Beta {#rbeta} |\n",
  },
] as const;

// #401: the id is the document. A rebuilt index reads it from the file, so a write that dropped it
// left every `dag:` reference naming nothing once the index was rebuilt, synced or copied.
describe("a whole-text write that omits `id:`", () => {
  for (const { kind, suffix, made, fresh } of KINDS) {
    it(`keeps a ${kind}'s id, which a rebuilt index still resolves`, async () => {
      const name = await env.vault.create("doc", kind, made);
      const file = `${name}${suffix}`;
      const id = frontId(readText(env.root, file));
      expect(validId(id)).toBe(true);
      await env.vault.create("source", "note", `[it](dag:${id})\n`);

      const cur = (await env.vault.read(name, kind))!;
      const after = await env.vault.write(name, kind, fresh, cur.base);
      expect(readText(env.root, file)).toBe(withId(fresh, id as string));
      expect(after).toEqual(await env.vault.read(name, kind));

      env = env.reopen({ freshHome: true });
      expect((await env.vault.tree()).ids[name]).toBe(id);
      expect(await env.vault.resolve(id as string)).toEqual({ name, kind });
    });
  }

  it("keeps it when the text has a frontmatter of its own, and keeps every other byte of that", async () => {
    const name = await env.vault.create("plan", "note", NOTE);
    const id = frontId(readText(env.root, "plan.md")) as string;
    const text = "---\ntitle: Renamed\ntags: [a]\n---\n# Renamed\n";
    await env.vault.write(name, "note", text, null);
    expect(readText(env.root, "plan.md")).toBe(`---\ntitle: Renamed\ntags: [a]\nid: ${id}\n---\n# Renamed\n`);
  });

  it("keeps it on a write with no base, which overwrites", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const id = frontId(readText(env.root, "plan.board.md"));
    await env.vault.write(name, "board", "```md {#x}\nx\n```\n");
    expect(frontId(readText(env.root, "plan.board.md"))).toBe(id);
  });

  it("writes a text that carries the id byte for byte, and the same text less its `id:` line changes nothing", async () => {
    const name = await env.vault.create("plan", "note", NOTE);
    const cur = (await env.vault.read(name, "note"))!;
    const text = `${cur.text}more\n`;
    const after = await env.vault.write(name, "note", text, cur.base);
    expect(after.text).toBe(text);
    const mtime = fs.statSync(path.join(env.root, "plan.md")).mtimeMs;
    await sleep(15);
    const again = await env.vault.write(name, "note", withId(text, null), after.base);
    expect(again).toEqual(after);
    expect(fs.statSync(path.join(env.root, "plan.md")).mtimeMs).toBe(mtime);
  });

  it("leaves a file with someone else's `id:` key as the writer gave it", async () => {
    write(env.root, "z.md", "---\nid: 202301011200\n---\n# Z\n");
    await env.vault.tree();
    await env.vault.write("z", "note", "# Z changed\n", null);
    expect(readText(env.root, "z.md")).toBe("# Z changed\n");
  });
});

describe("a file with an id the index has never seen", () => {
  it("is indexed under that id", async () => {
    write(env.root, "Imported.md", "---\nid: abcdefghjk\ntitle: Imported\n---\nbody\n");
    const tree = await env.vault.tree();
    expect(tree.ids.Imported).toBe("abcdefghjk");
    expect(env.home.docById(env.vault.id, "abcdefghjk")).toMatchObject({ path: "Imported.md", minted: 1 });
    expect(await env.vault.resolve("abcdefghjk")).toEqual({ name: "Imported", kind: "note" });
  });

  it("read() and ident() also see it without a full listing", async () => {
    write(env.root, "x.board.md", "---\nid: abcdefghjk\n---\n");
    expect(await env.vault.peekId("x")).toBe("abcdefghjk");
  });

  it("an `id:` that is some other plugin's key is neither adopted nor overwritten", async () => {
    const text = "---\nid: 202301011200\ntitle: Zettel\n---\nbody\n";
    write(env.root, "z.md", text);
    const tree = await env.vault.tree();
    expect(validId(tree.ids.z)).toBe(true);
    expect(tree.ids.z).not.toBe("202301011200");
    await env.vault.ident("z", "note");
    expect(readText(env.root, "z.md")).toBe(text);
  });
});

describe("two files with one id", () => {
  it("the older by created date keeps it and the copy is given a new one, written in", async () => {
    const name = await env.vault.create("original", "note", "# O\n");
    const id = (await env.vault.ident(name, "note"))!;
    await sleep(1100);
    // Sorts first, so a walk-order tie-break would give it the id.
    fs.copyFileSync(path.join(env.root, "original.md"), path.join(env.root, "a copy.md"));
    const fresh = env.reopen({ freshHome: true });
    env = fresh;
    const warn = console.warn;
    const logged: string[] = [];
    console.warn = (...a: unknown[]) => void logged.push(a.join(" "));
    let tree;
    try {
      tree = await env.vault.tree();
    } finally {
      console.warn = warn;
    }
    expect(tree.ids.original).toBe(id);
    expect(validId(tree.ids["a copy"])).toBe(true);
    expect(tree.ids["a copy"]).not.toBe(id);
    expect(frontId(readText(env.root, "a copy.md"))).toBe(tree.ids["a copy"]);
    expect(frontId(readText(env.root, "original.md"))).toBe(id);
    expect(logged.some((l) => l.includes("a copy.md"))).toBe(true);
    // Stable on the next listing, and each resolves to itself.
    const again = await env.vault.tree();
    expect(again.ids).toEqual(tree.ids);
    expect(await env.vault.resolve(id)).toEqual({ name: "original", kind: "note" });
  });

  it("the file the index already knew there keeps it, whichever sorts first", async () => {
    const name = await env.vault.create("zeta", "note", "# Z\n");
    const id = (await env.vault.ident(name, "note"))!;
    fs.copyFileSync(path.join(env.root, "zeta.md"), path.join(env.root, "alpha.md"));
    const tree = await env.vault.tree();
    expect(tree.ids.zeta).toBe(id);
    expect(tree.ids.alpha).not.toBe(id);
    expect(frontId(readText(env.root, "alpha.md"))).toBe(tree.ids.alpha);
  });

  it("a duplicate made through the app is a new document at once", async () => {
    const name = await env.vault.create("a", "board", BOARD);
    const copy = await env.vault.rename(name, "board", "a", { copy: true });
    expect(frontId(readText(env.root, "a.board.md"))).not.toBe(frontId(readText(env.root, `${copy}.board.md`)));
  });
});

describe("a file moved outside the app", () => {
  it("keeps its id when the id is in the file", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const id = (await env.vault.ident(name))!;
    fs.mkdirSync(path.join(env.root, "work"));
    fs.renameSync(path.join(env.root, "plan.board.md"), path.join(env.root, "work", "plan.board.md"));
    expect(await env.vault.resolve(id)).toEqual({ name: "work/plan", kind: "board" });
    expect((await env.vault.tree()).ids["work/plan"]).toBe(id);
    expect(env.home.docById(env.vault.id, id)!.path).toBe("work/plan.board.md");
  });

  it("keeps its created date", async () => {
    const name = await env.vault.create("plan", "board", BOARD, { created: "2020-01-02T03:04:05Z" });
    await env.vault.ident(name);
    fs.renameSync(path.join(env.root, "plan.board.md"), path.join(env.root, "Renamed Plan.board.md"));
    expect((await env.vault.tree()).created["Renamed Plan"]).toBe("2020-01-02T03:04:05Z");
  });

  it("a rename that only changes case in a file manager is the same document", async () => {
    const name = await env.vault.create("plan", "note", NOTE);
    const id = (await env.vault.ident(name, "note"))!;
    fs.renameSync(path.join(env.root, "plan.md"), path.join(env.root, "Plan.md"));
    const tree = await env.vault.tree();
    expect(tree.notes).toEqual(["Plan"]);
    expect(tree.ids.Plan).toBe(id);
  });
});

describe("the index and the files disagree", () => {
  it("the file wins and the index is corrected", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const id = (await env.vault.ident(name))!;
    env.home.sql("update docs set id = 'wrongwrong0' where id = ?").run(id);
    const tree = await env.vault.tree();
    expect(tree.ids.plan).toBe(id);
    expect(env.home.docById(env.vault.id, id)!.path).toBe("plan.board.md");
    expect(env.home.docById(env.vault.id, "wrongwrong0")).toBeUndefined();
  });

  it("a row for a file that is gone is dropped on the next listing", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const id = (await env.vault.ident(name))!;
    fs.unlinkSync(path.join(env.root, "plan.board.md"));
    await env.vault.tree();
    expect(env.home.docById(env.vault.id, id)).toBeUndefined();
  });

  it("a text that gained an id after being provisional takes it, at the same path", async () => {
    write(env.root, "a.md", "# a\n");
    await env.vault.tree();
    write(env.root, "a.md", "---\nid: abcdefghjk\n---\n# a\n");
    // Watched (`ANYDAG_TEST_WATCH`), a text written in place is listed once the watcher says so (#280).
    if (watchedFromTheStart) await until(async () => (await env.vault.tree()).ids.a === "abcdefghjk", 5000, "the id");
    expect((await env.vault.tree()).ids.a).toBe("abcdefghjk");
    expect(env.home.docs(env.vault.id)).toHaveLength(1);
  });
});

describe("SQLite deleted", () => {
  it("is rebuilt from every file's frontmatter and `.anydag/files/`", async () => {
    const board = await env.vault.create("plan", "board", BOARD, { created: "2020-01-02T03:04:05Z" });
    const note = await env.vault.create("work/n", "note", NOTE);
    const file = await env.vault.putFile("specs/q3.pdf", PDF, "Q3 Report");
    const before = await env.vault.tree();
    env = env.reopen({ freshHome: true });
    expect(env.home.docs(env.vault.id)).toEqual([]);
    const after = await env.vault.tree();
    expect(after.ids).toEqual(before.ids);
    expect(after.titles).toEqual(before.titles);
    expect(after.titles[file]).toBe("Q3 Report");
    expect(await env.vault.resolve(before.ids[board]!)).toEqual({ name: "plan", kind: "board" });
    expect(await env.vault.resolve(before.ids[note]!)).toEqual({ name: "work/n", kind: "note" });
    expect(await env.vault.resolve(before.ids[file]!)).toEqual({ name: "specs/q3.pdf", kind: "file" });
  });

  it("falls back to the file's birth or modification time for created", async () => {
    const name = await env.vault.create("plan", "board", BOARD, { created: "2001-01-01T00:00:00Z" });
    const file = path.join(env.root, "plan.board.md");
    const st = fs.statSync(file);
    env = env.reopen({ freshHome: true });
    const created = (await env.vault.tree()).created[name]!;
    expect(created).not.toBe("2001-01-01T00:00:00Z");
    const stamp = Date.parse(created);
    const expected = st.birthtimeMs || st.mtimeMs;
    expect(Math.abs(stamp - expected)).toBeLessThan(2000);
  });

  it("a text with no id of its own gets a different provisional id (nothing was ever written)", async () => {
    write(env.root, "a.md", "# a\n");
    const first = (await env.vault.tree()).ids.a;
    env = env.reopen({ freshHome: true });
    const second = (await env.vault.tree()).ids.a;
    expect(validId(second)).toBe(true);
    expect(second).not.toBe(first);
    expect(readText(env.root, "a.md")).toBe("# a\n");
  });
});

describe("an attachment", () => {
  it("keeps `{path, title}` in `.anydag/files/<id>.json`, written as it is made", async () => {
    const name = await env.vault.putFile("q3.pdf", PDF, "Q3");
    const id = (await env.vault.tree()).ids[name]!;
    expect(JSON.parse(readText(env.root, `.anydag/files/${id}.json`))).toEqual({ path: "q3.pdf", title: "Q3" });
  });

  it("a file copied in by hand has no record until something mints it", async () => {
    write(env.root, "scan.pdf", "%PDF");
    const id = (await env.vault.tree()).ids["scan.pdf"]!;
    expect(fs.existsSync(path.join(env.root, ".anydag", "files", `${id}.json`))).toBe(false);
    expect(await env.vault.ident("scan.pdf", "file")).toBe(id);
    expect(JSON.parse(readText(env.root, `.anydag/files/${id}.json`))).toEqual({ path: "scan.pdf" });
  });

  it("moved outside the app is matched by path when the record names the new path", async () => {
    const name = await env.vault.putFile("q3.pdf", PDF, "Q3");
    const id = (await env.vault.ident(name, "file"))!;
    fs.mkdirSync(path.join(env.root, "work"));
    fs.renameSync(path.join(env.root, "q3.pdf"), path.join(env.root, "work", "q3.pdf"));
    fs.writeFileSync(path.join(env.root, ".anydag", "files", `${id}.json`), JSON.stringify({ path: "work/q3.pdf", title: "Q3" }));
    const tree = await env.vault.tree();
    expect(tree.ids["work/q3.pdf"]).toBe(id);
    expect(tree.titles["work/q3.pdf"]).toBe("Q3");
  });

  it("moved outside the app with the record left behind is matched by size and sha1", async () => {
    const name = await env.vault.putFile("q3.pdf", PDF, "Q3");
    const id = (await env.vault.ident(name, "file"))!;
    fs.mkdirSync(path.join(env.root, "work"));
    fs.renameSync(path.join(env.root, "q3.pdf"), path.join(env.root, "work", "q3.pdf"));
    const tree = await env.vault.tree();
    expect(tree.ids["work/q3.pdf"]).toBe(id);
    expect(tree.titles["work/q3.pdf"]).toBe("Q3");
  });

  // Watched (`ANYDAG_TEST_WATCH`), a record written in place is read once the watcher says so — `kept.test.ts`.
  it.skipIf(watchedFromTheStart)("a record that is not JSON is skipped and read again next time", async () => {
    write(env.root, "scan.pdf", "%PDF");
    write(env.root, ".anydag/files/abcdefghjk.json", "{ half");
    const tree = await env.vault.tree();
    expect(tree.ids["scan.pdf"]).not.toBe("abcdefghjk");
    fs.writeFileSync(
      path.join(env.root, ".anydag", "files", "abcdefghjk.json"),
      JSON.stringify({ path: "scan.pdf", title: "Scan" }),
    );
    const again = await env.vault.tree();
    expect(again.ids["scan.pdf"]).toBe("abcdefghjk");
    expect(again.titles["scan.pdf"]).toBe("Scan");
  });

  it("two records for one path leave the id with one of them", async () => {
    write(env.root, "scan.pdf", "%PDF");
    write(env.root, ".anydag/files/abcdefghjk.json", JSON.stringify({ path: "scan.pdf" }));
    write(env.root, ".anydag/files/bcdefghjkm.json", JSON.stringify({ path: "scan.pdf" }));
    const tree = await env.vault.tree();
    expect(["abcdefghjk", "bcdefghjkm"]).toContain(tree.ids["scan.pdf"]);
  });
});
