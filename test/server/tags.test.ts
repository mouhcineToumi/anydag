/**
 * Tags on the server's read side (#327): what the listing, the change feed and the index carry, the
 * tag list `GET /__board/tags` answers, `.anydag/tags.json` — read, never written by opening a vault —
 * and its place in sync.
 */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { isJson, mergeContent } from "../../server/sync/merge";
import { syncs } from "../../server/sync/scope";
import { registryOf } from "../../server/tags";
import { defaultHue } from "../../src/note/tags";
import { listen, makeEnv, sleep, sweepTemps, until, write, type Env } from "./helpers";

let env: Env;
let session: Session;
let app: ReturnType<typeof createApp>;
let stops: (() => void)[] = [];

beforeEach(() => {
  env = makeEnv();
  session = new Session(env.home, env.vault, "test");
  app = createApp({ session, token: "t", page: null });
  stops = [];
});
afterEach(async () => {
  for (const s of stops) s();
  await env.cleanup();
  sweepTemps();
});

const headers = { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1" };
const url = (at: string) => `http://127.0.0.1${at}${at.includes("?") ? "&" : "?"}vault=${env.vault.id}`;
const get = async (at: string) => (await app.request(url(at), { headers })).json() as Promise<any>;

/** Every file under `root` and its bytes. */
const snapshot = (root: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const f of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (f.isFile()) out[path.join(f.parentPath, f.name)] = fs.readFileSync(path.join(f.parentPath, f.name), "utf8");
  }
  return out;
};

/** A vault with a tag on every kind, a template carrying one, and a registered tag nothing carries. */
function seed(): void {
  write(env.root, "plan.md", "---\ntitle: Plan\ntags: [Meeting, pricing]\n---\nbody\n");
  write(env.root, "chore.md", "---\nstatus: todo\ntags:\n- meeting\n---\n");
  write(env.root, "arch.board.md", "---\ntitle: Arch\ntags: [design]\n---\n\n```md {#one}\nhi\n```\n");
  write(env.root, "drill.quiz.md", "---\ntitle: Drill\ntags: meeting\n---\n\n## One? {#q1}\n- [x] y\n- [ ] n\n");
  write(
    env.root,
    "deals.table.md",
    "---\ntitle: Deals\ntags: [pricing]\n---\n\n## Deals {#deals}\n\n| Name {#name} |\n| --- |\n| Acme {#racme} |\n",
  );
  write(env.root, "Templates/Weekly.md", "---\ntags: [meeting, template-only]\n---\n# {{title}}\n");
  write(
    env.root,
    ".anydag/tags.json",
    JSON.stringify({ meeting: { hue: "coral" }, Roadmap: { hue: "spruce" }, "2026": { hue: "teal" } }),
  );
}

describe("the listing", () => {
  it("carries every kind's tags by name, and leaves a template's out", async () => {
    seed();
    const list = await get("/__board/list");
    expect(list.tags).toEqual({
      plan: ["Meeting", "pricing"],
      chore: ["meeting"],
      arch: ["design"],
      drill: ["meeting"],
      deals: ["pricing"],
    });
    expect(list.tags["Templates/Weekly"]).toBeUndefined();
  });

  it("follows a file's tags when it changes, as the kept listing does a title", async () => {
    seed();
    await env.vault.tree();
    const cur = (await env.vault.read("plan", "note"))!;
    await env.vault.write("plan", "note", "---\ntitle: Plan\ntags: [roadmap]\n---\nbody\n", cur.base);
    await until(async () => ((await get("/__board/list")).tags.plan?.[0] === "roadmap" ? true : null), 5000, "the new tags");
  });
});

describe("GET /__board/tags", () => {
  it("lists every tag carried and every one registered, with its hue, count and kinds, the unused last", async () => {
    seed();
    const { tags } = await get("/__board/tags");
    expect(tags).toEqual([
      { name: "design", hue: defaultHue("design"), registered: false, count: 1, kinds: ["board"] },
      { name: "meeting", hue: "coral", registered: true, count: 3, kinds: ["note", "quiz"] },
      { name: "pricing", hue: defaultHue("pricing"), registered: false, count: 2, kinds: ["note", "table"] },
      { name: "Roadmap", hue: "spruce", registered: true, count: 0, kinds: [] },
    ]);
  });

  it("names a tag nobody registered by its most common spelling", async () => {
    write(env.root, "a.md", "---\ntags: [Design]\n---\n");
    write(env.root, "b.md", "---\ntags: [design]\n---\n");
    write(env.root, "c.md", "---\ntags: [design]\n---\n");
    const { tags } = await get("/__board/tags");
    expect(tags).toEqual([{ name: "design", hue: defaultHue("design"), registered: false, count: 3, kinds: ["note"] }]);
  });

  it("with a tag, names the documents carrying it, by title, ignoring case", async () => {
    seed();
    const got = await get("/__board/tags?tag=MEETING");
    expect(got.tag).toBe("MEETING");
    expect(got.docs).toEqual([
      { name: "chore", kind: "note", title: "chore" },
      { name: "drill", kind: "quiz", title: "Drill" },
      { name: "plan", kind: "note", title: "Plan" },
    ]);
  });

  it("refuses what is not a tag", async () => {
    const res = await app.request(url("/__board/tags?tag=2026"), { headers });
    expect(res.status).toBe(400);
  });

  it("answers an empty list for a vault with no tags and no tag list", async () => {
    write(env.root, "plain.md", "# Plain\n");
    expect(await get("/__board/tags")).toEqual({ tags: [] });
  });
});

