/**
 * `GET /__board/graph` (#457): the vault as a graph — documents in name order, each link once, and
 * the five fields — built from the references index, on a small vault holding a tag, a project, a
 * task, a folder and an attachment.
 */
import "./sqlite-shim";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import type { GraphField, GraphWire } from "../../src/graph/wire";
import { defaultHue } from "../../src/note/tags";
import { PDF, makeEnv, sweepTemps, write, type Env } from "./helpers";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

const appOf = () => createApp({ session: new Session(env.home, env.vault, "test"), token: "t", page: null });

async function graph(app = appOf()): Promise<{ text: string; g: GraphWire }> {
  const res = await app.request("http://127.0.0.1/__board/graph", { headers: { "x-anydag-token": "t", host: "127.0.0.1" } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  const text = await res.text();
  return { text, g: JSON.parse(text) as GraphWire };
}

/** A field's value for each named document: its key, or its keys, `null` for none. */
function valuesBy(g: GraphWire, key: string): Record<string, string | string[] | null> {
  const f = g.fields.find((x) => x.key === key) as GraphField;
  expect(f).toBeDefined();
  return Object.fromEntries(
    g.names.map((name, i) => {
      if (f.type === "one") return [name, f.of![i]! < 0 ? null : f.values[f.of![i]!]!.key];
      return [name, f.items!.slice(f.start![i], f.start![i + 1]).map((v) => f.values[v]!.key)];
    }),
  );
}

async function fill(): Promise<void> {
  await env.vault.create(
    "Launch/Launch",
    "note",
    "---\ntitle: Launch\nproject: active\nhue: coral\ntags: [Release]\n---\n# Launch\n\n[[Ship]]\n",
  );
  await env.vault.create("Launch/Ship", "note", "---\nstatus: in-progress\ntags: [release, idea]\n---\n# Ship\n\n[[Launch]]\n");
  const ship = await env.vault.peekId("Launch/Ship", "note");
  await env.vault.create(
    "Inbox",
    "note",
    `---\ntitle: Inbox of things\n---\nSee [[Ship]], [the ship](dag:${ship}), ![[Ship]], [[Inbox]] and [[Nowhere]].\n`,
  );
  await env.vault.create("Kickoff", "note", "---\nstart: 2026-10-12\n---\n# Kickoff\n");
  await env.vault.create("Lonely", "note", "# Lonely\n");
  write(env.root, "Launch/assets/spec.pdf", PDF);
  write(env.root, ".anydag/tags.json", JSON.stringify({ RELEASE: { hue: "teal" } }));
}

describe("GET /__board/graph", () => {
  it("lists every document in name order, titled only where the name does not say it", async () => {
    await fill();
    const { g } = await graph();
    expect(g.v).toBe(1);
    expect(g.names).toEqual(["Inbox", "Kickoff", "Launch/Launch", "Launch/Ship", "Launch/assets/spec.pdf", "Lonely"]);
    expect(g.ids.every((id) => /^[0-9a-z]{10}$/.test(id))).toBe(true);
    expect(new Set(g.ids).size).toBe(g.ids.length);
    expect(g.titles).toEqual(["Inbox of things", null, null, null, null, null]);
  });

  it("holds a link once, never to itself, never to a document that is not there", async () => {
    await fill();
    const { g } = await graph();
    const at = (name: string) => g.names.indexOf(name);
    const pairs: string[] = [];
    for (let k = 0; k < g.links.length; k += 2) {
      const [a, b] = [g.links[k]!, g.links[k + 1]!];
      expect(a).not.toBe(b);
      pairs.push([g.names[a], g.names[b]].sort().join(" — "));
    }
    // Inbox names Ship three ways and itself once; Launch and Ship name each other: two links.
    expect(pairs.sort()).toEqual(["Inbox — Launch/Ship", "Launch/Launch — Launch/Ship"]);
    expect(g.links.length).toBe(4);
    expect(g.links.every((i) => i >= 0 && i < g.ids.length)).toBe(true);
    expect(at("Lonely")).toBeGreaterThanOrEqual(0);
  });

  it("carries kind, folder, tag, project and status as fields", async () => {
    await fill();
    const { g } = await graph();
    expect(g.fields.map((f) => [f.key, f.type, f.tree ?? false])).toEqual([
      ["kind", "one", false],
      ["folder", "one", true],
      ["tag", "many", false],
      ["project", "one", false],
      ["status", "one", false],
    ]);
    expect(valuesBy(g, "kind")).toEqual({
      Inbox: "note",
      Kickoff: "event",
      "Launch/Launch": "project",
      "Launch/Ship": "task",
      "Launch/assets/spec.pdf": "attachment",
      Lonely: "note",
    });
    // A note is the plain ground; every other kind wears a hue of its own.
    expect(g.fields[0]!.values.map((v) => [v.key, v.hue ?? (v.plain ? "plain" : null)])).toEqual([
      ["note", "plain"],
      ["task", "spruce"],
      ["project", "coral"],
      ["event", "ochre"],
      ["attachment", "bronze"],
    ]);
    expect(valuesBy(g, "folder")).toEqual({
      Inbox: null,
      Kickoff: null,
      "Launch/Launch": "Launch",
      "Launch/Ship": "Launch",
      "Launch/assets/spec.pdf": "Launch/assets",
      Lonely: null,
    });
    expect(g.fields.find((f) => f.key === "folder")!.values.map((v) => v.key)).toEqual(["Launch", "Launch/assets"]);
    expect(valuesBy(g, "tag")).toEqual({
      Inbox: [],
      Kickoff: [],
      "Launch/Launch": ["release"],
      "Launch/Ship": ["release", "idea"],
      "Launch/assets/spec.pdf": [],
      Lonely: [],
    });
    // A registered tag is labelled and coloured as the tag list says; another, by its name's hash.
    expect(g.fields.find((f) => f.key === "tag")!.values).toEqual([
      { key: "idea", label: "idea", hue: defaultHue("idea") },
      { key: "release", label: "RELEASE", hue: "teal" },
    ]);
    // Membership of a project is a path: its note, the task beside it and the attachment under it.
    const launch = g.ids[g.names.indexOf("Launch/Launch")]!;
    expect(valuesBy(g, "project")).toEqual({
      Inbox: null,
      Kickoff: null,
      "Launch/Launch": launch,
      "Launch/Ship": launch,
      "Launch/assets/spec.pdf": launch,
      Lonely: null,
    });
    expect(g.fields.find((f) => f.key === "project")!.values).toEqual([{ key: launch, label: "Launch", hue: "coral" }]);
    expect(valuesBy(g, "status")).toMatchObject({ "Launch/Ship": "in-progress", Inbox: null });
    expect(g.fields.find((f) => f.key === "status")!.values).toEqual([{ key: "in-progress", label: "In progress" }]);
  });

  it("answers the same text while nothing moved, and follows a write", async () => {
    await fill();
    const app = appOf();
    const first = await graph(app);
    expect((await graph(app)).text).toBe(first.text);
    await env.vault.create("Later", "note", "---\ntags: [idea]\n---\n[[Lonely]]\n");
    const after = await graph(app);
    expect(after.g.names).toContain("Later");
    expect(after.g.links.length).toBe(first.g.links.length + 2);
  });

  it("follows a change to the tag list's colours", async () => {
    await fill();
    const app = appOf();
    await graph(app);
    write(env.root, ".anydag/tags.json", JSON.stringify({ release: { hue: "moss" } }));
    const { g } = await graph(app);
    expect(g.fields.find((f) => f.key === "tag")!.values.find((v) => v.key === "release")).toEqual({
      key: "release",
      label: "release",
      hue: "moss",
    });
  });

  it("is much smaller than the index it is built from", async () => {
    await fill();
    const app = appOf();
    const index = await (
      await app.request("http://127.0.0.1/__board/index", { headers: { "x-anydag-token": "t", host: "127.0.0.1" } })
    ).text();
    const { text } = await graph(app);
    expect(text.length).toBeLessThan(index.length);
  });
});
