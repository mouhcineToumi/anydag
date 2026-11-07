import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { record, undo, type Op } from "../../server/chat/record";

let root: string;
let outside: string;
const vault = () => ({ id: "v1", root });
const roots = (id: string) => (id === "v1" ? root : null);
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const has = (rel: string) => fs.existsSync(path.join(root, rel));

/** Write the way the vault does: a temp file beside the target, then a rename. */
function writeAtomic(rel: string, text: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, abs);
}

async function op(fn: () => void): Promise<Op> {
  const { op } = await record(vault(), "POST /test", async () => fn());
  expect(op).not.toBeNull();
  return op!;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-record-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "chat-outside-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("the change recorder", () => {
  it("takes back a file it made, and a redo makes it again", async () => {
    const made = await op(() => writeAtomic("notes/a.md", "hello"));
    expect(made.images.map((i) => i.rel)).toEqual(["notes", "notes/a.md"]);
    const u = await undo([made], roots);
    expect(u.conflicts).toEqual([]);
    expect(has("notes")).toBe(false);
    const r = await undo(u.ops, roots);
    expect(r.conflicts).toEqual([]);
    expect(read("notes/a.md")).toBe("hello");
  });

  it("puts an edited file back as it was", async () => {
    writeAtomic("a.md", "one");
    const made = await op(() => writeAtomic("a.md", "two"));
    expect((await undo([made], roots)).conflicts).toEqual([]);
    expect(read("a.md")).toBe("one");
  });

  it("leaves a file changed since alone, and says so", async () => {
    writeAtomic("a.md", "one");
    const made = await op(() => writeAtomic("a.md", "two"));
    writeAtomic("a.md", "three");
    const u = await undo([made], roots);
    expect(u.conflicts).toEqual([{ what: "POST /test", vault: "v1", paths: ["a.md"], why: "changed" }]);
    expect(read("a.md")).toBe("three");
  });

  it("follows a folder that was renamed, and brings it back", async () => {
    writeAtomic("old/x.md", "x");
    writeAtomic("old/sub/y.md", "y");
    const made = await op(() => fs.renameSync(path.join(root, "old"), path.join(root, "new")));
    expect(made.images.find((i) => i.rel === "old")?.before).toEqual({ t: "moved", to: "new" });
    expect((await undo([made], roots)).conflicts).toEqual([]);
    expect(read("old/sub/y.md")).toBe("y");
    expect(has("new")).toBe(false);
  });

  it("brings back a folder deleted with everything in it", async () => {
    writeAtomic("gone/x.md", "x");
    fs.mkdirSync(path.join(root, "gone/empty"));
    const made = await op(() => fs.rmSync(path.join(root, "gone"), { recursive: true, force: true }));
    await undo([made], roots);
    expect(read("gone/x.md")).toBe("x");
    expect(fs.statSync(path.join(root, "gone/empty")).isDirectory()).toBe(true);
  });

  it("undoes several ops newest first", async () => {
    const a = await op(() => writeAtomic("a.md", "1"));
    const b = await op(() => writeAtomic("a.md", "2"));
    expect((await undo([a, b], roots)).conflicts).toEqual([]);
    expect(has("a.md")).toBe(false);
  });

  it("ignores what is outside the vault and the chat's own record", async () => {
    fs.mkdirSync(path.join(root, ".anydag"));
    const { op: none } = await record(vault(), "POST /test", async () => {
      fs.writeFileSync(path.join(outside, "x"), "x");
      fs.mkdirSync(path.join(root, ".anydag/chats/c1"), { recursive: true });
      fs.writeFileSync(path.join(root, ".anydag/chats/c1/chat.json"), "{}");
    });
    expect(none).toBeNull();
  });

  it("records nothing outside a recording", async () => {
    writeAtomic("free.md", "x");
    const made = await op(() => writeAtomic("a.md", "1"));
    expect(made.images.map((i) => i.rel)).toEqual(["a.md"]);
  });

  it("refuses a vault that is not open", async () => {
    const made = await op(() => writeAtomic("a.md", "1"));
    const u = await undo([made], () => null);
    expect(u.conflicts[0]?.why).toBe("closed");
    expect(read("a.md")).toBe("1");
  });
});
