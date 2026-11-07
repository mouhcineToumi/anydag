/** Ported from the hosted api's `test_practice.py`: the rule, then the `Practice` store over a temp Home. */
import "./sqlite-shim";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Home } from "../../server/home";
import {
  type Answer,
  aliveOf,
  answersOf,
  counts,
  GRADUATE,
  graduateOf,
  inPool,
  MAX_EVENTS,
  pool,
  Practice,
  PracticeRefused,
  record,
  type Records,
  statOf,
  statsOf,
} from "../../server/practice";
import { makeEnv, QUIZ, sweepTemps, type Env } from "./helpers";

const Q = "qz00000001";
const zero = { wrong: 0, right: 0, streak: 0, at: "" };
const miss = (question = "qa", run: Answer["run"] = "quiz", quiz = Q): Answer => ({ quiz, question, correct: false, run });
const hit = (question = "qa", run: Answer["run"] = "mistakes", quiz = Q): Answer => ({ quiz, question, correct: true, run });

describe("the rule", () => {
  it("a miss counts and resets the streak wherever it happens", () => {
    expect(record({ wrong: 1, right: 2, streak: 1, at: "" }, false, "quiz", "t")).toEqual({ wrong: 2, right: 2, streak: 0, at: "t" });
    expect(record({ wrong: 1, right: 2, streak: 1, at: "" }, false, "mistakes", "t").streak).toBe(0);
  });

  it("right in a quiz run counts but moves no streak", () => {
    const s = record({ ...zero, wrong: 1 }, true, "quiz", "t");
    expect([s.right, s.streak]).toEqual([1, 0]);
  });

  it("right in the mistakes run moves the streak", () => {
    let s = { ...zero, wrong: 1 };
    s = record(s, true, "mistakes", "t");
    s = record(s, true, "mistakes", "t");
    expect([s.right, s.streak]).toEqual([2, 2]);
  });

  it("is in mistakes until the streak reaches the threshold, which is read and never stored", () => {
    expect(inPool(zero, 2)).toBe(false);
    expect(inPool({ ...zero, wrong: 1, streak: 1 }, 2)).toBe(true);
    expect(inPool({ ...zero, wrong: 1, streak: 2 }, 2)).toBe(false);
    expect(inPool({ ...zero, wrong: 1, streak: 2 }, 3)).toBe(true);
  });

  it("reads a nonsense record as zero", () => {
    expect(statOf({ wrong: "many", right: -1, streak: true, at: 5 })).toEqual(zero);
    expect(statOf({ wrong: 1.5 })).toEqual(zero);
    expect(statOf(null)).toEqual(zero);
    expect(statOf([])).toEqual(zero);
    expect(statOf({ wrong: 2, at: "x" })).toEqual({ ...zero, wrong: 2, at: "x" });
  });

  it("shapes the stats a route reports", () => {
    expect(statsOf({ qa: { ...zero, wrong: 1 }, qb: zero }, 2)).toEqual({
      qa: { ...zero, wrong: 1, inPool: true },
      qb: { ...zero, inPool: false },
    });
  });
});

describe("pool", () => {
  const records = (): Records => ({
    [Q]: {
      qa: { ...zero, wrong: 1, streak: 1, at: "2026-01-01" },
      qb: { ...zero, wrong: 2, streak: 0, at: "2026-01-03" },
      qc: { ...zero, wrong: 1, streak: 0, at: "2026-01-02" },
      qd: { ...zero, wrong: 1, streak: 2, at: "2026-01-01" },
      qe: { ...zero, right: 4, at: "2026-01-01" },
      gone: { ...zero, wrong: 1, at: "2026-01-01" },
    },
    qz00000009: { qx: { ...zero, wrong: 1, at: "2026-01-01" } },
  });

  it("orders by streak, then the one not seen for longest", () => {
    const alive = new Map([[Q, new Set(["qa", "qb", "qc", "qd", "qe"])]]);
    expect(pool(records(), 2, alive).map((p) => p.question)).toEqual(["qc", "qb", "qa"]);
  });

  it("leaves out a deleted question or quiz and keeps its record", () => {
    const r = records();
    const got = pool(r, 2, new Map([[Q, new Set(["qa", "qb", "qc", "qd"])]]));
    expect(got.map((p) => p.question)).not.toContain("gone");
    expect(got.map((p) => p.question)).not.toContain("qx");
    expect(r[Q]!.gone).toBeDefined();
  });

  it("counts per quiz", () => {
    const alive = new Map([
      [Q, new Set(["qa", "qb", "qc", "qd"])],
      ["qz00000009", new Set(["qx"])],
    ]);
    expect(counts(pool(records(), 3, alive))).toEqual({ [Q]: 4, qz00000009: 1 });
  });
});

describe("answersOf", () => {
  it("reads a list of answers", () => {
    expect(answersOf([{ quiz: Q, question: "q7f3a2", correct: true, run: "mistakes" }])).toEqual([
      { quiz: Q, question: "q7f3a2", correct: true, run: "mistakes" },
    ]);
  });

  it.each([
    ["nope"],
    [[{ quiz: "not-an-id", question: "q", correct: true, run: "quiz" }]],
    [[{ quiz: Q, question: "has space", correct: true, run: "quiz" }]],
    [[{ quiz: Q, question: "q", correct: "yes", run: "quiz" }]],
    [[{ quiz: Q, question: "q", correct: true, run: "gym" }]],
    [["string"]],
    [Array.from({ length: MAX_EVENTS + 1 }, () => ({ quiz: Q, question: "q", correct: true, run: "quiz" }))],
  ])("refuses what is not one (%#)", (raw) => {
    expect(() => answersOf(raw)).toThrow(PracticeRefused);
  });
});

