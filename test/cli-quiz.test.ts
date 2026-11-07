import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { kindQuery } from "../cli/board";
import { handle } from "../server/handle";
import type { Io } from "../cli/context";
import { main } from "./cli-reach";

/**
 * `anydag quiz`. The answers stubbed here are the routes' own shapes — `/__board/get`'s
 * `{name, id, text, base}`, `/__board/list`'s `quizzes` and `questions`, `/api/practice`'s
 * `{graduate, pool, counts}` — copied from `server/routes/`, `test/cli-main.test.ts`'s rule.
 */

function recorder(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      write: (c) => out.push(String(c)),
      stdinIsTTY: false,
      stdoutIsTTY: false,
      readStdin: async () => "",
      ask: async () => "",
    },
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

function server(answer: (s: Seen) => Response): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const s: Seen = { method: init.method ?? "GET", path: `${u.pathname}${u.search}`, body: init.body ? JSON.parse(String(init.body)) : undefined };
    seen.push(s);
    return answer(s);
  });
  return seen;
}

let dir: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-cli-quiz-"));
  env = {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

const GOOD = "---\ntitle: Drill\n---\n\n## One? {#qa}\n- [x] y\n- [ ] n\n";
const BAD = "## One? {#qa}\n- [ ] y\n- [ ] n\n\n## Two {#qa}\n- [x] y\n- [ ] n\n";

describe("a quiz on the wire", () => {
  it("says kind=quiz, as a note says kind=note, and a board says nothing", () => {
    // The first version sent anything that was not a note as a board: `quiz new` made a `.board.md`.
    expect(kindQuery("quiz")).toBe("quiz");
    expect(kindQuery("note")).toBe("note");
    expect(kindQuery("board")).toBeUndefined();
  });

  it("is read as a quiz by `quiz cat`", async () => {
    const seen = server(() => json(200, { name: "drill", id: "0123456789", text: GOOD, base: "b1" }));
    const r = recorder();
    expect(await main(["quiz", "cat", "drill"], r.io, env)).toBe(0);
    expect(seen[0]!.path).toBe("/__board/get?name=drill&kind=quiz");
    expect(r.out.join("")).toBe(GOOD);
  });
});

/** `GET /__board/diagnostics?kind=quiz` as the api answers it: the grammar service's `/diagnose`, forwarded. */
const diagnosed = async (text: string) => (await handle({ method: "POST", route: "/diagnose", query: new URLSearchParams(), body: { text, kind: "quiz" } })).body;

describe("quiz check", () => {
  it("asks the route, prints each problem with its line and code, and exits 4 on an error", async () => {
    const answer = await diagnosed(BAD);
    const seen = server(() => json(200, answer));
    const r = recorder();
    expect(await main(["quiz", "check", "drill"], r.io, env)).toBe(4);
    expect(seen[0]!.path).toBe("/__board/diagnostics?name=drill&kind=quiz");
    expect(r.out).toEqual([
      "2:1 error EQ_NO_ANSWER No option is marked correct. Tick the right one with `- [x]`.",
      "5:1 error EQ_DUPLICATE_ID Another question already has the id `qa`. Give this one its own.",
    ]);
  });

  it("exits 0 on a quiz with nothing wrong, and --json is the route's answer", async () => {
    const answer = await diagnosed(GOOD);
    server(() => json(200, answer));
    const r = recorder();
    expect(await main(["quiz", "check", "drill"], r.io, env)).toBe(0);
    expect(r.err.at(-1)).toMatch(/1 question\(s\), nothing wrong/);
    const j = recorder();
    expect(await main(["quiz", "check", "drill", "--json"], j.io, env)).toBe(0);
    expect(JSON.parse(j.out.join(""))).toEqual({ questions: 1, diagnostics: [] });
  });
});

describe("quiz practice", () => {
  /** Two questions, the second with no id yet — which a run gives it before it starts. */
  const QUIZ = "---\ntitle: Drill\n---\n\n## One? {#qa}\n- [x] yes\n- [ ] no\n\n> Because.\n\n## Two?\n- [ ] a\n- [x] b\n";

  /** A terminal, with answers typed in the order the questions are asked. */
  function terminal(typed: string[]): ReturnType<typeof recorder> & { asked: string[] } {
    const r = recorder();
    const asked: string[] = [];
    return { ...r, asked, io: { ...r.io, stdinIsTTY: true, ask: async (q: string) => (asked.push(q), typed.shift() ?? "q") } };
  }

  function quizServer(): { seen: Seen[]; text: () => string } {
    let text = QUIZ;
    let base = "b1";
    const seen = server((s) => {
      if (s.path.startsWith("/__board/get")) return json(200, { name: "drill", id: "0123456789", text, base });
      if (s.path.startsWith("/__board/put")) {
        text = (s.body as { text: string }).text;
        base = "b2";
        return json(200, { base, text });
      }
      if (s.path === "/api/practice" && s.method === "POST") return json(200, { graduate: 2, stats: {} });
      return json(404, { error: `no route ${s.path}` });
    });
    return { seen, text: () => text };
  }

  it("gives a question with no id one first, asks each, says right or wrong, and records every answer", async () => {
    const { seen, text } = quizServer();
    const t = terminal(["1", "1"]);
    expect(await main(["quiz", "practice", "drill"], t.io, env)).toBe(0);
    /* The id was written, under the base that was read, before anything was asked. */
    const put = seen.find((s) => s.path.startsWith("/__board/put"))!;
    expect(put.path).toBe("/__board/put?name=drill&kind=quiz");
    expect(put.body).toMatchObject({ base: "b1" });
    const minted = /## Two\? \{#(q[0-9a-z]+)\}/.exec(text())![1]!;
    expect(t.out).toContain("1/2  One?");
    expect(t.out).toContain("  1. yes");
    expect(t.out).toContain("right");
    expect(t.out).toContain("> Because.");
    expect(t.out).toContain("wrong — the answer is 2");
    const posted = seen.filter((s) => s.path === "/api/practice").map((s) => s.body);
    expect(posted).toEqual([
      { events: [{ quiz: "0123456789", question: "qa", correct: true, run: "quiz" }] },
      { events: [{ quiz: "0123456789", question: minted, correct: false, run: "quiz" }] },
    ]);
    expect(t.err.at(-1)).toBe("1/2 right — 1 went into Mistakes");
  });

  it("asks again until it is an answer, and q stops a run keeping what was answered", async () => {
    const { seen } = quizServer();
    const t = terminal(["7", "one", "1", "q"]);
    expect(await main(["quiz", "practice", "drill"], t.io, env)).toBe(0);
    expect(t.asked).toHaveLength(4);
    expect(t.err).toContain("type one number, 1 to 2");
    expect(seen.filter((s) => s.path === "/api/practice")).toHaveLength(1);
    expect(t.err.at(-1)).toBe("1/1 right");
  });

  it("s skips a question, recording nothing, and the end offers the skipped ones again", async () => {
    const { seen, text } = quizServer();
    const t = terminal(["s", "2", "y", "1"]);
    expect(await main(["quiz", "practice", "drill"], t.io, env)).toBe(0);
    const minted = /## Two\? \{#(q[0-9a-z]+)\}/.exec(text())![1]!;
    expect(t.asked[2]).toBe("answer the 1 skipped? (y/n) ");
    /* The skipped one is asked again, as a round of one. */
    expect(t.out).toContain("1/1  One?");
    expect(seen.filter((s) => s.path === "/api/practice").map((s) => s.body)).toEqual([
      { events: [{ quiz: "0123456789", question: minted, correct: true, run: "quiz" }] },
      { events: [{ quiz: "0123456789", question: "qa", correct: true, run: "quiz" }] },
    ]);
    expect(t.err.at(-1)).toBe("2/2 right");
  });

  it("says what was left skipped when the offer is declined, or the run stopped", async () => {
    const declined = quizServer();
    const t = terminal(["s", "2", "n"]);
    expect(await main(["quiz", "practice", "drill"], t.io, env)).toBe(0);
    expect(declined.seen.filter((s) => s.path === "/api/practice")).toHaveLength(1);
    expect(t.err.at(-1)).toBe("1/1 right — 1 skipped");
    quizServer();
    const j = terminal(["s", "q"]);
    expect(await main(["quiz", "practice", "drill", "--json"], j.io, env)).toBe(0);
    expect(j.asked, "stopping offers nothing").toHaveLength(2);
    expect(JSON.parse(j.out.filter((l) => l.startsWith("{")).join(""))).toEqual({ run: "quiz", asked: 0, right: 0, wrong: 0, skipped: 1 });
  });

  it("prints the quiz's description before its first question", async () => {
    server((s) => {
      if (s.path.startsWith("/__board/get"))
        return json(200, { name: "drill", id: "0123456789", text: QUIZ.replace("## One?", "Read the docs first.\n\n## One?").replace("## Two?", "## Two? {#qb}"), base: "b1" });
      if (s.path === "/api/practice" && s.method === "POST") return json(200, { graduate: 2, stats: {} });
      return json(404, { error: "no route" });
    });
    const t = terminal(["1", "2"]);
    expect(await main(["quiz", "practice", "drill"], t.io, env)).toBe(0);
    const at = t.out.indexOf("Read the docs first.");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(t.out.indexOf("1/2  One?"));
    expect(t.out.filter((l) => l === "Read the docs first.")).toHaveLength(1);
  });

  it("prints an option holding a code block indented under its number", async () => {
    const CODE = "## Which? {#qa}\n- [x] This\n  ```sql\n  select 1;\n  ```\n- [ ] That\n";
    server((s) => {
      if (s.path.startsWith("/__board/get")) return json(200, { name: "drill", id: "0123456789", text: CODE, base: "b1" });
      if (s.path === "/api/practice" && s.method === "POST") return json(200, { graduate: 2, stats: {} });
      return json(404, { error: "no route" });
    });
    const t = terminal(["1"]);
    expect(await main(["quiz", "practice", "drill"], t.io, env)).toBe(0);
    expect(t.out).toContain("  1. This\n     ```sql\n     select 1;\n     ```");
    expect(t.out).toContain("  2. That");
  });

  it("asks an open question in words, shows the model answer, and records the person's verdict", async () => {
    const OPEN = "## Write it {#qo}\n\nEvery member.\n\n> ```sql\n> select * from cd.members;\n> ```\n\n## Then {#qb}\n- [x] y\n- [ ] n\n";
    const seen = server((s) => {
      if (s.path.startsWith("/__board/get")) return json(200, { name: "drill", id: "0123456789", text: OPEN, base: "b1" });
      if (s.path === "/api/practice" && s.method === "POST") return json(200, { graduate: 2, stats: {} });
      return json(404, { error: "no route" });
    });
    const t = terminal(["select *", "from cd.members;", "", "maybe", "n", "s", "n"]);
    expect(await main(["quiz", "practice", "drill"], t.io, env)).toBe(0);
    expect(t.out).toContain("the model answer:");
    expect(t.out).toContain("> ```sql\n> select * from cd.members;\n> ```");
    expect(t.err).toContain("type y if your answer says what the model answer says, n if it does not");
    expect(seen.filter((s) => s.path === "/api/practice").map((s) => s.body)).toEqual([
      { events: [{ quiz: "0123456789", question: "qo", correct: false, run: "quiz" }] },
    ]);
    expect(t.err.at(-1)).toBe("0/1 right — 1 went into Mistakes, 1 skipped");
  });

  it("shows a shuffled quiz's options in an order of its own, and grades the option behind the number", async () => {
    const SHUFFLED = "---\nshuffle: true\n---\n## Which? {#qa}\n- [x] right\n- [ ] wrong\n- [ ] also wrong\n- [ ] None of the above\n";
    const seen = server((s) => {
      if (s.path.startsWith("/__board/get")) return json(200, { name: "drill", id: "0123456789", text: SHUFFLED, base: "b1" });
      if (s.path === "/api/practice" && s.method === "POST") return json(200, { graduate: 2, stats: {} });
      return json(404, { error: "no route" });
    });
    /* `Math.random` at 0 every time turns [0, 1, 2] into [1, 2, 0], and the pinned fourth stays. */
    vi.spyOn(Math, "random").mockReturnValue(0);
    const t = terminal(["3"]);
    expect(await main(["quiz", "practice", "drill"], t.io, env)).toBe(0);
    vi.restoreAllMocks();
    expect(t.out.filter((l) => /^ {2}\d\. /.test(l))).toEqual(["  1. wrong", "  2. also wrong", "  3. right", "  4. None of the above"]);
    expect(seen.filter((s) => s.path === "/api/practice").map((s) => s.body)).toEqual([
      { events: [{ quiz: "0123456789", question: "qa", correct: true, run: "quiz" }] },
    ]);
  });

  it("runs every quiz under a folder as one run, each answer recorded against its own quiz", async () => {
    const texts: Record<string, string> = {
      "course/2-joins": "## Join? {#qj}\n- [x] y\n- [ ] n\n",
      "course/10-windows": "## Window? {#qw}\n- [ ] y\n- [x] n\n",
      "course/deeper/extra": "## Extra? {#qe}\n- [x] y\n- [ ] n\n",
    };
    const ids: Record<string, string> = { "course/2-joins": "id0000002j", "course/10-windows": "id000010w0", "course/deeper/extra": "id00000ex0" };
    const seen = server((s) => {
      const u = new URL(`http://x${s.path}`);
      if (u.pathname === "/__board/get") {
        const name = u.searchParams.get("name")!;
        return texts[name] ? json(200, { name, id: ids[name], text: texts[name], base: "b" }) : json(404, { error: `no quiz \`${name}\`` });
      }
      if (u.pathname === "/__board/list")
        return json(200, {
          quizzes: Object.keys(texts),
          ids,
          titles: { "course/2-joins": "2 · Joins", "course/10-windows": "10 · Windows", "course/deeper/extra": "Extra" },
        });
      if (s.path === "/api/practice" && s.method === "POST") return json(200, { graduate: 2, stats: {} });
      return json(404, { error: "no route" });
    });
    const t = terminal(["1", "2", "2"]);
    expect(await main(["quiz", "practice", "course/"], t.io, env)).toBe(0);
    /* The sidebar's order: the subfolder first, then 2 before 10. */
    expect(t.out.filter((l) => /^\d\/3 /.test(l))).toEqual(["1/3  course/deeper/extra  Extra?", "2/3  course/2-joins  Join?", "3/3  course/10-windows  Window?"]);
    expect(seen.filter((s) => s.path === "/api/practice").map((s) => (s.body as { events: unknown[] }).events[0])).toEqual([
      { quiz: "id00000ex0", question: "qe", correct: true, run: "quiz" },
      { quiz: "id0000002j", question: "qj", correct: false, run: "quiz" },
      { quiz: "id000010w0", question: "qw", correct: true, run: "quiz" },
    ]);
  });

  it("runs Mistakes in the order the pool gives, recorded as the mistakes run", async () => {
    const stamped = QUIZ.replace("## Two?", "## Two? {#qb}");
    const seen = server((s) => {
      if (s.path === "/api/practice" && s.method === "GET")
        return json(200, {
          graduate: 2,
          pool: [
            { quiz: "0123456789", question: "qb", wrong: 1, right: 0, streak: 0, at: "t" },
            { quiz: "gone000000", question: "qz", wrong: 1, right: 0, streak: 0, at: "t" },
          ],
          counts: { "0123456789": 1 },
        });
      if (s.path.startsWith("/__board/list")) return json(200, { boards: [], notes: [], folders: [], quizzes: ["drill"], ids: { drill: "0123456789" } });
      if (s.path.startsWith("/__board/get")) return json(200, { name: "drill", id: "0123456789", text: stamped, base: "b1" });
      if (s.path === "/api/practice" && s.method === "POST") return json(200, { graduate: 2, stats: {} });
      return json(404, { error: "no route" });
    });
    const t = terminal(["2"]);
    expect(await main(["quiz", "practice", "--mistakes"], t.io, env)).toBe(0);
    expect(t.out).toContain("1/1  drill  Two?");
    expect(seen.filter((s) => s.method === "POST").map((s) => s.body)).toEqual([
      { events: [{ quiz: "0123456789", question: "qb", correct: true, run: "mistakes" }] },
    ]);
    expect(seen.some((s) => s.path.startsWith("/__board/put"))).toBe(false);
  });

  it("takes the input closing — Ctrl+D — as stopping, keeping what was answered", async () => {
    const { seen } = quizServer();
    const t = terminal(["1"]);
    let asked = 0;
    t.io.ask = async () => {
      if (asked++ === 0) return "1";
      throw new Error("Aborted with Ctrl+D");
    };
    expect(await main(["quiz", "practice", "drill"], t.io, env)).toBe(0);
    expect(seen.filter((s) => s.path === "/api/practice")).toHaveLength(1);
    expect(t.err.at(-1)).toBe("1/1 right");
  });

  it("needs a terminal, and one of a quiz or --mistakes", async () => {
    const seen = quizServer().seen;
    const r = recorder();
    expect(await main(["quiz", "practice", "drill"], r.io, env)).toBe(2);
    expect(r.err.at(-1)).toMatch(/a run asks a person: run it in a terminal/);
    const t = terminal([]);
    expect(await main(["quiz", "practice"], t.io, env)).toBe(2);
    expect(await main(["quiz", "practice", "drill", "--mistakes"], t.io, env)).toBe(2);
    expect(seen).toEqual([]);
  });
});

describe("quiz question", () => {
  /** `POST /__board/quiz`'s shape, `server/routes/docs.ts`. */
  function questionServer(ids: string[] = ["qb"]): Seen[] {
    return server((s) => {
      if (s.path === "/__board/quiz") return json(200, { name: "drill", changed: true, ids, base: "b2", text: GOOD, diagnostics: [] });
      return json(404, { error: "no route" });
    });
  }

  it("set reads the question from --file and sends one op, placed and named", async () => {
    const seen = questionServer();
    const file = path.join(dir, "q.md");
    fs.writeFileSync(file, "## Two? {#qb}\n- [x] a\n- [ ] b\n");
    const r = recorder();
    expect(await main(["quiz", "question", "set", "drill", "--file", file, "--before", "qa"], r.io, env)).toBe(0);
    expect(seen[0]!.body).toEqual({ name: "drill", ops: [{ op: "set", markdown: "## Two? {#qb}\n- [x] a\n- [ ] b\n", before: "qa" }] });
    expect(r.err[0]).toBe("wrote question qb of drill — base b2");
  });

  it("rm and mv send their op, a base when given, and refuse --before with --after", async () => {
    const seen = questionServer(["qa"]);
    const r = recorder();
    expect(await main(["quiz", "question", "rm", "drill", "qa", "--base", "b1"], r.io, env)).toBe(0);
    expect(seen[0]!.body).toEqual({ name: "drill", ops: [{ op: "remove", id: "qa" }], base: "b1" });
    expect(await main(["quiz", "question", "mv", "drill", "qa", "--after", "qb"], r.io, env)).toBe(0);
    expect(seen[1]!.body).toEqual({ name: "drill", ops: [{ op: "move", id: "qa", after: "qb" }] });
    expect(await main(["quiz", "question", "mv", "drill", "qa", "--after", "qb", "--before", "qc"], recorder().io, env)).toBe(2);
  });
});

describe("quiz ls and mistakes", () => {
  it("lists each quiz with its questions and what is in Mistakes", async () => {
    server((s) =>
      s.path.startsWith("/api/practice")
        ? json(200, { graduate: 2, pool: [{ quiz: "0123456789", question: "qa", wrong: 1, right: 0, streak: 0, at: "t" }], counts: { "0123456789": 1 } })
        : json(200, { boards: [], notes: [], folders: [], quizzes: ["drill"], questions: { drill: 3 }, ids: { drill: "0123456789" }, titles: { drill: "Drill" } }),
    );
    const r = recorder();
    expect(await main(["quiz", "ls", "--json"], r.io, env)).toBe(0);
    expect(JSON.parse(r.out.join(""))).toEqual([{ name: "drill", title: "Drill", questions: 3, mistakes: 1 }]);
    const m = recorder();
    expect(await main(["quiz", "mistakes"], m.io, env)).toBe(0);
    expect(m.out.join("\n")).toMatch(/drill\s+qa\s+0\/2 right\s+1 wrong/);
  });
});

describe("quiz threshold", () => {
  it("reads it, sets it, and refuses what is not one", async () => {
    const seen = server((s) => (s.method === "PUT" ? json(200, { graduate: 3 }) : json(200, { graduate: 2, pool: [], counts: {} })));
    const r = recorder();
    expect(await main(["quiz", "threshold"], r.io, env)).toBe(0);
    expect(r.out).toEqual(["2"]);
    expect(await main(["quiz", "threshold", "3"], r.io, env)).toBe(0);
    expect(seen.at(-1)).toMatchObject({ method: "PUT", path: "/api/practice", body: { graduate: 3 } });
    expect(await main(["quiz", "threshold", "11"], r.io, env)).toBe(2);
    expect(await main(["quiz", "threshold", "two"], r.io, env)).toBe(2);
  });
});
