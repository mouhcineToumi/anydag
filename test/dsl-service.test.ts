import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { handle, OPS_SHAPE, type DslResponse } from "../server/handle";
import { scanFences } from "../src/board/fences";
import { libraryList } from "../src/board/library/serve";
import { applyPatch } from "../src/board/patch";
import { parseBoard } from "../src/board/parseBoard";
import { stampItems } from "../src/board/stamp";
import { indexTexts } from "../src/refs/extract";
import { corpusTexts } from "../src/search/corpus";
import { diagnoseBoard } from "../src/dsl/diagnose";
import { buildEngine, search, snippet } from "../src/search/engine";
import { parseQuiz } from "../src/quiz/parse";
import { tableData } from "../src/table/data";
import { applyTableOps } from "../src/table/ops";
import { parseTable } from "../src/table/parse";
import { tableDiagnostics } from "../src/table/values";

/**
 * The local server.
 *
 * Two things are being tested and only one of them is the routing. The other is the claim the whole
 * split rests on: **the service answers exactly what calling the function directly answers.** So
 * most of these compare a route against the very symbol `plugins/board.ts` calls, rather than
 * against a fixture somebody typed — a fixture would freeze today's output and say nothing about
 * whether the two paths agree tomorrow.
 *
 * No socket anywhere. `handle` is a function of its arguments, which is the property that makes
 * this file possible and is worth keeping.
 */

const get = (route: string, query = ""): Promise<DslResponse> =>
  handle({ method: "GET", route, query: new URLSearchParams(query) });

const post = (route: string, body: unknown): Promise<DslResponse> =>
  handle({ method: "POST", route, query: new URLSearchParams(), body });

const BOARD = `---
title: Two items
---

\`\`\`md {#one}
The first item.
\`\`\`

\`\`\`arch {#infra}
service api "API" icon=server
store db "Postgres" icon=postgresql
api --> db
\`\`\`
`;

describe("index", () => {
  it("is `indexTexts`: a title and the references, per text, a note told apart by its key", async () => {
    const texts = {
      plan: "---\ntitle: The plan\n---\n\n```md {#a}\nSee [the note](dag:0123456789).\n```\n",
      "notes/n.note.md": "---\ntitle: A note\n---\n![The plan](dag:abcdefghjk)\n",
    };
    const r = await post("/index", { texts });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ docs: indexTexts(texts) });
    const docs = (r.body as { docs: Record<string, { title?: string; refs: { id: string; type: string }[] }> }).docs;
    expect(docs.plan!.title).toBe("The plan");
    expect(docs.plan!.refs.map((x) => x.id)).toEqual(["0123456789"]);
    expect(docs["notes/n.note.md"]!.refs.map((x) => x.type)).toEqual(["embed"]);
  });

  it("reads a quiz as Markdown, and says how many questions it asks", async () => {
    // A quiz is a kind of its own, not a board with another suffix: a board's references live only
    // in its `md` items, and a quiz's are read straight out of its Markdown.
    const texts = {
      "study/drill.quiz.md":
        "---\ntitle: Drill\n---\n\n## Why? {#a}\n- [x] [See the plan](dag:0123456789)\n- [ ] no\n\n## And? {#b}\n- [x] y\n- [ ] n\n",
    };
    const r = await post("/index", { texts });
    expect(r.body).toEqual({ docs: indexTexts(texts) });
    const doc = (r.body as { docs: Record<string, { title?: string; questions?: number; refs: { id: string }[] }> }).docs[
      "study/drill.quiz.md"
    ]!;
    expect(doc.title).toBe("Drill");
    expect(doc.questions).toBe(2);
    expect(doc.refs.map((x) => x.id)).toEqual(["0123456789"]);
  });

  it("refuses anything that is not a map of texts", async () => {
    expect((await post("/index", { texts: ["x"] })).status).toBe(400);
    expect((await post("/index", { texts: { a: 1 } })).status).toBe(400);
  });
});

