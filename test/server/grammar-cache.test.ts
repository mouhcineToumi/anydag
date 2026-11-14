import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Parsed } from "../../server/grammar";
import type { Entry } from "../../server/parsing";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-parsed-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** The texts as files, and the entries naming them: each a board, `<key>.board.md`. */
function put(texts: Record<string, string>): Entry[] {
  for (const [k, t] of Object.entries(texts)) fs.writeFileSync(path.join(root, `${k}.board.md`), t);
  return Object.keys(texts).map((k) => [k, k, "board"]);
}

describe("Parsed", () => {
  it("parses only what changed, and moves its generation only then", async () => {
    const asked: string[][] = [];
    const parsed = new Parsed("index", root, (texts) => {
      asked.push(Object.keys(texts).sort());
      return Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, { length: t.length }]));
    });
    await parsed.of(put({ a: "one", b: "two" }));
    const g = parsed.generation;
    expect((await parsed.of(put({ a: "one", b: "two" }))).get("b")).toEqual({ length: 3 });
    expect(parsed.generation).toBe(g);
    expect((await parsed.of(put({ a: "one", b: "three" }))).get("b")).toEqual({ length: 5 });
    expect(parsed.generation).toBe(g + 1);
    // A text gone is a change too.
    fs.rmSync(path.join(root, "b.board.md"));
    const now = await parsed.of([
      ["a", "a", "board"],
      ["b", "b", "board"],
    ]);
    expect([...now.keys()]).toEqual(["a"]);
    expect(parsed.generation).toBe(g + 2);
    // `a` was written again with the same text: read, and not parsed.
    expect(asked).toEqual([["a", "b"], ["b"]]);
  });

  it("reads a text again only when its stat moved, so a save of the same size is still seen", async () => {
    const parsed = new Parsed("index", root, (texts) => Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, { t }])));
    const entries = put({ a: "abc" });
    expect((await parsed.of(entries)).get("a")).toEqual({ t: "abc" });
    const file = path.join(root, "a.board.md");
    const { mtime } = fs.statSync(file);
    fs.writeFileSync(file, "xyz");
    // The same size and the same modified time: the change time and the inode still say it moved.
    fs.utimesSync(file, mtime, mtime);
    expect((await parsed.of(entries)).get("a")).toEqual({ t: "xyz" });
  });

  it("takes two cold asks one after the other, so the second parses nothing", async () => {
    let calls = 0;
    const parsed = new Parsed("index", root, (texts) => {
      calls++;
      return Object.fromEntries(Object.keys(texts).map((k) => [k, {}]));
    });
    const entries = put({ a: "x", b: "y" });
    await Promise.all([parsed.of(entries), parsed.of(entries)]);
    expect(calls).toBe(1);
  });

  it("does not read a link, nor a file through a folder that leads out of the vault", async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-elsewhere-"));
    try {
      fs.writeFileSync(path.join(elsewhere, "secret.board.md"), "secret");
      fs.symlinkSync(path.join(elsewhere, "secret.board.md"), path.join(root, "link.board.md"));
      fs.symlinkSync(elsewhere, path.join(root, "out"));
      const parsed = new Parsed("index", root, (texts) => Object.fromEntries(Object.keys(texts).map((k) => [k, {}])));
      const got = await parsed.of([
        ...put({ here: "here" }),
        ["link", "link", "board"],
        ["out/secret", "out/secret", "board"],
        ["../escape", "../escape", "board"],
      ]);
      expect([...got.keys()]).toEqual(["here"]);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
