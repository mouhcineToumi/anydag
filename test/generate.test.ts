import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  check,
  echoesSource,
  extract,
  feedback,
  generate,
  request,
  rewriteRequest,
} from "../plugins/generate/generate";
import type { Complete, Message } from "../plugins/generate/llm";
import { systemPrompt } from "../plugins/generate/system";
import { libraryList } from "../src/board/library/serve";
import { DIAGRAM_TYPES } from "../src/board/types";
import { CODES } from "../src/dsl/codes";

/**
 * The generator's loop, with a scripted model on the other end.
 *
 * Every case is about what the loop *does with* an answer — find the fence, check it with the real
 * parser, send the codes back — so the model is a list of replies and a record of what it was sent.
 * Nothing here reaches a network.
 */

const DOCS = path.resolve(__dirname, "../docs");

function scripted(...replies: string[]): { complete: Complete; calls: Message[][] } {
  const calls: Message[][] = [];
  const complete: Complete = async (messages) => {
    calls.push(messages.map((m) => ({ ...m })));
    const next = replies.shift();
    if (next === undefined) throw new Error("the script ran out of replies");
    return next;
  };
  return { complete, calls };
}

const fence = (type: string, body: string, attrs = "") => "```" + type + (attrs ? ` {${attrs}}` : "") + "\n" + body + "\n```";

const GOOD_ARCH = fence(
  "arch",
  ['client web "Browser"', 'service api "API"', 'db pg "Postgres" icon=postgresql', "web --> api", "api --> pg"].join("\n"),
);
/* `database` is not an `arch` kind: the one mistake a model reaches for most. */
const BAD_ARCH = fence("arch", ['client web "Browser"', 'database pg "Postgres"', "web --> pg"].join("\n"));

describe("extract", () => {
  it("finds the fence inside a chatty reply", () => {
    const found = extract(`Sure! Here is the diagram:\n\n${GOOD_ARCH}\n\nLet me know if you want changes.`);
    expect("draft" in found && found.draft.type).toBe("arch");
    expect("draft" in found && found.draft.body).toContain('service api "API"');
  });

  it("unwraps a reply fenced whole in a longer fence", () => {
    const found = extract("````markdown\n" + GOOD_ARCH + "\n````");
    expect("draft" in found && found.draft.type).toBe("arch");
  });

  it("keeps only the fence attributes a model may set", () => {
    const found = extract(fence("arch", 'service a "A"', '#mine x=40 y=80 page=two hidden title="T" dir=LR w=900'));
    expect("draft" in found && found.draft.attrs).toEqual({ title: "T", dir: "LR" });
  });

  it("lets a chart keep its size, because a chart's size is a choice", () => {
    const found = extract(fence("chart", "bar\nx A B\nseries s \"S\" 1 2", "w=640 h=420 x=3"));
    expect("draft" in found && found.draft.attrs).toEqual({ w: 640, h: 420 });
  });

  it("names a foreign fence rather than saying nothing was there", () => {
    const found = extract(fence("mermaid", "graph LR\n  A --> B"));
    expect("none" in found && found.none).toContain("mermaid");
  });
});

describe("rewriteRequest", () => {
  it("carries the source, then the change, and still starts with a word", () => {
    const text = rewriteRequest("make the cache a cluster", 'db pg "Postgres"', "arch");
    expect(text.startsWith("Rewrite")).toBe(true);
    expect(text).toContain('db pg "Postgres"');
    expect(text.indexOf("make the cache a cluster")).toBeGreaterThan(text.indexOf("db pg"));
    expect(text).toContain("whole new body");
    expect(text).toContain("`arch`");
  });

  it("names the type it is changing from, and lets the change ask for another", () => {
    const text = rewriteRequest("use another diagram type", 'state a "A"', undefined, "state");
    expect(text.startsWith("Rewrite the `state` diagram below.")).toBe(true);
    expect(text).toContain("Keep it a `state` unless the change asks for a different kind of diagram");
    expect(text).not.toContain("same type");
  });

  it("reads like request() when no type was pinned", () => {
    const text = rewriteRequest("split the api", "service api \"API\"");
    expect(text.startsWith("Rewrite")).toBe(true);
    expect(text).not.toContain("`undefined`");
  });
});

describe("extract in rewrite mode", () => {
  const SOURCE = 'client web "Browser"\nservice api "API"';

  it("takes the last fence, because a model may quote the original first", () => {
    const reply = `Here is what you gave me:\n\n${fence("arch", SOURCE)}\n\nAnd the changed version:\n\n${fence("arch", SOURCE + "\nweb --> api")}`;
    const found = extract(reply, "arch", SOURCE);
    expect("draft" in found && found.draft.body).toContain("web --> api");
  });

  it("still takes the first fence when drawing fresh", () => {
    const reply = `${fence("arch", SOURCE)}\n\n${fence("flow", 'step a "A"\na --> a')}`;
    const found = extract(reply);
    expect("draft" in found && found.draft.type).toBe("arch");
  });

  it("refuses an unchanged echo of the source", () => {
    const found = extract(fence("arch", SOURCE), "arch", SOURCE);
    expect("none" in found).toBe(true);
    expect("none" in found && found.none).toContain("unchanged");
  });

  it("accepts a body that actually changed", () => {
    const found = extract(fence("arch", SOURCE + "\nweb --> api"), "arch", SOURCE);
    expect("draft" in found && found.draft.body).toContain("web --> api");
  });

  it("compares through echoesSource, which ignores trailing whitespace per line and at the end", () => {
    expect(echoesSource('a "A"   \nb "B"\n\n', 'a "A"\nb "B"')).toBe(true);
    expect(echoesSource('a "A"\nweb --> api\n', 'a "A"')).toBe(false);
  });
});