describe("corpus", () => {
  it("is `corpusTexts`: a title and the units a search result opens onto, a note told apart by its key", async () => {
    const texts = {
      plan: "---\ntitle: The plan\n---\n\n```md {#a}\nShip it on Friday.\n```\n",
      "notes/n.note.md": "---\ntitle: A note\n---\nThe launch checklist. ^list\n",
    };
    const r = await post("/corpus", { texts });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ docs: corpusTexts(texts) });
    const docs = (r.body as { docs: Record<string, { title?: string; units: { part?: string; what: string; text: string }[] }> })
      .docs;
    expect(docs.plan!.units).toEqual([
      { what: "title", text: "The plan" },
      { part: "a", what: "md", text: "Ship it on Friday." },
    ]);
    expect(docs["notes/n.note.md"]!.units[1]).toEqual({ part: "^list", what: "paragraph", text: "The launch checklist." });
  });

  it("cuts a quiz into one unit per question, named by its id", async () => {
    const texts = {
      "drill.quiz.md":
        "---\ntitle: Drill\n---\n\nAbout **MVCC**.\n\n## What does VACUUM reclaim? {#qvac}\n- [ ] Index bloat\n- [x] Dead tuples\n\n> They stay until it runs.\n\n## No id yet\n- [x] a\n- [ ] b\n",
    };
    const r = await post("/corpus", { texts });
    expect(r.body).toEqual({ docs: corpusTexts(texts) });
    const doc = (r.body as { docs: Record<string, { units: { part?: string; what: string; text: string }[] }> }).docs[
      "drill.quiz.md"
    ]!;
    expect(doc.units).toEqual([
      { what: "title", text: "Drill" },
      { what: "paragraph", text: "About MVCC." },
      { part: "qvac", what: "question", text: "What does VACUUM reclaim? Index bloat Dead tuples They stay until it runs." },
      { part: "L13", what: "question", text: "No id yet a b" },
    ]);
  });

  it("refuses anything that is not a map of texts", async () => {
    expect((await post("/corpus", { texts: ["x"] })).status).toBe(400);
    expect((await post("/corpus", { texts: { a: 1 } })).status).toBe(400);
  });
});

describe("stamp", () => {
  const LOOSE = 'Some prose.\n\n```arch\nservice a "A"\n```\n';

  it("is `stampItems`, and says whether it changed anything", async () => {
    const r = await post("/stamp", { text: LOOSE });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ text: stampItems(LOOSE), changed: true });
    const again = await post("/stamp", { text: stampItems(LOOSE) });
    expect((again.body as { changed: boolean }).changed).toBe(false);
  });

  it("runs after every patch, so no item a patch leaves behind is anonymous", async () => {
    const r = await post("/patch", { text: LOOSE, ops: [] });
    expect((r.body as { text: string }).text).toBe(stampItems(LOOSE));
  });
});

