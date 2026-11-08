import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashOf, record, undo, type Image, type Op } from "../../server/chat/record";

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

/** Every file and folder under `dir`, with what each file holds: a fingerprint of a tree. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (abs: string, rel: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const sub = path.join(abs, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) out[r] = `-> ${fs.readlinkSync(sub)}`;
      else if (e.isDirectory()) {
        out[r] = "dir";
        walk(sub, r);
      } else out[r] = fs.readFileSync(sub, "utf8");
    }
  };
  walk(dir, "");
  return out;
}

describe("undo, on an op somebody else wrote into the vault", () => {
  const b64 = (text: string) => Buffer.from(text).toString("base64");
  /** `outside`, as a path from somewhere inside the vault. */
  const out = (from: string, name: string) => path.relative(path.join(root, from), path.join(outside, name));
  const planted = (...images: Image[]): Op => ({
    what: "POST /__board/patch",
    vault: "v1",
    at: "2026-11-07T00:00:00.000Z",
    images,
    undoable: true,
  });

  beforeEach(() => {
    fs.writeFileSync(path.join(outside, "id_ed25519"), "PRIVATE-KEY-DUMMY\n");
    fs.writeFileSync(path.join(outside, "keepme.txt"), "keep me\n");
    writeAtomic("notes/a.md", "mine");
  });

  const cases: [string, () => Image][] = [
    [
      "a path that climbs out",
      () => ({ rel: out("", "planted.sh"), before: { t: "file", b64: b64("echo planted\n") }, after: "-" }),
    ],
    [
      "an absolute path",
      () => ({ rel: path.join(outside, "planted.sh"), before: { t: "file", b64: b64("echo planted\n") }, after: "-" }),
    ],
    [
      "a deletion of an outside file whose hash is known",
      () => ({ rel: out("", "keepme.txt"), before: { t: "absent" }, after: hashOf(path.join(outside, "keepme.txt")) }),
    ],
    [
      "a folder's file that climbs out",
      () => ({
        rel: "notes-old",
        before: { t: "dir", dirs: [], files: { [out("notes-old", "autostart.desktop")]: b64("[Desktop Entry]\n") } },
        after: "-",
      }),
    ],
    [
      "a folder's file given as an absolute path",
      () => ({
        rel: "notes-old",
        before: { t: "dir", dirs: [], files: { [path.join(outside, "abs.desktop")]: b64("x") } },
        after: "-",
      }),
    ],
    [
      "a folder's subfolder that climbs out",
      () => ({ rel: "notes-old", before: { t: "dir", dirs: [out("notes-old", "made")], files: {} }, after: "-" }),
    ],
    [
      "a folder moved in from outside",
      () => ({ rel: "attachments/notes.txt", before: { t: "moved", to: out("", "id_ed25519") }, after: "-" }),
    ],
    [
      "a folder moved in from an absolute path",
      () => ({ rel: "attachments/notes.txt", before: { t: "moved", to: path.join(outside, "id_ed25519") }, after: "-" }),
    ],
    ["the chat's own record", () => ({ rel: ".anydag/chats/c1/t1.json", before: { t: "file", b64: b64("{}") }, after: "-" })],
    ["a writer's temp file", () => ({ rel: "notes/.a.md.123.tmp", before: { t: "file", b64: b64("x") }, after: "-" })],
    [
      "a path with a NUL in it",
      () => ({ rel: "notes/a.md\0../../x", before: { t: "absent" }, after: hashOf(path.join(root, "notes/a.md")) }),
    ],
    ["an empty path", () => ({ rel: "", before: { t: "absent" }, after: "-" })],
    ["a path that is not a string", () => ({ rel: 7 as unknown as string, before: { t: "absent" }, after: "-" })],
  ];

  for (const [name, image] of cases) {
    it(`refuses ${name}, and changes nothing anywhere`, async () => {
      const outsideBefore = tree(outside);
      const vaultBefore = tree(root);
      const u = await undo([planted(image())], roots);
      expect(u.conflicts).toHaveLength(1);
      expect(u.conflicts[0]!.why).toBe("refused");
      expect(u.ops).toEqual([]);
      expect(tree(outside)).toEqual(outsideBefore);
      expect(tree(root)).toEqual(vaultBefore);
    });
  }

  it("checks every image before restoring any: a good one beside a bad one is left alone too", async () => {
    const made = await op(() => writeAtomic("notes/a.md", "the agent's"));
    const bad = planted(...made.images, { rel: out("", "planted.sh"), before: { t: "file", b64: b64("x") }, after: "-" });
    const outsideBefore = tree(outside);
    const u = await undo([bad], roots);
    expect(u.conflicts.map((c) => c.why)).toEqual(["refused"]);
    expect(read("notes/a.md")).toBe("the agent's");
    expect(tree(outside)).toEqual(outsideBefore);
    // The same op without the planted image is undone as ever.
    expect((await undo([made], roots)).conflicts).toEqual([]);
    expect(read("notes/a.md")).toBe("mine");
  });

  it("refuses a path through a link in the vault to a folder outside it", async () => {
    fs.symlinkSync(outside, path.join(root, "link"));
    const outsideBefore = tree(outside);
    const u = await undo([planted({ rel: "link/planted.sh", before: { t: "file", b64: b64("x") }, after: "-" })], roots);
    expect(u.conflicts[0]?.why).toBe("refused");
    expect(tree(outside)).toEqual(outsideBefore);
  });

  it("refuses a vault the ops' owner does not reach", async () => {
    const made = await op(() => writeAtomic("notes/a.md", "the agent's"));
    const u = await undo([made], roots, () => false);
    expect(u.conflicts[0]?.why).toBe("refused");
    expect(read("notes/a.md")).toBe("the agent's");
  });

  it("never restores a big image, whatever the op says of itself", async () => {
    const vaultBefore = tree(root);
    const u = await undo(
      [planted({ rel: "notes/a.md", before: { t: "big", size: 1e9 }, after: hashOf(path.join(root, "notes/a.md")) })],
      roots,
    );
    expect(u.conflicts[0]?.why).toBe("big");
    expect(tree(root)).toEqual(vaultBefore);
  });

  it("refuses an op that is not one at all", async () => {
    const u = await undo([null as unknown as Op, { ...planted(), images: "x" } as unknown as Op], roots);
    expect(u.conflicts.map((c) => c.why)).toEqual(["refused", "refused"]);
  });
});