describe("check", () => {
  it("is clean for a diagram the page draws clean", () => {
    const found = extract(GOOD_ARCH);
    expect("draft" in found && check(found.draft)).toEqual([]);
  });

  it("counts lines from the first line inside the fence, which is all a model ever saw", () => {
    const found = extract(`intro\n\n${BAD_ARCH}`);
    const ds = "draft" in found ? check(found.draft) : [];
    const kind = ds.find((d) => d.code === CODES.E_UNKNOWN_KIND);
    expect(kind?.line).toBe(2);
  });
});

describe("generate", () => {
  it("takes the first answer when it is clean", async () => {
    const model = scripted(GOOD_ARCH);
    const r = await generate({ prompt: "a web app", system: "S", complete: model.complete });
    expect(r).toMatchObject({ ok: true, attempts: 1, draft: { type: "arch" } });
    expect(model.calls[0]![0]).toEqual({ role: "system", content: "S" });
    expect(model.calls[0]![1]!.content).toBe(request("a web app"));
  });

  it("sends the codes and their lines back, and takes the fixed answer", async () => {
    const model = scripted(BAD_ARCH, GOOD_ARCH);
    const r = await generate({ prompt: "a web app", system: "S", complete: model.complete });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    const second = model.calls[1]!;
    expect(second.at(-2)).toEqual({ role: "assistant", content: BAD_ARCH });
    expect(second.at(-1)!.content).toContain("line 2");
    expect(second.at(-1)!.content).toContain(CODES.E_UNKNOWN_KIND);
  });

  it("gives up after the last attempt and returns the best one with what is wrong with it", async () => {
    const worse = fence("arch", ['database a "A"', 'database b "B"', "a --> b"].join("\n"));
    const model = scripted(worse, BAD_ARCH, worse);
    const r = await generate({ prompt: "p", system: "S", complete: model.complete, attempts: 3 });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(3);
    /* The middle answer has one wrong kind word; the other two have two. */
    expect(r.draft?.body).toContain('client web "Browser"');
    expect(r.diagnostics.some((d) => d.code === CODES.E_UNKNOWN_KIND)).toBe(true);
  });

  it("asks again when there is no fence, and reports that when there never is one", async () => {
    const model = scripted("I would draw a box.", "Still just words.");
    const r = await generate({ prompt: "p", system: "S", complete: model.complete, attempts: 2 });
    expect(r).toMatchObject({ ok: false, attempts: 2 });
    expect(r.draft).toBeUndefined();
    expect(r.error).toContain("could not find a diagram");
    expect(model.calls[1]!.at(-1)!.content).toContain("fenced block");
  });

  it("treats the wrong type as an error when the card asked for one", async () => {
    const flow = fence("flow", 'step a "A"\nstep b "B"\na --> b');
    const model = scripted(flow, GOOD_ARCH);
    const r = await generate({ prompt: "p", as: "arch", system: "S", complete: model.complete });
    expect(r).toMatchObject({ ok: true, attempts: 2, draft: { type: "arch" } });
    expect(model.calls[1]!.at(-1)!.content).toContain("asked for `arch`");
  });

  it("retries a fixable warning while it can, and accepts it on the last attempt", async () => {
    const typo = fence("arch", 'db pg "Postgres" icon=postgress');
    const model = scripted(typo, typo);
    const r = await generate({ prompt: "p", system: "S", complete: model.complete, attempts: 2 });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    expect(r.diagnostics.map((d) => d.code)).toContain(CODES.W_UNKNOWN_ICON);
  });

  it("retries an edge from a row the card does not have", async () => {
    const stray = fence("arch", 'service api "API" {\n  ask "ask"\n}\nstore idx "Index"\napi.ask --> idx.search');
    const model = scripted(stray, GOOD_ARCH);
    const r = await generate({ prompt: "p", system: "S", complete: model.complete });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(model.calls[1]!.at(-1)!.content).toContain(CODES.W_MISSING_ROW);
  });

  it("stops when cancelled", async () => {
    const cancel = new AbortController();
    cancel.abort();
    await expect(generate({ prompt: "p", system: "S", complete: scripted(GOOD_ARCH).complete, signal: cancel.signal })).rejects.toThrow();
  });
});