describe("patch", () => {
  it("applies ops and says whether anything changed", async () => {
    const r = await post("/patch", { text: BOARD, ops: [{ id: "one", attrs: { x: 80, y: 40 } }] });
    expect(r.status).toBe(200);
    const b = r.body as { text: string; changed: boolean };
    expect(b.changed).toBe(true);
    expect(b.text).toContain("```md {#one x=80 y=40}");
    /* The claim the split rests on: the route is the function. */
    const direct = applyPatch(BOARD, [{ id: "one", attrs: { x: 80, y: 40 } }]);
    if (!direct.ok) throw new Error(direct.error);
    expect(b.text).toBe(direct.text);
  });

  it("reports an op that changes nothing as unchanged, so api does not write", async () => {
    const r = await post("/patch", { text: BOARD, ops: [{ id: "one", attrs: {} }] });
    expect((r.body as { changed: boolean }).changed).toBe(false);
    expect((r.body as { text: string }).text).toBe(BOARD);
  });

  it("404s on an id the board does not have, carrying the patcher's own message", async () => {
    const r = await post("/patch", { text: BOARD, ops: [{ id: "nope", attrs: { x: 1 } }] });
    expect(r.status).toBe(404);
    expect((r.body as { error: string }).error).toContain("nope");
  });

  it("refuses a body that is not the op shape, with the shape", async () => {
    for (const ops of [[{ nope: true }], "ops", [{ id: 4 }]]) {
      const r = await post("/patch", { text: BOARD, ops });
      expect(r.status).toBe(400);
      expect((r.body as { error: string }).error).toContain("expected `ops:");
    }
  });

  it("refuses a missing text rather than patching an empty string", async () => {
    const r = await post("/patch", { ops: [] });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toContain("`text: string`");
  });

  /* No `base`, no sha1, no write. A compare-and-swap is storage and belongs in `api`; this service
     must not grow an opinion about where a board lives. */
  it("has no opinion about versions", async () => {
    const r = await post("/patch", { text: BOARD, ops: [{ id: "one", attrs: { x: 8 } }], base: "nonsense" });
    expect(r.status).toBe(200);
  });

  /* `board_patch` documents an insert as text, and the route once took only the object, so
     every insert over MCP was a 400 the agent never saw. Both spellings are the same op now. */
  describe("an insert written as the file writes it", () => {
    const FENCE = "```md {#kintro x=0 y=0 w=1560 page=k3s}\n## With k3s\nText.\n```";
    const ok = (r: DslResponse): string => {
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return (r.body as { text: string }).text;
    };
    const refused = (r: DslResponse, status = 400): string => {
      expect(r.status).toBe(status);
      return (r.body as { error: string }).error;
    };
    const order = (text: string): string[] => parseBoard("b", text).items.map((it) => it.id);

    it("is the object it reads as, to the byte", async () => {
      const got = ok(await post("/patch", { text: BOARD, ops: [{ insert: FENCE, after: "one" }] }));
      const direct = applyPatch(BOARD, [
        {
          insert: { type: "md", attrs: { id: "kintro", x: 0, y: 0, w: 1560, page: "k3s" }, body: "## With k3s\nText." },
          after: "one",
        },
      ]);
      if (!direct.ok) throw new Error(direct.error);
      expect(got).toBe(stampItems(direct.text));
      expect(order(got)).toEqual(["one", "kintro", "infra"]);
    });

    it("lands several fences and the prose between them in order, giving the unnamed an id of their own", async () => {
      const text = '```arch {#net}\nservice gw "Gateway"\n```\n\nA paragraph between.\n\n```md\nNo id here.\n```';
      const got = ok(await post("/patch", { text: BOARD, ops: [{ insert: text, after: "one" }] }));
      const ids = order(got);
      expect(ids.slice(0, 2)).toEqual(["one", "net"]);
      expect(ids.at(-1)).toBe("infra");
      /* Minted in the page's shape, never a counter's `md-3` that the next parse could renumber. */
      expect(ids.slice(2, 4)).toEqual([expect.stringMatching(/^md-[a-z0-9]{4}$/), expect.stringMatching(/^md-[a-z0-9]{4}$/)]);
      expect(got).toContain("A paragraph between.");
      expect(got).toContain("No id here.");
    });

    it("appends with no `after`, and keeps a note a note", async () => {
      const got = ok(await post("/patch", { text: BOARD, ops: [{ insert: "```note {#n1}\nRemember.\n```" }] }));
      expect(order(got).at(-1)).toBe("n1");
      expect(parseBoard("b", got).items.find((it) => it.id === "n1")?.note).toBe(true);
    });

    it("refuses, by name, what the board would have reported rather than drawn", async () => {
      const at = async (insert: string) => refused(await post("/patch", { text: BOARD, ops: [{ insert }] }));
      expect(await at("   ")).toContain("holds no item");
      expect(await at("---\ntitle: x\n---\n```md\nhi\n```")).toContain("`{meta: {...}}`");
      expect(await at("```mermaid\ngraph LR\n```")).toContain("unknown item type `mermaid`");
      expect(await at("```md {#a}\nx\n```\n\n```md {#a}\ny\n```")).toContain("`a` is written twice");
      expect(await at('```md {#a title="open}\nx\n```')).toMatch(/^op 0: EB_/);
      expect(refused(await post("/patch", { text: BOARD, ops: [{ insert: FENCE, after: 4 }] }))).toContain("`after`");
    });

    it("leaves an id already on the board, or one after nothing, to the patcher's own refusal", async () => {
      const taken = await post("/patch", { text: BOARD, ops: [{ insert: "```md {#one}\nagain\n```" }] });
      expect(refused(taken, 404)).toContain("an item `one` already exists");
      const nowhere = await post("/patch", { text: BOARD, ops: [{ insert: FENCE, after: "nope" }] });
      expect(refused(nowhere, 404)).toContain("no item `nope`");
    });

    it("does not mint an id another op in the same patch names", async () => {
      /* Two inserts naming one id would both land, and the board would renumber the second. */
      const twice = {
        text: BOARD,
        ops: [
          { insert: { type: "md", attrs: { id: "x" }, body: "a" } },
          { insert: { type: "md", attrs: { id: "x" }, body: "b" } },
        ],
      };
      expect(refused(await post("/patch", twice), 404)).toContain("two inserts name the id `x`");
    });
  });

  it("refuses an op whose parts are the wrong shape, rather than throwing inside the patcher", async () => {
    for (const op of [
      { id: "one", body: 4 },
      { id: "one", move: 7 },
      { id: "one", move: { above: "infra" } },
      { id: "one", type: ["md"] },
      { id: "one", attrs: [1] },
    ]) {
      const r = await post("/patch", { text: BOARD, ops: [op] });
      expect(r.status, JSON.stringify(op)).toBe(400);
      expect((r.body as { error: string }).error).toContain("op 0 is not an op: expected `ops:");
    }
    /* …and still takes every shape that is one. */
    for (const op of [
      { id: "one", move: "front" },
      { id: "one", move: { after: "infra" } },
      { id: "one", body: "b" },
    ]) {
      expect((await post("/patch", { text: BOARD, ops: [op] })).status, JSON.stringify(op)).toBe(200);
    }
  });

  it("refuses a list that is not one in the words the route uses for it", async () => {
    /* The route refuses an `ops` that is not a list before it calls here; a caller is told one thing. */
    const r = await post("/patch", { text: BOARD, ops: "nope" });
    const route = fs.readFileSync(path.resolve(__dirname, "../server/routes/docs.ts"), "utf8");
    expect(route).toContain("throw err(400, OPS_SHAPE)");
    expect((r.body as { error: string }).error).toBe(OPS_SHAPE);
  });
});

