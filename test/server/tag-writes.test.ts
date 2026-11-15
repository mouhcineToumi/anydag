/**
 * Changing tags (#327): one document's through `/tags/apply`, a tag across the vault through
 * `/tags/rename` and `/tags/delete` — `{files, missed}`, nothing rolled back, a retry that finishes —
 * and a tag's colour through `/tags/color`, every change to `.anydag/tags.json` a compare-and-set.
 */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { changeTags, renamedIn, setHue } from "../../server/tags";
import { Conflict } from "../../server/vault";
import { defaultHue } from "../../src/note/tags";
import { makeEnv, readText, sweepTemps, write, type Env } from "./helpers";

let env: Env;
let session: Session;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  env = makeEnv();
  session = new Session(env.home, env.vault, "test");
  app = createApp({ session, token: "t", page: null });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await env.cleanup();
  sweepTemps();
});

const headers = { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1" };
const url = (at: string) => `http://127.0.0.1${at}${at.includes("?") ? "&" : "?"}vault=${env.vault.id}`;
const get = async (at: string) => (await app.request(url(at), { headers })).json() as Promise<any>;
const post = (at: string, body: unknown) => app.request(url(at), { method: "POST", headers, body: JSON.stringify(body) });
const postJson = async (at: string, body: unknown) => {
  const res = await post(at, body);
  return { status: res.status, body: (await res.json()) as any };
};
const tagsFile = (): Record<string, unknown> | null => {
  const at = path.join(env.root, ".anydag", "tags.json");
  return fs.existsSync(at) ? (JSON.parse(fs.readFileSync(at, "utf8")) as Record<string, unknown>) : null;
};

describe("POST /__board/tags/apply", () => {
  it("adds and removes a note's tags, and touches no other byte", async () => {
    write(env.root, "plan.md", "---\ntitle: Plan\ntags: [a, b]\n---\nbody\n");
    const { status, body } = await postJson("/__board/tags/apply", { name: "plan", kind: "note", add: ["c"], remove: ["A"] });
    expect(status).toBe(200);
    expect(body.tags).toEqual(["b", "c"]);
    expect(readText(env.root, "plan.md")).toMatch(/^---\ntitle: Plan\ntags: \[b, c\]\n(id: \w+\n)?---\nbody\n$/);
  });

  it("writes a board, a quiz and a table, a board's new frontmatter followed by a blank line", async () => {
    write(env.root, "arch.board.md", "```md {#one}\nhi\n```\n");
    write(env.root, "drill.quiz.md", "---\ntitle: Drill\n---\n\n## One? {#q1}\n- [x] y\n- [ ] n\n");
    write(
      env.root,
      "deals.table.md",
      "---\ntitle: Deals\n---\n\n## Deals {#deals}\n\n| Name {#name} |\n| --- |\n| Acme {#racme} |\n",
    );
    for (const [name, kind] of [
      ["arch", "board"],
      ["drill", "quiz"],
      ["deals", "table"],
    ])
      expect((await postJson("/__board/tags/apply", { name, kind, add: ["design"] })).body.tags).toEqual(["design"]);
    expect(readText(env.root, "arch.board.md")).toMatch(/^---\ntags: \[design\]\n(id: \w+\n)?---\n\n```md \{#one\}/);
    expect((await get("/__board/list")).tags).toEqual({ arch: ["design"], drill: ["design"], deals: ["design"] });
  });

  it("creates a tag the vault has never seen — registered with the hue given, or its default — and no other", async () => {
    write(env.root, "plan.md", "---\ntags: [meeting]\n---\n");
    write(env.root, "other.md", "# other\n");
    const one = await postJson("/__board/tags/apply", { name: "other", kind: "note", add: ["meeting"] });
    expect(one.body.created).toEqual([]);
    expect(tagsFile()).toBeNull();
    const two = await postJson("/__board/tags/apply", { name: "other", kind: "note", add: ["roadmap", "ops"], hue: "spruce" });
    expect(two.body.created).toEqual(["roadmap", "ops"]);
    expect(tagsFile()).toEqual({ roadmap: { hue: "spruce" }, ops: { hue: "spruce" } });
    await postJson("/__board/tags/apply", { name: "plan", kind: "note", add: ["design"] });
    expect(tagsFile()).toMatchObject({ design: { hue: defaultHue("design") } });
  });

  it("refuses what is not a tag, a hue no theme has, and a body that asks for nothing", async () => {
    write(env.root, "plan.md", "# plan\n");
    expect((await post("/__board/tags/apply", { name: "plan", kind: "note", add: ["2026"] })).status).toBe(400);
    expect((await post("/__board/tags/apply", { name: "plan", kind: "note", add: ["a"], hue: "pink" })).status).toBe(400);
    expect((await post("/__board/tags/apply", { name: "plan", kind: "note" })).status).toBe(400);
    expect((await post("/__board/tags/apply", { name: "nope", kind: "note", add: ["a"] })).status).toBe(404);
  });
});

describe("POST /__board/tags/rename", () => {
  it("renames a tag in every document, templates included, and moves its colour", async () => {
    write(env.root, "a.md", "---\ntags: [old, x]\n---\n");
    write(env.root, "b.board.md", "---\ntags:\n- old\n---\n\n```md {#one}\nhi\n```\n");
    write(env.root, "Templates/T.md", "---\ntags: [old]\n---\n# {{title}}\n");
    write(env.root, "c.md", "---\ntags: [x]\n---\n");
    write(env.root, ".anydag/tags.json", JSON.stringify({ old: { hue: "coral" } }));
    const { body } = await postJson("/__board/tags/rename", { from: "old", to: "new" });
    expect(body.merged).toBe(false);
    expect(body.missed).toEqual([]);
    expect(body.files.map((f: any) => f.name).sort()).toEqual(["Templates/T", "a", "b"]);
    expect(readText(env.root, "a.md")).toContain("tags: [x, new]");
    expect(readText(env.root, "b.board.md")).toContain("tags:\n- new\n");
    expect(readText(env.root, "Templates/T.md")).toContain("tags: [new]");
    expect(tagsFile()).toEqual({ new: { hue: "coral" } });
  });

  it("merges into a tag that exists: one entry each, and the target keeps its colour", async () => {
    write(env.root, "a.md", "---\ntags: [old, pricing]\n---\n");
    write(env.root, "b.md", "---\ntags: [old]\n---\n");
    write(env.root, ".anydag/tags.json", JSON.stringify({ old: { hue: "coral" }, pricing: { hue: "moss" } }));
    const { body } = await postJson("/__board/tags/rename", { from: "old", to: "pricing" });
    expect(body.merged).toBe(true);
    expect(readText(env.root, "a.md")).toContain("tags: [pricing]");
    expect(readText(env.root, "b.md")).toContain("tags: [pricing]");
    expect(tagsFile()).toEqual({ pricing: { hue: "moss" } });
    expect((await get("/__board/tags")).tags).toEqual([
      { name: "pricing", hue: "moss", registered: true, count: 2, kinds: ["note"] },
    ]);
  });

  it("changes only the spelling when only the case differs, keeping the colour", async () => {
    write(env.root, "a.md", "---\ntags: [Pricing, x]\n---\n");
    write(env.root, ".anydag/tags.json", JSON.stringify({ Pricing: { hue: "moss" } }));
    const { body } = await postJson("/__board/tags/rename", { from: "Pricing", to: "pricing" });
    expect(body.files).toEqual([{ name: "a", kind: "note" }]);
    expect(readText(env.root, "a.md")).toContain("tags: [x, pricing]");
    expect(tagsFile()).toEqual({ pricing: { hue: "moss" } });
  });

  it("answers a file that kept changing in `missed`, rolls nothing back, and finishes on a retry", async () => {
    write(env.root, "a.md", "---\ntags: [old]\n---\n");
    write(env.root, "b.md", "---\ntags: [old]\n---\n");
    write(env.root, "c.md", "---\ntags: [old]\n---\n");
    write(env.root, ".anydag/tags.json", JSON.stringify({ old: { hue: "coral" } }));
    const real = env.vault.write.bind(env.vault);
    const spy = vi.spyOn(env.vault, "write").mockImplementation(async (name, kind, text, base) => {
      if (name === "b") throw new Conflict("someone else", "---\ntags: [old]\n---\n");
      return real(name, kind, text, base);
    });
    const first = await postJson("/__board/tags/rename", { from: "old", to: "new" });
    expect(first.status).toBe(200);
    expect(first.body.files.map((f: any) => f.name).sort()).toEqual(["a", "c"]);
    expect(first.body.missed).toEqual([{ name: "b", kind: "note" }]);
    expect(readText(env.root, "a.md")).toContain("tags: [new]");
    expect(readText(env.root, "b.md")).toContain("tags: [old]");
    /* The colour moved at the start, and the old entry stays while a document still carries it. */
    expect(tagsFile()).toEqual({ old: { hue: "coral" }, new: { hue: "coral" } });
    const listed = (await get("/__board/tags")).tags;
    expect(listed.find((t: any) => t.name === "old")).toMatchObject({ count: 1, hue: "coral" });
    expect(listed.find((t: any) => t.name === "new")).toMatchObject({ count: 2, hue: "coral" });

    spy.mockRestore();
    const again = await postJson("/__board/tags/rename", { from: "old", to: "new" });
    expect(again.body.files).toEqual([{ name: "b", kind: "note" }]);
    expect(again.body.missed).toEqual([]);
    expect(readText(env.root, "b.md")).toContain("tags: [new]");
    expect(tagsFile()).toEqual({ new: { hue: "coral" } });
    /* And a third time is nothing at all. */
    const third = await postJson("/__board/tags/rename", { from: "old", to: "new" });
    expect(third.body).toMatchObject({ files: [], missed: [] });
  });

  it("refuses a rename to itself, and what is not a tag", async () => {
    expect((await post("/__board/tags/rename", { from: "a", to: "a" })).status).toBe(400);
    expect((await post("/__board/tags/rename", { from: "a", to: "12" })).status).toBe(400);
  });
});

describe("POST /__board/tags/delete", () => {
  it("takes a tag off every document and out of the list, and says the hue it had", async () => {
    write(env.root, "a.md", "---\ntitle: A\ntags: [meeting, x]\n---\nbody\n");
    write(env.root, "b.md", "---\ntags: [meeting]\n---\nbody\n");
    write(env.root, ".anydag/tags.json", JSON.stringify({ meeting: { hue: "coral" }, x: { hue: "teal" } }));
    const { body } = await postJson("/__board/tags/delete", { tag: "Meeting" });
    expect(body).toMatchObject({ registered: true, hue: "coral", missed: [] });
    expect(body.files.map((f: any) => f.name).sort()).toEqual(["a", "b"]);
    expect(readText(env.root, "a.md")).toContain("title: A\ntags: [x]\n");
    expect(readText(env.root, "b.md")).not.toContain("tags");
    expect(tagsFile()).toEqual({ x: { hue: "teal" } });
  });

  it("on an unused tag rewrites nothing, and `/color` puts it back with its hue — the Undo", async () => {
    write(env.root, "a.md", "---\ntags: [x]\n---\n");
    write(env.root, ".anydag/tags.json", JSON.stringify({ roadmap: { hue: "spruce" } }));
    const before = readText(env.root, "a.md");
    const { body } = await postJson("/__board/tags/delete", { tag: "roadmap" });
    expect(body).toEqual({ tag: "roadmap", files: [], missed: [], registered: true, hue: "spruce" });
    expect(readText(env.root, "a.md")).toBe(before);
    expect(tagsFile()).toEqual({});
    await postJson("/__board/tags/color", { tag: "roadmap", hue: body.hue });
    expect(tagsFile()).toEqual({ roadmap: { hue: "spruce" } });
  });
});

describe("POST /__board/tags/color", () => {
  it("registers a tag with its hue, and `null` resets it to the default while keeping it registered", async () => {
    write(env.root, "a.md", "---\ntags: [Design]\n---\n");
    const set = await postJson("/__board/tags/color", { tag: "Design", hue: "ochre" });
    expect(set.body).toEqual({ name: "Design", hue: "ochre", registered: true });
    expect(tagsFile()).toEqual({ Design: { hue: "ochre" } });
    const reset = await postJson("/__board/tags/color", { tag: "design", hue: null });
    expect(reset.body).toEqual({ name: "Design", hue: defaultHue("Design"), registered: true });
    expect(tagsFile()).toEqual({ Design: {} });
    expect((await post("/__board/tags/color", { tag: "design", hue: "#fff" })).status).toBe(400);
    expect((await post("/__board/tags/color", { tag: "design" })).status).toBe(400);
  });

  it("keeps every other key of a file somebody wrote by hand", async () => {
    write(env.root, ".anydag/tags.json", JSON.stringify({ a: { hue: "teal", note: "mine" }, b: { hue: "moss" } }));
    await postJson("/__board/tags/color", { tag: "a", hue: "coral" });
    expect(tagsFile()).toEqual({ a: { hue: "coral", note: "mine" }, b: { hue: "moss" } });
  });

  it("refuses to write over a tag list that is not JSON", async () => {
    write(env.root, ".anydag/tags.json", "{ not json");
    expect((await post("/__board/tags/color", { tag: "a", hue: "coral" })).status).toBe(409);
    expect(readText(env.root, ".anydag/tags.json")).toBe("{ not json");
  });
});

describe("the tag list's compare-and-set", () => {
  it("never overwrites a change that landed between the read and the write: it reads and edits again", () => {
    write(env.root, ".anydag/tags.json", JSON.stringify({ a: { hue: "teal" } }));
    const real = env.vault.writeRawIf.bind(env.vault);
    let raced = false;
    vi.spyOn(env.vault, "writeRawIf").mockImplementation((rel, bytes, expect) => {
      if (!raced) {
        raced = true;
        /* A sync pull lands first. */
        fs.writeFileSync(path.join(env.root, ".anydag", "tags.json"), JSON.stringify({ a: { hue: "teal" }, b: { hue: "moss" } }));
      }
      return real(rel, bytes, expect);
    });
    const edits: string[] = [];
    expect(
      changeTags(env.vault, (raw) => {
        edits.push(Object.keys(raw).join(","));
        return setHue(raw, "c", "coral");
      }),
    ).toBe(true);
    expect(edits).toEqual(["a", "a,b"]);
    expect(tagsFile()).toEqual({ a: { hue: "teal" }, b: { hue: "moss" }, c: { hue: "coral" } });
  });

  it("writes nothing when nothing changed", () => {
    expect(changeTags(env.vault, () => false)).toBe(false);
    expect(tagsFile()).toBeNull();
  });
});

describe("renamedIn", () => {
  it("is idempotent, so a retry changes only what is left", () => {
    const text = "---\ntags: [a, old]\n---\n";
    const once = renamedIn(text, "old", "new", false);
    expect(once).toBe("---\ntags: [a, new]\n---\n");
    expect(renamedIn(once, "old", "new", false)).toBe(once);
    expect(renamedIn("---\ntags: [new]\n---\n", "New", "new", false)).toBe("---\ntags: [new]\n---\n");
    expect(renamedIn("---\ntags: [old, new]\n---\n", "old", "new", false)).toBe("---\ntags: [new]\n---\n");
    expect(renamedIn("---\ntags: [old]\n---\nbody", "old", null, false)).toBe("body");
  });
});
