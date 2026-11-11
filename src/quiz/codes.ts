/**
 * A stable name for every way a quiz can be wrong.
 *
 * The diagram DSL's rule one file over (`src/dsl/codes.ts`), for the third kind of file: the
 * message is for a person and may be reworded, the code is for a program and is not. `EQ_` is an
 * error — a question the runner cannot ask — and `WQ_` a warning about a quiz that still works.
 * The skill's *Writing a quiz* section names every one of these, and `check-skill.mjs` reads this
 * file by regex to hold it to that, so a code added here is a line added there.
 *
 * Codes are append-only. Retiring one is fine; reusing a retired one for something else is not.
 */
const QUIZ_CODES = {
  /** A `##` heading with nothing but its attributes: a question that asks nothing. */
  EQ_NO_PROMPT: "EQ_NO_PROMPT",
  /**
   * A question with no checklist under it and no model answer either. With a `>` quote at its end
   * it is an open question and this is not said. A flashcard (`card`) with no back says it too.
   */
  EQ_NO_OPTIONS: "EQ_NO_OPTIONS",
  /** One option is not a choice. */
  EQ_ONE_OPTION: "EQ_ONE_OPTION",
  /** Options, and none of them ticked `[x]`: a question nobody can get right. */
  EQ_NO_ANSWER: "EQ_NO_ANSWER",
  /** `- [ ]` with nothing after it. */
  EQ_EMPTY_OPTION: "EQ_EMPTY_OPTION",
  /**
   * Something after the options that is not the explanation: a paragraph, a second list, a second
   * quote. Refused with its line rather than guessed at, because there is no right guess about
   * which part of the question an author meant it for.
   */
  EQ_STRAY: "EQ_STRAY",
  /** Two questions in one file claiming one id — the second one's history would be the first's. */
  EQ_DUPLICATE_ID: "EQ_DUPLICATE_ID",
  /** A question with no `{#id}` yet. It works; it is given one the first time anything needs it. */
  WQ_NO_ID: "WQ_NO_ID",
  /**
   * A word in a heading's `{…}` that is neither `#id`, `multi` nor `card` — or `multi` on an open
   * question or a flashcard, or `card` on a question with options.
   */
  WQ_UNKNOWN_ATTR: "WQ_UNKNOWN_ATTR",
  /** A code block opened and never closed, so everything after it is code and no question. */
  WQ_OPEN_FENCE: "WQ_OPEN_FENCE",
  /** A quiz with no questions in it yet. */
  WQ_EMPTY: "WQ_EMPTY",
} as const;

export type QuizCode = keyof typeof QUIZ_CODES;

export interface QuizDiagnostic {
  code: QuizCode;
  severity: "error" | "warning";
  /** The file's line, 1-based, frontmatter counted — the number a person or an agent would count. */
  line: number;
  /** 1-based. */
  col: number;
  message: string;
  /** The question it is about, when it has an id. */
  question?: string;
}
