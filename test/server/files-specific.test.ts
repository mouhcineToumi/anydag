/** Ported from the hosted api's `test_files_specific.py`: what only a folder of plain files can be asked. */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_TYPES } from "../../server/uploads";
import { frontId, validId } from "../../server/ids";
import { BOARD, NOTE, PDF, has, makeEnv, readText, sweepTemps, write, type Env } from "./helpers";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

describe("writes", () => {
  it("an unchanged write does not touch the file", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const cur = (await env.vault.read(name))!;
    const file = path.join(env.root, "plan.board.md");
    const old = new Date(1_600_000_000_000);
    fs.utimesSync(file, old, old);
    const before = fs.statSync(file);
    await env.vault.write(name, "board", cur.text, cur.base);
    const after = fs.statSync(file);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ino).toBe(before.ino);
  });

  it("a write leaves no temp file behind", async () => {
    await env.vault.create("plan", "board", BOARD);
    await env.vault.write("plan", "board", BOARD + "more\n", null);
    await env.vault.putFile("a.pdf", PDF, null);
    await env.vault.rename("plan", "board", "work/plan");
    expect(fs.readdirSync(env.root, { recursive: true }).map(String).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("is one vault, one folder: nothing leaks to a sibling folder and no owner directory is made", async () => {
    await env.vault.create("plan", "board", BOARD);
    expect(fs.readdirSync(env.root).sort()).toEqual([".anydag", "plan.board.md"]);
    expect(fs.readdirSync(path.join(env.root, ".anydag"))).toEqual(["vault.json"]);
  });

  it("opening a folder as a vault writes only `.anydag/vault.json`, and its id survives a reopen", () => {
    const id = env.vault.id;
    expect(validId(id)).toBe(true);
    const again = env.reopen();
    env = again;
    expect(env.vault.id).toBe(id);
  });
});

describe("a file listed off the disk", () => {
  it("a board written by hand is listed with an id that resolves", async () => {
    write(env.root, "hand.board.md", BOARD);
    const tree = await env.vault.tree();
    expect(await env.vault.resolve(tree.ids.hand!)).toEqual({ name: "hand", kind: "board" });
  });

  it("a board deleted by hand disappears from the listing and from resolve", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const ident = (await env.vault.ident(name))!;
    fs.unlinkSync(path.join(env.root, "plan.board.md"));
    expect(await env.vault.resolve(ident)).toBeNull();
    expect((await env.vault.tree()).boards).toEqual([]);
  });

  it("a note written by hand is dated by its file", async () => {
    const file = write(env.root, "hand.note.md", "# Hand\n");
    fs.utimesSync(file, 1_600_000_000, 1_600_000_000);
    const first = (await env.vault.tree()).created.hand!;
    // Linux gives a birth time, and it is the moment the test wrote the file; otherwise it is the mtime.
    expect(first).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    write(env.root, "hand.note.md", "# Hand, edited\n");
    expect((await env.vault.tree()).created.hand).toBe(first);
  });

  it("a created date is kept in the index and read back after the file is edited", async () => {
    const name = await env.vault.create("n", "note", NOTE, { created: "2020-01-02T03:04:05Z" });
    write(env.root, "n.md", NOTE + "edited\n");
    expect((await env.vault.tree()).created[name]).toBe("2020-01-02T03:04:05Z");
  });

  it("a note moved by hand keeps its date", async () => {
    const name = await env.vault.create("n", "note", NOTE, { created: "2020-01-02T03:04:05Z" });
    fs.mkdirSync(path.join(env.root, "work"));
    fs.renameSync(path.join(env.root, `${name}.md`), path.join(env.root, "work", "n.md"));
    expect((await env.vault.tree()).created["work/n"]).toBe("2020-01-02T03:04:05Z");
  });
});

