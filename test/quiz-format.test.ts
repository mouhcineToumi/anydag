/**
 * The `.quiz.md` format: what `parseQuiz` reads, what it refuses, and what the writers
 * leave alone. `test/fixtures/quizzes.json` is the list of where a question
 * starts it is held to.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { folderOfRun, folderQuizzes } from "../src/quiz/folder";
import { askable, isRight, optionOrder, parseQuiz, pinned } from "../src/quiz/parse";
import {
  addQuestion,
  blankQuizText,
  inputOf,
  mintQuestionId,
  moveQuestion,
  removeQuestion,
  renderQuestion,
  replaceQuestion,
  sameQuestion,
  setDescription,
  setShuffle,
  stampIds,
} from "../src/quiz/write";

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "quizzes.json"), "utf8")) as {
  cases: { name: string; text: string; questions: { id: string | null; line: number }[] }[];
};

const codes = (text: string) => parseQuiz(text).diagnostics.map((d) => `${d.line}:${d.code}`);

const SAMPLE = `---
title: Postgres internals
---

A short quiz about   *MVCC*.

## What does VACUUM reclaim? {#qvac}

It runs in the background.

\`\`\`sql
VACUUM;
\`\`\`

* [ ] Index bloat only
* [x] The space of dead tuples
* [ ]   Old WAL segments

> Dead tuples stay until VACUUM
marks their space reusable.

## Which fields decide visibility? {#qvis}
- [x] \`xmin\`
- [X] \`xmax\`
- [ ] \`ctid\`

## Pick the one that commits {#qone multi}

- [ ] ROLLBACK
- [x] COMMIT
`;

describe("the fixture both readers are held to", () => {
  for (const c of FIXTURE.cases) {
    it(c.name, () => {
      expect(parseQuiz(c.text).questions.map((q) => ({ id: q.id ?? null, line: q.line }))).toEqual(c.questions);
    });
  }
});

describe("parseQuiz", () => {
  const quiz = parseQuiz(SAMPLE);

  it("reads the description, every question and nothing else", () => {
    expect(quiz.description).toBe("A short quiz about   *MVCC*.");
    expect(quiz.questions.map((q) => q.id)).toEqual(["qvac", "qvis", "qone"]);
    expect(quiz.diagnostics).toEqual([]);
  });

  it("keeps the rest of the prompt, code included, and the options in the author's order", () => {
    const q = quiz.questions[0]!;
    expect(q.prompt).toBe("What does VACUUM reclaim?");
    expect(q.body).toBe("It runs in the background.\n\n```sql\nVACUUM;\n```");
    expect(q.options).toEqual([
      { text: "Index bloat only", correct: false, pin: false, line: 15 },
      { text: "The space of dead tuples", correct: true, pin: false, line: 16 },
      { text: "Old WAL segments", correct: false, pin: false, line: 17 },
    ]);
  });

  it("takes the quote off the explanation, lazy continuation included", () => {
    expect(quiz.questions[0]!.why).toBe("Dead tuples stay until VACUUM\nmarks their space reusable.");
  });

  it("asks for every correct option when two are ticked, or when the heading says multi", () => {
    expect(quiz.questions.map((q) => [q.multi, q.multiFlag])).toEqual([
      [false, false],
      [true, false],
      [true, true],
    ]);
  });

  it("ends a question's span at its last line that is not blank", () => {
    const q = quiz.questions[0]!;
    expect(SAMPLE.slice(q.span.start, q.span.end)).toMatch(/^## What does VACUUM[\s\S]*reusable\.\n$/);
  });

  it("keeps an option's indented continuation line, which draws as the same paragraph", () => {
    const q = parseQuiz("## Q {#a}\n- [x] a long option\n  that wraps\n- [ ] short\n").questions[0]!;
    expect(q.options.map((o) => o.text)).toEqual(["a long option\nthat wraps", "short"]);
  });

  it("reads an option holding a code block, blank lines and all", () => {
    const text = [
      "## Which query? {#a}",
      "",
      "- [x] The correct query",
      "    ```sql",
      "    select *",
      "",
      "    from t;",
      "    ```",
      "- [ ] Another",
      "  ```",
      "  ## not a question",
      "  - [ ] not an option",
      "  ```",
      "",
      "> because",
      "",
      "## Next {#b}",
      "- [x] y",
      "- [ ] n",
      "",
    ].join("\n");
    const quiz = parseQuiz(text);
    expect(quiz.diagnostics).toEqual([]);
    expect(quiz.questions.map((q) => q.id)).toEqual(["a", "b"]);
    const [right, other] = quiz.questions[0]!.options;
    expect(right!.text).toBe("The correct query\n```sql\nselect *\n\nfrom t;\n```");
    expect(other!.text).toBe("Another\n```\n## not a question\n- [ ] not an option\n```");
    expect(quiz.questions[0]!.why).toBe("because");
  });

  it("reads one-line options exactly as before, beside a block one", () => {
    const q = parseQuiz("## Q {#a}\n* [ ]   spaced  \n- [x] `code` and *more*\n").questions[0]!;
    expect(q.options.map((o) => o.text)).toEqual(["spaced", "`code` and *more*"]);
  });

  it("keeps a blank line in an option only when an indented line follows it", () => {
    const q = parseQuiz("## Q {#a}\n- [x] a\n\n  more of a\n\n- [ ] b\n\n> why\n").questions[0]!;
    expect(q.options.map((o) => o.text)).toEqual(["a\n\nmore of a", "b"]);
    expect(codes("## Q {#a}\n- [x] a\n- [ ] b\n\nnot indented\n")).toEqual(["5:EQ_STRAY"]);
  });

  it("says what is wrong, once each, on the line it is on", () => {
    expect(codes("## {#a}\n- [x] y\n- [ ] n\n")).toEqual(["1:EQ_NO_PROMPT"]);
    expect(codes("## Q {#a}\n\nJust prose.\n")).toEqual(["1:EQ_NO_OPTIONS"]);
    expect(codes("## Q {#a}\n- [x] only\n")).toEqual(["2:EQ_ONE_OPTION"]);
    expect(codes("## Q {#a}\n- [ ] a\n- [ ] b\n")).toEqual(["2:EQ_NO_ANSWER"]);
    expect(codes("## Q {#a}\n- [x] a\n- [ ]\n")).toEqual(["3:EQ_EMPTY_OPTION"]);
    expect(codes("## Q {#a}\n- [x] a\n- [ ] b\n\nA paragraph.\n\nAnother.\n")).toEqual(["5:EQ_STRAY"]);
    expect(codes("## Q {#a}\n- [x] a\n- [ ] b\n\n> why\n\n> again\n")).toEqual(["7:EQ_STRAY"]);
    expect(codes("## A {#x}\n- [x] a\n- [ ] b\n## B {#x}\n- [x] a\n- [ ] b\n")).toEqual(["4:EQ_DUPLICATE_ID"]);
    expect(codes("## Q\n- [x] a\n- [ ] b\n")).toEqual(["1:WQ_NO_ID"]);
    expect(codes("## Q {#a hard}\n- [x] a\n- [ ] b\n")).toEqual(["1:WQ_UNKNOWN_ATTR"]);
    expect(codes("Just a description.\n")).toEqual(["1:WQ_EMPTY"]);
    expect(codes("## Q {#a}\n```\n- [x] a\n")).toEqual(["1:EQ_NO_OPTIONS", "2:WQ_OPEN_FENCE"]);
  });

  it("counts a quote before the options as part of the prompt", () => {
    const q = parseQuiz("## Q {#a}\n\n> quoted in the prompt\n\n- [x] a\n- [ ] b\n").questions[0]!;
    expect(q.body).toBe("> quoted in the prompt");
    expect(q.why).toBe("");
  });

  it("reads a question with no checklist and a quote at its end as open, the quote its answer", () => {
    const text = [
      "## Members who joined after September 2012 {#q4}",
      "",
      "The table is `cd.members`.",
      "",
      "> quoted in the prompt",
      "",
      "```md",
      "> a quote in code is code",
      "```",
      "",
      "> ```sql",
      "> select * from cd.members",
      "> where joindate >= '2012-09-01';",
      "> ```",
      ">",
      "> `>=` keeps the first day",
      "itself.",
      "",
    ].join("\n");
    const quiz = parseQuiz(text);
    const q = quiz.questions[0]!;
    expect(quiz.diagnostics).toEqual([]);
    expect(q.open).toBe(true);
    expect(q.options).toEqual([]);
    expect(q.body).toBe("The table is `cd.members`.\n\n> quoted in the prompt\n\n```md\n> a quote in code is code\n```");
    expect(q.why).toBe(
      "```sql\nselect * from cd.members\nwhere joindate >= '2012-09-01';\n```\n\n`>=` keeps the first day\nitself.",
    );
    expect(askable(q)).toBe(true);
  });

  it("is not open with options, with nothing after the prompt, or with prose after the quote", () => {
    expect(parseQuiz("## Q {#a}\n\n> why\n\n- [x] a\n- [ ] b\n").questions[0]!.open).toBe(false);
    expect(codes("## Q {#a}\n\nJust prose.\n")).toEqual(["1:EQ_NO_OPTIONS"]);
    expect(codes("## Q {#a}\n\n> answer\n\nThen prose.\n")).toEqual(["1:EQ_NO_OPTIONS"]);
    expect(codes("## Q {#a}\n```\n> code\n```\n")).toEqual(["1:EQ_NO_OPTIONS"]);
    expect(codes("## Q {#a multi}\n\n> answer\n")).toEqual(["1:WQ_UNKNOWN_ATTR"]);
    expect(askable(parseQuiz("## {#a}\n\n> answer\n").questions[0]!)).toBe(false);
  });

  it("reads `card` on a heading as a flashcard, its quote the back", () => {
    const quiz = parseQuiz("## What is MVCC? {#qc card}\n\nIn Postgres.\n\n> Multi-version\n> concurrency control.\n");
    const q = quiz.questions[0]!;
    expect(quiz.diagnostics).toEqual([]);
    expect(q).toMatchObject({ id: "qc", prompt: "What is MVCC?", body: "In Postgres.", card: true, open: true });
    expect(q.why).toBe("Multi-version\nconcurrency control.");
    expect(askable(q)).toBe(true);
    expect(parseQuiz("## Q {#a}\n\n> answer\n").questions[0]!.card).toBe(false);
  });

  it("keeps a flashcard with no back a card, says the back is missing, and asks it nowhere", () => {
    const quiz = parseQuiz("## Term {#qc card}\n");
    const q = quiz.questions[0]!;
    expect(q.card).toBe(true);
    expect(q.open).toBe(false);
    expect(askable(q)).toBe(false);
    expect(quiz.diagnostics.map((d) => d.code)).toEqual(["EQ_NO_OPTIONS"]);
    expect(quiz.diagnostics[0]!.message).toMatch(/no back/);
  });

  it("warns on `card` beside options or `multi`, and reads a dotted `.card` as prompt text", () => {
    const withOptions = parseQuiz("## Q {#a card}\n- [x] y\n- [ ] n\n");
    expect(withOptions.questions[0]!.card).toBe(false);
    expect(codes("## Q {#a card}\n- [x] y\n- [ ] n\n")).toEqual(["1:WQ_UNKNOWN_ATTR"]);
    expect(codes("## Q {#a card multi}\n\n> back\n")).toEqual(["1:WQ_UNKNOWN_ATTR"]);
    const dotted = parseQuiz("## Term {#qd .card}\n\n> back\n").questions[0]!;
    expect(dotted).toMatchObject({ prompt: "Term {#qd .card}", card: false, open: true });
    expect(dotted.id).toBeUndefined();
  });

  it("never throws, whatever it is handed", () => {
    for (const text of ["", "\n", "##", "- [x]", "> a", "```", "---\n", "---\ntitle: x\n---"])
      expect(() => parseQuiz(text)).not.toThrow();
  });
});

describe("grading", () => {
  const [single, multi] = parseQuiz(SAMPLE).questions;
  it("is right on exactly the correct options", () => {
    expect(isRight(single!, [1])).toBe(true);
    expect(isRight(single!, [0])).toBe(false);
    expect(isRight(single!, [])).toBe(false);
    expect(isRight(multi!, [0, 1])).toBe(true);
    expect(isRight(multi!, [1, 0, 1])).toBe(true);
    expect(isRight(multi!, [0])).toBe(false);
    expect(isRight(multi!, [0, 1, 2])).toBe(false);
  });
  it("knows a question a run can ask", () => {
    expect(parseQuiz(SAMPLE).questions.every(askable)).toBe(true);
    expect(askable(parseQuiz("## Q {#a}\n- [ ] a\n- [ ] b\n").questions[0]!)).toBe(false);
  });
});

describe("the writers", () => {
  const others = (text: string, except: string) =>
    parseQuiz(text)
      .questions.filter((q) => q.id !== except)
      .map((q) => text.slice(q.span.start, q.span.end));

  it("rewrite the question they are about and leave every other byte", () => {
    const before = others(SAMPLE, "qvis");
    const input = { ...inputOf(parseQuiz(SAMPLE).questions[1]!), prompt: "Which two fields decide visibility?" };
    const after = replaceQuestion(SAMPLE, "qvis", input);
    expect(others(after, "qvis")).toEqual(before);
    expect(after.slice(0, SAMPLE.indexOf("## Which"))).toBe(SAMPLE.slice(0, SAMPLE.indexOf("## Which")));
    expect(parseQuiz(after).questions[1]!.prompt).toBe("Which two fields decide visibility?");
    expect(parseQuiz(after).diagnostics).toEqual([]);
  });

  it("write nothing when the question says what it already said", () => {
    for (const q of parseQuiz(SAMPLE).questions) {
      expect(sameQuestion(q, inputOf(q))).toBe(true);
      expect(replaceQuestion(SAMPLE, q.id!, inputOf(q))).toBe(SAMPLE);
    }
  });

  it("render the house form, and read it back as they wrote it", () => {
    const input = {
      id: "qnew",
      prompt: "Which\nare right?",
      body: "\n\nSome context.\n\n",
      options: [
        { text: "one", correct: true },
        { text: "two", correct: false },
      ],
      why: "Because.\n\nReally.",
      multi: true,
    };
    const text = renderQuestion(input);
    expect(text).toBe("## Which are right? {#qnew multi}\n\nSome context.\n\n- [x] one\n- [ ] two\n\n> Because.\n>\n> Really.\n");
    const back = parseQuiz(text).questions[0]!;
    expect(sameQuestion(back, input)).toBe(true);
    expect(parseQuiz(text).diagnostics).toEqual([]);
  });

  it("write an option holding code, and read it back as the form held it", () => {
    const input = {
      id: "qsql",
      prompt: "Which query is right?",
      options: [
        { text: "This one\n```sql\nselect *\n\n  from t;\n```", correct: true },
        { text: "```sql\nselect 1;\n```", correct: false },
        { text: "Plain", correct: false },
      ],
    };
    const text = renderQuestion(input);
    expect(text).toBe(
      [
        "## Which query is right? {#qsql}",
        "",
        "- [x] This one",
        "  ```sql",
        "  select *",
        "",
        "    from t;",
        "  ```",
        "- [ ]",
        "  ```sql",
        "  select 1;",
        "  ```",
        "- [ ] Plain",
        "",
      ].join("\n"),
    );
    const back = parseQuiz(text);
    expect(back.diagnostics).toEqual([]);
    expect(back.questions[0]!.options.map((o) => o.text)).toEqual(input.options.map((o) => o.text));
    expect(sameQuestion(back.questions[0]!, input)).toBe(true);
  });

  it("rewrite a question with a code-block option and no other byte, and keep an author's indent until then", () => {
    const authored = [
      "## First {#a}",
      "",
      "- [x] The correct query",
      "    ```sql",
      "    select …",
      "    ```",
      "- [ ] A wrong one",
      "    ```sql",
      "    select nothing",
      "    ```",
      "",
      "## Second {#b}",
      "- [x] y",
      "- [ ] n",
      "",
    ].join("\n");
    const quiz = parseQuiz(authored);
    expect(replaceQuestion(authored, "a", inputOf(quiz.questions[0]!))).toBe(authored);
    const input = inputOf(quiz.questions[0]!);
    input.options[1] = { ...input.options[1]!, text: input.options[1]!.text.replace("nothing", "everything") };
    const after = replaceQuestion(authored, "a", input);
    expect(after.slice(after.indexOf("## Second"))).toBe(authored.slice(authored.indexOf("## Second")));
    expect(parseQuiz(after).questions[0]!.options[1]!.text).toBe("A wrong one\n```sql\nselect everything\n```");
    expect(parseQuiz(after).questions[0]!.options[0]!.text).toBe(quiz.questions[0]!.options[0]!.text);
  });

  it("write an open question, and read it back open", () => {
    const input = {
      id: "qo",
      prompt: "Write the query",
      body: "Every member.",
      options: [],
      why: "```sql\nselect * from cd.members;\n```",
    };
    const text = renderQuestion(input);
    expect(text).toBe("## Write the query {#qo}\n\nEvery member.\n\n> ```sql\n> select * from cd.members;\n> ```\n");
    const back = parseQuiz(text).questions[0]!;
    expect(back.open).toBe(true);
    expect(back.why).toBe(input.why);
    expect(sameQuestion(back, input)).toBe(true);
  });

  it("write a flashcard, read it back a card, and keep its bytes when nothing changed", () => {
    const input = { id: "qc", prompt: "What is MVCC?", options: [], why: "Multi-version concurrency control.", card: true };
    const text = renderQuestion(input);
    expect(text).toBe("## What is MVCC? {#qc card}\n\n> Multi-version concurrency control.\n");
    const back = parseQuiz(text).questions[0]!;
    expect(back.card).toBe(true);
    expect(inputOf(back)).toEqual({
      id: "qc",
      prompt: "What is MVCC?",
      body: "",
      options: [],
      why: input.why,
      multi: false,
      card: true,
    });
    expect(sameQuestion(back, input)).toBe(true);
    expect(sameQuestion(back, { ...input, card: false })).toBe(false);
    expect(replaceQuestion(text, "qc", input)).toBe(text);
    /* An author's spacing and attribute order survive a rewrite that means nothing. */
    const authored = "## What is MVCC?   {card #qc}\n\n>   Multi-version concurrency control.\n";
    expect(replaceQuestion(authored, "qc", inputOf(parseQuiz(authored).questions[0]!))).toBe(authored);
  });

  it("rewrite a flashcard and no other byte, and turn it into an open question and back", () => {
    const text = SAMPLE + "\n## Term {#qc card}\n\n> back\n";
    const card = parseQuiz(text).questions.find((q) => q.id === "qc")!;
    const edited = replaceQuestion(text, "qc", { ...inputOf(card), why: "A new back." });
    expect(edited).toBe(SAMPLE + "\n## Term {#qc card}\n\n> A new back.\n");
    const open = replaceQuestion(text, "qc", { ...inputOf(card), card: false });
    expect(open).toBe(SAMPLE + "\n## Term {#qc}\n\n> back\n");
    expect(replaceQuestion(open, "qc", { ...inputOf(parseQuiz(open).questions[3]!), card: true })).toBe(text);
    /* `card` is written only while it means something: a card given options is a choice. */
    expect(
      renderQuestion({
        id: "a",
        prompt: "Q",
        card: true,
        options: [
          { text: "y", correct: true },
          { text: "n", correct: false },
        ],
      }),
    ).toMatch(/^## Q \{#a\}\n/);
  });

  it("add a flashcard with no back yet, and read it as a card", () => {
    const added = addQuestion(blankQuizText(), { id: "qnew", prompt: "", options: [], card: true });
    expect(added).toBe("---\ntitle: Untitled\n---\n\n##  {#qnew card}\n");
    expect(parseQuiz(added).questions[0]!.card).toBe(true);
  });

  it("write multi only where the ticks do not already say it", () => {
    expect(
      renderQuestion({
        id: "a",
        prompt: "Q",
        options: [
          { text: "a", correct: true },
          { text: "b", correct: true },
        ],
        multi: true,
      }),
    ).toMatch(/^## Q \{#a\}\n/);
  });

  it("add a question at the end, or before another, with one blank line", () => {
    const q = {
      id: "qadd",
      prompt: "Added",
      options: [
        { text: "y", correct: true },
        { text: "n", correct: false },
      ],
    };
    const end = addQuestion(SAMPLE, q);
    expect(end.startsWith(SAMPLE)).toBe(true);
    expect(end.slice(SAMPLE.length)).toBe("\n" + renderQuestion(q));
    const first = addQuestion(SAMPLE, q, 0);
    expect(parseQuiz(first).questions.map((x) => x.id)).toEqual(["qadd", "qvac", "qvis", "qone"]);
    expect(parseQuiz(first).description).toBe("A short quiz about   *MVCC*.");
    expect(addQuestion(blankQuizText(), q)).toBe("---\ntitle: Untitled\n---\n\n" + renderQuestion(q));
    expect(addQuestion("", q)).toBe(renderQuestion(q));
  });

  it("remove a question and the gap it leaves", () => {
    const middle = removeQuestion(SAMPLE, "qvis");
    expect(parseQuiz(middle).questions.map((x) => x.id)).toEqual(["qvac", "qone"]);
    expect(middle).not.toMatch(/\n\n\n/);
    const last = removeQuestion(SAMPLE, "qone");
    expect(last.endsWith("- [ ] `ctid`\n")).toBe(true);
    const only = removeQuestion("---\ntitle: T\n---\n\n## Q {#a}\n- [x] a\n- [ ] b\n", "a");
    expect(only).toBe("---\ntitle: T\n---\n");
  });

  it("move a question and change nothing but the order", () => {
    const moved = moveQuestion(SAMPLE, "qone", 0);
    const q = parseQuiz(moved);
    expect(q.questions.map((x) => x.id)).toEqual(["qone", "qvac", "qvis"]);
    const bytes = (t: string) =>
      parseQuiz(t)
        .questions.map((x) => t.slice(x.span.start, x.span.end))
        .sort();
    expect(bytes(moved)).toEqual(bytes(SAMPLE));
    expect(moveQuestion(SAMPLE, "qvac", 0)).toBe(SAMPLE);
    expect(moveQuestion(moved, "qone", 2)).toBe(SAMPLE);
  });

  it("move a last question with no newline into the middle without gluing it on", () => {
    const text = "## A {#a}\n- [x] y\n- [ ] n\n\n## B {#b}\n- [x] y\n- [ ] n";
    expect(parseQuiz(moveQuestion(text, "b", 0)).questions.map((q) => q.id)).toEqual(["b", "a"]);
  });

  it("stamp the questions that have no id, on their headings only", () => {
    const text = "## First\n- [x] y\n- [ ] n\n\n## Second {#have}\n- [x] y\n- [ ] n\n\n## Third {multi} ##\n- [x] y\n- [ ] n\n";
    let n = 0;
    const { text: out, minted } = stampIds(text, () => `qm${++n}`);
    expect(minted).toEqual(["qm2", "qm1"]);
    const q = parseQuiz(out);
    expect(q.questions.map((x) => x.id)).toEqual(["qm2", "have", "qm1"]);
    expect(q.questions[2]!.multiFlag).toBe(true);
    expect(q.diagnostics).toEqual([]);
    expect(out.split("\n").filter((l) => !l.startsWith("##"))).toEqual(text.split("\n").filter((l) => !l.startsWith("##")));
  });

  it("stamp an id onto a flashcard and keep it a flashcard", () => {
    const text = "## Term {card}\n\n> back\n\n## Both {multi card}\n\n> back\n";
    let n = 0;
    const { text: out } = stampIds(text, () => `qm${++n}`);
    expect(out).toBe("## Term {#qm2 card}\n\n> back\n\n## Both {#qm1 multi card}\n\n> back\n");
    expect(parseQuiz(out).questions.map((q) => q.card)).toEqual([true, true]);
  });

  it("set the description, and take it away", () => {
    const set = setDescription(SAMPLE, "Now about locking.");
    expect(parseQuiz(set).description).toBe("Now about locking.");
    expect(set.slice(set.indexOf("## What"))).toBe(SAMPLE.slice(SAMPLE.indexOf("## What")));
    const gone = setDescription(SAMPLE, "");
    expect(parseQuiz(gone).description).toBe("");
    expect(gone.startsWith("---\ntitle: Postgres internals\n---\n\n## What")).toBe(true);
    expect(setDescription(blankQuizText(), "Hello")).toBe("---\ntitle: Untitled\n---\n\nHello\n");
  });

  it("mint ids of the store's alphabet, never one that is taken", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = mintQuestionId(taken);
      expect(id).toMatch(/^q[0-9a-hjkmnp-tv-z]{6}$/);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
  });
});