describe("diagnose", () => {
  it("is diagnoseBoard, to the byte", async () => {
    const r = await get("/health");
    expect(r.status).toBe(200);
    const bad = BOARD.replace("api --> db", "api --> nope");
    const got = await post("/diagnose", { name: "b", text: bad });
    expect(got.status).toBe(200);
    expect(got.body).toEqual(diagnoseBoard(parseBoard("b", bad)));
  });

  it("finds the unknown id and names it with a code, not a message", async () => {
    const bad = BOARD.replace("api --> db", "api --> nope");
    const r = await post("/diagnose", { name: "b", text: bad });
    const codes = JSON.stringify(r.body);
    expect(codes).toContain("E_UNKNOWN_ID");
  });

  it("is clean on a board that is clean", async () => {
    const r = await post("/diagnose", { name: "b", text: BOARD });
    expect(JSON.stringify(r.body)).not.toContain("E_");
  });
});

describe("diagnose, for a quiz", () => {
  const QUIZ = "---\ntitle: Q\n---\n\n## One? {#q1}\n\n- [x] yes\n- [ ] no\n\n## Two?\n\n- [ ] a\n- [ ] b\n";

  it("is parseQuiz's count and codes — what `anydag quiz check` printed from its own parse", async () => {
    const r = await post("/diagnose", { text: QUIZ, kind: "quiz" });
    expect(r.status).toBe(200);
    const quiz = parseQuiz(QUIZ);
    expect(r.body).toEqual({ questions: quiz.questions.length, diagnostics: quiz.diagnostics });
    const codes = (r.body as { diagnostics: { code: string }[] }).diagnostics.map((d) => d.code);
    /* Two's options have nothing ticked, and it has no id yet: one error, one warning. */
    expect(codes).toContain("EQ_NO_ANSWER");
    expect(codes).toContain("WQ_NO_ID");
  });

  it("reads a board as a board when no kind is said", async () => {
    expect(await post("/diagnose", { name: "b", text: BOARD })).toEqual({
      status: 200,
      body: diagnoseBoard(parseBoard("b", BOARD)),
    });
  });
});