describe("attachments on disk", () => {
  it("a file copied in by hand is listed, with its case and spaces, and a temp file is not", async () => {
    write(env.root, "specs/q3.pdf", "%PDF");
    write(env.root, "Report Final.PDF", "%PDF");
    write(env.root, ".q3.pdf.1.tmp", "%PDF");
    write(env.root, ".hidden/secret.pdf", "%PDF");
    const tree = await env.vault.tree();
    expect(tree.files).toEqual(["Report Final.PDF", "specs/q3.pdf"]);
    expect(await env.vault.resolve(tree.ids["specs/q3.pdf"]!)).toEqual({ name: "specs/q3.pdf", kind: "file" });
    expect(tree.sizes["specs/q3.pdf"]).toBe(4);
    expect(tree.titles["Report Final.PDF"]).toBe("Report Final.PDF");
    // Opening writes nothing: no id record yet.
    expect(has(env.root, ".anydag/files")).toBe(false);
  });

  it("a page or a script left in a folder is not an attachment unless the vault takes the type", async () => {
    for (const leaf of ["memo.html", "build.py", "q3.pdf"]) write(env.root, leaf, "x");
    expect((await env.vault.tree()).files).toEqual(["q3.pdf"]);
    expect(await env.vault.getFile("memo.html")).toBeNull();
    const widened = makeEnv({ types: [...DEFAULT_TYPES, "html"] });
    try {
      for (const leaf of ["memo.html", "build.py", "q3.pdf"]) write(widened.root, leaf, "x");
      expect((await widened.vault.tree()).files).toEqual(["memo.html", "q3.pdf"]);
    } finally {
      await widened.cleanup();
    }
  });

  it("a file moved by hand keeps its id and title when the id record's path is updated", async () => {
    const name = await env.vault.putFile("q3.pdf", Buffer.from("%PDF-bytes"), "Q3.pdf");
    const ident = await env.vault.ident(name, "file");
    fs.mkdirSync(path.join(env.root, "work"));
    fs.renameSync(path.join(env.root, "q3.pdf"), path.join(env.root, "work", "q3.pdf"));
    const rec = path.join(env.root, ".anydag", "files", `${ident}.json`);
    fs.writeFileSync(rec, JSON.stringify({ path: "work/q3.pdf", title: "Q3.pdf" }));
    const tree = await env.vault.tree();
    expect(tree.ids["work/q3.pdf"]).toBe(ident);
    expect(tree.titles["work/q3.pdf"]).toBe("Q3.pdf");
  });

  it("a file moved by hand without touching the record keeps its id and title (matched by size and sha1)", async () => {
    const name = await env.vault.putFile("q3.pdf", Buffer.from("%PDF-bytes"), "Q3.pdf");
    const ident = await env.vault.ident(name, "file");
    fs.mkdirSync(path.join(env.root, "work"));
    fs.renameSync(path.join(env.root, "q3.pdf"), path.join(env.root, "work", "q3.pdf"));
    const tree = await env.vault.tree();
    expect(tree.ids["work/q3.pdf"]).toBe(ident);
    expect(tree.titles["work/q3.pdf"]).toBe("Q3.pdf");
  });

  it("an image a board pasted is not an attachment", async () => {
    await env.vault.create("plan", "board", BOARD);
    write(env.root, "plan.assets/paste-1.png", "png");
    expect((await env.vault.tree()).files).toEqual([]);
  });

  it("an id record is one small file of `{path, title}`", async () => {
    const name = await env.vault.putFile("q3.pdf", PDF, "Q3");
    const ident = (await env.vault.ident(name, "file"))!;
    expect(JSON.parse(readText(env.root, `.anydag/files/${ident}.json`))).toEqual({ path: "q3.pdf", title: "Q3" });
  });
});

describe("a file gone between the listing and the read", () => {
  it("is not a crash", async () => {
    await env.vault.create("plan", "board", BOARD);
    const tree = await env.vault.tree();
    fs.unlinkSync(path.join(env.root, "plan.board.md"));
    expect(await env.vault.texts(tree)).toEqual({});
    expect(await env.vault.read("plan")).toBeNull();
    expect(frontId(BOARD)).toBeNull();
  });
});