describe("generate in rewrite mode", () => {
  const SOURCE = ['client web "Browser"', 'service api "API"', "web --> api"].join("\n");
  const CHANGED = ['client web "Browser"', 'service api "API"', 'service api2 "API 2"', "web --> api"].join("\n");

  it("sends the rewrite turn, and the wrong-type guard still holds", async () => {
    const flow = fence("flow", 'step a "A"\na --> b');
    const model = scripted(flow, fence("arch", CHANGED));
    const r = await generate({ prompt: "add a second api", source: SOURCE, as: "arch", system: "S", complete: model.complete });
    expect(r).toMatchObject({ ok: true, attempts: 2, draft: { type: "arch" } });
    expect(model.calls[0]![1]!.content).toBe(rewriteRequest("add a second api", SOURCE, "arch"));
    expect(model.calls[1]!.at(-1)!.content).toContain("asked for `arch`");
  });

  it("takes an answer in another type when only `from` was given", async () => {
    const flow = fence("flow", 'lane u "User" {\n  step web "Browser"\n  step api "API"\n}\nweb --> api');
    const model = scripted(flow);
    const r = await generate({ prompt: "show this as a flowchart", source: SOURCE, from: "arch", system: "S", complete: model.complete });
    expect(r).toMatchObject({ ok: true, attempts: 1, draft: { type: "flow" } });
    expect(model.calls[0]![1]!.content).toBe(rewriteRequest("show this as a flowchart", SOURCE, undefined, "arch"));
  });

  it("refuses an answer that quotes the source back, and takes the corrected one next", async () => {
    const model = scripted(fence("arch", SOURCE), fence("arch", CHANGED));
    const r = await generate({ prompt: "add a second api", source: SOURCE, as: "arch", system: "S", complete: model.complete });
    expect(r).toMatchObject({ ok: true, attempts: 2, draft: { body: CHANGED } });
    expect(model.calls[1]!.at(-1)!.content).toContain("unchanged");
  });
});

describe("feedback", () => {
  it("names the fence line as such, and leaves out warnings nobody can fix by rewording", () => {
    const text = feedback([
      { line: 0, code: CODES.EB_BAD_DIR, message: "dir must be LR or TB", severity: "error" },
      { line: 3, col: 5, code: CODES.W_UNKNOWN_ICON, message: "unknown icon", severity: "warn" },
      { line: 4, code: CODES.W_CHART_MANY, message: "too many series", severity: "warn" },
    ]);
    expect(text).toContain("fence line EB_BAD_DIR");
    expect(text).toContain("line 3:5 W_UNKNOWN_ICON");
    expect(text).not.toContain("W_CHART_MANY");
  });
});

describe("systemPrompt", () => {
  it("is built from the files in this repository, all fourteen grammars when the model chooses", () => {
    const text = systemPrompt({ docsRoot: DOCS });
    expect(text).toContain("# Drawing a diagram for AnyDag");
    for (const t of DIAGRAM_TYPES) expect(text).toContain(`## Grammar: \`${t}\``);
  });

  it("narrows to one grammar and that type's whole library when the card asked for a type", () => {
    const text = systemPrompt({ docsRoot: DOCS, as: "erd" });
    expect(text).toContain("## Grammar: `erd`");
    expect(text).not.toContain("## Grammar: `arch`");
    for (const b of libraryList("erd")) expect(text).toContain(b.source);
    expect(text).toContain("asked for a `erd` diagram");
  });

  it("stays inside a size either model reads comfortably", () => {
    expect(systemPrompt({ docsRoot: DOCS }).length).toBeLessThan(200_000);
  });

  it("tells a rewrite it may change the type when asked, and every grammar is there to change to", () => {
    const text = systemPrompt({ docsRoot: DOCS, mode: "rewrite" });
    expect(text).toContain("unless the person asks for a different kind of diagram");
    for (const t of DIAGRAM_TYPES) expect(text).toContain(`## Grammar: \`${t}\``);
  });

  it("carries the rewrite section only in rewrite mode", () => {
    expect(systemPrompt({ docsRoot: DOCS, mode: "rewrite" })).toContain("Rewriting an existing diagram");
    expect(systemPrompt({ docsRoot: DOCS })).not.toContain("Rewriting an existing diagram");
    expect(systemPrompt({ docsRoot: DOCS, mode: "draw" })).not.toContain("Rewriting an existing diagram");
  });
});

describe("docs/generate/guide.md", () => {
  /* The *Which type* table is the one part of the guide that is a closed set: a fifteenth diagram
     type that is not in it is a type the model is never told it may draw. */
  it("names every diagram type", () => {
    const guide = fs.readFileSync(path.join(DOCS, "generate/guide.md"), "utf8");
    for (const t of DIAGRAM_TYPES) expect(guide).toContain(`| \`${t}\` |`);
  });

  it("tells the model how a rewrite is answered", () => {
    const guide = fs.readFileSync(path.join(DOCS, "generate/guide.md"), "utf8");
    expect(guide).toContain("## Rewriting a diagram");
  });
});
