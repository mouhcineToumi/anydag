/** The index resolves a `[[wikilink]]` by name, so backlinks count it. */
import "./sqlite-shim";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { makeEnv, sweepTemps, type Env } from "./helpers";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

describe("GET /__board/index", () => {
  it("gives a wikilink the id of the document it names, and none to one that names nothing", async () => {
    await env.vault.create("Projects/Plan", "note", "# Plan\n");
    await env.vault.create("Meeting notes", "note", "See [[Plan|the plan]], ![[Plan]] and [[Nowhere]].\n");
    const app = createApp({ session: new Session(env.home, env.vault, "test"), token: "t", page: null });
    const res = await app.request("http://127.0.0.1/__board/index", { headers: { "x-anydag-token": "t", host: "127.0.0.1" } });
    expect(res.status).toBe(200);
    const { docs } = (await res.json()) as {
      docs: { id: string; name: string; refs: { id: string; wiki?: string; type: string }[] }[];
    };
    const plan = docs.find((d) => d.name === "Projects/Plan")!;
    const notes = docs.find((d) => d.name === "Meeting notes")!;
    expect(notes.refs).toEqual([
      { id: plan.id, wiki: "Plan", type: "link", text: "the plan" },
      { id: plan.id, wiki: "Plan", type: "embed", text: "Plan" },
      { id: "", wiki: "Nowhere", type: "link", text: "Nowhere" },
    ]);
    // Followed by name, never rewritten: the body is what was written.
    expect(
      (await env.vault.read("Meeting notes", "note"))!.text.endsWith("\nSee [[Plan|the plan]], ![[Plan]] and [[Nowhere]].\n"),
    ).toBe(true);
  });
});

describe("GET /__board/refs", () => {
  const get = async (q: string) => {
    const app = createApp({ session: new Session(env.home, env.vault, "test"), token: "t", page: null });
    return app.request(`http://127.0.0.1/__board/refs?${q}`, { headers: { "x-anydag-token": "t", host: "127.0.0.1" } });
  };

  it("answers one document's references with what they name, and its backlinks", async () => {
    await env.vault.create("Projects/Plan", "note", "# Plan\n\nBack to [[Plan]] itself.\n");
    await env.vault.create("Meeting notes", "note", "See [[Plan|the plan]] and [[Nowhere]].\n");
    const res = await get("name=Meeting%20notes&kind=note");
    expect(res.status).toBe(200);
    const me = (await res.json()) as {
      name: string;
      refs: { wiki?: string; target: { name: string } | null }[];
      backlinks: unknown[];
    };
    expect(me.name).toBe("Meeting notes");
    expect(me.refs.map((r) => [r.wiki, r.target?.name ?? null])).toEqual([
      ["Plan", "Projects/Plan"],
      ["Nowhere", null],
    ]);
    expect(me.backlinks).toEqual([]);

    const plan = (await (await get("name=Projects/Plan&kind=note")).json()) as { backlinks: { name: string; type: string }[] };
    // A document pointing at itself is not its own backlink.
    expect(plan.backlinks.map((b) => [b.name, b.type])).toEqual([["Meeting notes", "link"]]);
  });

  it("is a 404 for a document that is not there", async () => {
    expect((await get("name=nope&kind=note")).status).toBe(404);
  });
});