describe("quiz", () => {
  const QUIZ =
    "---\ntitle: Q\n---\n\nWhat it is about.\n\n## One? {#q1}\n\n- [x] yes\n- [ ] no\n\n> Because.\n\n## Two?\n\n- [ ] a\n- [x] b\n";

  it("answers the questions as data, the correct options marked, without writing ids unless asked", async () => {
    const r = await post("/quiz", { text: QUIZ });
    expect(r.status).toBe(200);
    const body = r.body as {
      text: string;
      changed: boolean;
      description: string;
      questions: { id: string | null; prompt: string; options: { text: string; correct: boolean }[]; why: string }[];
    };
    expect(body.changed).toBe(false);
    expect(body.text).toBe(QUIZ);
    expect(body.description).toBe("What it is about.");
    expect(body.questions.map((q) => [q.id, q.prompt])).toEqual([
      ["q1", "One?"],
      [null, "Two?"],
    ]);
    expect(body.questions[0]!.options).toEqual([
      { text: "yes", correct: true, pinned: false },
      { text: "no", correct: false, pinned: false },
    ]);
    expect(body.questions[0]!.why).toBe("Because.");
  });

  it("with `stamp`, writes an id on every question that lacks one and on nothing else", async () => {
    const body = (await post("/quiz", { text: QUIZ, stamp: true })).body as {
      text: string;
      changed: boolean;
      questions: { id: string | null }[];
    };
    expect(body.changed).toBe(true);
    expect(body.questions[0]!.id).toBe("q1");
    expect(body.questions[1]!.id).toMatch(/^q[0-9a-z]+$/);
    expect(body.text).toContain(`## Two? {#${body.questions[1]!.id}}`);
    expect(body.text.replace(/ \{#q[0-9a-z]+\}(?=\n\n- \[ \] a)/, "")).toBe(QUIZ);
    /* A stamped quiz stamps to itself. */
    expect(((await post("/quiz", { text: body.text, stamp: true })).body as { changed: boolean }).changed).toBe(false);
  });

  it("refuses a missing text", async () => {
    expect((await post("/quiz", {})).status).toBe(400);
  });
});

describe("search", () => {
  const texts = {
    plan: "---\ntitle: The plan\n---\n\n```md {#a}\nPayments settle overnight.\n```\n",
    "notes/n.note.md": "---\ntitle: A note\n---\nNothing about money here.\n",
  };

  const docsOf = async () => {
    const docs = ((await post("/corpus", { texts })).body as { docs: Record<string, { title?: string; units: unknown[] }> }).docs;
    return Object.entries(docs).map(([key, d], i) => ({
      id: `id${i}`,
      name: key.replace(/\.note\.md$/, ""),
      kind: key.endsWith(".note.md") ? "note" : "board",
      title: d.title,
      units: d.units,
    }));
  };

  it("is the page's engine over the corpus: the same hits, in the same order, with the same marks", async () => {
    const docs = await docsOf();
    const r = await post("/search", { docs, q: "pay sett" });
    expect(r.status).toBe(200);
    const direct = search(buildEngine(docs as never), "pay sett");
    const hits = (r.body as { hits: { name: string; part: string | null; snippet: string; runs: unknown }[] }).hits;
    expect(hits.map((h) => [h.name, h.part])).toEqual(direct.map((h) => [h.doc.name, h.unit.part ?? null]));
    expect(hits[0]!.name).toBe("plan");
    expect(hits[0]!.part).toBe("a");
    expect(hits[0]!.runs).toEqual(snippet(direct[0]!.unit.text, direct[0]!.terms));
    expect(hits[0]!.snippet).toBe("**Payments** **settle** overnight.");
  });

  it("takes a limit, and refuses one that is not a count", async () => {
    const docs = await docsOf();
    expect(((await post("/search", { docs, q: "the", limit: 1 })).body as { hits: unknown[] }).hits.length).toBeLessThanOrEqual(
      1,
    );
    expect((await post("/search", { docs, q: "x", limit: 0 })).status).toBe(400);
    expect((await post("/search", { docs: "no", q: "x" })).status).toBe(400);
    expect((await post("/search", { docs })).status).toBe(400);
  });

  it("keeps the engine a version names, and asks for the docs when it holds none", async () => {
    const docs = await docsOf();
    const version = `test:${Math.random()}`;
    const first = await post("/search", { docs, q: "pay sett", version });
    expect(first.status).toBe(200);
    // Named alone, the version answers from the engine built a moment ago — the same hits.
    const again = await post("/search", { q: "pay sett", version });
    expect(again.body).toEqual(first.body);
    // A version nothing was built for is a 412 asking for the docs, never an empty answer.
    const unknown = await post("/search", { q: "pay sett", version: `${version}-other` });
    expect(unknown.status).toBe(412);
    expect((unknown.body as { code: string }).code).toBe("docs");
  });

  it("finds nothing for an empty query rather than everything", async () => {
    expect(((await post("/search", { docs: await docsOf(), q: "  " })).body as { hits: unknown[] }).hits).toEqual([]);
  });
});

describe("fences", () => {
  it("is scanFences", async () => {
    const r = await post("/fences", { text: BOARD });
    expect(r.body).toEqual({ fences: scanFences(BOARD) });
    expect((r.body as { fences: unknown[] }).fences).toHaveLength(2);
  });
});

describe("library", () => {
  it("serves every blueprint, and is libraryList", async () => {
    const r = await get("/library");
    const b = r.body as { blueprints: unknown[] };
    expect(b.blueprints).toEqual(libraryList());
    expect(b.blueprints.length).toBeGreaterThan(0);
  });

  it("narrows by type", async () => {
    const r = await get("/library", "type=arch");
    expect((r.body as { blueprints: unknown[] }).blueprints).toEqual(libraryList("arch"));
  });

  /* The pictures are accounted for rather than listed, and `q` is how one is found. */
  it("says how many pictures it left out, and lists the ones a search finds", async () => {
    const plain = (await get("/library")).body as { objects: { total: number; listed: number } };
    expect(plain.objects.total).toBeGreaterThan(1600);
    expect(plain.objects.listed).toBe(0);
    const found = (await get("/library", "q=delivery%20truck")).body as { blueprints: { id: string }[] };
    expect(found.blueprints.map((b) => b.id)).toContain("object-delivery-truck");
  });

  /* The saved components are board *files*, so they are `api`'s to read and merge in. A `saved`
     key appearing here would mean this service had learned where boards live. */
  it("does not pretend to know about saved components", async () => {
    const r = await get("/library");
    expect(r.body).not.toHaveProperty("saved");
  });

  it("404s on a blueprint id nothing has", async () => {
    const r = await get("/library", "id=not-a-blueprint");
    expect(r.status).toBe(404);
  });
});

describe("icons", () => {
  it("narrows by q and says how a name draws", async () => {
    const r = await get("/icons", "q=postgresql");
    const b = r.body as { icons: { name: string; mode: string }[] };
    expect(b.icons.map((i) => i.name)).toContain("postgresql");
  });

  it("refuses a mode outside the three, naming them", async () => {
    const r = await get("/icons", "mode=sideways");
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toContain("brand");
  });
});

describe("dsl", () => {
  const DOCS = path.resolve(import.meta.dirname, "../docs/dsl");

  it("lists every cheat sheet on disk", async () => {
    const r = await get("/dsl");
    const want = fs
      .readdirSync(DOCS)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort();
    expect((r.body as { types: string[] }).types).toEqual(want);
  });

  it("serves one, verbatim", async () => {
    const r = await get("/dsl", "type=arch");
    expect((r.body as { text: string }).text).toBe(fs.readFileSync(path.join(DOCS, "arch.md"), "utf8"));
  });

  it("refuses a name that would escape the cheat sheets", async () => {
    const r = await get("/dsl", "type=../../package");
    expect(r.status).toBe(403);
  });

  it("404s on a sheet that does not exist", async () => {
    const r = await get("/dsl", "type=nope");
    expect(r.status).toBe(404);
  });
});

describe("check", () => {
  const REPLY = 'Here you go:\n\n```arch {#x}\nservice api "API" icon=server\n```\n';

  it("finds the fence, scores it, and hands back the next turn", async () => {
    const r = await post("/check", { reply: REPLY });
    const b = r.body as { found: boolean; draft: { type: string }; errors: number; fixable: number };
    expect(b.found).toBe(true);
    expect(b.draft.type).toBe("arch");
    expect(b.errors).toBe(0);
    expect(b.fixable).toBe(0);
  });

  it("drops the attributes that say where the diagram goes", async () => {
    const r = await post("/check", { reply: '```arch {#x x=40 y=90 page=page-2 title="Keep me"}\nservice a "A"\n```' });
    const attrs = (r.body as { draft: { attrs: Record<string, unknown> } }).draft.attrs;
    expect(attrs).toHaveProperty("title");
    for (const k of ["x", "y", "page", "id"]) expect(attrs).not.toHaveProperty(k);
  });

  it("counts a wrong type as an error and says what was asked for", async () => {
    const r = await post("/check", { reply: REPLY, as: "erd" });
    const b = r.body as { errors: number; wrongType: { want: string; got: string }; feedback: string };
    expect(b.wrongType).toEqual({ want: "erd", got: "arch" });
    expect(b.errors).toBeGreaterThan(0);
    expect(b.feedback).toContain("erd");
  });

  it("separates a fixable warning from a judgement, because the loop stops on the count", async () => {
    const r = await post("/check", { reply: '```arch {#x}\nservice api "API" icon=postgre-sql\n```' });
    const b = r.body as { errors: number; fixable: number; feedback: string };
    expect(b.errors).toBe(0);
    expect(b.fixable).toBe(1);
    expect(b.feedback).toContain("W_UNKNOWN_ICON");
  });

  /* The defect with no symptom: a model asked to rewrite quotes the original first, and taking the
     first fence silently replaces a diagram with itself on attempt one. */
  it("refuses a rewrite that echoes its source", async () => {
    const source = 'service api "API" icon=server';
    const r = await post("/check", { reply: "```arch {#x}\n" + source + "\n```", source });
    const b = r.body as { found: boolean; none: string };
    expect(b.found).toBe(false);
    expect(b.none).toContain("unchanged");
  });

  it("takes the last fence in rewrite mode and the first otherwise", async () => {
    const two = '```arch {#a}\nservice a "A"\n```\n\n```arch {#b}\nservice b "B"\n```';
    const fresh = await post("/check", { reply: two });
    expect((fresh.body as { draft: { body: string } }).draft.body).toContain('"A"');
    const rewrite = await post("/check", { reply: two, source: 'service z "Z"' });
    expect((rewrite.body as { draft: { body: string } }).draft.body).toContain('"B"');
  });

  it("says so when there is no diagram at all", async () => {
    const r = await post("/check", { reply: "I'd rather not." });
    const b = r.body as { found: boolean; none: string };
    expect(b.found).toBe(false);
    expect(b.none).toContain("could not find a diagram");
  });

  it("refuses an `as` that is not a diagram type", async () => {
    const r = await post("/check", { reply: REPLY, as: "flowchart" });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toContain("flowchart");
  });
});

describe("routing", () => {
  it("404s a route it does not have, naming it", async () => {
    const r = await get("/nope");
    expect(r.status).toBe(404);
    expect((r.body as { error: string }).error).toContain("/nope");
  });

  it("does not answer a GET on a POST route", async () => {
    expect((await get("/patch")).status).toBe(404);
  });
});

describe("system", () => {
  it("assembles the guide, the grammar and the library from files in this repo", async () => {
    const r = await get("/system");
    const text = (r.body as { system: string }).system;
    // None of this is a string in any source file: the grammar changes in the commit that changes
    // the parser, and a prompt that restated it would be the one copy nobody updates.
    expect(text).toContain("# The grammar");
    expect(text).toContain("# The library");
    for (const type of ["arch", "erd", "sequence", "chart", "sketch"]) {
      expect(text).toContain(`## Grammar: \`${type}\``);
    }
  });

  it("narrows to one type, which is a far smaller prompt", async () => {
    const all = ((await get("/system")).body as { system: string }).system;
    const one = ((await get("/system", "as=arch")).body as { system: string }).system;
    expect(one).toContain("## Grammar: `arch`");
    expect(one).not.toContain("## Grammar: `erd`");
    expect(one).toContain("The person asked for a `arch` diagram");
    expect(one.length).toBeLessThan(all.length / 2);
  });

  it("says what a rewrite is, and only in rewrite mode", async () => {
    expect(((await get("/system", "mode=rewrite")).body as { system: string }).system).toContain("Rewriting an existing diagram");
    expect(((await get("/system")).body as { system: string }).system).not.toContain("Rewriting an existing diagram");
  });

  it("refuses an `as` that is not a diagram type", async () => {
    expect((await get("/system", "as=flowchart")).status).toBe(400);
  });
});

describe("a table", () => {
  const TABLE =
    "---\ntitle: T\n---\n\n## Deals {#deals}\n\n| Name {#name} | Amount {#amount number} |\n| --- | ---: |\n| Acme {#racme} | 12 |\n| [Plan](dag:0123456789) {#rplan} | x |\n";

  it("is `tableData` over the text, and the ops applied when there are any", async () => {
    expect((await post("/table", { text: TABLE })).body).toEqual({ text: TABLE, changed: false, table: tableData(TABLE) });
    const ops = [{ op: "cell", tab: "deals", row: "racme", column: "amount", value: "13" }];
    const applied = applyTableOps(TABLE, ops);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect((await post("/table", { text: TABLE, ops })).body).toEqual({
      text: applied.text,
      changed: true,
      minted: applied.minted,
      table: tableData(applied.text),
    });
  });

  it("refuses the whole list on what is not there, and on a shape it cannot read", async () => {
    expect(await post("/table", { text: TABLE, ops: [{ op: "removeRow", tab: "deals", row: "nope" }] })).toEqual({
      status: 404,
      body: { error: "no row `nope` in the tab `deals`" },
    });
    expect((await post("/table", { text: TABLE, ops: {} })).status).toBe(400);
    expect((await post("/table", { text: TABLE, ops: [{ op: "cell" }] })).status).toBe(400);
    expect((await post("/table", {})).status).toBe(400);
  });

  it("diagnoses a table with its own codes", async () => {
    expect((await post("/diagnose", { name: "t", text: TABLE, kind: "table" })).body).toEqual({
      tabs: 1,
      rows: 2,
      diagnostics: tableDiagnostics(parseTable(TABLE)),
    });
  });

  it("reads a table's references out of its cells, and cuts it into a unit per row", async () => {
    const index = (await post("/index", { texts: { "t.table.md": TABLE } })).body as {
      docs: Record<string, { title?: string; refs: { id: string }[] }>;
    };
    expect(index.docs["t.table.md"]!.title).toBe("T");
    expect(index.docs["t.table.md"]!.refs.map((r) => r.id)).toEqual(["0123456789"]);
    const corpus = (await post("/corpus", { texts: { "t.table.md": TABLE } })).body as {
      docs: Record<string, { units: { part?: string; what: string; text: string }[] }>;
    };
    expect(corpus.docs["t.table.md"]!.units).toEqual([
      { what: "title", text: "T" },
      { part: "deals", what: "tab", text: "Deals Name Amount" },
      { part: "deals/racme", what: "row", text: "Acme 12" },
      { part: "deals/rplan", what: "row", text: "Plan x" },
    ]);
  });
});

/**
 * `test/fixtures/dsl-answers.json` is this handler's answers, recorded from the routes the MCP
 * tools call and kept as a golden: a change to what the grammar answers shows up here as a
 * diff to read.
 */
describe("the grammar's recorded answers", () => {
  const recorded = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures/dsl-answers.json"), "utf8")) as Record<
    string,
    { body: Record<string, unknown>; answer: unknown; status?: number }
  >;
  const routes: Record<string, string> = {
    quiz: "/quiz",
    quizStamp: "/quiz",
    quizOps: "/quiz",
    quizOpsRefused: "/quiz",
    quizDiagnose: "/diagnose",
    corpus: "/corpus",
    search: "/search",
    table: "/table",
    tableView: "/table",
    tableStamp: "/table",
    tableOps: "/table",
    tableDiagnose: "/diagnose",
    patchInsert: "/patch",
    patchRefused: "/patch",
  };

  for (const [key, route] of Object.entries(routes)) {
    it(`${key} is what ${route} answers now`, async () => {
      const { body, answer, status = 200 } = recorded[key]!;
      const r = await post(route, body);
      expect(r.status).toBe(status);
      const got = r.body as { questions?: { id: string | null }[] };
      if (key === "quizStamp") {
        /* The one id minted is random; the recording spells it `qstub01`. */
        const minted = got.questions!.find((q) => q.id && !String(body.text).includes(`{#${q.id}}`))!.id!;
        expect(JSON.parse(JSON.stringify(got).split(minted).join("qstub01"))).toEqual(answer);
      } else {
        expect(got).toEqual(answer);
      }
    });
  }
});