describe("graduateOf", () => {
  it("accepts 1 to 10 integers and defaults otherwise", () => {
    expect(graduateOf(3)).toBe(3);
    for (const bad of [0, 11, "2", true, 2.5, null, undefined]) expect(graduateOf(bad)).toBe(GRADUATE);
  });
});

describe("Practice over a Home", () => {
  let env: Env | null = null;
  let extra: Home[] = [];
  afterEach(async () => {
    await env?.cleanup();
    env = null;
    for (const h of extra) h.close();
    extra = [];
    sweepTemps();
  });

  const homeOnly = (): Home => {
    const h = new Home(fs.mkdtempSync(path.join(os.tmpdir(), "anydag-practice-")));
    extra.push(h);
    return h;
  };

  it("starts with no records and the default threshold", () => {
    const p = new Practice(homeOnly(), "v1");
    expect(p.records()).toEqual({});
    expect(p.graduate()).toBe(2);
  });

  it("treats answers as events and every one counts", () => {
    const p = new Practice(homeOnly(), "v1");
    const out = p.fold([miss(), hit()], "t");
    expect(out).toEqual({ [Q]: { qa: { wrong: 1, right: 1, streak: 1, at: "t" } } });
    expect(p.records()).toEqual(out);
  });

  it("only the quizzes an answer touches come back, and the rest are left alone", () => {
    const p = new Practice(homeOnly(), "v1");
    p.fold([miss("qb", "quiz", "qz00000002")], "t0");
    const out = p.fold([miss("qa")], "t1");
    expect(Object.keys(out)).toEqual([Q]);
    expect(p.records("qz00000002").qz00000002!.qb!.wrong).toBe(1);
    expect(Object.keys(p.records()).sort()).toEqual([Q, "qz00000002"]);
  });

  it("a miss goes into mistakes and two right there take it out", () => {
    const p = new Practice(homeOnly(), "v1");
    p.fold([miss()], "t");
    const alive = new Map([[Q, new Set(["qa"])]]);
    expect(counts(pool(p.records(), p.graduate(), alive))).toEqual({ [Q]: 1 });
    p.fold([hit()], "t");
    expect(counts(pool(p.records(), p.graduate(), alive))).toEqual({ [Q]: 1 });
    p.fold([hit()], "t");
    expect(pool(p.records(), p.graduate(), alive)).toEqual([]);
  });

  it("right in the quiz itself does not take it out", () => {
    const p = new Practice(homeOnly(), "v1");
    p.fold([miss(), hit("qa", "quiz"), hit("qa", "quiz"), hit("qa", "quiz")], "t");
    expect(pool(p.records(), 2, new Map([[Q, new Set(["qa"])]]))).toHaveLength(1);
  });

  it("raising the threshold puts a question back", () => {
    const p = new Practice(homeOnly(), "v1");
    p.fold([miss(), hit(), hit()], "t");
    const alive = new Map([[Q, new Set(["qa"])]]);
    expect(pool(p.records(), p.graduate(), alive)).toEqual([]);
    p.setGraduate(3);
    expect(p.graduate()).toBe(3);
    expect(pool(p.records(), p.graduate(), alive).map((e) => e.question)).toEqual(["qa"]);
  });

  it("is scoped by vault", () => {
    const home = homeOnly();
    new Practice(home, "v1").fold([miss()], "t");
    expect(new Practice(home, "v2").records()).toEqual({});
    expect(Object.keys(new Practice(home, "v1").records())).toEqual([Q]);
  });

  it("survives its Home being reopened, and reads a corrupt row as zero", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-practice-"));
    const a = new Home(dir);
    new Practice(a, "v1").fold([miss()], "t");
    a.sql("update practice set record = 'not json' where vault = 'v1'").run();
    a.close();
    const b = new Home(dir);
    extra.push(b);
    expect(new Practice(b, "v1").records()[Q]!.qa).toEqual(zero);
  });

  it("a question deleted from its quiz leaves mistakes and is kept (aliveOf over a real vault)", async () => {
    env = makeEnv();
    const name = await env.vault.create("drill", "quiz", QUIZ.replace("## Two?", "## Two? {#q2}"));
    const tree = await env.vault.tree();
    const qid = tree.ids[name]!;
    const p = new Practice(env.home, env.vault.id);
    p.fold([miss("q2", "quiz", qid)], "t");
    expect(pool(p.records(), 2, aliveOf(tree)).map((e) => e.question)).toEqual(["q2"]);
    const cur = (await env.vault.read(name, "quiz"))!;
    await env.vault.write(name, "quiz", cur.text.slice(0, cur.text.indexOf("## Two?")), cur.base);
    const after = await env.vault.tree();
    expect(aliveOf(after).get(qid)).toEqual(new Set(["q1"]));
    expect(pool(p.records(), 2, aliveOf(after))).toEqual([]);
    expect(p.records(qid)[qid]!.q2!.wrong).toBe(1);
  });
});
