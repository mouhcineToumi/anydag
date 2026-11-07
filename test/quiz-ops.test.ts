/**
 * One question at a time, by id: `src/quiz/ops.ts`, what `POST /__board/quiz` applies.
 * The property under test is the issue's: every other byte of the quiz is left alone.
 */
import { describe, expect, it } from "vitest";

import { applyQuizOps } from "../src/quiz/ops";
import { parseQuiz } from "../src/quiz/parse";

/** An author's quiz, written the way people write: `*` bullets, wrapped lines, odd spacing. */
const QUIZ = `---
title: Drill
---

Before the first question.

## One? {#qa}
*   [x] yes, wrapped
    over two lines
* [ ] no

> Because.

##   Two?   {#qb}

- [ ] a
- [x] b

## Three? {#qc}
- [x] c
- [ ] d
`;

const apply = (ops: unknown[]) => {
  const got = applyQuizOps(QUIZ, ops);
  if (!got.ok) throw new Error(got.error);
  return got;
};

/** Every question's bytes but the ones named, in file order. */
const others = (text: string, ...except: string[]) =>
  parseQuiz(text)
    .questions.filter((q) => !except.includes(q.id ?? ""))
    .map((q) => text.slice(q.span.start, q.span.end));

describe("one question at a time", () => {
  it("replaces a question with the Markdown given, as given, and no other byte", () => {
    const md = "## Two, again?   {#qb}\n\nWrapped\nprose.\n\n+ [x] a\n+ [ ] b\n";
    const { text, ids } = apply([{ op: "set", markdown: md }]);
    expect(ids).toEqual(["qb"]);
    expect(text).toBe(QUIZ.replace("##   Two?   {#qb}\n\n- [ ] a\n- [x] b\n", md));
    expect(others(text, "qb")).toEqual(others(QUIZ, "qb"));
  });

  it("takes the id from the op when the heading has none, and refuses two that disagree", () => {
    const { text } = apply([{ op: "set", id: "qc", markdown: "## Three, now? \n- [ ] c\n- [x] d" }]);
    expect(text.endsWith("## Three, now? {#qc}\n- [ ] c\n- [x] d\n")).toBe(true);
    expect(applyQuizOps(QUIZ, [{ op: "set", id: "qc", markdown: "## X {#qz}\n- [x] a\n- [ ] b" }])).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("adds a question at the end with an id of its own, or before or after one, one blank line apart", () => {
    const end = apply([{ op: "set", markdown: "## Four?\n- [x] e\n- [ ] f\n" }]);
    expect(end.ids[0]).toMatch(/^q[0-9a-z]{6}$/);
    expect(end.text).toBe(`${QUIZ}\n## Four? {#${end.ids[0]}}\n- [x] e\n- [ ] f\n`);
    const before = apply([{ op: "set", id: "qn", markdown: "## New?\n- [x] e\n- [ ] f", before: "qb" }]);
    expect(parseQuiz(before.text).questions.map((q) => q.id)).toEqual(["qa", "qn", "qb", "qc"]);
    expect(others(before.text, "qn")).toEqual(others(QUIZ));
    const after = apply([{ op: "set", id: "qn", markdown: "## New?\n- [x] e\n- [ ] f", after: "qc" }]);
    expect(parseQuiz(after.text).questions.map((q) => q.id)).toEqual(["qa", "qb", "qc", "qn"]);
  });

  it("removes a question and the gap it leaves, and nothing else", () => {
    const { text } = apply([{ op: "remove", id: "qb" }]);
    expect(text).toBe(QUIZ.replace("##   Two?   {#qb}\n\n- [ ] a\n- [x] b\n\n", ""));
  });

  it("moves a question before or after another, or to the end, with every question's bytes kept", () => {
    const ids = (ops: unknown[]) => parseQuiz(apply(ops).text).questions.map((q) => q.id);
    expect(ids([{ op: "move", id: "qc", before: "qa" }])).toEqual(["qc", "qa", "qb"]);
    expect(ids([{ op: "move", id: "qa", after: "qb" }])).toEqual(["qb", "qa", "qc"]);
    expect(ids([{ op: "move", id: "qa" }])).toEqual(["qb", "qc", "qa"]);
    expect(ids([{ op: "move", id: "qc", after: "qa" }])).toEqual(["qa", "qc", "qb"]);
    const moved = apply([{ op: "move", id: "qc", before: "qa" }]).text;
    expect([...others(moved)].sort()).toEqual([...others(QUIZ)].sort());
    expect(moved.slice(0, moved.indexOf("## "))).toBe(QUIZ.slice(0, QUIZ.indexOf("## ")));
  });

  it("refuses what names nothing, and Markdown that is not one askable question, applying none of the list", () => {
    expect(applyQuizOps(QUIZ, [{ op: "remove", id: "nope" }])).toEqual({
      ok: false,
      status: 404,
      error: "no question `nope` in this quiz",
    });
    expect(applyQuizOps(QUIZ, [{ op: "move", id: "qa", before: "nope" }])).toMatchObject({ ok: false, status: 404 });
    for (const markdown of [
      "Just prose.",
      "## A?\n- [x] a\n- [ ] b\n## B?\n- [x] a\n- [ ] b",
      "Intro.\n\n## A?\n- [x] a\n- [ ] b",
      "## A?\n- [ ] a\n- [ ] b",
      "---\nt: x\n---\n## A?\n- [x] a\n- [ ] b",
    ])
      expect(applyQuizOps(QUIZ, [{ op: "set", markdown }])).toMatchObject({ ok: false, status: 400 });
    expect(
      applyQuizOps(QUIZ, [
        { op: "remove", id: "qa" },
        { op: "remove", id: "nope" },
      ]),
    ).toMatchObject({ ok: false });
    expect(applyQuizOps(QUIZ, [{ op: "rename", id: "qa" }])).toMatchObject({ ok: false, status: 400 });
  });

  it("sets an open question, and one whose options hold code", () => {
    const { text } = apply([
      { op: "set", id: "qo", markdown: "## Write it\n\n> ```sql\n> select 1;\n> ```" },
      { op: "set", id: "qk", markdown: "## Which?\n- [x] This\n  ```sql\n  select 1;\n  ```\n- [ ] That" },
    ]);
    const qs = parseQuiz(text).questions;
    expect(qs.find((q) => q.id === "qo")!.open).toBe(true);
    expect(qs.find((q) => q.id === "qk")!.options[0]!.text).toBe("This\n```sql\nselect 1;\n```");
    expect(others(text, "qo", "qk")).toEqual(others(QUIZ));
  });
});
