/**
 * What the quiz form says about a problem: words with no syntax in them, and a fix for every code a
 * person can meet — the form has no source to send anybody to.
 */
import { describe, expect, it } from "vitest";

import { parseQuiz } from "@/quiz/parse";
import { said } from "@/ui/quiz/problems";

/** One file for each code, the question it is on first when there is one. */
const CASES: Record<string, string> = {
  EQ_NO_PROMPT: "## {#qa}\n- [x] a\n- [ ] b\n",
  EQ_NO_OPTIONS: "## Q {#qa}\n",
  EQ_ONE_OPTION: "## Q {#qa}\n- [x] a\n",
  EQ_NO_ANSWER: "## Q {#qa}\n- [ ] a\n- [ ] b\n",
  EQ_EMPTY_OPTION: "## Q {#qa}\n- [x] a\n- [ ]\n",
  EQ_STRAY: "## Q {#qa}\n- [x] a\n- [ ] b\n\nStray.\n",
  EQ_DUPLICATE_ID: "## A {#qa}\n- [x] a\n- [ ] b\n\n## B {#qa}\n- [x] a\n- [ ] b\n",
  WQ_UNKNOWN_ATTR: "## Q {#qa wide}\n- [x] a\n- [ ] b\n",
  WQ_OPEN_FENCE: "## Q {#qa}\n\n```\ncode\n",
  WQ_EMPTY: "Nothing yet.\n",
  WQ_NO_ID: "## Q\n- [x] a\n- [ ] b\n",
};

describe("the quiz form's problems", () => {
  for (const [code, text] of Object.entries(CASES)) {
    it(`says ${code} in words, and offers what fixes it`, () => {
      const quiz = parseQuiz(text);
      const d = quiz.diagnostics.find((x) => x.code === code);
      expect(d, `the parser says ${code}`).toBeDefined();
      const q = quiz.questions.filter((x) => x.line <= d!.line).at(-1);
      const s = said(d!, q);
      if (code === "WQ_EMPTY" || code === "WQ_NO_ID") return expect(s).toBeNull();
      expect(s).not.toBeNull();
      /* No Markdown, no line numbers: nothing a person would have to read a file to understand. */
      expect(s!.words).not.toMatch(/[`#>{}[\]]|line \d/);
      /* Only the missing tick has no button: the ticks themselves are what to press. */
      if (code !== "EQ_NO_ANSWER") expect(s!.fix.kind).not.toBe("none");
    });
  }

  it("points an empty answer at the answer", () => {
    const quiz = parseQuiz(CASES.EQ_EMPTY_OPTION!);
    const d = quiz.diagnostics.find((x) => x.code === "EQ_EMPTY_OPTION")!;
    expect(said(d, quiz.questions[0])!.fix).toEqual({ kind: "focus", field: "option", option: 1 });
  });
});