describe("shuffling the options", () => {
  /** A `random` that plays back a list, so an order is a fact a test can state. */
  const playing =
    (...values: number[]) =>
    () =>
      values.shift() ?? 0;
  const SHUFFLED =
    "---\ntitle: T\nshuffle: true\n---\n\n## Q {#a}\n- [ ] one\n- [x] two {pin}\n- [ ] three\n- [ ] **None of the above**\n- [ ] Both\n";

  it("reads `shuffle: true` off the frontmatter, and nothing else as it", () => {
    expect(parseQuiz(SHUFFLED).shuffle).toBe(true);
    expect(parseQuiz("---\nshuffle: Yes\n---\n## Q\n").shuffle).toBe(true);
    expect(parseQuiz("---\nshuffle: false\n---\n## Q\n").shuffle).toBe(false);
    expect(parseQuiz("shuffle: true\n\n## Q\n").shuffle).toBe(false);
    expect(parseQuiz(SAMPLE).shuffle).toBe(false);
  });

  it("takes `{pin}` off the option's words, and pins the words that speak about the others", () => {
    const options = parseQuiz(SHUFFLED).questions[0]!.options;
    expect(options.map((o) => [o.text, o.pin, pinned(o)])).toEqual([
      ["one", false, false],
      ["two", true, true],
      ["three", false, false],
      ["**None of the above**", false, true],
      ["Both", false, true],
    ]);
    expect(pinned({ text: "All of the above", pin: false })).toBe(true);
    expect(pinned({ text: "Neither, as it happens", pin: false })).toBe(true);
    expect(pinned({ text: "Bothersome", pin: false })).toBe(false);
  });

  it("shuffles what is not pinned into the places left, and leaves the pinned where they are", () => {
    const options = parseQuiz(SHUFFLED).questions[0]!.options;
    expect(optionOrder(options, playing(0, 0))).toEqual([2, 1, 0, 3, 4]);
    expect(optionOrder(options, playing(0.99, 0.99))).toEqual([0, 1, 2, 3, 4]);
    for (let n = 0; n < 50; n++) {
      const order = optionOrder(options);
      expect([...order].sort()).toEqual([0, 1, 2, 3, 4]);
      expect([order[1], order[3], order[4]]).toEqual([1, 3, 4]);
    }
  });

  it("writes `{pin}` back, and `shuffle:` as one line of the frontmatter", () => {
    const q = parseQuiz(SHUFFLED).questions[0]!;
    expect(replaceQuestion(SHUFFLED, "a", inputOf(q))).toBe(SHUFFLED);
    expect(
      renderQuestion({
        ...inputOf(q),
        options: [
          { text: "x\n```\ncode\n```", correct: true, pin: true },
          { text: "y", correct: false },
        ],
      }),
    ).toBe("## Q {#a}\n\n- [x] x {pin}\n  ```\n  code\n  ```\n- [ ] y\n");
    expect(
      parseQuiz(renderQuestion({ prompt: "Q", options: [{ text: "```\nc\n```", correct: true, pin: true }] })).questions[0]!
        .options[0],
    ).toMatchObject({
      text: "```\nc\n```",
      pin: true,
    });
    const off = setShuffle(SHUFFLED, false);
    expect(off).toBe(SHUFFLED.replace("shuffle: true\n", ""));
    expect(setShuffle(off, true)).toBe("---\ntitle: T\nshuffle: true\n---\n" + SHUFFLED.slice(SHUFFLED.indexOf("\n## ")));
    expect(setShuffle(SHUFFLED, true)).toBe(SHUFFLED);
    expect(setShuffle("## Q {#a}\n- [x] a\n- [ ] b\n", true)).toBe("---\nshuffle: true\n---\n## Q {#a}\n- [x] a\n- [ ] b\n");
  });
});

describe("a folder of quizzes as one run", () => {
  it("is every quiz under it in the sidebar's order: folders first, numbers as numbers", () => {
    const quizzes = ["c/10-windows", "c/2-joins", "c/b/z", "c/a/y", "other/x", "c", "cc/x"];
    const titles = { "c/10-windows": "10 · Windows", "c/2-joins": "2 · Joins", "c/b/z": "Zed", "c/a/y": "Why" };
    expect(folderQuizzes(quizzes, titles, "c")).toEqual(["c/a/y", "c/b/z", "c/2-joins", "c/10-windows"]);
    expect(folderQuizzes(quizzes, titles, "")).toEqual([]);
  });

  it("reads the folder off `run=folder:<path>`", () => {
    expect(folderOfRun("folder:learning/sql")).toBe("learning/sql");
    expect(folderOfRun("folder:/learning/sql/")).toBe("learning/sql");
    expect(folderOfRun("folder:")).toBeNull();
    expect(folderOfRun("mistakes")).toBeNull();
    expect(folderOfRun(null)).toBeNull();
  });
});