describe("opening a vault", () => {
  it("writes nothing for its tags: listing, the tag list and a tag's documents leave every byte alone", async () => {
    write(env.root, "plan.md", "---\ntags: [meeting]\n---\nbody\n");
    write(env.root, "arch.board.md", "```md {#one}\nhi\n```\n");
    const before = snapshot(env.root);
    await get("/__board/list");
    await get("/__board/tags");
    await get("/__board/tags?tag=meeting");
    await get("/__board/index");
    expect(snapshot(env.root)).toEqual(before);
    expect(fs.existsSync(path.join(env.root, ".anydag", "tags.json"))).toBe(false);
  });
});

describe("the tag list's file", () => {
  it("is read leniently: a key that is not a tag, or a hue no theme owns, is passed over", () => {
    const reg = registryOf(
      JSON.stringify({ meeting: { hue: "coral" }, Meeting: { hue: "teal" }, "2026": {}, odd: { hue: "#fff" } }),
    );
    expect([...reg.values()]).toEqual([
      { name: "meeting", hue: "coral" },
      { name: "odd", hue: null },
    ]);
    expect(registryOf("{nope").size).toBe(0);
    expect(registryOf("[1]").size).toBe(0);
  });

  it("syncs, and merges by key", () => {
    const types = new Set<string>();
    expect(syncs(".anydag/tags.json", types)).toBe(true);
    expect(syncs(".anydag/tags.json/x", types)).toBe(false);
    expect(isJson(".anydag/tags.json")).toBe(true);
    const bytes = (o: unknown) => new Uint8Array(Buffer.from(JSON.stringify(o)));
    const base = bytes({ meeting: { hue: "coral" }, design: { hue: "teal" } });
    const ours = bytes({ meeting: { hue: "moss" }, design: { hue: "teal" } });
    const theirs = bytes({ meeting: { hue: "coral" }, design: { hue: "ochre" }, roadmap: { hue: "spruce" } });
    const r = mergeContent(".anydag/tags.json", base, ours, theirs);
    expect(JSON.parse(Buffer.from((r as { merged: Uint8Array }).merged).toString("utf8"))).toEqual({
      meeting: { hue: "moss" },
      design: { hue: "ochre" },
      roadmap: { hue: "spruce" },
    });
  });
});

describe("the change feed", () => {
  it("carries a text's tags on its event, and `[]` for none", async () => {
    const f = await listen(env.vault);
    stops.push(f.stop);
    await sleep(100);
    write(env.root, "Hand made.board.md", "---\ntags: [arch]\n---\n\n```md {#one}\nhi\n```\n");
    write(env.root, "plain.md", "# Plain\n");
    const board = await until(() => f.docs("Hand made").find((d) => d.sha1), 5000, "the board");
    expect(board.tags).toEqual(["arch"]);
    const note = await until(() => f.docs("plain").find((d) => d.sha1), 5000, "the note");
    expect(note.tags).toEqual([]);
  });

  it("says the tag list moved when .anydag/tags.json changes", async () => {
    const f = await listen(env.vault);
    stops.push(f.stop);
    await sleep(100);
    write(env.root, ".anydag/tags.json", JSON.stringify({ meeting: { hue: "coral" } }));
    await until(() => f.events.find((e) => e.type === "tags"), 5000, "dag:tags");
  });
});

describe("the index", () => {
  it("carries a document's tags", async () => {
    write(env.root, "plan.md", "---\ntags: [meeting]\n---\nbody\n");
    write(env.root, "arch.board.md", "---\ntags: [design]\n---\n\n```md {#one}\nhi\n```\n");
    const index = await get("/__board/index");
    const docs = Object.values(index.docs ?? index) as any[];
    expect(docs.map((d) => d.tags).filter(Boolean)).toEqual(expect.arrayContaining([["meeting"], ["design"]]));
  });
});
