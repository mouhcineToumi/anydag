/**
 * A quiz's problems as the form says them: in words, on the question, with what fixes each.
 *
 * The parser's messages (`src/quiz/parse.ts`) are for whoever holds the file — an agent through
 * `quiz_check`, a person in an editor — and they name the syntax, because that is how they fix it.
 * The form has no source to send anybody to, so here every code is a sentence with no Markdown in it
 * and a repair the form can make: a field to put the caret in, or a writer in `src/quiz/write.ts`.
 * A switch over the code, so a code added to `QUIZ_CODES` fails the typecheck until it is said here.
 */
import { assertNever } from "@/board/useBoard";
import type { QuizDiagnostic } from "@/quiz/codes";
import type { Question } from "@/quiz/parse";

export type Fix =
  /** Put the caret in a field of the card; `option` names which answer. */
  | { kind: "focus"; field: "prompt" | "why" | "option"; option?: number }
  | { kind: "add-option" }
  /** Show the text the form has no field for, and offer where it goes. */
  | { kind: "stray" }
  | { kind: "reid" }
  | { kind: "clean" }
  | { kind: "close-fence"; line: number }
  /** Nothing to press: the words say what to do, and the form shows where. */
  | { kind: "none" };

export interface Said {
  code: QuizDiagnostic["code"];
  severity: QuizDiagnostic["severity"];
  words: string;
  fix: Fix;
}

/** What the form says about one diagnostic, or `null` for one it does not show. `q` is the question it is on, if any. */
export function said(d: QuizDiagnostic, q?: Question): Said | null {
  const say = (words: string, fix: Fix = { kind: "none" }): Said => ({ code: d.code, severity: d.severity, words, fix });
  switch (d.code) {
    case "EQ_NO_PROMPT":
      return say("This question doesn't ask anything yet.", { kind: "focus", field: "prompt" });
    case "EQ_NO_OPTIONS":
      return say("Write the model answer, or make this a multiple-choice question.", { kind: "focus", field: "why" });
    case "EQ_ONE_OPTION":
      return say("Add at least one more answer to choose from.", { kind: "add-option" });
    case "EQ_NO_ANSWER":
      return say("Mark the right answer: tick the circle beside it.");
    case "EQ_EMPTY_OPTION": {
      const option = q ? q.options.findIndex((o) => o.line === d.line) : -1;
      return say(
        option >= 0 ? `Answer ${option + 1} is empty. Write it, or remove it.` : "An answer is empty. Write it, or remove it.",
        option >= 0 ? { kind: "focus", field: "option", option } : { kind: "none" },
      );
    }
    case "EQ_STRAY":
      return say("Some text after the answers isn't the explanation. Choose where it goes:", { kind: "stray" });
    case "EQ_DUPLICATE_ID":
      return say("This question shares its identity with another one, so their practice records would mix.", { kind: "reid" });
    case "WQ_UNKNOWN_ATTR":
      return say("This question carries a setting the app doesn't know.", { kind: "clean" });
    case "WQ_OPEN_FENCE":
      return say("A code block here never ends, so everything after it is read as code.", { kind: "close-fence", line: d.line });
    /* The empty state says this one; and an id is the file's business, written the first time it is needed. */
    case "WQ_EMPTY":
    case "WQ_NO_ID":
      return null;
    default:
      return assertNever(d.code);
  }
}

/** The label on a fix's button, for the fixes that are a button. */
export function fixLabel(fix: Fix): string | null {
  switch (fix.kind) {
    case "focus":
      return fix.field === "prompt" ? "Write it" : fix.field === "why" ? "Write the answer" : "Go to it";
    case "add-option":
      return "Add an answer";
    case "reid":
      return "Give it its own";
    case "clean":
      return "Remove it";
    case "close-fence":
      return "End the code block";
    case "stray":
    case "none":
      return null;
    default:
      return assertNever(fix);
  }
}
