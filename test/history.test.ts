import { describe, expect, it } from "vitest";

import { History, LIMIT } from "@/edit/history";

/**
 * Undo as versions of the file.
 *
 * The stack is small and its rules are few, but every one of them is about the file having a
 * second writer: an entry that no longer matches what is on disk must not be applied, because the
 * text it would put back predates something Claude wrote.
 */

const v = (text: string) => ({ text, base: `sha:${text}` });

describe("History", () => {
  it("undoes and redoes in order", () => {
    const h = new History();
    h.push(v("a"), v("b"));
    h.push(v("b"), v("c"));
    expect(h.canUndo).toBe(true);
    expect(h.undo("sha:c")).toBe("b");
    expect(h.undo("sha:b")).toBe("a");
    expect(h.undo("sha:a")).toBeNull();
    expect(h.redo("sha:a")).toBe("b");
    expect(h.redo("sha:b")).toBe("c");
    expect(h.canRedo).toBe(false);
  });

  it("refuses to restore over a file that moved, and forgets what it knew", () => {
    const h = new History();
    h.push(v("a"), v("b"));
    /* Claude wrote `z` after the edit: the file is not at `b` any more. */
    expect(h.undo("sha:z")).toBeNull();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it("coalesces a run of writes under one key into one entry", () => {
    const h = new History();
    h.push(v("a"), v("ab"), "body:x");
    h.push(v("ab"), v("abc"), "body:x");
    h.push(v("abc"), v("abcd"), "body:x");
    expect(h.undo("sha:abcd")).toBe("a");
    expect(h.redo("sha:a")).toBe("abcd");
  });

  it("starts a new entry after a seal, or under a different key", () => {
    const h = new History();
    h.push(v("a"), v("ab"), "body:x");
    h.seal();
    h.push(v("ab"), v("abc"), "body:x");
    h.push(v("abc"), v("abcd"), "body:y");
    expect(h.undo("sha:abcd")).toBe("abc");
    expect(h.undo("sha:abc")).toBe("ab");
    expect(h.undo("sha:ab")).toBe("a");
  });

  it("does not coalesce across a gap another writer left", () => {
    const h = new History();
    h.push(v("a"), v("ab"), "body:x");
    /* Something else took the file from `ab` to `Xab` in between. */
    h.push(v("Xab"), v("Xabc"), "body:x");
    expect(h.undo("sha:Xabc")).toBe("Xab");
  });

  it("drops the redo side on a new edit, and ignores a write that changed nothing", () => {
    const h = new History();
    h.push(v("a"), v("b"));
    h.undo("sha:b");
    expect(h.canRedo).toBe(true);
    h.push(v("a"), v("a"));
    expect(h.canRedo).toBe(true);
    h.push(v("a"), v("c"));
    expect(h.canRedo).toBe(false);
  });

  it("keeps only the last hundred", () => {
    const h = new History();
    for (let i = 0; i < LIMIT + 10; i++) h.push(v(String(i)), v(String(i + 1)));
    let n = 0;
    let at = String(LIMIT + 10);
    for (;;) {
      const t = h.undo(`sha:${at}`);
      if (t === null) break;
      at = t;
      n++;
    }
    expect(n).toBe(LIMIT);
  });
});
